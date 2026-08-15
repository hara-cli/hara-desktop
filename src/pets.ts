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

export interface OfficialPet extends PetCatalogEntry {
  source: "builtin";
  displayNameZh: string;
  descriptionZh: string;
  role: string;
  roleZh: string;
  accent: string;
  imageUrl: string;
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
  source: "builtin",
  compatible: true,
};

export const OFFICIAL_HARA_PETS: readonly OfficialPet[] = [
  BUILTIN_HARA_PET,
  {
    selector: "builtin:hara-forge",
    id: "hara-forge",
    displayName: "Hara Forge",
    displayNameZh: "造造 · 开发",
    description: "A focused builder for code, tooling, and delivery work.",
    descriptionZh: "专注代码、工具与交付工作的开发伙伴。",
    role: "Development",
    roleZh: "开发",
    accent: "#f3a83b",
    imageUrl: "/pets/hara-official/hara-forge.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-muse",
    id: "hara-muse",
    displayName: "Hara Muse",
    displayNameZh: "灵灵 · 设计",
    description: "A visual and product-design companion with a sharp eye for detail.",
    descriptionZh: "关注产品体验与视觉细节的设计伙伴。",
    role: "Design",
    roleZh: "设计",
    accent: "#9b6de3",
    imageUrl: "/pets/hara-official/hara-muse.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-scout",
    id: "hara-scout",
    displayName: "Hara Scout",
    displayNameZh: "探探 · 研究",
    description: "A curious researcher for search, evidence, and synthesis.",
    descriptionZh: "负责搜索、证据整理与综合分析的研究伙伴。",
    role: "Research",
    roleZh: "研究",
    accent: "#63b9ee",
    imageUrl: "/pets/hara-official/hara-scout.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-ledger",
    id: "hara-ledger",
    displayName: "Hara Ledger",
    displayNameZh: "数数 · 数据",
    description: "A precise companion for tables, analysis, and charts.",
    descriptionZh: "处理表格、分析与图表的精确数据伙伴。",
    role: "Data",
    roleZh: "数据",
    accent: "#3aa9b8",
    imageUrl: "/pets/hara-official/hara-ledger.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-story",
    id: "hara-story",
    displayName: "Hara Story",
    displayNameZh: "文文 · 文档",
    description: "A thoughtful writing partner for documents and structured prose.",
    descriptionZh: "负责文档与结构化写作的细致伙伴。",
    role: "Documents",
    roleZh: "文档",
    accent: "#ead9bd",
    imageUrl: "/pets/hara-official/hara-story.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-stage",
    id: "hara-stage",
    displayName: "Hara Stage",
    displayNameZh: "演演 · 演示",
    description: "A confident storyteller for presentations and visual narratives.",
    descriptionZh: "负责演示文稿与视觉叙事的表达伙伴。",
    role: "Presentations",
    roleZh: "演示",
    accent: "#6674d9",
    imageUrl: "/pets/hara-official/hara-stage.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-flow",
    id: "hara-flow",
    displayName: "Hara Flow",
    displayNameZh: "流流 · 自动化",
    description: "An operations companion for workflows, routines, and repeatable work.",
    descriptionZh: "负责工作流、例行任务与自动化执行的伙伴。",
    role: "Automation",
    roleZh: "自动化",
    accent: "#3287e8",
    imageUrl: "/pets/hara-official/hara-flow.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-shield",
    id: "hara-shield",
    displayName: "Hara Shield",
    displayNameZh: "守守 · 审核",
    description: "A careful guardian for review, safety, and release checks.",
    descriptionZh: "负责审核、安全与发布检查的守护伙伴。",
    role: "Review",
    roleZh: "审核",
    accent: "#8d98a7",
    imageUrl: "/pets/hara-official/hara-shield.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-link",
    id: "hara-link",
    displayName: "Hara Link",
    displayNameZh: "联联 · 连接",
    description: "A connected companion for apps, messages, and integrations.",
    descriptionZh: "负责应用、消息与服务连接的协作伙伴。",
    role: "Connections",
    roleZh: "连接",
    accent: "#466fd0",
    imageUrl: "/pets/hara-official/hara-link.png",
    source: "builtin",
    compatible: true,
  },
  {
    selector: "builtin:hara-cozy",
    id: "hara-cozy",
    displayName: "Hara Cozy",
    displayNameZh: "暖暖 · 陪伴",
    description: "A calm ambient companion for quiet focus and gentle reminders.",
    descriptionZh: "适合安静专注与轻提醒的温暖陪伴角色。",
    role: "Companion",
    roleZh: "陪伴",
    accent: "#f0dfc4",
    imageUrl: "/pets/hara-official/hara-cozy.png",
    source: "builtin",
    compatible: true,
  },
] as const;

const OFFICIAL_PET_BY_SELECTOR = new Map(
  OFFICIAL_HARA_PETS.map((pet) => [pet.selector, pet]),
);

export function officialPetForSelector(selector: string): OfficialPet | undefined {
  return OFFICIAL_PET_BY_SELECTOR.get(selector);
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
