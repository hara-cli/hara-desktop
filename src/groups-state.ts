import type {
  DeskSnapshot,
  DeskTaskDetails,
} from "./client";

export type GroupsLoadPhase = "idle" | "loading" | "ready" | "error";

export interface GroupsSnapshotSlot {
  generation: number;
  phase: GroupsLoadPhase;
  data?: DeskSnapshot;
  error?: string;
}

export interface GroupsTaskSlot {
  generation: number;
  phase: GroupsLoadPhase;
  data?: DeskTaskDetails;
  error?: string;
}

export interface PinnedDeskTask {
  profileId: string;
  taskId: string;
}

export interface GroupsDirectoryProfile {
  profileId: string;
  /** Non-secret identity/binding epoch used only to partition in-memory Desk data. */
  revision: string;
}

export interface GroupsState {
  selectedProfileId?: string;
  revisionsByProfile: Record<string, string>;
  snapshotsByProfile: Record<string, GroupsSnapshotSlot>;
  tasksByKey: Record<string, GroupsTaskSlot>;
  openTask?: PinnedDeskTask;
}

export type GroupsAction =
  | { type: "reset" }
  | { type: "directorySynced"; profiles: GroupsDirectoryProfile[]; preferredProfileId?: string }
  | { type: "selectProfile"; profileId: string }
  | { type: "snapshotStarted"; profileId: string; generation: number }
  | { type: "snapshotSucceeded"; profileId: string; generation: number; data: DeskSnapshot }
  | { type: "snapshotFailed"; profileId: string; generation: number; error: string }
  | { type: "openTask"; profileId: string; taskId: string }
  | { type: "closeTask" }
  | { type: "taskStarted"; profileId: string; taskId: string; generation: number }
  | { type: "taskSucceeded"; profileId: string; taskId: string; generation: number; data: DeskTaskDetails }
  | { type: "taskFailed"; profileId: string; taskId: string; generation: number; error: string }
  | { type: "clearProfile"; profileId: string };

export const initialGroupsState = (): GroupsState => ({
  revisionsByProfile: {},
  snapshotsByProfile: {},
  tasksByKey: {},
});

export const groupsTaskKey = (profileId: string, taskId: string): string =>
  `${profileId}\u0000${taskId}`;

const owns = <T>(record: Record<string, T>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const snapshotSlot = (
  state: GroupsState,
  profileId: string,
): GroupsSnapshotSlot =>
  owns(state.snapshotsByProfile, profileId)
    ? state.snapshotsByProfile[profileId]
    : {
        generation: 0,
        phase: "idle",
      };

const taskSlot = (
  state: GroupsState,
  profileId: string,
  taskId: string,
): GroupsTaskSlot => {
  const key = groupsTaskKey(profileId, taskId);
  return owns(state.tasksByKey, key)
    ? state.tasksByKey[key]
    : {
        generation: 0,
        phase: "idle",
      };
};

export function groupsReducer(state: GroupsState, action: GroupsAction): GroupsState {
  switch (action.type) {
    case "reset":
      return initialGroupsState();
    case "directorySynced": {
      const profileIds = action.profiles.map((profile) => profile.profileId);
      const revisionsByProfile = Object.fromEntries(
        action.profiles.map((profile) => [profile.profileId, profile.revision]),
      );
      const available = new Set(profileIds);
      const revisionUnchanged = (profileId: string): boolean =>
        owns(state.revisionsByProfile, profileId)
        && state.revisionsByProfile[profileId] === revisionsByProfile[profileId];
      const selectedProfileId =
        state.selectedProfileId && available.has(state.selectedProfileId)
          ? state.selectedProfileId
          : action.preferredProfileId && available.has(action.preferredProfileId)
            ? action.preferredProfileId
            : profileIds[0];
      const snapshotsByProfile = Object.fromEntries(
        Object.entries(state.snapshotsByProfile)
          .filter(([profileId]) => revisionUnchanged(profileId)),
      );
      const tasksByKey = Object.fromEntries(
        Object.entries(state.tasksByKey)
          .filter(([key]) => revisionUnchanged(key.split("\u0000", 1)[0])),
      );
      const openTask =
        state.openTask && revisionUnchanged(state.openTask.profileId)
          ? state.openTask
          : undefined;
      return {
        ...state,
        revisionsByProfile,
        snapshotsByProfile,
        tasksByKey,
        openTask,
        ...(selectedProfileId ? { selectedProfileId } : { selectedProfileId: undefined }),
      };
    }
    case "selectProfile":
      return {
        ...state,
        selectedProfileId: action.profileId,
      };
    case "snapshotStarted": {
      const current = snapshotSlot(state, action.profileId);
      return {
        ...state,
        snapshotsByProfile: {
          ...state.snapshotsByProfile,
          [action.profileId]: {
            ...current,
            generation: action.generation,
            phase: "loading",
            error: undefined,
          },
        },
      };
    }
    case "snapshotSucceeded": {
      const current = snapshotSlot(state, action.profileId);
      if (current.generation !== action.generation || action.data.profileId !== action.profileId) {
        return state;
      }
      return {
        ...state,
        snapshotsByProfile: {
          ...state.snapshotsByProfile,
          [action.profileId]: {
            generation: action.generation,
            phase: "ready",
            data: action.data,
          },
        },
      };
    }
    case "snapshotFailed": {
      const current = snapshotSlot(state, action.profileId);
      if (current.generation !== action.generation) return state;
      return {
        ...state,
        snapshotsByProfile: {
          ...state.snapshotsByProfile,
          [action.profileId]: {
            generation: action.generation,
            phase: "error",
            error: action.error,
          },
        },
      };
    }
    case "openTask":
      return {
        ...state,
        openTask: {
          profileId: action.profileId,
          taskId: action.taskId,
        },
      };
    case "closeTask":
      return {
        ...state,
        openTask: undefined,
      };
    case "taskStarted": {
      const key = groupsTaskKey(action.profileId, action.taskId);
      const current = taskSlot(state, action.profileId, action.taskId);
      return {
        ...state,
        tasksByKey: {
          ...state.tasksByKey,
          [key]: {
            ...current,
            generation: action.generation,
            phase: "loading",
            error: undefined,
          },
        },
      };
    }
    case "taskSucceeded": {
      const key = groupsTaskKey(action.profileId, action.taskId);
      const current = taskSlot(state, action.profileId, action.taskId);
      if (
        current.generation !== action.generation
        || action.data.profileId !== action.profileId
        || action.data.task.id !== action.taskId
      ) {
        return state;
      }
      return {
        ...state,
        tasksByKey: {
          ...state.tasksByKey,
          [key]: {
            generation: action.generation,
            phase: "ready",
            data: action.data,
          },
        },
      };
    }
    case "taskFailed": {
      const key = groupsTaskKey(action.profileId, action.taskId);
      const current = taskSlot(state, action.profileId, action.taskId);
      if (current.generation !== action.generation) return state;
      return {
        ...state,
        tasksByKey: {
          ...state.tasksByKey,
          [key]: {
            generation: action.generation,
            phase: "error",
            error: action.error,
          },
        },
      };
    }
    case "clearProfile": {
      const snapshotsByProfile = { ...state.snapshotsByProfile };
      delete snapshotsByProfile[action.profileId];
      const tasksByKey: Record<string, GroupsTaskSlot> = {};
      for (const [key, value] of Object.entries(state.tasksByKey)) {
        if (!key.startsWith(`${action.profileId}\u0000`)) tasksByKey[key] = value;
      }
      return {
        ...state,
        snapshotsByProfile,
        tasksByKey,
        ...(state.selectedProfileId === action.profileId ? { selectedProfileId: undefined } : {}),
        ...(state.openTask?.profileId === action.profileId ? { openTask: undefined } : {}),
      };
    }
  }
}
