import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {SettingsContent} from "./src/WorkspaceSettings.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function render(element, locale, platform) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  if (platform !== undefined) Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform } });
  try { return renderToStaticMarkup(element); } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage;
    if (platform !== undefined) {
      if (beforeNavigator) Object.defineProperty(globalThis, "navigator", beforeNavigator); else delete globalThis.navigator;
    }
  }
}
const deviceKey = platform => /^(mac|darwin)/i.test(platform) ? "ws.settings.device"
  : /^win/i.test(platform) ? "ws.settings.deviceCopy.windows" : "ws.settings.deviceCopy.other";
function assertRerunBeforeDevice(html, deviceLabel) {
  const rerun = html.indexOf("wss-onboarding-rerun"), device = html.indexOf(`<h3>${esc(deviceLabel)} ·`);
  assert.notEqual(rerun, -1, "the onboarding row exists");
  assert.notEqual(device, -1, "the platform-specific device heading exists");
  assert.ok(rerun < device, "the onboarding row sits with workspace cards before the device section");
}
const ws = { workspaceId: "A", resourceGeneration: "g", label: "A", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace", agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi" } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, runtimes: { options: [], operations: [] }, approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } } };
const updater = { getSnapshot: () => ({ phase: "latest", preferences: { autoCheck: true, lastChecked: null } }), subscribe: () => () => {} };
const overview = (locale, onboarding, platform) => { const value = { workspaceId: "A", workspace: ws, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind: "personal" }] }, error: "" };
  const model = { getSnapshot: () => value, subscribe: () => () => {} };
  return render(createElement(module.exports.SettingsContent, { model, mainModel: model, initialPage: "overview", root: "/x", production: true, updater, versionInfo: null, onClose() {}, onCreateSkill() {}, onboarding,
    theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } }), locale, platform); };

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`overview: «Getting started · Run again» only when the guide is available; read-only viewers cannot rerun (${locale})`, context => {
  const t = makeT(locale);
  assert.equal(overview(locale, undefined).includes("wss-onboarding-rerun"), false, "no entry before the guide ships (unreleased features show no entry)");
  const html = overview(locale, { workspaceId: "A", readOnly: false, rerun: async () => "started" });
  assert.ok(html.includes(esc(t("ws.onboarding.rerun.title"))) && html.includes(esc(t("ws.onboarding.rerun.note"))) && html.includes(`<button type="button">${esc(t("ws.onboarding.rerun.action"))}</button>`));
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  assertRerunBeforeDevice(html, t(deviceKey(platform)));
  if (deviceKey(platform) !== "ws.settings.device") {
    // Preserve a real native-runner negative control for the original Mac-only assertion.
    assert.throws(() => assert.ok(html.indexOf("wss-onboarding-rerun") < html.indexOf(`<h3>${esc(t("ws.settings.device"))} ·`)), { code: "ERR_ASSERTION" });
    context.diagnostic(`Legacy Mac-only assertion reproduced on ${platform || "unknown"}: overview: «Getting started · Run again» only when the guide is available; read-only viewers cannot rerun (${locale})`);
  }
  const member = overview(locale, { workspaceId: "A", readOnly: true, rerun: async () => "started" });
  assert.ok(member.includes(esc(t("ws.onboarding.rerun.readOnly"))) && member.includes(`<button type="button" disabled="">${esc(t("ws.onboarding.rerun.action"))}</button>`));
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) for (const [platform, key] of [
  ["MacIntel", "ws.settings.device"], ["Win32", "ws.settings.deviceCopy.windows"], ["Linux x86_64", "ws.settings.deviceCopy.other"],
]) test(`overview onboarding order uses an existing device heading (${locale}/${platform})`, () => {
  const html = overview(locale, { workspaceId: "A", readOnly: false, rerun: async () => "started" }, platform);
  assertRerunBeforeDevice(html, makeT(locale)(key));
});

test("rerun: fresh run from step 1 keeping the engine choice; read-only or failures keep Settings open", () => {
  const hook = read("../src/WorkspaceOnboarding.tsx"), app = read("../src/WorkspaceLocalDev.tsx");
  assert.match(hook, /const saved = await model\.saveOnboarding\(rerunFields\(current, crypto\.randomUUID\(\)\), current\.revision, workspaceId, generation\);/);
  assert.match(hook, /if \(current\.readOnly\) \{ setProgress\(current\); return "readOnly"; \}/, "read-only is decided by the record even if progress had not loaded (L1)");
  assert.match(hook, /if \(busy\) return "busy";/);
  assert.match(hook, /setProgress\(saved\); setHidden\(false\); markOnboardingSeen\(workspaceId, saved\.runId\); setOpen\(true\); return "started";/);
  assert.match(app, /onboarding=\{onboarding\.available && onboarding\.workspaceId \? \{ workspaceId: onboarding\.workspaceId, readOnly: onboarding\.progress\?\.readOnly === true, rerun: async \(\) => \{ const result = await onboarding\.rerun\(\); if \(result === "started"\) closeSettings\(\); return result; \} \} : undefined\}/);
  assert.match(hook, /available: supported,/, "available follows the same gate as the guide (Core G4 + ONBOARDING_STEPS_READY)");
});

test("Settings switched to another workspace: no «Run again», since the guide belongs to the main window's workspace (review of #85, M1)", () => {
  assert.equal(overview("zh-Hans", { workspaceId: "B", readOnly: false, rerun: async () => "started" }).includes("wss-onboarding-rerun"), false);
  assert.ok(overview("zh-Hans", { workspaceId: "A", readOnly: false, rerun: async () => "started" }).includes("wss-onboarding-rerun"));
});

test("the row reacts to the reason: read-only shows the read-only text, busy shows nothing, failed shows the alert (review of #85, L1/L2)", () => {
  const settings = read("../src/WorkspaceSettings.tsx");
  assert.match(settings, /const readOnly = onboarding\.readOnly \|\| result === "readOnly";/);
  assert.match(settings, /setResult\(value === "busy" \? null : value\)/);
  assert.match(settings, /\{result === "failed" \? <p role="alert">/);
  assert.match(read("../src/workspace-settings.css"), /\.wss-onboarding-rerun p\{margin:var\(--hara-space-1\) 0 0;/, "no hard-coded spacing (L3)");
});
