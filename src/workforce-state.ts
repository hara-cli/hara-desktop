import type {
  TaskLifecycleEvent,
  WorkforceActivity,
  WorkforceActorState,
  WorkforceStateEvent,
} from "./client";

export const WORKFORCE_ACTOR_LIMIT = 24;

const WORKFORCE_ACTOR_KINDS = new Set(["root", "subagent", "external"]);
const WORKFORCE_CAPABILITIES = new Set([
  "orchestration",
  "files",
  "code",
  "browser",
  "research",
  "design",
  "office",
  "communication",
  "other",
]);
const WORKFORCE_ACTOR_STATES = new Set([
  "queued",
  "working",
  "waiting",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
const WORKFORCE_ACTIVITIES = new Set([
  "planning",
  "reading",
  "writing",
  "running",
  "reviewing",
  "awaiting_approval",
  "delivering",
  "idle",
]);

function safeWireText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return sanitized || undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  const sanitized = safeWireText(value, 64);
  return sanitized && Number.isFinite(Date.parse(sanitized)) ? sanitized : undefined;
}

function hasOrderedCursor(
  event: WorkforceStateEvent | undefined,
): event is WorkforceStateEvent & { streamId: string; sequence: number } {
  return Boolean(
    event?.streamId
    && Number.isSafeInteger(event.sequence)
    && (event.sequence ?? 0) > 0,
  );
}

export function workforceStateIsNewer(
  current: WorkforceStateEvent | undefined,
  incoming: WorkforceStateEvent,
): boolean {
  if (!hasOrderedCursor(incoming)) return false;
  if (!hasOrderedCursor(current) || current.streamId !== incoming.streamId) return true;
  return incoming.sequence > current.sequence;
}

function rootState(state: TaskLifecycleEvent["state"]): WorkforceActorState {
  return state === "running" ? "working" : state;
}

function rootActivity(event: TaskLifecycleEvent): WorkforceActivity {
  if (event.state === "waiting" || event.phase === "approval") return "awaiting_approval";
  if (event.state === "paused" || event.state === "blocked") return "idle";
  if (event.state === "completed" || event.phase === "responding" || event.phase === "finished") return "delivering";
  if (event.phase === "tool") return "running";
  if (event.phase === "checkpoint") return "reviewing";
  return "planning";
}

/** Compatibility projection for older engines. This is one real root task, not a fabricated team;
 * sub-agent characters appear only after Serve advertises and emits workforce snapshots. */
export function workforceFromTask(
  sessionId: string,
  task: TaskLifecycleEvent | undefined,
): WorkforceStateEvent | undefined {
  if (!task) return undefined;
  return {
    version: 1,
    streamId: task.streamId ? `task:${task.streamId}` : "task-state-compat",
    sequence: task.sequence ?? Math.max(1, Date.parse(task.at) || 1),
    sessionId,
    taskId: task.taskId,
    turnId: task.turnId,
    mode: "snapshot",
    actors: [{
      actorId: `root:${sessionId}`,
      kind: "root",
      role: "orchestrator",
      capability: "orchestration",
      state: rootState(task.state),
      activity: rootActivity(task),
      startedAt: task.at,
      updatedAt: task.at,
      ...(task.state === "completed" || task.state === "blocked" ? { endedAt: task.at } : {}),
    }],
  };
}

/** Bound a hostile or future server payload before it reaches layout and animation code. */
export function boundedWorkforceState(
  event: WorkforceStateEvent | undefined,
): WorkforceStateEvent | undefined {
  if (!event || event.version !== 1 || event.mode !== "snapshot" || !hasOrderedCursor(event)) return undefined;
  const streamId = safeWireText(event.streamId, 128);
  const sessionId = safeWireText(event.sessionId, 256);
  const taskId = safeWireText(event.taskId, 256);
  const turnId = safeWireText(event.turnId, 256);
  if (!streamId || !sessionId || !taskId || !turnId) return undefined;
  const actors = Array.isArray(event.actors)
    ? event.actors
      .filter((actor) => {
        if (!actor || !safeWireText(actor.actorId, 256)) return false;
        if (!WORKFORCE_ACTOR_KINDS.has(actor.kind)) return false;
        if (!WORKFORCE_CAPABILITIES.has(actor.capability)) return false;
        if (!WORKFORCE_ACTOR_STATES.has(actor.state)) return false;
        if (!WORKFORCE_ACTIVITIES.has(actor.activity)) return false;
        return Boolean(safeTimestamp(actor.startedAt) && safeTimestamp(actor.updatedAt));
      })
      .slice(0, WORKFORCE_ACTOR_LIMIT)
      .map((actor) => {
        const actorId = safeWireText(actor.actorId, 256)!;
        const parentActorId = safeWireText(actor.parentActorId, 256);
        const role = typeof actor.role === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(actor.role)
          ? actor.role
          : undefined;
        const startedAt = safeTimestamp(actor.startedAt)!;
        const updatedAt = safeTimestamp(actor.updatedAt)!;
        const endedAt = safeTimestamp(actor.endedAt);
        return {
          actorId,
          ...(parentActorId ? { parentActorId } : {}),
          kind: actor.kind,
          ...(role ? { role } : {}),
          capability: actor.capability,
          state: actor.state,
          activity: actor.activity,
          startedAt,
          updatedAt,
          ...(endedAt ? { endedAt } : {}),
        };
      })
    : [];
  return {
    version: 1,
    streamId,
    sequence: event.sequence,
    sessionId,
    taskId,
    turnId,
    mode: "snapshot",
    actors,
  };
}
