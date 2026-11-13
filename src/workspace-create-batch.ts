/**
 * Core G2 `workspace.agents.createBatch` (contract `docs/contracts/workspace-onboarding-v1.md`, hara-cli #66).
 * One explicit UI submission creates up to eight colleagues; `runId + draftKey` makes retries idempotent, and each row
 * succeeds or fails on its own. Creation starts no model, task or engine and grants nothing.
 */
export const CREATE_BATCH_CAPABILITY = "workspace.agents.create-batch.v1";
export const CREATE_BATCH_LIMIT = 8;
export const CREATE_BATCH_REASONS = ["invalid_request", "runtime_unconfirmed", "runtime_unavailable", "permission_tier_unavailable", "username_taken", "catalog_changed", "batch_limit"] as const;
export type CreateBatchReason = typeof CREATE_BATCH_REASONS[number];

export interface CreateBatchRow { draftKey: string; username: string; profile: Record<string, unknown>; description?: string; instructions?: string; runtimeId?: string; permissionTier?: string }
export type CreateBatchRowResult = { index: number; draftKey: string; status: "created" | "exists"; agentId: string } | { index: number; draftKey: string; status: "failed"; reason: CreateBatchReason };
export interface CreateBatchView { runId: string; revision: number; results: CreateBatchRowResult[] }

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Validates the reply against the rows sent; anything unexpected throws instead of claiming per-row success. */
export function createBatchView(raw: unknown, runId: string, rows: readonly CreateBatchRow[]): CreateBatchView {
  if (!plain(raw) || raw.runId !== runId || !Number.isSafeInteger(raw.revision) || !Array.isArray(raw.results) || raw.results.length !== rows.length) throw new Error("Invalid createBatch reply");
  const results = raw.results.map((item, index): CreateBatchRowResult => {
    if (!plain(item) || item.index !== index || item.draftKey !== rows[index]!.draftKey) throw new Error("Invalid createBatch row");
    if (item.status === "created" || item.status === "exists") {
      if (!plain(item.agent) || typeof item.agent.agentId !== "string" || !item.agent.agentId) throw new Error("Invalid createBatch agent");
      return { index, draftKey: item.draftKey, status: item.status, agentId: item.agent.agentId };
    }
    if (item.status === "failed" && CREATE_BATCH_REASONS.includes(item.reason as CreateBatchReason)) return { index, draftKey: item.draftKey, status: "failed", reason: item.reason as CreateBatchReason };
    throw new Error("Invalid createBatch status");
  });
  return { runId, revision: raw.revision as number, results };
}
