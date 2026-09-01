/** Resolve one automation row without making every historical occurrence inherit the job's latest state. */
export function resolveAutomationRun(run, job, isLatestForJob) {
  const ownStatus = typeof run?.status === "string" && run.status.trim()
    ? run.status
    : undefined;
  const ownError = typeof run?.error === "string" ? run.error.trim() : "";
  const useLatestFallback = isLatestForJob && !ownStatus && !ownError;
  const latestStatus = useLatestFallback && typeof job?.lastStatus === "string" && job.lastStatus.trim()
    ? job.lastStatus
    : undefined;
  const latestError = useLatestFallback && typeof job?.lastError === "string"
    ? job.lastError.trim()
    : "";
  return {
    status: ownStatus ?? latestStatus,
    error: ownError || latestError || undefined,
  };
}
