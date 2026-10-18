import type { Locale } from "./i18n";

const INTERRUPTED_TURN = /^(?:interrupted|\(interrupted\))$/iu;
const AUTH_FAILURE = /(?:\b(?:401|403)\b|unauthori[sz]ed|forbidden|auth(?:entication)?|credential|api[ _-]?key|凭证|认证|密钥)/iu;
const QUOTA_FAILURE = /(?:\b402\b|insufficient[ _-]?(?:balance|credits?)|(?:quota|allowance|balance)[^\n]{0,60}(?:exhausted|depleted)|余额不足|额度(?:已)?耗尽)/iu;

export type ModelConnectionFailureKind = "authentication" | "quota";
export type ModelConnectionFailureState = Record<string, ModelConnectionFailureKind>;

export function modelConnectionFailureKind(error: string | undefined): ModelConnectionFailureKind | undefined {
  if (!error) return undefined;
  if (/\b(?:401|403)\b/u.test(error)) return "authentication";
  if (QUOTA_FAILURE.test(error)) return "quota";
  return AUTH_FAILURE.test(error) ? "authentication" : undefined;
}

export function isModelAuthenticationFailure(error: string | undefined): boolean {
  return modelConnectionFailureKind(error) === "authentication";
}

/**
 * Keep the recovery banner tied to the latest terminal outcome for each live session.
 *
 * The rendered failure message is deliberately sanitized, and the task lifecycle may already have
 * reached a terminal state before Desktop receives `event.turn_end`. Deriving recovery only from the
 * lifecycle therefore loses the exact 401/403 or quota signal. Record the latest classified failure
 * without retaining the provider's raw error, and clear it after the pinned route completes successfully.
 */
export function updateModelConnectionFailureState(
  current: ModelConnectionFailureState,
  sessionId: string,
  error: string | undefined,
  status: string | undefined,
): ModelConnectionFailureState {
  const kind = modelConnectionFailureKind(error);
  if (kind) {
    return current[sessionId] === kind ? current : { ...current, [sessionId]: kind };
  }
  if (!error && (!status || status === "completed") && current[sessionId]) {
    const { [sessionId]: _resolved, ...rest } = current;
    return rest;
  }
  return current;
}

/**
 * Convert an upstream turn failure into stable product copy.
 *
 * Provider errors may contain endpoints, account identifiers, or accidentally echoed credentials, so
 * Desktop never renders the raw error in the conversation. Detailed redacted lifecycle evidence remains
 * available through the task checkpoint and execution log.
 */
export function turnFailureMessage(
  error: string | undefined,
  status: string | undefined,
  locale: Locale,
): string | undefined {
  if (!error) return undefined;
  // Core retains its error/RPC outcome for interruption. Earlier side effects may already have
  // completed; safe presentation preserves that uncertainty instead of suggesting a blind retry.
  if (INTERRUPTED_TURN.test(error.trim())) {
    return locale === "zh"
      ? "本轮执行已中断。已完成的操作不会因此撤销。请先核对实际结果，再从保存的进度继续，避免重复上传或发送。"
      : "This turn was interrupted. Completed actions are not undone. Check the actual results before continuing from the saved progress to avoid duplicate uploads or messages.";
  }
  if (modelConnectionFailureKind(error) === "quota") {
    return locale === "zh"
      ? "服务商报告模型连接的额度或余额不足。请切换到其他可用连接，或在服务商处核验额度及重置时间。"
      : "The provider reports insufficient allowance or balance for the model connection. Switch to another available connection, or check the allowance and reset time with the provider.";
  }
  if (isModelAuthenticationFailure(error)) {
    return locale === "zh"
      ? "模型连接认证失败。请在“模型与连接”中更新这个账号，或切换到可用连接后重试。"
      : "The model connection could not authenticate. Update this account in Models & connections, or switch to an available connection and retry.";
  }
  if (status === "empty") {
    return locale === "zh"
      ? "模型没有返回可用内容。本次消息没有丢失，可以重试或切换模型连接。"
      : "The model returned no usable content. Your message was kept; retry or switch model connections.";
  }
  return locale === "zh"
    ? "本轮没有完成。已保存的任务和消息仍然保留；请先核对任务状态及实际结果，再决定如何继续，避免重复上传或发送。"
    : "This turn did not finish. Saved task progress and messages were kept. Check the task status and actual results before continuing to avoid duplicate uploads or messages.";
}

/** session.send can reject after its terminal event already rendered the safe failure notice. Keep
 * that receipt/error contract, but never append its raw diagnostic or duplicate the event's notice. */
export function rpcTurnFailureMessage(
  error: unknown,
  locale: Locale,
  failureNotified = false,
): string | undefined {
  if (failureNotified) return undefined;
  const candidate = error && typeof error === "object" ? error as { message?: unknown } : undefined;
  const detail = typeof error === "string" ? error
    : typeof candidate?.message === "string" ? candidate.message : "Request failed.";
  return turnFailureMessage(detail || "Request failed.", "error", locale);
}
