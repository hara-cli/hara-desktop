import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { WorkspaceDevModel, workspaceAsyncAsks } from "../src/workspace-dev-state.ts";
import { WorkspaceRpcWaitError } from "../src/workspace-dev-errors.ts";
import { workspaceConversationReplying } from "../src/workspace-resume.ts";
import { makeT } from "../src/i18n.ts";
const require = createRequire(import.meta.url);
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceUserQuestion.tsx";export * from "./src/WorkspaceTaskRecovery.tsx";export * from "./src/WorkspaceLocalChannels.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { WorkspaceUserQuestion, WorkspaceAsyncQuestions, WorkspaceTaskActivity, WorkspaceTaskRecovery, LocalChannelThread } = module.exports;
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
    for (const key of ["ws.question.title", "ws.question.saved", "ws.question.composerHint", "ws.question.noDefault"]) assert(html.includes(t(key)));
    assert.equal(html.includes("wsd-ask-form"), false); assert.equal(/<(textarea|input)\b/.test(html), false, "the card has no second text input");
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
  assert(receipts.length >= 1);
  for (const receipt of receipts) assert.deepEqual(receipt.params,
    { workspaceId: "A", expectedGeneration: "gen-A", agentId: "main", requestId: "nonce-1" });
  assert.equal(a.calls.some(call => /session\.(send|resume)$/.test(call.method)), false);
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

test("a pending pause remains busy after leaving and returning to the same Workspace", async () => {
  const a = fixture(); await a.ready(); let finishPause;
  const wait = new Promise(resolve => { finishPause = resolve; }), request = a.rpc.request;
  a.rpc.request = (method, params) => method === "workspace.session.pause-question" ? wait : request(method, params);
  const pending = a.model.pauseQuestion(q.id);
  try {
    await a.model.selectWorkspace("B"); await a.model.selectWorkspace("A");
    assert.equal(a.model.getSnapshot().sending, true, "refresh must retain the scoped in-flight pause");
    await a.model.answer(q.id, "Beta");
    assert.equal(a.calls.some(call => call.method === "workspace.session.answer"), false);
  } finally { finishPause({ state: "paused" }); await pending; }
  assert.equal(a.model.getSnapshot().sending, false);
});

test("the pending question reads as one layered answer card, not a resume dialog", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), stepped = { ...conversation, pendingQuestion: { ...q, step: "Rename the coding colleague" } };
    const html = render(h(WorkspaceUserQuestion, { conversation: stepped, t, disabled: false, supported: true, onAnswer() {}, onRepair() {} }));
    assert.equal(html.includes("wsd-resume"), false); assert(html.includes("wsd-ask"));
    const head = html.indexOf("wsd-ask-head"), body = html.indexOf("wsd-user-question-text"), step = html.indexOf("wsd-ask-step"), foot = html.indexOf("wsd-ask-foot");
    assert(head >= 0 && head < body && body < step && step < foot);
    assert(html.includes(`id="question-${q.id}"`) && /<p id="question-question-1" class="wsd-user-question-text">/.test(html));
    assert.equal((html.match(/<textarea/g) ?? []).length, 0);
    assert.equal(/补充|補充|needs your input/.test(t("ws.question.title")), false);
  }
});

test("chat keeps one composer and shows the pending question in the message stream", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  const thread = source.indexOf('<div className="hs-col wsd-thread">'), card = source.indexOf("<WorkspaceUserQuestion", thread), end = source.indexOf("<div ref={end} />", thread);
  assert(thread >= 0 && thread < card && card < end, "the sync card renders at the end of the thread");
  assert.equal(source.includes('placement="composer"'), false);
  assert.equal(source.includes("workspace.conversation.pendingQuestion ? <footer"), false, "the composer slot is never replaced");
  assert(/question \? model\.answerDraft\(\) : model\.send\(\)/.test(source), "a pending question takes the composer draft as its answer");
});

test("the composer draft answers the pending question once and clears; /continue never counts as an answer", async () => {
  const a = fixture(); await a.ready(); a.model.setDraft("/continue"); await a.model.answerDraft();
  assert.equal(a.calls.some(call => call.method === "workspace.session.answer"), false);
  a.model.setDraft("  Beta  "); await a.model.answerDraft();
  const sent = a.calls.filter(call => call.method === "workspace.session.answer");
  assert.equal(sent.length, 1); assert.equal(sent[0].params.questionId, q.id); assert.equal(sent[0].params.message, "Beta");
  assert.equal(a.model.getSnapshot().draft, "");
});

test("Core's built-in English question template is shown in the viewer's Chinese", () => {
  const en = "Two lookups did not identify the target. Which colleague or item do you mean? Please provide its name, former name or location.";
  const t = makeT("zh-Hans"), html = render(h(WorkspaceUserQuestion, { conversation: { ...conversation, pendingQuestion: { ...q, question: en } }, t, disabled: false, supported: true, onAnswer() {}, onRepair() {} }));
  assert.equal(html.includes("Two lookups"), false); assert(html.includes(t("ws.question.template.lookup_missing")));
});

// Unified Core interaction (workspace.interaction.v2): async asks never replace or lock the composer.
const asyncAsk = { requestId: "async-1", kind: "ask_user_question", delivery: "async",
  questions: [{ question: "Which <format> for the report?", header: "Report format", options: ["PDF", "Markdown"] }],
  metadata: { reason: "explicit", taskId: "task-1", runId: "run-1" } };
const syncAsk = { ...asyncAsk, requestId: q.id, delivery: "sync" };
const permission = { requestId: "approval-1", kind: "permission", delivery: "sync", action: "agent_create", summary: "agent_create: Alpha", metadata: { runId: "run-1" } };
function asyncFixture({ v2 = true } = {}) {
  const calls = [];
  const running = { state: "running", taskState: "running", sessionId: "A-main", revision: 1, taskId: "task-1", runId: "run-1", objective: "Synthetic", history: [], pastTaskCount: 0,
    usage: { modelCalls: 1, inputTokens: 10, outputTokens: 5 }, runUsage: { modelCalls: 1, inputTokens: 10, outputTokens: 5 }, completion: null,
    pendingQuestion: null, pendingInteractions: [permission, asyncAsk], resumeAdmission: { allowed: true, reason: null } };
  const rpc = { supportsCapability: capability => capability === "workspace.user-interaction.v1" || (v2 && capability === "workspace.interaction.v2"),
    async request(method, params) {
      calls.push({ method, params });
      if (method === "workspace.list") return { revision: 1, activeWorkspaceId: "A", syntheticOnly: true, workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true }] };
      if (["workspace.select", "workspace.snapshot", "workspace.agent.select"].includes(method)) return { workspaceId: "A", resourceGeneration: "gen-A", label: "A", selectedAgentId: "main", syntheticOnly: true,
        agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", available: true } }],
        connections: { revision: 1, defaultConnectionId: "synthetic", connections: [] }, approvals: [], conversation: running };
      return { accepted: true };
    } };
  const model = new WorkspaceDevModel(rpc, () => "nonce");
  return { model, calls, ready: () => model.selectWorkspace("A") };
}

test("only async ask_user_question interactions are treated as non-blocking cards", () => {
  assert.deepEqual(workspaceAsyncAsks({ pendingInteractions: [permission, syncAsk, asyncAsk] }).map(row => row.requestId), ["async-1"]);
  assert.deepEqual(workspaceAsyncAsks({}), [], "an older Core without pendingInteractions shows no async cards");
  assert.deepEqual(workspaceAsyncAsks(null), []);
});

test("async cards render escaped question and options without a second answer field", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = render(h(WorkspaceAsyncQuestions, { asks: [asyncAsk], t, disabled: false, onAnswer() {} }));
    assert(html.includes('data-delivery="async"')); assert(html.includes("Which &lt;format&gt; for the report?")); assert(html.includes("Report format"));
    assert(html.includes(t("ws.question.async.note"))); assert.equal((html.match(/<textarea/g) ?? []).length, 0, "the composer textarea is never duplicated");
    assert.equal(html.includes('data-task-state="awaiting_user"'), false, "async does not mark the task as awaiting the user");
  }
  assert.equal(render(h(WorkspaceAsyncQuestions, { asks: [], t: makeT("en"), disabled: false, onAnswer() {} })), "");
  const off = render(h(WorkspaceAsyncQuestions, { asks: [asyncAsk], t: makeT("en"), disabled: true, onAnswer() {} }));
  assert.equal((off.match(/<button[^>]*>/g) ?? []).every(button => button.includes("disabled")), true);
});

test("async answers send only the scoped async state write, never a session message or resume", async () => {
  const a = asyncFixture(); await a.ready(); a.model.setDraft("Unrelated draft");
  await a.model.answerAsync("async-1", "  PDF  ");
  const sent = a.calls.filter(call => call.method === "workspace.session.answer-async");
  assert.deepEqual(sent.map(call => call.params), [{ workspaceId: "A", expectedGeneration: "gen-A", agentId: "main", questionId: "async-1", message: "PDF" }]);
  assert.equal(a.model.getSnapshot().draft, "Unrelated draft");
  await a.model.answerAsync("stale", "PDF"); await a.model.answerAsync("async-1", " "); await a.model.answerAsync("async-1", "/continue");
  assert.equal(a.calls.filter(call => call.method === "workspace.session.answer-async").length, 1);
  assert.equal(a.calls.some(call => /session\.(send|resume|answer)$/.test(call.method)), false);
  const old = asyncFixture({ v2: false }); await old.ready(); await old.model.answerAsync("async-1", "PDF");
  assert.equal(old.calls.some(call => call.method === "workspace.session.answer-async"), false, "an older Core without the v2 capability is never sent the new method");
});

test("the sync card shows a model header and the rename-target intent instead of the generic reason", () => {
  const t = makeT("zh-Hans"), renamed = { ...conversation, pendingQuestion: { ...q, reason: "lookup_ambiguous", intent: "rename_target", header: "改名确认" } };
  const html = render(h(WorkspaceUserQuestion, { conversation: renamed, t, disabled: false, supported: true, onAnswer() {}, onRepair() {} }));
  assert(html.includes("改名确认")); assert(html.includes(t("ws.question.intent.rename_target")));
  assert.equal(html.includes(t("ws.question.reason.lookup_ambiguous")), false);
});

test("async cards sit inside the normal composer footer above the textarea", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  const asyncCards = source.indexOf("<WorkspaceAsyncQuestions"), composer = source.indexOf('<div className="hs-field wsd-composer"><textarea');
  assert(asyncCards >= 0 && asyncCards < composer, "async cards render in the composer footer, above the still-enabled textarea");
});
