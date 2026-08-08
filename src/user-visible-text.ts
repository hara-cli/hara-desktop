export const ACTIVE_WORK_OBJECT_HISTORY_PREFIX = "[HARA_DESKTOP_ACTIVE_WORK_OBJECT";
export const STEERING_HISTORY_PREFIX = "[Sent while you were working on the above — TRIAGE before continuing:";

const INTERNAL_PREFIXES = [
  ACTIVE_WORK_OBJECT_HISTORY_PREFIX,
  STEERING_HISTORY_PREFIX,
] as const;

/** Renderer-authored routing envelopes belong to the model wire protocol, never to visible task
 * progress, transcript history, notifications, pets, or accessibility labels. */
export function userVisibleText(text: unknown): string {
  let visible = typeof text === "string" ? text : "";
  for (let depth = 0; depth < 4; depth += 1) {
    if (!INTERNAL_PREFIXES.some((prefix) => visible.startsWith(prefix))) break;
    const boundary = visible.indexOf("]\n\n");
    if (boundary < 0) return "";
    visible = visible.slice(boundary + 3);
  }
  return visible;
}

export function userVisibleTaskText(text: unknown, fallback: string): string {
  const visible = userVisibleText(text).trim();
  return visible || fallback;
}
