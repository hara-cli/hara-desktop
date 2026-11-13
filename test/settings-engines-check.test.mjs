import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/WorkspaceRuntimeSettings.tsx"; export { default as WorkspaceRuntimeSettings } from "./src/WorkspaceRuntimeSettings.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const M = module.exports;
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/WorkspaceRuntimeSettings.tsx", import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const LOCALES = ["zh-Hans", "en", "zh-Hant"];
function render(element, locale) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const options = [
  { runtimeId: "codex", label: "Codex", registered: true, installed: true, state: "registered", use: "ready", version: "0.50.0", generalAgentDriverAvailable: true },
  { runtimeId: "claude", label: "Claude Code", registered: true, installed: true, state: "registered", use: "confirm_first_use", version: "2.1.0", generalAgentDriverAvailable: true },
  { runtimeId: "opencode", label: "OpenCode", registered: false, installed: false, state: "not_installed", version: null, generalAgentDriverAvailable: true }];
const workspace = (connections = [{ id: "c1", status: "active" }]) => ({ workspaceId: "A", resourceGeneration: "g", agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 1, defaultConnectionId: connections[0]?.id ?? null, connections }, runtimes: { builtIn: "pi", options, operations: [] } });
function model(log, { connectionModels = true, runtime = async () => ({ models: [{ id: "m" }] }), connection = async () => ({ models: [{ id: "a" }, { id: "b" }] }) } = {}) {
  return { supportsConnectionModels: () => connectionModels, detectRuntimes: async () => { log.push("detect"); }, refresh: async () => {},
    listRuntimeModels: async id => { log.push(`list:${id}`); return runtime(id); }, listConnectionModels: async (agentId, connectionId) => { log.push(`conn:${agentId}:${connectionId}`); return connection(); },
    runtimeProxy: async () => ({ proxyUrl: null, revision: 1, readOnly: false }) };
}

test("the shared check: «Ready» only when models were listed; empty or failing lists fail, network errors are told apart", async () => {
  const log = [];
  assert.deepEqual(await M.runEngineCheck(model(log), workspace(), "codex"), { state: "ok", models: 1 });
  assert.deepEqual(await M.runEngineCheck(model(log, { runtime: async () => ({ models: [] }) }), workspace(), "codex"), { state: "failed", network: false });
  assert.deepEqual(await M.runEngineCheck(model(log, { runtime: async () => { throw new Error("fetch failed: ETIMEDOUT"); } }), workspace(), "codex"), { state: "failed", network: true });
  assert.deepEqual(await M.runEngineCheck(model(log, { runtime: async () => { throw new Error("not signed in"); } }), workspace(), "codex"), { state: "failed", network: false });
  assert.deepEqual(await M.runEngineCheck(model(log), workspace(), "pi"), { state: "ok", models: 2 }, "Pi is checked through the workspace's model connection");
  assert.deepEqual(log, ["list:codex", "list:codex", "list:codex", "list:codex", "conn:main:c1"]);
  const none = [];
  assert.deepEqual(await M.runEngineCheck(model(none), workspace([]), "pi"), { state: "failed", network: false });
  assert.deepEqual(await M.runEngineCheck(model(none, { connectionModels: false }), workspace(), "pi"), { state: "failed", network: false });
  assert.deepEqual(none, [], "no connection, or an old Core: nothing is sent");
  assert.equal(M.piCheckable(model([]), workspace([{ id: "x", status: "deleted" }])), false);
});

for (const locale of LOCALES) test(`opening Engines lists no models: enabled engines read «Enabled» with a Check button; others get none (${locale})`, () => {
  const t = makeT(locale), log = [];
  const html = render(createElement(M.WorkspaceRuntimeSettings, { model: model(log), workspace: workspace() }), locale);
  assert.deepEqual(log, [], "rendering sends nothing");
  assert.ok(![...html.matchAll(/data-runtime-status="[^"]+">([^<]*)</g)].some(m => m[1].startsWith(esc(t("ws.onboarding.engine.status.ready")))), "no status reads «Ready» before a check");
  assert.match(html, new RegExp(`data-runtime-status="codex">${esc(t("ws.runtimes.status.enabled"))} · 0\\.50\\.0<`));
  assert.match(html, new RegExp(`data-runtime-status="pi">${esc(t("ws.runtimes.status.enabled"))}<`));
  assert.deepEqual([...html.matchAll(/data-check-engine="([^"]+)"/g)].map(m => m[1]), ["pi", "codex"], "Check only on enabled engines");
  assert.ok(html.includes(`aria-label="${esc(`${t("ws.onboarding.engine.check")} Codex`)}"`));
  assert.ok(html.includes(esc(t("ws.onboarding.engine.readyNote"))));
  const bare = render(createElement(M.WorkspaceRuntimeSettings, { model: model([]), workspace: workspace([]) }), locale);
  assert.match(bare, new RegExp(`data-runtime-status="pi">${esc(t("ws.onboarding.engine.status.needsConnection"))}<`));
  assert.deepEqual([...bare.matchAll(/data-check-engine="([^"]+)"/g)].map(m => m[1]), ["codex"]);
});

for (const locale of LOCALES) test(`failure copy says why and what to do, and names the proxy and connections pages (${locale})`, () => {
  const t = makeT(locale);
  assert.ok(t("ws.runtimes.check.network", { proxy: t("ws.runtimeProxy.title") }).includes(t("ws.runtimeProxy.title")));
  assert.ok(t("ws.runtimes.check.piFailed", { connections: t("ws.settings.page.connections") }).includes(t("ws.settings.page.connections")));
  for (const key of ["ws.runtimes.check.failed", "ws.runtimes.check.network", "ws.runtimes.check.piFailed"]) assert.notEqual(t(key), key);
});

test("a failed check keeps «Enabled» and adds the reason; Ready needs a successful check (source)", () => {
  assert.match(source, /value\?\.state === "ok" \? `\$\{t\("ws\.onboarding\.engine\.status\.ready"\)\} · \$\{t\("ws\.onboarding\.engine\.listed", \{ n: value\.models \}\)\}`/);
  assert.match(source, /: value\?\.state === "checking" \? t\("ws\.onboarding\.engine\.status\.checking"\) : enabled;/, "failed falls through to «Enabled»");
  assert.match(source, /const checkable = runtime\.registered && runtime\.use === "ready";/);
  assert.match(source, /useEffect\(\(\) => \{ setChecks\(\{\}\); \}, \[checkScope\]\);/, "results never carry over to another workspace");
  assert.match(source, /if \(liveCheckScope\.current === checkScope\) setChecks/, "a late answer for another workspace is dropped");
});
