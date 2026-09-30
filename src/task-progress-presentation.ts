import type { AgentRunProgress } from "./client";
import type { Key } from "./i18n";

/** Explain only the Engine's typed cause; never expose or interpret raw tool output. */
export function taskProgressStopExplanation(
  progress: AgentRunProgress,
  t: (key: Key) => string,
): string {
  const rounds = progress.checkpointStaleRounds.toLocaleString();
  switch (progress.trigger) {
    case "repeated_tool_call":
      return t("taskProgressStopRepeatedTool");
    case "similar_tool_evidence":
      return t("taskProgressStopSimilarEvidence");
    case "unattended_without_checkpoint":
      return t("taskProgressStopNoCheckpoint").replace("{rounds}", rounds);
    case "unattended_token_budget":
      return t("taskProgressStopTokenBudget")
        .replace("{tokens}", progress.tokens.total.toLocaleString())
        .replace("{rounds}", rounds);
    default:
      return t("taskProgressStopUnknown");
  }
}
