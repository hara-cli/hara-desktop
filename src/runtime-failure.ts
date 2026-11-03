import type { makeT } from "./i18n";

export const RUNTIME_FAILURE_MARKER = "hara_runtime_failure_v1=";
export const RUNTIME_FAILURE_KINDS = ["not_installed", "version_incompatible", "runtime_auth_required", "runtime_auth_rejected", "runtime_network", "runtime_proxy", "invalid_model", "runtime_quota", "runtime_rate_limit", "runtime_permission_denied", "runtime_crashed", "project_not_trusted", "timeout", "spawn_failed", "runtime_failed"] as const;
export type RuntimeFailureKind = typeof RUNTIME_FAILURE_KINDS[number];
export interface RuntimeFailureDiagnostic {
  runtime: "pi" | "codex" | "claude" | "opencode" | "gemini" | "kimi";
  kind: RuntimeFailureKind;
  version: string | null;
  loginSource: "host" | "isolated" | "unknown";
  homeMatchesAccount: boolean | null;
  extensionsIsolation?: "inherited";
  elapsedMs: number;
  retryAtMs: number;
  consecutiveFailures: number;
}
const FIELDS = ["runtime", "kind", "version", "loginSource", "homeMatchesAccount", "elapsedMs", "retryAtMs", "consecutiveFailures"];
const integer = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

/** Rebuild a closed diagnostic, never display or copy the original error or unknown fields. */
export function parseRuntimeFailure(error: string | null | undefined, runtimeId?: string): RuntimeFailureDiagnostic | null {
  if (typeof error !== "string" || error.length > 4096) return null;
  const index = error.indexOf(RUNTIME_FAILURE_MARKER);
  if (index < 0 || error.indexOf(RUNTIME_FAILURE_MARKER, index + RUNTIME_FAILURE_MARKER.length) >= 0) return null;
  const match = /^\{[^{}\r\n]{1,1024}\}/.exec(error.slice(index + RUNTIME_FAILURE_MARKER.length));
  if (!match || match[0].includes("\\")) return null;
  const fieldCount = match[0].match(/"[^"\\]*"\s*:/g)?.length ?? 0;
  if (fieldCount < FIELDS.length || fieldCount > FIELDS.length + 1) return null;
  let row: Record<string, unknown>;
  try { row = JSON.parse(match[0]); } catch { return null; }
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== fieldCount
    || !FIELDS.every(field => Object.prototype.hasOwnProperty.call(row, field))
    || Object.keys(row).some(field => !FIELDS.includes(field) && field !== "extensionsIsolation")) return null;
  if (Object.prototype.hasOwnProperty.call(row, "extensionsIsolation") && (row.runtime !== "kimi" || row.extensionsIsolation !== "inherited")) return null;
  if (row.runtime !== "pi" && row.runtime !== "codex" && row.runtime !== "claude" && row.runtime !== "opencode" && row.runtime !== "gemini" && row.runtime !== "kimi") return null;
  if (runtimeId !== undefined && row.runtime !== runtimeId) return null;
  if (!RUNTIME_FAILURE_KINDS.includes(row.kind as RuntimeFailureKind)
    || !(row.version === null || typeof row.version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(row.version))
    || !["host", "isolated", "unknown"].includes(String(row.loginSource))
    || !(row.homeMatchesAccount === null || typeof row.homeMatchesAccount === "boolean")
    || !integer(row.elapsedMs, 600_000) || !integer(row.retryAtMs, 8_640_000_000_000_000) || !integer(row.consecutiveFailures, 1000)) return null;
  // Core permits at most 30s. Allow 1s clock skew, but never keep a malformed record ticking forever.
  // Expired history remains valid and does not impose another cooldown.
  if (row.retryAtMs > Date.now() + 31_000) return null;
  return { runtime: row.runtime, ...(row.extensionsIsolation === "inherited" ? { extensionsIsolation: "inherited" as const } : {}), kind: row.kind as RuntimeFailureKind, version: row.version as string | null,
    loginSource: row.loginSource as RuntimeFailureDiagnostic["loginSource"], homeMatchesAccount: row.homeMatchesAccount as boolean | null,
    elapsedMs: row.elapsedMs, retryAtMs: row.retryAtMs, consecutiveFailures: row.consecutiveFailures };
}

export function runtimeCooldownRemaining(diagnostic: Pick<RuntimeFailureDiagnostic, "retryAtMs">, now = Date.now()): number {
  return Math.max(0, diagnostic.retryAtMs - now);
}

export function runtimeLoginCommand(runtime: RuntimeFailureDiagnostic["runtime"]): string {
  return runtime === "pi" ? "" : runtime === "codex" ? "codex login" : runtime === "claude" ? "claude" : runtime === "gemini" ? "gemini" : runtime === "kimi" ? "kimi login" : "opencode auth login";
}

export function runtimeDiagnosticSummary(diagnostic: RuntimeFailureDiagnostic, t: ReturnType<typeof makeT>): string {
  return [
    `${t("ws.runtimeDiagnostic.runtime")}: ${diagnostic.runtime}`,
    `${t("ws.runtimeDiagnostic.kind")}: ${t(`ws.resume.runtime.${diagnostic.kind}.title`)}`,
    `${t("ws.runtimeDiagnostic.version")}: ${diagnostic.version ?? t("ws.runtimeDiagnostic.unknown")}`,
    ...(diagnostic.extensionsIsolation === "inherited" ? ["extensionsIsolation: inherited", t("ws.runtimes.extensionsInherited")] : []),
    `${t("ws.runtimeDiagnostic.loginSource")}: ${t(`ws.runtimeDiagnostic.${diagnostic.loginSource}`)}`,
    `${t("ws.runtimeDiagnostic.homeMatchesAccount")}: ${t(diagnostic.homeMatchesAccount === null ? "ws.runtimeDiagnostic.unknown" : diagnostic.homeMatchesAccount ? "ws.runtimeDiagnostic.yes" : "ws.runtimeDiagnostic.no")}`,
    `${t("ws.runtimeDiagnostic.elapsed")}: ${diagnostic.elapsedMs} ms`,
    `${t("ws.runtimeDiagnostic.failures")}: ${diagnostic.consecutiveFailures}`,
    `${t("ws.runtimeDiagnostic.retryAt")}: ${diagnostic.retryAtMs === 0 ? t("ws.runtimeDiagnostic.none") : new Date(diagnostic.retryAtMs).toISOString()}`,
  ].join("\n");
}

/** The callback is deliberately manual. Expiring a cooldown never submits another request. */
export function retryRuntimeFailure(diagnostic: RuntimeFailureDiagnostic, disabled: boolean, onContinue: () => void, now = Date.now()): boolean {
  if (disabled || runtimeCooldownRemaining(diagnostic, now) > 0) return false;
  onContinue(); return true;
}

export async function copyRuntimeDiagnostic(summary: string, write: ((value: string) => Promise<void>) | undefined): Promise<"copied" | "copyFailed"> {
  try { if (!write) return "copyFailed"; await write(summary); return "copied"; } catch { return "copyFailed"; }
}
