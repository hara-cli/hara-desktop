// Human review DTOs. Launcher commands/arguments/environment never travel from renderer to Host.
export const MCP_REVIEW_REASONS = ["owner_required", "view_changed", "review_changed", "library_read_only", "unsupported_platform", "unsupported_transport", "credentials_unsupported", "unsupported_command", "package_unavailable", "proxy_unavailable", "inspection_failed", "schema_unsupported", "drain_unknown"] as const;
export type McpReviewReason = typeof MCP_REVIEW_REASONS[number];
export interface McpReviewList {
  workspaceId: string; resourceGeneration: string; revision: number; readOnly: boolean; allowed: boolean; reason: McpReviewReason | null;
  sources: { sourceId: string; recordId: string | null; name: string; status: "candidate" | "reviewed" | "stale"; reason: McpReviewReason | null }[];
}
export interface McpReviewDetail {
  workspaceId: string; resourceGeneration: string; revision: number; recordId: string; sourceId: string; name: string;
  transport: "stdio" | "streamable-http" | "sse"; phase: "unprepared" | "code" | "inspecting" | "tools" | "failed" | "approved" | "revoked";
  reason: McpReviewReason | null; hasReview: boolean; canInspect: boolean; canApprove: boolean;
  binaryPath: string | null; packagePath: string | null; binaryDigest: string | null; packageDigest: string | null; launchSummary: string | null;
  network: "proxy_only"; credentials: "none";
  tools: { name: string; description: string; schema: Record<string, unknown>; schemaDigest: string; effect: "read" | "exec" }[];
}
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const reason = (v: unknown) => v === null || MCP_REVIEW_REASONS.includes(v as McpReviewReason);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9-]{36}$/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
function scope(v: { workspaceId: string; resourceGeneration: string; revision: number }, workspaceId: string, generation: string) {
  if (!v || v.workspaceId !== workspaceId || v.resourceGeneration !== generation || !Number.isSafeInteger(v.revision) || v.revision < 0) throw Error("Invalid MCP review scope");
}
export function mcpReviewList(value: unknown, workspaceId: string, generation: string): McpReviewList {
  const v = value as McpReviewList; scope(v, workspaceId, generation);
  if (typeof v.allowed !== "boolean" || typeof v.readOnly !== "boolean" || !reason(v.reason) || !Array.isArray(v.sources) || v.sources.length > 256
    || !v.allowed && (!v.readOnly || v.sources.length) || v.sources.some(row => !row || !text(row.sourceId, 256) || !(row.recordId === null || uuid(row.recordId))
      || !text(row.name, 80) || !["candidate", "reviewed", "stale"].includes(row.status) || !reason(row.reason))
    || new Set(v.sources.map(row => row.sourceId)).size !== v.sources.length) throw Error("Invalid MCP review list");
  return v;
}
export function mcpReviewDetail(value: unknown, workspaceId: string, generation: string, recordId: string): McpReviewDetail {
  const v = value as McpReviewDetail; scope(v, workspaceId, generation);
  if (!uuid(v.recordId) || v.recordId !== recordId || !text(v.sourceId, 256) || !text(v.name, 80) || !["stdio", "streamable-http", "sse"].includes(v.transport)
    || !["unprepared", "code", "inspecting", "tools", "failed", "approved", "revoked"].includes(v.phase) || !reason(v.reason)
    || ![v.hasReview, v.canInspect, v.canApprove].every(item => typeof item === "boolean") || v.network !== "proxy_only" || v.credentials !== "none"
    || ![v.binaryPath, v.packagePath].every(item => item === null || text(item, 4096)) || !(v.launchSummary === null || text(v.launchSummary, 32768))
    || ![v.binaryDigest, v.packageDigest].every(item => item === null || hash(item)) || !Array.isArray(v.tools) || v.tools.length > 64
    || v.tools.some(tool => !tool || !text(tool.name, 128) || !text(tool.description, 1000) || !hash(tool.schemaDigest) || !["read", "exec"].includes(tool.effect)
      || !tool.schema || typeof tool.schema !== "object" || Array.isArray(tool.schema) || JSON.stringify(tool.schema).length > 32 * 1024)
    || new Set(v.tools.map(tool => tool.name)).size !== v.tools.length
    || v.canInspect && (v.phase !== "code" || !!v.reason || !v.binaryDigest || !v.packageDigest)
    || v.canApprove && (v.phase !== "tools" || !!v.reason || !v.tools.length || !v.binaryDigest || !v.packageDigest)) throw Error("Invalid MCP review detail");
  return v;
}
