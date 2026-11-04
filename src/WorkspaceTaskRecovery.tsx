import { WorkspaceRuntimeVersion } from "./WorkspaceRuntimeVersion";
import type { RuntimeVersionBinding } from "./runtime-version-drift";
import type { makeT } from "./i18n";
import { useEffect, useState, type ReactNode } from "react";
import { copyRuntimeDiagnostic, RUNTIME_FAILURE_MARKER, retryRuntimeFailure, runtimeCooldownRemaining, runtimeDiagnosticSummary, runtimeLoginCommand, type RuntimeFailureDiagnostic } from "./runtime-failure";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
import { connectionRecoveryReason, runtimeTurnFailure, workspaceConversationReplying, workspaceRecoveryPromptVisible, workspaceRecoveryState } from "./workspace-resume";

export function WorkspaceTaskActivity({ conversation, name, t, children }: {
  conversation: WorkspaceDevSnapshot["conversation"]; name: string; t: ReturnType<typeof makeT>; children?: ReactNode;
}) {
  if (!workspaceConversationReplying(conversation)) return null;
  return <div className="wsd-typing" role="status">{children}<span>{t(conversation.state === "draining" ? "ws.draining" : "ws.replying", { name })}</span><i /><i /><i /></div>;
}

function RuntimeFailureDetails({ diagnostic, t }: { diagnostic: RuntimeFailureDiagnostic; t: ReturnType<typeof makeT> }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "copyFailed">("idle");
  const summary = runtimeDiagnosticSummary(diagnostic, t);
  return <details className="wsd-runtime-diagnostic" data-runtime-diagnostic="true">
    <summary>{diagnostic.errorFirstLine ?? t("ws.runtimeDiagnostic.title")}</summary>
    <pre tabIndex={0}>{summary}</pre>
    <button type="button" className="hs-btn sec" onClick={async () => {
      const clipboard = globalThis.navigator?.clipboard;
      setCopyState(await copyRuntimeDiagnostic(summary, clipboard ? value => clipboard.writeText(value) : undefined));
    }}>{t("ws.runtimeDiagnostic.copy")}</button>
    {copyState !== "idle" ? <p role="status">{t(`ws.runtimeDiagnostic.${copyState}`)}</p> : null}
  </details>;
}

function RuntimeFailureRetry({ diagnostic, disabled, t, onContinue }: {
  diagnostic: RuntimeFailureDiagnostic; disabled: boolean; t: ReturnType<typeof makeT>; onContinue(): void;
}) {
  const [now, setNow] = useState(Date.now);
  const remaining = runtimeCooldownRemaining(diagnostic, now);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining, 1000));
    return () => clearTimeout(timer);
  }, [diagnostic.retryAtMs, remaining, now]);
  return <>{remaining > 0 ? <p role="status" data-runtime-cooldown="true">{t("ws.runtimeDiagnostic.cooldown", { seconds: Math.ceil(remaining / 1000) })}</p> : null}
    <button type="button" className="hs-btn pri" data-recovery-retry="true" onClick={() => retryRuntimeFailure(diagnostic, disabled, onContinue)} disabled={disabled || remaining > 0}>{t("ws.resume.retry")}</button></>;
}

export function WorkspaceTaskRecovery({ conversation, t, disabled, continueDisabled = false, dismissedIdentity = null, runtimeId, loginSource, runtimeVersion, onContinue, onRepair, onDismiss, onLogin, onRescan, onRuntimeSettings, onNewSession }: {
  conversation: WorkspaceDevSnapshot["conversation"]; t: ReturnType<typeof makeT>; disabled: boolean; continueDisabled?: boolean;
  dismissedIdentity?: string | null; runtimeId?: string; loginSource?: "host" | "isolated"; onContinue(): void; onRepair(): void; onDismiss?(): void;
  runtimeVersion?: RuntimeVersionBinding | null; onLogin?(): void; onRescan?(): void; onRuntimeSettings?(): void;
  onNewSession?(): void;
}) {
  if (!workspaceRecoveryPromptVisible(conversation, dismissedIdentity)) return null;
  const contextFull = conversation.nativeSession?.status === "new_session_required";
  const resumeFailed = conversation.nativeSession?.status === "recovery_needed" || /\bcodex_resume_failed_history_preserved\b/.test(conversation.blockReason ?? "");
  if (contextFull || resumeFailed) return <section className="wsd-resume" aria-labelledby="workspace-recovery-title" data-recovery="native-session">
    <strong id="workspace-recovery-title">{t(contextFull ? "ws.native.limitTitle" : "ws.native.recoveryTitle")}</strong>
    <p role="status">{t(contextFull ? "ws.native.limitBody" : "ws.native.recoveryBody")}</p>
    <p>{t("ws.native.newHint")}</p>
    <div className="wsd-resume-actions">{onNewSession ? <button type="button" className="hs-btn sec" data-new-native-session="true" onClick={onNewSession}
      disabled={disabled || ["running", "draining"].includes(conversation.state)}>{t("ws.native.new")}</button> : <p>{t("ws.native.updateRequired")}</p>}</div>
  </section>;
  const state = workspaceRecoveryState(conversation);
  const reason = connectionRecoveryReason({ ...conversation, state });
  const runtime = reason ? null : runtimeTurnFailure(conversation.blockReason, runtimeId);
  const finishing = ["running", "draining"].includes(conversation.state);
  const failed = [conversation.state, conversation.taskState].some(value => value === "error" || value === "failed");
  const diagnostic = runtime?.diagnostic;
  const piConnection = (diagnostic?.runtime ?? runtimeId) === "pi";
  const scope = `${conversation.sessionId ?? ""}:${conversation.taskId ?? ""}:${conversation.runId ?? ""}:${runtimeId ?? ""}:${JSON.stringify(diagnostic)}`;
  const detail = typeof conversation.blockReason === "string" && conversation.blockReason.trim() && !conversation.blockReason.includes(RUNTIME_FAILURE_MARKER) ? conversation.blockReason : null;
  const retryDisabled = disabled || continueDisabled || finishing || conversation.resumeAdmission?.allowed === false;
  const authFailure = runtime?.kind === "runtime_auth_required" || runtime?.kind === "runtime_auth_rejected";
  const unavailable = runtime?.kind === "runtime_unavailable" || runtime?.kind === "not_installed";
  const source = diagnostic?.loginSource ?? loginSource;
  const hostOnly = ["kimi", "copilot", "cursor", "grok"].includes(runtime?.runtimeId ?? runtimeId ?? "");
  const versionFailureRuntime = /^(hara|pi|opencode|codex|claude|agy|copilot|cursor|grok) Runtime failed\b/i.exec(detail ?? "")?.[1].toLowerCase();
  const showRuntimeVersion = Boolean(runtime || failed || versionFailureRuntime) && (!runtime || runtime.runtimeId === runtimeId)
    && (!versionFailureRuntime || versionFailureRuntime === runtimeId);
  const dismiss = onDismiss ? <button type="button" className="hs-btn ghost" data-recovery-dismiss="true" onClick={onDismiss} disabled={disabled || finishing}>{t("ws.resume.dismiss")}</button> : null;
  return <section className="wsd-resume" aria-labelledby="workspace-recovery-title" data-recovery={reason ? "connection" : runtime ? "runtime" : "task"} data-failure-kind={runtime?.kind}>
    <strong id="workspace-recovery-title">{t(reason ? "ws.resume.repairTitle" : runtime ? `ws.resume.runtime.${runtime.kind}.title` : state === "cancelled" ? "ws.resume.cancelled" : "ws.resume.title")}</strong>
    {finishing ? <p role="status" data-recovery-finishing="true">{t("ws.resume.finishing")}</p> : null}
    {reason ? <><p role={failed ? "alert" : "status"}>{t(`ws.resume.${reason}`)}</p><p>{t("ws.resume.repairBody")}</p>
      <div className="wsd-resume-actions"><button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button>{dismiss}</div></>
      : <>{runtime || detail || failed ? <p role="alert">{runtime ? t(piConnection && authFailure ? "ws.runtimeDiagnostic.piConnectionAuth" : hostOnly && authFailure ? "ws.runtimeExpansion.loginReuseFailed" : `ws.resume.runtime.${runtime.kind}.body`) : detail ?? t("ws.resume.failureUnknown")}</p> : null}<p>{t(runtime ? "ws.resume.runtime.body" : "ws.resume.body")}</p>
        {runtime ? <p>{t("ws.resume.runtime.explicit")}</p> : null}
        {diagnostic?.homeMatchesAccount === false && !piConnection ? <p>{t("ws.runtimeDiagnostic.homeMismatch")}</p> : null}
        {diagnostic && authFailure ? piConnection ? <p data-runtime-connection-guidance="true">{t("ws.runtimeDiagnostic.piConnection")}</p> : !hostOnly ? <p data-runtime-login-guidance="true">{t(source === "host" ? "ws.runtimeDiagnostic.hostLogin" : source === "isolated" ? "ws.runtimeDiagnostic.privateLogin" : "ws.runtimeDiagnostic.unknownLogin", { command: runtimeLoginCommand(diagnostic.runtime) })}</p> : null : null}
        {diagnostic ? <RuntimeFailureDetails key={scope} diagnostic={diagnostic} t={t} /> : null}
        {showRuntimeVersion ? <WorkspaceRuntimeVersion runtimeId={runtimeId} binding={runtimeVersion} t={t} /> : null}
        {conversation.resumeAdmission?.allowed === false ? <p>{t("ws.resume.budget")}</p> : null}
        <div className="wsd-resume-actions">
          {diagnostic ? <RuntimeFailureRetry key={scope} diagnostic={diagnostic} t={t} disabled={retryDisabled} onContinue={onContinue} />
            : <button type="button" className={runtime ? "hs-btn pri" : "hs-btn sec"} data-recovery-retry={runtime ? "true" : undefined} onClick={onContinue} disabled={retryDisabled}>{t(runtime ? "ws.resume.retry" : "ws.resume.action")}</button>}
          {authFailure && piConnection ? <button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button> : authFailure && !hostOnly && source !== "host" && (!diagnostic || source === "isolated") ? <button type="button" className="hs-btn sec" onClick={onLogin ?? onRepair} disabled={disabled}>{t(runtime?.runtimeId === "codex" ? "ws.resume.codexLogin" : "ws.resume.runtimeLogin")}</button> : null}
          {unavailable ? <>{onRescan ? <button type="button" className="hs-btn sec" onClick={onRescan} disabled={disabled || finishing}>{t("ws.runtimeAccess.rescan")}</button> : null}
            {onRuntimeSettings ? <button type="button" className="hs-btn ghost" onClick={onRuntimeSettings} disabled={disabled}>{t("ws.runtimeAccess.install")}</button> : null}</> : null}
          {diagnostic && !unavailable && onRuntimeSettings ? <button type="button" className="hs-btn ghost" onClick={onRuntimeSettings} disabled={disabled}>{t("ws.runtimeDiagnostic.settings")}</button> : null}
          {dismiss}
        </div></>}
  </section>;
}
