import { useEffect, useRef, useState } from "react";
import type { Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import type { ExtensionChange, ExtensionProposal, WorkspaceExtensionSource, WorkspaceExtensionsView } from "./workspace-extensions.ts";
import "./workspace-extensions.css";

type Draft = { enabled: boolean; allowedTools: string[] };
const savedDraft = (source: WorkspaceExtensionSource, assigned: boolean): Draft => ({
  enabled: assigned ? source.assignmentEnabled ?? false : source.enabled,
  allowedTools: [...(assigned ? source.assignedTools ?? [] : source.allowedTools)],
});
export function WorkspaceExtensions({ model, workspaceId, generation, agent, onDirty }: {
  model: WorkspaceDevModel; workspaceId: string; generation: string; agent?: { agentId: string; agentEpoch: number };
  onDirty?: (value: boolean) => void;
}) {
  const { t, locale } = useWorkspaceLocale();
  const supported = model.supportsExtensions?.() === true;
  const [view, setView] = useState<WorkspaceExtensionsView | null>(null), [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState<"" | Key>(""), [proposal, setProposal] = useState<ExtensionProposal | null>(null);
  const scope = `${workspaceId}:${generation}:${agent?.agentId ?? ""}:${agent?.agentEpoch ?? ""}`;
  const currentScope = useRef(scope), mounted = useRef(false), lifecycle = useRef(0), pending = useRef(false);
  currentScope.current = scope;
  const identity = useRef({ scope, model, version: 0 });
  if (identity.current.scope !== scope || identity.current.model !== model) identity.current = { scope, model, version: identity.current.version + 1 };
  const version = identity.current.version;
  const currentHandler = () => mounted.current && currentScope.current === scope && identity.current.version === version;
  const active = (id: number) => currentHandler() && lifecycle.current === id;
  const install = (value: WorkspaceExtensionsView, decidedSourceId?: string) => {
    const next = Object.fromEntries(value.sources.map(source => [source.sourceId,
      decidedSourceId && source.sourceId !== decidedSourceId ? drafts[source.sourceId] ?? savedDraft(source, !!agent) : savedDraft(source, !!agent)]));
    setView(value); setDrafts(next); setProposal(null); setNeedsReload(false);
    onDirty?.(value.sources.some(source => JSON.stringify(next[source.sourceId]) !== JSON.stringify(savedDraft(source, !!agent))));
  };
  const load = async () => {
    if (!supported || !currentHandler() || pending.current) return;
    const id = lifecycle.current; pending.current = true; setLoading(true); setNotice("");
    try { const value = await model.extensions(workspaceId, generation, agent); if (active(id)) install(value); }
    catch { if (active(id)) { setNeedsReload(true); setNotice("ws.extensions.loadFailed"); } }
    finally { if (active(id)) { pending.current = false; setLoading(false); } }
  };
  useEffect(() => {
    mounted.current = true; lifecycle.current++; pending.current = false; setView(null); setDrafts({}); setProposal(null); setNeedsReload(false); setBusy(false); setLoading(supported); setNotice(""); void load();
    return () => { mounted.current = false; lifecycle.current++; onDirty?.(false); };
  }, [model, workspaceId, generation, agent?.agentId, agent?.agentEpoch, supported]);
  const current = view?.workspaceId === workspaceId && view.resourceGeneration === generation && view.agentId === agent?.agentId && view.agentEpoch === agent?.agentEpoch ? view : null;
  const disabled = !supported || loading || busy || needsReload || !current || current.readOnly || !!proposal;
  const edit = (source: WorkspaceExtensionSource, draft: Draft) => {
    if (disabled || !currentHandler()) return;
    const next = { ...drafts, [source.sourceId]: draft }; setDrafts(next); setNotice("");
    onDirty?.(current!.sources.some(row => JSON.stringify(next[row.sourceId]) !== JSON.stringify(savedDraft(row, !!agent))));
  };
  const review = async (source: WorkspaceExtensionSource) => {
    if (disabled || pending.current || !currentHandler() || !current) return;
    const draft = drafts[source.sourceId]; if (!draft) return;
    const change: ExtensionChange = { target: "workspace", sourceId: source.sourceId, sourceRevision: source.sourceRevision,
      enabled: draft.enabled, allowedTools: [...draft.allowedTools].sort(), ...(agent ? { target: "agent", ...agent } : {}) } as ExtensionChange;
    const id = lifecycle.current; pending.current = true; setBusy(true); setNotice("");
    try { const value = await model.proposeExtensions(change, current.revision, workspaceId, generation); if (active(id)) setProposal(value); }
    catch { if (active(id)) { setNeedsReload(true); setNotice("ws.extensions.saveUnknown"); } }
    finally { if (active(id)) { pending.current = false; setBusy(false); } }
  };
  const decide = async (approved: boolean) => {
    if (!proposal || pending.current || !currentHandler() || needsReload) return;
    const id = lifecycle.current; pending.current = true; setBusy(true); setNotice("");
    try { const value = await model.approveExtensions(proposal, approved); if (active(id)) { install(value, proposal.change.sourceId); if (approved) setNotice("ws.extensions.saved"); } }
    catch { if (active(id)) { setProposal(null); setNeedsReload(true); setNotice("ws.extensions.saveUnknown"); } }
    finally { if (active(id)) { pending.current = false; setBusy(false); } }
  };
  const statusKey = (source: WorkspaceExtensionSource): Key => source.status === "unavailable" ? "ws.extensions.unavailableSource" : `ws.extensions.${source.status}`;
  const proposedSource = current?.sources.find(source => source.sourceId === proposal?.change.sourceId);
  return <section className="wse" aria-label={t(agent ? "ws.extensions.assignmentTitle" : "ws.extensions.title")}>
    <header className="wse-heading"><h3>{t(agent ? "ws.extensions.assignmentTitle" : "ws.extensions.title")}</h3>
      {supported ? <button type="button" disabled={loading || busy || !!proposal} onClick={() => void load()}>{t("ws.extensions.reload")}</button> : null}</header>
    <p className="wse-note">{t(model.supportsExtensionManager?.() ? "ws.extensions.managerNote" : "ws.extensions.note")}</p><p className="wse-note">{t("ws.extensions.timing")}</p>
    {!supported ? <p role="status">{t("ws.extensions.unavailable")}</p> : loading ? <p role="status">{t("ws.extensions.loading")}</p> : null}
    {notice ? <p role={notice === "ws.extensions.saved" ? "status" : "alert"}>{t(notice)}</p> : null}
    {current?.readOnly ? <p role="status">{t("ws.extensions.readOnly")}</p> : null}
    {current && !current.sources.length ? <p className="wse-empty">{t("ws.extensions.empty")}</p> : null}
    {current?.sources.map(source => {
      const draft = drafts[source.sourceId] ?? savedDraft(source, !!agent), baseline = savedDraft(source, !!agent);
      const changed = JSON.stringify(draft) !== JSON.stringify(baseline) || source.status === "needs-review";
      const rowDisabled = disabled || !!agent && !source.workspaceEnabled && !baseline.enabled;
      return <article key={source.sourceId} className="wse-source">
        <header><div><strong>{source.name}</strong><small>{t(`ws.extensions.${source.kind}`)} · {source.transport}</small></div><span className="wse-status">{t(source.callable ? "ws.extensions.callable" : statusKey(source))}</span></header>
        <p>{source.description}</p><small>{source.executableSummary}</small>
        {source.lastCall ? <details className="wse-diagnostics"><summary>{t("ws.extensions.lastCall")}</summary>
          <p>{source.tools.find(tool => tool.toolId === source.lastCall!.toolId)?.name ?? source.lastCall.toolId}</p>
          <p>{t(`ws.extensions.outcome.${source.lastCall.outcome}`)}</p><small>{new Date(source.lastCall.at).toLocaleString(locale)} · {source.lastCall.durationMs} ms</small>
          {source.lastCall.code ? <p>{t(source.lastCall.code === "mcp_schema_stale" || source.lastCall.code === "mcp_source_stale" ? "ws.extensions.callStale" : "ws.extensions.callFailed")}</p> : null}
        </details> : null}
        <label className="wse-switch"><input type="checkbox" checked={draft.enabled} disabled={rowDisabled}
          onChange={event => edit(source, { ...draft, enabled: event.target.checked })} />{t(agent ? "ws.extensions.agentSwitch" : "ws.extensions.workspaceSwitch")}</label>
        {agent && !source.workspaceEnabled ? <p className="wse-note">{t("ws.extensions.spaceFirst")}</p> : null}
        <fieldset disabled={disabled || !!agent && !source.workspaceEnabled}><legend>{t("ws.extensions.tools")}</legend>
          {source.tools.length ? source.tools.map(tool => <label key={tool.toolId} className="wse-tool"><input type="checkbox" checked={draft.allowedTools.includes(tool.toolId)}
            disabled={!!agent && !source.allowedTools.includes(tool.toolId)} onChange={event => edit(source, { ...draft, allowedTools: (event.target.checked ? [...draft.allowedTools, tool.toolId] : draft.allowedTools.filter(id => id !== tool.toolId)).sort() })} />
            <span><strong>{tool.name}</strong><small>{tool.description}</small></span></label>) : <p className="wse-note">{t("ws.extensions.noTools")}</p>}
        </fieldset>
        <footer><span>{t("ws.extensions.selected", { count: draft.allowedTools.length })}{!agent ? ` · ${t("ws.extensions.colleagues", { count: source.assignedAgentCount })}` : ""}</span>
          <button type="button" disabled={disabled || !changed} onClick={() => void review(source)}>{t("ws.extensions.review")}</button></footer>
      </article>;
    })}
    {proposal && proposedSource ? <section className="wse-confirm" role="group" aria-label={t("ws.extensions.confirmTitle")}>
      <h4>{t("ws.extensions.confirmTitle")}</h4><p><strong>{proposedSource.name}</strong> · {t(proposal.change.enabled ? "ws.extensions.enabled" : "ws.extensions.disabled")}</p>
      <p>{t("ws.extensions.selected", { count: proposal.change.allowedTools.length })}</p>
      <ul>{proposal.change.allowedTools.map(id => <li key={id}>{proposedSource.tools.find(tool => tool.toolId === id)?.name ?? id}</li>)}</ul>
      <div><button type="button" disabled={busy} onClick={() => void decide(false)}>{t("ws.extensions.cancel")}</button><button type="button" className="wsd-primary" disabled={busy} onClick={() => void decide(true)}>{t("ws.extensions.confirm")}</button></div>
    </section> : null}
  </section>;
}
