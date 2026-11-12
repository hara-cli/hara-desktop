/**
 * Getting-started guide progress (Core G4, `docs/contracts/workspace-onboarding-v1.md` in hara-cli #59).
 * Core owns the record: dismissed / completed / step / run. Pre-upgrade workspaces read as dismissed, so the
 * guide never pops up for existing users (Jeff Q3). Desk keeps only a per-viewer convenience in localStorage:
 * whether this run's sheet has been shown once, so the next visit shows the resume card instead of the sheet
 * (design: «Later» or closing the window → a «Continue» card at the top of the Hara chat).
 */
export const ONBOARDING_CAPABILITY = "workspace.onboarding.v1";
/**
 * Desk-side release gate. The guide has no entry until all three steps exist (step 3 waits for C5), because
 * unreleased features show no entry (DESIGN.md). The slice that ships step 3 flips this.
 */
export const ONBOARDING_STEPS_READY = false;

export type OnboardingStep = 1 | 2 | 3;
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [1, 2, 3];
export interface OnboardingFields { runId: string; step: OnboardingStep; engineChoice: string | null; thirdPartySkipped: boolean; dismissed: boolean; completedAt: string | null }
export interface OnboardingProgress extends OnboardingFields { schemaVersion: 1; revision: number; readOnly: boolean; recovered: boolean }

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Validates a Core reply. Anything unexpected throws, so a malformed record never opens the guide. */
export function onboardingView(raw: unknown): OnboardingProgress {
  const value = record(raw);
  if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.revision) || typeof value.runId !== "string" || !value.runId
    || ![1, 2, 3].includes(value.step as number) || !(value.engineChoice === null || typeof value.engineChoice === "string")
    || typeof value.thirdPartySkipped !== "boolean" || typeof value.dismissed !== "boolean" || !(value.completedAt === null || typeof value.completedAt === "string")
    || typeof value.readOnly !== "boolean" || typeof value.recovered !== "boolean") throw new Error("Invalid onboarding progress");
  return { schemaVersion: 1, revision: value.revision as number, readOnly: value.readOnly, recovered: value.recovered, runId: value.runId, step: value.step as OnboardingStep,
    engineChoice: value.engineChoice as string | null, thirdPartySkipped: value.thirdPartySkipped, dismissed: value.dismissed, completedAt: value.completedAt as string | null };
}
export const onboardingFields = (value: OnboardingProgress): OnboardingFields =>
  ({ runId: value.runId, step: value.step, engineChoice: value.engineChoice, thirdPartySkipped: value.thirdPartySkipped, dismissed: value.dismissed, completedAt: value.completedAt });

/** A rerun from Settings: fresh run, step 1, no completion, no third-party skip; keeps the current engine choice. */
export const rerunFields = (value: OnboardingProgress, runId: string): OnboardingFields =>
  ({ runId, step: 1, engineChoice: value.engineChoice, thirdPartySkipped: false, dismissed: false, completedAt: null });

export type OnboardingSurface = "none" | "sheet" | "resume";
/**
 * What the workspace shows. The sheet opens by itself only the first time a run is seen and only while Hara
 * is the only colleague (design entry condition); afterwards the run continues from the resume card.
 */
export function onboardingSurface(value: OnboardingProgress | null, { seen, colleagues }: { seen: boolean; colleagues: number }): OnboardingSurface {
  if (!value || value.dismissed || value.completedAt) return "none";
  return seen || colleagues > 0 ? "resume" : "sheet";
}
export const stepsLeft = (step: OnboardingStep) => 4 - step;

export const ONBOARDING_SEEN_KEY = "hara.onboarding.seen.v1";
const readSeen = (): Record<string, string> => { try { return record(JSON.parse(localStorage.getItem(ONBOARDING_SEEN_KEY) ?? "null")) as Record<string, string> ?? {}; } catch { return {}; } };
export function onboardingSeen(workspaceId: string, runId: string): boolean { return readSeen()[workspaceId] === runId; }
export function markOnboardingSeen(workspaceId: string, runId: string): void {
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, JSON.stringify({ ...readSeen(), [workspaceId]: runId })); } catch { /* Per-viewer convenience only; without it the sheet simply opens again. */ }
}
