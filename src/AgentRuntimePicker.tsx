import { useEffect, useId, useState } from "react";
import type { AgentInfo, AgentRuntimeId, AgentRuntimeOption } from "./client";
import { agentRuntimeLabel, agentRuntimeSelection } from "./agent-runtime-selection";

export default function AgentRuntimePicker({ agent, options = [], locale, saving, onApply }: {
  agent: AgentInfo;
  options?: AgentRuntimeOption[];
  locale: "en" | "zh";
  saving?: boolean;
  onApply?: (id: AgentRuntimeId) => void;
}) {
  const [selected, setSelected] = useState<AgentRuntimeId>(agent.runtime?.runtimeId ?? "hara");
  const noteId = useId();
  const runtimeId = agent.runtime?.runtimeId;
  const revision = agent.runtime?.revision;
  useEffect(() => { setSelected(runtimeId ?? "hara"); }, [agent.ref, runtimeId, revision]);
  const editable = !!onApply && agent.owner === "personal" && agent.allowedActions.includes("edit_profile");
  const choice = agentRuntimeSelection(agent, selected, options);
  return <details className="agent-profile-runtime">
    <summary><span>Runtime</span><small>{runtimeId ? agentRuntimeLabel(runtimeId, locale)
      : locale === "zh" ? "引擎尚未提供绑定信息" : "Binding not advertised by this engine"}</small></summary>
    <p id={noteId}>{locale === "zh"
      ? "决定这位 Agent 用什么引擎执行，不是模型或工具授权。切换只影响新任务；旧任务和历史保留原绑定。"
      : "Selects this Agent's execution engine, not its model or tool permissions. Changes affect new tasks; existing work keeps its binding."}</p>
    {agent.runtime && options.length ? <>
      <div className="agent-profile-runtime-controls">
        <label><span>{locale === "zh" ? "执行 Runtime" : "Execution Runtime"}</span>
          <select value={selected} disabled={!editable || saving} aria-describedby={noteId}
            onChange={(event) => setSelected(event.target.value as AgentRuntimeId)}>
            {!options.some((option) => option.id === runtimeId) && runtimeId
              ? <option value={runtimeId} disabled>{agentRuntimeLabel(runtimeId, locale)}</option> : null}
            {options.map((option) => <option key={option.id} value={option.id} disabled={!option.available}>
              {agentRuntimeLabel(option.id, locale)}{!option.available ? locale === "zh" ? " · 暂不可用" : " · unavailable" : ""}
            </option>)}
          </select>
        </label>
        <button type="button" disabled={saving || !choice || !editable} onClick={() => { if (choice) onApply?.(selected); }}>
          {saving ? locale === "zh" ? "保存中…" : "Saving…" : locale === "zh" ? "仅保存 Runtime" : "Save Runtime only"}
        </button>
      </div>
      {!agent.runtime.available ? <p role="status">{locale === "zh"
        ? "绑定引擎目前不可用，不会自动切换；可为新任务明确选择其他可用引擎。"
        : "The bound engine is unavailable. No automatic fallback will run; explicitly select an available engine for new tasks."}</p> : null}
    </> : <p>{locale === "zh" ? "更新引擎后可使用逐 Agent Runtime 设置。" : "Update the engine to configure a Runtime per Agent."}</p>}
  </details>;
}
