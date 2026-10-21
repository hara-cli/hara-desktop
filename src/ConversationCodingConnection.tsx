import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { supportsExternalDelegatedInteractions, type HaraClient, type ConversationCodingLinkView } from "./client";
import type { LegacyLocale as Locale } from "./i18n";
import { codingConnectionRequest } from "./coding-connection-state";
import "./CodingSessionPicker.css";

const CodingSessionPicker = lazy(() => import("./CodingSessionPicker"));

/** Exactly one mounted connection surface for the active chat. No background native-session scans. */
export default function ConversationCodingConnection({ client, sessionId, personal, disabled, busy, locale }: {
  client: HaraClient | null;
  sessionId: string;
  personal: boolean;
  disabled: boolean;
  busy: boolean;
  locale: Locale;
}) {
  const [view, setView] = useState<ConversationCodingLinkView>({ link: null });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supported = personal && client?.supports("session.coding-link.get")
    && client.supports("session.coding-link.set") && supportsExternalDelegatedInteractions(client);
  const refresh = useCallback(async () => {
    if (!client || !supported || disabled) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await codingConnectionRequest(client.getConversationCodingLink(sessionId));
      if (request !== requestRef.current) return;
      setView(result);
      setFailed(false);
    } catch {
      if (request === requestRef.current) setFailed(true);
    } finally { if (request === requestRef.current) setLoading(false); }
  }, [client, disabled, sessionId, supported]);
  useEffect(() => {
    setView({ link: null }); setOpen(false); setFailed(false);
    void refresh();
    const unsubscribe = supported ? client?.onServerEvent((event) => {
      if (event.method === "event.session_changed" && event.sessionId === sessionId && event.change === "coding_link_changed") void refresh();
    }) : undefined;
    return () => { requestRef.current += 1; unsubscribe?.(); };
  }, [client, refresh, sessionId, supported]);
  if (!supported || !client) return null;
  const label = view.link?.title ?? (locale === "zh" ? "连接编程会话" : "Connect coding session");
  return <div className="conversation-coding-connection">
    <button ref={triggerRef} type="button" className={`composer-tool-button coding-connection-trigger${view.link ? " is-connected" : ""}`}
      disabled={disabled || loading} aria-haspopup="dialog" aria-expanded={open}
      title={view.link ? `${view.link.sourceId} · ${label}` : label}
      onClick={() => setOpen(true)}>
      <span aria-hidden="true">{view.link ? "↗" : ">_"}</span><span className="coding-connection-label">{label}</span>
      {view.link ? <span className={`coding-connection-dot${view.available === false ? " is-unavailable" : ""}`} aria-label={locale === "zh" ? "已选择会话" : "Selected session"} /> : null}
    </button>
    {failed ? <span className="coding-connection-warning" role="status">{locale === "zh" ? "连接状态未能读取，打开后可重试" : "Could not read connection; open to retry"}</span> : null}
    {open ? <Suspense fallback={<span role="status">{locale === "zh" ? "正在打开会话选择…" : "Opening session picker…"}</span>}>
      <CodingSessionPicker client={client} sessionId={sessionId} view={view} busy={busy} locale={locale}
        onClose={() => { setOpen(false); queueMicrotask(() => triggerRef.current?.focus()); }}
        onChanged={(next) => { requestRef.current += 1; setView(next); setFailed(false); setLoading(false); }}
        onRefreshLink={refresh} />
    </Suspense> : null}
  </div>;
}
