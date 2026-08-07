export const EXTENSION_DOCK_WIDTH_KEY = "hara.extensionDock.width.v1";
export const EXTENSION_DOCK_TAB_LIMIT = 12;

export type ExtensionDockMode = "docked" | "maximized";

export type ExtensionSurfaceKind =
  | "presentation"
  | "spreadsheet"
  | "document"
  | "design"
  | "browser"
  | "capability";

export type InteractiveExtensionPlace = "chat" | "projects";

export interface SessionExtensionOwner {
  place: InteractiveExtensionPlace;
  sessionId: string;
  cwd: string;
}

export interface ProjectExtensionOwner extends SessionExtensionOwner {
  place: "projects";
}

export interface OfficeArtifactExtensionOwner {
  place: "office";
  artifactId: string;
  revisionId: string;
}

export interface SessionArtifactExtensionOwner extends SessionExtensionOwner {
  artifactId: string;
  revisionId: string;
}

export type ArtifactExtensionOwner = OfficeArtifactExtensionOwner | SessionArtifactExtensionOwner;

interface ExtensionTabBase {
  id: string;
  title: string;
  surfaceKind: ExtensionSurfaceKind;
  mode: ExtensionDockMode;
  /** Unsaved native editor state. Dirty tabs are never evicted by the soft tab limit. */
  dirty?: boolean;
}

export interface LegacyPanelExtension extends ExtensionTabBase {
  type: "legacy-panel";
  plugin: string;
  panelId: string;
  url: string;
  owner: ProjectExtensionOwner;
}

export interface WebPreviewExtension extends ExtensionTabBase {
  type: "web-preview";
  surfaceKind: "browser";
  url: string;
  owner: SessionExtensionOwner;
}

export interface ArtifactExtension extends ExtensionTabBase {
  type: "artifact";
  surfaceKind: "presentation" | "spreadsheet" | "document";
  owner: ArtifactExtensionOwner;
}

export type ExtensionDockItem = LegacyPanelExtension | WebPreviewExtension | ArtifactExtension;

export interface ExtensionDockState {
  tabs: ExtensionDockItem[];
  activeId: string | null;
}

export interface ExtensionContext {
  place: "chat" | "projects" | "office";
  sessionId?: string | null;
  artifactId?: string | null;
  revisionId?: string | null;
}

const PANEL_KIND_PATTERNS: readonly [ExtensionSurfaceKind, RegExp][] = [
  ["browser", /(?:^|[\s._-])(browser|chrome|web)(?:$|[\s._-])/i],
  ["presentation", /(?:^|[\s._-])(pptx?|slides?|presentation)(?:$|[\s._-])/i],
  ["spreadsheet", /(?:^|[\s._-])(xlsx?|excel|sheet|spreadsheet)(?:$|[\s._-])/i],
  ["document", /(?:^|[\s._-])(docx?|document|writer)(?:$|[\s._-])/i],
  ["design", /(?:^|[\s._-])(design|figma|preview)(?:$|[\s._-])/i],
];

export function classifyPanelSurface(
  plugin: string,
  panelId: string,
  title: string,
): ExtensionSurfaceKind {
  const searchable = `${plugin} ${panelId} ${title}`.trim();
  return PANEL_KIND_PATTERNS.find(([, pattern]) => pattern.test(searchable))?.[0]
    ?? "capability";
}

export function extensionMatchesContext(
  item: ExtensionDockItem | null,
  context: ExtensionContext,
): boolean {
  if (!item || item.owner.place !== context.place) return false;
  if (item.owner.place === "chat" || item.owner.place === "projects") {
    return item.owner.sessionId === context.sessionId;
  }
  if (item.type !== "artifact") return false;
  return (context.artifactId === undefined || context.artifactId === null || item.owner.artifactId === context.artifactId)
    && (context.revisionId === undefined || context.revisionId === null || item.owner.revisionId === context.revisionId);
}

export function emptyExtensionDockState(): ExtensionDockState {
  return { tabs: [], activeId: null };
}

export function activeExtensionTab(state: ExtensionDockState): ExtensionDockItem | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

export function extensionTabsForContext(
  state: ExtensionDockState,
  context: ExtensionContext,
): ExtensionDockItem[] {
  return state.tabs.filter((tab) => extensionMatchesContext(tab, context));
}

/** Resolve what the user actually sees in one work context. The global active id may belong to a
 * different module, so each context falls back to its newest owner-bound tab. */
export function activeExtensionTabForContext(
  state: ExtensionDockState,
  context: ExtensionContext,
): ExtensionDockItem | null {
  const active = activeExtensionTab(state);
  if (extensionMatchesContext(active, context)) return active;
  const tabs = extensionTabsForContext(state, context);
  return tabs[tabs.length - 1] ?? null;
}

export function upsertExtensionTab(
  state: ExtensionDockState,
  tab: ExtensionDockItem,
  limit = EXTENSION_DOCK_TAB_LIMIT,
): ExtensionDockState {
  const currentIndex = state.tabs.findIndex((candidate) => candidate.id === tab.id);
  const next = currentIndex >= 0
    ? state.tabs.map((candidate, index) => index === currentIndex ? tab : candidate)
    : [...state.tabs, tab];
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : EXTENSION_DOCK_TAB_LIMIT;
  while (next.length > safeLimit) {
    const evictIndex = next.findIndex((candidate) => candidate.id !== tab.id && candidate.dirty !== true);
    if (evictIndex < 0) break;
    next.splice(evictIndex, 1);
  }
  return { tabs: next, activeId: tab.id };
}

export function activateExtensionTab(
  state: ExtensionDockState,
  tabId: string,
): ExtensionDockState {
  return state.tabs.some((tab) => tab.id === tabId)
    ? { ...state, activeId: tabId }
    : state;
}

export function closeExtensionTab(
  state: ExtensionDockState,
  tabId: string,
): ExtensionDockState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (state.activeId !== tabId) return { ...state, tabs };
  const adjacent = tabs[Math.min(index, tabs.length - 1)] ?? null;
  return { tabs, activeId: adjacent?.id ?? null };
}

export function updateExtensionTab(
  state: ExtensionDockState,
  tabId: string,
  update: (tab: ExtensionDockItem) => ExtensionDockItem,
): ExtensionDockState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === tabId ? update(tab) : tab),
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Generic project previews are deliberately narrower than installed plugin panels. */
export function localWebPreviewUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== "string" || rawUrl.length < 1 || rawUrl.length > 4_096) return null;
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      parsed.protocol !== "http:"
      || parsed.username
      || parsed.password
      || !parsed.port
      || !LOOPBACK_HOSTS.has(hostname)
    ) return null;
    const port = Number(parsed.port);
    return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? parsed : null;
  } catch {
    return null;
  }
}

/** Stable opaque ids deduplicate reload offers without placing paths or query data in DOM ids. */
export function webPreviewTabId(sessionId: string, rawUrl: string): string {
  let hash = 0x811c9dc5;
  const input = `${sessionId}\u0000${rawUrl}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `preview:${sessionId}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Artifact tabs are owner-scoped: opening the same revision from Office and two project sessions
 * creates three independent tabs instead of silently moving one tab between work contexts. */
export function artifactExtensionTabId(
  artifactId: string,
  owner: ArtifactExtensionOwner,
): string {
  return owner.place === "office"
    ? `artifact:office:${artifactId}`
    : `artifact:${owner.place}:${owner.sessionId}:${artifactId}`;
}

/** Display only an origin. Panel paths, query strings, fragments, and URL credentials stay hidden. */
export function publicPanelOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function extensionDockWidth(value: unknown, fallback = 48): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.min(72, Math.max(36, fallback)) : 48;
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.min(72, Math.max(36, parsed));
}
