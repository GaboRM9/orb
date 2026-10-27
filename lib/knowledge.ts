import { createHash } from "node:crypto";
import { db, envKey, getSetting, ws } from "./db";
import { open } from "./secret";

// Hybrid retrieval: FTS5 (keywords, no inference) fused with an OpenAI embedding cosine scan (meaning).
export const EMBED_MODEL = "text-embedding-3-small@512";
const BATCH = 64;

export const normPath = (p: string) =>
  p.replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..").join("/");
const like = (prefix: string) => prefix.replace(/[\\%_]/g, "\\$&") + "/%";

/** Packs paragraphs into ~max-char chunks; a paragraph longer than max is cut hard. */
export function chunk(text: string, max = 800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (cur && cur.length + para.length + 2 > max) {
      out.push(cur);
      cur = "";
    }
    if (para.length > max) {
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out;
}

const apiKey = async () => open(await getSetting("openai_key")) || (await envKey("OPENAI_API_KEY")) || "";
export const hasEmbeddingKey = async () => !!(await apiKey());

/** One embedding per input, or null if there is no key or the call fails (callers fall back to keyword search). */
export async function embed(texts: string[]): Promise<Float32Array[] | null> {
  const key = await apiKey();
  if (!key || !texts.length) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    if (data.length !== texts.length) return null;
    return data.sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
  } catch {
    return null;
  }
}

const vecText = (v: ArrayLike<number>) => `[${Array.from(v).join(",")}]`; // what vector32() parses

const running = new Map<string, Promise<{ done: number; left: number }>>();
/** Embeds this workspace's chunks that have no vector (or one from another model), with this workspace's key. Stops at the first failed batch; overlapping calls share one run so nothing is embedded twice. */
export async function embedMissing() {
  const w = await ws();
  if (!running.has(w)) running.set(w, embedAll(w).finally(() => running.delete(w)));
  return running.get(w)!;
}

async function embedAll(w: string): Promise<{ done: number; left: number }> {
  let done = 0;
  for (;;) {
    const rows = (await db.prepare(
      "select c.id, c.text from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where d.workspace_id=? and (c.vec is null or c.embed_model is not ?) limit ?",
    ).all(w, EMBED_MODEL, BATCH)) as { id: number; text: string }[];
    const vecs = await embed(rows.map((r) => r.text));
    if (!rows.length || !vecs) break;
    await db.batch(rows.map((r, i): [string, ...unknown[]] => ["update knowledge_chunks set vec=vector32(?), embed_model=? where id=?", vecText(vecs[i]), EMBED_MODEL, r.id]));
    done += rows.length;
  }
  return { done, left: await staleChunks() };
}

/** Upserts a doc. Unchanged chunks (same hash) keep their vectors, so re-syncing only embeds what changed. Call embedMissing() once after a batch of docs. */
export async function addDoc(path: string, title: string, text: string, source = "upload", sourceRef: string | null = null) {
  path = normPath(path);
  if (!path) throw new Error("Empty path");
  const hashes = new Map(chunk(text).map((c) => [createHash("sha256").update(c).digest("hex"), c]));
  const w = await ws();
  await db.tx(async (tx) => {
    await tx.prepare(
      `insert into knowledge_docs (workspace_id,path,title,source,source_ref,updated) values (?,?,?,?,?,?)
       on conflict(workspace_id, path) do update set title=excluded.title, source=excluded.source, source_ref=excluded.source_ref, updated=excluded.updated`,
    ).run(w, path, title, source, sourceRef, Date.now());
    const doc = ((await tx.prepare("select id from knowledge_docs where workspace_id=? and path=?").get(w, path)) as { id: number }).id;
    const have = new Set<string>();
    for (const r of (await tx.prepare("select id, hash from knowledge_chunks where doc_id=?").all(doc)) as { id: number; hash: string }[]) {
      if (hashes.has(r.hash) && !have.has(r.hash)) have.add(r.hash);
      else await tx.prepare("delete from knowledge_chunks where id=?").run(r.id);
    }
    for (const [h, c] of hashes)
      if (!have.has(h)) {
        const { lastInsertRowid } = await tx.prepare("insert into knowledge_chunks (doc_id,hash,text) values (?,?,?)").run(doc, h, c);
        await tx.prepare("insert into knowledge_fts (rowid,text) values (?,?)").run(lastInsertRowid, c);
      }
  }); // chunks without a vector (no key, failed embed) stay searchable by keyword
}

// chunks go first so the FTS trigger runs even where foreign-key cascades are off
export const deleteDoc = async (id: number) => {
  const w = await ws();
  return db.batch([
    ["delete from knowledge_chunks where doc_id in (select id from knowledge_docs where id=? and workspace_id=?)", id, w],
    ["delete from knowledge_docs where id=? and workspace_id=?", id, w],
  ]);
};
export const deleteFolder = async (prefix: string) => {
  prefix = normPath(prefix);
  const where = "workspace_id = ? and (path = ? or path like ? escape '\\')";
  const args = [await ws(), prefix, like(prefix)];
  return db.batch([
    [`delete from knowledge_chunks where doc_id in (select id from knowledge_docs where ${where})`, ...args],
    [`delete from knowledge_docs where ${where}`, ...args],
  ]);
};

export type Doc = { id: number; path: string; title: string; source: string; source_ref: string | null; updated: number; chunks: number };
export const listDocs = async () =>
  (await db.prepare(
    "select d.*, (select count(*) from knowledge_chunks c where c.doc_id=d.id) chunks from knowledge_docs d where d.workspace_id=? order by d.path",
  ).all(await ws())) as Doc[];
export const staleChunks = async () =>
  ((await db.prepare(
    "select count(*) c from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where d.workspace_id=? and (c.vec is null or c.embed_model is not ?)",
  ).get(await ws(), EMBED_MODEL)) as { c: number }).c;

export type Hit = { path: string; title: string; text: string };

/** Top-k chunks by reciprocal rank fusion of keyword (bm25) and vector (cosine) rankings; keyword-only without embeddings. */
export async function search(query: string, folder = "", k = 4): Promise<Hit[]> {
  folder = normPath(folder);
  const scope = `and d.workspace_id = @w ${folder ? "and (d.path = @f or d.path like @l escape '\\')" : ""}`;
  const args = { w: await ws(), ...(folder ? { f: folder, l: like(folder) } : {}) };
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const lists: number[][] = [];
  if (terms.length)
    lists.push(
      (
        (await db.prepare(
          `select c.id from knowledge_fts f join knowledge_chunks c on c.id=f.rowid join knowledge_docs d on d.id=c.doc_id
           where knowledge_fts match @q ${scope} order by bm25(knowledge_fts) limit 20`,
        ).all({ ...args, q: terms.map((t) => `"${t}"`).join(" OR ") })) as { id: number }[]
      ).map((r) => r.id),
    );
  const qv = (await embed([query]))?.[0];
  if (qv)
    // exact cosine scan inside the database (vectors never leave it); rows without a vector from this model are skipped
    lists.push(
      (
        (await db.prepare(
          `select c.id from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where c.embed_model=@m ${scope}
           order by vector_distance_cos(c.vec, vector32(@v)) limit 20`,
        ).all({ ...args, m: EMBED_MODEL, v: vecText(qv) })) as { id: number }[]
      ).map((r) => r.id),
    );
  const rrf = new Map<number, number>();
  for (const l of lists) l.forEach((id, rank) => rrf.set(id, (rrf.get(id) ?? 0) + 1 / (60 + rank)));
  const top = [...rrf].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]);
  const get = db.prepare("select d.path, d.title, c.text from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where c.id=?");
  return Promise.all(top.map(async (id) => (await get.get(id)) as Hit));
}
