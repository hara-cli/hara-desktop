// Assistant-bubble markdown (Codex.app renders md; so do we). marked → DOMPurify → innerHTML,
// memoized per text. Links open in the system browser via the opener plugin — never navigate the
// webview (that would replace the whole app with the linked page).
import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyTextToClipboard } from "./clipboard";

marked.setOptions({ gfm: true, breaks: true });

export function Md({
  text,
  copyCodeLabel,
  copiedLabel,
  copyFailedLabel,
}: {
  text: string;
  copyCodeLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => {
    try {
      return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
    } catch {
      return "";
    }
  }, [text]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];
    root.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;
      pre.classList.add("has-code-copy");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "md-code-copy";
      button.textContent = copyCodeLabel;
      button.setAttribute("aria-label", copyCodeLabel);
      button.title = copyCodeLabel;
      let resetTimer: number | null = null;
      const onCopy = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyTextToClipboard(code.textContent ?? "").then((ok) => {
          const label = ok ? copiedLabel : copyFailedLabel;
          button.textContent = label;
          button.setAttribute("aria-label", label);
          button.title = label;
          if (resetTimer !== null) window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(() => {
            button.textContent = copyCodeLabel;
            button.setAttribute("aria-label", copyCodeLabel);
            button.title = copyCodeLabel;
            resetTimer = null;
          }, 1_600);
        });
      };
      button.addEventListener("click", onCopy);
      pre.appendChild(button);
      cleanups.push(() => {
        if (resetTimer !== null) window.clearTimeout(resetTimer);
        button.removeEventListener("click", onCopy);
        button.remove();
        pre.classList.remove("has-code-copy");
      });
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [html, copyCodeLabel, copiedLabel, copyFailedLabel]);
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) void openUrl(href).catch(() => {});
  };
  // fallback to plain text when sanitize/parse produced nothing for non-empty input
  if (!html && text.trim()) return <>{text}</>;
  return <div ref={rootRef} className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
