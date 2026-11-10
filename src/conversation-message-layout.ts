import { rosterShortRole } from "./workspace-roster.ts";

const HALF_HOUR = 30 * 60 * 1000;
function time(value?: string): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}
/** Missing and out-of-order timestamps do not imply an elapsed interval. */
export function messageTimeSeparator(current?: string, previous?: string): boolean {
  const after = time(current), before = time(previous);
  return after !== null && (before === null || after - before >= HALF_HOUR);
}
export function messageTimeLabel(value: string, locale: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const clock = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day.getTime() === today.getTime()) return clock;
  if (day.getTime() === yesterday.getTime()) return `${locale.startsWith("zh") ? "昨天" : "Yesterday"} ${clock}`;
  return `${date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })} ${clock}`;
}
export function messageShortRole(identity?: { title?: string; shortTitle?: string }): string {
  return rosterShortRole(identity?.title ?? "", identity?.shortTitle);
}
