import type { WorkspaceDevSnapshot } from "./workspace-dev-state";

type AccountUsage = NonNullable<WorkspaceDevSnapshot["accountUsage"]>[number];

/** A view projection only. Missing or stale account data is never displayed as available. */
export function colleagueUsageView(row: AccountUsage | undefined): { state: "ok" | "limit_reached" | "parse_unavailable"; label: string; notice: string | null } {
  if (!row?.view.fresh || row.state === "parse_unavailable") return {
    state: "parse_unavailable", label: "用量暂不可查", notice: null,
  };
  if (row.state === "limit_reached") return {
    state: "limit_reached", label: "额度已用尽",
    notice: row.view.resetAt && Number.isFinite(Date.parse(row.view.resetAt)) && Date.parse(row.view.resetAt) > Date.now()
      ? `这位同事的额度已用尽。可换同事，或在 ${new Date(row.view.resetAt).toLocaleString()} 后再试。`
      : "这位同事的额度已用尽。可换同事或稍后再试。",
  };
  return { state: "ok", label: "可用", notice: null };
}
