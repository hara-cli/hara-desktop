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
function render(element, locale) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const ws = { workspaceId: "A", resourceGeneration: "g", label: "A", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace", agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi" } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, runtimes: { options: [], operations: [] }, approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } } };
const updater = { getSnapshot: () => ({ phase: "latest", preferences: { autoCheck: true, lastChecked: null } }), subscribe: () => () => {} };
const overview = (locale, onboarding) => { const value = { workspaceId: "A", workspace: ws, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind: "personal" }] }, error: "" };
  const model = { getSnapshot: () => value, subscribe: () => () => {} };
  return render(createElement(module.exports.SettingsContent, { model, mainModel: model, initialPage: "overview", root: "/x", production: true, updater, versionInfo: null, onClose() {}, onCreateSkill() {}, onboarding,
    theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } }), locale); };

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`overview: «Getting started · Run again» only when the guide is available; read-only viewers cannot rerun (${locale})`, () => {
  const t = makeT(locale);
  assert.equal(overview(locale, undefined).includes("wss-onboarding-rerun"), false, "no entry before the guide ships (unreleased features show no entry)");
  const html = overview(locale, { readOnly: false, rerun: async () => true });
  assert.ok(html.includes(esc(t("ws.onboarding.rerun.title"))) && html.includes(esc(t("ws.onboarding.rerun.note"))) && html.includes(`<button type="button">${esc(t("ws.onboarding.rerun.action"))}</button>`));
  assert.ok(html.indexOf("wss-onboarding-rerun") < html.indexOf(`<h3>${esc(t("ws.settings.device"))} ·`), "sits with the workspace cards, before This Mac");
  const member = overview(locale, { readOnly: true, rerun: async () => true });
  assert.ok(member.includes(esc(t("ws.onboarding.rerun.readOnly"))) && member.includes(`<button type="button" disabled="">${esc(t("ws.onboarding.rerun.action"))}</button>`));
});

test("rerun: fresh run from step 1 keeping the engine choice; read-only or failures keep Settings open", () => {
  const hook = read("../src/WorkspaceOnboarding.tsx"), app = read("../src/WorkspaceLocalDev.tsx");
  assert.match(hook, /const saved = await model\.saveOnboarding\(rerunFields\(current, crypto\.randomUUID\(\)\), current\.revision, workspaceId, generation\);/);
  assert.match(hook, /if \(current\.readOnly\) return false;/);
  assert.match(hook, /setProgress\(saved\); setHidden\(false\); markOnboardingSeen\(workspaceId, saved\.runId\); setOpen\(true\); return true;/);
  assert.match(app, /onboarding=\{onboarding\.available \? \{ readOnly: onboarding\.progress\?\.readOnly === true, rerun: async \(\) => \{ const ok = await onboarding\.rerun\(\); if \(ok\) closeSettings\(\); return ok; \} \} : undefined\}/);
  assert.match(hook, /available: supported,/, "available follows the same gate as the guide (Core G4 + ONBOARDING_STEPS_READY)");
});
