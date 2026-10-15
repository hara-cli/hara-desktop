interface ScrollMetrics { scrollTop: number; scrollHeight: number; clientHeight: number }
/** In-memory viewport intent only; no messages, credentials, timers or DOM ownership. */
export class WorkspaceChatScroll {
  following = true;
  unread = false;
  private scope = "";
  private lastMessage: string | null = null;
  private pendingKey: string | null = null;
  private anchor: { top: number; height: number } | null = null;
  observe(node: ScrollMetrics) {
    this.following = node.scrollHeight - node.clientHeight - node.scrollTop <= 80;
    if (this.following) this.unread = false;
  }
  beforeOlder(node: ScrollMetrics) {
    this.anchor = { top: node.scrollTop, height: node.scrollHeight };
    this.following = false;
  }
  latest(node: ScrollMetrics) {
    this.following = true; this.unread = false; this.anchor = null;
    node.scrollTop = node.scrollHeight;
  }
  layout(node: ScrollMetrics, scope: string, lastMessage: string | null, pendingKey: string | null, historyBusy: boolean) {
    if (this.scope !== scope) {
      this.scope = scope; this.following = true; this.unread = false;
      this.anchor = null; this.lastMessage = lastMessage; this.pendingKey = pendingKey;
    }
    if (pendingKey && pendingKey !== this.pendingKey) { this.following = true; this.anchor = null; }
    this.pendingKey = pendingKey;
    if (this.anchor) {
      if (historyBusy) return;
      node.scrollTop = Math.max(0, this.anchor.top + node.scrollHeight - this.anchor.height);
      this.anchor = null;
    }
    if (lastMessage !== this.lastMessage && !this.following) this.unread = true;
    this.lastMessage = lastMessage;
    if (this.following) node.scrollTop = node.scrollHeight;
  }
}
export function submitsWorkspaceMessage(event: { key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean; isComposing?: boolean; keyCode?: number }) {
  return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    && !event.repeat && !event.isComposing && event.keyCode !== 229;
}
