import type { makeT } from "./i18n";
import type { ReactNode } from "react";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
import { connectionRecoveryReason, workspaceConversationReplying, workspaceRecoveryState } from "./workspace-resume";

export function WorkspaceTaskActivity({ conversation, name, t, children }: {
  conversation: WorkspaceDevSnapshot["conversation"]; name: string; t: ReturnType<typeof makeT>; children?: ReactNode;
}) {
  if (!workspaceConversationReplying(conversation)) return null;
  return <div className="wsd-typing" role="status">{children}<span>{t(conversation.state === "draining" ? "ws.draining" : "ws.replying", { name })}</span><i /><i /><i /></div>;
}

export function WorkspaceTaskRecovery({ conversation, t, disabled, continueDisabled = false, onContinue, onRepair }: {
  conversation: WorkspaceDevSnapshot["conversation"]; t: ReturnType<typeof makeT>; disabled: boolean; continueDisabled?: boolean; onContinue(): void; onRepair(): void;
}) {
  const state = workspaceRecoveryState(conversation);
  if (!["needs_recovery", "blocked", "cancelled", "interrupted"].includes(state)) return null;
  const reason = connectionRecoveryReason({ ...conversation, state });
  const finishing = ["running", "draining"].includes(conversation.state);
  const failed = [conversation.state, conversation.taskState].some(value => value === "error" || value === "failed");
  const detail = typeof conversation.blockReason === "string" && conversation.blockReason.trim() ? conversation.blockReason : null;
  return <section className="wsd-resume" aria-labelledby="workspace-recovery-title" data-recovery={reason ? "connection" : "task"}>
    <strong id="workspace-recovery-title">{t(reason ? "ws.resume.repairTitle" : state === "cancelled" ? "ws.resume.cancelled" : "ws.resume.title")}</strong>
    {finishing ? <p role="status" data-recovery-finishing="true">{t("ws.resume.finishing")}</p> : null}
    {reason ? <><p role={failed ? "alert" : "status"}>{t(`ws.resume.${reason}`)}</p><p>{t("ws.resume.repairBody")}</p>
      <button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button></>
      : <>{detail || failed ? <p role="alert">{detail ?? t("ws.resume.failureUnknown")}</p> : null}<p>{t("ws.resume.body")}</p>
        {conversation.resumeAdmission?.allowed === false ? <p>{t("ws.resume.budget")}</p> : null}
        <button type="button" className="hs-btn sec" onClick={onContinue} disabled={disabled || continueDisabled || finishing || conversation.resumeAdmission?.allowed === false}>{t("ws.resume.action")}</button></>}
  </section>;
}
