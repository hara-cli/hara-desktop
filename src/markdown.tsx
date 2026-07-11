// Assistant-bubble markdown (Codex.app renders md; so do we). marked → DOMPurify → innerHTML,
// memoized per text. Links open in the system browser via the opener plugin — never navigate the
// webview (that would replace the whole app with the linked page).
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";

marked.setOptions({ gfm: true, breaks: true });

export function Md({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
    } catch {
      return "";
    }
  }, [text]);
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) void openUrl(href).catch(() => {});
  };
  // fallback to plain text when sanitize/parse produced nothing for non-empty input
  if (!html && text.trim()) return <>{text}</>;
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
