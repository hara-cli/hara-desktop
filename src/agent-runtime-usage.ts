import type { AgentInfo, AgentRuntimeId } from "./client";

export type UsageAvailability = "available" | "exhausted" | "unknown";
export type UsageScope = "hara-pi" | "external-runtime" | "legacy-hara";

export interface RuntimeAccountLink {
  spaceId: string;
  agentRef: string;
  runtimeId: AgentRuntimeId;
  connectionId: string;
}

export interface RuntimeUsageWindow {
  runtimeId: AgentRuntimeId;
  connectionId: string;
  scope: UsageScope;
  authority: string;
  availability: UsageAvailability;
  fetchedAt: string;
  validUntil: string;
  resetAt?: string;
}

/** Renderer read model only; no quota writes, dispatch approval or fallback decision. */
export function readColleagueUsage(
  colleague: AgentInfo,
  account: RuntimeAccountLink | undefined,
  windows: readonly RuntimeUsageWindow[],
  nowMs = Date.now(),
) {
  const runtime = colleague.runtime;
  const runtimeId = runtime?.runtimeId ?? "hara";
  const scope: UsageScope = runtimeId === "pi" ? "hara-pi"
    : runtimeId === "hara" ? "legacy-hara" : "external-runtime";
  const connectionId = runtime && colleague.spaceId === runtime.spaceId && colleague.ref === runtime.agentRef
    && account?.spaceId === runtime.spaceId && account.agentRef === runtime.agentRef
    && account.runtimeId === runtimeId && typeof account.connectionId === "string"
    && account.connectionId.trim() ? account.connectionId : null;
  const unknown = { runtimeId, connectionId, scope, authority: null as string | null,
    availability: "unknown" as UsageAvailability, fresh: false, fetchedAt: null as string | null,
    resetAt: null as string | null };
  if (!connectionId || !Number.isFinite(nowMs)) return unknown;
  const matching = windows.filter((value) => value.runtimeId === runtimeId
    && value.connectionId === connectionId && value.scope === scope);
  if (matching.length !== 1) return unknown;
  const value = matching[0]!;
  const fetchedAt = Date.parse(value.fetchedAt);
  const validUntil = Date.parse(value.validUntil);
  if (typeof value.authority !== "string" || !value.authority.trim()
    || !["available", "exhausted", "unknown"].includes(value.availability)
    || !Number.isFinite(fetchedAt) || !Number.isFinite(validUntil)
    || fetchedAt > nowMs || validUntil < nowMs || validUntil < fetchedAt) return unknown;
  return { runtimeId, connectionId, scope, authority: value.authority,
    availability: value.availability, fresh: true, fetchedAt: value.fetchedAt, resetAt: value.resetAt ?? null };
}
