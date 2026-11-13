import { useLayoutEffect, useRef, type ReactNode } from "react";

/** A settings action belongs beside the action, even when its row is far down a long list.
 * The native top layer keeps the whole window inert; Escape cancels this action, not Settings.
 * Business approval, revision checks and requests stay with the caller. */
export function SettingsActionDialog({ label, pending = false, initialFocus = "cancel", onClose, children }: {
  label: string; pending?: boolean; initialFocus?: "cancel" | "field"; onClose(): void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const panel = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = previous?.closest<HTMLElement>(".wss-main") ?? null;
    panel.showModal();
    const selector = initialFocus === "field"
      ? "input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"
      : "[data-settings-cancel]:not(:disabled)";
    (panel.querySelector<HTMLElement>(selector) ?? panel.querySelector<HTMLElement>("button:not(:disabled)") ?? panel).focus({ preventScroll: true });
    return () => {
      panel.close();
      queueMicrotask(() => {
        // React StrictMode may already have opened this same node again.
        if (panel.open) return;
        (previous?.isConnected ? previous : fallback?.isConnected ? fallback : null)?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialog} className="wsd-approval wss-action-dialog glass-c" aria-label={label} aria-modal="true" aria-busy={pending}
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}
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
  const result = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (text) result.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [text]);
  return text ? <p ref={result} className={`wss-action-result${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{text}</p> : null;
}
