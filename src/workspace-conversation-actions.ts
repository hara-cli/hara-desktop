import { isInternalUserText, userVisibleText } from "./user-visible-text.ts";
import type { WorkspaceDevMessage } from "./workspace-dev-state";
/** Export only the selected conversation's visible human/model messages, never hidden tool bodies. */
export function conversationMarkdown(history: readonly WorkspaceDevMessage[], colleague: string,
  options: { historyStart?: number; userLabel?: string; authors?: readonly string[] } = {}): string {
  const start = options.historyStart ?? 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > history.length || options.authors && options.authors.length !== history.length)
    throw new Error("Conversation export boundary unavailable");
  const label = (value: string) => value.replace(/[\r\n]/gu, " ").trim();
  const rows = history.slice(start).flatMap((message, index) => {
    if (message.role === "tool" || message.role === "user" && isInternalUserText(message.content)) return [];
    const body = message.role === "user" ? userVisibleText(message.content) : message.text;
    if (!body.trim()) return [];
    const author = options.authors?.[start + index] ?? (message.role === "user" ? options.userLabel ?? "You" : colleague);
    return [`### ${label(author)}\n\n${body}`];
  });
  return `# ${label(colleague)}\n\n${rows.join("\n\n---\n\n")}\n`;
}
export function findTranscriptMatch(root: HTMLElement, query: string, index: number): { count: number; index: number } {
  if (!query.trim()) return { count: 0, index: 0 };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), parts: Array<{ node: Text; start: number; end: number }> = [];
  let text = "", node: Node | null, previousBubble: Element | null = null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement; if (!parent?.closest(".hs-bub") || parent.closest("button, .hd-media-card, [aria-hidden='true'], [hidden]")) continue;
    const bubble = parent.closest(".hs-bub"); if (previousBubble && previousBubble !== bubble) text += "\0"; previousBubble = bubble;
    const content = node.textContent ?? ""; parts.push({ node: node as Text, start: text.length, end: text.length + content.length }); text += content;
  }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), matches = [...text.matchAll(pattern)];
  if (!matches.length) return { count: 0, index: 0 };
  const selected = ((index % matches.length) + matches.length) % matches.length, start = matches[selected].index!, end = start + matches[selected][0].length;
  const first = parts.find(part => start >= part.start && start < part.end), last = parts.find(part => end > part.start && end <= part.end);
  if (first && last) { const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); first.node.parentElement?.closest(".wsd-message")?.scrollIntoView({ block: "center" }); }
  return { count: matches.length, index: selected };
}
