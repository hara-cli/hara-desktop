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

export function executionViewExpandsLog(_mode: ExecutionViewMode): boolean {
  // Even diagnostics belong behind an explicit disclosure. Opening every raw tool call makes the
  // conversation read like a protocol trace and can push the actual Agent reply off screen.
  return false;
}

export function executionViewShowsUsage(mode: ExecutionViewMode): boolean {
  return mode === "debug";
}
