// DEV-only colleague engine form fixture (runtime-form-1105). Every engine, model and apply stays in memory.
import React from "react";
import { createRoot } from "react-dom/client";
import ColleagueRuntimeForm from "../../src/ColleagueRuntimeForm";
import { SettingsContent, SettingsOverlay } from "../../src/WorkspaceSettings";
import type { WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceRuntimeFormOptions } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-tokens.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw new Error("Synthetic localhost fixture only");
const params = new URLSearchParams(location.search), locale = (params.get("locale") ?? "zh-Hans") as "en" | "zh-Hans" | "zh-Hant";
const scenario = params.get("scenario") ?? "form";
localStorage.setItem("hara.locale", locale);
document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";
const levels = ["low", "medium", "high", "xhigh"];
const forms: Record<string, Omit<WorkspaceRuntimeFormOptions, "sharedWith">> = {
  codex: { runtimeId: "codex", use: scenario === "updated" ? "confirm_update" : "ready", version: scenario === "updated" ? "0.164.0" : "0.163.0", path: "/Users/fixture/.local/bin/codex",
    fingerprint: "fixture-codex", loginSource: "host", modelSource: scenario === "updated" ? "engine_default" : "live", defaultModelId: "gpt-6.1-sol", effortSupported: true, revision: 3,
    selected: { modelId: "gpt-6.1-sol", effort: "medium" },
    models: scenario === "updated" ? [] : [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol", recommended: true, supportedReasoningEfforts: levels },
      { id: "gpt-6.1-terra", label: "GPT-6.1-Terra", supportedReasoningEfforts: ["low", "medium", "high"] }, { id: "gpt-6.1-luna", label: "GPT-6.1-Luna", supportedReasoningEfforts: ["low", "medium"] }] },
  claude: { runtimeId: "claude", use: "confirm_first_use", version: "2.3.1", path: "/Users/fixture/.local/bin/claude", fingerprint: "fixture-claude", loginSource: "isolated",
    modelSource: "official", defaultModelId: "sonnet", effortSupported: true, revision: 0, selected: null,
    models: [{ id: "sonnet", label: "Claude Sonnet (latest)", recommended: true, supportedReasoningEfforts: ["low", "medium", "high", "max"] },
      { id: "opus", label: "Claude Opus (latest)", supportedReasoningEfforts: ["low", "medium", "high", "max"] }, { id: "haiku", label: "Claude Haiku (latest)" }] },
  gemini: { runtimeId: "gemini", use: "ready", version: "0.21.0", path: "/opt/homebrew/bin/gemini", fingerprint: "fixture-gemini", loginSource: "host",
    modelSource: "official", defaultModelId: "default", effortSupported: false, revision: 0, selected: null,
    models: [{ id: "default", label: "CLI default", recommended: true }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }] },
  opencode: { runtimeId: "opencode", use: "unavailable", unavailableReason: "not_installed", version: null, path: null, fingerprint: null, loginSource: "host",
    modelSource: "none", defaultModelId: null, effortSupported: false, revision: 0, selected: null, models: [] },
  copilot: { runtimeId: "copilot", use: "detecting", version: null, path: null, fingerprint: null, loginSource: "host",
    modelSource: "none", defaultModelId: null, effortSupported: false, revision: 0, selected: null, models: [] },
};
const runtimeRow = (id: string, label: string) => { const form = forms[id]; return { runtimeId: id, label, installed: Boolean(form?.version), registered: form?.use === "ready",
  version: form?.version ?? null, state: form?.use === "ready" ? "local_registered" : form?.use === "unavailable" ? "not_installed" : "detected", use: form?.use ?? "unavailable",
  unavailableReason: form?.unavailableReason ?? (form ? undefined : "not_installed"), generalAgentDriverAvailable: form?.use === "ready", path: form?.path ?? undefined,
  fingerprint: form?.fingerprint ?? null, loginSource: form?.loginSource }; };
const runtimeIds = [["codex", "Codex"], ["claude", "Claude Code"], ["gemini", "Gemini CLI"], ["opencode", "OpenCode"], ["copilot", "GitHub Copilot"], ["kimi", "Kimi Code"]];
const runtimeOptions = () => [{ id: "pi", label: "Pi（内建）", available: true, recommended: true, selectable: true, confirmation: "none" },
  ...runtimeIds.map(([id, label]) => { const use = forms[id]?.use; return { id, label, available: use === "ready", recommended: false,
    selectable: use === "ready" || use === "confirm_first_use" || use === "confirm_update", confirmation: use === "confirm_first_use" ? "first_use" : use === "confirm_update" ? "update" : "none" }; })];
const agentRuntime = scenario === "pi" ? "pi" : scenario === "gemini" ? "gemini" : "codex";
const agents = [{ agentId: "lin", kind: "colleague", state: "active", configRevision: 4, agentEpoch: 1, permissionTier: "full-protected", identity: { displayName: "小林" }, runtime: { id: agentRuntime, label: agentRuntime, available: true } },
  { agentId: "zhou", kind: "colleague", state: "active", configRevision: 2, agentEpoch: 1, permissionTier: "full-protected", identity: { displayName: "小周" }, runtime: { id: "codex", label: "codex", available: true } }];
let workspace = { workspaceId: "fixture", resourceGeneration: "generation-1", label: "Synthetic workspace", selectedAgentId: "lin", agents, approvals: [],
  connections: { revision: 1, defaultConnectionId: "conn", connections: [{ id: "conn", label: "Synthetic", status: "active", defaultModel: "glm-5" }] },
  runtimeOptions: runtimeOptions(), runtimes: { builtIn: "pi", options: runtimeIds.map(([id, label]) => runtimeRow(id, label)), operations: [],
    detection: { running: false, completedAt: "2026-11-06T00:30:00.000Z", incomplete: scenario === "settings" ? ["copilot"] : [] } },
  conversation: { state: "completed", history: [], sessionId: "s", taskId: null, runId: null },
} as unknown as WorkspaceDevSnapshot;
const listeners = new Set<() => void>(), applies: unknown[] = [], connectionSelects: unknown[] = [];
let view = { workspaceId: workspace.workspaceId, workspace, error: "", directory: { workspaces: [{ workspaceId: "fixture", label: "Synthetic workspace", kind: "personal", role: "owner", active: true }], revision: 1 } };
const notify = () => { view = { ...view, workspace }; for (const listener of listeners) listener(); render(); };
const model = { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => view,
  supportsRuntimeForm: () => true, supportsConnectionModels: () => true, supportsRuntimePermissions: () => true,
  async detectRuntimes() { await new Promise(done => setTimeout(done, 50)); }, async refresh() {},
  async runtimeProxy(workspaceId: string, resourceGeneration: string) { return { workspaceId, resourceGeneration, revision: 1, proxyUrl: null }; },
  async runtimeFormOptions(runtimeId: string) {
    const form = forms[runtimeId] ?? { ...forms.opencode, runtimeId };
    return { ...form, sharedWith: runtimeId === "codex" ? [{ agentId: "zhou", displayName: "小周" }] : [] };
  },
  async listConnectionModels(_agentId: string, connectionId: string) {
    return { connectionId, source: "documented", revision: 1, selectedModelId: "glm-5", selectedEffort: null,
      models: [{ id: "glm-5", label: "GLM-5", supportedReasoningEfforts: ["low", "medium", "high"] }, { id: "glm-5-air", label: "GLM-5-Air" }] };
  },
  async selectConnectionModel(...args: unknown[]) { connectionSelects.push(args); },
  async applyRuntimeForm(agent: { agentId: string }, input: { runtimeId: string; confirm?: unknown; model?: unknown }, restart: string) {
    applies.push({ agentId: agent.agentId, input, restart });
    const form = forms[input.runtimeId];
    if (form && (form.use === "confirm_first_use" || form.use === "confirm_update") && !input.confirm) throw new Error("runtime_confirmation_required");
    if (form && input.confirm) { form.use = "ready"; if (input.runtimeId === "codex") Object.assign(form, { modelSource: "live", models: [{ id: "gpt-6.2-sol", label: "GPT-6.2-Sol", recommended: true, supportedReasoningEfforts: levels }], defaultModelId: "gpt-6.2-sol" }); }
    const applied = [...(input.confirm ? ["confirm"] : []), ...(input.runtimeId !== agents[0].runtime.id ? ["runtime"] : []), ...(input.model ? ["model"] : [])];
    if (input.runtimeId !== agents[0].runtime.id) { agents[0] = { ...agents[0], configRevision: agents[0].configRevision + 1, runtime: { id: input.runtimeId, label: input.runtimeId, available: true } }; }
    workspace = { ...workspace, agents: [...agents], runtimeOptions: runtimeOptions(), runtimes: { ...workspace.runtimes!, options: runtimeIds.map(([id, label]) => runtimeRow(id, label)) } } as WorkspaceDevSnapshot;
    notify();
    return { applied };
  },
} as unknown as WorkspaceDevModel;
(window as any).runtimeFormFixture = { applies, connectionSelects };
const root = createRoot(document.getElementById("root")!);
const updaterState = { state: "idle", available: false }, updater = { subscribe: () => () => {}, getSnapshot: () => updaterState };
function render() {
  if (scenario === "settings") { root.render(<SettingsOverlay ready onClose={() => {}}><SettingsContent mainModel={model} model={model} initialPage="runtimes" root="/fixture" production={true}
    theme={{} as any} updater={updater as any} versionInfo={null} onClose={() => {}} onCreateSkill={() => {}} /></SettingsOverlay>); return; }
  const agent = workspace.agents[0]!;
  root.render(<div className="hs vg-shell" style={{ display: "grid", gridTemplateColumns: "1fr 400px", height: "100%" }}><div />
    <aside id="workspace-inspector" className="vg-inspector vg-colleague-manage" style={{ gridColumn: 2 }}>
      <ColleagueRuntimeForm key={`${agent.configRevision}`} agent={agent} workspace={workspace} model={model} locale={locale} permissionSupported onApplyPermissionTier={async () => {}} onRuntimeDirectory={() => {}} />
    </aside></div>);
}
render();
