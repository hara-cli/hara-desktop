import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { CONNECTION_RECOVERY_REASONS, connectionRecoveryReason } from "../src/workspace-resume.ts";
const require = createRequire(import.meta.url);
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceTaskRecovery.tsx";export * from "./src/WorkspaceBoot.tsx";', resolveDir: new URL("../", import.meta.url).pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} };new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { WorkspaceTaskRecovery, WorkspaceBoot } = module.exports, { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
test("all connection recovery reasons replace generic continuation with repair guidance in three languages", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const reason of CONNECTION_RECOVERY_REASONS) {
    const t = makeT(locale), conversation = { state: "blocked", resumeAdmission: { allowed: false, reason }, blockReason: "private raw provider body" };
    const html = render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, continueDisabled: true, onContinue() {}, onRepair() {} }));
    assert.ok(html.includes(t("ws.resume.repairAction")));assert.ok(html.includes(t(`ws.resume.${reason}`)));assert.ok(html.includes(t("ws.resume.repairBody")));
    assert.equal(html.includes(t("ws.resume.action")), false);assert.equal(html.includes("private raw provider body"), false);
    assert.equal(/<button[^>]*disabled/.test(html), false, 'repair settings must stay available without a working model connection');
  }
});
test("old 404 snapshots get a repair card while transient and budget pauses retain their distinct continuation behavior", () => {
  const t = makeT("zh-Hans"), props = { t, disabled: false, onContinue() {}, onRepair() {} };
  const legacy = { state: "blocked", blockReason: "[openai error] 404 The requested model does not support the agent plan feature" };
  assert.equal(connectionRecoveryReason(legacy), "connection_model_unavailable");
  assert.ok(render(h(WorkspaceTaskRecovery, { ...props, conversation: legacy })).includes(t("ws.resume.repairAction")));
  for (const conversation of [{ state: "blocked", blockReason: "[openai error] network timeout", resumeAdmission: { allowed: true, reason: null } },
    { state: "blocked", resumeAdmission: { allowed: false, reason: "run_tokens" } }]) {
    const html = render(h(WorkspaceTaskRecovery, { ...props, conversation }));assert.ok(html.includes(t("ws.resume.action")));
    assert.equal(/<button[^>]*disabled/.test(html), conversation.resumeAdmission.allowed === false);
  }
  assert.equal(connectionRecoveryReason({ state: "blocked", blockReason: "Tool result: 404 file missing" }), null);
});
test("boot shows a fixed diagnostic and attempt receipt, then disables reconnect during every in-flight phase", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const phase of ["failed", "connecting", "handshake", "loading"]) {
      const busy = phase !== "failed", html = render(h(WorkspaceBoot, { t, mode: "workspace", onReconnect() {}, view: { phase, attempt: 2, diagnostic: busy ? null : "CORE_EXITED", model: null, root: "" } }));
      assert.ok(html.includes(t("ws.boot.attempt", { n: 2 })));assert.ok(html.includes('role="status"'));
      assert.equal(/<button[^>]*disabled/.test(html), busy);assert.ok(html.includes(t(busy ? "ws.boot.reconnecting" : "ws.reconnect")));
      assert.equal(html.includes("CORE_EXITED"), !busy);assert.equal(html.includes("token"), false);
    }
  }
});
