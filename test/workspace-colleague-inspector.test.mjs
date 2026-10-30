import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceColleagueInspector.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("right inspector renders only schedules owned by the selected colleague", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "idle", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "pi", label: "Pi", available: true } };
  const features = { revision: 2, workspaceId: "fixture", skills: [], schedules: [
    { id: "dora-9", agentId: "dora", name: "Visual summary", enabled: true, schedule: { kind: "cron", expr: "0 9 * * 1-5" }, tz: "Asia/Taipei", task: "Summarize visuals" },
    { id: "elon-8", agentId: "elon", name: "Private other colleague schedule", enabled: true, schedule: { kind: "cron", expr: "0 8 * * *" }, task: "Another task" },
  ], scheduler: { schedules: [] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, features, locale: "zh-Hans", error: "", inert: false, supported: true,
    onClose() {}, onRefresh() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.match(html, /Dora · 同事管理/);
  assert.match(html, /Visual summary/);
  assert.doesNotMatch(html, /Private other colleague schedule|Another task/);
  assert.match(html, /本同事|定时/);
});
