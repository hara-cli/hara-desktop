export type PetStatus = "idle" | "running" | "waiting" | "paused" | "ready" | "blocked";
export type ActivePetStatus = Exclude<PetStatus, "idle">;

export interface PetActivity {
  sessionId: string;
  status: ActivePetStatus;
  title: string;
  updatedAt: number;
}

export type PetActivities = Record<string, PetActivity>;

export interface PetSnapshot {
  status: PetStatus;
  activity?: PetActivity;
  activityCount: number;
}

/** Package provenance is separate from its selector/path so remote installs can become Hara-local. */
export type PetSource = "builtin" | "hara-local" | "codex-local" | "hara-market";

export interface PetCatalogEntry {
  selector: string;
  id: string;
  displayName: string;
  description: string;
  source: PetSource;
  spriteVersionNumber?: number;
  rows?: number;
  compatible: boolean;
  error?: string;
}

export interface PetAsset {
  dataUrl: string;
  spriteVersionNumber: 1 | 2;
  columns: 8;
  rows: 9 | 11;
  frameWidth: 192;
  frameHeight: 208;
}

export interface PetConfig {
  selector: string;
}

export interface PetChatMessage {
  role: "user" | "assistant" | "notice";
  text: string;
}

export interface PetChatState {
  connected: boolean;
  canSubmit: boolean;
  unavailable?: boolean;
  locale: "zh" | "en";
  sessionId?: string;
  title: string;
  petStatus: PetStatus;
  task?: {
    state: "running" | "waiting" | "paused" | "completed" | "blocked";
    phase: string;
    objective: string;
    detail?: string;
    checkpoint: { done: number; total: number; current?: string; owner?: string };
    approval?: { id: string; question: string };
  };
  messages: PetChatMessage[];
}

export interface PetChatSubmit {
  requestId: string;
  sessionId?: string;
  text: string;
}

export interface PetChatApproval {
  requestId: string;
  sessionId: string;
  approvalId: string;
  allow: boolean;
}

export interface PetChatResult {
  requestId: string;
  ok: boolean;
  sessionId?: string;
  error?: string;
}

export const BUILTIN_HARA_PET: PetCatalogEntry = {
  selector: "builtin:hara",
  id: "hara",
  displayName: "Hara",
  description: "The quiet vermilion companion bundled with Hara Desktop.",
  source: "builtin",
  compatible: true,
};

const MAX_TRACKED_ACTIVITIES = 64;
const STATUS_PRIORITY: Record<ActivePetStatus, number> = {
  waiting: 0,
  blocked: 1,
  paused: 2,
  ready: 3,
  running: 4,
};

/** Keep the renderer's activity model bounded even if a long-running serve emits many session ids. */
export function setPetActivity(
  current: PetActivities,
  sessionId: string,
  status: ActivePetStatus,
  title: string,
  updatedAt = Date.now(),
): PetActivities {
  const next: PetActivities = {
    ...current,
    [sessionId]: { sessionId, status, title: title.trim() || "Hara task", updatedAt },
  };
  const entries = Object.values(next);
  if (entries.length <= MAX_TRACKED_ACTIVITIES) return next;
  entries
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(MAX_TRACKED_ACTIVITIES)
    .forEach((activity) => delete next[activity.sessionId]);
  return next;
}

/** Acknowledging a result clears Ready only. Needs-input, blocked, and paused work remain visible. */
export function acknowledgePetActivity(current: PetActivities, sessionId: string): PetActivities {
  if (current[sessionId]?.status !== "ready") return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
}

export function clearPetActivity(current: PetActivities, sessionId: string): PetActivities {
  if (!current[sessionId]) return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
}

/** Actionable states lead: needs input, blocked, paused, ready, then running; newest wins ties. */
export function selectPetSnapshot(activities: PetActivities): PetSnapshot {
  const ranked = Object.values(activities).sort((a, b) => {
    const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return byStatus || b.updatedAt - a.updatedAt;
  });
  const activity = ranked[0];
  return activity
    ? { status: activity.status, activity, activityCount: ranked.length }
    : { status: "idle", activityCount: 0 };
}
