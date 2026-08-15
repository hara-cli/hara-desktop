import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  EXTENSION_DOCK_WIDTH_KEY,
  extensionDockWidth,
  type ExtensionDockAddKind,
  type ExtensionDockMode,
  type ExtensionSurfaceKind,
} from "./extension-dock-state";
import "./ExtensionDock.css";

interface ExtensionDockCopy {
  extension: string;
  resize: string;
  maximize: string;
  restore: string;
  popOut: string;
  hide: string;
  close: string;
  add: string;
}

export interface ExtensionDockAddItem {
  id: ExtensionDockAddKind;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface ExtensionDockProps {
  kind: ExtensionSurfaceKind;
  kindLabel: string;
  title: string;
  source: string;
  context: string;
  detail?: string | null;
  mode: ExtensionDockMode;
  placement?: "split" | "stage";
  loading?: boolean;
  tabs?: Array<{
    id: string;
    title: string;
    kind: ExtensionSurfaceKind;
    dirty?: boolean;
  }>;
  activeTabId?: string | null;
  collapsed?: boolean;
  addItems?: ExtensionDockAddItem[];
  copy: ExtensionDockCopy;
  onTabSelect?: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onAddItem?: (itemId: ExtensionDockAddItem["id"]) => void;
  onModeChange: (mode: ExtensionDockMode) => void;
  onPopOut?: () => void;
  onClose: () => void;
  children: ReactNode;
}

function DockIcon({ name }: { name: "maximize" | "restore" | "popout" | "close" | "collapse" }) {
  if (name === "close") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg>;
  }
  if (name === "popout") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M8 4H4v12h12v-4M10 4h6v6M16 4l-7 7" /></svg>;
  }
  if (name === "collapse") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 4h12v12H4zM11 4v12M8 7l-3 3 3 3" /></svg>;
  }
  if (name === "restore") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M7 5H4v11h11v-3M8 4h8v8H8z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" /></svg>;
}

function DockToolIcon({ name }: { name: ExtensionDockAddItem["id"] }) {
  if (name === "workforce") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 15v-4l3-2 4 2 4-2 3 2v4M6 9V5h8v4M8 5V3h4v2M5 15h10" /><circle cx="10" cy="8" r="1.2" /></svg>;
  }
  if (name === "terminal") {
    return <svg viewBox="0 0 20 20" aria-hidden><rect x="3" y="4" width="14" height="12" rx="2" /><path d="m6 8 2 2-2 2M10 12h4" /></svg>;
  }
  if (name === "browser") {
    return <svg viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7Z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden><path d="M3 6h5l1.5 2H17v7H3zM3 6V4h6l1.5 2" /></svg>;
}

function initialWidth(): number {
  if (typeof window === "undefined") return 48;
  try {
    return extensionDockWidth(window.localStorage.getItem(EXTENSION_DOCK_WIDTH_KEY));
  } catch {
    return 48;
  }
}

export default function ExtensionDock({
  kind,
  kindLabel,
  title,
  source,
  context,
  detail,
  mode,
  placement = "split",
  loading = false,
  tabs = [],
  activeTabId = null,
  collapsed = false,
  addItems = [],
  copy,
  onTabSelect,
  onTabClose,
  onAddItem,
  onModeChange,
  onPopOut,
  onClose,
  children,
}: ExtensionDockProps) {
  const [width, setWidth] = useState(initialWidth);
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addOpen) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [addOpen]);

  const saveWidth = (next: number, persist = true) => {
    const bounded = extensionDockWidth(next);
    widthRef.current = bounded;
    setWidth(bounded);
    if (!persist) return;
    try {
      window.localStorage.setItem(EXTENSION_DOCK_WIDTH_KEY, String(bounded));
    } catch {
      // A denied or full preference store must never prevent resizing this session.
    }
  };

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    if (bounds.width <= 0) return;
    saveWidth(((bounds.right - event.clientX) / bounds.width) * 100, false);
  };

  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") saveWidth(width + 2);
    else if (event.key === "ArrowRight") saveWidth(width - 2);
    else if (event.key === "Home") saveWidth(36);
    else if (event.key === "End") saveWidth(72);
    else return;
    event.preventDefault();
  };

  const style = {
    "--extension-dock-width": `${width}%`,
  } as CSSProperties;

  return (
    <aside
      ref={asideRef}
      className={`extension-dock is-${mode} is-${placement}${collapsed ? " is-collapsed" : ""}${resizing ? " is-resizing" : ""}${tabs.length > 0 ? " has-tabs" : ""}`}
      data-kind={kind}
      aria-label={`${copy.extension}: ${title}`}
      aria-busy={loading}
      aria-hidden={collapsed}
      style={style}
    >
      {mode === "docked" && placement === "split" && (
        <div
          className="extension-dock-resizer"
          role="separator"
          aria-label={copy.resize}
          aria-orientation="vertical"
          aria-valuemin={36}
          aria-valuemax={72}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onKeyDown={onResizeKey}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
            resizeFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (resizing) resizeFromPointer(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setResizing(false);
            saveWidth(widthRef.current);
          }}
          onPointerCancel={() => {
            setResizing(false);
            saveWidth(widthRef.current);
          }}
        >
          <span />
        </div>
      )}

      {(tabs.length > 0 || addItems.length > 0) && (
        <div className="extension-dock-tabbar">
          <div className="extension-dock-tabs" role="tablist" aria-label={copy.extension}>
            {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`extension-dock-tab${tab.id === activeTabId ? " is-active" : ""}`}
              data-kind={tab.kind}
            >
              <button
                type="button"
                className="extension-dock-tab-select"
                role="tab"
                aria-selected={tab.id === activeTabId}
                title={tab.title}
                onClick={() => onTabSelect?.(tab.id)}
              >
                <i aria-hidden />
                <span>{tab.title}</span>
                {tab.dirty && <b aria-label="Unsaved changes">•</b>}
              </button>
              <button
                type="button"
                className="extension-dock-tab-close"
                aria-label={`${copy.close}: ${tab.title}`}
                title={copy.close}
                onClick={() => onTabClose?.(tab.id)}
              >
                <DockIcon name="close" />
              </button>
            </div>
            ))}
          </div>
          {addItems.length > 0 && (
            <div className="extension-dock-add" ref={addMenuRef}>
              <button
                type="button"
                className="extension-dock-add-button"
                aria-label={copy.add}
                title={copy.add}
                aria-haspopup="menu"
                aria-expanded={addOpen}
                onClick={() => setAddOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setAddOpen(false);
                }}
              >
                <span aria-hidden>+</span>
              </button>
              {addOpen && (
                <div className="extension-dock-add-menu" role="menu" aria-label={copy.add}>
                  {addItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      title={item.disabled ? item.disabledReason : undefined}
                      onClick={() => {
                        if (item.disabled) return;
                        setAddOpen(false);
                        onAddItem?.(item.id);
                      }}
                    >
                      <DockToolIcon name={item.id} />
                      <span>{item.label}</span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <header className="extension-dock-header">
        <div className="extension-dock-identity">
          <span className="extension-dock-signal" aria-hidden />
          <div>
            <span className="extension-dock-kicker">{copy.extension} / {kindLabel}</span>
            <strong title={title}>{title}</strong>
          </div>
        </div>
        <div className="extension-dock-provenance">
          <span>{source}</span>
          <span title={context}>{context}</span>
          {detail && <span title={detail}>{detail}</span>}
        </div>
        <div className="extension-dock-actions">
          {placement === "split" && (
            <button
              type="button"
              className="extension-dock-mode-action"
              aria-label={mode === "maximized" ? copy.restore : copy.maximize}
              title={mode === "maximized" ? copy.restore : copy.maximize}
              aria-pressed={mode === "maximized"}
              onClick={() => onModeChange(mode === "maximized" ? "docked" : "maximized")}
            >
              <DockIcon name={mode === "maximized" ? "restore" : "maximize"} />
            </button>
          )}
          {onPopOut && (
            <button type="button" aria-label={copy.popOut} title={copy.popOut} onClick={onPopOut}>
              <DockIcon name="popout" />
            </button>
          )}
          <button type="button" aria-label={copy.hide} title={copy.hide} onClick={onClose}>
            <DockIcon name="collapse" />
          </button>
        </div>
      </header>

      <div className="extension-dock-body">
        {loading && <div className="extension-dock-loading" role="status" />}
        {children}
      </div>
    </aside>
  );
}
