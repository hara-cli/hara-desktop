import type { Locale } from "./i18n";

const AUTH_FAILURE = /(?:\b(?:401|403)\b|unauthori[sz]ed|forbidden|auth(?:entication)?|credential|api[ _-]?key|凭证|认证|密钥)/iu;

export type ModelAuthenticationFailureState = Record<string, true>;

export function isModelAuthenticationFailure(error: string | undefined): boolean {
  return !!error && AUTH_FAILURE.test(error);
}

/**
 * Keep the recovery banner tied to the latest terminal outcome for each live session.
 *
 * The rendered failure message is deliberately sanitized, and the task lifecycle may already have
 * reached a terminal state before Desktop receives `event.turn_end`. Deriving recovery only from the
 * lifecycle therefore loses the exact 401/403 signal. This reducer records that signal without retaining
 * the provider's raw error and clears it after the same pinned route completes successfully.
 */
export function updateModelAuthenticationFailureState(
  current: ModelAuthenticationFailureState,
  sessionId: string,
  error: string | undefined,
  status: string | undefined,
): ModelAuthenticationFailureState {
  if (isModelAuthenticationFailure(error)) {
    return current[sessionId] ? current : { ...current, [sessionId]: true };
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
    ? "本轮没有完成。任务和已发送消息仍然保留；请查看任务状态后重试。"
    : "This turn did not finish. The task and your message were kept; review the task status and retry.";
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
