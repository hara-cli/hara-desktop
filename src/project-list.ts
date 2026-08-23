import type { SessionInfo } from "./client.ts";
import { isAssistantWorkspace } from "./session-place.ts";

export const OPENED_PROJECTS_STORAGE_KEY = "hara.workspaces";
export const HIDDEN_PROJECTS_STORAGE_KEY = "hara.hiddenWorkspaces";

export type ProjectListState = {
  /** Navigation preferences are audience-scoped because paths can reveal company/project identity. */
  spaceId?: string;
  opened: string[];
  hidden: string[];
};

const uniqueProjectPaths = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
};

export const parseProjectPaths = (serialized: string | null): string[] => {
  if (!serialized) return [];
  try {
    return uniqueProjectPaths(JSON.parse(serialized));
  } catch {
    return [];
  }
};

export const projectListStateFromStorage = (
  opened: string | null,
  hidden: string | null,
  spaceId?: string,
): ProjectListState => ({
  ...(spaceId ? { spaceId } : {}),
  opened: parseProjectPaths(opened),
  hidden: parseProjectPaths(hidden),
});

export const projectListStorageKey = (base: string, spaceId: string): string =>
  `${base}.space.${encodeURIComponent(spaceId)}`;

/** Read only the selected Space. Legacy global preferences are migrated as Personal and are never
 * shown in a company Space. */
export const projectListStateForSpace = (
  spaceId: string,
  read: (key: string) => string | null,
): ProjectListState => {
  const opened = read(projectListStorageKey(OPENED_PROJECTS_STORAGE_KEY, spaceId));
  const hidden = read(projectListStorageKey(HIDDEN_PROJECTS_STORAGE_KEY, spaceId));
  return projectListStateFromStorage(
    opened ?? (spaceId === "personal" ? read(OPENED_PROJECTS_STORAGE_KEY) : null),
    hidden ?? (spaceId === "personal" ? read(HIDDEN_PROJECTS_STORAGE_KEY) : null),
    spaceId,
  );
};

export const persistProjectListState = (
  state: ProjectListState,
  spaceId: string,
  write: (key: string, value: string) => void,
): void => {
  write(projectListStorageKey(OPENED_PROJECTS_STORAGE_KEY, spaceId), JSON.stringify(state.opened));
  write(projectListStorageKey(HIDDEN_PROJECTS_STORAGE_KEY, spaceId), JSON.stringify(state.hidden));
};

/**
 * Hiding a project only changes Desktop navigation. Its sessions and filesystem directory remain
 * untouched, and explicitly opening the same directory makes it visible again.
 */
export const setProjectVisible = (
  current: ProjectListState,
  directory: string,
  visible: boolean,
): ProjectListState => {
  const withoutDirectory = (paths: string[]): string[] => paths.filter((path) => path !== directory);
  return visible
    ? {
        ...(current.spaceId ? { spaceId: current.spaceId } : {}),
        opened: [...withoutDirectory(current.opened), directory],
        hidden: withoutDirectory(current.hidden),
      }
    : {
        ...(current.spaceId ? { spaceId: current.spaceId } : {}),
        opened: withoutDirectory(current.opened),
        hidden: [...withoutDirectory(current.hidden), directory],
      };
};

export const isJunkProjectDirectory = (cwd: string): boolean =>
  /^\/(private\/)?(tmp|var\/folders)\//.test(cwd)
  || /[/\\]tmp\.[A-Za-z0-9]+([/\\]|$)/.test(cwd)
  || /[/\\]hara-(test|dbg|serve)-[^/\\]*([/\\]|$)/.test(cwd);

/** Project groups (manual sessions only): opened-but-empty projects first, then by latest activity. */
export function projectGroups(
  sessions: SessionInfo[],
  state: ProjectListState,
): [string, SessionInfo[]][] {
  const hidden = new Set(state.hidden);
  const map = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (
      hidden.has(session.cwd)
      || isAssistantWorkspace(session.cwd)
      || session.source === "cron"
      || session.source === "gateway"
      || isJunkProjectDirectory(session.cwd)
    ) continue;
    map.set(session.cwd, [...(map.get(session.cwd) ?? []), session]);
  }
  const latest = (list: SessionInfo[]): string =>
    list.reduce((mostRecent, session) => session.updatedAt > mostRecent ? session.updatedAt : mostRecent, "");
  const withSessions = [...map.entries()].sort((left, right) => latest(right[1]).localeCompare(latest(left[1])));
  const empty: [string, SessionInfo[]][] = [...state.opened]
    .reverse()
    .filter((directory) => (
      !hidden.has(directory)
      && !map.has(directory)
      && !isAssistantWorkspace(directory)
      && !isJunkProjectDirectory(directory)
    ))
    .map((directory) => [directory, []]);
  return [...empty, ...withSessions];
}
