import type { Key, makeT } from "./i18n";
import type { WorkspaceDevAsyncAsk, WorkspaceDevQuestion, WorkspaceQuestionConversation } from "./workspace-dev-state";
import { connectionRecoveryReason } from "./workspace-resume";

type Translate = ReturnType<typeof makeT>;
// Core's built-in question copy is fixed when the question is created, in the session's language. Show the
// viewer's language for those exact templates; any other model-written question stays verbatim.
const CORE_QUESTION_TEMPLATES: Record<WorkspaceDevQuestion["reason"], string[]> = {
  lookup_missing: ["Two lookups did not identify the target. Which colleague or item do you mean? Please provide its name, former name or location.", "两次查找仍未确认目标。你指的是哪位同事或哪项内容？请补充名字、原名或位置。"],
  lookup_ambiguous: ["Several evidenced matches remain. Which one do you mean?", "找到了多个可能的对象。你指的是哪一个？"],
  tool_problem: ["This step failed twice. Progress is saved. What should be corrected or clarified before continuing?", "当前步骤连续遇到问题，进度已保留。你希望先处理哪个卡点，或补充什么信息？"],
  budget_warning: ["This task is near its budget limit. Continue from the saved point within the original remaining allowance? Your answer will not reset the budget.", "本次任务快到预算上限，已保留当前位置。是否在原剩余额度内继续？回答不会重置预算。"],
  explicit: ["Please provide the information needed to continue this step.", "请补充继续当前步骤所需的信息。"],
};
export function workspaceQuestionText(t: Translate, question: Pick<WorkspaceDevQuestion, "reason" | "question">): string {
  return CORE_QUESTION_TEMPLATES[question.reason]?.includes(question.question.trim()) ? t(`ws.question.template.${question.reason}`) : question.question;
}

const CORE_STEP_KEYS: Readonly<Record<string, Key>> = {
  "apply the retained user decision": "ws.question.step.applyDecision",
  "continue the original task with the retained answer": "ws.question.step.continueWithAnswer",
  "review the stalled strategy": "ws.question.step.reviewStrategy",
  "complete the accepted task": "ws.question.step.completeTask",
  "verify the accepted completion checks": "ws.question.step.verifyCompletion",
  "complete the current task step": "ws.question.step.completeStep",
};

/** Core checkpoint steps are internal text. Only exact built-in phrases are safe to show in a viewer locale. */
export function workspaceQuestionStep(t: Translate, step: string | undefined): string | null {
  const key = step && CORE_STEP_KEYS[step.trim()];
  return key ? t(key) : null;
}

/** A question is scoped server state. No default, timeout answer, retry timer or browser storage.
 * The card sits in the message stream and offers only choices; free text goes through the one chat
 * composer below, which answers this question while it is pending. */
export function WorkspaceUserQuestion({ conversation, t, disabled, supported, onAnswer, onRepair, onPause }: {
  conversation: WorkspaceQuestionConversation; t: Translate; disabled: boolean; supported: boolean;
  onAnswer(questionId: string, answer: string): void; onRepair(): void; onPause?(questionId: string): void;
}) {
  const question = conversation.pendingQuestion; if (!question) return null;
  const finishing = ["running", "draining"].includes(conversation.state);
  const connection = connectionRecoveryReason(conversation);
  const blocked = disabled || !supported || finishing || Boolean(connection) || conversation.resumeAdmission?.allowed === false;
  const titleId = `question-${question.id}`;
  const step = workspaceQuestionStep(t, question.step);
  return <section className="wsd-ask wsd-user-question is-thread" aria-labelledby={titleId} data-task-state="awaiting_user">
    <header className="wsd-ask-head"><span className="wsd-ask-title">{question.header ?? t("ws.question.title")}</span><span className="wsd-ask-reason" role="status">{t(question.intent ? `ws.question.intent.${question.intent}` : `ws.question.reason.${question.reason}`)}</span></header>
    <p id={titleId} className="wsd-user-question-text">{workspaceQuestionText(t, question)}</p>
    {step ? <p className="wsd-ask-step"><strong>{t("ws.question.step")}</strong> {step}</p> : null}
    {finishing ? <p role="status">{t("ws.resume.finishing")}</p> : null}
    {!supported ? <p role="alert">{t("ws.question.unsupported")}</p> : null}
    {conversation.resumeAdmission?.allowed === false ? <p role="alert">{t("ws.resume.budget")}</p> : null}
    {connection ? <><p role="alert">{t(`ws.resume.${connection}`)}</p><button type="button" className="hs-btn sec" onClick={onRepair} disabled={disabled}>{t("ws.resume.repairAction")}</button></> : null}
    {question.options.length ? <div className="wsd-ask-options" role="group" aria-label={t("ws.question.choices")}>{question.options.map((option, index) =>
      <button type="button" className="hs-btn sec" key={`${question.id}:${index}`} disabled={blocked} onClick={() => onAnswer(question.id, option)}>{option}</button>)}</div> : null}
    <footer className="wsd-ask-foot"><small>{t("ws.question.composerHint")} {t("ws.question.saved")} {t("ws.question.noDefault")}</small>{onPause ? <button type="button" className="hs-btn sec" data-question-action="pause" disabled={disabled || !supported || finishing} onClick={() => onPause(question.id)}>{t("ws.question.pause")}</button> : null}</footer>
  </section>;
}

/** Non-blocking (async) asks posted while the task keeps working. They sit above the normal composer
 * and never replace or lock it; cards offer only choices. With exactly one open ask the composer
 * answers it, so free text never needs a second input. No default answer; an unanswered card closes
 * when the run ends. */
export function WorkspaceAsyncQuestions({ asks, t, disabled, onAnswer }: {
  asks: WorkspaceDevAsyncAsk[]; t: Translate; disabled: boolean; onAnswer(questionId: string, answer: string): void;
}) {
  if (!asks.length) return null;
  return <div className="wsd-ask-async-list" data-composer="async-questions">{asks.map(ask => <WorkspaceAsyncQuestion key={ask.requestId} ask={ask} t={t} disabled={disabled} onAnswer={onAnswer} viaComposer={asks.length === 1} />)}</div>;
}
function WorkspaceAsyncQuestion({ ask, t, disabled, onAnswer, viaComposer }: { ask: WorkspaceDevAsyncAsk; t: Translate; disabled: boolean; onAnswer(questionId: string, answer: string): void; viaComposer: boolean }) {
  const item = ask.questions[0]; if (!item) return null;
  const titleId = `async-question-${ask.requestId}`;
  return <section className="wsd-ask is-async" aria-labelledby={titleId} data-delivery="async">
    <header className="wsd-ask-head"><span className="wsd-ask-title">{item.header ?? t("ws.question.async.title")}</span></header>
    <p id={titleId} className="wsd-user-question-text">{item.question}</p>
    {item.options.length ? <div className="wsd-ask-options" role="group" aria-label={t("ws.question.choices")}>{item.options.map((option, index) =>
      <button type="button" className="hs-btn sec" key={`${ask.requestId}:${index}`} disabled={disabled} onClick={() => onAnswer(ask.requestId, option)}>{option}</button>)}</div> : null}
    <footer className="wsd-ask-foot"><small>{viaComposer ? `${t("ws.question.async.composerHint")} ` : ""}{t("ws.question.async.note")}</small></footer>
  </section>;
}
