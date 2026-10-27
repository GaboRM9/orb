import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { open, seal } from "../lib/secret";

process.env.ADMIN_PASSWORD = "test-pass";

describe("secret", () => {
  it("round-trips and does not store plaintext", () => {
    const s = seal("sk-ant-123");
    assert.ok(!s.includes("sk-ant-123"));
    assert.equal(open(s), "sk-ant-123");
  });
  it("passes legacy plaintext through", () => assert.equal(open("sk-ant-old"), "sk-ant-old"));
  it("returns null for tampered values or a changed secret", () => {
    const s = seal("x");
    assert.equal(open(s.slice(0, -2) + "AA"), null);
    process.env.ADMIN_PASSWORD = "other";
    assert.equal(open(s), null);
    process.env.ADMIN_PASSWORD = "test-pass";
  });
});
