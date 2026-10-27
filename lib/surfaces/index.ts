import { tool, type Tool } from "ai";
import type { Surface, SurfaceResult } from "./define";
import { directions } from "./directions";

export { defineSurface, type Surface, type SurfaceResult } from "./define";

// a surface's data is saved with the message and sent to the browser; a runaway response must not bloat every reload
const MAX_BYTES = 200_000;

/** Validates params, fetches, and checks the size: shared by the model's tool call and the view's refresh. */
export async function runSurface(s: Surface, raw: unknown): Promise<SurfaceResult> {
  const params = s.params.parse(raw);
  const data = await s.fetch(params);
  if (JSON.stringify(data).length > MAX_BYTES) throw new Error(`${s.title} returned too much data`);
  return { params, data, summary: s.summary(params, data) };
}

export const SURFACE_PREFIX = "open_";

export const surfaceTool = (s: Surface): Tool =>
  tool({
    description: `Open ${s.title}: ${s.when}. It shows live, interactive results the user can adjust; don't repeat them in prose.`,
    inputSchema: s.params,
    execute: (params) => runSurface(s, params),
    toModelOutput: ({ output }) => ({ type: "text", value: (output as SurfaceResult).summary }), // the model gets the summary, the view gets the data
  });

export const surfaces: Record<string, Surface> = { directions };

export const surfaceTools = () => Object.fromEntries(Object.values(surfaces).map((s) => [`${SURFACE_PREFIX}${s.name}`, surfaceTool(s)]));
