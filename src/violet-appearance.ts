// Device-only material preferences; model credentials and Core authority stay untouched.
export const APPEARANCE_KEY = "hara.violet-appearance.v1";
export interface VioletAppearance {
  darkTheme: "violet-glass" | "obsidian";
  transparency: "system" | "off" | "standard" | "enhanced";
  motion: "system" | "off" | "reduced" | "standard";
}
export interface SystemVisualPreferences {
  reduceTransparency: boolean | null; increaseContrast: boolean | null;
  reduceMotion: boolean | null; lowPowerMode: boolean | null;
}
export const UNKNOWN_SYSTEM_VISUALS: SystemVisualPreferences = { reduceTransparency: null, increaseContrast: null, reduceMotion: null, lowPowerMode: null };
export const DEFAULT_APPEARANCE: VioletAppearance = { darkTheme: "violet-glass", transparency: "system", motion: "system" };
export function parseAppearance(value: unknown): VioletAppearance {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { darkTheme: input.darkTheme === "obsidian" ? "obsidian" : "violet-glass",
    transparency: typeof input.transparency === "string" && ["off", "standard", "enhanced"].includes(input.transparency) ? input.transparency as VioletAppearance["transparency"] : "system",
    motion: typeof input.motion === "string" && ["off", "reduced", "standard"].includes(input.motion) ? input.motion as VioletAppearance["motion"] : "system" };
}
export function parseSystemVisuals(value: unknown): SystemVisualPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(UNKNOWN_SYSTEM_VISUALS).map(key => [key, typeof source[key] === "boolean" ? source[key] : null])) as unknown as SystemVisualPreferences;
}
export function resolveAppearance(value: VioletAppearance, system: SystemVisualPreferences) {
  const solid = system.reduceTransparency === true || system.increaseContrast === true || value.transparency === "off"
    || value.transparency === "system" && system.reduceTransparency === null;
  const reduceMotion = system.reduceMotion === true || value.motion === "reduced" || value.motion === "system" && system.reduceMotion === null;
  return { visualTheme: value.darkTheme, transparency: solid ? "off" : value.transparency === "system" ? "standard" : value.transparency,
    motion: value.motion === "off" ? "off" : reduceMotion ? "reduced" : "standard",
    contrast: system.increaseContrast === true ? "more" : "normal", lowPower: system.lowPowerMode === true ? "true" : "false" };
}
export function loadAppearance(): VioletAppearance {
  try { return parseAppearance(JSON.parse(globalThis.localStorage?.getItem(APPEARANCE_KEY) ?? "null")); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
let currentSystemVisuals = { ...UNKNOWN_SYSTEM_VISUALS };
export function applyAppearance(value: VioletAppearance, system: SystemVisualPreferences = currentSystemVisuals): void {
  currentSystemVisuals = system;
  if (typeof document === "undefined") return;
  Object.assign(document.documentElement.dataset, resolveAppearance(value, system), { transparencyPreference: value.transparency, motionPreference: value.motion });
}
export function saveAppearance(value: VioletAppearance): void {
  try { globalThis.localStorage?.setItem(APPEARANCE_KEY, JSON.stringify(value)); } catch { /* active view still applies */ }
  applyAppearance(value);
}
