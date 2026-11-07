import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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

test("selected colleague inspector owns schedule management in all three locales", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "idle", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "pi", label: "Pi", available: true } };
  const features = { revision: 2, workspaceId: "fixture", skills: [], schedules: [
    { id: "dora-9", agentId: "dora", name: "Visual summary", enabled: true, schedule: { kind: "cron", expr: "0 9 * * 1-5" }, tz: "Asia/Taipei", task: "Summarize visuals" },
    { id: "elon-8", agentId: "elon", name: "Private other colleague schedule", enabled: true, schedule: { kind: "cron", expr: "0 8 * * *" }, task: "Another task" },
  ], scheduler: { schedules: [] } };
  const workspace = { runtimeOptions: [{ id: "pi", label: "Pi", available: true, recommended: true }, { id: "opencode", label: "OpenCode", available: false, reason: "adapter_pending_p05", recommended: false }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "sonnet" }] } };
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features, locale, error: "", inert: false, supported: true,
      onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] }),
      async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
    assert.match(html, locale === "en" ? /Manage Dora/ : /Dora · 管理/);
    assert.ok(html.includes(locale === "en" ? "Engine" : "引擎"));
    assert.ok(html.includes(locale === "en" ? "Use this engine" : locale === "zh-Hant" ? "使用此引擎" : "使用此引擎"));
    assert.doesNotMatch(html, /sonnet|Open Runtime settings|Open model settings|管理本机引擎/);
    assert.match(html, /Visual summary/);
    assert.doesNotMatch(html, /Private other colleague schedule|Another task/);
    for (const label of (locale === "en" ? ["Scheduled Tasks", "Edit", "Pause", "Delete", "Create in chat; manage only this colleague here."]
      : locale === "zh-Hant" ? ["排程", "編輯", "停用", "刪除", "在聊天裡建立；這裡只管理這位同事的排程。"] : ["定时", "编辑", "停用", "删除", "在聊天里创建；这里只管理这位同事的定时。"])) assert.ok(html.includes(label), `${locale}: ${label}`);
  }
});

test("workspace selected-colleague route retains schedule actions outside Settings", () => {
  const shell = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  assert.match(shell, /showColleagueInspector && agent && workspace \? <WorkspaceColleagueInspector/);
  for (const action of ["workspace.features.update", "workspace.schedule.save", "workspace.schedule.delete"]) {
    assert.ok(shell.includes(action), `selected colleague schedule action: ${action}`);
  }
});

test("main Hara shares the Runtime and model entry without colleague schedules", () => {
  const agent = { agentId: "hara", kind: "main", state: "idle", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } };
  const workspace = { runtimeOptions: [{ id: "pi", label: "Pi", available: true, recommended: true }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "gpt-6" }] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: true,
    onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] }),
    async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.match(html, /Manage Hara/);
  assert.match(html, /Use this engine/);
  assert.match(html, /This Hara colleague.*model/);
  assert.doesNotMatch(html, /Open Runtime settings|Open model settings|gpt-6/);
  assert.doesNotMatch(html, /Create in chat; manage only this colleague here/);
});

test("main Hara and a Pi colleague display the same active connection model card", () => {
  const workspace = { workspaceId: "fixture", resourceGeneration: "generation", runtimeOptions: [{ id: "pi", label: "Pi", available: true }],
    connections: { revision: 2, defaultConnectionId: "primary", activeConnectionId: "primary", connections: [{ id: "primary", status: "active", defaultModel: "qwen3.7-plus" }] } };
  for (const kind of ["main", "colleague"]) {
    const agent = { agentId: kind, kind, state: "active", identity: { displayName: kind === "main" ? "Hara" : "Dora" }, runtime: { id: "pi", label: "Pi", available: true } };
    const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "zh-Hans", error: "", inert: false, supported: false,
      connectionModelSupported: true, listConnectionModels: async () => ({ connectionId: "primary", revision: 2, source: "documented", selectedModelId: "qwen3.7-plus", models: [] }),
      onApplyConnectionModel: async () => {}, onClose() {}, onRefresh() {}, listModels: async () => { throw Error("Pi must use connection model catalog"); },
      async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
    assert.match(html, /qwen3\.7-plus/);
    assert.match(html, /vg-runtime-model-card/);
  }
});

test("only an unavailable registered runtime offers one directory deep link", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "active", identity: { displayName: "Dora" },
    runtime: { id: "codex", label: "Codex", available: false } };
  const workspace = { runtimeOptions: [{ id: "codex", label: "Codex", available: false, reason: "not_registered", recommended: false }],
    connections: { defaultConnectionId: "primary", connections: [{ id: "primary", defaultModel: "not-this-bot" }] } };
  const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: false,
    onClose() {}, onRefresh() {}, listModels: async () => { throw new Error("must not read unbound models"); },
    async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
  assert.equal((html.match(/Install in Settings/g) ?? []).length, 1);
  assert.match(html, /<aside[^>]*id="workspace-inspector"[\s\S]*class="vg-runtime-recovery-actions"/);
  assert.match(html, /class="vg-runtime-rescan"[\s\S]*class="vg-runtime-install"/);
  assert.doesNotMatch(html, /not-this-bot|Open model settings/);
});

test("directory deep link is limited to not_registered and not_installed", () => {
  const agent = { agentId: "dora", kind: "colleague", state: "active", identity: { displayName: "Dora" }, runtime: { id: "codex", label: "Codex", available: false } };
  for (const reason of ["not_registered", "not_installed", "integrity_failed", "adapter_pending_p05", "unknown"]) {
    const workspace = { runtimeOptions: [{ id: "codex", label: "Codex", available: false, reason }], connections: { defaultConnectionId: null, connections: [] } };
    const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: false,
      onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "codex", revision: 1, selectedModelId: null, models: [] }),
      async onApplyRuntime() {}, async onApplyModel() {}, onRuntimeDirectory() {}, async onSaveProfile() {}, async onToggle() {}, async onSave() {}, async onDelete() {} }));
    assert.equal(html.includes("Install in Settings"), reason === "not_registered" || reason === "not_installed", reason);
  }
});

test("main and colleague inspectors retain identical visible, disabled same-value Apply controls", () => {
  for (const kind of ["main", "colleague"]) {
    const agent = { agentId: kind, kind, state: "active", configRevision: 2, agentEpoch: 1,
      identity: { displayName: kind === "main" ? "Hara" : "Dora" }, runtime: { id: "codex", label: "Codex", available: true } };
    const workspace = { runtimeOptions: [{ id: "codex", label: "Codex", available: true }, { id: "agy", label: "Antigravity", available: false, reason: "not_installed" }],
      connections: { defaultConnectionId: null, connections: [] }, runtimes: { options: [{ runtimeId: "agy", label: "Antigravity", state: "detected", registered: false }] } };
    const html = renderToStaticMarkup(createElement(module.exports.default, { agent, workspace, features: null, locale: "en", error: "", inert: false, supported: false,
      onClose() {}, onRefresh() {}, listModels: async () => ({ runtimeId: "codex", revision: 1, selectedModelId: null, models: [] }),
      async onApplyRuntime() {}, async onApplyModel() {}, async onRescan() {}, async onRegisterRuntime() {}, onRuntimeDirectory() {}, async onSaveProfile() {} }));
    assert.match(html, /<select[^>]*aria-label="Engine"/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Use this engine<\/button>/);
    assert.match(html, /Rescan local runtimes/);
    assert.match(html, /<select[^>]*aria-label="This Hara colleague&#x27;s model"[^>]*disabled=""/);
    assert.doesNotMatch(html, /Install in Settings|>Enable<|Antigravity found/);
  }
});

test("selected group inspector shows its members without colleague runtime controls", () => {
  const agents = [{ agentId: "dora", kind: "colleague", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "pi", label: "Pi", available: true } }];
  const html = renderToStaticMarkup(createElement(groupModule.exports.default, { name: "Design review", memberIds: ["dora"], agents, locale: "en", inert: false, onClose() {}, onMembers() {} }));
  assert.match(html, /Design review · Manage Group/);
  assert.match(html, /Dora/);
  assert.match(html, /Manage members/);
  assert.doesNotMatch(html, /Open Runtime settings|Open model settings/);
});
