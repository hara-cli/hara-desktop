import {
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
  close: string;
}

interface ExtensionDockProps {
  kind: ExtensionSurfaceKind;
  kindLabel: string;
  title: string;
  source: string;
  context: string;
  detail?: string | null;
  mode: ExtensionDockMode;
  loading?: boolean;
  copy: ExtensionDockCopy;
  onModeChange: (mode: ExtensionDockMode) => void;
  onPopOut?: () => void;
  onClose: () => void;
  children: ReactNode;
}

function DockIcon({ name }: { name: "maximize" | "restore" | "popout" | "close" }) {
  if (name === "close") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="m5 5 10 10M15 5 5 15" /></svg>;
  }
  if (name === "popout") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M8 4H4v12h12v-4M10 4h6v6M16 4l-7 7" /></svg>;
  }
  if (name === "restore") {
    return <svg viewBox="0 0 20 20" aria-hidden><path d="M7 5H4v11h11v-3M8 4h8v8H8z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" /></svg>;
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
  loading = false,
  copy,
  onModeChange,
  onPopOut,
  onClose,
  children,
}: ExtensionDockProps) {
  const [width, setWidth] = useState(initialWidth);
  const widthRef = useRef(width);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

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
      className={`extension-dock is-${mode}${resizing ? " is-resizing" : ""}`}
      data-kind={kind}
      aria-label={`${copy.extension}: ${title}`}
      aria-busy={loading}
      style={style}
    >
      {mode === "docked" && (
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
          {onPopOut && (
            <button type="button" aria-label={copy.popOut} title={copy.popOut} onClick={onPopOut}>
              <DockIcon name="popout" />
            </button>
          )}
          <button type="button" aria-label={copy.close} title={copy.close} onClick={onClose}>
            <DockIcon name="close" />
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
