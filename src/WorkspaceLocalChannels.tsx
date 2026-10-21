import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { HashtagIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import type { makeT } from "./i18n";
import { Avatar, ShellDialog } from "./WorkspaceShell";
import type { WorkspaceDevAgent, WorkspaceDevApproval, WorkspaceDevMessage } from "./workspace-dev-state";
import type { LocalChannelsView, LocalChannelSnapshot, WorkspaceLocalChannelsModel } from "./workspace-local-channels";
import { channelHistoryPage } from "./workspace-channel-history";
import "./workspace-local-channels.css";
type Translate = ReturnType<typeof makeT>;
export const channelMemberLabel = (t: Translate, count: number) => t(count === 1 ? "ws.channels.memberOne" : "ws.channels.memberCount", { n: count });

export function LocalChannelRows({ view, t, search, selected, onOpen }: { view: LocalChannelsView; t: Translate; search: string; selected: string | null; onOpen: (id: string) => void }) {
  if (!view.supported) return <p className="hs-empty">{t("ws.channels.engineRequired")}</p>;
  if (!view.catalog) return <p className="hs-empty" role="status">{t(view.error ? "ws.channels.loadFailed" : "common.loading")}</p>;
  if (!view.catalog.channels.length) return <div className="hs-empty"><b>{t("ws.channels.empty.title")}</b>{t("ws.channels.empty.body")}</div>;
  const rows = view.catalog.channels.filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <>{rows.map(row => <button key={row.id} className="hs-row hs-local-channel" data-channel-id={row.id} aria-current={selected === row.id ? "page" : undefined} onClick={() => onOpen(row.id)}>
    <HashtagIcon className="hico" /><span className="hs-txt"><strong className="hs-name">{row.name}</strong><span className="pv">{channelMemberLabel(t, row.memberIds.length)}</span></span>
  </button>)}{!rows.length ? <p className="hs-empty">{t("ws.search.empty")}</p> : null}</>;
}

export function LocalChannelDialog({ mode, view, model, colleagues, t, onClose, onCreated }: { mode: "create" | "members" | "invite"; view: LocalChannelsView;
  model: WorkspaceLocalChannelsModel; colleagues: WorkspaceDevAgent[]; t: Translate; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(mode === "members" ? view.channel?.channel.name ?? "" : "");
  const [memberIds, setMembers] = useState<string[]>(mode === "members" ? view.channel?.channel.memberIds ?? [] : []);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matchingColleagues = useMemo(() => colleagues.filter(row => `${row.identity.displayName} ${row.identity.title ?? ""}`.toLocaleLowerCase().includes(query)), [colleagues, query]);
  const selectedMembers = useMemo(() => new Set(memberIds), [memberIds]);
  const label = t(mode === "create" ? "ws.channels.new" : mode === "invite" ? "ws.channels.invite" : "ws.channels.members");
  const busy = view.saving || (mode === "create" && view.creationUnknown) || (mode === "members" && ["running", "draining"].includes(view.channel?.state ?? ""));
  const save = async () => {
    if (mode === "create") { const id = await model.create(name, memberIds); if (id) { onClose(); onCreated(id); } }
    else if (await model.updateMembers(name, memberIds)) onClose();
  };
  const verify = async () => { const id = await model.verifyCreation(); if (id) { onClose(); onCreated(id); } };
  return <ShellDialog label={label} onClose={onClose} className="hs-channel-dialog">
    <button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={onClose}><XMarkIcon className="hico" /></button>
    <header className="hs-channel-dialog-head"><span className="hs-channel-mark" aria-hidden="true"><HashtagIcon className="hico" /></span>
      <h2>{mode === "invite" ? t("ws.channels.inviteTitle") : label}</h2>
      <p>{t(mode === "invite" ? "ws.channels.inviteBody" : "ws.channels.createBody")}</p></header>
    {mode !== "invite" ? <div className="hs-channel-dialog-body">
      <label>{t("ws.channels.name")}<input autoFocus aria-label={t("ws.channels.name")} placeholder={t("ws.channels.namePlaceholder")} value={name} maxLength={80} disabled={busy}
        onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim() && !busy) { event.preventDefault(); void save(); } }} /></label>
      <fieldset disabled={busy} className="hs-channel-picker"><legend>{t("ws.channels.selectMembers")}</legend>
        {colleagues.length ? <><label className="hs-channel-search"><MagnifyingGlassIcon className="hico" /><input type="search" aria-label={t("ws.channels.searchMembers")} placeholder={t("ws.channels.searchMembers")} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="hs-channel-picker-actions"><span>{channelMemberLabel(t, memberIds.length)}</span><button type="button" className="hs-btn sec" onClick={() => setMembers(colleagues.map(row => row.agentId))}>{t("ws.channels.all")}</button><button type="button" className="hs-btn sec" onClick={() => setMembers([])}>{t("ws.channels.none")}</button></div>
          <div className="hs-channel-choices">{matchingColleagues.map(row => <label key={row.agentId} className="hs-channel-choice">
            <input type="checkbox" checked={selectedMembers.has(row.agentId)} onChange={event => { const checked = event.currentTarget.checked; setMembers(previous => checked ? [...new Set([...previous, row.agentId])] : previous.filter(id => id !== row.agentId)); }} />
            <Avatar agent={row} /><span><strong>{row.identity.displayName}</strong><small>{row.identity.title ?? t("ws.role.colleague")}</small></span></label>)}
            {!matchingColleagues.length ? <p className="hs-channel-search-empty" role="status">{t("ws.search.empty")}</p> : null}</div></> : <p>{t("ws.channels.noColleagues")}</p>}
      </fieldset>
      {view.error ? <p className="wsd-notice is-error" role="alert">{t(view.error as Parameters<Translate>[0])}</p> : null}
    </div> : null}
    <footer className="hs-channel-dialog-footer">{mode !== "invite" ? <div className="wsd-card-actions">{mode === "create" && view.creationUnknown ? <button className="hs-btn sec" onClick={() => void verify()} disabled={view.saving}>{t("ws.composer.verify")}</button>
        : <button className="hs-btn pri" onClick={() => void save()} disabled={busy || !name.trim()}>{t(mode === "create" ? "ws.channels.new" : "ws.channels.save")}</button>}</div>
      : null}<p className="hs-channel-local-note">{t("ws.channels.localNote")}</p></footer>
  </ShellDialog>;
}

interface ChannelTranscriptGroup { id: string; turnId: string; agentId: string | null; displayName: string; history: WorkspaceDevMessage[] }
/** Core's accepted turn/recipient order is authoritative, even when delivery is interleaved. */
export function channelTranscriptTurns(snapshot: LocalChannelSnapshot) {
  const turns = new Map<string, { turn: LocalChannelSnapshot["turns"][number]; speakers: Map<string | null, ChannelTranscriptGroup> }>();
  for (const turn of snapshot.turns) {
    const normalized = { ...turn, replies: [...new Map(turn.replies.map(reply => [reply.agentId, reply])).values()] };
    const previous = turns.get(turn.id);
    if (previous) previous.turn = normalized; else turns.set(turn.id, { turn: normalized, speakers: new Map() });
  }
  const messages = new Map<string, LocalChannelSnapshot["messages"][number]>();
  for (const row of snapshot.messages) {
    const previous = messages.get(row.id);
    if (!previous || (previous.turnId === row.turnId && previous.agentId === row.agentId)) messages.set(row.id, row);
  }
  for (const row of messages.values()) {
    const turn = turns.get(row.turnId); if (!turn) continue;
    const previous = turn.speakers.get(row.agentId);
    if (previous) previous.history.push(row.message);
    else turn.speakers.set(row.agentId, { id: row.id, turnId: row.turnId, agentId: row.agentId, displayName: row.displayName, history: [row.message] });
  }
  return [...turns.values()].map(({ turn, speakers }) => {
    const ordered = new Map<string | null, ChannelTranscriptGroup>();
    const user = speakers.get(null); if (user) ordered.set(null, user);
    for (const reply of turn.replies) { const group = speakers.get(reply.agentId); if (group) ordered.set(reply.agentId, group); }
    for (const [id, group] of speakers) if (!ordered.has(id)) ordered.set(id, group);
    return { turn, groups: [...ordered.values()] };
  });
}
export const channelTranscriptGroups = (snapshot: LocalChannelSnapshot) => channelTranscriptTurns(snapshot).flatMap(turn => turn.groups);
interface ChannelHistoryRow { id: string; turnId: string; group?: ChannelTranscriptGroup; failedName?: string }
export function channelHistoryRows(snapshot: LocalChannelSnapshot): ChannelHistoryRow[] {
  return channelTranscriptTurns(snapshot).flatMap(({ turn, groups }) => [
    ...groups.map(group => ({ id: JSON.stringify([turn.id, "message", group.id]), turnId: turn.id, group })),
    ...turn.replies.filter(reply => ["failed", "interrupted"].includes(reply.state)).map(reply => ({ id: JSON.stringify([turn.id, "failure", reply.agentId]), turnId: turn.id, failedName: reply.displayName })),
  ]);
}
export function LocalChannelThread({ view, colleagues, t, retry, transcript, approval, model, scrollRoot, onFollowChange }: { view: LocalChannelsView; colleagues: WorkspaceDevAgent[]; t: Translate; retry: () => void;
  transcript: (messages: WorkspaceDevMessage[], agent?: WorkspaceDevAgent) => ReactNode; approval: (card: WorkspaceDevApproval) => ReactNode;
  model?: Pick<WorkspaceLocalChannelsModel, "setHistoryAnchor">; scrollRoot?: RefObject<HTMLDivElement | null>; onFollowChange?: (following: boolean) => void }) {
  const channel = view.channel, rows = useMemo(() => channel ? channelHistoryRows(channel) : [], [channel]);
  const anchor = view.historyAnchor ?? null, page = useMemo(() => channelHistoryPage(rows, anchor), [rows, anchor]);
  const colleaguesById = useMemo(() => new Map(colleagues.map(row => [row.agentId, row])), [colleagues]);
  const container = useRef<HTMLDivElement>(null), navigation = useRef<"start" | "latest" | null>(null), previousAnchor = useRef(anchor);
  const navigate = (next: string | null, edge: "start" | "latest") => { navigation.current = edge; onFollowChange?.(next === null); model?.setHistoryAnchor(next); };
  useLayoutEffect(() => {
    const node = scrollRoot?.current, edge = navigation.current ?? (previousAnchor.current !== null && anchor === null ? "latest" : null);
    previousAnchor.current = anchor; navigation.current = null;
    if (!node || !edge) return;
    onFollowChange?.(edge === "latest"); node.scrollTop = edge === "latest" ? node.scrollHeight : 0;
    const target = edge === "start" ? container.current?.querySelector<HTMLElement>("[data-history-action]")
      : node.closest(".hs-chat")?.querySelector<HTMLTextAreaElement>(".hs-channel-compose textarea");
    target?.focus({ preventScroll: true });
  }, [anchor, scrollRoot, onFollowChange]);
  useEffect(() => {
    const node = scrollRoot?.current; if (!node || !model || !page.rows.length) return;
    const observe = () => {
      const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
      if (page.anchor === null && distance > 180) { onFollowChange?.(false); model.setHistoryAnchor(page.rows[page.rows.length - 1].id); }
      else if (page.anchor !== null && !page.hasNewer && distance <= 1) model.setHistoryAnchor(null);
    };
    node.addEventListener("scroll", observe, { passive: true }); return () => node.removeEventListener("scroll", observe);
  }, [scrollRoot, model, page, onFollowChange]);
  const rendered = useMemo(() => {
    const visible = new Map<string, ChannelHistoryRow[]>();
    for (const row of page.rows) { const group = visible.get(row.turnId); if (group) group.push(row); else visible.set(row.turnId, [row]); }
    return [...visible].map(([turnId, items]) => <section className="hs-channel-turn" key={turnId} aria-label={t("ws.channels.local")}>
      {items.map(row => {
        if (!row.group) return <p key={row.id} className="hs-channel-status" role="status">{t("ws.channels.failedReply", { name: row.failedName ?? "" })}</p>;
        const group = row.group, current = group.agentId ? colleaguesById.get(group.agentId) : undefined;
        const agent = current ? { ...current, identity: { ...current.identity, displayName: group.displayName } } : group.agentId ? {
          agentId: group.agentId, kind: "colleague" as const, state: "archived", identity: { displayName: group.displayName }, runtime: { id: "pi", label: "Pi", available: false },
        } : undefined;
        return <div key={row.id} data-channel-speaker={group.agentId ?? "user"} data-channel-history-id={row.id}>{transcript(group.history, agent)}</div>;
      })}
    </section>);
  }, [page, colleaguesById, transcript, t]);
  if (!channel) return <section className="hs-col hs-channel-empty"><HashtagIcon className="hico" /><p role="status">{t(view.loading ? "common.loading" : view.error ? "ws.channels.loadFailed" : "ws.channels.unavailable")}</p>
    <button className="hs-btn sec" onClick={retry}>{t("ws.tasks.retry")}</button></section>;
  return <div ref={container} className="hs-col wsd-thread hs-channel-thread" data-local-channel={channel.channel.id} tabIndex={-1} role="region" aria-label={t("ws.channels.history.label")}>
    {!rows.length ? <section className="hs-hello hs-channel-empty"><HashtagIcon className="hico" /><h2>{t("ws.channels.emptyConversation")}</h2><p>{t("ws.channels.emptyHint")}</p><small>{t("ws.channels.localNote")}</small></section> : null}
    {page.total > page.rows.length ? <nav className="hs-channel-history-nav" aria-label={t("ws.channels.history.label")}>
      {page.hasOlder ? <button className="hs-btn sec" data-history-action="older" onClick={() => navigate(page.older, "start")}>{t("ws.channels.history.older")}</button> : null}
      <span role="status">{t("ws.channels.history.range", { from: page.start + 1, to: page.end, total: page.total })}</span>
      {page.hasNewer ? <button className="hs-btn sec" data-history-action="latest" onClick={() => navigate(null, "latest")}>{t("ws.channels.history.latest")}</button> : null}
    </nav> : null}
    {rendered}
    {page.hasNewer ? <nav className="hs-channel-history-nav" aria-label={t("ws.channels.history.label")}>
      <button className="hs-btn sec" data-history-action="newer" onClick={() => navigate(page.newer, page.newer === null ? "latest" : "start")}>{t("ws.channels.history.newer")}</button>
      <button className="hs-btn sec" data-history-action="latest" onClick={() => navigate(null, "latest")}>{t("ws.channels.history.latest")}</button>
    </nav> : null}
    {channel.approvals.map(card => <div key={card.id}>{approval(card)}</div>)}
    {channel.state === "interrupted" || channel.state === "cancelled" ? <p className="hs-channel-status" role="status">{t(channel.state === "interrupted" ? "ws.channels.interrupted" : "ws.channels.cancelled")}</p> : null}
    {["running", "draining"].includes(channel.state) ? <p className="wsd-typing" role="status">{t(channel.state === "draining" ? "ws.draining" : "ws.channels.replying")}</p> : null}
  </div>;
}

export function LocalChannelComposer({ view, model, colleagues, t, disconnected, hasConnection, configure }: { view: LocalChannelsView; model: WorkspaceLocalChannelsModel; colleagues: WorkspaceDevAgent[];
  t: Translate; disconnected: boolean; hasConnection: boolean; configure: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null), channel = view.channel;
  const [recipientSearch, setRecipientSearch] = useState("");
  const recipients = view.recipientIds ?? channel?.channel.memberIds ?? [];
  const selectedRecipients = useMemo(() => new Set(recipients), [recipients]);
  const colleaguesById = useMemo(() => new Map(colleagues.map(row => [row.agentId, row])), [colleagues]);
  const query = recipientSearch.trim().toLocaleLowerCase(), members = channel?.channel.memberIds;
  const matchingRecipients = useMemo(() => (members ?? []).map(id => ({ id, agent: colleaguesById.get(id) })).filter(({ id, agent }) =>
    `${agent?.identity.displayName ?? id} ${agent?.identity.title ?? ""}`.toLocaleLowerCase().includes(query)), [members, colleaguesById, query]);
  const setRecipients = (value: string[]) => model.setRecipients(value);
  useEffect(() => { setRecipientSearch(""); input.current?.focus(); }, [view.channelId]);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${Math.min(160, Math.max(32, input.current.scrollHeight))}px`; } }, [view.draft, view.channelId]);
  if (!channel) return null;
  const busy = ["running", "draining"].includes(channel.state), needsConnection = recipients.length > 0 && !hasConnection;
  const canSend = !!view.draft.trim() && view.draft.trim().length <= 4000 && !view.pending && !busy && !disconnected && !needsConnection;
  return <footer className="hs-compose hs-channel-compose">
    {needsConnection ? <p className="hs-channel-status">{t("ws.connection.body")} <button className="hs-btn sec" onClick={configure}>{t("ws.connection.configure")}</button></p> : null}
    {view.error ? <p className="wsd-notice is-error" role="alert">{t(view.error as Parameters<Translate>[0])}</p> : null}
    <details className="hs-channel-recipients"><summary>{t(!recipients.length ? "ws.channels.notesOnly" : recipients.length === 1 ? "ws.channels.replyOne" : recipients.length === channel.channel.memberIds.length ? "ws.channels.replyAll" : "ws.channels.replyCount", { n: recipients.length })}</summary>
      <fieldset disabled={busy || !!view.pending}><legend>{t("ws.channels.responders")}</legend>
        {channel.channel.memberIds.length ? <label className="hs-channel-search"><MagnifyingGlassIcon className="hico" /><input type="search" aria-label={t("ws.channels.searchMembers")} placeholder={t("ws.channels.searchMembers")} value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} /></label> : null}
        <div className="hs-channel-picker-actions"><button className="hs-btn sec" onClick={() => setRecipients(channel.channel.memberIds)}>{t("ws.channels.all")}</button><button className="hs-btn sec" onClick={() => setRecipients([])}>{t("ws.channels.notesOnly")}</button></div>
        {matchingRecipients.map(({ id, agent }) => <label className="hs-channel-recipient" key={id}><input type="checkbox" checked={selectedRecipients.has(id)} onChange={event => setRecipients(event.target.checked ? [...recipients, id] : recipients.filter(value => value !== id))} />{agent?.identity.displayName ?? id}</label>)}
        {!matchingRecipients.length ? <p className="hs-channel-search-empty" role="status">{t(channel.channel.memberIds.length ? "ws.search.empty" : "ws.channels.noRecipients")}</p> : null}
      </fieldset></details>
    <div className="hs-field"><textarea ref={input} aria-label={t("ws.channels.placeholder", { name: channel.channel.name })} placeholder={t("ws.channels.placeholder", { name: channel.channel.name })} value={view.draft} rows={1} maxLength={4000} disabled={disconnected}
      onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void model.send(recipients); } }} />
      {busy ? <button className="hs-stop" onClick={() => void model.cancel()} disabled={disconnected || channel.state === "draining"}><StopIcon className="hico" />{t("ws.composer.stop")}</button>
        : view.pending?.state === "unknown" ? <button className="hs-btn sec" onClick={() => void model.verifyPending()} disabled={disconnected}>{t("ws.composer.verify")}</button>
          : <button className="hs-send" aria-label={t("ws.composer.send")} disabled={!canSend} onClick={() => void model.send(recipients)}><PaperAirplaneIcon className="hico" /></button>}
    </div><p className="hs-hint"><span>{t("ws.channels.localNote")}</span><span>{t("ws.composer.hint.keys")}</span></p>
  </footer>;
}
