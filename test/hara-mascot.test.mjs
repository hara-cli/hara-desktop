import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MASCOT_STATES, mascotDataUri, mascotSize, mascotStateForWaitPhase, mascotSvgIsSafe, mascotVariantForSize } from "../src/hara-mascot.ts";
import { makeT } from "../src/i18n.ts";
import { MASCOT_SVG } from "../src/generated/hara-mascot-assets.ts";
import { mascotAssetsModule } from "../scripts/build-mascot-assets.mjs";

const dir = new URL("../src/assets/mascot/", import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), "utf8");

test("every state ships a full-body and a face asset, and none of them can execute", () => {
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, MASCOT_STATES.flatMap(state => [`hara-gate-${state}.svg`, `hara-gate-face-${state}.svg`]).sort());
  for (const file of files) {
    const raw = read(file);
    assert.ok(mascotSvgIsSafe(raw), file);
    assert.ok(raw.length < 3 * 1024, `${file} stays under 3 KB`);
    assert.match(raw, /prefers-reduced-motion:reduce/, `${file} follows reduce motion`);
  }
});

test("unsafe markup is refused instead of rendered", () => {
  for (const raw of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="https://x">a</a></svg>', '<svg><foreignObject/></svg>', '<html></html>']) {
    assert.equal(mascotSvgIsSafe(raw), false, raw);
    assert.equal(mascotDataUri(raw, { dark: false, still: false }), "");
  }
});

test("progress phases map onto the six states", () => {
  const cases = { idle: "idle", cancelled: "idle", preparing: "think", queued: "think", spawn: "think", recovering: "think", thinking: "think", unknown: "think",
    tool: "work", output: "work", finalizing: "work", question: "wait", approval: "wait", completed: "done", failed: "error" };
  for (const [phase, state] of Object.entries(cases)) assert.equal(mascotStateForWaitPhase(phase), state, phase);
});

test("small sizes fall back to the face and respect the minimums", () => {
  assert.equal(mascotVariantForSize("full", 24), "face");
  assert.equal(mascotVariantForSize("full", 48), "full");
  assert.equal(mascotSize("face", 10), 16);
  assert.equal(mascotSize("full", 128), 128);
});

test("dark adds the 18% white edge; motion off removes animation; the light asset is unchanged", () => {
  const raw = read("hara-gate-idle.svg");
  const decode = (uri) => decodeURIComponent(uri.replace("data:image/svg+xml;charset=utf-8,", ""));
  const light = decode(mascotDataUri(raw, { dark: false, still: false }));
  assert.match(light, /var\(--hm-edge,transparent\)/);
  assert.doesNotMatch(light, /<style>\*\{animation:none/);
  const dark = decode(mascotDataUri(raw, { dark: true, still: true }));
  assert.match(dark, /var\(--hm-edge,rgba\(255,255,255,\.18\)\)/);
  assert.match(dark, /<style>\*\{animation:none!important\}/);
  assert.doesNotMatch(dark, /aria-label/);
});

test("alt text exists for every state in English, Simplified and Traditional Chinese", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const state of MASCOT_STATES) {
      const text = t(`ws.mascot.${state}`);
      assert.ok(text && !text.startsWith("ws.mascot."), `${locale} ${state}`);
    }
  }
});

test("the generated asset module matches the SVG sources", () => {
  assert.equal(readFileSync(new URL("../src/generated/hara-mascot-assets.ts", import.meta.url), "utf8"), mascotAssetsModule(),
    "run node scripts/build-mascot-assets.mjs");
  assert.equal(Object.keys(MASCOT_SVG).length, 12);
});
