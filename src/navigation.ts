export type CoreAppPlace = "chat" | "projects" | "auto" | "groups" | "office";
export type AppPlace = CoreAppPlace | "settings";
export type NavigationIconName = "chat" | "projects" | "tasks" | "groups" | "office";

export interface NavigationContribution {
  /** Stable owner-scoped ID. Plugin contributions will use `plugin.<plugin-id>.<surface-id>`. */
  id: string;
  /** Routing target. Core targets are places; plugin surfaces can add their own targets later. */
  target: string;
  source: "core" | "plugin";
  icon: NavigationIconName;
  defaultOrder: number;
  defaultVisible: boolean;
  canHide: boolean;
  shortcut?: string;
}

export interface CoreNavigationContribution extends NavigationContribution {
  target: CoreAppPlace;
  source: "core";
}

export interface PluginNavigationSurface {
  plugin: string;
  panelId: string;
  title: string;
  description?: string;
  icon?: NavigationIconName;
}

export interface PluginNavigationContribution extends NavigationContribution {
  source: "plugin";
  plugin: string;
  panelId: string;
  title: string;
  description: string;
}

export interface NavigationPreferences {
  version: 1;
  /** IDs present here were explicitly ordered by the user. Missing contributions use defaults. */
  order: string[];
  hidden: string[];
  /** Default-hidden contributions the user explicitly chose to show. */
  shown: string[];
}

export const NAVIGATION_PREFERENCES_KEY = "hara.navigation.v1";

export const CORE_NAVIGATION_CONTRIBUTIONS = [
  {
    id: "core.chat",
    target: "chat",
    source: "core",
    icon: "chat",
    defaultOrder: 10,
    defaultVisible: true,
    canHide: true,
    shortcut: "⌘1",
  },
  {
    id: "core.projects",
    target: "projects",
    source: "core",
    icon: "projects",
    defaultOrder: 20,
    defaultVisible: true,
    canHide: true,
    shortcut: "⌘2",
  },
  {
    id: "core.tasks",
    target: "auto",
    source: "core",
    icon: "tasks",
    defaultOrder: 30,
    defaultVisible: true,
    canHide: true,
    shortcut: "⌘3",
  },
  {
    id: "core.groups",
    target: "groups",
    source: "core",
    icon: "groups",
    defaultOrder: 40,
    defaultVisible: true,
    canHide: true,
    shortcut: "⌘4",
  },
  {
    id: "core.office",
    target: "office",
    source: "core",
    icon: "office",
    defaultOrder: 50,
    defaultVisible: true,
    canHide: true,
    shortcut: "⌘5",
  },
] as const satisfies readonly CoreNavigationContribution[];

const MAX_PLUGIN_NAVIGATION_SURFACES = 256;
const MAX_PLUGIN_ID_LENGTH = 200;
const MAX_PLUGIN_TITLE_LENGTH = 500;
const MAX_PLUGIN_DESCRIPTION_LENGTH = 1_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const encodedContributionSegment = (value: string): string | null => {
  if (!value.trim() || value.length > MAX_PLUGIN_ID_LENGTH || value.includes("\0")) return null;
  try {
    // encodeURIComponent intentionally leaves dots untouched. Escape them as well so the two
    // owner-scoped segments cannot collide (`a.b` + `c` versus `a` + `b.c`).
    return encodeURIComponent(value).replace(/\./g, "%2E");
  } catch {
    return null;
  }
};

export function pluginNavigationContributionId(
  plugin: string,
  panelId: string,
): string | null {
  const pluginSegment = encodedContributionSegment(plugin);
  const panelSegment = encodedContributionSegment(panelId);
  return pluginSegment && panelSegment
    ? `plugin.${pluginSegment}.${panelSegment}`
    : null;
}

/**
 * Convert enabled plugin work panels into default-hidden dock entries. The shell keeps
 * only descriptive routing metadata here; opening a panel still asks Serve for the authoritative
 * descriptor that applies to the active project.
 */
export function pluginNavigationContributions(
  surfaces: readonly PluginNavigationSurface[],
): PluginNavigationContribution[] {
  const contributions: PluginNavigationContribution[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces.slice(0, MAX_PLUGIN_NAVIGATION_SURFACES)) {
    const id = pluginNavigationContributionId(surface.plugin, surface.panelId);
    const title = typeof surface.title === "string" ? surface.title.trim() : "";
    if (
      !id
      || seen.has(id)
      || !title
      || title.length > MAX_PLUGIN_TITLE_LENGTH
      || CONTROL_CHARACTERS.test(title)
    ) continue;
    seen.add(id);
    contributions.push({
      id,
      target: `plugin-panel:${id}`,
      source: "plugin",
      icon: surface.icon ?? "tasks",
      defaultOrder: 1_000 + contributions.length,
      defaultVisible: false,
      canHide: true,
      plugin: surface.plugin,
      panelId: surface.panelId,
      title,
      description: typeof surface.description === "string" && !CONTROL_CHARACTERS.test(surface.description)
        ? surface.description.trim().slice(0, MAX_PLUGIN_DESCRIPTION_LENGTH)
        : "",
    });
  }
  return contributions;
}

const emptyPreferences = (): NavigationPreferences => ({
  version: 1,
  order: [],
  hidden: [],
  shown: [],
});

const stringIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) unique.add(item);
  }
  return [...unique];
};

/** Parse untrusted local preferences without letting stale plugin IDs break the shell. */
export function parseNavigationPreferences(raw: string | null): NavigationPreferences {
  if (!raw) return emptyPreferences();
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      order?: unknown;
      hidden?: unknown;
      shown?: unknown;
    };
    if (parsed.version !== 1) return emptyPreferences();
    return {
      version: 1,
      order: stringIds(parsed.order),
      hidden: stringIds(parsed.hidden),
      shown: stringIds(parsed.shown),
    };
  } catch {
    return emptyPreferences();
  }
}

/** Known contributions in user order, with newly installed contributions appended by defaults. */
export function orderedNavigation<T extends NavigationContribution>(
  contributions: readonly T[],
  preferences: NavigationPreferences,
): T[] {
  const byId = new Map(contributions.map((item) => [item.id, item]));
  const explicit = preferences.order
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item));
  const explicitIds = new Set(explicit.map((item) => item.id));
  const remaining = contributions
    .filter((item) => !explicitIds.has(item.id))
    .sort((left, right) => left.defaultOrder - right.defaultOrder);
  return [...explicit, ...remaining];
}

export function navigationIsVisible(
  contribution: NavigationContribution,
  preferences: NavigationPreferences,
): boolean {
  if (!contribution.canHide) return true;
  if (preferences.hidden.includes(contribution.id)) return false;
  return contribution.defaultVisible || preferences.shown.includes(contribution.id);
}

export function visibleNavigation<T extends NavigationContribution>(
  contributions: readonly T[],
  preferences: NavigationPreferences,
): T[] {
  return orderedNavigation(contributions, preferences).filter((item) =>
    navigationIsVisible(item, preferences),
  );
}

function normalizedHidden(
  contributions: readonly NavigationContribution[],
  preferences: NavigationPreferences,
): string[] {
  const hideable = new Set(
    contributions.filter((item) => item.canHide).map((item) => item.id),
  );
  return preferences.hidden.filter((id) => hideable.has(id));
}

function normalizedShown(
  contributions: readonly NavigationContribution[],
  preferences: NavigationPreferences,
): string[] {
  const defaultHidden = new Set(
    contributions
      .filter((item) => item.canHide && !item.defaultVisible)
      .map((item) => item.id),
  );
  return preferences.shown.filter((id) => defaultHidden.has(id));
}

export function withNavigationVisibility(
  contributions: readonly NavigationContribution[],
  preferences: NavigationPreferences,
  id: string,
  visible: boolean,
): NavigationPreferences {
  const contribution = contributions.find((item) => item.id === id);
  if (!contribution || (!visible && !contribution.canHide)) return preferences;
  const hidden = new Set(normalizedHidden(contributions, preferences));
  const shown = new Set(normalizedShown(contributions, preferences));
  if (visible) {
    hidden.delete(id);
    if (!contribution.defaultVisible) shown.add(id);
  } else {
    hidden.add(id);
    shown.delete(id);
  }
  return {
    version: 1,
    order: orderedNavigation(contributions, preferences).map((item) => item.id),
    hidden: [...hidden],
    shown: [...shown],
  };
}

export function moveNavigation(
  contributions: readonly NavigationContribution[],
  preferences: NavigationPreferences,
  id: string,
  direction: -1 | 1,
): NavigationPreferences {
  const order = orderedNavigation(contributions, preferences).map((item) => item.id);
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return preferences;
  [order[from], order[to]] = [order[to], order[from]];
  return {
    version: 1,
    order,
    hidden: normalizedHidden(contributions, preferences),
    shown: normalizedShown(contributions, preferences),
  };
}

export function isAppPlace(value: string | null): value is AppPlace {
  return value === "chat"
    || value === "projects"
    || value === "auto"
    || value === "groups"
    || value === "office"
    || value === "settings";
}

export function initialAppPlace(
  saved: string | null,
  preferences: NavigationPreferences,
): AppPlace {
  if (saved === "settings") return "settings";
  if (saved && isAppPlace(saved)) {
    const savedContribution = CORE_NAVIGATION_CONTRIBUTIONS.find(
      (item) => item.target === saved,
    );
    if (savedContribution && navigationIsVisible(savedContribution, preferences)) {
      return saved;
    }
  }
  return visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)[0]?.target
    ?? "settings";
}
