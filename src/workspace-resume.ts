import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
export const CONNECTION_RECOVERY_REASONS = ["connection_model_unavailable", "connection_auth_required", "connection_quota_exhausted", "connection_region_unavailable", "connection_recovery_unavailable"] as const;
export type ConnectionRecoveryReason = typeof CONNECTION_RECOVERY_REASONS[number];
export function connectionRecoveryReason(conversation: WorkspaceDevSnapshot["conversation"]): ConnectionRecoveryReason | null {
  const reason = conversation.resumeAdmission?.reason;
  if (CONNECTION_RECOVERY_REASONS.includes(reason as ConnectionRecoveryReason)) return reason as ConnectionRecoveryReason;
  // Older engines have no typed provider admission reason. Only inspect their provider-error prefix.
  const match = /^\[[^\]\r\n]{1,40} error\]\s+(.*)$/s.exec(conversation.blockReason ?? "");
  if (!match || conversation.state !== "blocked") return null;
  const error = match[1]!;
  if (/^402\b|(?:insufficient|exhausted|exceeded).{0,20}(?:quota|credit|balance|allowance)|(?:额度|余额).{0,12}(?:不足|耗尽|用尽)/i.test(error)) return "connection_quota_exhausted";
  if (/^401\b|^403\b/.test(error)) return "connection_auth_required";
  if (/^404\b|model.{0,60}(?:does not support|not supported|not found|unsupported)/i.test(error)) return "connection_model_unavailable";
  return null;
}
