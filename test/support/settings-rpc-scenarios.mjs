/**
 * S4b: the Core calls behind every Settings operation, recorded at the model layer with a synthetic RPC.
 * The same scenarios run on the pre-cleanup baseline (integrate fa844bf, before S0) to produce
 * test/fixtures/settings-rpc-baseline.json, and on the current tree in settings-rpc-parity.test.mjs, so a
 * settings redesign cannot change which RPCs are sent or with which parameters without failing.
 * Regenerate (only when a Core contract change is intended): see the fixture's `generatedBy`.
 */
export const BASELINE = "fa844bf";
const CAPABILITIES = ["workspace.agents.archive.v1", "workspace.extensions.v1", "workspace.extensions.manager.v1", "workspace.extensions.owner-review.v1"];
const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", approvals: [],
  agents: [{ agentId: "main", kind: "main", state: "active", configRevision: 1, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } },
    { agentId: "c1", kind: "colleague", state: "active", configRevision: 4, agentEpoch: 2, identity: { displayName: "Coder" }, runtime: { id: "codex", label: "Codex", available: true } }],
  connections: { revision: 5, defaultConnectionId: "conn-1", connections: [{ id: "conn-1", label: "One", provider: "openai", baseURL: "https://x.invalid", defaultModel: "m", status: "active" }] },
  conversation: { history: [], state: "idle", revision: 1, sessionId: "s", taskId: null, runId: null } });
const RECORD = "11111111-2222-4333-8444-555555555555", PROPOSAL = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const change = { target: "workspace", sourceId: "g1", sourceRevision: "r1", enabled: true, allowedTools: ["write", "read"] };
/** Replies just valid enough that each operation runs to the end, so chained steps (propose → approve) are recorded too. */
const REPLIES = {
  "workspace.runtime.propose": p => ({ id: "prop-1", runtimeId: p.runtimeId, label: "OpenCode", version: "1.0.0", origin: "https://example.invalid", target: { platform: "darwin", arch: "arm64" }, maxBytes: 1, sha256: "0".repeat(64) }),
  "workspace.runtime.proxy.get": p => ({ workspaceId: p.workspaceId, resourceGeneration: p.expectedGeneration, revision: 1, readOnly: false, proxyUrl: null }),
  "workspace.runtime.proxy.set": p => ({ workspaceId: p.workspaceId, resourceGeneration: p.expectedGeneration, revision: p.expectedRevision + 1, readOnly: false, proxyUrl: p.proxyUrl }),
  "workspace.extensions.propose": p => ({ proposalId: PROPOSAL, workspaceId: p.workspaceId, resourceGeneration: p.expectedGeneration, revision: p.expectedRevision, change: { ...p.change, allowedTools: [...p.change.allowedTools].sort() } }),
  "workspace.extensions.review.list": p => ({ workspaceId: p.workspaceId, resourceGeneration: p.expectedGeneration, revision: 1, allowed: true, readOnly: false, reason: null, sources: [{ sourceId: "g1", recordId: RECORD, name: "filesystem", status: "candidate", reason: null }] }),
};
const input = { label: "One", provider: "openai", baseURL: "https://x.invalid", defaultModel: "m", apiKey: "sk-synthetic" };

/** [name, run(model)] — arguments mirror what the Settings screens pass. */
export const SCENARIOS = [
  ["activity", m => m.activity()],
  ["preferences", m => m.preferences()],
  ["savePreference", m => m.savePreference("dark", 3)],
  ["saveDisplayPreference", m => m.saveDisplayPreference("brief", true)],
  ["saveTimingDiagnosticsPreference", m => m.saveTimingDiagnosticsPreference(true)],
  ["saveUpdatePreferences", m => m.saveUpdatePreferences({ channel: "stable", autoCheck: true })],
  ["prepareUpdate", m => m.prepareUpdate()],
  ["releaseUpdate", m => m.releaseUpdate("u-1")],
  ["detectRuntimes", m => m.detectRuntimes()],
  ["proposeThenApproveRuntime", async m => m.approveRuntime(await m.proposeRuntime("opencode"), true, "host")],
  ["proposeThenDeclineRuntime", async m => m.approveRuntime(await m.proposeRuntime("opencode"), false, "isolated")],
  ["registerLocalRuntime", m => m.registerLocalRuntime("codex", "fp-1", "A", "generation-A", "host")],
  ["cancelRuntime", m => m.cancelRuntime("op-1")],
  ["codexLoginInstructions", m => m.codexLoginInstructions()],
  ["runtimeProxy", m => m.runtimeProxy("A", "generation-A")],
  ["saveRuntimeProxy", m => m.saveRuntimeProxy("http://127.0.0.1:7890", 1, "A", "generation-A")],
  ["clearRuntimeProxy", m => m.saveRuntimeProxy(null, 2, "A", "generation-A")],
  ["legacyConnections", m => m.legacyConnections()],
  ["configureConnection", m => m.configureConnection(input)],
  ["editConnection", m => m.editConnection("conn-1", { label: "Renamed" })],
  ["selectConnection", m => m.changeConnection("conn-1")],
  ["removeConnection", m => m.changeConnection("conn-1", true)],
  ["importConnection", m => m.importConnection("legacy-1")],
  ["extensions", m => m.extensions("A", "generation-A")],
  ["proposeThenApproveExtensions", async m => m.approveExtensions(await m.proposeExtensions(change, 3, "A", "generation-A"), true)],
  ["proposeThenDeclineExtensions", async m => m.approveExtensions(await m.proposeExtensions({ ...change, enabled: false, allowedTools: [] }, 3, "A", "generation-A"), false)],
  // Each MCP review step needs the record id from the list first, exactly as the panel does.
  ["mcpReviews", m => m.mcpReviews("A", "generation-A")],
  ["describeMcpReview", async m => { await m.mcpReviews("A", "generation-A"); return m.describeMcpReview(RECORD, "A", "generation-A"); }],
  ["inspectMcpReview", async m => { await m.mcpReviews("A", "generation-A"); return m.decideMcpReview("inspect", RECORD, "A", "generation-A"); }],
  ["approveMcpReview", async m => { await m.mcpReviews("A", "generation-A"); return m.decideMcpReview("approve", RECORD, "A", "generation-A"); }],
  ["revokeMcpReview", async m => { await m.mcpReviews("A", "generation-A"); return m.decideMcpReview("revoke", RECORD, "A", "generation-A"); }],
  ["cancelMcpReview", async m => { await m.mcpReviews("A", "generation-A"); return m.cancelMcpReview(RECORD, "A", "generation-A"); }],
  ["archiveColleague", m => m.setAgentArchived(m.getSnapshot().workspace.agents[1], true)],
  ["featuresList", m => m.workspaceRequest("workspace.features.list")],
];

/** Runs every scenario on a fresh model and returns [{ name, calls: [{ method, params }], outcome }]. */
export async function recordSettingsRpc(WorkspaceDevModel) {
  const out = [];
  for (const [name, run] of SCENARIOS) {
    const calls = [];
    const model = new WorkspaceDevModel({ supportsCapability: capability => CAPABILITIES.includes(capability), async request(method, params) {
      calls.push({ method, params: JSON.parse(JSON.stringify(params ?? {})) });
      if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", activeWorkspaceId: "A", workspaces: [{ workspaceId: "A", active: true }] };
      if (method === "workspace.select" || method === "workspace.settings.select" || method === "workspace.snapshot") return snapshot(params.workspaceId ?? "A");
      return REPLIES[method]?.(params) ?? {};
    } }, () => "request", false, "workspace");
    await model.selectWorkspace("A");
    calls.length = 0;
    let outcome = "ok";
    try { await run(model); } catch { outcome = "error"; }
    out.push({ name, calls, outcome });
  }
  return out;
}

/** Settings screens whose model calls are compared with the baseline (the files the S0–S4 cleanup touched). */
export const SETTINGS_FILES = ["SettingsChrome.tsx", "WorkspaceDefaultRuntime.tsx", "WorkspaceDeletedColleagues.tsx", "WorkspaceExtensions.tsx", "WorkspaceRuntimeSettings.tsx", "WorkspaceRuntimeProxy.tsx",
  "WorkspaceSchedulePicker.tsx", "WorkspaceSettings.tsx", "WorkspaceSettingsPanels.tsx", "WorkspaceSoftwareUpdate.tsx", "settings-advanced-state.ts", "settings-schedule-text.ts"];
const RECEIVERS = /^(model|mainModel|updater|settingsModel|props\.model)$/;
/** Every `model.method(args)` call (argument text normalised) in the Settings screens of a source tree, sorted. */
export function settingsModelCalls(ts, readSource) {
  const calls = new Set();
  for (const file of SETTINGS_FILES) {
    const text = readSource(file); if (text === null) continue;
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression.getText(ast);
        if (RECEIVERS.test(receiver)) calls.add(`${receiver}.${node.expression.name.getText(ast)}(${node.arguments.map(arg => arg.getText(ast).replace(/\s+/g, " ")).join(", ")})`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...calls].sort();
}
