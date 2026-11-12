import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { WorkspaceUpdater, updateDefaults } from "../src/workspace-updater-state.ts";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {default as Runtimes} from "./src/WorkspaceRuntimeSettings.tsx"; export {SettingsContent} from "./src/WorkspaceSettings.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/WorkspaceRuntimeSettings.tsx", import.meta.url), "utf8");

function render(element, locale = "zh-Hans") {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const option = (runtimeId, patch = {}) => ({ runtimeId, label: { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", gemini: "Gemini CLI", copilot: "GitHub Copilot" }[runtimeId] ?? runtimeId,
  state: "not_installed", installed: false, registered: false, version: null, loginSource: "host", ...patch });
const workspace = (options, operations = []) => ({ workspaceId: "A", resourceGeneration: "g1", label: "A", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace",
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } },
  runtimes: { options, operations } });
const model = { detectRuntimes: async () => {}, refresh: async () => {}, cancelRuntime: async () => {} };
const runtimes = (ws, locale) => render(createElement(module.exports.Runtimes, { model, workspace: ws }), locale);

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`settings never claims an engine is ready without a model probe (${locale})`, () => {
  const t = makeT(locale);
  const html = runtimes(workspace([option("codex", { state: "registered", registered: true, installed: true, use: "ready", version: "0.50.0" }),
    option("claude", { state: "detected", installed: true, use: "confirm_first_use", version: "2.0.1", fingerprint: "f" })]), locale);
  assert.ok(html.includes(`${t("ws.runtimes.status.enabled")} · 0.50.0`), "Core ready → Enabled");
  assert.ok(html.includes(`${t("ws.runtimes.status.installedNotEnabled")} · 2.0.1`), "first use pending → Installed · not enabled");
  assert.equal(html.includes(`>${t("ws.rf.status.ready")} · `), false);
  assert.equal(html.includes(t("ws.rf.status.confirm_first_use")), false);
  assert.doesNotMatch(source, /listModels/, "settings does not probe models");
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`engines that are not installed fold into one row (${locale})`, () => {
  const t = makeT(locale);
  const html = runtimes(workspace([option("codex", { state: "registered", registered: true, installed: true, use: "ready" }), option("opencode"), option("copilot")]), locale);
  // First render is before this page's own detection completes: no verdict yet (the count is covered in workspace-runtime-settings-probe).
  const summary = t("ws.runtimes.otherChecking");
  assert.ok(html.includes(`<details class="wsd-runtime-details wsd-runtime-missing"><summary>${summary}</summary>`), summary);
  assert.equal(html.includes(t("ws.runtimes.otherMissing", { n: 2 })), false);
  const folded = html.slice(html.indexOf("wsd-runtime-missing"));
  assert.ok(folded.includes("OpenCode") && folded.includes("GitHub Copilot"), "missing engines and their install actions stay reachable inside");
  assert.equal(folded.includes(">Codex<"), false, "enabled engines stay outside the fold");
  assert.equal(runtimes(workspace([option("codex", { state: "registered", registered: true, installed: true })])).includes("wsd-runtime-missing"), false, "no empty fold");
});

test("switching login source is a row-end menu item that opens the existing confirmation", () => {
  const html = runtimes(workspace([option("codex", { state: "registered", registered: true, installed: true, loginSource: "isolated", fingerprint: "f" })]));
  assert.ok(html.includes('aria-label="Codex的更多操作"') && html.includes('aria-haspopup="menu"'));
  assert.equal(html.includes(`>${makeT("zh-Hans")("ws.runtimeAccess.switchHost")}</button>`), false, "no inline button");
  assert.match(source, /id: "switch-host", label: t\("ws\.runtimeAccess\.switchHost"\), onSelect: \(\) => \{ setLoginSource\("host"\); setLocal\(runtime\); \}/);
  assert.equal(runtimes(workspace([option("agy", { state: "registered", registered: true, installed: true, loginSource: "isolated", fingerprint: "f" })])).includes("wss-row-menu"), false, "Antigravity has no host login to switch to");
});

test("setup dialogs keep «use this Mac's login» visible and fold the isolated alternative, except Antigravity", () => {
  assert.equal((source.match(/<IsolatedLoginChoice runtimeId=\{(local|card)\.runtimeId\} loginSource=\{loginSource\}>/g) ?? []).length, 2);
  assert.match(source, /if \(runtimeId === "agy"\) return <>\{children\}<\/>;/);
  assert.match(source, /<SettingsAdvanced page="runtimes\.loginSource" persist=\{false\} items=\{\[t\("ws\.runtimeAccess\.isolated"\)\]\} customized=\{loginSource === "isolated" \?/);
  assert.match(source, /setLoginSource\(id === "agy" \? "isolated" : "host"\)/, "default login source is unchanged");
});

test("a running download is pinned at the top of the engine page with its cancel action", () => {
  const ws = workspace([option("codex")], [{ id: "op1", runtimeId: "codex", state: "downloading" }, { id: "op0", runtimeId: "opencode", state: "failed" }]);
  const page = runtimes(ws), t = makeT("zh-Hans");
  assert.equal(page.includes(t("ws.runtimes.cancelInstall")), false, "the page body no longer repeats the cancel button");
  assert.ok(page.includes("opencode · "), "other operations stay listed");
  const updater = new WorkspaceUpdater({ load: async () => updateDefaults(), save: async () => {}, check: async () => null, activity: async () => ({ running: 0 }), prepare: async () => ({ id: "x" }), release: async () => {}, restart: async () => {}, error: () => "x" });
  const value = { workspaceId: "A", workspace: ws, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind: "personal" }] }, error: "" };
  const shellModel = { ...model, getSnapshot: () => value, subscribe: () => () => {} };
  const shell = render(createElement(module.exports.SettingsContent, { model: shellModel, mainModel: shellModel, initialPage: "runtimes", root: "/private/fixture", production: true, updater,
    versionInfo: null, onClose() {}, onCreateSkill() {}, theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } }));
  const bar = shell.slice(shell.indexOf('data-settings-attention="download-op1"'));
  assert.ok(bar.includes(t("ws.runtimes.attention.downloading", { name: "Codex" })) && bar.includes(`>${t("ws.runtimes.cancelInstall")}</button>`));
  assert.ok(shell.includes('class="wss-attention is-progress" role="status" data-settings-attention="download-op1"'), "a download is progress, not an alert");
  assert.ok(shell.indexOf("download-op1") < shell.indexOf("wsd-runtime-settings"), "pinned above the page content");
});

test("the 1.2.2 proxy fold lines are left exactly as on integrate (merged back separately in S1c)", () => {
  assert.match(source, /\n    <WorkspaceRuntimeProxy key=\{`\$\{workspace\.workspaceId\}:\$\{workspace\.resourceGeneration\}`\} model=\{model\} workspaceId=\{workspace\.workspaceId\} generation=\{workspace\.resourceGeneration\} onDirty=\{onDirty\} \/>\n    <button disabled=\{detecting \|\| pending\}/);
});
