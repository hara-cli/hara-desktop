export interface AuthenticationPauseInput {
  dependencyKind?: string;
  capability?: string;
  detail?: string;
  evidence?: string[];
  blockReason?: string;
  nextStep?: string;
}

export interface AuthenticationPausePresentation {
  capability?: string;
  automaticRefreshFailed: boolean;
}

const EXPIRED_AUTH = [
  /\bauth(?:entication)?[ _-]?expired\b/i,
  /\bsession[ _-]?expired\b/i,
  /\b(?:jwt|access[ _-]?token|refresh[ _-]?token|credential|credentials?)\b[^\n]{0,100}\b(?:expired|invalid|revoked|no longer (?:valid|works?))\b/i,
  /\b(?:expired|invalid|revoked)\b[^\n]{0,100}\b(?:jwt|access[ _-]?token|refresh[ _-]?token|credential|credentials?)\b/i,
  /(?:登录状态|登录凭证|认证凭证|管理员凭证|访问凭证)[^\n]{0,60}(?:过期|失效|无效|被撤销)/,
  /(?:凭证|令牌|认证)[^\n]{0,60}(?:已过期|已失效|无法续期)/,
] as const;

const REFRESH_FAILED = [
  /\brefresh(?:[ _-]?token)?\b[^\n]{0,100}\b(?:failed|invalid|expired|rejected|no longer (?:valid|works?))\b/i,
  /\b(?:failed|invalid|expired|rejected)\b[^\n]{0,100}\brefresh(?:[ _-]?token)?\b/i,
  /(?:自动续期|自动刷新|刷新凭证|refresh)[^\n]{0,80}(?:失败|失效|被拒绝|无法)/i,
] as const;

function safeCapability(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/[^\p{L}\p{N}._:@/\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return normalized || undefined;
}

/** Convert a model-authored authentication blocker into a stable renderer-owned recovery state.
 * Raw upstream errors stay out of the primary task card: they may contain implementation details,
 * tool names, or credentials which are neither instructions nor useful ordinary-user copy. */
export function authenticationPausePresentation(
  input: AuthenticationPauseInput,
): AuthenticationPausePresentation | undefined {
  if (input.dependencyKind !== "missing_secret" && input.dependencyKind !== "missing_authority") {
    return undefined;
  }
  const observed = [
    input.detail,
    ...(input.evidence ?? []),
    input.blockReason,
    input.nextStep,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
  if (!EXPIRED_AUTH.some((pattern) => pattern.test(observed))) return undefined;
  return {
    ...(safeCapability(input.capability) ? { capability: safeCapability(input.capability) } : {}),
    automaticRefreshFailed: REFRESH_FAILED.some((pattern) => pattern.test(observed)),
  };
}
