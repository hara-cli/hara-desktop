// Device-only material preferences; model credentials and Core authority stay untouched.
export const APPEARANCE_KEY = "hara.violet-appearance.v1";
export interface VioletAppearance {
  darkTheme: "violet-glass" | "obsidian";
  transparency: "off" | "standard" | "enhanced";
  motion: "off" | "reduced" | "standard";
}
export const DEFAULT_APPEARANCE: VioletAppearance = { darkTheme: "violet-glass", transparency: "standard", motion: "standard" };
export function parseAppearance(value: unknown): VioletAppearance {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { darkTheme: input.darkTheme === "obsidian" ? "obsidian" : "violet-glass",
    transparency: input.transparency === "off" || input.transparency === "enhanced" ? input.transparency : "standard",
    motion: input.motion === "off" || input.motion === "reduced" ? input.motion : "standard" };
}
export function loadAppearance(): VioletAppearance {
  try { return parseAppearance(JSON.parse(globalThis.localStorage?.getItem(APPEARANCE_KEY) ?? "null")); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
export function applyAppearance(value: VioletAppearance): void {
  if (typeof document === "undefined") return;
  Object.assign(document.documentElement.dataset, { visualTheme: value.darkTheme, transparency: value.transparency, motion: value.motion });
}
export function saveAppearance(value: VioletAppearance): void {
  try { globalThis.localStorage?.setItem(APPEARANCE_KEY, JSON.stringify(value)); } catch { /* active view still applies */ }
  applyAppearance(value);
}
