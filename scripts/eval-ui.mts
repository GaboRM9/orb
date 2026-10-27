// How concise and actionable are answers? Runs fixed prompts with the old and the new answer rules and prints,
// per prompt: words of plain text, the UI tools used, whether the answer ends in actions, and rejected tool calls.
// Costs real tokens: run it by hand with `npx tsx scripts/eval-ui.mts` (key from Settings or ANTHROPIC_API_KEY).
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, type Tool } from "ai";
import { getSetting } from "../lib/db";
import { DEFAULT_MODEL } from "../lib/models";
import { open } from "../lib/secret";
import { retiredUiTools, UI_HINT, uiTools } from "../lib/ui-tools";

const prompts = [
  "Which laptop should I get for coding under $1500: MacBook Air M4, ThinkPad X1 Carbon, or Dell XPS 14?",
  "Should I learn Rust or Go first as a backend developer?",
  "What are my options for getting from Madrid to Lisbon?",
  "Is it worth refinancing a 6.8% mortgage now?",
  "How has the S&P 500 done over the last 5 years? Rough yearly numbers are fine.",
  "Compare Postgres, MySQL and SQLite for a small SaaS.",
  "What's the best time of year to visit Japan?",
  "Plan a 3-day weekend in Mexico City for food lovers.",
  "Should I use Tailwind or CSS modules for a new Next.js app?",
  "Explain the difference between a Roth IRA and a traditional IRA.",
];

// main's prompt and tool set, so one run gives the before/after
const OLD_HINT = "UI tools: use askUser for forms, choose for single-choice/confirm, showPlan for checklists, showCards/showTable/showChart to present structured results. Prefer them over plain text, and do not repeat their content in prose.";
const { answerVerdict, answerOptions, ...kept } = uiTools;
void answerVerdict; void answerOptions;
const variants: [string, string, Record<string, Tool>][] = [
  ["old", OLD_HINT, { ...kept, ...retiredUiTools }],
  ["new", UI_HINT, uiTools],
];

const apiKey = open(await getSetting("api_key")) || process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set your Anthropic API key in Settings or ANTHROPIC_API_KEY.");
const model = createAnthropic({ apiKey })(await getSetting("model", DEFAULT_MODEL));

type Row = { variant: string; prompt: number; words: number; tools: string; actions: boolean; rejected: number };
const rows: Row[] = [];
for (const [variant, hint, tools] of variants)
  for (const [n, prompt] of prompts.entries()) {
    const r = await generateText({ model, system: `You are a helpful, concise assistant.\n\n${hint}`, prompt, tools, stopWhen: isStepCount(4) });
    const calls = r.steps.flatMap((s) => s.toolCalls);
    const content = r.steps.flatMap((s) => s.content) as { type: string }[];
    rows.push({
      variant,
      prompt: n + 1,
      words: r.steps.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean).length,
      tools: [...new Set(calls.map((c) => c.toolName))].join(",") || "-",
      actions: calls.some((c) => ((c.input as { actions?: unknown[] })?.actions?.length ?? 0) > 0),
      rejected: content.filter((c) => c.type === "tool-error").length,
    });
    console.error(`${variant} ${n + 1}/${prompts.length}`);
  }

console.table(rows);
for (const [variant] of variants) {
  const v = rows.filter((r) => r.variant === variant);
  const median = v.map((r) => r.words).sort((a, b) => a - b)[Math.floor(v.length / 2)];
  console.log(`${variant}: median ${median} words of prose · ${v.filter((r) => r.actions).length}/${v.length} end in actions · ${v.reduce((s, r) => s + r.rejected, 0)} rejected calls`);
}
