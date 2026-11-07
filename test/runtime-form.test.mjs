import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { RUNTIME_FORM_KEYS } from "../src/runtime-form-i18n.ts";
import { RUNTIME_FAILURE_MARKER } from "../src/runtime-failure.ts";
import { AUTO_EFFORT, ENGINE_DEFAULT_EFFORT, changedFields, defaultModel, effortChoices, effortForWire, engineStatus, formBaseline,
  modelLevels, reconcileEffort, savedEffortChoice, separateLoginOffered, canApplyPiModel, piModelErrorKey } from "../src/runtime-form.ts";

const sol = { id: "sol", label: "Sol", supportedReasoningEfforts: ["xhigh", "low", "high", "medium"] };
const luna = { id: "luna", label: "Luna", supportedReasoningEfforts: ["low", "medium"] };
const plain = { id: "plain", label: "Plain" };

test("effort choices: Auto, then Engine default (not for Pi), then declared levels low→high; none without levels", () => {
  assert.deepEqual(effortChoices(sol, "codex"), ["auto", "engine-default", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(effortChoices(sol, "pi"), ["auto", "low", "medium", "high", "xhigh"]);
  assert.deepEqual(effortChoices(plain, "claude"), [], "a model without levels hides the control");
  assert.deepEqual(modelLevels(sol, "opencode"), [], "OpenCode never takes an effort");
});

test("reconcile keeps Auto, Engine default and declared levels; otherwise Auto with the dropped level (Q4)", () => {
  assert.deepEqual(reconcileEffort("high", luna, "codex"), { effort: AUTO_EFFORT, dropped: "high" });
  assert.deepEqual(reconcileEffort("medium", luna, "codex"), { effort: "medium", dropped: null });
  assert.deepEqual(reconcileEffort(ENGINE_DEFAULT_EFFORT, plain, "claude"), { effort: ENGINE_DEFAULT_EFFORT, dropped: null });
  assert.deepEqual(reconcileEffort(ENGINE_DEFAULT_EFFORT, sol, "pi"), { effort: AUTO_EFFORT, dropped: null }, "Pi has no engine-default choice");
  assert.deepEqual(reconcileEffort(AUTO_EFFORT, plain, "gemini"), { effort: AUTO_EFFORT, dropped: null });
});

test("default model order: saved → engine default → recommended → first → engine default (empty list)", () => {
  assert.equal(defaultModel({ models: [luna, sol], defaultModelId: "sol", selected: { modelId: "luna", effort: null } }), "luna");
  assert.equal(defaultModel({ models: [luna, sol], defaultModelId: "sol", selected: { modelId: "gone", effort: null } }), "sol");
  assert.equal(defaultModel({ models: [luna, { ...sol, recommended: true }], defaultModelId: null, selected: null }), "sol");
  assert.equal(defaultModel({ models: [luna, sol], defaultModelId: null, selected: null }), "luna");
  assert.equal(defaultModel({ models: [], defaultModelId: null, selected: null }), "");
});

test("saved effort, wire value and unsaved fields", () => {
  assert.equal(savedEffortChoice(null), "auto"); assert.equal(savedEffortChoice("auto"), "auto"); assert.equal(savedEffortChoice("engine-default"), "engine-default");
  assert.equal(effortForWire("auto"), null, "Auto keeps its legacy null on the wire"); assert.equal(effortForWire("engine-default"), "engine-default");
  const baseline = formBaseline({ models: [sol], defaultModelId: "sol", selected: { modelId: "sol", effort: "medium" } });
  assert.deepEqual(baseline, { model: "sol", effort: "medium" });
  assert.deepEqual(changedFields({ runtimeId: "codex" }, { runtimeId: "codex", model: "sol", effort: "medium" }, baseline), []);
  assert.deepEqual(changedFields({ runtimeId: "codex" }, { runtimeId: "claude", model: "opus", effort: "medium" }, baseline), ["engine", "model"]);
  assert.deepEqual(changedFields({ runtimeId: "codex" }, { runtimeId: "codex", model: "sol", effort: "high" }, null), [], "no data yet → nothing counted");
});

test("engine status keys are closed and only Codex/Claude offer a separate Hara sign-in", () => {
  assert.deepEqual(engineStatus("unavailable", "not_installed"), { key: "ws.rf.status.unavailable", reasonKey: "ws.rf.reason.not_installed" });
  assert.deepEqual(engineStatus("unavailable", "<script>"), { key: "ws.rf.status.unavailable", reasonKey: "ws.rf.reason.unknown" });
  assert.deepEqual(engineStatus("confirm_update", undefined), { key: "ws.rf.status.confirm_update" });
  assert.equal(engineStatus("invented", undefined), null); assert.equal(engineStatus(undefined, undefined), null);
  assert.deepEqual(["codex", "claude", "gemini", "kimi", "copilot"].map(separateLoginOffered), [true, true, false, false, false]);
});

test("form copy is complete in three languages and uses everyday Chinese", () => {
  const keys = new Set();
  for (const row of RUNTIME_FORM_KEYS) {
    assert.equal(row.length, 4); assert.ok(!keys.has(row[0]), row[0]); keys.add(row[0]);
    for (const value of row.slice(1)) assert.ok(value.trim(), row[0]);
    for (const value of row.slice(2)) assert.doesNotMatch(value, /登记|登記|注册|註冊|校验|校驗|驱动|驅動|改绑|改綁|Runtime/, row[0]);
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const [key] of RUNTIME_FORM_KEYS) assert.notEqual(t(key), key, `${locale} ${key}`);
  }
  assert.equal(makeT("zh-Hans")("ws.rf.recoveryConfirm"), "确认并继续");
});

const snapshot = (runtime = "codex", state = "completed") => ({ workspaceId: "A", resourceGeneration: "generation-1", selectedAgentId: "lin", label: "A",
  agents: [{ agentId: "lin", kind: "colleague", state: "active", configRevision: 4, agentEpoch: 2, permissionTier: "full-protected", identity: { displayName: "小林" }, runtime: { id: runtime, label: runtime, available: true } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, approvals: [], syntheticOnly: true,
  conversation: { revision: 1, state, sessionId: "A-lin", taskId: null, runId: null, taskState: null, objective: "", history: [{ role: "user", content: "hi" }], pastTaskCount: 0, completion: null,
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, runUsage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 } } });
const form = { runtimeId: "claude", use: "confirm_first_use", version: "2.3.1", path: "/bin/claude", fingerprint: "f".repeat(64), loginSource: "isolated",
  models: [{ id: "sonnet", label: "Sonnet", supportedReasoningEfforts: ["low", "high"] }], defaultModelId: "sonnet", modelSource: "official", effortSupported: true,
  selected: null, revision: 0, sharedWith: [{ agentId: "zhou", displayName: "小周" }] };
function fixture({ supported = true, formResult = form, applyResult = { applied: ["confirm", "runtime", "model"] } } = {}) {
  let runtime = "codex"; const calls = [];
  const rpc = { supportsCapability: capability => supported && capability === "workspace.runtime-form.v1", async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, activeWorkspaceId: null, syntheticOnly: true, workspaces: [{ workspaceId: "A", label: "A", active: true, role: "OWNER" }] };
    if (method === "workspace.runtime.formOptions") return formResult;
    if (method === "workspace.agents.applyRuntimeForm") { if (applyResult.applied.includes("runtime")) runtime = params.runtimeId; return applyResult; }
    if (["workspace.select", "workspace.snapshot", "workspace.agent.select"].includes(method)) return snapshot(runtime);
    return {};
  } };
  const model = new WorkspaceDevModel(rpc);
  return { model, calls, ready: () => model.selectWorkspace("A") };
}

test("state: form read and single Apply send exactly the scoped fields; an older Core is never called", async () => {
  const f = fixture(); await f.ready();
  assert.equal(f.model.supportsRuntimeForm(), true);
  const read = await f.model.runtimeFormOptions("claude", "lin");
  assert.equal(read.use, "confirm_first_use");
  assert.deepEqual(f.calls.find(call => call.method === "workspace.runtime.formOptions").params, { workspaceId: "A", expectedGeneration: "generation-1", runtimeId: "claude", agentId: "lin" });
  const agent = f.model.getSnapshot().workspace.agents[0];
  const result = await f.model.applyRuntimeForm(agent, { runtimeId: "claude", confirm: { fingerprint: form.fingerprint, loginSource: "host" },
    model: { modelId: "sonnet", expectedRevision: 0, effort: "engine-default" } }, "keep");
  assert.deepEqual(result, { applied: ["confirm", "runtime", "model"] });
  assert.deepEqual(f.calls.find(call => call.method === "workspace.agents.applyRuntimeForm").params, { workspaceId: "A", expectedGeneration: "generation-1", agentId: "lin",
    runtimeId: "claude", configRevision: 4, agentEpoch: 2, confirm: { fingerprint: form.fingerprint, loginSource: "host" }, model: { modelId: "sonnet", expectedRevision: 0, effort: "engine-default" } });
  assert.equal(f.model.getSnapshot().workspace.agents[0].runtime.id, "claude", "refreshed after Apply");

  const old = fixture({ supported: false }); await old.ready();
  await assert.rejects(old.model.runtimeFormOptions("claude"), /ws\.rf\.upgrade/);
  await assert.rejects(old.model.applyRuntimeForm(old.model.getSnapshot().workspace.agents[0], { runtimeId: "claude" }), /ws\.rf\.upgrade/);
  assert.ok(!old.calls.some(call => call.method.startsWith("workspace.runtime.form") || call.method === "workspace.agents.applyRuntimeForm"));
});

test("state: malformed form data is refused; partial results pass through; fresh restart only when the engine changed", async () => {
  const bad = fixture({ formResult: { ...form, use: "trusted" } }); await bad.ready();
  await assert.rejects(bad.model.runtimeFormOptions("claude"), /invalidView/);
  const partial = fixture({ applyResult: { applied: ["confirm", "runtime"], failed: { step: "model", message: "Invalid runtime modelId" } } }); await partial.ready();
  const agent = partial.model.getSnapshot().workspace.agents[0];
  assert.deepEqual(await partial.model.applyRuntimeForm(agent, { runtimeId: "claude" }, "fresh"),
    { applied: ["confirm", "runtime"], failed: { step: "model", message: "Invalid runtime modelId" } });
  assert.equal(partial.model.getSnapshot().localHistoryStart, 1, "the Desk-only fresh conversation starts after the existing history");
  const same = fixture({ applyResult: { applied: ["model"] } }); await same.ready();
  await same.model.applyRuntimeForm(same.model.getSnapshot().workspace.agents[0], { runtimeId: "codex", model: { modelId: "sol", expectedRevision: 1, effort: null } }, "fresh");
  assert.equal(same.model.getSnapshot().localHistoryStart, 0, "no engine change, no new conversation");
});

const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: 'export {default as Form} from "./src/ColleagueRuntimeForm.tsx";export {WorkspaceTaskRecovery} from "./src/WorkspaceTaskRecovery.tsx";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"],
  loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");

test("form renders one Apply, the engine list with statuses and no untranslated keys", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), workspace = { ...snapshot("codex"), runtimeOptions: [{ id: "pi", label: "Pi", available: true, recommended: true, selectable: true, confirmation: "none" },
      { id: "codex", label: "Codex", available: true, recommended: false, selectable: true, confirmation: "none" },
      { id: "claude", label: "Claude Code", available: false, recommended: false, selectable: true, confirmation: "first_use" },
      { id: "opencode", label: "OpenCode", available: false, recommended: false, selectable: false, confirmation: "none" }],
      runtimes: { builtIn: "pi", operations: [], options: [{ runtimeId: "claude", label: "Claude Code", use: "confirm_first_use", installed: true, registered: false, version: "2.3.1", state: "detected", generalAgentDriverAvailable: false },
        { runtimeId: "opencode", label: "OpenCode", use: "unavailable", unavailableReason: "not_installed", installed: false, registered: false, version: null, state: "not_installed", generalAgentDriverAvailable: false }] } };
    const html = render(h(module.exports.Form, { agent: workspace.agents[0], workspace, model: { supportsConnectionModels: () => false }, locale, permissionSupported: true, onApplyPermissionTier: async () => {}, onRuntimeDirectory() {} }));
    assert.equal((html.match(/class="vg-rf-apply"/g) ?? []).length, 1);
    assert.ok(html.includes(t("ws.rf.status.confirm_first_use")));
    assert.ok(html.includes(t("ws.rf.status.unavailable", { reason: t("ws.rf.reason.not_installed") })));
    assert.match(html, /<option value="opencode" disabled="">/);
    assert.doesNotMatch(html, /ws\.rf\./);
  }
});

test("recovery card: an updated engine offers Confirm and continue and says Hara never switches", () => {
  const envelope = `[registered-codex error] ${RUNTIME_FAILURE_MARKER}${JSON.stringify({ runtime: "codex", kind: "not_installed", version: null, loginSource: "host", homeMatchesAccount: null, elapsedMs: 0, retryAtMs: 0, consecutiveFailures: 0 })}`;
  const conversation = { state: "blocked", taskState: "blocked", sessionId: "s", taskId: "t", runId: "r", blockReason: envelope, history: [{ role: "user", content: "hi" }], resumeAdmission: { allowed: true } };
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), base = { conversation, t, runtimeId: "codex", disabled: false, onContinue() {}, onRepair() {}, onRescan() {}, onRuntimeSettings() {} };
    const updated = render(h(module.exports.WorkspaceTaskRecovery, { ...base, runtimeUpdate: { engine: "Codex", version: "0.164.0" }, onConfirmUpdate() {} }));
    assert.ok(updated.includes(t("ws.rf.recoveryConfirm"))); assert.ok(updated.includes("0.164.0")); assert.ok(updated.includes(t("ws.rf.noAutoSwitch")));
    assert.ok(updated.includes(t("ws.rf.recoveryUpdatedTitle", { engine: "Codex" })));
    const missing = render(h(module.exports.WorkspaceTaskRecovery, base));
    assert.ok(!missing.includes(t("ws.rf.recoveryConfirm")), "a missing engine is not offered a confirmation");
  }
});


test("Pi Apply requires a current connection catalog and an actually selected model", () => {
  const inventory = { models: [sol], defaultModelId: "sol", selected: null, connectionId: "connection-a" };
  assert.equal(canApplyPiModel(true, "connection-a", inventory, "sol"), true);
  for (const [ready, connectionId, data, model] of [[false,"connection-a",inventory,"sol"],[true,undefined,inventory,"sol"],[true,"connection-b",inventory,"sol"],[true,"connection-a",inventory,""],[true,"connection-a",inventory,"missing"],[true,"connection-a",null,"sol"]])
    assert.equal(canApplyPiModel(ready, connectionId, data, model), false);
});

test("Pi model failures give localized connection/credential/refresh guidance without internal text", () => {
  const cases = [["Connection unavailable in this workspace","ws.rf.piNoConnection"],["Original credential unavailable; no fallback selected","ws.rf.piCredentials"],["invalid or unavailable scoped model connection; no fallback was selected","ws.rf.piCredentials"],["Workspace model view changed; refresh","ws.rf.piModelsChanged"],["Connection changed; refresh model list","ws.rf.piModelsChanged"],["INTERNAL_FILE_PATH_SECRET","ws.rf.piModelsUnavailable"]];
  for (const [reason, expected] of cases) {
    assert.equal(piModelErrorKey(reason), expected);
    for (const locale of ["zh-Hans", "zh-Hant"]) {
      const text = makeT(locale)(piModelErrorKey(reason));
      assert.doesNotMatch(text, /Pi agent unavailable|Original credential|Workspace model view|INTERNAL_FILE_PATH_SECRET/);
      assert.match(text, /空间连接|空間連線|刷新模型|重新整理模型/);
    }
  }
});
