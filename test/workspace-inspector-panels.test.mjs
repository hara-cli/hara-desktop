import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
async function load(file) { const value = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "empty" }, write: false }); const module = { exports: {} }; new Function("require", "module", "exports", value.outputFiles[0].text)(require, module, module.exports); return module.exports; }
const panels = await load("../src/WorkspaceInspectorPanels.tsx"), Inspector = (await load("../src/WorkspaceColleagueInspector.tsx")).default;
const agent = { agentId: "dora", kind: "colleague", state: "active", identity: { displayName: "Dora", title: "Design" }, runtime: { id: "codex", label: "Codex", available: true } };
const workspace = { workspaceId: "fixture", resourceGeneration: "g-fixture", selectedAgentId: "dora", agents: [agent], connections: { revision: 1, defaultConnectionId: null, connections: [] }, conversation: { state: "running", taskState: "running", taskId: "task-dora", objective: "Review synthetic spacing" }, colleagueHome: { path: "/synthetic/dora", legacyPath: "/synthetic/legacy-dora", created: true, available: true, memoryScope: "private", codexMigrationPending: false } };
const features = { workspaceId: "fixture", revision: 1, schedules: [{ id: "dora-job", agentId: "dora", name: "Dora daily", enabled: true, schedule: { kind: "cron", expr: "0 9 * * *" } }, { id: "other-job", agentId: "other", name: "Other colleague private job", enabled: true, schedule: { kind: "cron", expr: "0 8 * * *" } }], skills: [{ id: "workspace-review", description: "Reviewed workspace skill", enabled: false, source: "private" }] };
const props = { agent, workspace, features, supported: true, error: "", locale: "en", onRefresh() {}, onSchedules() {} };
const render = (Component, patch = {}) => renderToStaticMarkup(createElement(Component, { ...props, ...patch }));

test("the default inspector exposes Activity and delays all runtime form controls", () => {
  const html = render(Inspector, { onClose() {} });
  assert.match(html, /role="tablist"/); assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.match(html, /aria-selected="true"[^>]*>Activity/);
  assert.match(html, /Review synthetic spacing/); assert.match(html, /Dora daily/);
  assert.doesNotMatch(html, /vg-runtime-access|vg-rf-|Use this engine|Other colleague private job|Suggested/);
});
test("Activity shows only the selected task and the colleague's real schedules", () => {
  const html = render(panels.WorkspaceInspectorActivity);
  assert.match(html, /Review synthetic spacing|Dora daily/); assert.doesNotMatch(html, /Other colleague private job/);
  assert.match(html, /Location unavailable/); assert.doesNotMatch(html, /This Mac|This computer/);
  const wrongAgent = render(panels.WorkspaceInspectorActivity, { workspace: { ...workspace, selectedAgentId: "other" } });
  assert.doesNotMatch(wrongAgent, /Review synthetic spacing/);
  const paused = render(panels.WorkspaceInspectorActivity, { workspace: { ...workspace, conversation: { ...workspace.conversation, taskState: "paused" } } });
  assert.match(paused, /Paused/); assert.doesNotMatch(paused, /Needs You/);
});
test("unknown, failed and mismatched schedule metadata never masquerades as known empty", () => {
  for (const patch of [{ features: null }, { features: { ...features, workspaceId: "other" } }, { error: "Synthetic unavailable" }, { supported: false }]) {
    const html = render(panels.WorkspaceInspectorActivity, patch);
    assert.doesNotMatch(html, /Dora daily|No schedules for Dora|<small>0<\/small>/);
    const settings = render(Inspector, { ...patch, settingsRequest: 1, onClose() {} });
    assert.doesNotMatch(settings, /Dora daily|No schedules for Dora|<small>0<\/small>/);
  }
  const empty = render(panels.WorkspaceInspectorActivity, { features: { ...features, schedules: [] } });
  assert.match(empty, /No schedules for Dora/); assert.match(empty, /<small>0<\/small>/);
  const failed = render(panels.WorkspaceInspectorActivity, { workspace: { ...workspace, conversation: { ...workspace.conversation, taskState: "failed" } } }); assert.match(failed, /Failed/);
});
test("Resources distinguishes workspace skills from colleague paths and unavailable contents", () => {
  const html = render(panels.WorkspaceInspectorResources);
  for (const text of ["/synthetic/dora", "Workspace skills", "workspace-review", "Reviewed workspace skill", "Disabled", "File listing is unavailable", "Memory contents cannot be viewed"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /role="button"|<button|Assigned to Dora|Other colleague private job/);
  for (const patch of [{ workspace: { ...workspace, selectedAgentId: "other" } }, { agent: { ...agent, kind: "main" } }]) assert.doesNotMatch(render(panels.WorkspaceInspectorResources, patch), /\/synthetic\/dora|\/synthetic\/legacy-dora/);
});
test("three locales retain unavailable versus known-empty distinctions", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const html = render(panels.WorkspaceInspectorResources, { locale, features: { ...features, workspaceId: "other", skills: [{ id: "foreign-skill", description: "Foreign scope" }] } });
    assert.doesNotMatch(html, /foreign-skill|Foreign scope|workspace-review|ws\.skills\./);
    assert.ok(html.includes(locale === "en" ? "Loading" : locale === "zh-Hant" ? "載入中" : "加载中"));
  }
});
