import type {
  ExternalUserQuestionAnswers, ExternalUserQuestionOutcome, ExternalUserQuestionReply,
  ExternalUserQuestionRequest,
} from "./client";
import { validExternalInteractionPresentation } from "./external-interaction-state.ts";

export interface ExternalQuestionEntry {
  request: ExternalUserQuestionRequest;
  outcome?: ExternalUserQuestionOutcome;
}
export type ExternalQuestionState = Record<string, ExternalQuestionEntry>;
const QUESTION_LIMIT = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const opaqueId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 512;
const validBinding = (binding: Pick<ExternalUserQuestionRequest, "questionId" | "sessionId" | "turnId">) =>
  typeof binding.questionId === "string" && UUID.test(binding.questionId) && opaqueId(binding.sessionId) && opaqueId(binding.turnId);
const ownEntry = (state: ExternalQuestionState, id: string) => Object.prototype.hasOwnProperty.call(state, id) ? state[id] : undefined;

function appendEntry(state: ExternalQuestionState, id: string, entry: ExternalQuestionEntry): ExternalQuestionState {
  const next = { ...state };
  const entries = Object.entries(next);
  const closed = entries.filter(([, previous]) => !externalQuestionPending(previous));
  for (const [closedId] of closed.slice(0, Math.max(0, entries.length - QUESTION_LIMIT + 1))) delete next[closedId];
  if (Object.keys(next).length >= QUESTION_LIMIT) return state;
  next[id] = entry;
  return next;
}

export function readableExternalQuestion(request: ExternalUserQuestionRequest): boolean {
  return validBinding(request)
    && validExternalInteractionPresentation(request)
    && typeof request.expiresAt === "string" && Number.isFinite(Date.parse(request.expiresAt))
    && Array.isArray(request.questions) && request.questions.length > 0 && request.questions.length <= 16
    && request.questions.every((question) => question && typeof question === "object" && typeof question.id === "string" && question.id.length > 0 && question.id.length <= 160
      && !["__proto__", "constructor", "prototype"].includes(question.id)
      && typeof question.question === "string" && question.question.length > 0 && question.question.length <= 8000 && question.isSecret !== true
      && (question.header === undefined || (typeof question.header === "string" && question.header.length <= 160))
      && (question.multiSelect === undefined || typeof question.multiSelect === "boolean")
      && (question.isOther === undefined || typeof question.isOther === "boolean")
      && (question.isSecret === undefined || typeof question.isSecret === "boolean")
      && (question.options == null || (Array.isArray(question.options) && question.options.length <= 32 && question.options.every((option) =>
        option && typeof option.label === "string" && option.label.length > 0 && option.label.length <= 160
        && (option.description === undefined || (typeof option.description === "string" && option.description.length <= 2000)))
        && new Set(question.options.map((option) => option.label)).size === question.options.length)))
    && new Set(request.questions.map((question) => question.id)).size === request.questions.length
    && encoder.encode(JSON.stringify({ questions: request.questions })).byteLength <= 64 * 1024;
}

export function externalQuestionPending(entry: ExternalQuestionEntry, now = Date.now()): boolean {
  return !entry.outcome && readableExternalQuestion(entry.request) && Date.parse(entry.request.expiresAt) > now;
}

/** Temporary presentation only: never changes the saved terminal width preference. */
export function externalQuestionDockMode(
  preferred: "docked" | "maximized", entries: ExternalQuestionEntry[], sessionId: string, now = Date.now(),
): "docked" | "maximized" {
  return entries.some((entry) => entry.request.sessionId === sessionId && externalQuestionPending(entry, now)) ? "docked" : preferred;
}

export function receiveExternalQuestion(state: ExternalQuestionState, request: ExternalUserQuestionRequest): ExternalQuestionState {
  if (!readableExternalQuestion(request) || ownEntry(state, request.questionId)) return state;
  // Bounded renderer memory; only already-closed cards are evicted.
  return appendEntry(state, request.questionId, { request });
}

export function resolveExternalQuestion(
  state: ExternalQuestionState,
  resolution: Pick<ExternalUserQuestionRequest, "questionId" | "sessionId" | "turnId"> & { outcome: ExternalUserQuestionOutcome },
): ExternalQuestionState {
  if (!validBinding(resolution) || !["answered", "cancelled", "timed_out", "interrupted"].includes(resolution.outcome)) return state;
  const entry = ownEntry(state, resolution.questionId);
  if (!entry) return appendEntry(state, resolution.questionId, {
    request: { questionId: resolution.questionId, sessionId: resolution.sessionId, turnId: resolution.turnId, expiresAt: "", questions: [] },
    outcome: resolution.outcome,
  });
  if (entry.outcome || entry.request.sessionId !== resolution.sessionId || entry.request.turnId !== resolution.turnId) return state;
  return { ...state, [resolution.questionId]: { ...entry, outcome: resolution.outcome } };
}

export function restoreExternalQuestions(state: ExternalQuestionState, pending: ExternalUserQuestionRequest[]): ExternalQuestionState {
  const authoritative = pending.filter(readableExternalQuestion);
  const ids = new Set(authoritative.map((request) => request.questionId));
  let next = state;
  for (const entry of Object.values(state)) {
    if (!entry.outcome && !ids.has(entry.request.questionId)) {
      next = resolveExternalQuestion(next, { ...entry.request, outcome: "interrupted" });
    }
  }
  for (const request of authoritative) next = receiveExternalQuestion(next, request);
  return next;
}

export function interruptExternalQuestions(state: ExternalQuestionState, sessionIds: string[], turnId: string): ExternalQuestionState {
  let next = state;
  for (const entry of Object.values(state)) {
    if (sessionIds.includes(entry.request.sessionId) && entry.request.turnId === turnId) {
      next = resolveExternalQuestion(next, { ...entry.request, outcome: "interrupted" });
    }
  }
  return next;
}

export interface ExternalQuestionDraft { selected: string[]; custom: string; useCustom: boolean }

export function prepareExternalQuestionAnswers(
  request: ExternalUserQuestionRequest,
  drafts: Record<string, ExternalQuestionDraft>,
): { answers: ExternalUserQuestionAnswers | null; error?: "limit" } {
  if (!readableExternalQuestion(request)) return { answers: null };
  const answers: ExternalUserQuestionAnswers = {};
  for (const question of request.questions) {
    const draft = drafts[question.id];
    const labels = question.options?.map((option) => option.label) ?? [];
    if (draft?.selected.some((label) => !labels.includes(label))) return { answers: null };
    const values = [...(draft?.selected ?? [])];
    if (draft?.useCustom || labels.length === 0) {
      if (labels.length > 0 && !question.isOther) return { answers: null };
      const custom = draft?.custom.trim();
      if (!custom) return { answers: null };
      values.push(custom);
    }
    if (values.length > 32 || values.some((value) => value.length > 4000)) return { answers: null, error: "limit" };
    if (values.length === 0 || (!question.multiSelect && values.length !== 1)) return { answers: null };
    answers[question.id] = { answers: [...new Set(values)] };
  }
  return encoder.encode(JSON.stringify(answers)).byteLength <= 32 * 1024
    ? { answers } : { answers: null, error: "limit" };
}

export function buildExternalQuestionAnswers(request: ExternalUserQuestionRequest, drafts: Record<string, ExternalQuestionDraft>): ExternalUserQuestionAnswers | null {
  return prepareExternalQuestionAnswers(request, drafts).answers;
}

/** Keep uncertain retries idempotent; lock before awaiting to defeat rapid double clicks. */
export function createExternalQuestionSubmission(newId: () => string) {
  let inFlight = false;
  let previousIntent = "";
  let commandId = "";
  let settled = false;
  return {
    isLocked: () => inFlight || settled,
    async submit(
      request: ExternalUserQuestionRequest, answers: ExternalUserQuestionAnswers, cancelled: boolean,
      send: (reply: ExternalUserQuestionReply) => Promise<void>,
    ): Promise<boolean> {
      if (inFlight || settled) return false;
      const intent = JSON.stringify([request.questionId, request.sessionId, request.turnId, cancelled, answers]);
      if (intent !== previousIntent) { previousIntent = intent; commandId = newId(); }
      inFlight = true;
      try {
        await send({ questionId: request.questionId, sessionId: request.sessionId, turnId: request.turnId,
          answers, ...(cancelled ? { cancelled: true } : {}), commandId });
        settled = true;
        return true;
      } finally { inFlight = false; }
    },
  };
}
