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
