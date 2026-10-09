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

/** An older terminal event cannot clear a newer turn's busy/approval state or replay its reply.
 * Legacy engines without wire turn IDs retain their existing terminal handling. */
export function terminalTurnIsCurrent(
  current: TaskLifecycleEvent | undefined,
  turnId: string | undefined,
  activeTurnId: string | undefined,
): boolean {
  if (!turnId) return true;
  if (activeTurnId) return turnId === activeTurnId;
  return !current || current.turnId === turnId;
}

/** A paused logical turn is not a failed business task. Typed terminal checkpoints remain the
 * authority; this classification is used only when their final event did not reach the renderer. */
export function terminalTaskState(
  error: string | undefined,
  status: string | undefined,
  interrupted = false,
): "paused" | "completed" | "blocked" {
  if (interrupted) return "paused";
  if (error) return "blocked";
  if (status === "paused") return "paused";
  return status && status !== "completed" ? "blocked" : "completed";
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
