import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { onboardingView, onboardingSurface, rerunFields, ONBOARDING_STEPS_READY, ONBOARDING_SEEN_KEY, markOnboardingSeen, onboardingSeen } from "../src/workspace-onboarding-state.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/WorkspaceOnboarding.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function withStorage(store, action) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = String(value); } } });
  try { return action(); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const render = (element, locale = "zh-Hans") => withStorage({ "hara.locale": locale }, () => renderToStaticMarkup(element));
const progress = (patch = {}) => ({ schemaVersion: 1, revision: 3, readOnly: false, recovered: false, runId: "run-1", step: 1, engineChoice: null, thirdPartySkipped: false, dismissed: false, completedAt: null, ...patch });

test("Core replies are validated; anything malformed never opens the guide", () => {
  assert.deepEqual(onboardingView(progress()), progress());
  for (const bad of [null, [], { ...progress(), schemaVersion: 2 }, { ...progress(), step: 4 }, { ...progress(), runId: "" }, { ...progress(), dismissed: "no" }, { ...progress(), revision: 1.5 }, { ...progress(), readOnly: undefined }])
    assert.throws(() => onboardingView(bad));
});

test("entry rules: dismissed or completed shows nothing; first sight of a run with only Hara opens the sheet; otherwise the resume card", () => {
  assert.equal(onboardingSurface(null, { seen: false, colleagues: 0 }), "none");
  assert.equal(onboardingSurface(progress({ dismissed: true }), { seen: false, colleagues: 0 }), "none", "pre-upgrade workspaces read as dismissed (Q3)");
  assert.equal(onboardingSurface(progress({ step: 3, completedAt: "2026-11-12T00:00:00Z" }), { seen: false, colleagues: 0 }), "none");
  assert.equal(onboardingSurface(progress(), { seen: false, colleagues: 0 }), "sheet");
  assert.equal(onboardingSurface(progress(), { seen: true, colleagues: 0 }), "resume", "«Later» or a closed window → resume card next time");
  assert.equal(onboardingSurface(progress(), { seen: false, colleagues: 2 }), "resume", "the sheet never covers a workspace that already has colleagues");
});

test("«seen» is a per-viewer convenience keyed by workspace and run; a broken store just means the sheet opens again", () => {
  const store = {};
  withStorage(store, () => { markOnboardingSeen("A", "run-1"); assert.equal(onboardingSeen("A", "run-1"), true); assert.equal(onboardingSeen("A", "run-2"), false, "a rerun is a new run"); assert.equal(onboardingSeen("B", "run-1"), false); });
  assert.deepEqual(JSON.parse(store[ONBOARDING_SEEN_KEY]), { A: "run-1" });
  withStorage({ [ONBOARDING_SEEN_KEY]: "{" }, () => assert.equal(onboardingSeen("A", "run-1"), false));
});

test("a rerun is a fresh run at step 1 with no completion or skip, keeping the engine choice", () => {
  assert.deepEqual(rerunFields(progress({ step: 3, engineChoice: "codex", thirdPartySkipped: true, dismissed: true, completedAt: "x" }), "run-2"),
    { runId: "run-2", step: 1, engineChoice: "codex", thirdPartySkipped: false, dismissed: false, completedAt: null });
});

function modelFixture(capabilities) {
  const calls = [];
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", agents: [], approvals: [],
    connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ supportsCapability: name => capabilities.includes(name), async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    if (method === "workspace.onboarding.get") return progress();
    if (method === "workspace.onboarding.set") { const { workspaceId, expectedGeneration, expectedRevision, ...fields } = params; return progress({ ...fields, revision: expectedRevision + 1 }); }
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  return { model, calls };
}

test("G4 RPCs carry the workspace scope and exactly the six progress fields; nothing else is written", async () => {
  const f = modelFixture(["workspace.onboarding.v1"]); await f.model.selectWorkspace("A");
  assert.deepEqual(await f.model.onboarding("A", "generation-A"), progress());
  const saved = await f.model.saveOnboarding({ ...progress({ step: 2 }), answers: ["x"], duty: "y" }, 3, "A", "generation-A");
  assert.equal(saved.revision, 4);
  const rpc = f.calls.filter(call => call.method.startsWith("workspace.onboarding."));
  assert.deepEqual(rpc, [{ method: "workspace.onboarding.get", params: { workspaceId: "A", expectedGeneration: "generation-A" } },
    { method: "workspace.onboarding.set", params: { expectedRevision: 3, runId: "run-1", step: 2, engineChoice: null, thirdPartySkipped: false, dismissed: false, completedAt: null, workspaceId: "A", expectedGeneration: "generation-A" } }]);
  await assert.rejects(() => f.model.onboarding("B", "generation-B"), "a stale scope is rejected before sending");
  assert.equal(f.calls.filter(call => call.method.startsWith("workspace.onboarding.")).length, 2);
});

test("no Core capability → no request; with the capability the entry is still off until all three steps ship", async () => {
  const without = modelFixture([]); await without.model.selectWorkspace("A");
  await assert.rejects(() => without.model.onboarding("A", "generation-A"));
  assert.equal(without.calls.some(call => call.method.startsWith("workspace.onboarding.")), false);
  assert.equal(ONBOARDING_STEPS_READY, false, "step 3 waits for C5, so the guide has no entry yet");
  assert.equal(modelFixture(["workspace.onboarding.v1"]).model.supportsOnboarding(), false);
  assert.match(read("../src/onboarding-steps.ts"), /ONBOARDING_STEP_VIEWS: OnboardingStepViews = \{ 1: OnboardingEngineStep, 2: OnboardingThirdPartyStep \};/, "steps 1 and 2 have shipped; step 3 waits for C5");
});

const common = (patch = {}) => ({ step: 1, readOnly: false, busy: false, notice: "", onLater() {}, ...patch });
for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`the sheet: modal dialog, mascot, three-step progress, «Later», Back from step 2 (${locale})`, () => {
  const t = makeT(locale);
  const sheet = patch => render(createElement(module.exports.OnboardingSheet, { ...common(patch), title: "T", sub: "S", actions: createElement("button", { className: "hs-btn pri" }, "Go") }, createElement("p", null, "body")), locale);
  const first = sheet();
  assert.match(first, /role="dialog" aria-modal="true" aria-labelledby="[^"]+"/);
  assert.ok(first.includes("hara-mascot") || first.includes("<img"), "mascot at the top");
  assert.ok(first.includes(`>${esc(t("ws.onboarding.later"))}</button>`));
  assert.ok(first.includes(`aria-label="${esc(t("ws.onboarding.progress", { n: 1 }))}"`));
  assert.match(first, /<li class="is-current" aria-current="step"><i aria-hidden="true">1<\/i>/);
  for (const name of ["engine", "thirdParty", "colleagues"]) assert.ok(first.includes(esc(t(`ws.onboarding.step.${name}`))));
  assert.ok(first.includes(esc(t("ws.onboarding.optional"))), "step 2 is marked optional");
  assert.equal(first.includes(`>${esc(t("ws.onboarding.back"))}</button>`), false, "no Back on step 1");
  const second = sheet({ step: 2, onBack() {} });
  assert.ok(second.includes(`>${esc(t("ws.onboarding.back"))}</button>`));
  assert.match(second, /<li class="is-done"><i aria-hidden="true">✓<\/i>/);
  assert.ok(second.includes(esc(t("ws.onboarding.stepDone"))), "done steps are announced");
  assert.ok(sheet({ readOnly: true }).includes(esc(t("ws.onboarding.readOnly"))));
  assert.ok(sheet({ notice: "ws.onboarding.saveFailed" }).includes(`role="alert">${esc(t("ws.onboarding.saveFailed"))}`));
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`the resume card says how many steps are left and which is next (${locale})`, () => {
  const t = makeT(locale), card = patch => render(createElement(module.exports.OnboardingResumeCard, { progress: progress(patch), onContinue() {}, onStop() {} }), locale);
  assert.ok(card({ step: 3 }).includes(esc(t("ws.onboarding.resumeOne", { step: t("ws.onboarding.step.colleagues") }))));
  assert.ok(card({ step: 1 }).includes(esc(t("ws.onboarding.resumeMany", { n: 3, step: t("ws.onboarding.step.engine") }))));
  assert.ok(card().includes(`>${esc(t("ws.onboarding.continue"))}</button>`) && card().includes(`>${esc(t("ws.onboarding.stop"))}</button>`));
  assert.ok(card({ readOnly: true }).includes(`>${esc(t("ws.onboarding.hide"))}</button>`), "a read-only viewer can only hide it for now");
});

test("the controller renders the current step's own body and nothing for a step that is not shipped", () => {
  const state = { surface: "sheet", progress: progress({ step: 2 }), busy: false, notice: "", later() {}, back() {}, next() {} };
  const Two = ({ sheet, progress: value }) => createElement(module.exports.OnboardingSheet, { ...sheet, title: `step ${value.step}`, sub: "", actions: null }, sheet.onBack ? "has-back" : "no-back");
  const html = render(createElement(module.exports.WorkspaceOnboarding, { state, steps: { 2: Two } }));
  assert.ok(html.includes("step 2") && html.includes("has-back"));
  assert.equal(render(createElement(module.exports.WorkspaceOnboarding, { state, steps: {} })), "");
  assert.equal(render(createElement(module.exports.WorkspaceOnboarding, { state: { ...state, surface: "resume" }, steps: { 2: Two } })), "");
});

test("mounted in the workspace: sheet as a modal (main is inert), resume card only in the Hara chat", () => {
  const app = read("../src/WorkspaceLocalDev.tsx");
  assert.match(app, /const onboarding = useWorkspaceOnboarding\(model, workspace, ONBOARDING_STEP_VIEWS\);/);
  assert.match(app, /const modalOpen = settings \|\| onboarding\.surface === "sheet" \|\|/);
  assert.match(app, /onboarding\.surface === "resume" && onboarding\.progress && \(!agent \|\| agent\.kind === "main"\) \? <OnboardingResumeCard/);
  assert.match(app, /onboarding\.surface === "sheet" && !settings && workspace \? <WorkspaceOnboarding state=\{onboarding\} model=\{model\} workspace=\{workspace\} steps=\{ONBOARDING_STEP_VIEWS\} \/>/);
  const hook = read("../src/WorkspaceOnboarding.tsx");
  assert.match(hook, /if \(progress\.readOnly\) \{ setProgress\(\{ \.\.\.progress, \.\.\.patch \}\); return true; \}/, "read-only never writes");
  assert.doesNotMatch(hook, /createBatch|agents\.create|preferences\.set|listModels|extensions\./, "progress never creates colleagues, changes preferences or probes engines");
});

test("onboarding CSS uses DESIGN tokens for radius and status colours", () => {
  const css = read("../src/workspace-onboarding.css");
  assert.match(css, /^@import "\.\/hara-tokens\.generated\.css" layer\(hara-tokens\);/);
  assert.doesNotMatch(css, /border-radius:\d+px|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.match(css, /@media \(max-width:600px\)\{.*\.wob-mascot\{display:none\}/, "the full mascot is dropped below its 128px floor instead of shrunk");
});

test("review of #82 — G-1: Tab stays inside the sheet, shortcuts are held, focus returns on close", () => {
  const source = read("../src/WorkspaceOnboarding.tsx");
  assert.match(source, /if \(event\.key !== "Tab"\) return;/);
  assert.match(source, /\["i", ","\]\.includes\(event\.key\.toLowerCase\(\)\)/, "⌘I / ⌘, do not open other panes behind the sheet");
  assert.match(source, /const previous = document\.activeElement as HTMLElement \| null;\s*return \(\) => \{ \(previous\?\.isConnected && previous !== document\.body \? previous : document\.querySelector<HTMLElement>\("\.wob-resume \.hs-btn\.pri"\)\)\?\.focus\(\); \};/);
});

test("review of #82 — G-2: no shipped view for the current step → no modal, no inert workspace", () => {
  const source = read("../src/WorkspaceOnboarding.tsx");
  assert.match(source, /const surface = !hasView \|\| hidden \? "none" : open \? "sheet"/, "no view → neither sheet nor a resume card whose Continue would do nothing (#83 L1)");
  assert.match(source, /open: \(\) => \{ if \(progress && workspaceId && hasView\)/);
  const state = { surface: "sheet", progress: progress({ step: 2 }), busy: false, notice: "", later() {}, back() {}, next() {} };
  assert.equal(render(createElement(module.exports.WorkspaceOnboarding, { state, steps: { 1: () => null } })), "");
});

test("review of #82 — L1: a failed «Don't show again» brings the card back with the error", () => {
  const source = read("../src/WorkspaceOnboarding.tsx");
  assert.match(source, /stop: \(\) => \{ setHidden\(true\); void save\(\{ dismissed: true \}\)\.then\(ok => \{ if \(!ok\) setHidden\(false\); \}\); \}/);
  const t = makeT("zh-Hans"), html = render(createElement(module.exports.OnboardingResumeCard, { progress: progress(), notice: "ws.onboarding.saveFailed", onContinue() {}, onStop() {} }));
  assert.ok(html.includes(`role="alert">${esc(t("ws.onboarding.saveFailed"))}`));
  assert.match(read("../src/WorkspaceLocalDev.tsx"), /<OnboardingResumeCard progress=\{onboarding\.progress\} notice=\{onboarding\.notice\}/);
});
