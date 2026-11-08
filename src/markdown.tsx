import { localMediaPath, type WorkspaceMediaAccess, type WorkspaceMediaDescription } from "./workspace-media";
// Assistant-bubble markdown (Codex.app renders md; so do we). marked → DOMPurify → innerHTML,
// memoized per text. Links open in the system browser via the opener plugin — never navigate the
// webview (that would replace the whole app with the linked page).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceMediaCard } from "./WorkspaceMediaCard";
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
  media, mediaUnavailableLabel = "Unable to display", locale = "en",
}: {
  text: string;
  copyCodeLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
  media?: WorkspaceMediaAccess; mediaUnavailableLabel?: string; revealMediaLabel?: string; locale?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaScope = media?.mediaScope ?? "";
  const [targets, setTargets] = useState<Array<{ node: HTMLElement; path: string; alt: string; kind: "image" | "video" | "file" }>>([]);
  const html = useMemo(() => {
    try {
      const parsed = marked.parse(text, { async: false }) as string;
      if (typeof document === "undefined") return DOMPurify.sanitize(parsed);
      const template = document.createElement("template"); template.innerHTML = parsed;
      for (const node of template.content.querySelectorAll("img,video")) {
        const source = node.getAttribute("src") ?? node.querySelector("source")?.getAttribute("src") ?? "";
        const local = localMediaPath(source);
        if (local !== null) { const placeholder = document.createElement("span"); placeholder.setAttribute("data-hara-media-source", local);
          placeholder.setAttribute("data-hara-media-kind", node.tagName === "VIDEO" ? "video" : "image"); placeholder.setAttribute("data-hara-media-alt", node.getAttribute("alt") ?? "");
          const wrappingLink = node.closest("a"); node.replaceWith(placeholder);
          // Local media owns its click (zoom/play); it must never navigate the App through an enclosing Markdown link.
          if (wrappingLink) wrappingLink.replaceWith(...wrappingLink.childNodes); }
      }
      for (const node of template.content.querySelectorAll("a[href]")) {
        const local = localMediaPath(node.getAttribute("href") ?? "");
        if (local !== null && /\.(?:pdf|zip|xlsx|md|txt)$/iu.test(local)) { const placeholder = document.createElement("span");
          placeholder.setAttribute("data-hara-media-source", local); placeholder.setAttribute("data-hara-media-kind", "file"); placeholder.setAttribute("data-hara-media-alt", node.textContent ?? ""); node.replaceWith(placeholder); }
      }
      return DOMPurify.sanitize(template.innerHTML);
    } catch {
      return "";
    }
  }, [text]);
  // React compares this object by identity. Keep it stable so parent metadata/menu renders do not
  // replace the code-copy/media nodes installed by effects. A Workspace scope change replaces the root.
  const markup = useMemo(() => ({ __html: html }), [html]);
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
  }, [html, mediaScope, copyCodeLabel, copiedLabel, copyFailedLabel]);
  const mediaRequests = useMemo(() => new Map<string, Promise<WorkspaceMediaDescription>>(), [media, mediaScope, html]);
  const loadMedia = useCallback((path: string, refresh: boolean): Promise<WorkspaceMediaDescription> => {
    if (refresh) mediaRequests.delete(path);
    const previous = mediaRequests.get(path); if (previous) return previous;
    const request = media?.describeMedia ? media.describeMedia(path, mediaScope) : media ? media.registerMedia(path, mediaScope).then(value => ({ state: "ready" as const, media: value })) : Promise.reject(new Error("Media unavailable"));
    mediaRequests.set(path, request); return request;
  }, [media, mediaScope, mediaRequests]);
  useLayoutEffect(() => {
    const root = rootRef.current; if (!root) return;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-hara-media-source]")];
    setTargets(nodes.slice(0, 64).map(node => ({ node, path: node.getAttribute("data-hara-media-source") ?? "", alt: node.getAttribute("data-hara-media-alt") ?? "", kind: node.getAttribute("data-hara-media-kind") === "file" ? "file" as const : node.getAttribute("data-hara-media-kind") === "video" ? "video" as const : "image" as const })));
    for (const node of nodes.slice(64)) node.textContent = mediaUnavailableLabel;
  }, [html, mediaScope, mediaUnavailableLabel]);
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) void openUrl(href).catch(() => {});
  };
  // fallback to plain text when sanitize/parse produced nothing for non-empty input
  if (!html && text.trim()) return <>{text}</>;
  return <><div key={mediaScope} ref={rootRef} className="md" onClick={onClick} dangerouslySetInnerHTML={markup} />{targets.filter(target => target.node.isConnected && rootRef.current?.contains(target.node)).map((target, index) => createPortal(<WorkspaceMediaCard key={`${mediaScope}:${index}:${target.path}`} source={target.path} alt={target.alt} kind={target.kind} media={media} scope={mediaScope} locale={locale} load={loadMedia} />, target.node, `${mediaScope}:${index}:${target.path}`))}</>;
}
