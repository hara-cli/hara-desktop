import { runtimeStageDiagnosticsText, type RuntimeStageReport } from "./runtime-stage-events.ts";
import type { makeT } from "./i18n";

export const RUNTIME_FAILURE_MARKER = "hara_runtime_failure_v1=";
export const RUNTIME_FAILURE_KINDS = ["not_installed", "version_incompatible", "runtime_auth_required", "runtime_auth_rejected", "runtime_network", "runtime_proxy", "invalid_model", "runtime_quota", "runtime_rate_limit", "runtime_permission_denied", "runtime_crashed", "project_not_trusted", "timeout", "spawn_failed", "runtime_failed"] as const;
export type RuntimeFailureKind = typeof RUNTIME_FAILURE_KINDS[number];
export interface RuntimeFailureDiagnostic {
  runtime: "pi" | "codex" | "claude" | "opencode" | "gemini" | "kimi" | "copilot" | "cursor" | "grok";
  kind: RuntimeFailureKind;
  version: string | null;
  loginSource: "host" | "isolated" | "unknown";
  homeMatchesAccount: boolean | null;
  extensionsIsolation?: "inherited";
  errorFirstLine?: string;
  elapsedMs: number;
  retryAtMs: number;
  consecutiveFailures: number;
}
const FIELDS = ["runtime", "kind", "version", "loginSource", "homeMatchesAccount", "elapsedMs", "retryAtMs", "consecutiveFailures"];
const integer = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;

/** Extract a single flat JSON envelope, preserving duplicate-key rejection even with escaped strings. */
function diagnosticEnvelope(source: string): { text: string; keys: string[] } | null {
  if (source[0] !== "{") return null;
  let quoted = false, escaped = false, start = 0;
  const keys: string[] = [];
  for (let i = 1; i < Math.min(source.length, 2048); i++) {
    const c = source[i]!;
    if (c === "\n" || c === "\r") return null;
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') {
        quoted = false;
        if (/^\s*:/u.test(source.slice(i + 1))) {
          try { keys.push(JSON.parse(source.slice(start, i + 1))); } catch { return null; }
        }
      }
    } else if (c === '"') { quoted = true; start = i; }
    else if (c === "{" || c === "[") return null;
    else if (c === "}") return { text: source.slice(0, i + 1), keys };
  }
  return null;
}

function validErrorFirstLine(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && [...value].length <= 320
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && !/(?:https?|socks[45]?):\/\/|(?:[A-Za-z]:[\\/]|\/)[^\s]+|[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/iu.test(value)
    && !/\b[A-Za-z0-9_-]{20,}\b/u.test(value)
    && !/(?:Bearer\s+(?!\*{3})\S+|(?:api[ _-]?key|token|password|secret)["']?\s*[:=]\s*["']?(?!\*{3}|\[redacted\])[^\s"']+)/iu.test(value);
}

/** Rebuild a closed diagnostic, never display or copy the original error or unknown fields. */
export function parseRuntimeFailure(error: string | null | undefined, runtimeId?: string): RuntimeFailureDiagnostic | null {
  if (typeof error !== "string" || error.length > 4096) return null;
  const index = error.indexOf(RUNTIME_FAILURE_MARKER);
  if (index < 0 || error.indexOf(RUNTIME_FAILURE_MARKER, index + RUNTIME_FAILURE_MARKER.length) >= 0) return null;
  const envelope = diagnosticEnvelope(error.slice(index + RUNTIME_FAILURE_MARKER.length));
  if (!envelope || new Set(envelope.keys).size !== envelope.keys.length) return null;
  const fieldCount = envelope.keys.length;
  if (fieldCount < FIELDS.length || fieldCount > FIELDS.length + 2) return null;
  let row: Record<string, unknown>;
  try { row = JSON.parse(envelope.text); } catch { return null; }
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== fieldCount
    || !FIELDS.every(field => Object.prototype.hasOwnProperty.call(row, field))
    || Object.keys(row).some(field => !FIELDS.includes(field) && field !== "extensionsIsolation" && field !== "errorFirstLine")) return null;
  if (Object.prototype.hasOwnProperty.call(row, "errorFirstLine") && !validErrorFirstLine(row.errorFirstLine)) return null;
  if (Object.prototype.hasOwnProperty.call(row, "extensionsIsolation") && (!["kimi", "copilot", "cursor", "grok"].includes(String(row.runtime)) || row.extensionsIsolation !== "inherited")) return null;
  if (row.runtime !== "pi" && row.runtime !== "codex" && row.runtime !== "claude" && row.runtime !== "opencode" && row.runtime !== "gemini" && row.runtime !== "kimi" && row.runtime !== "copilot" && row.runtime !== "cursor" && row.runtime !== "grok") return null;
  if (runtimeId !== undefined && row.runtime !== runtimeId) return null;
  if (Object.prototype.hasOwnProperty.call(row, "extensionsIsolation") && (row.extensionsIsolation !== "inherited" || !["kimi", "copilot", "cursor", "grok"].includes(row.runtime))) return null;
  if (!RUNTIME_FAILURE_KINDS.includes(row.kind as RuntimeFailureKind)
    || !(row.version === null || typeof row.version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(row.version))
    || !["host", "isolated", "unknown"].includes(String(row.loginSource))
    || !(row.homeMatchesAccount === null || typeof row.homeMatchesAccount === "boolean")
    || !integer(row.elapsedMs, 600_000) || !integer(row.retryAtMs, 8_640_000_000_000_000) || !integer(row.consecutiveFailures, 1000)) return null;
  // Core permits at most 30s. Allow 1s clock skew, but never keep a malformed record ticking forever.
  // Expired history remains valid and does not impose another cooldown.
  if (row.retryAtMs > Date.now() + 31_000) return null;
  return { runtime: row.runtime, ...(typeof row.errorFirstLine === "string" ? { errorFirstLine: row.errorFirstLine } : {}), ...(row.extensionsIsolation === "inherited" ? { extensionsIsolation: "inherited" as const } : {}), kind: row.kind as RuntimeFailureKind, version: row.version as string | null,
    loginSource: row.loginSource as RuntimeFailureDiagnostic["loginSource"], homeMatchesAccount: row.homeMatchesAccount as boolean | null,
    elapsedMs: row.elapsedMs, retryAtMs: row.retryAtMs, consecutiveFailures: row.consecutiveFailures };
}

export function runtimeCooldownRemaining(diagnostic: Pick<RuntimeFailureDiagnostic, "retryAtMs">, now = Date.now()): number {
  return Math.max(0, diagnostic.retryAtMs - now);
}

export function runtimeLoginCommand(runtime: RuntimeFailureDiagnostic["runtime"]): string {
  return runtime === "pi" ? "" : runtime === "codex" ? "codex login" : runtime === "claude" ? "claude" : runtime === "gemini" ? "gemini" : runtime === "kimi" ? "kimi login" : runtime === "opencode" ? "opencode auth login" : "";
}

export function runtimeDiagnosticSummary(diagnostic: RuntimeFailureDiagnostic, t: ReturnType<typeof makeT>, stages: readonly RuntimeStageReport[] = []): string {
  const timings = runtimeStageDiagnosticsText(stages);
  return [
    ...(diagnostic.errorFirstLine ? [`${t("ws.runtimeDiagnostic.errorFirstLine")}: ${diagnostic.errorFirstLine}`] : []),
    `${t("ws.runtimeDiagnostic.runtime")}: ${diagnostic.runtime}`,
    ...(diagnostic.extensionsIsolation ? [`${t("ws.runtimeDiagnostic.extensionsIsolation")}: ${diagnostic.extensionsIsolation}`] : []),
    `${t("ws.runtimeDiagnostic.kind")}: ${t(`ws.resume.runtime.${diagnostic.kind}.title`)}`,
    `${t("ws.runtimeDiagnostic.version")}: ${diagnostic.version ?? t("ws.runtimeDiagnostic.unknown")}`,
    ...(diagnostic.extensionsIsolation === "inherited" ? ["extensionsIsolation: inherited", t("ws.runtimes.extensionsInherited")] : []),
    `${t("ws.runtimeDiagnostic.loginSource")}: ${t(`ws.runtimeDiagnostic.${diagnostic.loginSource}`)}`,
    `${t("ws.runtimeDiagnostic.homeMatchesAccount")}: ${t(diagnostic.homeMatchesAccount === null ? "ws.runtimeDiagnostic.unknown" : diagnostic.homeMatchesAccount ? "ws.runtimeDiagnostic.yes" : "ws.runtimeDiagnostic.no")}`,
    `${t("ws.runtimeDiagnostic.elapsed")}: ${diagnostic.elapsedMs} ms`,
    `${t("ws.runtimeDiagnostic.failures")}: ${diagnostic.consecutiveFailures}`,
    `${t("ws.runtimeDiagnostic.retryAt")}: ${diagnostic.retryAtMs === 0 ? t("ws.runtimeDiagnostic.none") : new Date(diagnostic.retryAtMs).toISOString()}`,
    ...(timings ? [timings] : []),
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
