import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { z } from "zod";
import { uiTools } from "../lib/ui-tools";

const ok = (name: keyof typeof uiTools, input: unknown) => (uiTools[name].inputSchema as z.ZodType).safeParse(input).success;

const verdict = { headline: "Take the 9:40 train", reason: "Cheapest, and you arrive before 11:00", actions: [{ label: "Book the 9:40", prompt: "Book the 9:40 train" }] };
const options = { question: "Which train?", options: [{ title: "9:40", facts: ["€24"], recommended: true }, { title: "10:15", facts: ["€31"] }], actions: [] };

describe("answer formats", () => {
  it("accept a short answer", () => {
    assert.ok(ok("answerVerdict", verdict));
    assert.ok(ok("answerOptions", options));
  });

  it("refuse anything that would hold a paragraph", () => {
    assert.ok(!ok("answerVerdict", { ...verdict, reason: "x".repeat(141) }));
    assert.ok(!ok("answerVerdict", { ...verdict, headline: "x".repeat(81) }));
    assert.ok(!ok("answerOptions", { ...options, options: [{ title: "a", facts: ["x".repeat(41)] }, options.options[1]] }));
    assert.ok(!ok("answerOptions", { ...options, options: Array(5).fill(options.options[1]) }));
  });

  it("a verdict always offers a next step", () => {
    assert.ok(!ok("answerVerdict", { ...verdict, actions: [] }));
    assert.ok(!ok("answerVerdict", { ...verdict, actions: Array(4).fill(verdict.actions[0]) }));
  });

  it("evidence is exactly one known kind", () => {
    assert.ok(ok("answerVerdict", { ...verdict, evidence: { kind: "chart", title: "Fares", data: [{ label: "9:40", value: 24 }] } }));
    assert.ok(!ok("answerVerdict", { ...verdict, evidence: { kind: "html", title: "x" } }));
    assert.ok(!ok("answerVerdict", { ...verdict, evidence: { kind: "chart", title: "Fares" } })); // chart without its data
  });

  it("showCards is retired: Options covers it", () => {
    assert.ok(!("showCards" in uiTools));
  });
});

describe("clipOverlong", () => {
  const repair = async (toolName: string, input: unknown) => {
    const { clipOverlong } = await import("../lib/ui-tools");
    const { InvalidToolInputError } = await import("ai");
    const toolCall = { type: "tool-call" as const, toolCallId: "t1", toolName, input: JSON.stringify(input) };
    const error = new InvalidToolInputError({ toolName, toolInput: toolCall.input, cause: null });
    return clipOverlong({ toolCall, error, tools: {}, messages: [], instructions: undefined, system: undefined, inputSchema: async () => ({}) });
  };
  const options = (fact: string) => ({
    question: "Which flight route to Spain from Toronto?",
    options: [{ title: "Nonstop", facts: [fact] }, { title: "One stop", facts: ["Often cheaper"] }],
    actions: [],
  });

  it("clips the fact that made the model redo a whole answer (and the chat draw it twice)", async () => {
    const fixed = await repair("answerOptions", options("Common hubs: Paris, Frankfurt, Amsterdam, Lisbon"));
    const fact = JSON.parse(fixed!.input).options[0].facts[0] as string;
    assert.equal(fact.length, 40);
    assert.ok(fact.startsWith("Common hubs: Paris") && fact.endsWith("…"));
  });
  it("trims a list that's too long", async () => {
    const fixed = await repair("answerOptions", { ...options("ok"), actions: Array(5).fill({ label: "Go", prompt: "go" }) });
    assert.equal(JSON.parse(fixed!.input).actions.length, 3);
  });
  it("leaves any other mistake, and other tools, to fail as before", async () => {
    assert.equal(await repair("answerOptions", { question: "q", options: [{ title: "only one", facts: ["x"] }], actions: [] }), null); // too few options
    assert.equal(await repair("createSkill", { name: "x".repeat(500) }), null);
  });
});
