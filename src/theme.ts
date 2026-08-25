export const THEME_STORAGE_KEY = "hara.theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

type ThemeStorageReader = (key: string) => string | null;
type ThemeStorageWriter = (key: string, value: string) => void;

interface ThemeRoot {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "colorScheme">;
}

interface ThemeMediaQuery {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function loadThemePreference(read?: ThemeStorageReader): ThemePreference {
  const reader = read ?? (typeof window === "undefined"
    ? undefined
    : (key: string) => window.localStorage.getItem(key));
  if (!reader) return "system";
  try {
    return parseThemePreference(reader(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  write?: ThemeStorageWriter,
): void {
  const writer = write ?? (typeof window === "undefined"
    ? undefined
    : (key: string, value: string) => window.localStorage.setItem(key, value));
  if (!writer) return;
  try {
    writer(THEME_STORAGE_KEY, preference);
  } catch {
    // A private or locked-down webview may deny storage. The active theme still applies in memory.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

function currentSystemTheme(media?: ThemeMediaQuery): boolean {
  if (media) return media.matches;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(THEME_MEDIA_QUERY).matches;
}

export function applyThemePreference(
  preference: ThemePreference,
  systemDark = currentSystemTheme(),
  root?: ThemeRoot,
): ResolvedTheme {
  const resolved = resolveTheme(preference, systemDark);
  const target = root ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (target) {
    target.dataset.theme = resolved;
    target.dataset.themePreference = preference;
    target.style.colorScheme = resolved;
  }
  return resolved;
}

/** Apply the saved theme before React mounts so the first Desktop frame never flashes dark. */
export function initializeThemePreference(): ThemePreference {
  const preference = loadThemePreference();
  applyThemePreference(preference);
  return preference;
}

/** Keep the resolved theme synchronized with OS appearance while "system" is selected. */
export function bindThemePreference(
  preference: ThemePreference,
  media?: ThemeMediaQuery,
  root?: ThemeRoot,
): () => void {
  const query = media ?? (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(THEME_MEDIA_QUERY)
      : undefined
  );
  const apply = () => applyThemePreference(preference, currentSystemTheme(query), root);
  apply();
  if (preference !== "system" || !query) return () => {};

  if (query.addEventListener && query.removeEventListener) {
    query.addEventListener("change", apply);
    return () => query.removeEventListener?.("change", apply);
  }
  query.addListener?.(apply);
  return () => query.removeListener?.(apply);
}
