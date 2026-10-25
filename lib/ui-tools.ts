import { tool } from "ai";
import { z } from "zod";

// Render tools: the model fills the schema, execute echoes it back, the client draws a component.
const echo = async <T>(input: T) => input;

export const uiTools = {
  // Client tools: no execute. The chat renders UI, the user's answer goes back via addToolOutput.
  askUser: tool({
    description: "Show a form in the chat to collect several inputs from the user at once. Prefer this over asking in plain text.",
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
    description: "Ask the user to pick exactly one option (also use for confirm/deny with two options).",
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
  showCards: tool({
    description: "Show a grid of cards (itinerary days, options, products, results).",
    inputSchema: z.object({
      title: z.string(),
      cards: z.array(z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        body: z.string(),
        tag: z.string().optional(),
        price: z.string().optional(),
      })),
    }),
    execute: echo,
  }),
  showTable: tool({
    description: "Show tabular data. Every row has one string per column.",
    inputSchema: z.object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
    execute: echo,
  }),
  showChart: tool({
    description: "Show a simple horizontal bar chart of labeled numbers.",
    inputSchema: z.object({
      title: z.string(),
      unit: z.string().optional(),
      data: z.array(z.object({ label: z.string(), value: z.number() })),
    }),
    execute: echo,
  }),
  showTimeline: tool({
    description: "Show a vertical timeline of events (schedules, itineraries, histories).",
    inputSchema: z.object({
      title: z.string(),
      events: z.array(z.object({ when: z.string(), title: z.string(), detail: z.string().optional() })),
    }),
    execute: echo,
  }),
  showMap: tool({
    description: "Show a map with places. Provide accurate latitude/longitude for each place.",
    inputSchema: z.object({
      title: z.string(),
      places: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number(), note: z.string().optional() })).min(1),
    }),
    execute: echo,
  }),
};
