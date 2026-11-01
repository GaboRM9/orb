import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalize, rowSizes, spans } from "../lib/multiplex";

describe("multiplex", () => {
  it("normalizes a pod's panes: no junk, duplicates or more than 10; links only to other panes of the pod", () => {
    assert.deepEqual(normalize([{ id: "a1", agent: "assistant", sees: ["b2", "a1", "zz", "b2"] }, { id: "b2", agent: "bad agent" }, { id: "a1" }, { id: "../x" }]), [
      { id: "a1", agent: "assistant", sees: ["b2"] },
      { id: "b2" },
    ]);
    assert.equal(normalize(Array.from({ length: 12 }, (_, i) => ({ id: `t${i}` }))).length, 10);
  });

  it("splits panes into even rows that fill the screen", () => {
    const wide = (n: number) => rowSizes(n, 4).join("+");
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(wide), ["1", "2", "3", "2+2", "3+2", "3+3", "4+3", "4+4", "3+3+3", "4+3+3"]);
    assert.equal(rowSizes(5, 2).join("+"), "2+2+1");
    // every row adds up to the full 12 columns
    assert.deepEqual(spans(7, 4), [3, 3, 3, 3, 4, 4, 4]);
  });
});
