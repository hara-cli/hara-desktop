import type { AgentInfo, ExternalSessionInfo, SessionInfo } from "./client.ts";
import { mainAgentRef } from "./agent-session.ts";
import { isJunkProjectDirectory } from "./project-list.ts";
import { userVisibleText } from "./user-visible-text.ts";
import { splitAssistantTechnicalReceipt } from "./execution-presentation.ts";
import type { ConversationItem } from "./ConversationTimeline.tsx";

/** A bounded projection of a transcript already loaded for this exact session. Never scan every
 * history, treat a task title as a message, or expose hidden tool/routing text in the contact list. */
export function inboxMessagePreview(items: readonly ConversationItem[] | undefined): string {
  if (!items) return "";
  for (let index = items.length - 1; index >= Math.max(0, items.length - 80); index -= 1) {
    const item = items[index];
    if (!item || (item.kind !== "text" && item.kind !== "user")) continue;
    if (item.kind === "user" && item.pendingId) continue;
    // Remove a complete internal envelope before truncating: cutting off a long reminder's closing
    // tag first would turn model-only context into an apparently readable contact preview.
    const visible = userVisibleText(item.text).slice(0, 4096);
    const text = (item.kind === "text" ? splitAssistantTechnicalReceipt(visible).visibleText : visible)
      .slice(0, 2048)
      .replace(/```[\s\S]*?(?:```|$)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, " ")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ").trim();
    if (text) return Array.from(text).slice(0, 96).join("");
  }
  return "";
}

export type WorkbenchInboxMode = "agents" | "projects" | "external" | "deliverables";

export type WorkbenchInboxTarget =
  | { kind: "agent"; id: string }
  | { kind: "project"; id: string }
  | { kind: "external"; id: string };

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

export const visibleExternalSessions = (
  sessions: readonly ExternalSessionInfo[],
  query = "",
): ExternalSessionInfo[] => {
  const needle = query.trim().toLowerCase();
  return [...sessions]
    .filter((session) => !needle || [
      session.title,
      session.workspaceName,
      session.sourceId,
      session.origin,
      session.state,
    ].filter(Boolean).join(" ").toLowerCase().includes(needle))
    .sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt)
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
