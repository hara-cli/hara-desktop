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
const groupBundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceGroupInspector.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "empty" }, write: false });
const groupModule = { exports: {} };
new Function("require", "module", "exports", groupBundle.outputFiles[0].text)(require, groupModule, groupModule.exports);

test("right inspector renders only schedules owned by the selected colleague", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "idle", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "pi", label: "Pi", available: true } };
  const features = { revision: 2, workspaceId: "fixture", skills: [], schedules: [
    { id: "dora-9", agentId: "dora", name: "Visual summary", enabled: true, schedule: { kind: "cron", expr: "0 9 * * 1-5" }, tz: "Asia/Taipei", task: "Summarize visuals" },
    { id: "elon-8", agentId: "elon", name: "Private other colleague schedule", enabled: true, schedule: { kind: "cron", expr: "0 8 * * *" }, task: "Another task" },
  ], scheduler: { schedules: [] } };
  const workspace = { runtimeOptions: [{ id: "pi", label: "Pi", available: true, recommended: true }, { id: "opencode", label: "OpenCode", available: false, reason: "adapter_pending_p05", recommended: false }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "sonnet" }] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features, locale: "zh-Hans", error: "", inert: false, supported: true,
    onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] }),
    async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.match(html, /Dora · 管理/);
  assert.match(html, /Runtime/);
  assert.match(html, /Apply Runtime|应用 Runtime/);
  assert.doesNotMatch(html, /sonnet|Open Runtime settings|Open model settings|管理本机引擎/);
  assert.match(html, /Visual summary/);
  assert.doesNotMatch(html, /Private other colleague schedule|Another task/);
  assert.match(html, /本同事|定时/);
});

test("main Hara shares the Runtime and model entry without colleague schedules", () => {
  const agent = { agentId: "hara", kind: "main", state: "idle", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } };
  const workspace = { runtimeOptions: [{ id: "pi", label: "Pi", available: true, recommended: true }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "gpt-6" }] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: true,
    onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] }),
    async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.match(html, /Hara management/);
  assert.match(html, /Apply Runtime/);
  assert.match(html, /This bot.*model/);
  assert.doesNotMatch(html, /Open Runtime settings|Open model settings|gpt-6/);
  assert.doesNotMatch(html, /Create in chat; manage only this colleague here/);
});

test("only an unavailable registered runtime offers one directory deep link", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "active", identity: { displayName: "Dora" },
    runtime: { id: "codex", label: "Codex", available: false } };
  const workspace = { runtimeOptions: [{ id: "codex", label: "Codex", available: false, reason: "not_registered", recommended: false }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "not-this-bot" }] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: false,
    onClose() {}, onRefresh() {}, listModels: async () => { throw new Error("must not read unbound models"); },
    async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.equal((html.match(/Manage local runtimes/g) ?? []).length, 1);
  assert.doesNotMatch(html, /not-this-bot|Open model settings/);
});

test("directory deep link is limited to not_registered and not_installed", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "active", identity: { displayName: "Dora" }, runtime: { id: "codex", label: "Codex", available: false } };
  for (const reason of ["not_registered", "not_installed", "integrity_failed", "adapter_pending_p05", "unknown"]) {
    const workspace = { runtimeOptions: [{ id: "codex", label: "Codex", available: false, reason }], connections: { defaultConnectionId: null, connections: [] } };
    const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: false,
      onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "codex", revision: 1, selectedModelId: null, models: [] }),
      async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
    assert.equal(html.includes("Manage local runtimes"), reason === "not_registered" || reason === "not_installed", reason);
  }
});

test("selected group inspector shows its members without colleague runtime controls", () => {
  const agents = [{ agentId: "dora", kind: "colleague", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "pi", label: "Pi", available: true } }];
  const html = renderToStaticMarkup(createElement(groupModule.exports.default, { name: "Design review", memberIds: ["dora"], agents, locale: "en", inert: false, onClose() {}, onMembers() {} }));
  assert.match(html, /Manage group Design review/);
  assert.match(html, /Dora/);
  assert.match(html, /Manage members/);
  assert.doesNotMatch(html, /Open Runtime settings|Open model settings/);
});
