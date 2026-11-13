import { useEffect, useRef, useState } from "react";
import { redesignText } from "./desktop-redesign-copy";
/** `quiet`: the caller announces this text through its own always-present live line, so the toast is not a second live region. */
export interface UndoNotice { id: number; scope: string; text: string; undo?: () => Promise<void> | void; quiet?: boolean }
export function WorkspaceUndoToast({ notice, locale, onClose }: { notice: UndoNotice; locale: string; onClose(): void }) {
  const [paused, setPaused] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { if (paused || busy) return; const timer = setTimeout(() => close.current(), 6000); return () => clearTimeout(timer); }, [notice.id, paused, busy]);
  return <div className="hd-undo-toast" role={notice.quiet ? undefined : "status"} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <span>{failed ? redesignText(locale, "archiveFailed") : notice.text}</span>{notice.undo && !failed ? <button type="button" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { await notice.undo?.(); close.current(); } catch { setFailed(true); } finally { setBusy(false); } }}>{redesignText(locale, "undo")}</button> : null}
    <button type="button" className="hd-toast-close" disabled={busy} aria-label={redesignText(locale, "dismiss")} onClick={onClose}>×</button>
  </div>;
}
