import type { WorkspaceDevAgent, WorkspaceDevSnapshot } from "./workspace-dev-state";

export default function WorkspaceRuntimeAccess({ agent, workspace, locale, onRuntime, onModel, compact = false }: {
  agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; locale: "en" | "zh-Hans" | "zh-Hant";
  onRuntime(): void; onModel(): void; compact?: boolean;
}) {
  const zh = locale !== "en";
  const connection = workspace.connections.connections.find(row => row.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId));
  if (compact) return <div className="vg-runtime-strip" aria-label={zh ? "Inspector 快捷设置" : "Inspector quick settings"}>
    <button onClick={onRuntime}>Runtime <strong>{agent.runtime.label}</strong> ↗</button>
    <button onClick={onModel}>{zh ? "模型" : "Model"} <strong>{connection?.defaultModel ?? "—"}</strong> ↗</button>
  </div>;
  return <div className="vg-runtime-access">
    <section className="vg-context-card vg-p0-card"><h3>Runtime <span>P0</span></h3><p>{agent.runtime.label}{!agent.runtime.available ? ` · ${zh ? "不可用" : "Unavailable"}` : ""}</p>
      <button onClick={onRuntime}>{zh ? "打开 Runtime 设置" : "Open Runtime settings"} ↗</button></section>
    <section className="vg-context-card vg-p0-card"><h3>{zh ? "模型" : "Model"} <span>P0</span></h3><p>{connection?.defaultModel ?? (zh ? "尚未配置" : "Not configured")}</p>
      <button onClick={onModel}>{zh ? "打开模型设置" : "Open model settings"} ↗</button></section>
  </div>;
}
