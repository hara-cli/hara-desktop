export const AUTOMATION_SCHEDULE_MODES: readonly [
  "once",
  "interval",
  "daily",
  "weekdays",
  "weekly",
  "advanced",
];

export type AutomationScheduleMode = (typeof AUTOMATION_SCHEDULE_MODES)[number];
export type AutomationIntervalUnit = "minutes" | "hours" | "days";
export type AutomationWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type AutomationScheduleDraft =
  | { mode: "once"; date: string; time: string }
  | { mode: "interval"; every: number | string; unit: AutomationIntervalUnit }
  | { mode: "daily"; time: string }
  | { mode: "weekdays"; time: string }
  | { mode: "weekly"; time: string; weekdays: AutomationWeekday[] }
  | { mode: "advanced"; cron: string };

export type AutomationScheduleErrorCode =
  | "INVALID_MODE"
  | "INVALID_DATE"
  | "INVALID_TIME"
  | "PAST_TIME"
  | "INVALID_INTERVAL"
  | "INVALID_INTERVAL_UNIT"
  | "INVALID_WEEKDAYS"
  | "INVALID_CRON"
  | "INVALID_NOW";

export interface AutomationScheduleSummary {
  zh: string;
  en: string;
}

export interface AutomationSchedulePlan {
  mode: AutomationScheduleMode;
  /** Parseable schedule string accepted by Hara's `automation.add` API. */
  spec: string;
  /** User-facing descriptions; callers choose the active UI language. */
  summary: AutomationScheduleSummary;
}

export interface AutomationScheduleBuildOptions {
  /** Injectable validation clock, primarily for deterministic one-shot previews and tests. */
  now?: Date | number;
}

export class AutomationScheduleError extends Error {
  readonly code: AutomationScheduleErrorCode;
  readonly field: string;
  constructor(code: AutomationScheduleErrorCode, field: string, message: string);
}

export function buildAutomationSchedule(
  draft: AutomationScheduleDraft,
  options?: AutomationScheduleBuildOptions,
): AutomationSchedulePlan;
