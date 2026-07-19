import type { TaskLifecycleEvent } from "./client";
import type { ActivePetStatus } from "./pets";

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

export function taskStateIsLive(state: TaskLifecycleEvent["state"]): boolean {
  return state === "running" || state === "waiting";
}

export function taskStatePetStatus(
  state: TaskLifecycleEvent["state"],
): ActivePetStatus {
  return state === "completed" ? "ready" : state;
}

export function taskStateTitle(event: TaskLifecycleEvent): string {
  // This string is rendered in a non-focused, always-on-top window. Never derive it from
  // objective/brief/checkpoint/detail: those fields may contain credentials, customer text,
  // absolute paths, command output, or file contents.
  if (event.state === "completed") return "Task complete";
  if (event.state === "blocked") return "Task needs attention";
  if (event.state === "paused") return "Task paused safely";
  const safePhaseTitles: Record<TaskLifecycleEvent["phase"], string> = {
    restored: "Restoring task state",
    starting: "Starting task",
    thinking: "Planning the next step",
    responding: "Preparing a response",
    tool: "Working on the task",
    approval: "Approval required",
    checkpoint: "Saving progress",
    steering: "Applying your update",
    stopping: "Stopping safely",
    finished: "Finishing task",
  };
  return safePhaseTitles[event.phase];
}
