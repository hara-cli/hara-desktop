// Real WorkspaceScreen, entirely in-memory Provider/RPC. Never imported by the application entry.
import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceScreen } from "../../src/WorkspaceLocalDev";
import { WorkspaceDevModel } from "../../src/workspace-dev-state";
import "../../src/workspace-settings.css";
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
localStorage.setItem("hara.theme", params.get("theme") ?? "light");
localStorage.setItem("hara.locale", params.get("locale") ?? "zh");
if (params.has("width")) localStorage.setItem("hara.extensionDock.width.v1", params.get("width")!);
const agent = { agentId: "main", kind: "main" as const, state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } };
const workspace = { workspaceId: "panel-fixture", resourceGeneration: "generation-A", label: "Synthetic Workspace", selectedAgentId: "main", syntheticOnly: true, agents: [agent],
  connections: { revision: 1, defaultConnectionId: "fake", connections: [] }, approvals: [],
  conversation: { revision: 1, state: "idle", sessionId: "panel-session", taskId: null, runId: null, taskState: null, objective: "", pastTaskCount: 0,
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, runUsage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, completion: null,
    history: Array.from({ length: 25 }, (_, i) => ({ role: "assistant", text: `Synthetic reply ${i}. Keep this chat visible beside the preview.`, tools: [] })) } };
const requests: string[] = [];
const rpc = { async request<T>(method: string): Promise<T> { requests.push(method);
  if (method === "workspace.list") return { revision: 1, activeWorkspaceId: workspace.workspaceId, workspaces: [{ workspaceId: workspace.workspaceId, label: workspace.label, role: "owner", active: true }], syntheticOnly: true } as T;
  if (["workspace.select", "workspace.snapshot"].includes(method)) return workspace as T;
  if (method === "workspace.preferences.get") return { revision: 1, theme: params.get("theme") ?? "light", readOnly: false, recovered: false } as T;
  throw new Error(`Fixture disallows ${method}`);
} };
const model = new WorkspaceDevModel(rpc);
await model.loadDirectory(); await model.selectWorkspace(workspace.workspaceId);
Object.assign(window, { panelFixture: { model, requests } });
createRoot(document.getElementById("root")!).render(<WorkspaceScreen model={model} disconnected="" root="/private/synthetic-only" mode="workspace" onReconnect={() => { throw new Error("No real reconnect"); }} />);
