import { rosterMenuPosition } from "./roster-menu-position";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

export function WorkspaceRosterMenu({ agent, x, y, locale, pinned, hidden = false, conversationId, onClose, onManage, onPin, onMove, onUnread, onRename, onCopyId, onHide }: {
  agent: WorkspaceDevAgent; x: number; y: number; locale: string; pinned: boolean; hidden?: boolean; conversationId?: string;
  onClose(): void; onManage(): void; onPin(): void; onMove(): void; onUnread(): void; onRename(): void; onCopyId(): void; onHide(): void;
}) {
  const ref = useRef<HTMLDivElement>(null), zh = locale !== "en";
  const [position, setPosition] = useState(() => rosterMenuPosition(x, y, 250, 0, window.innerWidth, window.innerHeight));
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const next = rosterMenuPosition(x, y, rect.width, node.scrollHeight + 2, window.innerWidth, window.innerHeight);
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [x, y]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [onClose]);
  const item = (label: string, action: () => void, disabled = false, danger = false) => <button role="menuitem" disabled={disabled} className={danger ? "danger" : ""} onClick={() => { onClose(); action(); }}>{label}</button>;
  return <div ref={ref} className="vg-roster-menu" role="menu" aria-label={zh ? `${agent.identity.displayName} 菜单` : `${agent.identity.displayName} menu`}
    style={position}>
    {item(pinned ? (zh ? "取消置顶" : "Unpin") : (zh ? "置顶" : "Pin"), onPin, agent.kind === "main")}
    {item(zh ? "移至新分组" : "Move to new section", onMove, agent.kind === "main")}
    {item(zh ? "标记未读" : "Mark as Unread", onUnread, agent.kind === "main")}
    <hr />{item(zh ? "重命名 Bot" : "Rename Bot", onRename)}
    <hr />{item(zh ? "复制对话 ID" : "Copy conversation ID", onCopyId, !conversationId)}
    <hr />{item(hidden ? (zh ? "在侧边栏显示" : "Show in sidebar") : (zh ? "从侧边栏隐藏" : "Hide from sidebar"), onHide, agent.kind === "main")}
    <hr />{item(zh ? "管理" : "Manage", onManage)}
  </div>;
}
