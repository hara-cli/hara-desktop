// Host platform write protection. macOS has Seatbelt and both tiers;
// other platforms have no system-level write protection and only the controlled tier.
export type RuntimeTier = "full-protected" | "controlled";
export interface WorkspaceRuntimePlatform { writeProtection: "seatbelt" | "none"; permissionTiers: readonly RuntimeTier[] }
/** A Core that predates the platform field ran only with Seatbelt-capable semantics (macOS). */
export const DEFAULT_RUNTIME_PLATFORM: WorkspaceRuntimePlatform = Object.freeze({ writeProtection: "seatbelt", permissionTiers: Object.freeze(["full-protected", "controlled"] as const) });
const NO_PROTECTION: WorkspaceRuntimePlatform = Object.freeze({ writeProtection: "none", permissionTiers: Object.freeze(["controlled"] as const) });

/** Accept only the two exact shapes Core emits; anything else keeps the conservative reading of the field. */
export function parseRuntimePlatform(value: unknown): WorkspaceRuntimePlatform {
  if (value === undefined) return DEFAULT_RUNTIME_PLATFORM;
  if (!value || typeof value !== "object" || Array.isArray(value)) return NO_PROTECTION;
  const row = value as { writeProtection?: unknown; permissionTiers?: unknown };
  const tiers = Array.isArray(row.permissionTiers) ? row.permissionTiers : [];
  if (row.writeProtection === "seatbelt" && tiers.length === 2 && tiers[0] === "full-protected" && tiers[1] === "controlled") return DEFAULT_RUNTIME_PLATFORM;
  // A malformed or unknown platform never advertises the full tier.
  return NO_PROTECTION;
}

export const PLATFORM_REASON_KEYS: Readonly<Record<string, string>> = Object.freeze({
  permission_tier_unavailable_on_platform: "ws.permissions.unavailableHere",
  native_engine_unsupported_on_platform: "ws.engine.unsupportedPlatform",
});
export function platformReasonKey(error: unknown): string | undefined {
  const reason = error && typeof error === "object" && "platformReason" in error ? (error as { platformReason?: unknown }).platformReason : undefined;
  return typeof reason === "string" ? PLATFORM_REASON_KEYS[reason] : undefined;
}
