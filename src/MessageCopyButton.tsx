import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "./clipboard";
import { IconCopy } from "./icons";
import "./MessageCopyButton.css";

type CopyState = "idle" | "copied" | "failed";

interface MessageCopyButtonProps {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
}

export function MessageCopyButton({
  text,
  copyLabel,
  copiedLabel,
  failedLabel,
  className = "",
}: MessageCopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setState("idle");
  }, [text]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const label = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : copyLabel;
  const copy = (): void => {
    void copyTextToClipboard(text).then((ok) => {
      setState(ok ? "copied" : "failed");
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setState("idle");
        timerRef.current = null;
      }, 1_600);
    });
  };

  return (
    <button
      type="button"
      className={`message-copy-button${className ? ` ${className}` : ""}`}
      data-state={state}
      aria-label={label}
      title={label}
      onClick={copy}
    >
      <IconCopy size={14} />
      {state !== "idle" ? <span aria-live="polite">{label}</span> : null}
    </button>
  );
}
