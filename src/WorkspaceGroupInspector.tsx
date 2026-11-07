import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { Avatar } from "./WorkspaceShell";
import { makeT } from "./i18n";
import { redesignText } from "./desktop-redesign-copy";
import type { LocalChannelsView, WorkspaceLocalChannelsModel, LocalChannelAutonomyPatch } from "./workspace-local-channels";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

function ReplyPreferences({ view, model, agents, locale, disabled }: { view: LocalChannelsView; model: WorkspaceLocalChannelsModel; agents: WorkspaceDevAgent[]; locale: string; disabled: boolean }) {
  const t = makeT(locale === "zh-Hans" || locale === "zh-Hant" ? locale : "en"), r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const channel = view.channel?.channel, autonomy = channel?.autonomy, current = JSON.stringify(autonomy);
  const [baseline, setBaseline] = useState(current), [draft, setDraft] = useState(autonomy), [error, setError] = useState(false);
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { if (!dirty) { setDraft(autonomy); setBaseline(current); } }, [current, dirty]);
  if (!channel || !autonomy || !draft || !model.supportsAutonomy()) return null;
  const stale = baseline !== current, unknown = view.autonomyUnknown === true;
  const locked = disabled || view.loading || view.saving || !!view.pending || !!view.queueAction || view.queueUnknown === true || view.autonomySaving === true || unknown || autonomy.mode === "ambient";
  const update = (patch: LocalChannelAutonomyPatch) => { setError(false); setDraft(previous => previous ? { ...previous, ...patch, pausedUntil: patch.pausedUntil === null ? undefined : patch.pausedUntil ?? previous.pausedUntil } : previous); };
  return <details className="hd-manage-section"><summary>{t("ws.channels.autonomy")}<small>{t(autonomy.mode === "mention" ? "ws.channels.autonomyMentionDefault" : "ws.channels.autonomyOff")}</small></summary><section className="vg-context-card hd-group-replies">
    <p>{t("ws.channels.autonomyExplicitUnaffected")}</p><fieldset disabled={locked || stale}>
      <label>{t("ws.channels.autonomyMode")}<select value={draft.mode === "ambient" ? "off" : draft.mode} onChange={event => update({ mode: event.currentTarget.value as "off" | "mention" })}><option value="off">{t("ws.channels.autonomyOff")}</option><option value="mention">{t("ws.channels.autonomyMentionDefault")}</option></select></label>
      <button type="button" className="hs-btn sec" onClick={() => update({ pausedUntil: draft.pausedUntil && Date.parse(draft.pausedUntil) > Date.now() ? null : new Date(Date.now() + 1800000).toISOString() })}>{t(draft.pausedUntil && Date.parse(draft.pausedUntil) > Date.now() ? "ws.channels.autonomyResume" : "ws.channels.autonomyPause30")}</button>
      {channel.memberIds.map(id => <label className="hd-group-mute" key={id}><input type="checkbox" checked={draft.mutedAgentIds.includes(id)} onChange={event => update({ mutedAgentIds: event.currentTarget.checked ? [...draft.mutedAgentIds, id] : draft.mutedAgentIds.filter(value => value !== id) })} />{t("ws.channels.autonomyMuteNamed", { name: agents.find(agent => agent.agentId === id)?.identity.displayName ?? r("colleagues") })}</label>)}
    </fieldset><p>{t("ws.channels.autonomyAmbientUnavailable")}</p>
    {stale || error ? <p role="alert">{r("changeFailed")}</p> : null}{unknown ? <p role="status">{t("ws.channels.autonomyUnknown")} <button type="button" disabled={disabled || view.autonomyChecking} onClick={() => void model.verifyAutonomy()}>{t("ws.channels.autonomyVerify")}</button></p> : null}
    <footer className="hd-form-footer"><span role="status">{t(dirty ? "ws.rf.unsaved" : "ws.rf.saved", { fields: t("ws.channels.autonomy") })}</span>{dirty ? <button type="button" className="hs-btn sec" disabled={locked} onClick={() => { setDraft(autonomy); setBaseline(current); setError(false); }}>{redesignText(locale, "revert")}</button> : null}<button type="button" className={`hs-btn ${dirty ? "pri" : "sec"}`} disabled={locked || stale || !dirty} onClick={async () => { const expected = { scope: view.scope, channelId: channel.id }; const accepted = await model.updateAutonomy({ mode: draft.mode as "off" | "mention", mutedAgentIds: [...draft.mutedAgentIds], pausedUntil: draft.pausedUntil ?? null }, expected); if (accepted) { const saved = model.getSnapshot().channel?.channel.autonomy; setDraft(saved); setBaseline(JSON.stringify(saved)); setError(false); } else setError(true); }}>{t("ws.rf.apply")}</button></footer>
  </section></details>;
}
export default function WorkspaceGroupInspector({ name, memberIds, agents, locale, inert, onClose, onMembers, view, model, disabled = false }: {
  name: string; memberIds: string[]; agents: WorkspaceDevAgent[]; locale: "en" | "zh-Hans" | "zh-Hant";
  inert: boolean; onClose(): void; onMembers(): void; view?: LocalChannelsView; model?: WorkspaceLocalChannelsModel; disabled?: boolean;
}) {
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key), zh = locale !== "en", tr = locale === "zh-Hant";
  return <aside id="workspace-inspector" className="vg-inspector vg-group-manage" aria-label={`${name} · ${r("manageGroup")}`} inert={inert}>
    <header><h2>{name} · {r("manage")}</h2><button className="hs-icon" aria-label={r("close")} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <div className="vg-colleague-identity"><strong>{name}</strong><span>{redesignText(locale, memberIds.length === 1 ? "groupMember" : "groupMembers", { n: memberIds.length })}</span></div>
    <details className="hd-manage-section" open><summary>{zh ? tr ? "成員" : "成员" : "Members"}<small>{memberIds.length}</small></summary><section className="vg-context-card">
      <div className="vg-group-members">{memberIds.map(id => { const agent = agents.find(row => row.agentId === id); return <div key={id}><Avatar agent={agent} /><span><strong>{agent?.identity.displayName ?? r("colleagues")}</strong><small>{agent?.state === "archived" ? r("deleted") : agent?.identity.title ?? r("colleagues")}</small></span></div>; })}</div>
      <button className="vg-manage-link" disabled={disabled} onClick={onMembers}>{zh ? tr ? "管理成員" : "管理成员" : "Manage members"} ↗</button></section></details>
    {view && model ? <ReplyPreferences key={JSON.stringify([view.scope, view.channelId])} view={view} model={model} agents={agents} locale={locale} disabled={disabled} /> : null}
  </aside>;
}
