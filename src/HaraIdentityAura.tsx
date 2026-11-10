import { useEffect, useState, type ReactNode } from "react";
let firstEmptyRippleSeen = false;
/** Decorates the existing identity; never introduces a second logo or portrait. */
export function HaraIdentityAura({ active, decorative = false, children }: { active: boolean; decorative?: boolean; children: ReactNode }) {
  const [firstOpen, setFirstOpen] = useState(false);
  useEffect(() => {
    if (!active) { setFirstOpen(false); return; }
    if (!firstEmptyRippleSeen) { firstEmptyRippleSeen = true; setFirstOpen(true); }
  }, [active]);
  useEffect(() => {
    if (!firstOpen) return;
    // Also consume the one-time effect when motion is disabled before an animationend event.
    const timer = setTimeout(() => setFirstOpen(false), 1250);
    return () => clearTimeout(timer);
  }, [firstOpen]);
  return <span onAnimationEnd={event => { if (event.animationName === "hd-empty-ripple") setFirstOpen(false); }} className="hd-identity-aura" data-hara-empty={active || undefined} data-ripple-first={active && firstOpen || undefined} aria-hidden={decorative || undefined}>{children}</span>;
}
