import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
export const CONNECTION_RECOVERY_REASONS = ["connection_model_unavailable", "connection_auth_required", "connection_quota_exhausted", "connection_region_unavailable", "connection_recovery_unavailable"] as const;
export type ConnectionRecoveryReason = typeof CONNECTION_RECOVERY_REASONS[number];

function explicitQuotaExhaustion(message: string): boolean {
  if (/(?:insufficient|exhausted|depleted|not enough).{0,20}(?:credits?|balance|funds)|(?:credits?|balance|funds).{0,30}(?:exhausted|depleted|insufficient|used up|run out)|(?:积分|積分|余额|餘額|余額).{0,12}(?:不足|耗尽|耗盡|用尽|用盡)/.test(message)) return true;
  if (/\b(?:requests?|tokens?).{0,50}\b(?:per|minute|hour|day|second|quota|limit)\b|\b(?:rpm|tpm|rpd|tpd)\b|(?:每.{0,8}(?:秒|分钟|分鐘|小时|小時|天)|请求速率|請求速率)/.test(message)) return false;
  return /insufficient\s+(?:account\s+)?(?:quota|allowance)|(?:quota|allowance).{0,20}(?:exhausted|depleted|used up|run out)|(?:exhausted|depleted).{0,20}(?:quota|allowance)|(?:额度|額度|配额|配額).{0,12}(?:不足|耗尽|耗盡|用尽|用盡)/.test(message);
}
export function connectionRecoveryReason(conversation: WorkspaceDevSnapshot["conversation"]): ConnectionRecoveryReason | null {
  const reason = conversation.resumeAdmission?.reason;
  if (CONNECTION_RECOVERY_REASONS.includes(reason as ConnectionRecoveryReason)) return reason as ConnectionRecoveryReason;
  // Older engines have no typed provider admission reason. Only inspect their provider-error prefix.
  const match = /^\[[^\]\r\n]{1,40} error\]\s+(.*)$/s.exec(conversation.blockReason ?? "");
  if (!match || conversation.state !== "blocked") return null;
  // Legacy engines append their own hints; those are not provider evidence of a spent balance.
  const error = match[1]!.split(" — ", 1)[0]!;
  if (/^429\b/.test(error)) return explicitQuotaExhaustion(error.toLowerCase().replace(/\s+/g, " ")) ? "connection_quota_exhausted" : null;
  if (/^402\b|(?:insufficient|exhausted|exceeded).{0,20}(?:quota|credit|balance|allowance)|(?:额度|余额).{0,12}(?:不足|耗尽|用尽)/i.test(error)) return "connection_quota_exhausted";
  if (/^401\b|^403\b/.test(error)) return "connection_auth_required";
  if (/^404\b|model.{0,60}(?:does not support|not supported|not found|unsupported)/i.test(error)) return "connection_model_unavailable";
  return null;
}
