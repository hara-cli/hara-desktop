import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Cog6ToothIcon, MagnifyingGlassIcon, PlusIcon, UsersIcon, ChevronDownIcon, InboxIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { SidebarAvatar } from "./SidebarAvatar";
import { redesignText } from "./desktop-redesign-copy";
import { rosterGroups, rosterShortRole, rosterTooltipText, folderPreferenceKey, type RosterEntry, type RosterPreference } from "./workspace-roster";
import type { WorkspaceDevAgent, WorkspaceDevDirectory } from "./workspace-dev-state";
import { isImeCompositionKey } from "./ime";
export interface SidebarEntry extends RosterEntry { agent?: WorkspaceDevAgent }
interface Props {
  locale: string; workspaceId: string | null; workspaceName: string; directory: WorkspaceDevDirectory | null;
  main?: WorkspaceDevAgent; mainEntry?: SidebarEntry; mainPreview: string; mainActive: boolean; selectedId: string | null;
  entries: SidebarEntry[]; preferences: Record<string, RosterPreference>; search: string; needsYou: number; count: number;
  disconnected: boolean; loading: boolean; inert: boolean; menuOpen: boolean; userLabel: string; settingsLabel: string;
  onSearch(value: string): void; onSelect(id: string, kind: "colleague" | "group"): void;
  onContextMenu(event: Pick<MouseEvent<HTMLButtonElement>, "clientX" | "clientY" | "currentTarget">, id: string, kind: "colleague" | "group"): void;
  onPreference(id: string, change: RosterPreference): void; onNeedsYou(): void; onColleagues(): void;
  onWorkspace(id: string): void; onDiscuss(): void; onNewGroup?(): void;
  onSettings(): void; onAccount(): void; onRenameWorkspace?(): void;
  rename?: { id: string; name: string; pending: boolean; duplicate?: boolean } | null;
  onRenameChange?(name: string): void; onRenameCommit?(): void; onRenameCancel?(): void; duplicateLabel?: string;
}
export function WorkspaceSidebarC(props: Props) {
  const { locale, main, entries, preferences, search } = props;
  const r = (key: Parameters<typeof redesignText>[1], values: Record<string, string | number> = {}) => redesignText(locale, key, values);
  const [popup, setPopup] = useState<"workspace" | "new" | null>(null), [hidden, setHidden] = useState(false);
  const [tooltip, setTooltip] = useState<{ id: string; text: string; left: number; top: number } | null>(null), tipId = useId();
  const list = useRef<HTMLElement>(null), popover = useRef<HTMLDivElement>(null), workspaceButton = useRef<HTMLButtonElement>(null), plus = useRef<HTMLButtonElement>(null);
  const grouped = rosterGroups(entries, preferences, search);
  // Only an existing multi-workspace install can switch; creating another workspace needs a Hara account.
  const switchable = (props.directory?.workspaces.filter(workspace => workspace.active).length ?? 0) > 1;
  // "Recent" only distinguishes something when pinned rows or folders sit above it (design Q7).
  const recentHeading = !grouped.searching && (grouped.pinned.length > 0 || grouped.folders.length > 0);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTooltip = useCallback(() => {
    if (tipTimer.current !== null) clearTimeout(tipTimer.current);
    tipTimer.current = null; setTooltip(null);
  }, []);
  useEffect(() => { hideTooltip(); }, [props.workspaceId, props.menuOpen, popup, hideTooltip]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hideTooltip(); };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); if (tipTimer.current !== null) clearTimeout(tipTimer.current); };
  }, [hideTooltip]);
  useEffect(() => {
    if (!popup) return;
    popover.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!popover.current?.contains(event.target as Node) && !workspaceButton.current?.contains(event.target as Node) && !plus.current?.contains(event.target as Node)) setPopup(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPopup(null); (popup === "workspace" ? workspaceButton : plus).current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [popup]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" }); }, [props.selectedId]);
  useEffect(() => { setPopup(null); setHidden(false); }, [props.workspaceId]);
  const popupKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")]; if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement), next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; items[next]?.focus();
  };
  const showTooltip = (node: HTMLButtonElement, entry: SidebarEntry) => {
    hideTooltip();
    const label = node.querySelector<HTMLElement>(".hd-row-name");
    const text = rosterTooltipText(entry, Boolean(label && label.scrollWidth > label.clientWidth), entry.agent?.kind === "main");
    if (props.menuOpen || !text) return;
    tipTimer.current = setTimeout(() => {
      tipTimer.current = null;
      if (!node.isConnected) return;
      const rect = node.getBoundingClientRect();
      setTooltip({ id: entry.id, text,
        left: Math.max(8, Math.min(window.innerWidth - 300, rect.left + 10)), top: Math.max(8, rect.top - 44) });
    }, 600);
  };
  const context = (event: MouseEvent<HTMLButtonElement>, id: string, kind: "colleague" | "group") => {
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); hideTooltip(); props.onContextMenu(event, id, kind);
  };
  const keyboardContext = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string, kind: "colleague" | "group") => {
    if (event.key === "Escape") { hideTooltip(); return; }
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); hideTooltip();
    props.onContextMenu({ currentTarget: event.currentTarget, clientX: 0, clientY: 0 }, id, kind);
  };
  const row = (entry: SidebarEntry, recovering = false) => {
    const unread = Math.max(entry.unread, preferences[entry.id]?.unread ? 1 : 0), date = entry.timestamp ? new Date(entry.timestamp) : null;
    const time = date && Number.isFinite(date.getTime()) ? date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString(locale, { month: "numeric", day: "numeric" }) : "";
    const isMain = entry.agent?.kind === "main", muted = preferences[entry.id]?.muted === true;
    const descriptionId = `${tipId}-row-${encodeURIComponent(entry.id)}`;
    const attention = entry.needsYou ?? 0, shortRole = entry.kind === "group" ? entry.role : rosterShortRole(entry.role, entry.shortRole);
    const label = [entry.name, entry.role, unread > 0 ? r(muted ? "mutedUnread" : "unreadCount", { n: unread }) : "", attention > 0 ? r("needsYouCount", { n: attention }) : "", preferences[entry.id]?.hidden ? r("hidden") : ""].filter(Boolean).join(", ");
    if (props.rename?.id === entry.id) return <div key={entry.id} className="hd-inline-rename" role="group" aria-label={r(entry.kind === "group" ? "renameGroup" : "renameColleague")}>
      <input aria-label={r(entry.kind === "group" ? "renameGroup" : "renameColleague")} autoFocus maxLength={80} value={props.rename.name} disabled={props.rename.pending} onChange={event => props.onRenameChange?.(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); props.onRenameCancel?.(); } else if (event.key === "Enter" && !isImeCompositionKey(event.nativeEvent) && props.rename?.name.trim()) { event.preventDefault(); props.onRenameCommit?.(); } }} />
      {props.rename.duplicate ? <small role="status">{props.duplicateLabel}</small> : null}
    </div>;
    return <div key={entry.id} className="hd-row-wrap">
      <button type="button" className={`hs-row wsd-contact hd-roster-row${isMain ? " hs-main hd-main-card" : ""}`} data-roster-id={entry.id} data-group-id={entry.kind === "group" ? entry.id.slice(8) : undefined} aria-label={label}
        disabled={props.loading} aria-current={(isMain ? props.mainActive : props.selectedId === entry.id) ? "page" : undefined} aria-describedby={descriptionId}
        onClick={() => props.onSelect(entry.id, entry.kind)} onContextMenu={event => context(event, entry.id, entry.kind)} onKeyDown={event => keyboardContext(event, entry.id, entry.kind)}
        onPointerEnter={event => showTooltip(event.currentTarget, entry)} onPointerLeave={hideTooltip} onFocus={event => showTooltip(event.currentTarget, entry)} onBlur={hideTooltip}>
        <SidebarAvatar agent={entry.agent} members={entry.members} />
        <span className="hd-row-text">
          <span className="hd-row-heading"><strong className="hd-row-name">{entry.name}</strong>{shortRole ? <span className="hd-row-role">· {shortRole}</span> : null}{grouped.searching && preferences[entry.id]?.hidden ? <small className="hd-row-hidden">{r("hidden")}</small> : null}</span>
          <span className={`hd-row-preview${entry.preview.trim() ? "" : " is-empty"}`}>{(entry.preview.trim() || r("noMessages")).replace(/\s+/gu, " ").slice(0, 160)}</span>
        </span>
        <span className="hd-row-meta">
          {time ? <time dateTime={entry.timestamp}>{time}</time> : <span />}
          <span className="hd-row-badges">
            {unread > 0 ? <span className={muted ? "hd-unread-dot" : "hd-unread"} aria-label={r(muted ? "mutedUnread" : "unreadCount", { n: unread })}>{muted ? null : unread > 99 ? "99+" : unread}</span> : null}
            {attention > 0 ? <span className="hd-row-needs-you" aria-label={r("needsYouCount", { n: attention })}><InboxIcon className="hico" /></span> : null}
          </span>
        </span>
        <span id={descriptionId} className="hd-visually-hidden">{(entry.preview.trim() || r("noMessages")).replace(/\s+/gu, " ").slice(0, 160)}{time ? ` · ${time}` : ""}</span>
      </button>
      {recovering ? <button type="button" className="hd-show-hidden" onClick={() => props.onPreference(entry.id, { hidden: false })}>{r("show")}</button> : null}
    </div>;
  };
  const popupAction = (label: string, action: () => void) => <button type="button" role="menuitem" onClick={() => { setPopup(null); action(); }}>{label}</button>;
  return <aside className="hs-side wsd-sidebar hd-sidebar" inert={props.inert}>
    <div className="hs-titlebar-drag" data-tauri-drag-region="" aria-hidden="true" />
    <div className="hd-sidebar-tools"><label><MagnifyingGlassIcon className="hico" /><input type="search" aria-label={r("search")} placeholder={r("search")} value={search} onChange={event => props.onSearch(event.target.value)} /></label>
      <button type="button" className="hs-icon" ref={plus} aria-label={r("new")} aria-expanded={popup === "new"} aria-haspopup="menu" onClick={() => setPopup(value => value === "new" ? null : "new")}><PlusIcon className="hico" /></button></div>
    {popup === "new" ? <div ref={popover} className="hd-sidebar-popup hd-new-menu" onKeyDown={popupKeys} role="menu" aria-label={r("new")}>{popupAction(r("newColleague"), props.onDiscuss)}{props.onNewGroup ? popupAction(r("newGroup"), props.onNewGroup) : null}</div> : null}
    <div className="hd-sidebar-anchor" role="group" aria-label={r("conversationShortcuts")}>
      {main ? row(props.mainEntry ?? { id: main.agentId, kind: "colleague", name: main.identity.displayName, role: r("orchestrator"), preview: props.mainPreview, order: 0, unread: 0, agent: main }) : null}
      <button type="button" className="hd-needs-you" onClick={props.onNeedsYou}><InboxIcon className="hico" /><span>{r("needsYou")}</span>{props.needsYou ? <span className="hd-unread">{props.needsYou}</span> : null}</button>
    </div>
    <nav ref={list} className="hd-sidebar-list" aria-label={r("search")}>
      {grouped.pinned.length ? <section aria-label={r("pinned")}><h3 className="hd-roster-heading">{r("pinned")}</h3>{grouped.pinned.map(entry => row(entry))}</section> : null}
      {grouped.folders.map(folder => <section key={folder.name} aria-label={folder.name}><button type="button" className="hd-roster-heading hd-folder-heading" aria-expanded={!folder.collapsed} onClick={() => props.onPreference(folderPreferenceKey(folder.name), { collapsed: !folder.collapsed })}><ChevronDownIcon className={`hico${folder.collapsed ? " collapsed" : ""}`} /><span>{folder.name} · {folder.rows.length}</span>{folder.collapsed && folder.unread ? <span className="hd-unread">{folder.unread}</span> : null}</button>{!folder.collapsed ? folder.rows.map(entry => row(entry)) : null}</section>)}
      {grouped.recent.length ? <section aria-label={r("recent")}>{recentHeading ? <h3 className="hd-roster-heading">{r("recent")}</h3> : !grouped.searching ? <div className="hd-roster-gap" aria-hidden="true" /> : null}{grouped.recent.map(entry => row(entry))}</section> : grouped.searching ? <p className="hs-empty">{r("empty")}</p> : null}
      {!grouped.searching && grouped.hidden.length ? <section className="hd-hidden-list"><button type="button" className="hd-hidden-toggle" aria-expanded={hidden} onClick={() => setHidden(value => !value)}><EyeSlashIcon className="hico" />{r("hiddenCount", { n: grouped.hidden.length })}<ChevronDownIcon className={`hico${hidden ? "" : " collapsed"}`} /></button>{hidden ? grouped.hidden.map(entry => row(entry, true)) : null}</section> : null}
    </nav>
    <footer className="hd-user-area"><button type="button" ref={workspaceButton} className="hd-workspace-trigger" aria-haspopup="menu" aria-expanded={popup === "workspace"} aria-label={r("workspacesAndAccount")} onClick={() => setPopup(value => value === "workspace" ? null : "workspace")}>
      <span className="hs-ava hd-user-avatar"><span aria-hidden="true">{props.userLabel.slice(0, 1)}</span><i role="img" className={props.disconnected ? "offline" : ""} aria-label={r(props.disconnected ? "disconnected" : "connected")} /><span className="hd-connection-tooltip" role="tooltip">{r(props.disconnected ? "disconnected" : "connected")}</span></span>
      <span className="hd-user-info"><strong>{props.userLabel}</strong><small>{props.workspaceName}{switchable ? " ⌃⌄" : ""}</small></span></button>
      <button type="button" className="hs-icon" aria-label={`${r("colleagues")} ${props.count}`} onClick={props.onColleagues}><UsersIcon className="hico" /><span>{props.count}</span></button><button type="button" className="hs-icon" aria-label={props.settingsLabel} onClick={props.onSettings}><Cog6ToothIcon className="hico" /></button>
    </footer>
    {popup === "workspace" ? <div ref={popover} className="hd-sidebar-popup hd-workspace-menu" onKeyDown={popupKeys} role="menu" aria-label={r("workspaces")}><div className="hd-menu-name">{r("workspaces")}</div>{props.directory?.workspaces.filter(workspace => workspace.active).map(workspace => <button type="button" role="menuitemradio" aria-checked={workspace.workspaceId === props.workspaceId} key={workspace.workspaceId} onClick={() => { setPopup(null); props.onWorkspace(workspace.workspaceId); }}>{workspace.label}{workspace.workspaceId === props.workspaceId ? " ✓" : ""}</button>)}<hr />{props.onRenameWorkspace ? popupAction(r("renameWorkspace"), props.onRenameWorkspace) : null}<button type="button" role="menuitem" className="hd-menu-unavailable" aria-disabled="true" aria-describedby={`${tipId}-new-workspace`}>{r("newWorkspace")}<small id={`${tipId}-new-workspace`}>{r("newWorkspaceUnavailable")}</small></button>{popupAction(r("account"), props.onAccount)}<hr /><div className="hd-menu-name">{r(props.disconnected ? "disconnected" : "connected")}</div></div> : null}
    {tooltip && !props.menuOpen ? <div id={tipId} className="hd-name-tooltip" role="tooltip" aria-hidden="true" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.text}</div> : null}
  </aside>;
}
