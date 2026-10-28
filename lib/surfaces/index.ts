import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Surface, SurfaceResult } from "./define";
import { directions } from "./directions";

export { defineSurface, type Surface, type SurfaceResult } from "./define";

// a surface's data is saved with the message and sent to the browser; a runaway response must not bloat every reload
const MAX_BYTES = 200_000;

/** Validates params, fetches, and checks the size: shared by the model's tool call and the view's refresh. */
export async function runSurface(s: Surface, raw: unknown): Promise<SurfaceResult> {
  const ok = s.params.safeParse(raw);
  if (!ok.success) throw new Error(z.prettifyError(ok.error)); // readable, so the model can fix its call
  const params = ok.data;
  const data = await s.fetch(params);
  if (JSON.stringify(data).length > MAX_BYTES) throw new Error(`${s.title} returned too much data`);
  return { params, data, summary: s.summary(params, data) };
}

export const surfaces: Record<string, Surface> = { directions };

const summaryOnly = ({ output }: { output: unknown }) => ({ type: "text" as const, value: (output as SurfaceResult).summary }); // the model gets the summary, the view gets the data

/** "directions(from, to, mode?=walk|bike|drive)": a template's call shape, read off its schema so it can't drift. */
export function signature(s: Surface) {
  const j = z.toJSONSchema(s.params, { io: "input" }) as { properties?: Record<string, { enum?: unknown[] }>; required?: string[] };
  const args = Object.entries(j.properties ?? {}).map(([k, p]) => `${k}${j.required?.includes(k) ? "" : "?"}${p.enum ? `=${p.enum.join("|")}` : ""}`);
  return `${s.name}(${args.join(", ")})`;
}
export const catalog = () => Object.values(surfaces).map((s) => `- ${signature(s)}: ${s.when}`).join("\n");

/**
 * One tool for every template: a catalog line each costs far fewer tokens than a full tool schema each, and the model
 * only writes {t, p}. p is checked against the template's own schema in runSurface; a bad call gets the error back.
 */
export const openTool = (): Tool =>
  tool({
    description: `Open a template: a live view the user can adjust, filled with fresh data. t is the template, p its params. Templates:\n${catalog()}`,
    inputSchema: z.object({ t: z.enum(Object.keys(surfaces) as [string, ...string[]]), p: z.record(z.string(), z.unknown()).default({}) }),
    execute: ({ t, p }) => runSurface(surfaces[t], p),
    toModelOutput: summaryOnly,
  });

// Before `open`, each surface was its own open_<name> tool. Old chats still hold those calls: these turn them into summaries.
export const legacySurfaceTools = () =>
  Object.fromEntries(Object.values(surfaces).map((s) => [`open_${s.name}`, tool({ inputSchema: s.params, toModelOutput: summaryOnly })]));
