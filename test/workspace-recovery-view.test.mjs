import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { CONNECTION_RECOVERY_REASONS, connectionRecoveryReason, workspaceConversationReplying, workspaceRecoveryIdentity, workspaceRecoveryPromptVisible } from "../src/workspace-resume.ts";
const require = createRequire(import.meta.url);
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceTaskRecovery.tsx";export * from "./src/WorkspaceBoot.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} };new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { WorkspaceTaskRecovery, WorkspaceTaskActivity, WorkspaceBoot } = module.exports, { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
test("blocked and error checkpoints replace replying even while a physical request is still running or draining", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const state of ["running", "draining", "blocked", "error", "failed"]) for (const taskState of ["blocked", "error", "failed"]) {
    const t = makeT(locale), conversation = { state, taskState, blockReason: "Synthetic budget limit <exceeded>", resumeAdmission: { allowed: false, reason: "run_tokens" } };
    assert.equal(workspaceConversationReplying(conversation), false);
    assert.equal(render(h(WorkspaceTaskActivity, { conversation, name: "Hara", t })), "");
    const card = render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, onContinue() {}, onRepair() {} }));
    assert.ok(card.includes('role="alert"')); assert.ok(card.includes("Synthetic budget limit &lt;exceeded&gt;"));
    assert.ok(card.includes(t("ws.resume.budget"))); assert.ok(/<button[^>]*disabled/.test(card));
  }
});
test("only active work shows replying; completion, cancellation and a retained question stop it without dropping the transport lock", () => {
  const t = makeT("zh-Hans");
  for (const state of ["running", "draining"]) {
    const active = { state, taskState: "running" };
    assert.ok(render(h(WorkspaceTaskActivity, { conversation: active, name: "Hara", t })).includes(t(state === "draining" ? "ws.draining" : "ws.replying", { name: "Hara" })));
    for (const taskState of ["paused", "awaiting_user", "awaiting_review", "completed", "cancelled", "interrupted"]) {
      const stopped = { state, taskState };
      assert.equal(render(h(WorkspaceTaskActivity, { conversation: stopped, name: "Hara", t })), "");
      assert.equal(stopped.state, state, "rendering must not clear the host's physical-operation lock");
    }
  }
  for (const state of ["error", "failed"]) {
    const conversation = { state, taskState: null, blockReason: "Synthetic failure" };
    assert.equal(render(h(WorkspaceTaskActivity, { conversation, name: "Hara", t })), "");
    assert.ok(render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, onContinue() {}, onRepair() {} })).includes("Synthetic failure"));
  }
});
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
test("legacy 429 recovery inspects allowance evidence rather than rate-window quotas or appended hints", () => {
  const t = makeT("en"), props = { t, disabled: false, onContinue() {}, onRepair() {} };
  for (const message of ["exceeded your requests per minute quota", "requests per minute quota exhausted", "You exceeded your current quota", "每分鐘請求配額耗盡"]) for (const prefix of /per|每/.test(message) ? ["429 ", ""] : ["429 "]) {
    const conversation = { state: "blocked", blockReason: `[openai error] ${prefix}${message} — the provider reported this account allowance or balance is exhausted; select another authorized connection or wait for its reset` };
    assert.equal(connectionRecoveryReason(conversation), null);
    assert.ok(render(h(WorkspaceTaskRecovery, { ...props, conversation })).includes(t("ws.resume.action")));
  }
  for (const message of ["insufficient quota", "account balance is exhausted", "账户额度已用尽", "帳戶配額已耗盡"]) {
    assert.equal(connectionRecoveryReason({ state: "blocked", blockReason: `[openai error] 429 ${message}` }), "connection_quota_exhausted");
  }
  assert.equal(connectionRecoveryReason({ state: "blocked", blockReason: "[openai error] 429 rate limit", resumeAdmission: { allowed: false, reason: "connection_quota_exhausted" } }), "connection_quota_exhausted", "structured insufficient_quota evidence takes precedence");
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

test("a stopped task explains physical cleanup and keeps continuation locked until the next idle snapshot", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const state of ["running", "draining"]) {
    const t = makeT(locale), conversation = { state, taskState: "blocked", blockReason: "Synthetic stop", resumeAdmission: { allowed: true, reason: null } };
    const props = { t, disabled: false, continueDisabled: false, onContinue() { throw new Error("must not auto-continue"); }, onRepair() {} };
    const busy = render(h(WorkspaceTaskRecovery, { ...props, conversation }));
    assert.ok(busy.includes(t("ws.resume.finishing"))); assert.ok(/<button[^>]*disabled/.test(busy));
    assert.equal(render(h(WorkspaceTaskActivity, { conversation, name: "Hara", t })), "");
    const idle = render(h(WorkspaceTaskRecovery, { ...props, conversation: { ...conversation, state: "blocked" } }));
    assert.equal(idle.includes(t("ws.resume.finishing")), false); assert.equal(/<button[^>]*disabled/.test(idle), false);
  }
});

test("error and failed checkpoints always explain the failure, including a missing reason and typed connection repair", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const taskState of ["error", "failed"]) for (const state of ["blocked", "running", "draining", "error", "failed"]) {
    const t = makeT(locale), props = { t, disabled: false, onContinue() {}, onRepair() {} };
    for (const blockReason of [undefined, null, "", "   ", "Synthetic failure <details>"]) {
      const conversation = { state, taskState, blockReason };
      const html = render(h(WorkspaceTaskRecovery, { ...props, conversation }));
      assert.ok(html.includes('role="alert"'));
      assert.ok(html.includes(blockReason?.trim() ? "Synthetic failure &lt;details&gt;" : t("ws.resume.failureUnknown")));
      assert.equal(html.includes("<details>"), false);
    }
    for (const reason of CONNECTION_RECOVERY_REASONS) {
      const conversation = { state, taskState, blockReason: "SYNTHETIC_PRIVATE_PROVIDER_BODY", resumeAdmission: { allowed: false, reason } };
      const html = render(h(WorkspaceTaskRecovery, { ...props, conversation }));
      assert.ok(html.includes('role="alert"')); assert.ok(html.includes(t(`ws.resume.${reason}`)));
      assert.ok(html.includes(t("ws.resume.repairAction"))); assert.equal(html.includes("SYNTHETIC_PRIVATE_PROVIDER_BODY"), false);
      assert.equal(/<button[^>]*disabled/.test(html), false, "settings repair stays available while the old action finishes");
    }
  }
});


test("legacy failed conversation states without a task checkpoint still show an explicit fallback reason", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const state of ["error", "failed"]) {
    const t = makeT(locale), conversation = { state, taskState: null, blockReason: null };
    const html = render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, onContinue() {}, onRepair() {} }));
    assert.ok(html.includes('role="alert"')); assert.ok(html.includes(t("ws.resume.failureUnknown")));
    assert.equal(render(h(WorkspaceTaskActivity, { conversation, name: "Hara", t })), "");
  }
});


test("cleared history hides the Soft Dark resume card even when Core still reports a blocked attempt", () => {
  const t = makeT("zh-Hans"), props = { t, disabled: false, onContinue() {}, onRepair() {} };
  const conversation = { state: "blocked", taskState: "blocked", runId: "run-1", taskId: "task-1", sessionId: "session-1",
    history: [], resumeAdmission: { allowed: true, reason: null }, blockReason: "Synthetic stop" };
  assert.equal(workspaceRecoveryPromptVisible(conversation), false);
  assert.equal(render(h(WorkspaceTaskRecovery, { ...props, conversation })), "");
});

test("explicit dismiss / new chat suppresses the resume card for that run identity only", () => {
  const t = makeT("zh-Hans"), props = { t, disabled: false, onContinue() { throw new Error("must not continue"); }, onRepair() {} };
  const conversation = { state: "blocked", taskState: "blocked", runId: "run-keep", taskId: "task-keep", sessionId: "session-1",
    history: [{ role: "user", content: "hi" }], resumeAdmission: { allowed: true, reason: null }, blockReason: "Synthetic stop" };
  assert.equal(workspaceRecoveryIdentity(conversation), "run:run-keep");
  assert.ok(workspaceRecoveryPromptVisible(conversation, null));
  const shown = render(h(WorkspaceTaskRecovery, { ...props, conversation, onDismiss() {} }));
  assert.ok(shown.includes(t("ws.resume.action")));
  assert.ok(shown.includes(t("ws.resume.dismiss")));
  assert.ok(shown.includes('data-recovery-dismiss="true"'));
  assert.equal(workspaceRecoveryPromptVisible(conversation, "run:run-keep"), false);
  assert.equal(render(h(WorkspaceTaskRecovery, { ...props, conversation, dismissedIdentity: "run:run-keep", onDismiss() {} })), "");
  const newer = { ...conversation, runId: "run-next" };
  assert.ok(workspaceRecoveryPromptVisible(newer, "run:run-keep"));
  assert.ok(render(h(WorkspaceTaskRecovery, { ...props, conversation: newer, dismissedIdentity: "run:run-keep", onDismiss() {} })).includes(t("ws.resume.action")));
});

test("connection repair cards also expose start-new-chat dismiss without auto-resume", () => {
  const t = makeT("zh-Hans");
  const conversation = { state: "blocked", resumeAdmission: { allowed: false, reason: "connection_quota_exhausted" },
    history: [{ role: "user", content: "hi" }], runId: "run-quota" };
  const html = render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, onContinue() { throw new Error("no"); },
    onRepair() {}, onDismiss() {} }));
  assert.ok(html.includes(t("ws.resume.repairAction")));
  assert.ok(html.includes(t("ws.resume.dismiss")));
  assert.equal(html.includes(t("ws.resume.action")), false);
});
