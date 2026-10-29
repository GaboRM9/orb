import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chatHref, formatPanes, panesOf, parsePanes, rowSizes, spans } from "../lib/multiplex";

describe("multiplex", () => {
  it("parses the pane list, dropping junk, duplicates and anything past 10", () => {
    assert.deepEqual(parsePanes("a1.assistant,b2,a1,../x,c3.bad agent"), [{ id: "a1", agent: "assistant" }, { id: "b2", agent: undefined }]);
    assert.equal(parsePanes(Array.from({ length: 12 }, (_, i) => `t${i}`).join(",")).length, 10);
    assert.deepEqual(parsePanes(undefined), []);
    assert.equal(formatPanes(parsePanes("a1.assistant,b2")), "a1.assistant,b2");
  });

  it("round-trips a split chat through its URL", () => {
    assert.equal(chatHref(panesOf("a1", null, null)), "/chat/a1");
    assert.equal(chatHref(panesOf("a1", "assistant", "b2.writer,c3")), "/chat/a1?agent=assistant&with=b2.writer,c3");
    assert.equal(chatHref(panesOf("a1", null, "a1,b2")), "/chat/a1?with=b2"); // the chat itself can't be split off twice
  });

  it("splits panes into even rows that fill the screen", () => {
    const wide = (n: number) => rowSizes(n, 4).join("+");
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(wide), ["1", "2", "3", "2+2", "3+2", "3+3", "4+3", "4+4", "3+3+3", "4+3+3"]);
    assert.equal(rowSizes(5, 2).join("+"), "2+2+1");
    // every row adds up to the full 12 columns
    assert.deepEqual(spans(7, 4), [3, 3, 3, 3, 4, 4, 4]);
  });
});
