import type { Locale } from "./i18n";

const AUTH_FAILURE = /(?:\b(?:401|403)\b|unauthori[sz]ed|forbidden|auth(?:entication)?|credential|api[ _-]?key|凭证|认证|密钥)/iu;

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
  if (AUTH_FAILURE.test(error)) {
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
