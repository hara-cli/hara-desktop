import type { OnboardingStepViews } from "./WorkspaceOnboarding";
import { OnboardingEngineStep } from "./OnboardingEngineStep";

/**
 * Shipped onboarding step bodies. Step 2 (third-party, O3) and step 3 (colleagues, after C5) are still missing, so the
 * guide stays gated off (ONBOARDING_STEPS_READY) and a run sitting on a missing step never opens the sheet (#82 G-2).
 */
export const ONBOARDING_STEP_VIEWS: OnboardingStepViews = { 1: OnboardingEngineStep };
