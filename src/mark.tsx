import haraMarkUrl from "./assets/hara-mark.svg";

// Generated from the one production SVG in hara-web/brand/hara-logo-v3-imagegen/source.
// Keep every in-app Hara surface on this primary mark; favicon/platform rasterization
// may optimize pixels, but must never switch to a different silhouette.
export default function HaraLogo({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <img src={haraMarkUrl} width={size} height={size} aria-hidden="true" alt="" className={className} />
  );
}
