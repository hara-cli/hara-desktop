import { useRef, useState } from "react";
import type { ExternalDelegatedApprovalReply, ExternalUserQuestionReply } from "./client";
import { ApprovalCard } from "./ConversationTimeline";
import ExternalQuestionCard from "./ExternalQuestionCard";
import { externalInteractionInConversation, readableDelegatedApproval, type DelegatedApprovalEntry } from "./external-interaction-state";
import { readableExternalQuestion, type ExternalQuestionEntry } from "./external-question-state";
import { makeT, type Locale } from "./i18n";

function DelegatedApprovalCard({ entry, locale, disabled, onReply }: {
  entry: DelegatedApprovalEntry; locale: Locale; disabled: boolean;
  onReply: (reply: ExternalDelegatedApprovalReply) => Promise<void>;
}) {
  const intent = useRef<boolean | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  const t = makeT(locale);
  if (!readableDelegatedApproval(entry.request)) return null;
  if (entry.outcome || settled) return <p role="status">{t("externalDelegatedApprovalClosed")}</p>;
  return <ApprovalCard approvalId={entry.request.approvalId} question={entry.request.question} allowAlways={false}
    expiresAt={entry.request.expiresAt} disabled={disabled} taskApprovalSupported={false} t={t}
    onApproval={async (_, verdict) => {
      if (verdict !== "allow" && verdict !== "deny") throw new Error("Only a one-action decision is available.");
      const allow = verdict === "allow";
      if (intent.current !== undefined && intent.current !== allow) throw new Error("Retry the original decision.");
      intent.current = allow;
      await onReply({ approvalId: entry.request.approvalId, sessionId: entry.request.sessionId, turnId: entry.request.turnId, allow });
      setSettled(true);
    }} />;
}

/** Foreground-only projection. No external output or private history is merged into the parent. */
export default function DelegatedInteractionCards({ activeSessionId, personal, disabled, questions, approvals, locale, onQuestionReply, onApprovalReply }: {
  activeSessionId: string | null; personal: boolean; disabled: boolean; locale: Locale;
  questions: ExternalQuestionEntry[]; approvals: DelegatedApprovalEntry[];
  onQuestionReply: (reply: ExternalUserQuestionReply) => Promise<void>;
  onApprovalReply: (reply: ExternalDelegatedApprovalReply) => Promise<void>;
}) {
  const questionCards = questions.filter((entry) => readableExternalQuestion(entry.request)
    && externalInteractionInConversation(entry.request, activeSessionId, personal));
  const approvalCards = approvals.filter((entry) => readableDelegatedApproval(entry.request)
    && externalInteractionInConversation(entry.request, activeSessionId, personal));
  if (!questionCards.length && !approvalCards.length) return null;
  const t = makeT(locale);
  return <section className="delegated-interaction-cards" aria-label={t("externalDelegatedInteractionTitle")}>
    {questionCards.map((entry) => <div key={`question:${entry.request.questionId}`}>
      <p className="dim">{t("externalDelegatedInteractionTitle")}{entry.request.agentPath ? ` · ${entry.request.agentPath}` : ""}</p>
      <ExternalQuestionCard entry={entry} locale={locale} disabled={disabled} onReply={onQuestionReply} />
    </div>)}
    {approvalCards.map((entry) => <div key={`approval:${entry.request.approvalId}`}>
      <p className="dim">{t("externalDelegatedInteractionTitle")}{entry.request.agentPath ? ` · ${entry.request.agentPath}` : ""}</p>
      <DelegatedApprovalCard entry={entry} locale={locale} disabled={disabled} onReply={onApprovalReply} />
    </div>)}
  </section>;
}
