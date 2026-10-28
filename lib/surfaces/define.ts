import type { z } from "zod";

/**
 * A surface is a small app the agent opens: the model fills `params`, the server runs `fetch`, the chat draws the view
 * (registered by name in components/surfaces). It mirrors MCP Apps: open({ t: name }) is model-visible, the refresh
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
