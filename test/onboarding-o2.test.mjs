import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/OnboardingEngineStep.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { engineRows, OnboardingEngineStep, NETWORK_ERROR } = module.exports;
const source = readFileSync(new URL("../src/OnboardingEngineStep.tsx", import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function render(element, locale = "zh-Hans") {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const options = [
  { runtimeId: "codex", label: "Codex", registered: true, state: "registered", use: "ready" },
  { runtimeId: "claude", label: "Claude Code", registered: true, state: "registered", use: "confirm_first_use" },
  { runtimeId: "copilot", label: "GitHub Copilot", registered: true, state: "registered", generalAgentDriverAvailable: false },
  { runtimeId: "opencode", label: "OpenCode", registered: false, state: "not_installed" },
  { runtimeId: "gemini", label: "Gemini CLI", registered: false, state: "detected" },
];
const workspace = (patch = {}) => ({ workspaceId: "A", resourceGeneration: "g", label: "A", selectedAgentId: "main", agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi" } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, runtimes: { options, operations: [] }, approvals: [], conversation: { history: [], state: "idle" }, ...patch });
const connected = workspace({ connections: { revision: 1, defaultConnectionId: "one", connections: [{ id: "one", label: "OpenRouter", status: "active", defaultModel: "m" }] } });
const progress = (patch = {}) => ({ schemaVersion: 1, revision: 1, readOnly: false, recovered: false, runId: "run-1", step: 1, engineChoice: null, thirdPartySkipped: false, dismissed: false, completedAt: null, ...patch });
const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));

test("no engine reads «Ready» until a check just listed its models; unchecked enabled engines read «Enabled»", () => {
  const t = makeT("zh-Hans"), rows = byId(engineRows(connected, {}, false, t));
  assert.equal(Object.values(rows).some(row => row.status === "ws.onboarding.engine.status.ready"), false);
  assert.equal(rows.codex.status, "ws.runtimes.status.enabled"); assert.equal(rows.codex.check, true); assert.equal(rows.codex.selectable, true);
  assert.equal(rows.pi.status, "ws.runtimes.status.enabled", "Pi with a connection is enabled, not ready, until checked");
  const checked = byId(engineRows(connected, { codex: { state: "ok", models: 12 }, pi: { state: "failed", network: true } }, false, t));
  assert.equal(checked.codex.status, "ws.onboarding.engine.status.ready"); assert.equal(checked.codex.detail, t("ws.onboarding.engine.listed", { n: 12 }));
  assert.deepEqual([checked.pi.status, checked.pi.tone, checked.pi.detail, checked.pi.detailTone], ["ws.runtimes.status.enabled", "", t("ws.onboarding.engine.networkShort"), "warn"],
    "DESIGN 2.1.2 §11.4: a failed check still reads «Enabled» with the reason in warning colour (review of #83, M1)");
  assert.ok(t("ws.onboarding.engine.networkShort").length && t("ws.onboarding.engine.failedShort").length);
  assert.equal(byId(engineRows(connected, { codex: { state: "failed", network: false } }, false, t)).codex.detail, t("ws.onboarding.engine.failedShort"));
  assert.equal(checked.pi.selectable, true, "a failed engine can still be chosen; the detail says so (L3)");
  assert.match(source, /result\.models\.length \? \{ state: "ok", models: result\.models\.length \} : \{ state: "failed", network: false \}/);
});

test("rows follow the design's states, Pi first, engines that cannot drive colleagues left out, not-installed last", () => {
  const t = makeT("zh-Hans"), list = engineRows(workspace(), {}, false, t), rows = byId(list);
  assert.deepEqual(list.map(row => row.id), ["pi", "codex", "claude", "gemini", "opencode"]);
  assert.equal(rows.copilot, undefined);
  assert.deepEqual([rows.pi.status, rows.pi.selectable], ["ws.onboarding.engine.status.needsConnection", false]);
  assert.deepEqual([rows.claude.status, rows.claude.selectable], ["ws.onboarding.engine.status.confirm", true], "first use is confirmed when a colleague is created");
  assert.deepEqual([rows.gemini.status, rows.gemini.selectable], ["ws.runtimes.status.installedNotEnabled", false]);
  assert.deepEqual([rows.opencode.status, rows.opencode.selectable, rows.opencode.dim], ["ws.onboarding.engine.status.missing", false, true]);
  assert.equal(byId(engineRows(workspace(), {}, true, t)).opencode.status, "ws.onboarding.engine.status.checking", "while detecting, missing engines read «Checking…», never «Not installed»");
  assert.equal(byId(engineRows(workspace({ runtimes: { options: [{ ...options[0], use: "confirm_update" }], operations: [] } }), {}, false, t)).codex.status, "ws.onboarding.engine.status.updated");
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`step 1 renders the Hara-model row, radios, «Use X, next», the honest note and a folded proxy (${locale})`, () => {
  const t = makeT(locale);
  const model = { detectRuntimes: async () => {}, supportsConnectionModels: () => true, runtimeProxy: () => new Promise(() => {}) };
  const sheet = { step: 1, readOnly: false, busy: false, notice: "", onLater() {} };
  const html = render(createElement(OnboardingEngineStep, { progress: progress({ engineChoice: "claude" }), sheet, next() {}, model, workspace: workspace() }), locale);
  assert.ok(html.includes(esc(t("ws.onboarding.engine.hara"))) && html.includes(esc(t("ws.onboarding.engine.haraMissing"))), "no connection → «Model for Hara» row (Q1)");
  assert.ok(html.includes(`>${esc(t("ws.onboarding.engine.use", { name: "Claude Code" }))}</button>`), "a saved choice is preselected and named on the button");
  assert.match(html, /role="radiogroup"/);
  const radio = id => html.match(new RegExp(`<input type="radio"[^>]*value="${id}"[^>]*/>`))[0];
  assert.ok(radio("claude").includes('checked=""'));
  assert.ok(radio("pi").includes('disabled=""'), "Pi without a connection cannot be chosen");
  assert.ok(html.includes(esc(t("ws.onboarding.engine.readyNote"))) && html.includes(esc(t("ws.onboarding.engine.free"))));
  assert.ok(html.includes('data-settings-advanced="onboarding.engine"') && !/data-settings-advanced="onboarding\.engine" open=""/.test(html), "proxy is under a closed Advanced");
  assert.ok(html.includes(esc(t("ws.onboarding.engine.scope"))));
  const withConnection = render(createElement(OnboardingEngineStep, { progress: progress(), sheet, next() {}, model, workspace: connected }), locale);
  assert.equal(withConnection.includes(esc(t("ws.onboarding.engine.hara"))), false, "the row disappears once connected");
});

test("step 1 never installs, registers, approves or creates anything, and writes only G4 engineChoice", () => {
  assert.doesNotMatch(source, /registerLocalRuntime|approveRuntime|proposeRuntime|createBatch|agents\.create|saveDefaultRuntime|preferences/);
  assert.match(source, /onClick=\{\(\) => next\(\{ engineChoice: selected \}\)\}/);
  assert.match(source, /onClick=\{\(\) => next\(\{ engineChoice: null \}\)\}/, "skip keeps no choice");
  assert.equal((source.match(/listRuntimeModels|listConnectionModels/g) ?? []).length, 2, "models are listed only from the explicit Check");
  assert.match(source, /<SettingsAdvanced page="onboarding\.engine" persist=\{false\} forceOpen=\{networkFailed\}/, "Advanced opens itself only after a network failure");
});

test("network failures are told apart from other failures", () => {
  for (const text of ["fetch failed", "ETIMEDOUT", "connect ECONNREFUSED 127.0.0.1:443", "getaddrinfo ENOTFOUND api.example", "Request timed out"]) assert.ok(NETWORK_ERROR.test(text), text);
  for (const text of ["Not signed in", "invalid model", "unsupported"]) assert.equal(NETWORK_ERROR.test(text), false, text);
});

test("the guide's connection form gets the first-key Keychain hint like Settings (review of #83, L2; #81)", () => {
  assert.match(source, /<WorkspaceConnectionForm model=\{model\} firstKey=\{!workspace\.connections\.connections\.some\(connection => connection\.keySaved\)\}/);
});
