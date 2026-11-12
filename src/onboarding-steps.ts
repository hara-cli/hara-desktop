import type { OnboardingStepViews } from "./WorkspaceOnboarding";
import { OnboardingEngineStep } from "./OnboardingEngineStep";
import { OnboardingThirdPartyStep } from "./OnboardingThirdPartyStep";

/**
 * Shipped onboarding step bodies. Step 3 (colleagues, after C5) is still missing, so the
 * guide stays gated off (ONBOARDING_STEPS_READY) and a run sitting on a missing step never opens the sheet (#82 G-2).
 */
export const ONBOARDING_STEP_VIEWS: OnboardingStepViews = { 1: OnboardingEngineStep, 2: OnboardingThirdPartyStep };
