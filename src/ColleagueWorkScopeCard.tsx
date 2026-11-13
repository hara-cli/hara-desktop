import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { makeT, type Locale } from "./i18n";
import type { WorkspaceDevAgent, WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import { useColleagueWorkScope } from "./use-colleague-work-scope";
import { ColleagueWorkScopeEditor } from "./ColleagueWorkScopeEditor";
import { workScopeDirectoryName, workScopeToolLabelKey } from "./work-scope-labels";
import "./colleague-work-scope.css";
export function ColleagueWorkScopeCard({ model, agent, workspace, locale }: { model?: WorkspaceDevModel; agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; locale: Locale }) {
  const id = useId(), t = makeT(locale), result = useColleagueWorkScope(model, { workspaceId: workspace.workspaceId, generation: workspace.resourceGeneration,
    agentId: agent.agentId, agentEpoch: agent.agentEpoch ?? 0, configRevision: agent.configRevision ?? 0 });
  const heading = useRef<HTMLHeadingElement>(null), retryFocus = useRef(false);
  const cardRef = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    // Revocation removes the whole card. Return keyboard focus to the existing panel.
    return () => {
      if (element.contains(document.activeElement)) element.closest<HTMLElement>('[role="tabpanel"]')?.focus();
    };
  }, []);
  const phase = result?.value.state, [announcement, setAnnouncement] = useState("");
  useEffect(() => { setAnnouncement(!result ? "" : result.value.state === "loading" ? t("ws.workScope.loading") : result.value.state === "ready" ? t(result.value.view.state === "saved" ? "ws.workScope.saved" : "ws.workScope.unconfirmed") : ""); }, [phase, locale, result?.value.state === "ready" ? result.value.view.state : ""]);
  useLayoutEffect(() => {
    if (retryFocus.current && phase !== "error") { heading.current?.focus(); retryFocus.current = false; }
  }, [phase]);
  if (!result) return null; // No capability/bootstrap: no wrapper, title, private attributes or RPC.
  const state = result.value, saved = state.state === "ready" && state.view.state === "saved" ? state.view : null;
  const toolLabel = (toolId: string) => t(workScopeToolLabelKey(toolId));
  const accessLabel = (value: "read" | "write" | "execute") => value === "read" ? t("ws.workScope.access.read") : value === "write" ? t("ws.workScope.access.write") : t("ws.workScope.access.execute");
  const approvalLabel = (value: string) => ({ write: t("ws.workScope.approval.write"), execute: t("ws.workScope.approval.execute"), external_send: t("ws.workScope.approval.external"), paid: t("ws.workScope.approval.paid"),
    publish: t("ws.workScope.approval.publish"), credentials: t("ws.workScope.approval.credentials"), policy_expand: t("ws.workScope.approval.expand") } as Record<string, string>)[value];
  return <section ref={cardRef} className="hd-work-scope-card" aria-labelledby={`${id}-title`}>
    <header><h3 ref={heading} tabIndex={-1} id={`${id}-title`}>{t("ws.workScope.title")}</h3><span className="hd-work-scope-badge">{saved ? t("ws.workScope.saved") : t("ws.workScope.readOnly")}</span></header>
    <div className="hd-work-scope-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {state.state === "loading" ? <p className="hd-work-scope-notice">{t("ws.workScope.loading")}</p>
      : state.state === "error" ? <div role="alert" className="hd-work-scope-warning"><p>{t("ws.workScope.error")}</p><button type="button" className="hs-btn sec" onClick={() => { retryFocus.current = true; result.retry(); }}>{t("ws.workScope.retry")}</button></div>
      : !saved ? <p className="hd-work-scope-notice">{t("ws.workScope.unconfirmed")}</p>
      : <>
        <div className="hd-work-scope-section"><h4>{t("ws.workScope.owns")}</h4><strong className="hd-work-scope-duty-title">{saved.profile.title}</strong>{saved.profile.description ? <p className="hd-work-scope-description">{saved.profile.description}</p> : null}
          {saved.profile.owns.length > 0 ? <ul>{saved.profile.owns.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p className="hd-work-scope-muted">{t("ws.workScope.noOwns")}</p>}</div>
        <div className="hd-work-scope-section"><h4>{t("ws.workScope.rejects")}</h4>{saved.profile.rejects.length > 0 ? <ul>{saved.profile.rejects.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p className="hd-work-scope-muted">{t("ws.workScope.noRejects")}</p>}</div>
        <div className="hd-work-scope-section"><h4>{t("ws.workScope.toolsDirectories")}</h4>
          <dl><dt>{t("ws.workScope.availableTools")}</dt><dd>{saved.tools.allow.length > 0 ? saved.tools.allow.map(ref => toolLabel(ref.toolId)).join(" · ") : t("ws.workScope.noTools")}</dd>
            {saved.tools.deny.length > 0 ? <><dt>{t("ws.workScope.excludedTools")}</dt><dd>{saved.tools.deny.map(ref => toolLabel(ref.toolId)).join(" · ")}</dd></> : null}
            {saved.tools.readOnly ? <><dt>{t("ws.workScope.toolMode")}</dt><dd>{t("ws.workScope.onlyRead")}</dd></> : null}</dl>
          {saved.resources.length > 0 ? <ul className="hd-work-scope-directories">{saved.resources.map(resource => <li key={resource.resourceId}><strong>{workScopeDirectoryName(resource.label, resource.path) ?? t("ws.workScope.unnamedDirectory")}</strong>
            <span>{resource.access.map(accessLabel).join(" · ") || t("ws.workScope.noAccess")}</span></li>)}</ul> : <p className="hd-work-scope-muted">{t("ws.workScope.noDirectories")}</p>}</div>
        <div className="hd-work-scope-section"><h4>{t("ws.workScope.approvals")}</h4>{saved.approvals.length > 0 ? <ul>{saved.approvals.map(value => <li key={value}>{approvalLabel(value)}</li>)}</ul> : <p className="hd-work-scope-muted">{t("ws.workScope.noApprovals")}</p>}</div>
        <details className="hd-work-scope-advanced"><summary>{t("ws.workScope.advanced")}</summary><dl><dt>{t("ws.workScope.dutyVersion")}</dt><dd>{saved.revisions.duty}</dd><dt>{t("ws.workScope.scopeVersion")}</dt><dd>{saved.revisions.boundary}</dd>
          <dt>{t("ws.workScope.modelLimit")}</dt><dd>{saved.limits.modelCalls}</dd><dt>{t("ws.workScope.effectLimit")}</dt><dd>{saved.limits.toolEffects}</dd></dl>
          {[...saved.tools.allow, ...saved.tools.deny].map((tool, i) => <p key={`tool-${i}`}>{t("ws.workScope.toolRef")} <code>{tool.toolId} · {tool.connectorId ?? "—"} · {tool.catalogRevision}</code></p>)}
          {saved.resources.map(resource => <p key={resource.resourceId}>{t("ws.workScope.directoryRef")} <code>{resource.resourceId}</code>
            {resource.path ? <span className="hd-work-scope-path">{resource.path}</span> : null}</p>)}</details>
        <ColleagueWorkScopeEditor model={model} target={{ workspaceId: workspace.workspaceId, generation: workspace.resourceGeneration, agentId: agent.agentId, agentEpoch: agent.agentEpoch ?? 0, configRevision: agent.configRevision ?? 0 }} locale={locale} onApplied={() => { retryFocus.current = true; result.retry(); }} />
        <footer>{t("ws.workScope.savedOnly")}</footer>
      </>}
  </section>;
}
