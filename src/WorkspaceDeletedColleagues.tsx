import { useState, useId } from "react";
import type { WorkspaceDevAgent, WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import { redesignText } from "./desktop-redesign-copy";
export function WorkspaceDeletedColleagues({ model, workspace, locale, onOpen }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; locale: string; onOpen?(agent: WorkspaceDevAgent): void }) {
  const id = useId();
  const [tab, setTab] = useState<"active" | "deleted">("deleted"), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState("");
  const r = (key: Parameters<typeof redesignText>[1], values: Record<string, string | number> = {}) => redesignText(locale, key, values);
  const all = workspace.agents.filter(agent => agent.kind === "colleague"), rows = all.filter(agent => (agent.state === "archived") === (tab === "deleted"));
  const restore = async (agent: WorkspaceDevAgent) => { if (busy) return; setBusy(agent.agentId); setNotice("");
    try { await model.setAgentArchived(agent, false); setNotice(r("restored", { name: agent.identity.displayName })); }
    catch { setNotice(r("archiveFailed")); } finally { setBusy(null); } };
  return <section className="hd-deleted-colleagues" aria-label={`${r("colleagues")} › ${r("deleted")}`}>
    <div className="hd-settings-tabs" role="tablist" aria-label={r("colleagues")} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "active" : event.key === "End" ? "deleted" : tab === "active" ? "deleted" : "active"; setTab(next); document.getElementById(`${id}-${next}`)?.focus(); }}><button type="button" role="tab" id={`${id}-active`} aria-controls={`${id}-panel`} tabIndex={tab === "active" ? 0 : -1} aria-selected={tab === "active"} onClick={() => setTab("active")}>{r("colleagues")} · {all.filter(agent => agent.state === "active").length}</button><button type="button" role="tab" id={`${id}-deleted`} aria-controls={`${id}-panel`} tabIndex={tab === "deleted" ? 0 : -1} aria-selected={tab === "deleted"} onClick={() => setTab("deleted")}>{r("deleted")} · {all.filter(agent => agent.state === "archived").length}</button></div>
    {tab === "deleted" ? <p>{r("restoreNote")}</p> : null}
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>{rows.map(agent => <article key={agent.agentId} className="hd-deleted-row"><div><strong>{agent.identity.displayName}</strong><span>{agent.identity.title}</span>{tab === "deleted" ? <><time dateTime={agent.archivedAt}>{agent.archivedAt && Number.isFinite(Date.parse(agent.archivedAt)) ? new Date(agent.archivedAt).toLocaleString(locale) : "—"}</time><small>{r("keptConversation")}{agent.pausedScheduleCount ? ` · ${r("pausedCount", { n: agent.pausedScheduleCount })}` : ""}</small></> : null}</div>
      {tab === "deleted" ? <button type="button" className="hs-btn sec" disabled={Boolean(busy) || !model.supportsAgentArchive()} onClick={() => void restore(agent)}>{r("restore")}</button> : onOpen ? <button type="button" className="hs-btn sec" onClick={() => onOpen(agent)}>{r("open")}</button> : null}</article>)}{!rows.length ? <p>{r(tab === "deleted" ? "deletedEmpty" : "empty")}</p> : null}</div>
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
