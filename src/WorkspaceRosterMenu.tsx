import { BookmarkIcon, EnvelopeIcon, FolderIcon, PencilSquareIcon, AdjustmentsHorizontalIcon, EyeSlashIcon, EyeIcon, TrashIcon, ArrowTopRightOnSquareIcon, PlusIcon, MinusIcon, CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { rosterMenuPosition } from "./roster-menu-position";
import { redesignText } from "./desktop-redesign-copy";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

interface Props {
  agent: WorkspaceDevAgent; x: number; y: number; locale: string; pinned: boolean; hidden?: boolean; unread?: boolean;
  targetKind?: "colleague" | "group"; conversationId?: string;
  folders?: string[]; currentFolder?: string;
  onClose(): void; onManage(): void; onPin(): void; onMove(): void; onUnread(): void; onRename(): void; onHide(): void;
  onMoveTo?(folder: string): void; onArchive?(): void; onNewSession?(): void; onCopyId?(): void;
}
export function WorkspaceRosterMenu({ agent, x, y, locale, pinned, hidden = false, unread = false, targetKind = "colleague", folders = [], currentFolder, onClose, onManage, onPin, onMove, onUnread, onRename, onHide, onMoveTo, onArchive, onNewSession }: Props) {
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const ref = useRef<HTMLDivElement>(null), sub = useRef<HTMLDivElement>(null), folderTrigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const close = useRef(onClose); close.current = onClose;
  const [submenu, setSubmenu] = useState(false);
  const [position, setPosition] = useState(() => rosterMenuPosition(x, y, 250, 0, typeof window === "undefined" ? 1280 : window.innerWidth, typeof window === "undefined" ? 800 : window.innerHeight));
  const [subPosition, setSubPosition] = useState({ left: 0, top: 0, maxHeight: 0 });
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect(), next = rosterMenuPosition(x, y, rect.width, node.scrollHeight + 2, window.innerWidth, window.innerHeight);
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight ? previous : next);
      if (submenu && sub.current && folderTrigger.current) {
        const anchor = folderTrigger.current.getBoundingClientRect(), width = sub.current.getBoundingClientRect().width;
        const left = anchor.right + width + 4 < window.innerWidth - 8 ? anchor.right + 4 : Math.max(8, anchor.left - width - 4);
        setSubPosition(rosterMenuPosition(left, anchor.top, width, sub.current.scrollHeight + 2, window.innerWidth, window.innerHeight));
      }
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    if (sub.current) observer.observe(sub.current);
    window.addEventListener("resize", measure); node.addEventListener("scroll", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); node.removeEventListener("scroll", measure); };
  }, [x, y, submenu, folders.join("\0")]);
  useEffect(() => {
    ref.current?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !sub.current?.contains(event.target as Node)) close.current(); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); const previous = previousFocus.current;
      queueMicrotask(() => { if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) previous.focus({ preventScroll: true }); }); };
  }, []);
  useEffect(() => { if (submenu) sub.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [submenu]);
  const keys = (event: KeyboardEvent<HTMLDivElement>, nested = false) => {
    const node = nested ? sub.current : ref.current; if (!node) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (nested) { setSubmenu(false); folderTrigger.current?.focus(); } else onClose(); return; }
    if (event.key === "ArrowLeft" && nested) { event.preventDefault(); event.stopPropagation(); setSubmenu(false); folderTrigger.current?.focus(); return; }
    if (event.key === "ArrowRight" && document.activeElement === folderTrigger.current) { event.preventDefault(); setSubmenu(true); return; }
    if (event.key === "Tab") { onClose(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = [...node.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")]; if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index < 0 ? items.length - 1 : index - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  const item = (label: string, action: () => void, symbol: ReactNode, danger = false, shortcut?: string) => <button type="button" role="menuitem" className={danger ? "danger" : ""} onClick={() => { onClose(); action(); }}><span aria-hidden="true">{symbol}</span><span>{label}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}</button>;
  const main = agent.kind === "main";
  return <>
    <div ref={ref} className="vg-roster-menu hd-roster-menu" role="menu" tabIndex={0} aria-label={`${agent.identity.displayName} · ${r("more")}`} onKeyDown={event => keys(event)} style={position}>
      <div className="hd-menu-name">{agent.identity.displayName}</div>
      {main ? <>{item(r(unread ? "read" : "unread"), onUnread, <EnvelopeIcon />)}{item(r("manageHara"), onManage, <AdjustmentsHorizontalIcon />)}{onNewSession ? item(r("newSession"), onNewSession, <ArrowTopRightOnSquareIcon />, false, "⌘N") : null}</> : <>
        {item(r(pinned ? "unpin" : "pin"), onPin, <BookmarkIcon />)}{item(r(unread ? "read" : "unread"), onUnread, <EnvelopeIcon />)}
        <button type="button" ref={folderTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={submenu} onClick={() => setSubmenu(value => !value)}><span aria-hidden="true"><FolderIcon /></span><span>{r("folder")}</span><span aria-hidden="true"><ChevronRightIcon /></span></button>
        <hr />{item(r(targetKind === "group" ? "renameGroup" : "renameColleague"), onRename, <PencilSquareIcon />)}{item(r(targetKind === "group" ? "manageGroup" : "manageColleague"), onManage, <AdjustmentsHorizontalIcon />, false, "⌘I")}
        <hr />{item(r(hidden ? "show" : "hide"), onHide, hidden ? <EyeIcon /> : <EyeSlashIcon />)}
        {targetKind !== "group" && onArchive ? item(r("deleteColleague"), onArchive, <TrashIcon />, true) : null}
      </>}
    </div>
    {submenu ? createPortal(<div ref={sub} className="vg-roster-menu hd-roster-menu hd-folder-menu" role="menu" aria-label={r("folder")} onKeyDown={event => keys(event, true)} style={subPosition}>
      {folders.map(folder => <button type="button" role="menuitemradio" aria-checked={currentFolder === folder} key={folder} onClick={() => { onClose(); onMoveTo?.(folder); }}><span aria-hidden="true">{currentFolder === folder ? <CheckIcon /> : null}</span><span>{folder} {currentFolder === folder ? r("current") : ""}</span></button>)}
      {folders.length ? <hr /> : null}{item(r("newFolder"), onMove, <PlusIcon />)}{currentFolder ? item(r("removeFolder"), () => onMoveTo?.(""), <MinusIcon />) : null}
    </div>, document.body) : null}
  </>;
}
