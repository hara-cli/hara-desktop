export type PetStatus = "idle" | "running" | "waiting" | "paused" | "ready" | "blocked";
export type ActivePetStatus = Exclude<PetStatus, "idle">;

export interface PetActivity {
  sessionId: string;
  status: ActivePetStatus;
  title: string;
  updatedAt: number;
  expiresAt?: number;
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

export interface OfficialPet extends PetCatalogEntry {
  source: "builtin";
  displayNameZh: string;
  descriptionZh: string;
  role: string;
  roleZh: string;
  accent: string;
  imageUrl: string;
  spritesheetUrl: string;
  spriteVersionNumber: 2;
  rows: 11;
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

export interface LogicalScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keep a fixed-size transparent companion window wholly inside the selected display. */
export function clampPetWindowPosition(
  x: number,
  y: number,
  screen: LogicalScreenBounds,
  windowWidth: number,
  windowHeight: number,
  margin = 12,
): { x: number; y: number } {
  const minX = screen.left + margin;
  const minY = screen.top + margin;
  const maxX = Math.max(minX, screen.left + screen.width - windowWidth - margin);
  const maxY = Math.max(minY, screen.top + screen.height - windowHeight - margin);
  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, maxY))),
  };
}

export const BUILTIN_HARA_PET: OfficialPet = {
  selector: "builtin:hara",
  id: "hara-core",
  displayName: "Hara Core",
  displayNameZh: "小哈 · 核心",
  description: "The canonical Hara companion for general work.",
  descriptionZh: "负责通用任务与日常陪伴的 Hara 核心角色。",
  role: "General",
  roleZh: "通用",
  accent: "#ff655c",
  imageUrl: "/pets/hara-official/hara-core.png",
  spritesheetUrl: "/pets/hara-official/hara-v2.webp",
  spriteVersionNumber: 2,
  rows: 11,
  source: "builtin",
  compatible: true,
};

export const BUILTIN_HARA_ASSET: PetAsset = {
  dataUrl: BUILTIN_HARA_PET.spritesheetUrl,
  spriteVersionNumber: 2,
  columns: 8,
  rows: 11,
  frameWidth: 192,
  frameHeight: 208,
};

/** One deliberate public identity. Capability and task differences belong in motion and props. */
export const OFFICIAL_HARA_PETS: readonly OfficialPet[] = [BUILTIN_HARA_PET] as const;

/** Older builds persisted these selectors. Keep them as migration aliases instead of breaking upgrades.
 *  `codex:hara` was the locally installed staging package used while the official v2 atlas was being
 *  reviewed; released Desktop builds must now converge that one known identity onto the embedded asset.
 */
const LEGACY_OFFICIAL_PET_SELECTORS = new Set([
  "codex:hara",
  "builtin:hara-forge",
  "builtin:hara-muse",
  "builtin:hara-scout",
  "builtin:hara-ledger",
  "builtin:hara-story",
  "builtin:hara-stage",
  "builtin:hara-flow",
  "builtin:hara-shield",
  "builtin:hara-link",
  "builtin:hara-cozy",
]);

const OFFICIAL_PET_BY_SELECTOR = new Map(
  OFFICIAL_HARA_PETS.map((pet) => [pet.selector, pet]),
);

export function officialPetForSelector(selector: string): OfficialPet | undefined {
  return OFFICIAL_PET_BY_SELECTOR.get(canonicalPetSelector(selector));
}

export function canonicalPetSelector(selector: string): string {
  return LEGACY_OFFICIAL_PET_SELECTORS.has(selector) ? BUILTIN_HARA_PET.selector : selector;
}

export function officialPetCopy(
  pet: OfficialPet,
  locale: "en" | "zh",
): { displayName: string; description: string; role: string } {
  return locale === "zh"
    ? { displayName: pet.displayNameZh, description: pet.descriptionZh, role: pet.roleZh }
    : { displayName: pet.displayName, description: pet.description, role: pet.role };
}

const MAX_TRACKED_ACTIVITIES = 64;
export const READY_ACTIVITY_TTL_MS = 8_000;
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
  const activity: PetActivity = {
    sessionId,
    status,
    title: title.trim() || "Hara task",
    updatedAt,
    ...(status === "ready" ? { expiresAt: updatedAt + READY_ACTIVITY_TTL_MS } : {}),
  };
  const next: PetActivities = { ...current, [sessionId]: activity };
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

export function pruneExpiredPetActivities(
  current: PetActivities,
  now = Date.now(),
): PetActivities {
  const expired = Object.values(current).filter(
    (activity) => activity.expiresAt !== undefined && activity.expiresAt <= now,
  );
  if (expired.length === 0) return current;
  const next = { ...current };
  expired.forEach((activity) => delete next[activity.sessionId]);
  return next;
}

export function nextPetActivityExpiry(current: PetActivities): number | undefined {
  const expiries = Object.values(current)
    .map((activity) => activity.expiresAt)
    .filter((expiresAt): expiresAt is number => expiresAt !== undefined);
  return expiries.length > 0 ? Math.min(...expiries) : undefined;
}

/** Actionable states lead: needs input, blocked, paused, ready, then running; newest wins ties. */
export function selectPetSnapshot(activities: PetActivities, now = Date.now()): PetSnapshot {
  const ranked = Object.values(activities).filter(
    (activity) => activity.expiresAt === undefined || activity.expiresAt > now,
  ).sort((a, b) => {
    const byStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    return byStatus || b.updatedAt - a.updatedAt;
  });
  const activity = ranked[0];
  return activity
    ? { status: activity.status, activity, activityCount: ranked.length }
    : { status: "idle", activityCount: 0 };
}
