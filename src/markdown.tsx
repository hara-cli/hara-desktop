import { localMediaPath, workspaceMediaUrl, revealWorkspaceMedia, type WorkspaceMediaAccess, type WorkspaceMedia } from "./workspace-media";
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
  media, mediaUnavailableLabel = "Unable to display", revealMediaLabel = "Show in Finder",
}: {
  text: string;
  copyCodeLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
  media?: WorkspaceMediaAccess; mediaUnavailableLabel?: string; revealMediaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaScope = media?.mediaScope ?? "";
  const html = useMemo(() => {
    try {
      const parsed = marked.parse(text, { async: false }) as string;
      if (typeof document === "undefined") return DOMPurify.sanitize(parsed);
      const template = document.createElement("template"); template.innerHTML = parsed;
      for (const node of template.content.querySelectorAll("img,video")) {
        const source = node.getAttribute("src") ?? node.querySelector("source")?.getAttribute("src") ?? "";
        const local = localMediaPath(source);
        if (local !== null) { node.removeAttribute("src"); node.removeAttribute("srcset"); node.querySelectorAll("source").forEach(source => source.remove()); node.setAttribute("data-hara-media-source", local); }
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
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    let disposed = false; const cleanups: Array<() => void> = [], pending = new Map<string, Promise<WorkspaceMedia>>();
    for (const original of root.querySelectorAll<HTMLElement>("[data-hara-media-source]")) {
      const path = original.getAttribute("data-hara-media-source") ?? "";
      const wrapper = document.createElement("span"); wrapper.className = "md-media"; original.replaceWith(wrapper);
      let registered: WorkspaceMedia | undefined, content: HTMLImageElement | HTMLVideoElement | undefined;
      const failed = () => {
        if (disposed) return;
        wrapper.replaceChildren(); wrapper.classList.add("md-media-failed");
        const label = document.createElement("span"); label.textContent = mediaUnavailableLabel; label.setAttribute("role", "status");
        const reveal = document.createElement("button"); reveal.type = "button"; reveal.textContent = revealMediaLabel; reveal.disabled = !registered;
        reveal.onclick = event => { event.preventDefault(); event.stopPropagation(); if (registered) void revealWorkspaceMedia(registered.id).catch(() => { label.textContent = mediaUnavailableLabel; }); };
        wrapper.append(label, reveal);
      };
      const request = pending.get(path) ?? (media ? media.registerMedia(path, mediaScope) : Promise.reject(new Error("Media unavailable")));
      pending.set(path, request);
      void request.then(value => {
        if (disposed) return; registered = value;
        if (value.mime.startsWith("video/")) { const video = document.createElement("video"); video.controls = true; video.playsInline = true; video.preload = "metadata"; content = video; }
        else { const image = document.createElement("img"); image.alt = original.getAttribute("alt") ?? ""; content = image; }
        content.className = "md-media-content"; content.addEventListener("error", failed); content.src = workspaceMediaUrl(value.id); wrapper.replaceChildren(content);
      }).catch(failed);
      cleanups.push(() => { if (content) { content.removeEventListener("error", failed); content.removeAttribute("src"); if (content instanceof HTMLVideoElement) content.load(); } wrapper.replaceWith(original); });
    }
    return () => { disposed = true; cleanups.forEach(cleanup => cleanup()); };
  }, [html, media, mediaScope, mediaUnavailableLabel, revealMediaLabel]);
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) void openUrl(href).catch(() => {});
  };
  // fallback to plain text when sanitize/parse produced nothing for non-empty input
  if (!html && text.trim()) return <>{text}</>;
  return <div key={mediaScope} ref={rootRef} className="md" onClick={onClick} dangerouslySetInnerHTML={markup} />;
}
