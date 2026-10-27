import { tool, type Tool } from "ai";
import type { z } from "zod";

/**
 * A surface is a small app the agent opens: the model fills `params`, the server runs `fetch`, the chat draws the view
 * (registered by name in components/surfaces). It mirrors MCP Apps: the open_<name> tool is model-visible, the refresh
 * endpoint is the app-visible side, and `summary` is all the model ever sees of the data.
 */
export type Surface<P extends z.ZodObject = z.ZodObject, D = unknown> = {
  name: string;
  title: string;
  when: string; // when the model should open it
  params: P;
  fetch: (params: z.infer<P>) => Promise<D>;
  summary: (params: z.infer<P>, data: D) => string;
};
export type SurfaceResult<D = unknown> = { params: unknown; data: D; summary: string };

export const defineSurface = <P extends z.ZodObject, D>(s: Surface<P, D>) => s as unknown as Surface;

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

export const surfaces: Record<string, Surface> = {};

export const surfaceTools = () => Object.fromEntries(Object.values(surfaces).map((s) => [`${SURFACE_PREFIX}${s.name}`, surfaceTool(s)]));
