import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const strings = locale => JSON.parse(read(`../src/locales/${locale}/ws.json`));

test("DESIGN.md terminology: English says «engine», never «runtime»; Chinese UI never shows «Runtime» (placeholders aside)", () => {
  const word = /(?<![{\w])runtimes?(?![\w}])/i;
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const offenders = Object.entries(strings(locale)).filter(([, value]) => word.test(value)).map(([key]) => key);
    assert.deepEqual(offenders, [], locale);
  }
  assert.equal(strings("en")["ws.settings.page.runtimes"], "Engines");
});

test("General is keyed by workspace and page, so «Copied» does not carry over to another workspace (review of #77)", () => {
  assert.match(read("../src/WorkspaceSettings.tsx"), /page === "general" \? <General key=\{key\} workspace=\{workspace\}/);
});

test("Chinese copy has no stray spaces around 引擎 next to Chinese characters (review of #94, M1)", () => {
  for (const locale of ["zh-Hans", "zh-Hant"]) {
    const offenders = Object.entries(strings(locale)).filter(([, value]) => /[一-鿿] 引擎|引擎 [一-鿿]/.test(value)).map(([key]) => key);
    assert.deepEqual(offenders, [], locale);
  }
});
