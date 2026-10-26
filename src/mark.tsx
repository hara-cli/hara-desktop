import haraMarkUrl from "./assets/hara-mark.svg";

// Generated from brand/hara-mark.svg: retained gateway geometry, Violet #7C3AED.
// Keep every in-app Hara surface on this primary mark; favicon/platform rasterization
// may optimize pixels, but must never switch to a different silhouette.
export default function HaraLogo({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <img src={haraMarkUrl} width={size} height={size} aria-hidden="true" alt="" className={className} />
  );
}
