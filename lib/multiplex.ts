// A split chat lives in its URL: /chat/a?agent=x&with=b.agentId,c,… (an agent only matters for a thread with no history yet)
export const MAX_PANES = 10;
export type Pane = { id: string; agent?: string };

const ID = /^[\w-]{1,64}$/;
export function parsePanes(p: unknown): Pane[] {
  const seen = new Set<string>();
  return String(p ?? "")
    .split(",")
    .flatMap((s) => {
      const [id, agent] = s.split(".");
      if (!ID.test(id) || seen.has(id) || (agent && !ID.test(agent))) return [];
      seen.add(id);
      return [{ id, agent: agent || undefined }];
    })
    .slice(0, MAX_PANES);
}
export const formatPanes = (ps: Pane[]) => ps.map((p) => (p.agent ? `${p.id}.${p.agent}` : p.id)).join(",");

/** The panes of /chat/[id]: that chat first, then the ones split off beside it. */
export const panesOf = (id: string, agent?: string | null, more?: string | null) => parsePanes([agent ? `${id}.${agent}` : id, more].join(","));
export function chatHref([first, ...rest]: Pane[]) {
  const q = [first.agent && `agent=${first.agent}`, rest.length && `with=${formatPanes(rest)}`].filter(Boolean).join("&");
  return `/chat/${first.id}${q ? `?${q}` : ""}`;
}

/** Panes per row: rows as even as possible, the top rows take the extra one. Wide screens: ≤3 one row, ≤8 two, else three. */
export function rowSizes(n: number, maxCols: number) {
  const rows = maxCols >= 4 ? (n <= 3 ? 1 : n <= 8 ? 2 : 3) : Math.ceil(n / maxCols);
  return Array.from({ length: rows }, (_, i) => Math.floor(n / rows) + (i < n % rows ? 1 : 0));
}

/** Each pane's width in a 12-column grid (12 = lcm of 1–4 per row), in order. */
export const spans = (n: number, maxCols: number) => rowSizes(n, maxCols).flatMap((k) => Array<number>(k).fill(12 / k));
