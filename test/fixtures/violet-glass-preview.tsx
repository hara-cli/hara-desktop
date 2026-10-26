// Standalone localhost Debug of the production WorkspaceScreen, never a product entry bypass.
// Every RPC stays in memory. No Tauri bridge, real Core, provider, updater or filesystem access.
import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceScreen } from "../../src/WorkspaceLocalDev";
import { WorkspaceDevModel, type WorkspaceDevRpc, type WorkspaceDevSnapshot } from "../../src/workspace-dev-state";
import { initializeThemePreference } from "../../src/theme";
import { applyAppearance, loadAppearance } from "../../src/violet-appearance";
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw Error("Local synthetic Debug only");
const params = new URLSearchParams(location.search);
localStorage.setItem("hara.locale", params.get("locale") ?? "zh-Hans");
const initialTheme = params.get("theme") === "light" ? "light" : "dark";
localStorage.setItem("hara.theme", initialTheme);
initializeThemePreference(); applyAppearance(loadAppearance());
const calls: { method: string; params: Record<string, unknown> }[] = [];
let preference = { revision: 1, theme: initialTheme, readOnly: false, recovered: false, executionDetails: "brief", collapseDetails: true };
const workspaceId = "11111111-1111-4111-8111-111111111111";
const agents: WorkspaceDevSnapshot["agents"] = [
  { agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara", title: "你的工作伙伴" }, runtime: { id: "pi", label: "Pi", available: true } },
  { agentId: "coder", kind: "colleague", state: "active", identity: { displayName: "Elon", title: "工程与交付" }, runtime: { id: "pi", label: "Pi", available: true } },
  { agentId: "designer", kind: "colleague", state: "active", identity: { displayName: "Dora", title: "产品设计" }, runtime: { id: "pi", label: "Pi", available: true } },
];
const history: WorkspaceDevSnapshot["conversation"]["history"] = [
  { role: "user", content: "帮我整理今天的工作进度。" },
  { role: "assistant", text: "已整理。你可以在工作区查看同事动态，在右侧查看当前对话的工具与用量。定时任务和技能集中在工作空间设置里。", tools: ["workspace_read"] },
];
const snapshot = (agentId = "main"): WorkspaceDevSnapshot => ({ workspaceId, resourceGeneration: "violet-debug-generation", selectedAgentId: agentId, label: "默认工作区", agents, syntheticOnly: false, executionMode: "workspace",
  connections: { revision: 1, defaultConnectionId: "debug", connections: [{ id: "debug", label: "本机合成连接", status: "active", defaultModel: "synthetic-debug", provider: "openai", baseURL: "https://example.invalid/v1", keySaved: true }] }, approvals: [],
  runtimes: { builtIn: "pi", options: [], operations: [] },
  conversation: { revision: 1, state: agentId === "coder" ? "running" : "idle", sessionId: `session-${agentId}`, taskId: agentId === "main" ? null : `task-${agentId}`, runId: null, taskState: agentId === "coder" ? "running" : agentId === "designer" ? "completed" : null,
    objective: agentId === "coder" ? "检查工作区与交付记录" : agentId === "designer" ? "完成 Violet Glass 视觉规范" : "", history, pastTaskCount: 1,
    usage: { modelCalls: 2, inputTokens: 1240, outputTokens: 384 }, runUsage: { modelCalls: 1, inputTokens: 640, outputTokens: 192 }, completion: null } });
let features = { revision: 1, workspaceId, skills: [{ id: "workspace-summary", description: "工作区摘要", enabled: true, version: "a".repeat(64), availableVersion: "a".repeat(64), locked: true, source: "private" }],
  schedules: [{ id: "daily-summary", name: "每日工作摘要", enabled: true, schedule: { kind: "cron", expr: "0 9 * * 1-5" } }], scheduler: { schedules: [{ id: "daily-summary", nextRunAt: Date.now() + 3600000, awaitingHandoff: false, lastRun: null }] } };
const rpc: WorkspaceDevRpc = { supportsCapability: () => false, async request<T>(method: string, values: Record<string, unknown>) {
  calls.push({ method, params: structuredClone(values) });
  let result: unknown;
  if (method === "workspace.list") result = { revision: 1, syntheticOnly: false, executionMode: "workspace", activeWorkspaceId: workspaceId, workspaces: [{ workspaceId, active: true, role: "owner", kind: "personal", label: "默认工作区" }] };
  else if (["workspace.select", "workspace.snapshot", "workspace.agent.select", "workspace.settings.select"].includes(method)) result = snapshot(values.agentId as string | undefined);
  else if (method === "workspace.preferences.get") result = preference;
  else if (method === "workspace.preferences.set") result = preference = { ...preference, ...values, revision: preference.revision + 1 };
  else if (method === "workspace.features.list") result = features;
  else if (method === "workspace.features.update") {
    features = { ...features, revision: features.revision + 1, skills: features.skills.map(row => row.id === values.id ? { ...row, enabled: Boolean(values.enabled) } : row), schedules: features.schedules.map(row => row.id === values.id ? { ...row, enabled: Boolean(values.enabled) } : row) }; result = features;
  } else if (method === "workspace.connection.legacy") result = [];
  else if (method === "workspace.tasks") result = [];
  else throw Error(`Synthetic Debug rejects ${method}`);
  return structuredClone(result) as T;
} };
const model = new WorkspaceDevModel(rpc, () => crypto.randomUUID(), false, "workspace");
model.setSettingsFactory(async () => ({ model: new WorkspaceDevModel(rpc, () => crypto.randomUUID(), false, "workspace", true), close() {} }));
await model.loadDirectory(); await model.selectWorkspace(workspaceId);
(window as any).__HARA_VIOLET_DEBUG__ = { model, calls, syntheticOnly: true };
createRoot(document.getElementById("root")!).render(<WorkspaceScreen model={model} disconnected="" root="/synthetic/violet-debug" mode="workspace" onReconnect={() => {}} />);
