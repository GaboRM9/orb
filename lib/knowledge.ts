import { createHash } from "node:crypto";
import { db, getSetting } from "./db";
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

const apiKey = () => open(getSetting("openai_key")) || process.env.OPENAI_API_KEY || "";
export const hasEmbeddingKey = () => !!apiKey();

/** One embedding per input, or null if there is no key or the call fails (callers fall back to keyword search). */
export async function embed(texts: string[]): Promise<Float32Array[] | null> {
  const key = apiKey();
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

const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Buffer) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); // copy: pool offsets can be unaligned

let running: Promise<{ done: number; left: number }> | null = null;
/** Embeds chunks that have no vector (or one from another model). Stops at the first failed batch; overlapping calls share one run so nothing is embedded twice. */
export const embedMissing = () => (running ??= embedAll().finally(() => (running = null)));

async function embedAll(): Promise<{ done: number; left: number }> {
  const todo = () => db.prepare("select id, text from knowledge_chunks where vec is null or embed_model is not ? limit ?");
  let done = 0;
  for (;;) {
    const rows = todo().all(EMBED_MODEL, BATCH) as { id: number; text: string }[];
    const vecs = await embed(rows.map((r) => r.text));
    if (!rows.length || !vecs) break;
    const upd = db.prepare("update knowledge_chunks set vec=?, embed_model=? where id=?");
    db.transaction(() => rows.forEach((r, i) => upd.run(toBlob(vecs[i]), EMBED_MODEL, r.id)))();
    done += rows.length;
  }
  return { done, left: (db.prepare("select count(*) c from knowledge_chunks where vec is null or embed_model is not ?").get(EMBED_MODEL) as { c: number }).c };
}

/** Upserts a doc. Unchanged chunks (same hash) keep their vectors, so re-syncing only embeds what changed. Call embedMissing() once after a batch of docs. */
export function addDoc(path: string, title: string, text: string, source = "upload", sourceRef: string | null = null) {
  path = normPath(path);
  if (!path) throw new Error("Empty path");
  const hashes = new Map(chunk(text).map((c) => [createHash("sha256").update(c).digest("hex"), c]));
  db.transaction(() => {
    db.prepare(
      `insert into knowledge_docs (path,title,source,source_ref,updated) values (?,?,?,?,?)
       on conflict(path) do update set title=excluded.title, source=excluded.source, source_ref=excluded.source_ref, updated=excluded.updated`,
    ).run(path, title, source, sourceRef, Date.now());
    const doc = (db.prepare("select id from knowledge_docs where path=?").get(path) as { id: number }).id;
    const have = new Set<string>();
    const del = db.prepare("delete from knowledge_chunks where id=?");
    for (const r of db.prepare("select id, hash from knowledge_chunks where doc_id=?").all(doc) as { id: number; hash: string }[]) {
      if (hashes.has(r.hash) && !have.has(r.hash)) have.add(r.hash);
      else del.run(r.id);
    }
    const ins = db.prepare("insert into knowledge_chunks (doc_id,hash,text) values (?,?,?)");
    const fts = db.prepare("insert into knowledge_fts (rowid,text) values (?,?)");
    for (const [h, c] of hashes) if (!have.has(h)) fts.run(ins.run(doc, h, c).lastInsertRowid, c);
  })(); // chunks without a vector (no key, failed embed) stay searchable by keyword
}

export const deleteDoc = (id: number) => db.prepare("delete from knowledge_docs where id=?").run(id);
export const deleteFolder = (prefix: string) => {
  prefix = normPath(prefix);
  db.prepare("delete from knowledge_docs where path = ? or path like ? escape '\\'").run(prefix, like(prefix));
};

export type Doc = { id: number; path: string; title: string; source: string; source_ref: string | null; updated: number; chunks: number };
export const listDocs = () =>
  db.prepare(
    "select d.*, (select count(*) from knowledge_chunks c where c.doc_id=d.id) chunks from knowledge_docs d order by d.path",
  ).all() as Doc[];
export const staleChunks = () =>
  (db.prepare("select count(*) c from knowledge_chunks where vec is null or embed_model is not ?").get(EMBED_MODEL) as { c: number }).c;

export type Hit = { path: string; title: string; text: string };

/** Top-k chunks by reciprocal rank fusion of keyword (bm25) and vector (cosine) rankings; keyword-only without embeddings. */
export async function search(query: string, folder = "", k = 4): Promise<Hit[]> {
  folder = normPath(folder);
  const scope = folder ? "and (d.path = @f or d.path like @l escape '\\')" : "";
  const args = folder ? { f: folder, l: like(folder) } : {};
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const lists: number[][] = [];
  if (terms.length)
    lists.push(
      (
        db.prepare(
          `select c.id from knowledge_fts f join knowledge_chunks c on c.id=f.rowid join knowledge_docs d on d.id=c.doc_id
           where knowledge_fts match @q ${scope} order by bm25(knowledge_fts) limit 20`,
        ).all({ ...args, q: terms.map((t) => `"${t}"`).join(" OR ") }) as { id: number }[]
      ).map((r) => r.id),
    );
  const qv = (await embed([query]))?.[0];
  if (qv) {
    // ponytail: linear scan, streamed so memory stays flat (~180ms at 50k chunks); vectors are unit length so dot = cosine. Swap for sqlite-vec past ~100k chunks.
    const scored: [number, number][] = [];
    const rows = db.prepare(
      `select c.id, c.vec from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where c.embed_model=@m ${scope}`,
    ).iterate({ ...args, m: EMBED_MODEL }) as Iterable<{ id: number; vec: Buffer }>;
    for (const r of rows) {
      const v = fromBlob(r.vec);
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * qv[i];
      scored.push([r.id, dot]);
    }
    lists.push(scored.sort((a, b) => b[1] - a[1]).slice(0, 20).map((s) => s[0]));
  }
  const rrf = new Map<number, number>();
  for (const l of lists) l.forEach((id, rank) => rrf.set(id, (rrf.get(id) ?? 0) + 1 / (60 + rank)));
  const top = [...rrf].sort((a, b) => b[1] - a[1]).slice(0, k).map((e) => e[0]);
  const get = db.prepare("select d.path, d.title, c.text from knowledge_chunks c join knowledge_docs d on d.id=c.doc_id where c.id=?");
  return top.map((id) => get.get(id) as Hit);
}
