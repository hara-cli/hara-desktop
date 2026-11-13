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
  assert.deepEqual(await M.runEngineCheck(model(none), workspace([]), "pi"), { state: "failed", network: false, missing: true }, "no connection is said as such (review of #98, L3)");
  assert.deepEqual(await M.runEngineCheck(model(none, { connectionModels: false }), workspace(), "pi"), { state: "failed", network: false, missing: true });
  assert.deepEqual(none, [], "no connection, or an old Core: nothing is sent");
  assert.equal(M.piCheckable(model([]), workspace([{ id: "x", status: "deleted" }])), false);
});

for (const locale of LOCALES) test(`opening Engines lists no models: enabled engines read «Enabled» with a Check button; others get none (${locale})`, () => {
  const t = makeT(locale), log = [];
  const html = render(createElement(M.WorkspaceRuntimeSettings, { model: model(log), workspace: workspace() }), locale);
  assert.deepEqual(log, [], "rendering sends nothing");
  assert.ok(![...html.matchAll(/data-runtime-status="[^"]+">([^<]*)</g)].some(m => m[1].startsWith(esc(t("ws.onboarding.engine.status.ready")))), "no status reads «Ready» before a check");
  assert.match(html, new RegExp(`data-runtime-status="codex" aria-live="polite">${esc(t("ws.runtimes.status.enabled"))} · 0\\.50\\.0<`));
  assert.match(html, new RegExp(`data-runtime-status="pi" aria-live="polite">${esc(t("ws.runtimes.status.enabled"))}<`));
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
  assert.match(source, /value\?\.state === "ok" \? `\$\{t\("ws\.onboarding\.engine\.status\.ready"\)\} · \$\{value\.models === 1 \? t\("ws\.runtimes\.check\.listedAtOne"/);
  assert.match(source, /: value\?\.state === "checking" \? t\("ws\.onboarding\.engine\.status\.checking"\) : enabled;/, "failed falls through to «Enabled»");
  assert.match(source, /const checkable = runtime\.registered && runtime\.use === "ready";/);
  assert.match(source, /useEffect\(\(\) => \{ setChecks\(\{\}\); \}, \[checkScope\]\);/, "results never carry over to another workspace");
  assert.match(source, /if \(liveCheckScope\.current === checkScope\) setChecks/, "a late answer for another workspace is dropped");
});

for (const locale of LOCALES) test(`screen readers hear the check: live status line, a reason region that exists before it is filled, focus kept while checking (review of #98, M1) (${locale})`, () => {
  const html = render(createElement(M.WorkspaceRuntimeSettings, { model: model([]), workspace: workspace() }), locale);
  for (const id of ["pi", "codex"]) {
    assert.match(html, new RegExp(`data-runtime-status="${id}" aria-live="polite"`), `${id} status is a live region`);
    assert.match(html, new RegExp(`<span class="wsd-runtime-check-live" aria-live="polite" data-check-live="${id}"></span>`), `${id} reason region is present and empty before any check`);
  }
  assert.doesNotMatch(html, /data-runtime-status="claude"[^>]*aria-live/, "rows without Check stay quiet");
  assert.doesNotMatch(html, /<button[^>]*data-check-engine="[^"]+"[^>]*disabled=""/, "Check is never natively disabled");
  assert.doesNotMatch(source, /wsd-runtime-check-warn" role="status"/);
  assert.match(source, /aria-disabled=\{waiting \|\| undefined\} onClick=\{\(\) => check\(id\)\}/);
  assert.match(source, /if \(checks\[id\]\?\.state === "checking" \|\| pending\) return;/, "a waiting button ignores presses");
  assert.doesNotMatch(readFileSync(new URL("../src/workspace-settings.css", import.meta.url), "utf8"), /wsd-runtime-check-live[^{]*\{[^}]*display:\s*none/, "the region stays in the accessibility tree");
});

for (const locale of LOCALES) test(`«Ready» shows when it was checked, and the note fits Pi too (review of #98, L1/L2) (${locale})`, () => {
  const t = makeT(locale);
  assert.ok(t("ws.runtimes.check.listedAt", { n: 3, time: "13:05" }).includes("13:05"));
  assert.doesNotMatch(t("ws.onboarding.engine.readyNote"), /sign-in|登录|登入/);
  assert.match(source, /t\("ws\.runtimes\.check\.listedAt", \{ n: value\.models, time: checkedAt\(value\.at\) \}\)/);
});

for (const locale of LOCALES) test(`one listed model reads in the singular (review of #98, L) (${locale})`, () => {
  const t = makeT(locale);
  assert.equal(t("ws.runtimes.check.listedAtOne", { time: "13:05" }), { en: "1 model listed · checked at 13:05", "zh-Hans": "已列出 1 个模型 · 13:05 检查", "zh-Hant": "已列出 1 個模型 · 13:05 檢查" }[locale]);
  assert.equal(t("ws.onboarding.engine.listedOne"), { en: "1 model listed · checked just now", "zh-Hans": "已列出 1 个模型 · 刚刚检查", "zh-Hant": "已列出 1 個模型 · 剛剛檢查" }[locale]);
  assert.match(source, /value\.models === 1 \? t\("ws\.runtimes\.check\.listedAtOne"/);
  assert.match(readFileSync(new URL("../src/OnboardingEngineStep.tsx", import.meta.url), "utf8"), /value\.models === 1 \? t\("ws\.onboarding\.engine\.listedOne"\)/);
});
