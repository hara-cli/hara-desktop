/**
 * Settings «Advanced» and attention helpers (Jeff 2026-11-11, settings IA audit §2).
 *
 * - The expanded/collapsed state of each page's single «Advanced» section is a UI preference of
 *   this Mac only: it is never synced and never written into workspace settings. Storage may be
 *   unavailable (private window, blocked site data); every access is guarded and falls back to
 *   «collapsed».
 * - Attention is derived, never stored: a page has attention while one of its states needs the
 *   user (update ready, key invalid, review pending…). Each page slice adds its own sources.
 */
export const ADVANCED_STORAGE_KEY = "hara.settings.advanced.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
function storage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function readAll(store: StorageLike | null): Record<string, boolean> {
  if (!store) return {};
  try {
    const value: unknown = JSON.parse(store.getItem(ADVANCED_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return {}; }
}

export function loadAdvancedOpen(page: string, store: StorageLike | null = storage()): boolean {
  return readAll(store)[page] === true;
}

export function saveAdvancedOpen(page: string, open: boolean, store: StorageLike | null = storage()): void {
  if (!store) return;
  try {
    const next = { ...readAll(store) };
    if (open) next[page] = true; else delete next[page];
    store.setItem(ADVANCED_STORAGE_KEY, JSON.stringify(next));
  } catch { /* the current view still reflects the toggle */ }
}

export interface SettingsAttentionInput {
  /** Software update needs the user (download ready, restart pending…); see `hasUpdateAttention`. */
  updateAttention: boolean;
}

/** Pages whose nav item (and overview card) carry an attention dot. */
export function settingsAttentionPages(input: SettingsAttentionInput): ReadonlySet<string> {
  const pages = new Set<string>();
  if (input.updateAttention) pages.add("updates");
  return pages;
}
