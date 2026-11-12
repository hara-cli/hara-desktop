import { useEffect, useRef, useState } from "react";
import type { Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { WorkspaceExtensions } from "./WorkspaceExtensions";
import { OnboardingSheet, type OnboardingStepProps } from "./WorkspaceOnboarding";
import type { WorkspaceExtensionSource } from "./workspace-extensions";

/**
 * Onboarding step 2 «Third-party (optional)» (design §2 ②, hub hd-ob-third).
 * Lists plugin / MCP sources from `workspace.extensions.list` read-only: nothing is loaded or started, and host-global
 * MCP, plugins and hooks are never brought in automatically. «Review & turn on…» opens the existing Plugins & MCP panel
 * in place, so turning one on still goes through its propose / approve review card. «Not now» and «Next» both continue;
 * «Not now» records `thirdPartySkipped`.
 */
const KIND: Record<WorkspaceExtensionSource["kind"], Key> = { global: "ws.extensions.global", plugin: "ws.extensions.plugin", workspace: "ws.onboarding.third.kindWorkspace" };

export function OnboardingThirdPartyStep({ sheet, next, model, workspace }: OnboardingStepProps) {
  const { t } = useWorkspaceLocale();
  const supported = model.supportsExtensions?.() === true;
  const [sources, setSources] = useState<WorkspaceExtensionSource[] | null>(null), [failed, setFailed] = useState(false), [reviewing, setReviewing] = useState(false);
  const scope = `${workspace.workspaceId}:${workspace.resourceGeneration}`, live = useRef(scope);
  live.current = scope;
  const load = () => {
    if (!supported) return;
    setFailed(false);
    void model.extensions(workspace.workspaceId, workspace.resourceGeneration).then(view => { if (live.current === scope) setSources(view.sources); })
      .catch(() => { if (live.current === scope) setFailed(true); });
  };
  useEffect(() => { setSources(null); setReviewing(false); load(); }, [scope, supported]); // eslint-disable-line react-hooks/exhaustive-deps
  return <OnboardingSheet {...sheet} mascot="idle" title={t("ws.onboarding.third.title")} sub={t("ws.onboarding.third.sub")}
    note={t("ws.onboarding.third.boundary")}
    actions={<>
      <button type="button" disabled={sheet.busy} onClick={() => next({ thirdPartySkipped: true })}>{t("ws.onboarding.third.later")}</button>
      <button type="button" className="hs-btn pri" disabled={sheet.busy} onClick={() => next({ thirdPartySkipped: false })}>{t("ws.onboarding.engine.next")}</button>
    </>}>
    {!supported ? <p className="wob-note" role="status">{t("ws.extensions.unavailable")}</p>
      : failed ? <p className="wob-notice is-error" role="alert">{t("ws.onboarding.third.loadFailed")} <button type="button" onClick={load}>{t("ws.onboarding.engine.retry")}</button></p>
      : sources === null ? <p className="wob-note" role="status">{t("ws.onboarding.engine.status.checking")}</p>
      : !sources.length ? <p className="wob-note">{t("ws.extensions.empty")}</p>
      // The panel lists the same sources with their review card, so it replaces the read-only list instead of going stale below it.
      : reviewing ? <div className="wob-panel"><WorkspaceExtensions model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} /></div>
      : <>
        <h3 className="wob-h">{t("ws.onboarding.third.list")}<small>{t("ws.onboarding.third.listNote")}</small></h3>
        <ul className="wob-list wob-sources">{sources.map(source => <li key={source.sourceId} className="wob-row" data-source={source.sourceId}>
          <span className="wob-row-text"><b>{source.name}</b> <span className={`wob-chip${source.workspaceEnabled ? " is-ok" : ""}`}>{t(source.workspaceEnabled ? "ws.extensions.enabled" : "ws.onboarding.third.off")}</span>
            <small>{t(KIND[source.kind])} · {t("ws.onboarding.third.toolCount", { n: source.tools.length })}{source.description ? ` · ${source.description}` : ""}</small></span>
        </li>)}</ul>
        <div><button type="button" disabled={sheet.busy || sheet.readOnly} onClick={() => setReviewing(true)}>{t("ws.onboarding.third.review")}</button></div>
      </>}
  </OnboardingSheet>;
}
