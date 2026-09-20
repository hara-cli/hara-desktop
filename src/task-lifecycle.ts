import type { TaskLifecycleEvent } from "./client";

export interface ResumedTaskSnapshot {
  id: string;
  objective: string;
  status: TaskLifecycleEvent["taskStatus"];
  turnId: string;
  updatedAt: string;
}

/** Older serve versions return durable task state from session.resume but do not emit typed events. */
export function restoredTaskLifecycle(
  sessionId: string,
  task: ResumedTaskSnapshot,
): TaskLifecycleEvent {
  return {
    version: 1,
    sessionId,
    taskId: task.id,
    turnId: task.turnId,
    objective: task.objective,
    state: task.status,
    taskStatus: task.status,
    phase: "restored",
    at: task.updatedAt,
    updatedAt: task.updatedAt,
    checkpoint: { done: 0, total: 0 },
  };
}

function hasOrderedCursor(
  event: TaskLifecycleEvent | undefined,
): event is TaskLifecycleEvent & { streamId: string; sequence: number } {
  return Boolean(
    event?.streamId &&
    Number.isSafeInteger(event.sequence) &&
    (event.sequence ?? 0) > 0,
  );
}

/** Reject duplicated or stale task state from the same server stream. Legacy engines and a newly
 * restarted server remain compatible because they do not share a comparable ordered cursor. */
export function taskLifecycleIsNewer(
  current: TaskLifecycleEvent | undefined,
  incoming: TaskLifecycleEvent,
): boolean {
  if (!hasOrderedCursor(current) || !hasOrderedCursor(incoming)) return true;
  if (current.streamId !== incoming.streamId) return true;
  return incoming.sequence > current.sequence;
}

export function taskStateIsLive(state: TaskLifecycleEvent["state"]): boolean {
  return state === "running" || state === "waiting";
}

export function terminalTaskLifecycleFallback(
  current: TaskLifecycleEvent | undefined,
  turnId: string | undefined,
  state: "paused" | "completed" | "blocked",
  updatedAt: string,
): TaskLifecycleEvent | undefined {
  if (!current || !turnId || current.turnId !== turnId || !taskStateIsLive(current.state)) {
    return undefined;
  }
  const { approval: _approval, ...rest } = current;
  return {
    ...rest,
    state,
    taskStatus: state,
    phase: "finished",
    at: updatedAt,
    updatedAt,
    lastOutcome: state === "completed" ? "completed" : state === "paused" ? "interrupted" : "error",
  };
}
