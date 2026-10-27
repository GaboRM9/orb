export const MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
export const DEFAULT_MODEL = "claude-sonnet-5-5";

// USD per million tokens, Anthropic list prices (2026-10). Cache writes (5 min TTL) cost 1.25x input.
// ponytail: Haiku's cache-read rate is assumed at 0.1x input, and its >100k-token prompt tier ($0.50/$2.50) is ignored
const PRICES: Record<string, { in: number; out: number; read: number }> = {
  "claude-fable-5-1": { in: 10, out: 50, read: 0.25 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, read: 0.01 },
};

export type Usage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } };

/** Dollar cost of one run; null for a model without a known price. `inputTokens` counts cached tokens too, so split it by the details. */
export function runCost(model: string, u: Usage) {
  const p = PRICES[model];
  if (!p) return null;
  const read = u.inputTokenDetails?.cacheReadTokens ?? 0;
  const write = u.inputTokenDetails?.cacheWriteTokens ?? 0;
  const fresh = u.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - read - write);
  return (fresh * p.in + write * p.in * 1.25 + read * p.read + (u.outputTokens ?? 0) * p.out) / 1e6;
}
