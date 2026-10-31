import { useEffect, useRef } from "react";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

export function WorkspaceRosterMenu({ agent, x, y, locale, pinned, hidden = false, conversationId, onClose, onManage, onPin, onMove, onUnread, onRename, onCopyId, onHide, onDelete }: {
  agent: WorkspaceDevAgent; x: number; y: number; locale: string; pinned: boolean; hidden?: boolean; conversationId?: string;
  onClose(): void; onManage(): void; onPin(): void; onMove(): void; onUnread(): void; onRename(): void; onCopyId(): void; onHide(): void; onDelete(): void;
}) {
  const ref = useRef<HTMLDivElement>(null), zh = locale !== "en";
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [onClose]);
  const item = (label: string, action: () => void, disabled = false, danger = false) => <button role="menuitem" disabled={disabled} className={danger ? "danger" : ""} onClick={() => { onClose(); action(); }}>{label}</button>;
  return <div ref={ref} className="vg-roster-menu" role="menu" aria-label={zh ? `${agent.identity.displayName} 菜单` : `${agent.identity.displayName} menu`}
    style={{ left: Math.max(8, Math.min(x, window.innerWidth - 260)), top: Math.max(8, Math.min(y, window.innerHeight - 350)) }}>
    {item(pinned ? (zh ? "取消置顶" : "Unpin") : (zh ? "置顶" : "Pin"), onPin, agent.kind === "main")}
    {item(zh ? "移至新分组" : "Move to new section", onMove, agent.kind === "main")}
    {item(zh ? "标记未读" : "Mark as Unread", onUnread, agent.kind === "main")}
    <hr />{item(zh ? "重命名 Bot" : "Rename Bot", onRename)}
    <hr />{item(zh ? "复制对话 ID" : "Copy conversation ID", onCopyId, !conversationId)}
    <hr />{item(hidden ? (zh ? "在侧边栏显示" : "Show in sidebar") : (zh ? "从侧边栏隐藏" : "Hide from sidebar"), onHide, agent.kind === "main")}
    {agent.kind === "colleague" ? item(zh ? "删除" : "Delete", onDelete, false, true) : null}
    <hr />{item(zh ? "管理" : "Manage", onManage)}
  </div>;
}
