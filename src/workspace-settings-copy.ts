import type { Key, makeT } from "./i18n";
import { WORKSPACE_KEYS, WORKSPACE_EXTRA_KEYS } from "./workspace-i18n.ts";

const runtimeLabels: Record<string, Key> = {
  downloading: "ws.runtimes.downloading", registered: "ws.runtimes.installed",
  failed: "ws.runtimes.failed", cancelled: "ws.runtimes.cancelled",
};
const stateLabels: Record<string, Key> = {
  running: "ws.tasks.status.running", completed: "ws.tasks.status.completed",
  blocked: "ws.tasks.status.blocked", interrupted: "ws.schedules.interrupted",
  failed: "ws.schedules.failed", cancelled: "ws.schedules.cancelled",
  skipped: "ws.schedules.skipped", accepted: "ws.schedules.accepted",
};
const messageKeys = new Set<string>([...WORKSPACE_KEYS, ...WORKSPACE_EXTRA_KEYS].map(row => row[0]));

/** Unknown protocol states stay visible for diagnosis; content supplied by users is never translated. */
export function settingsStateText(t: ReturnType<typeof makeT>, state: string): string {
  const key = Object.prototype.hasOwnProperty.call(stateLabels, state) ? stateLabels[state] : undefined;
  return key ? t(key) : state;
}

export function runtimeOperationText(t: ReturnType<typeof makeT>, state: string): string {
  const key = Object.prototype.hasOwnProperty.call(runtimeLabels, state) ? runtimeLabels[state] : undefined;
  return key ? t(key) : state;
}

/** Fixed controller messages stay as keys, so changing locale also changes an existing notice. */
export function workspaceMessageText(t: ReturnType<typeof makeT>, message: string): string {
  return messageKeys.has(message) ? t(message as Key) : message;
}
