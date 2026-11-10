import { UNKNOWN_SYSTEM_VISUALS, parseSystemVisuals, type SystemVisualPreferences } from "./violet-appearance.ts";

let nativeCache = { ...UNKNOWN_SYSTEM_VISUALS };
let pendingNative: Promise<SystemVisualPreferences> | null = null;
export async function readSystemVisualPreferences(): Promise<SystemVisualPreferences> {
  if (typeof window === "undefined" || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return { ...UNKNOWN_SYSTEM_VISUALS };
  if (pendingNative) return pendingNative;
  pendingNative = (async () => {
    try { const { invoke } = await import("@tauri-apps/api/core"); return parseSystemVisuals(await invoke("system_visual_preferences")); }
    catch { return { ...UNKNOWN_SYSTEM_VISUALS }; }
  })();
  try { return await pendingNative; } finally { pendingNative = null; }
}
/** Foreground-only, bounded metadata reads. One cleanup releases every event and timer. */
export function watchSystemVisualPreferences(onChange: (value: SystemVisualPreferences) => void, read = readSystemVisualPreferences,
  surface: Pick<Window, "matchMedia" | "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"> = window, page: Pick<Document, "visibilityState" | "hasFocus" | "addEventListener" | "removeEventListener"> = document): () => void {
  let active = true, reading = false, focused = page.visibilityState !== "hidden" && page.hasFocus(), native = { ...nativeCache };
  const motion = surface.matchMedia("(prefers-reduced-motion: reduce)"), contrast = surface.matchMedia("(forced-colors: active)"), moreContrast = surface.matchMedia("(prefers-contrast: more)");
  const publish = () => {
    if (!active) return;
    const value = { ...native, reduceMotion: motion.matches || native.reduceMotion === true,
      increaseContrast: contrast.matches || moreContrast.matches || native.increaseContrast === true };
    onChange(value);
  };
  const accept = (input: unknown) => {
    if (!active) return;
    const value = parseSystemVisuals(input);
    native = Object.fromEntries(Object.keys(UNKNOWN_SYSTEM_VISUALS).map(key => {
      const flag = key as keyof SystemVisualPreferences;
      // Missing/failed observations are not setting changes. Retain both known true and
      // known false; only a successful boolean observation may change the material.
      return [flag, value[flag] ?? native[flag]];
    })) as unknown as SystemVisualPreferences;
    nativeCache = { ...native }; publish();
  };
  const refresh = async () => {
    if (!active || reading || !focused || page.visibilityState === "hidden") return;
    reading = true;
    try { accept(await read()); }
    catch { accept(UNKNOWN_SYSTEM_VISUALS); }
    finally { reading = false; }
  };
  const visibility = () => { focused = page.visibilityState !== "hidden" && page.hasFocus(); if (typeof document !== "undefined") document.documentElement.dataset.windowActive = focused ? "true" : "false"; void refresh(); };
  const focus = () => { focused = page.visibilityState !== "hidden"; if (typeof document !== "undefined") document.documentElement.dataset.windowActive = focused ? "true" : "false"; void refresh(); };
  const blur = () => { focused = false; if (typeof document !== "undefined") document.documentElement.dataset.windowActive = "false"; };
  for (const media of [motion, contrast, moreContrast]) media.addEventListener("change", publish);
  surface.addEventListener("focus", focus); surface.addEventListener("blur", blur); page.addEventListener("visibilitychange", visibility);
  const timer = surface.setInterval(() => void refresh(), 15000);
  publish(); visibility();
  return () => { active = false; surface.clearInterval(timer); for (const media of [motion, contrast, moreContrast]) media.removeEventListener("change", publish);
    surface.removeEventListener("focus", focus); surface.removeEventListener("blur", blur); page.removeEventListener("visibilitychange", visibility); };
}
