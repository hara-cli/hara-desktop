/**
 * Hara mascot ("gate") — pure helpers. Assets: src/assets/mascot/*.svg (uiux mascot final, 2026-11-09).
 * Usage rules: empty pages (128), onboarding (128–512), Hara's status in progress cards (24, face only).
 * Never beside each message, never as the sidebar avatar or conversation title, never next to the logo.
 * The SVGs are rendered through <img> data URIs, so they cannot run script and their CSS stays scoped.
 */
import type { WaitPhase } from "./wait-timing";

export const MASCOT_STATES = ["idle", "think", "work", "wait", "done", "error"] as const;
export type MascotState = typeof MASCOT_STATES[number];
export type MascotVariant = "full" | "face";

/** Full body needs 48px; below that only the face is legible (minimum 16px). */
export const MASCOT_FULL_MIN = 48;
export const MASCOT_FACE_MIN = 16;

const PHASE_STATE: Record<WaitPhase, MascotState> = {
  idle: "idle", cancelled: "idle",
  preparing: "think", queued: "think", spawn: "think", recovering: "think", thinking: "think", unknown: "think",
  tool: "work", output: "work", finalizing: "work",
  question: "wait", approval: "wait",
  completed: "done",
  failed: "error",
};

/** Map the progress card's wait phase to the mascot state. */
export function mascotStateForWaitPhase(phase: WaitPhase): MascotState {
  return PHASE_STATE[phase] ?? "idle";
}

export function mascotVariantForSize(variant: MascotVariant, size: number): MascotVariant {
  return variant === "full" && size < MASCOT_FULL_MIN ? "face" : variant;
}

export function mascotSize(variant: MascotVariant, size: number): number {
  return Math.max(variant === "face" ? MASCOT_FACE_MIN : MASCOT_FULL_MIN, Math.round(size));
}

const UNSAFE = /<script|<foreignObject|\son[a-z]+\s*=|(?:xlink:)?href\s*=|javascript:/i;

/** Static assets only. Refuse anything that could execute or load other resources. */
export function mascotSvgIsSafe(raw: string): boolean {
  return raw.trimStart().startsWith("<svg") && !UNSAFE.test(raw);
}

/**
 * Apply the theme and motion preference to one asset and return a data URI.
 * Light: original colors. Dark: original colors plus an 18% white edge. Motion off: no animation
 * (the asset already follows prefers-reduced-motion by itself).
 */
export function mascotDataUri(raw: string, { dark, still }: { dark: boolean; still: boolean }): string {
  if (!mascotSvgIsSafe(raw)) return "";
  let svg = raw.replace(/\srole="img"/, "").replace(/\saria-label="[^"]*"/, "");
  if (dark) svg = svg.replace(/var\(--hm-edge,transparent\)/g, "var(--hm-edge,rgba(255,255,255,.18))");
  if (still) svg = svg.replace("<style>", "<style>*{animation:none!important}");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
