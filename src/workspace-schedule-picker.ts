export type PickerMode = "once" | "daily" | "weekly" | "interval" | "unsupported";
export interface SchedulePickerValue {
  mode: PickerMode; date: string; time: string; weekdays: number[]; interval: string; intervalUnit: "minutes" | "hours";
  tz: string; original?: { kind: string; expr?: string; everyMs?: number; runAt?: number; display?: string };
}
export interface StoredSchedule { kind: string; expr?: string; everyMs?: number; runAt?: number; display?: string }
const dayMs = 86_400_000;
const formatter = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function validScheduleTz(tz: string): boolean { try { formatter(tz).format(0); return true; } catch { return false; } }
function wallParts(at: number, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(at).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function validWall(date: string, time: string) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d$/.test(time)) return false;
  const iso = `${date}T${time}:00.000Z`, at = Date.parse(iso);
  return Number.isFinite(at) && new Date(at).toISOString() === iso;
}
/** Resolve a wall clock exactly; gaps and repeated DST hours require another user choice. */
export function oneTimeInstant(date: string, time: string, tz: string): number {
  if (!validWall(date, time) || !validScheduleTz(tz)) throw new Error("invalid_time");
  const naive = Date.parse(`${date}T${time}:00.000Z`), matches: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = naive + offset * 60_000;
    const wall = wallParts(candidate, tz);
    if (wall.date === date && wall.time === time) matches.push(candidate);
  }
  // Scan minute precision near real-world non-quarter-hour offsets as well.
  if (!matches.length) for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const candidate = naive + offset * 60_000, wall = wallParts(candidate, tz);
    if (wall.date === date && wall.time === time) matches.push(candidate);
  }
  if (matches.length !== 1) throw new Error(matches.length ? "ambiguous_time" : "nonexistent_time");
  return matches[0];
}
export function emptySchedulePicker(tz = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now()): SchedulePickerValue {
  const local = wallParts(now + 60 * 60_000, tz);
  return { mode: "once", date: local.date, time: local.time, weekdays: [1], interval: "15", intervalUnit: "minutes", tz };
}
export function scheduleToPicker(schedule: StoredSchedule, tz: string): SchedulePickerValue {
  const base = emptySchedulePicker(tz);
  if (schedule.kind === "once" && typeof schedule.runAt === "number" && Number.isFinite(schedule.runAt)) return { ...base, mode: "once", ...wallParts(schedule.runAt, tz) };
  if (schedule.kind === "every" && Number.isSafeInteger(schedule.everyMs) && schedule.everyMs! >= 900_000) {
    const hours = schedule.everyMs! / 3_600_000;
    if (Number.isInteger(hours)) return { ...base, mode: "interval", interval: String(hours), intervalUnit: "hours" };
    const minutes = schedule.everyMs! / 60_000;
    if (Number.isInteger(minutes)) return { ...base, mode: "interval", interval: String(minutes), intervalUnit: "minutes" };
  }
  const cron = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(schedule.expr ?? "");
  if (schedule.kind === "cron" && cron && Number(cron[1]) < 60 && Number(cron[2]) < 24) {
    const time = `${cron[2].padStart(2, "0")}:${cron[1].padStart(2, "0")}`;
    if (cron[3] === "*") return { ...base, mode: "daily", time };
    const weekdays = cron[3].split(",").map(Number);
    if (new Set(weekdays).size === weekdays.length) return { ...base, mode: "weekly", time, weekdays };
  }
  return { ...base, mode: "unsupported", original: schedule };
}
export function pickerToSchedule(value: SchedulePickerValue, now = Date.now()): StoredSchedule {
  if (!validScheduleTz(value.tz)) throw new Error("invalid_timezone");
  if (value.mode === "once") {
    const runAt = oneTimeInstant(value.date, value.time, value.tz);
    if (runAt <= now) throw new Error("past_time");
    return { kind: "once", runAt, display: `at ${new Date(runAt).toISOString()}` };
  }
  if (value.mode === "interval") {
    if (!/^[1-9]\d*$/.test(value.interval)) throw new Error("invalid_interval");
    const everyMs = Number(value.interval) * (value.intervalUnit === "hours" ? 3_600_000 : 60_000);
    if (!Number.isSafeInteger(everyMs) || everyMs < 900_000 || everyMs > 365 * dayMs) throw new Error("invalid_interval");
    return { kind: "every", everyMs, display: `every:${value.interval}${value.intervalUnit === "hours" ? "h" : "m"}` };
  }
  if ((value.mode === "daily" || value.mode === "weekly") && /^\d\d:\d\d$/.test(value.time)) {
    const [hour, minute] = value.time.split(":").map(Number);
    if (hour > 23 || minute > 59) throw new Error("invalid_time");
    if (value.mode === "weekly" && (!value.weekdays.length || value.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(value.weekdays).size !== value.weekdays.length)) throw new Error("invalid_weekdays");
    return { kind: "cron", expr: `${minute} ${hour} * * ${value.mode === "daily" ? "*" : [...value.weekdays].sort((a, b) => a - b).join(",")}` };
  }
  throw new Error("unsupported_schedule");
}
