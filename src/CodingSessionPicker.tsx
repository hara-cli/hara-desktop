import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ConversationCodingLinkView, type ExternalSessionInfo, type HaraClient } from "./client";
import { codingConnectionChoices, codingConnectionNeedsRecovery, codingConnectionRequest } from "./coding-connection-state";
import { IconClose, IconSearch } from "./icons";
import type { LegacyLocale as Locale } from "./i18n";

const SOURCES = ["codex", "claude", "runtime"] as const;
type Source = typeof SOURCES[number];
const sourceLabel = (session: ExternalSessionInfo, locale: Locale): string => session.sourceId === "runtime"
  ? `${locale === "zh" ? "管理连接" : "Managed connection"} · ${session.agentKind === "claude" ? "Claude Code" : "Codex"}`
  : session.sourceId === "claude" ? "Claude Code" : "Codex";
const stateLabel = (session: ExternalSessionInfo, locale: Locale): string => codingConnectionNeedsRecovery(session)
  ? (locale === "zh" ? "需先恢复" : "Recover first")
  : session.state === "working" ? (locale === "zh" ? "执行中" : "Running")
  : session.state === "waiting" ? (locale === "zh" ? "等待输入" : "Awaiting input")
  : (locale === "zh" ? "可连接" : "Available");

/** Native dialog owns focus/escape. Fetches metadata only after the human opens it; selecting a row
 * never launches, resumes or sends to a provider. The connect RPC rechecks ownership on the host. */
export default function CodingSessionPicker({ client, sessionId, view, busy, locale, onClose, onChanged, onRefreshLink }: {
  client: HaraClient; sessionId: string; view: ConversationCodingLinkView; busy: boolean; locale: Locale;
  onClose: () => void; onChanged: (view: ConversationCodingLinkView) => void; onRefreshLink: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef(0);
  const [sessions, setSessions] = useState<ExternalSessionInfo[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<Source, string>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failedSources, setFailedSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const choices = useMemo(() => codingConnectionChoices(sessions, query), [sessions, query]);
  const selected = choices.find((session) => session.id === selectedId);
  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError(""); setSelectedId(null);
    const results = await Promise.allSettled(SOURCES.map((sourceId) => codingConnectionRequest(client.listExternalSessions({ sourceId, limit: 30 }))));
    if (request !== requestRef.current) return;
    const next: ExternalSessionInfo[] = []; const nextCursors: Partial<Record<Source, string>> = {}; const failures: Source[] = [];
    for (const [index, result] of results.entries()) {
      const source = SOURCES[index]!;
      if (result.status !== "fulfilled" || !result.value) { failures.push(source); continue; }
      next.push(...result.value.sessions);
      if (result.value.page.nextCursor) nextCursors[source] = result.value.page.nextCursor;
    }
    setSessions(next); setCursors(nextCursors); setFailedSources(failures); setLoading(false);
  }, [client]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    void refresh();
    return () => { requestRef.current += 1; if (dialog?.open) dialog.close(); };
  }, [refresh]);
  const loadMore = async (sourceId: Source) => {
    const cursor = cursors[sourceId]; if (!cursor || loading) return;
    const request = ++requestRef.current; setLoading(true); setError("");
    try {
      const result = await codingConnectionRequest(client.listExternalSessions({ sourceId, cursor, limit: 30 }));
      if (request !== requestRef.current) return;
      if (!result) throw new Error("unavailable");
      setSessions((current) => [...current, ...result.sessions]);
      setCursors((current) => ({ ...current, [sourceId]: result.page.nextCursor }));
    } catch { if (request === requestRef.current) setError(locale === "zh" ? "这一页未能读取，请重试。" : "Could not read this page. Please retry."); }
    finally { if (request === requestRef.current) setLoading(false); }
  };
  const connect = async (targetSessionId: string | null) => {
    if (saving || (targetSessionId !== null && (loading || busy || !selected || codingConnectionNeedsRecovery(selected)))) return;
    const request = ++requestRef.current; setLoading(false); setSaving(true); setError("");
    try {
      const next = await codingConnectionRequest(client.setConversationCodingLink(sessionId, targetSessionId, view.link?.revision ?? null));
      if (request !== requestRef.current) return;
      onChanged(next); onClose();
    } catch {
      if (request !== requestRef.current) return;
      setError(locale === "zh"
        ? "未能连接：会话可能仅有历史、已被其他窗口更改，或当前 Agent 正在执行。请刷新；Hara 没有启动或复制会话。"
        : "Could not connect: this may be history-only, changed elsewhere, or the Agent is running. Refresh to retry; Hara did not start or copy a session.");
      await onRefreshLink();
    } finally { if (request === requestRef.current) setSaving(false); }
  };
  return <dialog ref={dialogRef} className="coding-session-picker" aria-modal="true" aria-labelledby="coding-session-picker-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <header className="coding-session-picker-header">
      <div><small>{locale === "zh" ? "当前 Agent · 已有会话" : "THIS AGENT · EXISTING SESSION"}</small>
        <h2 id="coding-session-picker-title">{locale === "zh" ? "连接编程会话" : "Connect coding session"}</h2></div>
      <button type="button" className="ghost" disabled={saving} onClick={onClose} aria-label={locale === "zh" ? "关闭会话选择" : "Close session picker"}><IconClose size={18} /></button>
    </header>
    <div className="coding-session-picker-controls">
    <p className="coding-session-picker-intro">{locale === "zh"
      ? "选择后，这位 Agent 可读取该会话的近期记录，并向同一会话提议发消息。每次发送仍需你确认，不会交给其他 Agent，也不会新开一份会话。"
      : "This Agent can read recent history and propose a message to the same session. Every send still needs your approval. The link is not shared with other Agents, and no session is created."}</p>
    {view.link ? <section className="coding-session-picker-current" aria-label={locale === "zh" ? "当前连接" : "Current connection"}>
      <small>{locale === "zh" ? "当前连接" : "Connected"}</small><strong>{view.link.title}</strong>
      <span>{view.link.sourceId}{view.available === false ? (locale === "zh" ? " · 需要重新检查" : " · Needs checking") : ""}</span>
      <button type="button" className="ghost" disabled={saving} onClick={() => void connect(null)}>{locale === "zh" ? "断开连接" : "Disconnect"}</button>
    </section> : null}
    <div className="coding-session-picker-search"><IconSearch size={17} /><input autoFocus type="search" maxLength={200} value={query}
      aria-label={locale === "zh" ? "搜索已有会话" : "Search existing sessions"}
      placeholder={locale === "zh" ? "按标题、工作区搜索" : "Search title or workspace"} onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" className="ghost" disabled={loading || saving} onClick={() => { void refresh(); void onRefreshLink(); }}>{locale === "zh" ? "刷新" : "Refresh"}</button></div>
    {failedSources.length ? <p className="coding-session-picker-notice" role="status">{locale === "zh" ? "部分来源未能读取，请刷新重试：" : "Some sources could not be read. Refresh to retry: "}{failedSources.join(", ")}</p> : null}
    {busy ? <p className="coding-session-picker-notice" role="status">{locale === "zh" ? "Agent 正在处理消息。可以断开连接；换绑请等本轮结束。" : "The Agent is handling a message. You may disconnect; wait for this turn to finish before changing targets."}</p> : null}
    </div>
    <div className="coding-session-picker-list" aria-busy={loading}>
      {loading && sessions.length === 0 ? <p role="status">{locale === "zh" ? "正在读取本机会话…" : "Reading local sessions…"}</p> : null}
      {!loading && choices.length === 0 ? <div className="coding-session-picker-empty"><strong>{locale === "zh" ? "暂时没有匹配的会话" : "No matching sessions"}</strong><p>{locale === "zh"
        ? "只列出本机可发现的 Codex、Claude Code 和管理连接；独立终端不一定共享连接。未接入的历史可在高级会话页恢复。"
        : "Only discoverable Codex, Claude Code and managed connections appear. Independent terminals may not share a connection. Recover unconnected history in the advanced sessions view."}</p></div> : null}
      {choices.map((session) => <button type="button" key={session.id} className={`coding-session-choice${selectedId === session.id ? " is-selected" : ""}`}
        aria-pressed={selectedId === session.id} disabled={loading || saving || busy || codingConnectionNeedsRecovery(session)}
        onClick={() => setSelectedId(session.id)}>
        <span className="coding-session-choice-engine" aria-hidden="true">{session.sourceId === "claude" || session.agentKind === "claude" ? "CL" : "CX"}</span>
        <span className="coding-session-choice-copy"><strong>{session.title || sourceLabel(session, locale)}</strong><small>{sourceLabel(session, locale)} · {session.workspaceName}</small>
          <small className="coding-session-choice-id">{session.id.slice(-8)} · {session.updatedAt.slice(0, 16).replace("T", " ")}</small></span>
        <span className="coding-session-choice-state">{stateLabel(session, locale)}</span>
      </button>)}
      {SOURCES.filter((source) => cursors[source]).map((source) => <button type="button" key={source} className="ghost coding-session-picker-more" disabled={loading || saving}
        onClick={() => void loadMore(source)}>{locale === "zh" ? "加载更多" : "Load more"} · {source}</button>)}
    </div>
    {error ? <p className="coding-session-picker-error" role="alert">{error}</p> : null}
    <footer><small>{locale === "zh" ? "连接不是授权；不自动接管终端，不删除原会话。" : "A link is not approval. No automatic takeover or session deletion."}</small>
      <button type="button" disabled={!selected || loading || saving || busy || codingConnectionNeedsRecovery(selected)} onClick={() => void connect(selectedId)}>
        {saving ? (locale === "zh" ? "正在连接…" : "Connecting…") : (locale === "zh" ? "连接到当前对话" : "Connect to this chat")}</button></footer>
  </dialog>;
}
