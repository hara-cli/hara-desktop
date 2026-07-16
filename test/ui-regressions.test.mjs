import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("rail buttons reset global padding so navigation SVGs cannot collapse into dots", () => {
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const railButton = css.match(/\.rail button \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const railSvg = css.match(/\.rail button > svg \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(railButton, /padding:\s*0\s*;/);
  assert.match(railButton, /flex:\s*0\s+0\s+34px\s*;/);
  assert.match(railButton, /color:\s*#d0cdc6\s*;/);
  assert.match(railSvg, /flex:\s*0\s+0\s+auto\s*;/);
});
