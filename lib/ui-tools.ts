import { tool } from "ai";
import { z } from "zod";

// Render tools: the model fills the schema, execute echoes it back, the client draws a component.
const echo = async <T>(input: T) => input;

// The data shapes behind the show* tools, reused as an answer's collapsed evidence
const table = { title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())) };
const chart = { title: z.string(), unit: z.string().optional(), data: z.array(z.object({ label: z.string(), value: z.number() })) };
const timeline = { title: z.string(), events: z.array(z.object({ when: z.string(), title: z.string(), detail: z.string().optional() })) };
const map = { title: z.string(), places: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number(), note: z.string().optional() })).min(1) };

const evidence = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("table"), ...table }),
    z.object({ kind: z.literal("chart"), ...chart }),
    z.object({ kind: z.literal("timeline"), ...timeline }),
    z.object({ kind: z.literal("map"), ...map }),
  ])
  .optional()
  .describe("Supporting detail, shown collapsed. Put the data here, never in prose.");

// The limits are the point: a field that can't hold a paragraph keeps the answer short.
const actions = z
  .array(z.object({
    label: z.string().max(32).describe("button text, a verb first: 'Book the 9:40'"),
    prompt: z.string().max(200).describe("sent as the user's next message when clicked"),
  }))
  .max(3)
  .describe("Next steps the user is likely to take");

export const uiTools = {
  answerVerdict: tool({
    description: "Give one clear answer: a decision, a recommendation, a yes/no, a key number, the gist of something. The default way to answer.",
    inputSchema: z.object({
      headline: z.string().max(80).describe("the answer itself, not a lead-in"),
      reason: z.string().max(140).describe("why, in one sentence"),
      caveat: z.string().max(100).optional().describe("only if it would change the user's decision"),
      evidence,
      actions: actions.min(1),
    }),
    execute: echo,
  }),
  answerOptions: tool({
    description: "Present 2–4 options for the user to choose between (products, routes, plans, approaches). Mark the one you'd pick. Your turn ends; the user's pick comes back as a message.",
    inputSchema: z.object({
      question: z.string().max(80),
      options: z.array(z.object({
        title: z.string().max(40),
        facts: z.array(z.string().max(40)).min(1).max(3).describe("the facts that tell options apart: price, time, trade-off"),
        recommended: z.boolean().optional(),
      })).min(2).max(4),
      evidence,
      actions,
    }),
    execute: echo,
  }),

  // Client tools: no execute. The chat renders UI, the user's answer goes back via addToolOutput.
  askUser: tool({
    description: "Show a form when you need several inputs from the user before you can continue.",
    inputSchema: z.object({
      title: z.string(),
      fields: z.array(z.object({
        name: z.string().describe("key in the answer, camelCase"),
        label: z.string(),
        type: z.enum(["text", "number", "select", "toggle", "slider", "date", "color"]),
        min: z.number().optional().describe("slider min"),
        max: z.number().optional().describe("slider max"),
        step: z.number().optional().describe("slider step"),
        options: z.array(z.string()).optional().describe("required for select"),
        placeholder: z.string().optional(),
      })).min(1).max(6),
    }),
    outputSchema: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }),
  choose: tool({
    description: "Pause to get a decision you need before you can continue (also confirm/deny). To recommend options and end your turn, use answerOptions instead.",
    inputSchema: z.object({
      question: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })).min(2).max(5),
    }),
    outputSchema: z.object({ id: z.string(), label: z.string() }),
  }),

  showPlan: tool({
    description: "Show a step checklist of what you are doing or will do. Statuses: todo, doing, done.",
    inputSchema: z.object({
      title: z.string(),
      steps: z.array(z.object({ title: z.string(), status: z.enum(["todo", "doing", "done"]) })),
    }),
    execute: echo,
  }),
  showTable: tool({ description: "Show tabular data on its own. Every row has one string per column.", inputSchema: z.object(table), execute: echo }),
  showChart: tool({ description: "Show a simple horizontal bar chart of labeled numbers on its own.", inputSchema: z.object(chart), execute: echo }),
  showTimeline: tool({ description: "Show a vertical timeline of events on its own (schedules, itineraries, histories).", inputSchema: z.object(timeline), execute: echo }),
  showMap: tool({ description: "Show a map with places on its own. Provide accurate latitude/longitude for each place.", inputSchema: z.object(map), execute: echo }),
};

// No longer offered to the model, still drawn in old chats
export const retiredUiTools = {
  showCards: tool({
    inputSchema: z.object({
      title: z.string(),
      cards: z.array(z.object({ title: z.string(), subtitle: z.string().optional(), body: z.string(), tag: z.string().optional(), price: z.string().optional() })),
    }),
    execute: echo,
  }),
};

export const UI_HINT = `How to answer:
- At most 2 sentences of plain text. Anything with structure goes into a UI tool, and never repeat a tool's content in prose.
- Answer with answerVerdict (one answer) or answerOptions (a choice). Put supporting data in their evidence, and end with actions the user would take next, instead of offering more help in prose.
- Use askUser or choose only when you can't continue without the user's input; showPlan for work in progress.
Recipes:
- "Which should I…" / "What are my options…" → answerOptions, a comparison table as evidence.
- "Should I…" / "Is it…" / "What's the best…" → answerVerdict with the call and why.
- "How is X doing" / numbers over time → answerVerdict with the headline number, a chart as evidence.`;
