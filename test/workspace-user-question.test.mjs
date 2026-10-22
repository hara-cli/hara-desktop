import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceRpcWaitError } from "../src/workspace-dev-errors.ts";
import { workspaceConversationReplying } from "../src/workspace-resume.ts";
import { makeT } from "../src/i18n.ts";
const require = createRequire(import.meta.url);
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceUserQuestion.tsx";export * from "./src/WorkspaceTaskRecovery.tsx";export * from "./src/WorkspaceLocalChannels.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { WorkspaceUserQuestion, WorkspaceTaskActivity, WorkspaceTaskRecovery, LocalChannelThread } = module.exports;
const { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const q = { id: "question-1", reason: "lookup_missing", question: "Which <colleague> & item?", options: ["Alpha <script>", "Beta"], taskId: "task-1", runId: "run-1" };
const conversation = { state: "awaiting_user", taskState: "paused", pendingQuestion: q, resumeAdmission: { allowed: true, reason: null } };
function fixture({ supported = true, unknown = false, budget = true } = {}) {
  const calls = []; let serial = 0, current = "A";
  const snapshot = workspaceId => ({ workspaceId, resourceGeneration: `gen-${workspaceId}`, label: workspaceId, selectedAgentId: "main", syntheticOnly: true,
    agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", available: true } }],
    connections: { revision: 1, defaultConnectionId: "synthetic", connections: [] }, approvals: [],
    conversation: { ...conversation, sessionId: `${workspaceId}-main`, revision: 1, taskId: "task-1", runId: "run-1", objective: "Synthetic", history: [], pastTaskCount: 0,
      usage: { modelCalls: 2, inputTokens: 200, outputTokens: 40 }, runUsage: { modelCalls: 2, inputTokens: 200, outputTokens: 40 }, completion: { state: "awaiting_user" },
      pendingQuestion: workspaceId === "A" ? q : null, resumeAdmission: { allowed: budget, reason: budget ? null : "run_tokens" } } });
  const rpc = { supportsCapability: capability => supported && capability === "workspace.user-interaction.v1", async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, activeWorkspaceId: current, syntheticOnly: true,
      workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, label: workspaceId, role: "owner", active: true })) };
    if (["workspace.select", "workspace.snapshot", "workspace.agent.select"].includes(method)) { current = params.workspaceId; return snapshot(current); }
    if (method === "workspace.session.answer" && unknown) throw new WorkspaceRpcWaitError();
    if (method === "workspace.session.receipt") return { ...params, state: "unknown", runId: null, reason: null };
    return {};
  } };
  const model = new WorkspaceDevModel(rpc, () => `nonce-${++serial}`);
  return { model, calls, rpc, ready: () => model.selectWorkspace("A") };
}

test("question cards show the saved checkpoint and escaped options in all three languages", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = render(h(WorkspaceUserQuestion, { conversation, t, disabled: false, supported: true, onAnswer() {}, onRepair() {} }));
    for (const key of ["ws.question.title", "ws.question.saved", "ws.question.continue", "ws.question.noDefault"]) assert(html.includes(t(key)));
    assert(html.includes("Which &lt;colleague&gt; &amp; item?")); assert(html.includes("Alpha &lt;script&gt;")); assert.equal(html.includes("<script>"), false);
    assert(html.includes('data-task-state="awaiting_user"'));
    assert.equal(render(h(WorkspaceTaskRecovery, { conversation, t, disabled: false, onContinue() {}, onRepair() {} })), "");
    for (const state of ["running", "draining", "awaiting_user"]) {
      const pending = { ...conversation, state, taskState: "running" };
      assert.equal(workspaceConversationReplying(pending), false);
      assert.equal(render(h(WorkspaceTaskActivity, { conversation: pending, name: "Hara", t })), "");
    }
  }
});

test("unknown, draining, exhausted and old-runtime cards never enable an answer", () => {
  const t = makeT("en");
  for (const variant of [{ disabled: true }, { supported: false }, { conversation: { ...conversation, state: "draining" } },
    { conversation: { ...conversation, resumeAdmission: { allowed: false, reason: "run_tokens" } } }]) {
    const html = render(h(WorkspaceUserQuestion, { conversation, t, disabled: false, supported: true, onAnswer() {}, onRepair() {}, ...variant }));
    assert.equal((html.match(/<button[^>]*>/g) ?? []).every(button => button.includes("disabled")), true);
  }
});

test("answers bind the displayed question, scope and nonce, and leave an unrelated chat draft intact", async () => {
  const a = fixture(); await a.ready(); a.model.setDraft("Keep this separate draft");
  await a.model.answer(q.id, "Beta");
  const answer = a.calls.find(call => call.method === "workspace.session.answer");
  assert.deepEqual(answer.params, { workspaceId: "A", expectedGeneration: "gen-A", agentId: "main", message: "Beta", requestId: "nonce-1", questionId: q.id });
  assert.equal(a.model.getSnapshot().draft, "Keep this separate draft");
  assert.equal(a.calls.some(call => /session\.(send|resume)$/.test(call.method)), false);
});

test("ordinary send, empty answers, continue commands and stale questions never dispatch", async () => {
  const a = fixture(); await a.ready(); a.model.setDraft("Guess");
  await a.model.send(); await a.model.send(true); await a.model.answer(q.id, " "); await a.model.answer(q.id, "/continue");
  await a.model.answer("old-question", "Beta"); await a.model.selectWorkspace("B"); await a.model.answer(q.id, "Beta");
  assert.equal(a.calls.some(call => /session\.(send|resume|answer)$/.test(call.method)), false);
});

test("a missing capability or exhausted original budget never falls back to a new task", async () => {
  for (const options of [{ supported: false }, { budget: false }]) {
    const a = fixture(options); await a.ready(); await a.model.answer(q.id, "Beta");
    assert.equal(a.calls.some(call => /session\.(send|resume|answer)$/.test(call.method)), false);
    assert(a.model.getSnapshot().error);
  }
});

test("a timed-out answer is checked with its original receipt, never automatically resent", async () => {
  const a = fixture({ unknown: true }); await a.ready(); await a.model.answer(q.id, "Beta");
  assert.equal(a.model.getSnapshot().pendingUnknown, true);
  await a.model.verifyPending(); await a.model.answer(q.id, "Beta");
  assert.equal(a.calls.filter(call => call.method === "workspace.session.answer").length, 1);
  const receipts = a.calls.filter(call => call.method === "workspace.session.receipt");
  assert(receipts.length >= 1); assert(receipts.every(call => call.params.requestId === "nonce-1"));
});


test("a local channel renders the same scoped question card and disables it when disconnected", () => {
  const t = makeT("en"), channel = { workspaceId: "A", resourceGeneration: "g-A", channel: { id: "channel", name: "Synthetic", memberIds: ["colleague"] }, revision: 1,
    state: "completed", messages: [], turns: [], approvals: [], questions: [{ agentId: "colleague", displayName: "Alpha", conversation }] };
  const props = { view: { channel, pending: null, historyAnchor: null }, colleagues: [], t, retry() {}, transcript() { return null; }, approval() { return null; },
    model: { setHistoryAnchor() {}, supportsUserQuestions: () => true, answer() {} }, onRepair() {} };
  const html = render(h(LocalChannelThread, props));
  assert(html.includes('data-question-agent="colleague"')); assert(html.includes("Which &lt;colleague&gt; &amp; item?"));
  const disconnected = render(h(LocalChannelThread, { ...props, disabled: true }));
  assert.equal((disconnected.match(/<button[^>]*>/g) ?? []).every(button => button.includes("disabled")), true);
});


test("a hard budget limit leaves the explicit keep-paused action available", () => {
  const t = makeT("en"), html = render(h(WorkspaceUserQuestion, { conversation: { ...conversation, resumeAdmission: { allowed: false, reason: "run_tokens" } },
    t, disabled: false, supported: true, onAnswer() {}, onRepair() {}, onPause() {} }));
  const pause = html.match(/<button[^>]*data-question-action="pause"[^>]*>/)?.[0];
  assert(pause); assert.equal(pause.includes("disabled"), false); assert(html.includes(t("ws.question.pause")));
});

test("keeping a question paused sends only its scoped state operation, never a model command", async () => {
  const a = fixture({ budget: false }); await a.ready(); await a.model.pauseQuestion(q.id);
  const pause = a.calls.find(call => call.method === "workspace.session.pause-question");
  assert.deepEqual(pause.params, { workspaceId: "A", expectedGeneration: "gen-A", agentId: "main", questionId: q.id });
  assert.equal(a.calls.some(call => /session\.(send|resume|answer)$/.test(call.method)), false);
});


test("a late pause reply cannot clear another Workspace's in-flight message", async () => {
  const a = fixture(); await a.ready();
  let finishPause, finishSend;
  const paused = new Promise(resolve => { finishPause = resolve; }), sent = new Promise(resolve => { finishSend = resolve; });
  const request = a.rpc.request;
  a.rpc.request = async (method, params) => {
    if (method === "workspace.session.pause-question") return paused;
    if (method === "workspace.session.send") return sent;
    return request(method, params);
  };
  const pendingPause = a.model.pauseQuestion(q.id);
  await a.model.selectWorkspace("B"); a.model.setDraft("New work in B"); const pendingSend = a.model.send();
  assert.equal(a.model.getSnapshot().sending, true);
  finishPause({ state: "paused" }); await pendingPause;
  assert.equal(a.model.getSnapshot().workspace.workspaceId, "B"); assert.equal(a.model.getSnapshot().sending, true);
  finishSend({}); await pendingSend;
});
