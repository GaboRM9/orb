import { addDoc, embedMissing } from "./knowledge";

const TEXT = /\.(md|mdx|txt|rst)$/i;
const MAX_FILES = 200;

/** Imports a repo's docs (first 200 files) (md/txt) under `github/<repo>/…`. Fixed GitHub hosts only, so no SSRF surface; the token (private repos) is used once, never stored. */
export async function importGithub(repo: string, dir = "", token = "") {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some((x) => /^\.+$/.test(x))) throw new Error("Use owner/repo");
  dir = dir.replace(/^\/+|\/+$/g, "");
  const gh = (url: string, accept = "application/vnd.github+json") =>
    fetch(url, { headers: { accept, ...(token && { authorization: `Bearer ${token}` }) }, signal: AbortSignal.timeout(15000) });
  const tree = await gh(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`);
  if (!tree.ok) throw new Error(`GitHub: ${tree.status} (private repo? add a token)`);
  const { tree: all, truncated } = (await tree.json()) as { tree: { path: string; type: string; size?: number }[]; truncated?: boolean };
  const files = all
    .filter((f) => f.type === "blob" && TEXT.test(f.path) && (f.size ?? 0) < 500_000 && (!dir || f.path.startsWith(dir + "/")))
    .slice(0, MAX_FILES);
  let n = 0;
  for (let i = 0; i < files.length; i += 5)
    await Promise.all(
      files.slice(i, i + 5).map(async (f) => {
        const r = await gh(`https://api.github.com/repos/${repo}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}`, "application/vnd.github.raw+json");
        if (!r.ok) return;
        addDoc(`github/${repo.split("/")[1]}/${f.path}`, f.path.split("/").pop()!, await r.text(), "github", `${repo}${dir && `/${dir}`}`);
        n++;
      }),
    );
  await embedMissing(); // once, after all docs, so chunks are batched
  return { n, truncated: !!truncated || all.filter((f) => f.type === "blob" && TEXT.test(f.path)).length > MAX_FILES };
}
