import { useLayoutEffect, type ReactNode, type RefObject } from "react";

/** Resize a draft without changing its text, selection, composition or focus. Streaming updates
 * do not resize it; changes to the available width do. Limits come from the actual textarea CSS. */
export function useComposerAutoSize(inputRef: RefObject<HTMLTextAreaElement | null>, value: string, context = "") {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      const computed = getComputedStyle(input);
      const min = parseFloat(computed.minHeight) || 38;
      const max = parseFloat(computed.maxHeight) || 160;
      input.style.height = "0px";
      const height = Math.min(max, Math.max(min, input.scrollHeight));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > height + 1 ? "auto" : "hidden";
    };
    resize();
    let width = input.getBoundingClientRect().width;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || Math.abs(entry.contentRect.width - width) < 1) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [inputRef, value, context]);
}

export function ComposerInputRow({ inputRef, value, busy, canSend, sendLabel, stopLabel, onSend, onStop, children }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  busy: boolean;
  canSend: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop: () => void;
  children: ReactNode;
}) {
  useComposerAutoSize(inputRef, value);
  const sendEnabled = canSend && !busy;
  return <div className="composer-input-row">
    {children}
    {busy ? <button type="button" className="composer-send stop" onClick={onStop}>{stopLabel}</button> : null}
    <button type="button" className="composer-send" onClick={() => { if (sendEnabled) onSend(); }} disabled={!sendEnabled}
      aria-label={sendLabel}><span className="composer-send-label">{sendLabel}</span><span aria-hidden="true">↑</span></button>
  </div>;
}
