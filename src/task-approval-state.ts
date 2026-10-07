import type { PendingSessionApproval, TaskApprovalState, TaskApprovalToolFamily } from "./client";
import type { ConversationItem } from "./ConversationTimeline";

const TOOL_FAMILIES: TaskApprovalToolFamily[] = ["bash", "python", "file-change"];
export const TASK_APPROVAL_MAX_DURATION = 15 * 60 * 1000;
export const TASK_APPROVAL_STATE_LIMIT = 128;
export const inactiveTaskApprovalState = (): TaskApprovalState => ({ active: false, toolFamilies: [], canRevoke: false });

export function offeredTaskApproval(
  approval: Partial<PendingSessionApproval>, supported: boolean, now = Date.now(),
): boolean {
  const offer = approval.taskApproval;
  return supported && approval.allowForTask === true && !approval.presentation
    && typeof approval.expiresAt === "string" && Date.parse(approval.expiresAt) > now
    && !!offer && typeof offer.summary === "string" && offer.summary.trim().length > 0
    && offer.summary.length <= 4000 && TOOL_FAMILIES.includes(offer.toolFamily)
    && Number.isFinite(offer.durationMs) && offer.durationMs > 0 && offer.durationMs <= TASK_APPROVAL_MAX_DURATION;
}

export function approvalRequestExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  return expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now);
}

export function validTaskApprovalState(value: TaskApprovalState | undefined): value is TaskApprovalState {
  if (!value || typeof value.active !== "boolean" || typeof value.canRevoke !== "boolean"
    || !Array.isArray(value.toolFamilies) || value.toolFamilies.length > TOOL_FAMILIES.length
    || value.toolFamilies.some((family) => !TOOL_FAMILIES.includes(family))
    || new Set(value.toolFamilies).size !== value.toolFamilies.length) return false;
  return !value.active || (typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) && value.toolFamilies.length > 0);
}

export function normalizeTaskApprovalState(value: TaskApprovalState | undefined): TaskApprovalState {
  if (!validTaskApprovalState(value)) return inactiveTaskApprovalState();
  if (!value.active) return inactiveTaskApprovalState();
  return { active: true, toolFamilies: [...value.toolFamilies], expiresAt: value.expiresAt, canRevoke: value.canRevoke };
}

export function taskApprovalActive(value: TaskApprovalState | undefined): boolean {
  const state = normalizeTaskApprovalState(value);
  // The Engine owns grant lifetime using its monotonic clock. A client clock jump cannot
  // revoke that grant, nor should it hide the human's explicit revoke affordance.
  return state.active;
}

export function taskApprovalEstimatedExpired(value: TaskApprovalState, now = Date.now()): boolean {
  return taskApprovalActive(value) && Date.parse(value.expiresAt!) <= now;
}

export function taskApprovalStateForSession(
  states: Record<string, TaskApprovalState>, sessionId: string | null | undefined,
  supported: boolean,
): TaskApprovalState | undefined {
  if (!supported || !sessionId || !Object.prototype.hasOwnProperty.call(states, sessionId)) return undefined;
  const state = normalizeTaskApprovalState(states[sessionId]);
  return taskApprovalActive(state) ? state : undefined;
}

export function restoreTaskApprovalStates(
  snapshot: Array<{ sessionId: string } & TaskApprovalState> | undefined,
): Record<string, TaskApprovalState> {
  const states: Record<string, TaskApprovalState> = {};
  for (const entry of Array.isArray(snapshot) ? snapshot : []) {
    if (!entry || typeof entry.sessionId !== "string" || !entry.sessionId || ["__proto__", "prototype", "constructor"].includes(entry.sessionId)) continue;
    const state = normalizeTaskApprovalState(entry);
    if (state.active) states[entry.sessionId] = state;
  }
  return Object.fromEntries(Object.entries(states).slice(-TASK_APPROVAL_STATE_LIMIT));
}

export function projectTaskApprovalState(
  current: Record<string, TaskApprovalState>, sessionId: string, state: TaskApprovalState | undefined,
): Record<string, TaskApprovalState> {
  if (typeof sessionId !== "string" || !sessionId || ["__proto__", "prototype", "constructor"].includes(sessionId)) return current;
  const next = normalizeTaskApprovalState(state);
  const previous = current[sessionId];
  if (!next.active) {
    if (!Object.prototype.hasOwnProperty.call(current, sessionId)) return current;
    const remaining = { ...current };
    delete remaining[sessionId];
    return remaining;
  }
  if (previous && previous.active === next.active && previous.canRevoke === next.canRevoke
    && previous.expiresAt === next.expiresAt && previous.toolFamilies.join(",") === next.toolFamilies.join(",")) return current;
  return Object.fromEntries(Object.entries({ ...current, [sessionId]: next }).slice(-TASK_APPROVAL_STATE_LIMIT));
}

export function terminalTaskApprovalState(current: Record<string, TaskApprovalState>, sessionId: string): Record<string, TaskApprovalState> {
  return projectTaskApprovalState(current, sessionId, inactiveTaskApprovalState());
}

/** A delayed RPC response may not overwrite a newer event or terminal-state projection. */
export function projectTaskApprovalReceipt(
  current: Record<string, TaskApprovalState>, sessionId: string, state: TaskApprovalState | undefined,
  submittedRevision: number, currentRevision: number,
): Record<string, TaskApprovalState> {
  return submittedRevision === currentRevision && validTaskApprovalState(state) ? projectTaskApprovalState(current, sessionId, state) : current;
}

/** Per-session event epochs keep unrelated Agent events from discarding a valid server receipt. */
export function createTaskApprovalRevisionClock() {
  let serial = 0;
  const sessions = new Map<string, number>();
  const bound = (sessionId: string, revision: number) => {
    sessions.delete(sessionId);
    sessions.set(sessionId, revision);
    while (sessions.size > TASK_APPROVAL_STATE_LIMIT) sessions.delete(sessions.keys().next().value!);
  };
  return {
    capture(sessionId: string): number {
      const revision = sessions.get(sessionId) ?? serial;
      bound(sessionId, revision);
      return revision;
    },
    current: (sessionId: string) => sessions.get(sessionId) ?? serial,
    advance(sessionId?: string): void {
      serial += 1;
      if (sessionId) bound(sessionId, serial);
      else sessions.clear();
    },
  };
}

export function approvalDockMode(preferred: "docked" | "maximized", items: ConversationItem[], now = Date.now()): "docked" | "maximized" {
  return items.some((item) => item.kind === "approval" && !item.answered && !approvalRequestExpired(item.expiresAt, now)) ? "docked" : preferred;
}

/** Receipt retries use the original intent ID; a rejected or conflicting choice grants nothing locally. */
export function createTaskApprovalSubmission(newId: () => string, previousCommandId?: string) {
  let commandId = previousCommandId;
  let locked = false;
  let settled = false;
  return {
    isLocked: () => locked || settled,
    hasAttempted: () => commandId !== undefined,
    canChoose: (verdict: string) => commandId === undefined || verdict === "task",
    async submit(send: (commandId: string) => Promise<void>): Promise<boolean> {
      if (locked || settled) return false;
      locked = true;
      commandId ??= newId();
      try { await send(commandId); settled = true; return true; }
      finally { locked = false; }
    },
  };
}
