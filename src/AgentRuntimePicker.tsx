import { makeT } from "./i18n";
import { inheritsPersonalExtensions } from "./runtime-expansion";
import { useEffect, useId, useState } from "react";
import type { AgentInfo, AgentRuntimeId, AgentRuntimeOption } from "./client";
import { agentRuntimeLabel, agentRuntimeSelection } from "./agent-runtime-selection";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

function PersonalExtensionsNotice({ runtimeId, locale }: { runtimeId: string; locale: "en" | "zh" | "zh-Hans" | "zh-Hant" }) {
  if (!inheritsPersonalExtensions(runtimeId)) return null;
  const t = makeT(locale === "zh" ? "zh-Hans" : locale);
  return <p role="status" data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p>;
}

/** Soft Dark uses the same Registry options, with the Workspace agent's revision fence. */
export function WorkspaceAgentRuntimePicker({ agent, options, locale, saving, onApply }: {
  agent: WorkspaceDevAgent; options: AgentRuntimeOption[]; locale: "en" | "zh" | "zh-Hans" | "zh-Hant"; saving: boolean;
  onApply(id: AgentRuntimeId): void;
}) {
  const [selected, setSelected] = useState<AgentRuntimeId>(agent.runtime.id as AgentRuntimeId);
  useEffect(() => setSelected(agent.runtime.id as AgentRuntimeId), [agent.agentId, agent.runtime.id, agent.configRevision]);
  const available = options.some(option => option.id === selected && option.available);
  const zh = locale !== "en", hant = locale === "zh-Hant";
  return <div className="agent-profile-runtime-controls">
    <label><span>{zh ? "引擎" : "Engine"}</span><select aria-label={zh ? "引擎" : "Engine"} value={selected} disabled={saving} onChange={event => setSelected(event.target.value as AgentRuntimeId)}>
      {!options.some(option => option.id === agent.runtime.id) ? <option value={agent.runtime.id} disabled>{agent.runtime.label}</option> : null}
      {options.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{agentRuntimeLabel(option.id, zh ? "zh" : "en")}{!option.available
        ? option.reason === "not_installed" ? (hant ? " · 未安裝" : zh ? " · 未安装" : " · not installed")
          : option.reason === "not_registered" ? (hant ? " · 請先啟用" : zh ? " · 请先启用" : " · enable first")
          : (hant ? " · 暫不可用" : zh ? " · 暂不可用" : " · unavailable") : ""}</option>)}
    </select></label>
    <PersonalExtensionsNotice runtimeId={selected} locale={locale} />
        <button type="button" disabled={saving || !agent.configRevision || !agent.agentEpoch || !available || selected === agent.runtime.id} onClick={() => onApply(selected)}>{hant ? "使用此引擎" : zh ? "使用此引擎" : "Use this engine"}</button>
  </div>;
}

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
    <summary><span>{locale === "zh" ? "引擎" : "Engine"}</span><small>{runtimeId ? agentRuntimeLabel(runtimeId, locale)
      : locale === "zh" ? "暂未提供当前引擎信息" : "Current engine details are unavailable"}</small></summary>
    <p id={noteId}>{locale === "zh"
      ? "选择这位同事使用的引擎，模型和操作权限需要分别设置。更换只影响新任务；已有任务和历史继续使用原引擎。"
      : "Choose this colleague’s engine. Set the model and permissions separately. Changes affect new tasks; existing work keeps its original engine."}</p>
    {agent.runtime && options.length ? <>
      <div className="agent-profile-runtime-controls">
        <label><span>{locale === "zh" ? "使用的引擎" : "Engine"}</span>
          <select value={selected} disabled={!editable || saving} aria-describedby={noteId}
            onChange={(event) => setSelected(event.target.value as AgentRuntimeId)}>
            {!options.some((option) => option.id === runtimeId) && runtimeId
              ? <option value={runtimeId} disabled>{agentRuntimeLabel(runtimeId, locale)}</option> : null}
            {options.map((option) => <option key={option.id} value={option.id} disabled={!option.available}>
              {agentRuntimeLabel(option.id, locale)}{!option.available ? locale === "zh" ? " · 暂不可用" : " · unavailable" : ""}
            </option>)}
          </select>
        </label>
        <PersonalExtensionsNotice runtimeId={selected} locale={locale} />
        <button type="button" disabled={saving || !choice || !editable} onClick={() => { if (choice) onApply?.(selected); }}>
          {saving ? locale === "zh" ? "保存中…" : "Saving…" : locale === "zh" ? "保存引擎选择" : "Save engine choice"}
        </button>
      </div>
      {!agent.runtime.available ? <p role="status">{locale === "zh"
        ? "当前引擎暂不可用，不会自动更换；你可以为新任务选择其他可用引擎。"
        : "The current engine is unavailable. Hara will not change it automatically; choose another available engine for new tasks."}</p> : null}
    </> : <p>{locale === "zh" ? "更新后可为每位同事选择引擎。" : "Update to choose an engine for each colleague."}</p>}
  </details>;
}
