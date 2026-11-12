import { useEffect, useRef, useState } from "react";
import type { Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import type { ExtensionChange, ExtensionProposal, WorkspaceExtensionSource, WorkspaceExtensionsView } from "./workspace-extensions.ts";
import type { McpReviewDetail, McpReviewList } from "./workspace-mcp-review.ts";
import { SettingsAdvanced, SettingsAttention } from "./SettingsChrome";
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
  const [ownerLocked, setOwnerLocked] = useState(false), [openTools, setOpenTools] = useState<Record<string, boolean>>({});
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
  const load = async (decidedSourceId?: string) => {
    if (!supported || !currentHandler() || pending.current) return;
    const id = lifecycle.current; pending.current = true; setLoading(true); setNotice("");
    try { const value = await model.extensions(workspaceId, generation, agent); if (active(id)) install(value, decidedSourceId); }
    catch { if (active(id)) { setNeedsReload(true); setNotice("ws.extensions.loadFailed"); } }
    finally { if (active(id)) { pending.current = false; setLoading(false); } }
  };
  useEffect(() => {
    mounted.current = true; lifecycle.current++; pending.current = false; setView(null); setDrafts({}); setProposal(null); setNeedsReload(false); setBusy(false); setOwnerLocked(false); setLoading(supported); setNotice(""); void load();
    return () => { mounted.current = false; lifecycle.current++; onDirty?.(false); };
  }, [model, workspaceId, generation, agent?.agentId, agent?.agentEpoch, supported]);
  const current = view?.workspaceId === workspaceId && view.resourceGeneration === generation && view.agentId === agent?.agentId && view.agentEpoch === agent?.agentEpoch ? view : null;
  const disabled = !supported || loading || busy || ownerLocked || needsReload || !current || current.readOnly || !!proposal;
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
  const reload = <button type="button" disabled={loading || busy || ownerLocked || !!proposal} onClick={() => void load()}>{t("ws.extensions.reload")}</button>;
  // Settings IA audit (S2b): a source that changed after review is pinned at the top; the bar takes you to its card,
  // whose review flow is unchanged. Never loads or starts anything.
  const attention = !agent && current ? current.sources.filter(source => source.status === "needs-review").map(source => ({ id: `extension:${source.sourceId}`,
    // Read-only viewers cannot review, so their bar asks the owner and has no button that would do nothing (review of #95, L1).
    text: t(current.readOnly ? "ws.extensions.attentionReviewOwner" : "ws.extensions.attentionReview", { name: source.name }), action: current.readOnly ? undefined : { label: t("ws.extensions.attentionOpen"), onClick: () => {
      const card = document.getElementById(`wse-${source.sourceId}`); card?.scrollIntoView({ block: "center" }); card?.querySelector<HTMLElement>(".wse-review")?.focus(); } } })) : [];
  return <section className="wse" aria-label={t(agent ? "ws.extensions.assignmentTitle" : "ws.extensions.title")}>
    <header className="wse-heading"><h3>{t(agent ? "ws.extensions.assignmentTitle" : "ws.extensions.title")}</h3>
      {/* In Settings «Reload» is a low-frequency action under Advanced, except when loading failed and it is the way out. */}
      {supported && (agent || needsReload) ? reload : null}</header>
    <SettingsAttention items={attention} />
    <p className="wse-note">{t(model.supportsExtensionManager?.() ? "ws.extensions.managerNoteLine" : "ws.extensions.noteLine")}</p>
    {!supported ? <p role="status">{t("ws.extensions.unavailable")}</p> : loading ? <p role="status">{t("ws.extensions.loading")}</p> : null}
    {notice ? <p role={notice === "ws.extensions.saved" ? "status" : "alert"}>{t(notice)}</p> : null}
    {current?.readOnly ? <p role="status">{t("ws.extensions.readOnly")}</p> : null}
    {current && !current.sources.length ? <p className="wse-empty">{t("ws.extensions.empty")}</p> : null}
    {current?.sources.map(source => {
      const draft = drafts[source.sourceId] ?? savedDraft(source, !!agent), baseline = savedDraft(source, !!agent);
      const changed = JSON.stringify(draft) !== JSON.stringify(baseline) || source.status === "needs-review";
      const rowDisabled = disabled || !!agent && !source.workspaceEnabled && !baseline.enabled;
      // The tool list folds into one line; it opens by itself the first time the source is switched on (S2b).
      const toolsOpen = openTools[source.sourceId] ?? (draft.enabled && !baseline.enabled);
      const summary = source.tools.length === 1 ? t("ws.extensions.toolSummaryOne", { a: draft.allowedTools.length }) : t("ws.extensions.toolSummary", { a: draft.allowedTools.length, b: source.tools.length });
      return <article key={source.sourceId} id={`wse-${source.sourceId}`} className="wse-source">
        <header><div><strong>{source.name}</strong><small>{t(`ws.extensions.${source.kind}`)}</small></div><span className="wse-status">{t(source.callable ? "ws.extensions.callable" : statusKey(source))}</span></header>
        {source.description ? <p>{source.description}</p> : null}
        <label className="wse-switch"><input type="checkbox" checked={draft.enabled} disabled={rowDisabled}
          onChange={event => edit(source, { ...draft, enabled: event.target.checked })} />{t(agent ? "ws.extensions.agentSwitch" : "ws.extensions.workspaceSwitch")}</label>
        {agent && !source.workspaceEnabled ? <p className="wse-note">{t("ws.extensions.spaceFirst")}</p> : null}
        <details className="wse-tools" open={toolsOpen} onToggle={event => { const open = event.currentTarget.open; if (open !== toolsOpen) setOpenTools(current => ({ ...current, [source.sourceId]: open })); }}>
          <summary><span>{summary}{!agent ? ` · ${source.assignedAgentCount === 1 ? t("ws.extensions.usedByOne") : t("ws.extensions.usedBy", { n: source.assignedAgentCount })}` : ""}</span><span className="wse-choose">{t("ws.extensions.chooseTools")}</span></summary>
        <fieldset disabled={disabled || !!agent && !source.workspaceEnabled}><legend>{t("ws.extensions.tools")}</legend>
          {source.tools.length ? source.tools.map(tool => <label key={tool.toolId} className="wse-tool"><input type="checkbox" checked={draft.allowedTools.includes(tool.toolId)}
            disabled={!!agent && !source.allowedTools.includes(tool.toolId)} onChange={event => edit(source, { ...draft, allowedTools: (event.target.checked ? [...draft.allowedTools, tool.toolId] : draft.allowedTools.filter(id => id !== tool.toolId)).sort() })} />
            <span><strong>{tool.name}</strong><small>{tool.description}</small></span></label>) : <p className="wse-note">{t("ws.extensions.noTools")}</p>}
        </fieldset></details>
        {/* Transport, start command and the most recent call are diagnostics: one «Details» fold per source (S2b). */}
        <details className="wse-details"><summary>{t("ws.extensions.details")}</summary>
          <small>{source.transport} · {source.executableSummary}</small>
          {source.lastCall ? <div className="wse-diagnostics"><strong>{t("ws.extensions.lastCall")}</strong>
            <p>{source.tools.find(tool => tool.toolId === source.lastCall!.toolId)?.name ?? source.lastCall.toolId}</p>
            <p>{t(`ws.extensions.outcome.${source.lastCall.outcome}`)}</p><small>{new Date(source.lastCall.at).toLocaleString(locale)} · {source.lastCall.durationMs} ms</small>
            {source.lastCall.code ? <p>{t(source.lastCall.code === "mcp_schema_stale" || source.lastCall.code === "mcp_source_stale" ? "ws.extensions.callStale" : "ws.extensions.callFailed")}</p> : null}
          </div> : null}
        </details>
        <footer><button type="button" className="wse-review" disabled={disabled || !changed} onClick={() => void review(source)}>{t("ws.extensions.review")}</button></footer>
      </article>;
    })}
    {!agent && model.supportsMcpOwnerReview?.() ? <WorkspaceMcpOwnerReview model={model} workspaceId={workspaceId} generation={generation}
      blocked={loading || busy || needsReload || !!proposal || !!current?.sources.some(source => JSON.stringify(drafts[source.sourceId] ?? savedDraft(source, false)) !== JSON.stringify(savedDraft(source, false)))}
      onBusy={setOwnerLocked} onChanged={sourceId => load(sourceId)} /> : null}
    {!agent && supported && !needsReload ? <SettingsAdvanced page="extensions" items={[t("ws.extensions.reloadShort")]}>{reload}</SettingsAdvanced> : null}
    {proposal && proposedSource ? <section className="wse-confirm" role="group" aria-label={t("ws.extensions.confirmTitle")}>
      <h4>{t("ws.extensions.confirmTitle")}</h4><p><strong>{proposedSource.name}</strong> · {t(proposal.change.enabled ? "ws.extensions.enabled" : "ws.extensions.disabled")}</p>
      <p>{t("ws.extensions.selected", { count: proposal.change.allowedTools.length })}</p>
      <ul>{proposal.change.allowedTools.map(id => <li key={id}>{proposedSource.tools.find(tool => tool.toolId === id)?.name ?? id}</li>)}</ul>
      <div><button type="button" disabled={busy} onClick={() => void decide(false)}>{t("ws.extensions.cancel")}</button><button type="button" className="wsd-primary" disabled={busy} onClick={() => void decide(true)}>{t("ws.extensions.confirm")}</button></div>
    </section> : null}
  </section>;
}

// This surface is absent from colleague assignment panels; Host also checks the Main owner session.
export function WorkspaceMcpOwnerReview({ model, workspaceId, generation, blocked = false, onBusy, onChanged }: {
  model: WorkspaceDevModel; workspaceId: string; generation: string; blocked?: boolean;
  onBusy?: (value: boolean) => void; onChanged?: (sourceId: string) => Promise<void>;
}) {
  const { t } = useWorkspaceLocale();
  const [list, setList] = useState<McpReviewList | null>(null), [detail, setDetail] = useState<McpReviewDetail | null>(null);
  const [busy, setBusy] = useState(false), [needsReload, setNeedsReload] = useState(false), [revoke, setRevoke] = useState(false);
  const [notice, setNotice] = useState<"" | Key>("");
  const halted = useRef(false), blockedNow = useRef(blocked); blockedNow.current = blocked;
  const mounted = useRef(false), lifecycle = useRef(0), pending = useRef(false), record = useRef<string | null>(null);
  const identity = useRef({ model, workspaceId, generation, version: 0 });
  if (identity.current.model !== model || identity.current.workspaceId !== workspaceId || identity.current.generation !== generation)
    identity.current = { model, workspaceId, generation, version: identity.current.version + 1 };
  const version = identity.current.version;
  const current = () => mounted.current && version === identity.current.version;
  const active = (id: number) => current() && lifecycle.current === id;
  const load = async () => {
    if (!current() || pending.current || record.current) return;
    const id = lifecycle.current; pending.current = true; setBusy(true); setNotice("");
    try { const value = await model.mcpReviews(workspaceId, generation); if (active(id)) { setList(value); setNeedsReload(false); halted.current = false; } }
    catch { if (active(id)) { halted.current = true; setNeedsReload(true); setNotice("ws.mcpReview.loadFailed"); } }
    finally { if (active(id)) { pending.current = false; setBusy(false); } }
  };
  useEffect(() => {
    mounted.current = true; lifecycle.current++; pending.current = false; record.current = null; halted.current = false;
    setList(null); setDetail(null); setNeedsReload(false); setRevoke(false); setNotice(""); setBusy(false); void load();
    return () => {
      mounted.current = false; lifecycle.current++; onBusy?.(false);
      if (record.current) void model.cancelMcpReview(record.current, workspaceId, generation).catch(() => {});
    };
  }, [model, workspaceId, generation]);
  const open = async (recordId: string) => {
    if (!current() || blockedNow.current || halted.current || busy || needsReload || pending.current || record.current || list?.readOnly || !list?.allowed) return;
    const id = lifecycle.current; pending.current = true; record.current = recordId; onBusy?.(true); setBusy(true); setNotice(""); setRevoke(false);
    try { const value = await model.describeMcpReview(recordId, workspaceId, generation); if (active(id)) setDetail(value); }
    catch { if (active(id)) { halted.current = true; setNeedsReload(true); setNotice("ws.mcpReview.saveUnknown"); } }
    finally { if (active(id)) { pending.current = false; setBusy(false); } }
  };
  const close = () => {
    if (!current()) return;
    const old = record.current; lifecycle.current++; pending.current = false; record.current = null; onBusy?.(false);
    setDetail(null); setBusy(false); setRevoke(false); setNotice("");
    if (old) void model.cancelMcpReview(old, workspaceId, generation).catch(() => {});
    // Cancellation is fenced by record id; this read does not retry any inspection or write.
    void load();
  };
  const decide = async (action: "inspect" | "approve" | "revoke") => {
    if (!current() || blockedNow.current || halted.current || busy || needsReload || pending.current || !detail || record.current !== detail.recordId
      || action === "inspect" && !detail.canInspect || action === "approve" && !detail.canApprove || action === "revoke" && (!detail.hasReview || !revoke)) return;
    const id = lifecycle.current; pending.current = true; setBusy(true); setNotice("");
    try {
      const value = await model.decideMcpReview(action, detail.recordId, workspaceId, generation);
      if (!active(id)) return;
      setDetail(value); setRevoke(false);
      if (action !== "inspect") { await onChanged?.(detail.sourceId); if (active(id)) setNotice(action === "approve" ? "ws.mcpReview.saved" : "ws.mcpReview.revoked"); }
    } catch { if (active(id)) { halted.current = true; setNeedsReload(true); setNotice("ws.mcpReview.saveUnknown"); } }
    finally { if (active(id)) { pending.current = false; setBusy(false); } }
  };
  const disabled = blocked || busy || needsReload || !current();
  return <section className="wse-owner" aria-label={t("ws.mcpReview.title")}>
    <header className="wse-heading"><h3>{t("ws.mcpReview.title")}</h3>
      {!record.current ? <button type="button" disabled={busy || blocked} onClick={() => void load()}>{t("ws.extensions.reload")}</button> : <button type="button" onClick={close}>{t("ws.mcpReview.close")}</button>}</header>
    <p className="wse-note">{t("ws.mcpReview.note")}</p>
    {blocked ? <p role="status">{t("ws.mcpReview.drafts")}</p> : null}
    {notice ? <p role={notice === "ws.mcpReview.saved" || notice === "ws.mcpReview.revoked" ? "status" : "alert"}>{t(notice)}</p> : null}
    {busy ? <p role="status">{t("ws.mcpReview.loading")}</p> : null}
    {list && !list.allowed ? <p role="status">{t("ws.mcpReview.owner_required")}</p> : list?.readOnly ? <p role="alert">{t("ws.mcpReview.library_read_only")}</p> : null}
    {!record.current && list?.allowed ? <div className="wse-review-list">{list.sources.map(source => <article key={source.sourceId}>
      <div><strong>{source.name}</strong><small>{t(`ws.mcpReview.status.${source.status}`)}</small>
        {source.reason ? <p className="wse-note">{t(`ws.mcpReview.${source.reason}`)}</p> : null}</div>
      <button type="button" disabled={disabled || list.readOnly || !source.recordId} onClick={() => source.recordId && void open(source.recordId)}>{t("ws.mcpReview.open")}</button>
    </article>)}</div> : null}
    {detail ? <section className="wse-review-detail" aria-label={t("ws.mcpReview.details")}>
      <h4>{detail.name}</h4><dl>
        <dt>{t("ws.mcpReview.source")}</dt><dd>{detail.sourceId} · {detail.transport}</dd>
        {detail.binaryPath ? <><dt>{t("ws.mcpReview.binary")}</dt><dd><code>{detail.binaryPath}</code></dd></> : null}
        {detail.packagePath ? <><dt>{t("ws.mcpReview.package")}</dt><dd><code>{detail.packagePath}</code></dd></> : null}
        {detail.binaryDigest ? <><dt>{t("ws.mcpReview.binaryDigest")}</dt><dd><code>{detail.binaryDigest}</code></dd></> : null}
        {detail.packageDigest ? <><dt>{t("ws.mcpReview.packageDigest")}</dt><dd><code>{detail.packageDigest}</code></dd></> : null}
        {detail.launchSummary ? <><dt>{t("ws.mcpReview.launch")}</dt><dd><code>{detail.launchSummary}</code></dd></> : null}
      </dl><p>{t("ws.mcpReview.network")}</p><p>{t("ws.mcpReview.credentials")}</p>
      {detail.reason ? <p role="alert">{t(`ws.mcpReview.${detail.reason}`)}</p> : null}
      {detail.canInspect ? <><p>{t("ws.mcpReview.startWarning")}</p><button type="button" disabled={disabled} onClick={() => void decide("inspect")}>{t("ws.mcpReview.inspect")}</button></> : null}
      {detail.tools.length ? <div className="wse-review-tools"><h4>{t("ws.extensions.tools")}</h4>{detail.tools.map(tool => <article key={tool.name}>
        <strong>{tool.name}</strong><p>{tool.description}</p><details><summary>{t("ws.mcpReview.schema")}</summary><pre>{JSON.stringify(tool.schema, null, 2)}</pre><small>SHA256 · {tool.schemaDigest}</small></details>
      </article>)}</div> : null}
      {detail.canApprove ? <><p>{t("ws.mcpReview.enableLater")}</p><button type="button" className="wsd-primary" disabled={disabled} onClick={() => void decide("approve")}>{t("ws.mcpReview.approve")}</button></> : null}
      {detail.hasReview ? <div className="wse-review-revoke">{revoke ? <><p>{t("ws.mcpReview.revokeWarning")}</p><button type="button" disabled={disabled} onClick={() => setRevoke(false)}>{t("ws.extensions.cancel")}</button><button type="button" disabled={disabled} onClick={() => void decide("revoke")}>{t("ws.mcpReview.confirmRevoke")}</button></>
        : <button type="button" disabled={disabled} onClick={() => setRevoke(true)}>{t("ws.mcpReview.revoke")}</button>}</div> : null}
    </section> : null}
  </section>;
}
