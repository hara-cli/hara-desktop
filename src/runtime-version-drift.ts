/** Read-only metadata. Version history never supplies execution or trust authority. */
export interface RuntimeVersionStatus {
  schemaVersion: 1; lastSuccessfulVersion: string | null; currentVersion: string | null;
  change: "no_history" | "same" | "upgraded" | "downgraded" | "unknown";
  compatibility: "previously_succeeded" | "unverified" | "unknown";
  binaryChanged: boolean | null; requiresRetrust: boolean;
}
/** Present-but-invalid metadata has status null; absent older-Core metadata has no binding. */
export interface RuntimeVersionBinding { runtimeId: string; status: RuntimeVersionStatus | null }
const IDS = ["hara", "pi", "opencode", "codex", "claude", "copilot", "cursor", "grok", "agy"];
export const knownRuntimeVersionId = (value: unknown): value is string => typeof value === "string" && IDS.includes(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const version = (value: unknown): value is string | null => value === null || typeof value === "string" && value === value.trim() && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value);
const keys = ["schemaVersion", "lastSuccessfulVersion", "currentVersion", "change", "compatibility", "binaryChanged", "requiresRetrust"];
function compare(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  return 0;
}
export function parseRuntimeVersionStatus(value: unknown): RuntimeVersionStatus | null {
  if (!record(value) || Object.keys(value).length !== keys.length || !keys.every(key => has(value, key))
    || value.schemaVersion !== 1 || !version(value.lastSuccessfulVersion) || !version(value.currentVersion)
    || typeof value.change !== "string" || !["no_history", "same", "upgraded", "downgraded", "unknown"].includes(value.change)
    || typeof value.compatibility !== "string" || !["previously_succeeded", "unverified", "unknown"].includes(value.compatibility)
    || !(value.binaryChanged === null || typeof value.binaryChanged === "boolean") || typeof value.requiresRetrust !== "boolean") return null;
  const { lastSuccessfulVersion: last, currentVersion: current, change, compatibility, binaryChanged, requiresRetrust } = value;
  if (change === "no_history") {
    if (last !== null || current === null || binaryChanged !== null || compatibility !== "unverified") return null;
  } else if (change === "unknown") {
    if (last !== null && current !== null || compatibility !== "unknown") return null;
  } else {
    if (last === null || current === null) return null;
    const direction = compare(current, last);
    if (change === "same" && direction !== 0 || change === "upgraded" && direction <= 0 || change === "downgraded" && direction >= 0
      || compatibility === "unknown") return null;
  }
  if (compatibility === "previously_succeeded" && (change !== "same" || binaryChanged !== false || requiresRetrust)) return null;
  return { schemaVersion: 1, lastSuccessfulVersion: last, currentVersion: current,
    change: change as RuntimeVersionStatus["change"], compatibility: compatibility as RuntimeVersionStatus["compatibility"], binaryChanged, requiresRetrust };
}
/** Match the current snapshot's runtime row only; duplicates and absent fields supply no evidence. */
export function runtimeVersionFor(options: unknown, runtimeId: unknown): RuntimeVersionBinding | null {
  if (!knownRuntimeVersionId(runtimeId) || !Array.isArray(options) || options.length > 16) return null;
  const matches = options.filter(row => record(row) && row.runtimeId === runtimeId);
  if (matches.length !== 1 || !has(matches[0], "versionStatus")) return null;
  const status = parseRuntimeVersionStatus(matches[0].versionStatus);
  return { runtimeId, status: status?.compatibility === "previously_succeeded" && matches[0].registered !== true ? null : status };
}
