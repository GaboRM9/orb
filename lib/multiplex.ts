// A pod's panes and their layout; client-safe (lib/pods.ts saves them)
// A pane's `sees` lists the panes of the same pod its agent may read (readPane): one-way, off by default.
export const MAX_PANES = 10;
export type Pane = { id: string; agent?: string; sees?: string[] };
export type Pod = { id: string; title: string | null; goal: string | null; panes: Pane[]; updated: number };

const ID = /^[\w-]{1,64}$/;
/** Drops junk ids, duplicates and anything past 10; a pane only sees other panes of this pod. */
export function normalize(panes: Pane[]): Pane[] {
  const seen = new Set<string>();
  const kept = panes.filter((p) => typeof p?.id === "string" && ID.test(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, MAX_PANES);
  const ids = new Set(kept.map((p) => p.id));
  return kept.map(({ id, agent, sees }) => {
    const s = [...new Set(Array.isArray(sees) ? sees : [])].filter((x) => x !== id && ids.has(x));
    return { id, ...(typeof agent === "string" && ID.test(agent) ? { agent } : {}), ...(s.length ? { sees: s } : {}) };
  });
}

/** Panes per row: rows as even as possible, the top rows take the extra one. Wide screens: ≤3 one row, ≤8 two, else three. */
export function rowSizes(n: number, maxCols: number) {
  const rows = maxCols >= 4 ? (n <= 3 ? 1 : n <= 8 ? 2 : 3) : Math.ceil(n / maxCols);
  return Array.from({ length: rows }, (_, i) => Math.floor(n / rows) + (i < n % rows ? 1 : 0));
}

/** Each pane's width in a 12-column grid (12 = lcm of 1–4 per row), in order. */
export const spans = (n: number, maxCols: number) => rowSizes(n, maxCols).flatMap((k) => Array<number>(k).fill(12 / k));
