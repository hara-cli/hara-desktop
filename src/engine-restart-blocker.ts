import type {
  SessionInfo,
  SpaceDirectory,
  TaskLifecycleEvent,
} from "./client";
import { sessionPlace, type SessionPlace } from "./session-place.ts";
import { sessionSpaceId } from "./space-directory.ts";

export type EngineBlockingTaskState = "running" | "waiting" | "stopping";

export interface EngineBlockingTask {
  sessionId: string;
  title: string;
  context: string;
  state: EngineBlockingTaskState;
  statusLabel: string;
  active: boolean;
  updatedAt: string;
}

export interface EngineBlockingTaskLabels {
  personalSpace: string;
  conversation: string;
  project: string;
  automation: string;
  unknownTask: string;
  running: string;
  waiting: string;
  stopping: string;
}

const compactLabel = (value: string | undefined, limit = 120): string =>
  (value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);

const basename = (value: string): string =>
  value.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || value;

const placeLabel = (
  place: SessionPlace | "unknown",
  labels: EngineBlockingTaskLabels,
): string => {
  if (place === "chat") return labels.conversation;
  if (place === "projects") return labels.project;
  if (place === "auto") return labels.automation;
  return labels.unknownTask;
};

/** Preserve task identity when the engine restart interlock is raised. A missing session row can
 * happen briefly during reconnect or Space refresh, so lifecycle state remains a bounded fallback. */
export function collectEngineBlockingTasks(
  busy: Readonly<Record<string, boolean>>,
  sessions: readonly SessionInfo[],
  taskStates: Readonly<Record<string, TaskLifecycleEvent>>,
  directory: SpaceDirectory | null,
  labels: EngineBlockingTaskLabels,
  activeSessionId?: string | null,
): EngineBlockingTask[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  return Object.entries(busy)
    .filter(([, isBusy]) => isBusy)
    .map(([sessionId]): EngineBlockingTask => {
      const session = sessionById.get(sessionId);
      const task = taskStates[sessionId];
      const place = session ? sessionPlace(session) : "unknown";
      const spaceId = session ? sessionSpaceId(session, directory) : "";
      const spaceName = directory?.spaces.find((space) => space.id === spaceId)?.name
        || (spaceId === "personal" ? labels.personalSpace : "");
      const detail = session
        ? place === "projects"
          ? basename(session.cwd)
          : compactLabel(session.sourceName || session.jobId, 64)
        : "";
      const context = [...new Set([
        compactLabel(spaceName, 64),
        placeLabel(place, labels),
        compactLabel(detail, 64),
      ].filter(Boolean))].join(" · ");
      const state: EngineBlockingTaskState = task?.phase === "stopping"
        ? "stopping"
        : task?.state === "waiting"
          ? "waiting"
          : "running";
      const title = compactLabel(session?.title)
        || compactLabel(task?.brief?.goal)
        || compactLabel(task?.objective)
        || `${labels.unknownTask} · ${sessionId.slice(0, 8)}`;

      return {
        sessionId,
        title,
        context,
        state,
        statusLabel: state === "waiting"
          ? labels.waiting
          : state === "stopping"
            ? labels.stopping
            : labels.running,
        active: sessionId === activeSessionId,
        updatedAt: task?.updatedAt || session?.updatedAt || "",
      };
    })
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (left.state !== right.state) {
        if (left.state === "waiting") return -1;
        if (right.state === "waiting") return 1;
      }
      return right.updatedAt.localeCompare(left.updatedAt) || left.sessionId.localeCompare(right.sessionId);
    });
}
