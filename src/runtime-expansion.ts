export const EXPANDED_RUNTIME_IDS = ["copilot", "cursor", "grok"] as const;
export const HOST_LOGIN_ONLY_RUNTIMES: readonly string[] = ["opencode", ...EXPANDED_RUNTIME_IDS];
export function manualRuntimeInstallUrl(runtimeId: string): string | null {
  const urls: Record<string, string> = { copilot: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    cursor: "https://cursor.com/docs/cli/installation", grok: "https://x.ai/news/grok-build-cli" };
  return Object.prototype.hasOwnProperty.call(urls, runtimeId) ? urls[runtimeId] : null;
}
export function runtimeEffortVisible(runtimeId: string, levels: readonly string[] = []): boolean {
  return runtimeId !== "opencode" && (!(EXPANDED_RUNTIME_IDS as readonly string[]).includes(runtimeId) || levels.length > 0);
}

/** Jeff option A applies to these Workspace adapters; isolated runtimes keep their existing mode. */
export function inheritsPersonalExtensions(runtimeId: string): boolean {
  return (EXPANDED_RUNTIME_IDS as readonly string[]).includes(runtimeId);
}
