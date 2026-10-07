import { useEffect, useState } from "react";
import type { TaskApprovalState, TaskApprovalToolFamily } from "./client";
import { makeT, type Key, type Locale } from "./i18n";
import { createTaskApprovalSubmission, taskApprovalActive, taskApprovalEstimatedExpired } from "./task-approval-state";

const FAMILY_KEYS: Record<TaskApprovalToolFamily, Key> = { bash: "taskApprovalBash", python: "taskApprovalPython", "file-change": "taskApprovalFiles" };

/** This status comes only from the Engine; choosing a card never optimistically activates it. */
export default function TaskApprovalStatus({ state, sessionId, locale, onRevoke }: {
  state: TaskApprovalState;
  sessionId: string;
  locale: Locale;
  onRevoke: (sessionId: string, commandId: string) => Promise<void>;
}) {
  const t = makeT(locale);
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [submission] = useState(() => createTaskApprovalSubmission(() => crypto.randomUUID()));
  const expiry = Date.parse(state.expiresAt ?? "");
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [expiry]);
  const revoke = async () => {
    if (!state.canRevoke || !taskApprovalActive(state) || submission.isLocked()) return;
    setPending(true);
    setFailed(false);
    try { await submission.submit((commandId) => onRevoke(sessionId, commandId)); }
    catch { setFailed(true); setPending(false); }
  };
  if (!taskApprovalActive(state)) return null;
  const needsVerification = taskApprovalEstimatedExpired(state, now);
  return (
    <section className="task-approval-status" aria-label={t("taskApprovalActive")}>
      <div><strong>{t(needsVerification ? "taskApprovalVerifying" : "taskApprovalActive")}</strong>
        <span>{state.toolFamilies.map((family) => t(FAMILY_KEYS[family])).join(" · ")}</span>
        <small>{t("taskApprovalUntil")} {new Date(expiry).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })} · {t("taskApprovalStatusScope")}</small>
      </div>
      {state.canRevoke ? <button type="button" disabled={pending} aria-busy={pending} onClick={() => void revoke()}>{t(pending ? "taskApprovalRevoking" : "taskApprovalRevoke")}</button> : null}
      {failed ? <p role="alert">{t("taskApprovalRevokeFailed")}</p> : null}
    </section>
  );
}
