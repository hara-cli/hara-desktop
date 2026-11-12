import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownTrayIcon, ChevronRightIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { loadAdvancedOpen, saveAdvancedOpen } from "./settings-advanced-state";

/**
 * Shared settings chrome (DESIGN.md §10–§11; settings IA audit §2):
 * - `SettingsAdvanced`: the page's single «Advanced» section, collapsed by default. The summary
 *   lists what is inside, says «usually no need to change», and shows «Customized: …» whenever a
 *   value inside differs from its default, so folding never hides a change. Controls inside keep
 *   calling the same RPCs and inherit the page's read-only fieldset.
 * - `SettingsRowMenu`: the row-end «⋯» for low-frequency destructive actions. Items only open the
 *   existing confirmation step; nothing is performed from the menu directly.
 * - `SettingsAttention`: the amber bar pinned to the top for states that need the user.
 */
/** `persist={false}` is for folds inside a transient dialog: they always start collapsed and are not remembered. */
export function SettingsAdvanced({ page, items, customized = [], persist = true, children }: { page: string; items: string[]; customized?: string[]; persist?: boolean; children: ReactNode }) {
  const { t } = useWorkspaceLocale();
  const [open, setOpen] = useState(() => persist && loadAdvancedOpen(page));
  const list = (values: string[]) => values.join(t("ws.settings.listSeparator"));
  return <details className="wss-advanced" data-settings-advanced={page} open={open} onToggle={event => {
    const next = event.currentTarget.open; if (next === open) return; setOpen(next); if (persist) saveAdvancedOpen(page, next);
  }}>
    <summary><ChevronRightIcon className="hico wss-advanced-chevron" aria-hidden /><strong>{t("ws.settings.advanced")}</strong>
      {items.length ? <span className="wss-advanced-items">· {list(items)}</span> : null}<span className="wss-advanced-spacer" />
      {customized.length ? <span className="wss-advanced-custom">{t("ws.settings.advanced.customized", { items: list(customized) })}</span> : null}
      <small>{t("ws.settings.advanced.usually")}</small></summary>
    <div className="wss-advanced-body">{children}</div>
  </details>;
}

export interface SettingsRowMenuItem { id: string; label: string; onSelect(): void; disabled?: boolean; danger?: boolean }
export function SettingsRowMenu({ label, items, disabled = false }: { label: string; items: SettingsRowMenuItem[]; disabled?: boolean }) {
  const { t } = useWorkspaceLocale();
  const [open, setOpen] = useState(false), [upward, setUpward] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), menuId = useId();
  const enabled = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const below = window.innerHeight - trigger.current.getBoundingClientRect().bottom, height = menu.current.getBoundingClientRect().height;
    setUpward(below < height + 8 && trigger.current.getBoundingClientRect().top > below);
    enabled()[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const controls = enabled(), index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const step = event.key === "ArrowDown" ? 1 : -1; controls[(index + step + controls.length) % controls.length]?.focus(); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); controls[event.key === "Home" ? 0 : controls.length - 1]?.focus(); }
  };
  return <span className="wss-row-menu">
    <button ref={trigger} type="button" className="wss-row-menu-trigger" aria-label={t("ws.settings.rowMenu", { name: label })} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? menuId : undefined} disabled={disabled || !items.some(item => !item.disabled)} onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); }
        else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}><EllipsisHorizontalIcon className="hico" aria-hidden /></button>
    {open ? <div ref={menu} id={menuId} role="menu" aria-label={t("ws.settings.rowMenu", { name: label })} className={`wss-row-menu-list${upward ? " is-up" : ""}`} onKeyDown={onMenuKey}>
      {items.map(item => <button key={item.id} type="button" role="menuitem" tabIndex={-1} className={item.danger ? "is-danger" : undefined} disabled={item.disabled}
        onClick={() => { close(); item.onSelect(); }}>{item.label}</button>)}
    </div> : null}
  </span>;
}

/** `tone: "progress"` is for work in progress the user may cancel (a download); it is pinned like an alert but is not one. */
export interface SettingsAttentionItem { id: string; text: string; tone?: "attention" | "progress"; action?: { label: string; onClick(): void; disabled?: boolean } }
export function SettingsAttention({ items }: { items: SettingsAttentionItem[] }) {
  if (!items.length) return null;
  return <div className="wss-attention-list">{items.map(item => <div key={item.id} className={`wss-attention${item.tone === "progress" ? " is-progress" : ""}`} role="status" data-settings-attention={item.id}>
    {item.tone === "progress" ? <ArrowDownTrayIcon className="hico" aria-hidden /> : <ExclamationTriangleIcon className="hico" aria-hidden />}<span>{item.text}</span>
    {item.action ? <button type="button" disabled={item.action.disabled} onClick={item.action.onClick}>{item.action.label}</button> : null}
  </div>)}</div>;
}
