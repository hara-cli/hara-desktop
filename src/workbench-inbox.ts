import type { AgentInfo, SessionInfo } from "./client.ts";
import { mainAgentRef } from "./agent-office.ts";
import { isJunkProjectDirectory } from "./project-list.ts";

export type WorkbenchInboxMode = "agents" | "projects";

export type WorkbenchInboxTarget =
  | { kind: "agent"; id: string }
  | { kind: "project"; id: string };

export interface AgentInboxEntry {
  agent: AgentInfo;
  sessions: SessionInfo[];
  latest?: SessionInfo;
}

const searchableSessionText = (session: SessionInfo): string => [
  session.title,
  session.model,
  session.cwd,
  session.sourceName,
].filter(Boolean).join(" ").toLowerCase();

export const isWorkbenchConversation = (session: SessionInfo): boolean => (
  session.source !== "cron"
  && !session.archived
  && !isJunkProjectDirectory(session.cwd)
);

export const inboxSessionsForAgent = (
  sessions: readonly SessionInfo[],
  agentRef: string,
): SessionInfo[] => sessions
  .filter((session) => (
    isWorkbenchConversation(session)
    && mainAgentRef(session.agentRef) === agentRef
  ));

export const filterInboxSessions = (
  sessions: readonly SessionInfo[],
  query: string,
): SessionInfo[] => {
  const needle = query.trim().toLowerCase();
  return sessions.filter((session) => !needle || searchableSessionText(session).includes(needle));
};

export const sortInboxSessions = (
  sessions: readonly SessionInfo[],
  pinnedIds: readonly string[] = [],
): SessionInfo[] => {
  const pinned = new Set(pinnedIds);
  return [...sessions].sort((left, right) => (
    Number(pinned.has(right.id)) - Number(pinned.has(left.id))
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id)
  ));
};

/**
 * Project and Agent are browse facets over the same durable sessions. The Agent inbox deliberately
 * keeps every catalog member visible, even before the first conversation, while active members sort
 * like a message app by the timestamp of their latest real conversation.
 */
export function agentInboxEntries(
  agents: readonly AgentInfo[],
  sessions: readonly SessionInfo[],
  query = "",
): AgentInboxEntry[] {
  const needle = query.trim().toLowerCase();
  return agents
    .map((agent): AgentInboxEntry => {
      const owned = sortInboxSessions(inboxSessionsForAgent(sessions, agent.ref));
      return { agent, sessions: owned, ...(owned[0] ? { latest: owned[0] } : {}) };
    })
    .filter(({ agent, sessions: owned }) => !needle || [
      agent.name,
      agent.ref,
      agent.description,
      agent.project,
      agent.identity?.displayName,
      agent.identity?.title,
      agent.identity?.bio,
      ...(agent.identity?.traits ?? []),
      ...owned.map(searchableSessionText),
    ].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((left, right) => (
      (right.latest?.updatedAt ?? "").localeCompare(left.latest?.updatedAt ?? "")
      || Number(right.agent.ref === "main") - Number(left.agent.ref === "main")
      || left.agent.name.localeCompare(right.agent.name)
    ));
}
