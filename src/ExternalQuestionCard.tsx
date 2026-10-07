import { useEffect, useState, type FormEvent } from "react";
import type { ExternalUserQuestionOutcome, ExternalUserQuestionReply } from "./client";
import { makeT, type Key, type Locale } from "./i18n";
import {
  prepareExternalQuestionAnswers, createExternalQuestionSubmission, externalQuestionPending,
  readableExternalQuestion, type ExternalQuestionDraft, type ExternalQuestionEntry,
} from "./external-question-state";

const OUTCOME_KEYS: Record<ExternalUserQuestionOutcome, Key> = {
  answered: "externalQuestionAnswered", cancelled: "externalQuestionCancelled",
  timed_out: "externalQuestionExpired", interrupted: "externalQuestionInterrupted",
};
const EMPTY_DRAFT: ExternalQuestionDraft = { selected: [], custom: "", useCustom: false };

/** Choices are conversation replies, not permissions. No choice is made on the user's behalf. */
export default function ExternalQuestionCard({ entry, locale, disabled = false, onReply }: {
  entry: ExternalQuestionEntry;
  locale: Locale;
  disabled?: boolean;
  onReply: (reply: ExternalUserQuestionReply) => Promise<void>;
}) {
  const { request } = entry;
  const t = makeT(locale);
  const [drafts, setDrafts] = useState<Record<string, ExternalQuestionDraft>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [submitted, setSubmitted] = useState<ExternalUserQuestionOutcome>();
  const [now, setNow] = useState(Date.now);
  const [submission] = useState(() => createExternalQuestionSubmission(() => crypto.randomUUID()));
  const expiry = Date.parse(request.expiresAt);
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [expiry]);
  const outcome = entry.outcome ?? submitted ?? (expiry <= now ? "timed_out" : undefined);
  const locked = disabled || sending || Boolean(outcome);
  const { answers, error: answerError } = prepareExternalQuestionAnswers(request, drafts);
  const change = (id: string, update: (draft: ExternalQuestionDraft) => ExternalQuestionDraft) => {
    setDrafts((current) => ({ ...current, [id]: update(current[id] ?? EMPTY_DRAFT) }));
    setFailed(false);
  };
  const send = async (cancelled: boolean) => {
    if (locked || submission.isLocked() || !externalQuestionPending(entry) || (!cancelled && !answers)) return;
    setSending(true);
    setFailed(false);
    try {
      const accepted = await submission.submit(request, cancelled ? {} : answers!, cancelled, onReply);
      if (accepted) setSubmitted(cancelled ? "cancelled" : "answered");
    } catch {
      // Keep the user's selections and command identity after an uncertain transport error.
      setFailed(true);
    } finally { setSending(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(false); };
  if (!readableExternalQuestion(request)) return null;
  return (
    <form className={`external-question-card${outcome ? " is-closed" : ""}`} onSubmit={submit} aria-label={t("externalQuestionTitle")}>
      <header>
        <strong>{t("externalQuestionTitle")}</strong>
        <span role="status">{outcome ? t(OUTCOME_KEYS[outcome]) : sending ? t("externalQuestionSending") : t("externalQuestionWaiting")}</span>
      </header>
      {request.questions.map((question) => {
        const draft = drafts[question.id] ?? EMPTY_DRAFT;
        const options = question.options ?? [];
        const type = question.multiSelect ? "checkbox" : "radio";
        return (
          <fieldset key={question.id} disabled={locked}>
            <legend>{question.header ? <small>{question.header}</small> : null}{question.question}</legend>
            {options.length > 0 ? <p className="external-question-hint">{t(question.multiSelect ? "externalQuestionMultiple" : "externalQuestionSingle")}</p> : null}
            {options.map((option, index) => (
              <label className="external-question-option" key={`${index}:${option.label}`}>
                <input type={type} name={`${request.questionId}:${question.id}`} checked={draft.selected.includes(option.label)}
                  onChange={() => change(question.id, (current) => ({ ...current,
                    selected: question.multiSelect
                      ? current.selected.includes(option.label) ? current.selected.filter((label) => label !== option.label) : [...current.selected, option.label]
                      : [option.label],
                    useCustom: question.multiSelect ? current.useCustom : false,
                  }))} />
                <span><b>{option.label}</b>{option.description ? <small>{option.description}</small> : null}</span>
              </label>
            ))}
            {options.length > 0 && question.isOther ? (
              <label className="external-question-option">
                <input type={type} name={`${request.questionId}:${question.id}`} checked={draft.useCustom}
                  onChange={() => change(question.id, (current) => ({ ...current,
                    selected: question.multiSelect ? current.selected : [], useCustom: !current.useCustom,
                  }))} />
                <span><b>{t("externalQuestionOther")}</b></span>
              </label>
            ) : null}
            {options.length === 0 || (question.isOther && draft.useCustom) ? (
              <textarea aria-label={question.question} placeholder={t("externalQuestionPlaceholder")} maxLength={4000} rows={2}
                value={draft.custom} onChange={(event) => {
                  const value = event.currentTarget.value;
                  change(question.id, (current) => ({ ...current, custom: value }));
                }} />
            ) : null}
          </fieldset>
        );
      })}
      {failed && !outcome ? <p className="external-question-error" role="alert">{t("externalQuestionFailed")}</p> : null}
      {answerError && !outcome ? <p className="external-question-error" role="alert">{t("externalQuestionLimit")}</p> : null}
      {!outcome ? (
        <><p className="external-question-hint external-question-privacy">{t("externalQuestionPrivacy")}</p><footer>
          <button type="button" disabled={locked} onClick={() => void send(true)}>{t("externalQuestionCancel")}</button>
          <button type="submit" className="is-primary" disabled={locked || !answers}>{sending ? t("externalQuestionSending") : t("externalQuestionSubmit")}</button>
        </footer></>
      ) : null}
    </form>
  );
}
