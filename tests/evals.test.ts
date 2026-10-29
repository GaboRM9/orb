import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missedTool, newlyFailing } from "../lib/evals";

describe("evals", () => {
  it("flags only cases that passed last run and fail now", () => {
    const prev = [{ case_id: 1, pass: 1 }, { case_id: 2, pass: 0 }, { case_id: 3, pass: 1 }];
    const cur = [{ case_id: 1, pass: 0 }, { case_id: 2, pass: 0 }, { case_id: 3, pass: 1 }, { case_id: 4, pass: 0 }];
    assert.deepEqual([...newlyFailing(cur, prev)], [1]); // 2 was already failing, 4 is new
    assert.equal(newlyFailing(cur, []).size, 0); // first run: nothing to compare
  });

  it("fails a case that names a tool the agent never called", () => {
    assert.equal(missedTool("calculate", ["getTime"]), "Didn't use calculate.");
    assert.equal(missedTool("calculate", ["getTime", "calculate"]), null);
    assert.equal(missedTool(null, []), null);
  });
});
