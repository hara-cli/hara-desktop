import type { makeT } from "./i18n";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
import { connectionRecoveryReason } from "./workspace-resume";

export function WorkspaceTaskRecovery({ conversation, t, disabled, continueDisabled = false, onContinue, onRepair }: {
  conversation: WorkspaceDevSnapshot["conversation"]; t: ReturnType<typeof makeT>; disabled: boolean; continueDisabled?: boolean; onContinue(): void; onRepair(): void;
}) {
  if (!["needs_recovery", "blocked", "cancelled", "interrupted"].includes(conversation.state)) return null;
  const reason = connectionRecoveryReason(conversation);
  return <section className="wsd-resume" aria-labelledby="workspace-recovery-title" data-recovery={reason ? "connection" : "task"}>
    <strong id="workspace-recovery-title">{t(reason ? "ws.resume.repairTitle" : conversation.state === "cancelled" ? "ws.resume.cancelled" : "ws.resume.title")}</strong>
    {reason ? <><p role="status">{t(`ws.resume.${reason}`)}</p><p>{t("ws.resume.repairBody")}</p>
      <button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button></>
      : <>{conversation.blockReason ? <p role="alert">{conversation.blockReason}</p> : null}<p>{t("ws.resume.body")}</p>
        {conversation.resumeAdmission?.allowed === false ? <p>{t("ws.resume.budget")}</p> : null}
        <button type="button" className="hs-btn sec" onClick={onContinue} disabled={disabled || continueDisabled || conversation.resumeAdmission?.allowed === false}>{t("ws.resume.action")}</button></>}
  </section>;
}
