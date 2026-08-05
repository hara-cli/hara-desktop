export const EXECUTION_VIEW_PREFERENCE_KEY = "hara.executionView.v1";

export const EXECUTION_VIEW_MODES = ["concise", "standard", "debug"] as const;
export type ExecutionViewMode = typeof EXECUTION_VIEW_MODES[number];

/** Corrupt or obsolete local preferences always return to the quiet product default. */
export function parseExecutionViewMode(value: unknown): ExecutionViewMode {
  return typeof value === "string" && EXECUTION_VIEW_MODES.includes(value as ExecutionViewMode)
    ? value as ExecutionViewMode
    : "concise";
}

export function executionViewShowsLog(mode: ExecutionViewMode): boolean {
  return mode !== "concise";
}

export function executionViewExpandsLog(mode: ExecutionViewMode): boolean {
  return mode === "debug";
}

export function executionViewShowsUsage(mode: ExecutionViewMode): boolean {
  return mode === "debug";
}
