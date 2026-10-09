import type { ExternalDelegatedApprovalReply, ExternalDelegatedApprovalRequest, ExternalUserQuestionOutcome } from "./client";

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
export function validExternalInteractionPresentation(value: { parentSessionId?: unknown; agentPath?: unknown }): boolean {
  return (value.parentSessionId === undefined || id(value.parentSessionId))
    && (value.agentPath === undefined || id(value.agentPath));
}
/** Display scope only; RPC authority remains the original external identity. */
export function externalInteractionInConversation(
  request: { parentSessionId?: string }, activeSessionId: string | null, personal: boolean,
): boolean {
  return personal && id(request.parentSessionId) && request.parentSessionId === activeSessionId;
}
export function externalInteractionReplyAllowed(
  request: { sessionId: string; parentSessionId?: string },
  context: { activeSessionId: string | null; selectedExternalSessionId?: string; personal: boolean; readOnly: boolean },
): boolean {
  return request.parentSessionId !== undefined
    ? externalInteractionInConversation(request, context.activeSessionId, context.personal) && !context.readOnly
    : context.personal && request.sessionId === context.selectedExternalSessionId;
}
export interface DelegatedApprovalEntry { request: ExternalDelegatedApprovalRequest; outcome?: ExternalUserQuestionOutcome }
export type DelegatedApprovalState = Record<string, DelegatedApprovalEntry>;
export function readableDelegatedApproval(value: Partial<ExternalDelegatedApprovalRequest>): value is ExternalDelegatedApprovalRequest {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && id(value.approvalId) && id(value.sessionId) && id(value.turnId) && id(value.parentSessionId)
    && validExternalInteractionPresentation(value) && typeof value.question === "string" && value.question.length > 0
    && value.question.length <= 16000 && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt));
}
function append(state: DelegatedApprovalState, key: string, entry: DelegatedApprovalEntry): DelegatedApprovalState {
  const next = { ...state };
  const entries = Object.entries(next);
  const closed = entries.filter(([, entry]) => entry.outcome || Date.parse(entry.request.expiresAt) <= Date.now());
  for (const [key] of closed.slice(0, Math.max(0, entries.length - 127))) delete next[key];
  return Object.keys(next).length >= 128 ? state : { ...next, [key]: entry };
}
export function receiveDelegatedApproval(state: DelegatedApprovalState, request: Partial<ExternalDelegatedApprovalRequest>): DelegatedApprovalState {
  return !readableDelegatedApproval(request) || own(state, request.approvalId) ? state : append(state, request.approvalId, { request });
}
export function resolveDelegatedApproval(
  state: DelegatedApprovalState,
  value: { approvalId: string; sessionId: string; turnId: string; outcome: ExternalUserQuestionOutcome },
): DelegatedApprovalState {
  if (![value.approvalId, value.sessionId, value.turnId].every(id)
    || !["answered", "cancelled", "timed_out", "interrupted"].includes(value.outcome)) return state;
  const entry = own(state, value.approvalId) ? state[value.approvalId] : undefined;
  if (!entry) return append(state, value.approvalId, { request: {
    approvalId: value.approvalId, sessionId: value.sessionId, turnId: value.turnId, parentSessionId: "", question: "", expiresAt: "",
  }, outcome: value.outcome });
  return entry.outcome || entry.request.sessionId !== value.sessionId || entry.request.turnId !== value.turnId
    ? state : { ...state, [value.approvalId]: { ...entry, outcome: value.outcome } };
}
export function restoreDelegatedApprovals(state: DelegatedApprovalState, requests: Partial<ExternalDelegatedApprovalRequest>[]): DelegatedApprovalState {
  const pending = requests.filter(readableDelegatedApproval);
  const ids = new Set(pending.map((request) => request.approvalId));
  let next = state;
  for (const entry of Object.values(state)) {
    if (!entry.outcome && !ids.has(entry.request.approvalId)) next = resolveDelegatedApproval(next, { ...entry.request, outcome: "interrupted" });
  }
  for (const request of pending) next = receiveDelegatedApproval(next, request);
  return next;
}
export function interruptDelegatedApprovals(state: DelegatedApprovalState, sessionIds: string[], turnId: string): DelegatedApprovalState {
  let next = state;
  for (const entry of Object.values(state)) {
    if (sessionIds.includes(entry.request.sessionId) && entry.request.turnId === turnId) next = resolveDelegatedApproval(next, { ...entry.request, outcome: "interrupted" });
  }
  return next;
}

/** Host UI memory, not permissions: retain an uncertain decision across foreground card remounts. */
export function createDelegatedApprovalSubmission(newId: () => string) {
  const attempts = new Map<string, { reply: ExternalDelegatedApprovalReply; parentSessionId: string; inFlight: boolean; settled: boolean }>();
  return {
    async submit(request: ExternalDelegatedApprovalRequest, allow: boolean, send: (reply: ExternalDelegatedApprovalReply) => Promise<void>): Promise<void> {
      if (!readableDelegatedApproval(request) || Date.parse(request.expiresAt) <= Date.now() || typeof allow !== "boolean") throw new Error("The execution approval is unavailable.");
      let attempt = attempts.get(request.approvalId);
      if (attempt && (attempt.reply.sessionId !== request.sessionId || attempt.reply.turnId !== request.turnId
        || attempt.parentSessionId !== request.parentSessionId || attempt.reply.allow !== allow)) throw new Error("Retry the original decision.");
      if (!attempt) {
        // Closed decisions may be forgotten only when admitting a new ID; uncertain attempts stay.
        for (const [key, previous] of attempts) {
          if (attempts.size < 128) break;
          if (previous.settled) attempts.delete(key);
        }
        if (attempts.size >= 128) throw new Error("The execution approval limit was reached.");
        const commandId = newId();
        if (!id(commandId)) throw new Error("The execution approval is unavailable.");
        attempt = { reply: { approvalId: request.approvalId, sessionId: request.sessionId, turnId: request.turnId, allow, commandId },
          parentSessionId: request.parentSessionId, inFlight: false, settled: false };
        attempts.set(request.approvalId, attempt);
      }
      if (attempt.inFlight || attempt.settled) throw new Error("The execution approval was already submitted.");
      attempt.inFlight = true;
      try { await send(attempt.reply); attempt.settled = true; }
      finally { attempt.inFlight = false; }
    },
  };
}
