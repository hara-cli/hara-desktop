import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isImeCompositionKey, sendsOnEnter } from "../src/ime.ts";

// Replays a recorded browser event sequence through the composer's keydown rule and counts sends.
const sends = events => events.filter(event => event.type === "keydown" && sendsOnEnter(event)).length;
const key = (key, extra = {}) => ({ type: "keydown", key, keyCode: key === "Enter" ? 13 : 65, isComposing: false, ...extra });
const composing = (key, extra = {}) => ({ type: "keydown", key, keyCode: 229, isComposing: true, ...extra });

test("English typed through a Chinese input method: the Enter that confirms the letters never sends (feedback 11-13)", () => {
  // Chrome/Electron/WebView2: the confirming Enter arrives while composing, keyCode 229.
  assert.equal(sends([{ type: "compositionstart" }, composing("h"), composing("i"), composing("Enter"), { type: "compositionend", data: "hi" }]), 0);
  // WebKit (Tauri on macOS): compositionend fires first, then a keydown with isComposing false but keyCode 229.
  assert.equal(sends([{ type: "compositionstart" }, composing("Process"), { type: "compositionend", data: "hi" }, key("Enter", { keyCode: 229 })]), 0);
  // Firefox: isComposing true with the real keyCode.
  assert.equal(sends([{ type: "compositionstart" }, composing("Enter", { keyCode: 13 }), { type: "compositionend", data: "hi" }]), 0);
});

test("after the candidate is confirmed, the next plain Enter sends once; Shift+Enter is a new line", () => {
  assert.equal(sends([{ type: "compositionstart" }, { type: "compositionend", data: "hi" }, key("Enter", { keyCode: 229 }), key("Enter")]), 1);
  assert.equal(sends([key("a"), key("Enter")]), 1);
  assert.equal(sends([key("Enter", { shiftKey: true })]), 0);
  assert.equal(isImeCompositionKey({ isComposing: false, keyCode: 13 }), false);
});

test("every workspace Enter handler uses the shared IME rule, not isComposing alone", () => {
  const files = ["WorkspaceLocalDev.tsx", "WorkspaceLocalChannels.tsx", "WorkspaceSidebarC.tsx"];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /!event\.nativeEvent\.isComposing/, `${file} checks isComposing alone`);
    for (const match of source.matchAll(/event\.key === "Enter"[^;{]*/g)) assert.match(match[0], /isImeCompositionKey\(event\.nativeEvent\)/, `${file}: ${match[0]}`);
  }
  const dev = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  assert.match(dev, /id="workspace-composer-input"[\s\S]*?onKeyDown=\{event => \{ if \(sendsOnEnter\(event\.nativeEvent\)\) \{ event\.preventDefault\(\); submitComposer\(\); \} \}\}/, "the colleague composer");
  assert.match(readFileSync(new URL("../src/WorkspaceLocalChannels.tsx", import.meta.url), "utf8"), /onKeyDown=\{event => \{ if \(sendsOnEnter\(event\.nativeEvent\)\) \{ event\.preventDefault\(\); if \(canSend\)/, "the group composer");
});

test("the legacy rename box and the model picker ignore keys while an IME is composing (review of #101, L1)", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /onKeyDown=\{\(e\) => \{\n\s+if \(isImeCompositionKey\(e\.nativeEvent\)\) return;\n\s+if \(e\.key === "Enter"\) void commitRename\(\);/);
  const combo = readFileSync(new URL("../src/ModelCombobox.tsx", import.meta.url), "utf8");
  assert.match(combo, /onKeyDown=\{\(event\) => \{\n\s+if \(isImeCompositionKey\(event\.nativeEvent\)\) return;\n\s+if \(event\.key === "ArrowDown"\)/);
});
