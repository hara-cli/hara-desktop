import haraMarkUrl from "./assets/hara-mark.svg";

// Generated from hara-web/brand/hara-logo-v3-imagegen/source/hara-mark.svg.
export default function HaraLogo({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <img src={haraMarkUrl} width={size} height={size} aria-hidden="true" alt="" className={className} />
  );
}
