import type { WorkspaceDevSnapshot } from "./workspace-dev-state";
import { formatMessage, type Locale } from "./i18n-runtime.ts";

type AccountUsage = NonNullable<WorkspaceDevSnapshot["accountUsage"]>[number];

/**
 * A view projection only. Missing or stale account data is never displayed as available.
 *
 * Before B1 this module was Simplified-only, so English users saw 用量暂不可查 / 额度已用尽
 * (audit §1.1, P0). Every string now comes from `ws.usage.*`; the reset time is formatted
 * with the caller's locale instead of the device default, which used to put English dates
 * inside Chinese sentences (audit §5).
 */
export function colleagueUsageView(
  row: AccountUsage | undefined,
  locale: Locale = "en",
): { state: "ok" | "limit_reached" | "parse_unavailable"; label: string; notice: string | null } {
  if (!row?.view.fresh || row.state === "parse_unavailable") return {
    state: "parse_unavailable", label: formatMessage(locale, "ws.usage.unavailable"), notice: null,
  };
  if (row.state === "limit_reached") {
    const resetAt = row.view.resetAt;
    const resets = resetAt && Number.isFinite(Date.parse(resetAt)) && Date.parse(resetAt) > Date.now()
      ? new Date(resetAt).toLocaleString(locale)
      : null;
    return {
      state: "limit_reached",
      label: formatMessage(locale, "ws.usage.limitReached"),
      notice: resets
        ? formatMessage(locale, "ws.usage.limitNoticeReset", { time: resets })
        : formatMessage(locale, "ws.usage.limitNotice"),
    };
  }
  return { state: "ok", label: formatMessage(locale, "ws.usage.ok"), notice: null };
}
