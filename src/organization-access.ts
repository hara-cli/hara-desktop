export type InterfaceLocale = "zh" | "en";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

const COMPANY_AUTH_REJECTION = /(?:organization|company).*(?:access|authorization|credential|role|policy).*(?:expired|revoked|rejected|http\s+(?:401|403))/iu;

export function companySpaceNeedsReenrollment(accessState?: string): boolean {
  return accessState === "expired" || accessState === "invalid";
}

export function companyAccessRecoveryMessage(error: unknown, locale: InterfaceLocale): string | null {
  const candidate = error && typeof error === "object" ? error as ErrorLike : {};
  const message = typeof candidate.message === "string" ? candidate.message : String(error ?? "");
  const rejected = COMPANY_AUTH_REJECTION.test(message)
    || (candidate.code === -32001 && /(?:organization|company).*(?:access|connection|authorization)/iu.test(message));
  if (!rejected) return null;
  return locale === "zh"
    ? "公司授权已过期或被管理员撤销。请前往“设置 → AI 与模型”，在企业托管中重新接入后再打开 Agent 工作室。"
    : "Company access expired or was revoked. Re-enroll it under Settings → AI & Models → Organization connections, then reopen Agent Studio.";
}

export function unavailableCompanySpaceMessage(locale: InterfaceLocale): string {
  return locale === "zh"
    ? "当前公司授权已失效。请前往“设置 → AI 与模型”，在企业托管中重新接入后再使用公司 Agent。"
    : "This company access is unavailable. Re-enroll it under Settings → AI & Models → Organization connections before using company Agents.";
}
