import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_THEME, luminance, parseTheme, themeStyle } from "../lib/theme";

describe("theme", () => {
  it("keeps valid knobs and drops anything that could escape a style attribute", () => {
    const t = parseTheme(JSON.stringify({ mode: "dark", paper: "#f6f1e7", ink: "red;background:url(x)", accent: "#3b5bdb", radius: 99, density: 0.9, font: "comic" }));
    assert.deepEqual(t, { ...DEFAULT_THEME, mode: "dark", paper: "#f6f1e7", accent: "#3b5bdb", density: 0.9 });
    assert.deepEqual(parseTheme("not json"), DEFAULT_THEME);
  });

  it("picks readable text on the accent", () => {
    assert.ok(luminance("#ffffff") > 0.99 && luminance("#000000") === 0);
    const on = (accent: string) => (themeStyle({ ...DEFAULT_THEME, accent }) as Record<string, unknown>)["--on-accent"];
    assert.equal(on("#3b5bdb"), "#fff");
    assert.equal(on("#ffd43b"), "#000");
    assert.equal(on(""), undefined); // no accent: CSS falls back to the background colour
  });
});
