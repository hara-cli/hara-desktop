import { scheduleToPicker, type StoredSchedule } from "./workspace-schedule-picker.ts";
import type { Key } from "./i18n.ts";

type T = (key: Key, values?: Record<string, string | number>) => string;

/**
 * Human wording for a stored schedule in its own time zone («每个工作日 09:00», «Every 2 h»).
 * Falls back to the stored expression when it cannot be represented by the picker, so nothing is hidden.
 * Display only: saving still goes through pickerToSchedule and the existing RPC.
 */
export function scheduleHumanText(schedule: StoredSchedule, tz: string, t: T, localTz = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const value = scheduleToPicker(schedule, tz);
  const zone = tz && tz !== localTz ? ` (${tz})` : "";
  if (value.mode === "once") return t("ws.schedules.human.once", { date: value.date, time: value.time }) + zone;
  if (value.mode === "daily") return t("ws.schedules.human.daily", { time: value.time }) + zone;
  if (value.mode === "weekly") {
    const days = [...value.weekdays].sort((a, b) => a - b);
    if (days.join(",") === "1,2,3,4,5") return t("ws.schedules.human.weekdays", { time: value.time }) + zone;
    return t("ws.schedules.human.weekly", { days: days.map(day => t(`ws.schedules.weekday.${day}` as Key)).join(t("ws.settings.listSeparator")), time: value.time }) + zone;
  }
  if (value.mode === "interval") return t(value.intervalUnit === "hours" ? "ws.schedules.human.hours" : "ws.schedules.human.minutes", { n: value.interval });
  return schedule.expr ?? schedule.display ?? "—";
}
