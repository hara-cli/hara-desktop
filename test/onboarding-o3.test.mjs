import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export * from "./src/OnboardingThirdPartyStep.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/OnboardingThirdPartyStep.tsx", import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function render(element, locale) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); } finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const workspace = { workspaceId: "A", resourceGeneration: "g", agents: [], connections: { connections: [] } };
const progress = { schemaVersion: 1, revision: 1, readOnly: false, recovered: false, runId: "r", step: 2, engineChoice: "codex", thirdPartySkipped: false, dismissed: false, completedAt: null };
const sheet = { step: 2, readOnly: false, busy: false, notice: "", onLater() {}, onBack() {} };

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`step 2 copy, boundary, «Not now» and «Next»; an old Core says so instead of listing (${locale})`, () => {
  const t = makeT(locale), calls = [];
  const html = render(createElement(module.exports.OnboardingThirdPartyStep, { progress, sheet, next() {}, workspace, model: { supportsExtensions: () => false, extensions: async () => { calls.push("list"); } } }), locale);
  for (const key of ["ws.onboarding.third.title", "ws.onboarding.third.sub", "ws.onboarding.third.boundary", "ws.extensions.unavailable"]) assert.ok(html.includes(esc(t(key))), key);
  assert.ok(html.includes(`>${esc(t("ws.onboarding.third.later"))}</button>`) && html.includes(`>${esc(t("ws.onboarding.engine.next"))}</button>`) && html.includes(`>${esc(t("ws.onboarding.back"))}</button>`));
  assert.deepEqual(calls, []);
});

test("step 2 only reads the list; turning a source on goes through the existing Plugins & MCP review panel", () => {
  assert.match(source, /model\.extensions\(workspace\.workspaceId, workspace\.resourceGeneration\)/);
  assert.doesNotMatch(source, /proposeExtensions|approveExtensions|extensions\.propose|extensions\.approve|createBatch|preferences/, "no direct writes from the step");
  assert.match(source, /<WorkspaceExtensions model=\{model\} workspaceId=\{workspace\.workspaceId\} generation=\{workspace\.resourceGeneration\} \/>/);
  assert.match(source, /onClick=\{\(\) => next\(\{ thirdPartySkipped: true \}\)\}/, "«Not now» records the skip");
  assert.match(source, /onClick=\{\(\) => next\(\{ thirdPartySkipped: false \}\)\}/);
});
