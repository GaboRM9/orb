import { tool, type Tool } from "ai";
import { z } from "zod";
import { db, getSetting, listSkills } from "./db";
import { safeFetchText } from "./net-safe";
import { uiTools } from "./ui-tools";

export const allTools = {
  getTime: tool({
    description: "Get the current date and time.",
    inputSchema: z.object({ timeZone: z.string().optional().describe("IANA zone, e.g. America/Merida") }),
    execute: async ({ timeZone }) => new Date().toLocaleString("en-US", { timeZone, timeZoneName: "short" }),
  }),
  calculate: tool({
    description: "Evaluate a basic arithmetic expression (+ - * / % parentheses).",
    inputSchema: z.object({ expression: z.string() }),
    execute: async ({ expression }) => {
      // ponytail: whitelist + Function instead of a parser; swap for mathjs if more syntax is needed
      if (!/^[\d\s+\-*/%().]+$/.test(expression)) throw new Error("Unsupported characters");
      return Number(Function(`"use strict";return (${expression})`)());
    },
  }),
  fetchUrl: tool({
    description: "Fetch a URL and return the first 2000 characters of its text.",
    inputSchema: z.object({ url: z.url() }),
    execute: async ({ url }) => safeFetchText(url),
  }),
  searchThreads: tool({
    description: "Search the titles of the user's saved chat threads.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) =>
      db.prepare("select id,title from threads where title like ? limit 10").all(`%${query}%`),
  }),
};

/** Built-in tools with outbound side effects: the user approves each call in the chat (MCP tools always do). */
export const APPROVAL_TOOLS = new Set<string>(["fetchUrl"]);

export const toolNames = Object.keys(allTools) as (keyof typeof allTools)[];
export const disabledTools = (): string[] => JSON.parse(getSetting("tools_disabled", "[]"));

/** Enabled demo tools + `loadSkill`, which lazily returns a skill's full body. */
export function activeTools(only?: { tools: string[]; skills: string[] }) {
  const off = new Set(only ? toolNames.filter((n) => !only.tools.includes(n)) : disabledTools());
  const tools: Record<string, Tool> = {
    ...Object.fromEntries(Object.entries(allTools).filter(([k]) => !off.has(k))),
    ...uiTools,
  };
  const skills = listSkills().filter((s) => s.enabled && (!only || only.skills.includes(s.name)));
  if (skills.length) tools.loadSkill = loadSkill(skills.map((s) => s.name));
  return { tools, skills };
}

function loadSkill(names: string[]) {
  return tool({
    description: "Load the full instructions of a skill by name before applying it.",
    inputSchema: z.object({ name: z.enum(names as [string, ...string[]]) }),
    execute: async ({ name }) => listSkills().find((s) => s.name === name)?.body ?? "not found",
  });
}
