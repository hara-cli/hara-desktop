import type { CreatedSessionInfo, SessionInfo } from "./client";

export type SessionPlace = "chat" | "projects" | "auto";
export type InteractiveSessionPlace = Exclude<SessionPlace, "auto">;

export interface SessionPlaceInput {
  cwd: string;
  source?: string;
}

export const isAssistantWorkspace = (cwd: string): boolean => /[/\\]\.hara[/\\]workspace$/.test(cwd);

/**
 * Decide where a session belongs before it becomes active. External gateway threads are conversations,
 * scheduled runs are automation records, and ordinary filesystem work belongs to My Files.
 */
export function sessionPlace(session: SessionPlaceInput): SessionPlace {
  if (session.source === "gateway") return "chat";
  if (session.source === "cron") return "auto";
  return isAssistantWorkspace(session.cwd) ? "chat" : "projects";
}

/** A late async resume/create result may only become active in the place that owns the session. */
export function sessionBelongsToInteractivePlace(place: string, session: SessionPlaceInput): place is InteractiveSessionPlace {
  return (place === "chat" || place === "projects") && sessionPlace(session) === place;
}

export function sessionActivationAllowed(
  requestId: number,
  currentRequestId: number,
  place: string,
  session: SessionPlaceInput,
): boolean {
  return requestId === currentRequestId && sessionBelongsToInteractivePlace(place, session);
}

/** Materialize a just-created live draft without waiting for it to become durable. Engines before the
 * live-draft list fix omit some route fields, so the caller's request remains a compatibility fallback. */
export function createdSessionListItem(
  created: CreatedSessionInfo,
  hint: SessionPlaceInput & { agentRef?: string },
  fallbackUpdatedAt = new Date().toISOString(),
): SessionInfo {
  return {
    id: created.sessionId,
    title: created.title ?? "",
    cwd: created.cwd || hint.cwd,
    model: created.model,
    ...(created.approval ? { approval: created.approval } : {}),
    ...(created.profileId ? { profileId: created.profileId } : {}),
    ...(created.spaceId ? { spaceId: created.spaceId } : {}),
    updatedAt: created.updatedAt || fallbackUpdatedAt,
    source: created.source ?? "interactive",
    ...(created.agentRef || hint.agentRef ? { agentRef: created.agentRef ?? hint.agentRef } : {}),
  };
}

/** A successful create is authoritative even when a legacy engine's immediate session.list omits the
 * empty draft. Preserve the server's version when it is present and otherwise prepend the fallback. */
export function keepCreatedSessionVisible(
  sessions: readonly SessionInfo[],
  created: SessionInfo,
): SessionInfo[] {
  return sessions.some((session) => session.id === created.id)
    ? [...sessions]
    : [created, ...sessions];
}
