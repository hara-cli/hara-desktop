import { useEffect, useState } from "react";
import type { AgentRuntimeId } from "./client";
import { WorkspaceAgentRuntimePicker } from "./AgentRuntimePicker";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceRuntimeModels } from "./workspace-dev-state";

export default function WorkspaceRuntimeAccess({ agent, workspace, locale, compact = false, listModels, onApplyRuntime, onApplyModel, onRuntimeDirectory }: {
  agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; locale: "en" | "zh-Hans" | "zh-Hant"; compact?: boolean;
  listModels(runtimeId: string): Promise<WorkspaceRuntimeModels>;
  onApplyRuntime(runtimeId: AgentRuntimeId): Promise<void>;
  onApplyModel(runtimeId: string, modelId: string, revision: number): Promise<void>;
  onRuntimeDirectory(): void;
}) {
  const zh = locale !== "en";
  const [models, setModels] = useState<WorkspaceRuntimeModels | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [directoryOpened, setDirectoryOpened] = useState(false);
  const option = workspace.runtimeOptions?.find(row => row.id === agent.runtime.id);
  const directoryNeeded = option?.reason === "not_registered" || option?.reason === "not_installed" || option?.reason === "integrity_failed";
  useEffect(() => {
    let active = true;
    setModels(null); setSelected(""); setError("");
    if (!option?.available) return () => { active = false; };
    setLoading(true);
    void listModels(agent.runtime.id).then(result => { if (active) { setModels(result); setSelected(result.selectedModelId ?? ""); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agent.agentId, agent.runtime.id, agent.configRevision, workspace.resourceGeneration, option?.available, listModels]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  if (compact) return <div className="vg-runtime-strip" aria-label={zh ? "本 bot 运行配置" : "This bot runtime"}>
    <span>Runtime <strong>{agent.runtime.label}</strong></span><span>{zh ? "模型" : "Model"} <strong>{models?.models.find(row => row.id === models.selectedModelId)?.label ?? "—"}</strong></span>
  </div>;
  return <div className="vg-runtime-access">
    <section className="vg-context-card vg-p0-card"><h3>Runtime</h3>
      {workspace.runtimeOptions ? <WorkspaceAgentRuntimePicker agent={agent} options={workspace.runtimeOptions} locale={zh ? "zh" : "en"} saving={busy}
        onApply={runtimeId => void run(() => onApplyRuntime(runtimeId))} /> : <p role="status">{zh ? "正在等待引擎目录" : "Runtime catalog unavailable"}</p>}
      {directoryNeeded && !directoryOpened ? <button onClick={() => { setDirectoryOpened(true); onRuntimeDirectory(); }}>{zh ? "管理本机引擎…" : "Manage local runtimes…"} ↗</button> : null}
    </section>
    <section className="vg-context-card vg-p0-card"><h3>{zh ? "此 bot 的模型" : "This bot's model"}</h3>
      {loading ? <p role="status">{zh ? "读取模型…" : "Loading models…"}</p> : models ? <>
        <label>{zh ? "模型" : "Model"}<select aria-label={zh ? "此 bot 的模型" : "This bot's model"} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
          <option value="">{zh ? "选择模型" : "Choose a model"}</option>{models.models.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <button disabled={busy || !selected || selected === models.selectedModelId || !models.models.some(row => row.id === selected)}
          onClick={() => void run(async () => { await onApplyModel(agent.runtime.id, selected, models.revision); const latest = await listModels(agent.runtime.id); setModels(latest); setSelected(latest.selectedModelId ?? ""); })}>{zh ? "应用模型" : "Apply model"}</button>
      </> : <p>{option?.available ? (zh ? "模型目录暂不可用" : "Model list unavailable") : (zh ? "请先绑定可用引擎" : "Bind an available runtime first")}</p>}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  </div>;
}
