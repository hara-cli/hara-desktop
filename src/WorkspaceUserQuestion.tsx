import { useState } from "react";
import type { makeT } from "./i18n";
import type { WorkspaceQuestionConversation } from "./workspace-dev-state";
import { connectionRecoveryReason } from "./workspace-resume";

/** A question is scoped server state. No default, timeout answer, retry timer or browser storage.
 * In the chat slot it replaces the composer: the card's own answer field is the only input while
 * a question is pending. Minimizing only folds the display; it never answers or dismisses. */
export function WorkspaceUserQuestion({ conversation, t, disabled, supported, onAnswer, onRepair, onPause, placement = "thread" }: {
  conversation: WorkspaceQuestionConversation; t: ReturnType<typeof makeT>; disabled: boolean; supported: boolean;
  onAnswer(questionId: string, answer: string): void; onRepair(): void; onPause?(questionId: string): void;
  placement?: "thread" | "composer";
}) {
  const [answer, setAnswer] = useState("");
  const [minimized, setMinimized] = useState(false);
  const question = conversation.pendingQuestion; if (!question) return null;
  const finishing = ["running", "draining"].includes(conversation.state);
  const connection = connectionRecoveryReason(conversation);
  const blocked = disabled || !supported || finishing || Boolean(connection) || conversation.resumeAdmission?.allowed === false;
  const titleId = `question-${question.id}`;
  if (placement === "composer" && minimized) return <button type="button" className="wsd-ask wsd-ask-min" data-task-state="awaiting_user"
    aria-label={t("ws.question.restore")} onClick={() => setMinimized(false)}><strong>{t("ws.question.title")}</strong><span>{question.question}</span></button>;
  return <section className={`wsd-ask wsd-user-question is-${placement}`} aria-labelledby={titleId} data-task-state="awaiting_user">
    <header className="wsd-ask-head"><span className="wsd-ask-title">{t("ws.question.title")}</span><span className="wsd-ask-reason" role="status">{t(`ws.question.reason.${question.reason}`)}</span>
      {placement === "composer" ? <button type="button" className="wsd-ask-fold" aria-label={t("ws.question.minimize")} onClick={() => setMinimized(true)}>−</button> : null}</header>
    <p id={titleId} className="wsd-user-question-text">{question.question}</p>
    {question.step ? <p className="wsd-ask-step"><strong>{t("ws.question.step")}</strong> {question.step}</p> : null}
    {finishing ? <p role="status">{t("ws.resume.finishing")}</p> : null}
    {!supported ? <p role="alert">{t("ws.question.unsupported")}</p> : null}
    {conversation.resumeAdmission?.allowed === false ? <p role="alert">{t("ws.resume.budget")}</p> : null}
    {connection ? <><p role="alert">{t(`ws.resume.${connection}`)}</p><button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button></> : null}
    {question.options.length ? <div className="wsd-ask-options" role="group" aria-label={t("ws.question.choices")}>{question.options.map((option, index) =>
      <button type="button" className="hs-btn sec" key={`${question.id}:${index}`} disabled={blocked} onClick={() => onAnswer(question.id, option)}>{option}</button>)}</div> : null}
    <form className="wsd-ask-form" onSubmit={event => { event.preventDefault(); if (!blocked && answer.trim()) onAnswer(question.id, answer); }}>
      <textarea aria-label={t("ws.question.answer")} placeholder={t("ws.question.answer")} value={answer} maxLength={4000} rows={2} disabled={blocked} onChange={event => setAnswer(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!blocked && answer.trim()) onAnswer(question.id, answer); } }} />
      <button type="submit" className="hs-btn pri" disabled={blocked || !answer.trim()}>{t("ws.question.continue")}</button>
    </form>
    <footer className="wsd-ask-foot"><small>{t("ws.question.saved")} {t("ws.question.noDefault")}</small>{onPause ? <button type="button" className="hs-btn sec" data-question-action="pause" disabled={disabled || !supported || finishing} onClick={() => onPause(question.id)}>{t("ws.question.pause")}</button> : null}</footer>
  </section>;
}
