export function talentMarketEscapeAction(selected: boolean, suspended: boolean): "drawer" | "market" | null {
  return suspended ? null : selected ? "drawer" : "market";
}

/** Contain keyboard focus only while the candidate drawer is the active dialog. */
export function bindTalentDrawerFocus(drawer: HTMLElement): () => void {
  const controls = () => Array.from(drawer.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  ));
  const first = controls()[0];
  (first ?? drawer).focus({ preventScroll: true });
  const trap = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = controls();
    const active = drawer.ownerDocument.activeElement;
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      drawer.focus({ preventScroll: true });
    } else if (!items.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  drawer.addEventListener("keydown", trap);
  return () => drawer.removeEventListener("keydown", trap);
}
