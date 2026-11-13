import { useLayoutEffect, useRef, type ReactNode } from "react";

/** A settings action belongs beside the action, even when its row is far down a long list.
 * The native top layer keeps the whole window inert; Escape cancels this action, not Settings.
 * Business approval, revision checks and requests stay with the caller. */
export function SettingsActionDialog({ label, pending = false, initialFocus = "cancel", onClose, children }: {
  label: string; pending?: boolean; initialFocus?: "cancel" | "field"; onClose(): void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), active = useRef(false);
  const focusFirst = (panel: HTMLDialogElement) => {
    const selector = initialFocus === "field"
      ? "input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"
      : "[data-settings-cancel]:not(:disabled)";
    (panel.querySelector<HTMLElement>(selector) ?? panel.querySelector<HTMLElement>("button:not(:disabled)") ?? panel).focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const panel = dialog.current!; active.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = previous?.closest<HTMLElement>(".wss-main") ?? null;
    panel.showModal();
    focusFirst(panel);
    return () => {
      active.current = false; panel.close();
      queueMicrotask(() => {
        // React StrictMode may already have opened this same node again.
        if (panel.open) return;
        (previous?.isConnected ? previous : fallback?.isConnected ? fallback : null)?.focus({ preventScroll: true });
      });
    };
  }, []);
  useLayoutEffect(() => {
    // Disabling the focused submit button can move focus to body (notably WebKit).
    const panel = dialog.current;
    if (pending && panel?.open && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [pending]);
  return <dialog ref={dialog} className="wsd-approval wss-action-dialog glass-c" aria-label={label} aria-modal="true" aria-busy={pending}
    onCancel={event => { event.stopPropagation(); event.preventDefault(); if (!pending) onClose(); }}
    onClose={event => {
      event.stopPropagation();
      const panel = event.currentTarget;
      // Chromium may force-close on a repeated Escape with a non-cancelable cancel event.
      // Also ignore queued close events from cleanup/StrictMode when this node is already open again.
      if (!active.current || panel.open || !panel.isConnected) return;
      if (pending) { panel.showModal(); focusFirst(panel); }
      else onClose();
    }}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && [",", "i"].includes(event.key.toLowerCase())) { event.preventDefault(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]'))
        .filter(node => !node.closest("[inert]") && node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>{children}</dialog>;
}

/** Results stay visible near the completed action instead of depending on the list's scroll position. */
export function SettingsActionResult({ text, error = false }: { text: string; error?: boolean }) {
  const status = useRef<HTMLParagraphElement>(null), alert = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (text) (error ? alert : status).current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [text, error]);
  // Keep both regions mounted and exposed before their text changes (WebKit/VoiceOver).
  return <>
    <p ref={status} className={text && !error ? "wss-action-result" : "wss-action-empty"} role="status" aria-live="polite" aria-atomic="true">{error ? "" : text}</p>
    <p ref={alert} className={text && error ? "wss-action-result is-error" : "wss-action-empty"} role="alert" aria-atomic="true">{error ? text : ""}</p>
  </>;
}
