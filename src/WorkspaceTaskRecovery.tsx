import type { makeT } from "./i18n";
import type { ReactNode } from "react";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
import { connectionRecoveryReason, runtimeTurnFailure, workspaceConversationReplying, workspaceRecoveryPromptVisible, workspaceRecoveryState } from "./workspace-resume";

export function WorkspaceTaskActivity({ conversation, name, t, children }: {
  conversation: WorkspaceDevSnapshot["conversation"]; name: string; t: ReturnType<typeof makeT>; children?: ReactNode;
}) {
  if (!workspaceConversationReplying(conversation)) return null;
  return <div className="wsd-typing" role="status">{children}<span>{t(conversation.state === "draining" ? "ws.draining" : "ws.replying", { name })}</span><i /><i /><i /></div>;
}

export function WorkspaceTaskRecovery({ conversation, t, disabled, continueDisabled = false, dismissedIdentity = null, runtimeId, loginSource, onContinue, onRepair, onDismiss, onLogin, onRescan, onRuntimeSettings }: {
  conversation: WorkspaceDevSnapshot["conversation"]; t: ReturnType<typeof makeT>; disabled: boolean; continueDisabled?: boolean;
  dismissedIdentity?: string | null; runtimeId?: string; loginSource?: "host" | "isolated"; onContinue(): void; onRepair(): void; onDismiss?(): void;
  onLogin?(): void; onRescan?(): void; onRuntimeSettings?(): void;
}) {
  if (!workspaceRecoveryPromptVisible(conversation, dismissedIdentity)) return null;
  const state = workspaceRecoveryState(conversation);
  const reason = connectionRecoveryReason({ ...conversation, state });
  const runtime = reason ? null : runtimeTurnFailure(conversation.blockReason, runtimeId);
  const finishing = ["running", "draining"].includes(conversation.state);
  const failed = [conversation.state, conversation.taskState].some(value => value === "error" || value === "failed");
  const detail = typeof conversation.blockReason === "string" && conversation.blockReason.trim() ? conversation.blockReason : null;
  const dismiss = onDismiss ? <button type="button" className="hs-btn ghost" data-recovery-dismiss="true" onClick={onDismiss} disabled={disabled || finishing}>{t("ws.resume.dismiss")}</button> : null;
  return <section className="wsd-resume" aria-labelledby="workspace-recovery-title" data-recovery={reason ? "connection" : runtime ? "runtime" : "task"} data-failure-kind={runtime?.kind}>
    <strong id="workspace-recovery-title">{t(reason ? "ws.resume.repairTitle" : runtime ? `ws.resume.runtime.${runtime.kind}.title` : state === "cancelled" ? "ws.resume.cancelled" : "ws.resume.title")}</strong>
    {finishing ? <p role="status" data-recovery-finishing="true">{t("ws.resume.finishing")}</p> : null}
    {reason ? <><p role={failed ? "alert" : "status"}>{t(`ws.resume.${reason}`)}</p><p>{t("ws.resume.repairBody")}</p>
      <div className="wsd-resume-actions"><button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button>{dismiss}</div></>
      : <>{runtime || detail || failed ? <p role="alert">{runtime ? t(`ws.resume.runtime.${runtime.kind}.body`) : detail ?? t("ws.resume.failureUnknown")}</p> : null}<p>{t(runtime ? "ws.resume.runtime.body" : "ws.resume.body")}</p>
        {runtime ? <p>{t("ws.resume.runtime.explicit")}</p> : null}
        {conversation.resumeAdmission?.allowed === false ? <p>{t("ws.resume.budget")}</p> : null}
        <div className="wsd-resume-actions">
          <button type="button" className={runtime ? "hs-btn pri" : "hs-btn sec"} data-recovery-retry={runtime ? "true" : undefined} onClick={onContinue} disabled={disabled || continueDisabled || finishing || conversation.resumeAdmission?.allowed === false}>{t(runtime ? "ws.resume.retry" : "ws.resume.action")}</button>
          {runtime?.kind === "runtime_auth_required" && loginSource !== "host" ? <button type="button" className="hs-btn sec" onClick={onLogin ?? onRepair} disabled={disabled}>{t(runtime.runtimeId === "codex" ? "ws.resume.codexLogin" : "ws.resume.runtimeLogin")}</button> : null}
          {runtime?.kind === "runtime_unavailable" ? <>{onRescan ? <button type="button" className="hs-btn sec" onClick={onRescan} disabled={disabled || finishing}>{t("ws.runtimeAccess.rescan")}</button> : null}
            {onRuntimeSettings ? <button type="button" className="hs-btn ghost" onClick={onRuntimeSettings} disabled={disabled}>{t("ws.runtimeAccess.install")}</button> : null}</> : null}
          {dismiss}
        </div></>}
  </section>;
}
