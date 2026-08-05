export const EXTENSION_DOCK_WIDTH_KEY = "hara.extensionDock.width.v1";

export type ExtensionDockMode = "docked" | "maximized";

export type ExtensionSurfaceKind =
  | "presentation"
  | "spreadsheet"
  | "document"
  | "design"
  | "browser"
  | "capability";

export interface ProjectExtensionOwner {
  place: "projects";
  sessionId: string;
  cwd: string;
}

export interface ArtifactExtensionOwner {
  place: "office";
  artifactId: string;
  revisionId: string;
}

export interface LegacyPanelExtension {
  type: "legacy-panel";
  id: string;
  title: string;
  plugin: string;
  panelId: string;
  url: string;
  surfaceKind: ExtensionSurfaceKind;
  owner: ProjectExtensionOwner;
  mode: ExtensionDockMode;
}

export interface ArtifactExtension {
  type: "artifact";
  id: string;
  title: string;
  surfaceKind: "presentation" | "spreadsheet" | "document";
  owner: ArtifactExtensionOwner;
  mode: ExtensionDockMode;
}

export type ExtensionDockItem = LegacyPanelExtension | ArtifactExtension;

export interface ExtensionContext {
  place: "projects" | "office";
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
  if (item.type === "legacy-panel") {
    return item.owner.sessionId === context.sessionId;
  }
  return item.owner.artifactId === context.artifactId
    && item.owner.revisionId === context.revisionId;
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
