import type { SessionInfo } from "./client";

export const mainAgentRef = (agentRef?: string): string => agentRef || "main";

/** Return the newest interactive conversation owned by one Agent in one workspace. */
export function latestAgentSession(
  sessions: SessionInfo[],
  cwd: string,
  agentRef: string,
): SessionInfo | undefined {
  const persistedRef = agentRef === "main" ? undefined : agentRef;
  return sessions
    .filter((session) => (
      session.source !== "gateway"
      && session.source !== "cron"
      && session.cwd === cwd
      && session.agentRef === persistedRef
      && !session.archived
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
