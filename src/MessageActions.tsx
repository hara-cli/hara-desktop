import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUturnLeftIcon, EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import { MessageCopyButton } from "./MessageCopyButton";
import { redesignText } from "./desktop-redesign-copy";
import "./MessageActions.css";

/** Copy content rather than renderer controls such as the code-copy button. */
function plainMessageText(node: HTMLElement | null, fallback: string): string {
  if (!node) return fallback;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, summary, details:not([open])").forEach(element => element.remove());
  return clone.textContent?.trim() || fallback;
}

export function MessageActions({ text, body, locale, copyLabel, copiedLabel, failedLabel, onReply }: {
  text: string; body: RefObject<HTMLElement | null>; locale: string; copyLabel: string; copiedLabel: string; failedLabel: string; onReply?: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null), [open, setOpen] = useState(false);
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  useEffect(() => { if (details.current) details.current.open = false; }, [text]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!details.current?.contains(event.target as Node) && details.current) details.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const selectText = () => {
    if (!body.current) return;
    details.current?.querySelector("summary")?.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(body.current);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    if (details.current) details.current.open = false;
  };
  return <div className="hd-message-actions" role="group" aria-label={r("messageActions")}>
    {onReply ? <button type="button" className="hd-message-action" aria-label={r("replyInTopic")} onClick={onReply}><ArrowUturnLeftIcon /></button> : null}
    <MessageCopyButton text={text} copyLabel={copyLabel} copiedLabel={copiedLabel} failedLabel={failedLabel} />
    <details ref={details} className="hd-message-more" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => {
      if (event.key === "Escape" && details.current?.open) { event.preventDefault(); event.stopPropagation(); details.current.open = false; details.current.querySelector("summary")?.focus(); }
    }}>
      <summary className="hd-message-action" aria-label={r("messageMore")}><EllipsisHorizontalIcon /></summary>
      <div className="hd-message-options">
        <MessageCopyButton text={open ? plainMessageText(body.current, text) : text} copyLabel={r("copyPlainText")} copiedLabel={copiedLabel} failedLabel={failedLabel} showLabel />
        <button type="button" onClick={selectText}>{r("selectMessageText")}</button>
      </div>
    </details>
  </div>;
}
