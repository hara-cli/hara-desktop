export interface AutomationRunOutcomeInput {
  status?: string;
  error?: string;
}

export interface AutomationJobOutcomeInput {
  lastStatus?: string;
  lastError?: string;
}

export interface ResolvedAutomationRun {
  status?: string;
  error?: string;
}

export declare function resolveAutomationRun(
  run: AutomationRunOutcomeInput,
  job: AutomationJobOutcomeInput | undefined,
  isLatestForJob: boolean,
): ResolvedAutomationRun;
