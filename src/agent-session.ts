import type { AgentInfo, SessionInfo } from "./client";

export const mainAgentRef = (agentRef?: string): string => agentRef || "main";

export const isRootAgent = (agent: Pick<AgentInfo, "ref" | "systemRole">): boolean => (
  agent.ref === "main" || agent.systemRole === "root_orchestrator"
);

/** Keep exactly one permanent root coordinator even while a legacy Engine omits it from agents.list.
 * Catalog data wins over the renderer fallback; ordinary Agents retain their server order. */
export function canonicalAgentRoster(
  agents: readonly AgentInfo[],
  fallbackMainAgent: AgentInfo,
): AgentInfo[] {
  const byRef = new Map<string, AgentInfo>([[fallbackMainAgent.ref, fallbackMainAgent]]);
  for (const agent of agents) byRef.set(agent.ref, agent);
  return [...byRef.values()].sort((left, right) => (
    Number(isRootAgent(right)) - Number(isRootAgent(left))
  ));
}

/** The permanent root coordinator is part of Hara itself, not an employee hired from the market. */
export const hiredAgentCount = (agents: readonly AgentInfo[]): number => (
  agents.reduce((count, agent) => count + (isRootAgent(agent) ? 0 : 1), 0)
);

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
