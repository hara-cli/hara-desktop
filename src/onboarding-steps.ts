import type { OnboardingStepViews } from "./WorkspaceOnboarding";
import { OnboardingEngineStep } from "./OnboardingEngineStep";
import { OnboardingThirdPartyStep } from "./OnboardingThirdPartyStep";
import { OnboardingColleaguesStep } from "./OnboardingColleaguesStep";

/**
 * Onboarding step bodies. All three exist; the guide's entry still follows ONBOARDING_STEPS_READY, which is turned on
 * only after Jeff has seen the full guide in the real app (coordinator, 2026-11-13).
 */
export const ONBOARDING_STEP_VIEWS: OnboardingStepViews = { 1: OnboardingEngineStep, 2: OnboardingThirdPartyStep, 3: OnboardingColleaguesStep };
