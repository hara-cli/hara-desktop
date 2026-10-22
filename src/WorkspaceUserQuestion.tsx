import { useState } from "react";
import type { makeT } from "./i18n";
import type { WorkspaceQuestionConversation } from "./workspace-dev-state";
import { connectionRecoveryReason } from "./workspace-resume";

/** A question is scoped server state. No default, timeout answer, retry timer or browser storage. */
export function WorkspaceUserQuestion({ conversation, t, disabled, supported, onAnswer, onRepair, onPause }: {
  conversation: WorkspaceQuestionConversation; t: ReturnType<typeof makeT>; disabled: boolean; supported: boolean;
  onAnswer(questionId: string, answer: string): void; onRepair(): void; onPause?(questionId: string): void;
}) {
  const [answer, setAnswer] = useState("");
  const question = conversation.pendingQuestion; if (!question) return null;
  const finishing = ["running", "draining"].includes(conversation.state);
  const connection = connectionRecoveryReason(conversation);
  const blocked = disabled || !supported || finishing || Boolean(connection) || conversation.resumeAdmission?.allowed === false;
  return <section className="wsd-resume wsd-user-question" aria-labelledby={`question-${question.id}`} data-task-state="awaiting_user">
    <strong id={`question-${question.id}`}>{t("ws.question.title")}</strong>
    <p role="status">{t(`ws.question.reason.${question.reason}`)}</p>
    <p className="wsd-user-question-text">{question.question}</p>{question.step ? <p><strong>{t("ws.question.step")}</strong> {question.step}</p> : null}<p>{t("ws.question.saved")}</p>
    {finishing ? <p role="status">{t("ws.resume.finishing")}</p> : null}
    {!supported ? <p role="alert">{t("ws.question.unsupported")}</p> : null}
    {conversation.resumeAdmission?.allowed === false ? <p role="alert">{t("ws.resume.budget")}</p> : null}
    {connection ? <><p role="alert">{t(`ws.resume.${connection}`)}</p><button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button></> : null}
    {question.options.length ? <div role="group" aria-label={t("ws.question.choices")}>{question.options.map((option, index) =>
      <button type="button" className="hs-btn sec" key={`${question.id}:${index}`} disabled={blocked} onClick={() => onAnswer(question.id, option)}>{option}</button>)}</div> : null}
    <form onSubmit={event => { event.preventDefault(); if (!blocked && answer.trim()) onAnswer(question.id, answer); }}>
      <label>{t("ws.question.answer")}<textarea value={answer} maxLength={4000} rows={2} disabled={blocked} onChange={event => setAnswer(event.target.value)} /></label>
      <button type="submit" className="hs-btn pri" disabled={blocked || !answer.trim()}>{t("ws.question.continue")}</button>
    </form>{onPause ? <button type="button" className="hs-btn sec" data-question-action="pause" disabled={disabled || !supported || finishing} onClick={() => onPause(question.id)}>{t("ws.question.pause")}</button> : null}<small>{t("ws.question.noDefault")}</small>
  </section>;
}
