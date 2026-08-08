import { ACTIVE_WORK_OBJECT_HISTORY_PREFIX } from "./user-visible-text.ts";

export { ACTIVE_WORK_OBJECT_HISTORY_PREFIX } from "./user-visible-text.ts";

export const EXTENSION_DOCK_WIDTH_KEY = "hara.extensionDock.width.v1";
export const EXTENSION_DOCK_TAB_LIMIT = 12;

export type ExtensionDockMode = "docked" | "maximized";

export type ExtensionSurfaceKind =
  | "presentation"
  | "spreadsheet"
  | "document"
  | "design"
  | "browser"
  | "terminal"
  | "files"
  | "review"
  | "capability";

export type WorkbenchToolKind = "terminal" | "browser" | "files";

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

export interface PresentationBrowserExtension extends ExtensionTabBase {
  type: "presentation-browser";
  surfaceKind: "browser";
  owner: ArtifactExtensionOwner;
}

export interface WorkbenchToolExtension extends ExtensionTabBase {
  type: "workbench-tool";
  tool: WorkbenchToolKind;
  surfaceKind: WorkbenchToolKind;
  owner: SessionExtensionOwner;
}

export interface ReviewExtension extends ExtensionTabBase {
  type: "review";
  surfaceKind: "review";
  diff: string;
  owner: SessionExtensionOwner;
}

export type ExtensionDockItem =
  | LegacyPanelExtension
  | WebPreviewExtension
  | ArtifactExtension
  | PresentationBrowserExtension
  | WorkbenchToolExtension
  | ReviewExtension;

export interface ExtensionDockState {
  tabs: ExtensionDockItem[];
  activeId: string | null;
}

export interface PresentationRecoveryArtifact {
  kind: string;
  extension: string;
  mediaType: string;
  currentRevisionId: string;
  updatedAt: string;
}

export interface PresentationRecoveryRevision {
  revisionId: string;
  taskRunId?: string;
  createdAt: string;
}

/** Select only the current native Presentation revision written by this session in the active turn
 * window. Exported PPTX paths, assistant text, and older revisions can never satisfy this fallback. */
export function nativePresentationRevisionFromTurn<T extends PresentationRecoveryRevision>(
  artifact: PresentationRecoveryArtifact,
  revisions: readonly T[],
  sessionId: string,
  startedAt: number,
): T | null {
  const threshold = startedAt - 5_000;
  if (
    artifact.kind !== "presentation"
    || artifact.extension !== ".hpres"
    || artifact.mediaType !== "application/vnd.nanhara.presentation+json"
    || (Date.parse(artifact.updatedAt) || 0) < threshold
  ) return null;
  return revisions.find((revision) =>
    revision.revisionId === artifact.currentRevisionId
    && revision.taskRunId === sessionId
    && (Date.parse(revision.createdAt) || 0) >= threshold,
  ) ?? null;
}

export interface ExtensionContext {
  place: "chat" | "projects" | "office";
  sessionId?: string | null;
  artifactId?: string | null;
  revisionId?: string | null;
}

/** Stable UI-only key for hiding one owner-bound extension screen without closing its tabs. */
export function extensionContextKey(context: ExtensionContext): string | null {
  if (context.place === "office") return "office";
  return context.sessionId ? `${context.place}:${context.sessionId}` : null;
}

export function extensionItemContextKey(item: ExtensionDockItem): string {
  return item.owner.place === "office"
    ? "office"
    : `${item.owner.place}:${item.owner.sessionId}`;
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
  if (item.type !== "artifact" && item.type !== "presentation-browser") return false;
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

export function workbenchToolTabId(sessionId: string, tool: WorkbenchToolKind): string {
  return `tool:${sessionId}:${tool}`;
}

export function reviewTabId(sessionId: string): string {
  return `review:${sessionId}:changes`;
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

export function presentationBrowserTabId(
  artifactId: string,
  revisionId: string,
  owner: ArtifactExtensionOwner,
): string {
  return `${artifactExtensionTabId(artifactId, owner)}:browser:${revisionId}`;
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

const safeActiveWorkObjectOpaqueId = (value: unknown): value is string =>
  typeof value === "string"
  && value.length >= 4
  && value.length <= 256
  && !/[\u0000-\u001f\u007f]/.test(value);

/** Add only renderer-authored, credential-free metadata for the object visibly selected in the Dock.
 * The tab title, local path, query, fragment, and user-visible text are never copied into the envelope. */
export function messageWithActiveWorkObject(item: ExtensionDockItem, text: string): string {
  const context = [
    ACTIVE_WORK_OBJECT_HISTORY_PREFIX,
    `kind=${item.surfaceKind}`,
    "intent=apply_user_request_to_active_visible_object",
  ];
  if (item.type === "artifact" || item.type === "presentation-browser") {
    if (
      !safeActiveWorkObjectOpaqueId(item.owner.artifactId)
      || !safeActiveWorkObjectOpaqueId(item.owner.revisionId)
    ) return text;
    context.push(`artifact_id=${item.owner.artifactId}`);
    context.push(`revision_id=${item.owner.revisionId}`);
  } else if (item.type === "web-preview" || item.type === "legacy-panel") {
    const origin = publicPanelOrigin(item.url);
    if (origin) context.push(`origin=${origin}`);
  } else if (item.type === "review") {
    context.push("scope=current_task_changes");
  } else if (item.tool === "files") {
    context.push("scope=current_workspace_files");
  } else if (item.tool === "terminal") {
    context.push("scope=current_task_execution");
  } else {
    context.push("scope=current_local_preview");
  }
  return `${context.join("\n")}\n]\n\n${text}`;
}

export function extensionDockWidth(value: unknown, fallback = 48): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const safeFallback = Number.isFinite(fallback) ? Math.min(72, Math.max(36, fallback)) : 48;
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.min(72, Math.max(36, parsed));
}
