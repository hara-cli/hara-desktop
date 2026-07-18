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
