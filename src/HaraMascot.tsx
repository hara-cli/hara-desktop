import { useSyncExternalStore } from "react";
import { mascotDataUri, mascotSize, mascotVariantForSize, type MascotState, type MascotVariant } from "./hara-mascot";
import "./hara-mascot.css";
import { MASCOT_SVG } from "./generated/hara-mascot-assets";

const source = (variant: MascotVariant, state: MascotState) => MASCOT_SVG[`${variant === "face" ? "face-" : ""}${state}`] ?? "";

const reduceQuery = () => typeof window === "undefined" || !window.matchMedia ? undefined : window.matchMedia("(prefers-reduced-motion: reduce)");
type Look = "light" | "dark" | "light-still" | "dark-still";
const look = (): Look => {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  const dark = root?.dataset.theme === "dark";
  // An SVG inside <img> does not see the system preference, so read it here as well.
  const still = root?.dataset.motion === "off" || root?.dataset.motion === "reduced" || reduceQuery()?.matches === true;
  return `${dark ? "dark" : "light"}${still ? "-still" : ""}` as Look;
};
const subscribe = (notify: () => void) => {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(notify), query = reduceQuery();
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });
  query?.addEventListener("change", notify);
  return () => { observer.disconnect(); query?.removeEventListener("change", notify); };
};
const cache = new Map<string, string>();

/**
 * The Hara mascot. `label` is the localized alt text; pass `decorative` when nearby text already says the same.
 * Follows the resolved theme (dark adds the 18% white edge) and the in-app motion setting; the asset itself
 * follows the system "reduce motion" preference (checked here because <img> SVGs cannot see it).
 */
export function HaraMascot({ state, variant = "full", size, label, decorative = false, className }: {
  state: MascotState; variant?: MascotVariant; size: number; label?: string; decorative?: boolean; className?: string;
}) {
  const current = useSyncExternalStore(subscribe, look, () => "light" as Look);
  const kind = mascotVariantForSize(variant, size), px = mascotSize(kind, size);
  const key = `${kind}:${state}:${current}`;
  let uri = cache.get(key);
  if (uri === undefined) {
    uri = mascotDataUri(source(kind, state), { dark: current.startsWith("dark"), still: current.endsWith("-still") });
    cache.set(key, uri);
  }
  if (!uri) return null;
  return <img className={`hara-mascot is-${kind}${className ? ` ${className}` : ""}`} data-mascot-state={state} src={uri}
    width={px} height={px} draggable={false} alt={decorative ? "" : label ?? ""} aria-hidden={decorative || undefined} />;
}
