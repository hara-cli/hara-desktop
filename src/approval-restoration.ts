import type { ConversationItem } from "./ConversationTimeline";
import type { PendingSessionApproval, TaskLifecycleEvent } from "./client";

/** Only the foreground session response may restore private proposal presentation. */
export function restoreSessionApprovals(
  items: ConversationItem[],
  sessionId: string,
  task: TaskLifecycleEvent | undefined,
  pending: PendingSessionApproval[] | undefined,
  previous?: { sessionId: string; items: ConversationItem[] },
): ConversationItem[] {
  const cards = (previous?.sessionId === sessionId ? previous.items : []).filter((item) => item.kind === "approval");
  const authoritativeIds = pending ? new Set(pending.map((request) => request.approvalId)) : undefined;
  const result = items.filter((item) => item.kind !== "approval" || item.answered
    || !authoritativeIds || authoritativeIds.has(item.approvalId));
  // Keep resolved cards as history, never as a new pending request.
  for (const card of cards) {
    if (card.answered) {
      const index = result.findIndex((item) => item.kind === "approval" && item.approvalId === card.approvalId);
      const existing = index >= 0 ? result[index] : undefined;
      if (existing?.kind === "approval" && !existing.answered) result[index] = card;
      else if (index < 0) result.push(card);
    }
  }
  const legacy = task?.sessionId === sessionId && (task.state === "running" || task.state === "waiting")
    ? task.approval : undefined;
  const requests: PendingSessionApproval[] = pending ?? (legacy ? [{
    approvalId: legacy.id, question: legacy.question, allowAlways: legacy.allowAlways === true,
  }] : []);
  for (const request of requests) {
    const existingIndex = result.findIndex((item) => item.kind === "approval" && item.approvalId === request.approvalId);
    const existing = existingIndex >= 0 ? result[existingIndex] : undefined;
    if (existing?.kind === "approval" && existing.answered) continue;
    const previousCard = cards.find((item) => item.approvalId === request.approvalId);
    if (previousCard?.answered) continue;
    const presentation = request.presentation ?? (existing?.kind === "approval" ? existing.presentation : undefined) ?? previousCard?.presentation;
    const taskApprovalCommandId = (existing?.kind === "approval" ? existing.taskApprovalCommandId : undefined) ?? previousCard?.taskApprovalCommandId;
    const restored: ConversationItem = {
      kind: "approval", ...request,
      ...(presentation ? { presentation } : {}),
      ...(taskApprovalCommandId ? { taskApprovalCommandId } : {}),
    };
    if (existingIndex >= 0) result[existingIndex] = restored;
    else result.push(restored);
  }
  return result;
}
