import { makeT } from "./i18n";
import { inheritsPersonalExtensions } from "./runtime-expansion";
import { useEffect, useId, useState } from "react";
import type { AgentInfo, AgentRuntimeId, AgentRuntimeOption } from "./client";
import { agentRuntimeLabel, agentRuntimeSelection } from "./agent-runtime-selection";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import { toLocale, type Locale as ShellLocale } from "./i18n-runtime.ts";

/** Only `ws.*` keys are passed here; `makeT` accepts the legacy "zh" alias as well. */

function PersonalExtensionsNotice({ runtimeId, locale }: { runtimeId: string; locale: ShellLocale | "zh" }) {
  if (!inheritsPersonalExtensions(runtimeId)) return null;
  const t = makeT(toLocale(locale));
  return <><p role="status" data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p><p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p></>;
}

/** Soft Dark uses the same Registry options, with the Workspace agent's revision fence. */
export function WorkspaceAgentRuntimePicker({ agent, options, locale, saving, onApply }: {
  agent: WorkspaceDevAgent; options: AgentRuntimeOption[]; locale: ShellLocale | "zh"; saving: boolean;
  onApply(id: AgentRuntimeId): void;
}) {
  const [selected, setSelected] = useState<AgentRuntimeId>(agent.runtime.id as AgentRuntimeId);
  useEffect(() => setSelected(agent.runtime.id as AgentRuntimeId), [agent.agentId, agent.runtime.id, agent.configRevision]);
  const available = options.some(option => option.id === selected && option.available);
  const t = makeT(locale);
  return <div className="agent-profile-runtime-controls">
    <label><span>{t("ws.rf.engine")}</span><select aria-label={t("ws.rf.engine")} value={selected} disabled={saving} onChange={event => setSelected(event.target.value as AgentRuntimeId)}>
      {!options.some(option => option.id === agent.runtime.id) ? <option value={agent.runtime.id} disabled>{agent.runtime.label}</option> : null}
      {options.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{agentRuntimeLabel(option.id, locale)}{!option.available
        ? option.reason === "detection_pending" ? ` · ${t("ws.runtimes.checking")}`
          : option.reason === "detection_failed" ? ` · ${t("ws.runtimes.detectFailed")}`
          : option.reason === "not_installed" ? ` · ${t("ws.runtimePicker.notInstalled")}`
          : option.reason === "not_registered" ? ` · ${t("ws.runtimePicker.enableFirst")}`
          : ` · ${t("ws.runtimePicker.unavailable")}` : ""}</option>)}
    </select></label>
    <PersonalExtensionsNotice runtimeId={selected} locale={locale} />
        <button type="button" disabled={saving || !agent.configRevision || !agent.agentEpoch || !available || selected === agent.runtime.id} onClick={() => onApply(selected)}>{t("ws.runtimePicker.inUse")}</button>
  </div>;
}

export default function AgentRuntimePicker({ agent, options = [], locale, saving, onApply }: {
  agent: AgentInfo;
  options?: AgentRuntimeOption[];
  locale: ShellLocale | "zh";
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
  const t = makeT(locale);
  return <details className="agent-profile-runtime">
    <summary><span>{t("ws.rf.engine")}</span><small>{runtimeId ? agentRuntimeLabel(runtimeId, locale)
      : t("ws.runtimePicker.noEngineInfo")}</small></summary>
    <p id={noteId}>{t("ws.runtimePicker.body")}</p>
    {agent.runtime && options.length ? <>
      <div className="agent-profile-runtime-controls">
        <label><span>{t("ws.rf.engine")}</span>
          <select value={selected} disabled={!editable || saving} aria-describedby={noteId}
            onChange={(event) => setSelected(event.target.value as AgentRuntimeId)}>
            {!options.some((option) => option.id === runtimeId) && runtimeId
              ? <option value={runtimeId} disabled>{agentRuntimeLabel(runtimeId, locale)}</option> : null}
            {options.map((option) => <option key={option.id} value={option.id} disabled={!option.available}>
              {agentRuntimeLabel(option.id, locale)}{!option.available ? ` · ${t("ws.runtimePicker.unavailable")}` : ""}
            </option>)}
          </select>
        </label>
        <PersonalExtensionsNotice runtimeId={selected} locale={locale} />
        <button type="button" disabled={saving || !choice || !editable} onClick={() => { if (choice) onApply?.(selected); }}>
          {saving ? t("ws.action.saving") : t("ws.runtimePicker.saveChoice")}
        </button>
      </div>
      {!agent.runtime.available ? <p role="status">{t("ws.runtimePicker.unavailableHint")}</p> : null}
    </> : <p>{t("ws.runtimePicker.upgrade")}</p>}
  </details>;
}
