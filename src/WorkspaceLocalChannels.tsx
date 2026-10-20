import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HashtagIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import type { makeT } from "./i18n";
import { Avatar, ShellDialog } from "./WorkspaceShell";
import type { WorkspaceDevAgent, WorkspaceDevApproval, WorkspaceDevMessage } from "./workspace-dev-state";
import type { LocalChannelsView, LocalChannelSnapshot, WorkspaceLocalChannelsModel } from "./workspace-local-channels";
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
  const label = t(mode === "create" ? "ws.channels.new" : mode === "invite" ? "ws.channels.invite" : "ws.channels.members");
  const busy = view.saving || (mode === "create" && view.creationUnknown) || (mode === "members" && ["running", "draining"].includes(view.channel?.state ?? ""));
  const save = async () => {
    if (mode === "create") { const id = await model.create(name, memberIds); if (id) { onClose(); onCreated(id); } }
    else if (await model.updateMembers(name, memberIds)) onClose();
  };
  const verify = async () => { const id = await model.verifyCreation(); if (id) { onClose(); onCreated(id); } };
  return <ShellDialog label={label} onClose={onClose} className="hs-channel-dialog">
    <button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={onClose}><XMarkIcon className="hico" /></button>
    <span className="hs-channel-mark" aria-hidden="true"><HashtagIcon className="hico" /></span>
    <h2>{mode === "invite" ? t("ws.channels.inviteTitle") : label}</h2>
    <p>{t(mode === "invite" ? "ws.channels.inviteBody" : "ws.channels.createBody")}</p>
    {mode !== "invite" ? <>
      <label>{t("ws.channels.name")}<input autoFocus aria-label={t("ws.channels.name")} placeholder={t("ws.channels.namePlaceholder")} value={name} maxLength={80} disabled={busy}
        onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim() && !busy) { event.preventDefault(); void save(); } }} /></label>
      <fieldset disabled={busy} className="hs-channel-picker"><legend>{t("ws.channels.selectMembers")}</legend>
        {colleagues.length ? <><label className="hs-channel-search"><MagnifyingGlassIcon className="hico" /><input type="search" aria-label={t("ws.channels.searchMembers")} placeholder={t("ws.channels.searchMembers")} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="hs-channel-picker-actions"><span>{channelMemberLabel(t, memberIds.length)}</span><button type="button" className="hs-btn sec" onClick={() => setMembers(colleagues.map(row => row.agentId))}>{t("ws.channels.all")}</button><button type="button" className="hs-btn sec" onClick={() => setMembers([])}>{t("ws.channels.none")}</button></div>
          <div className="hs-channel-choices">{colleagues.filter(row => `${row.identity.displayName} ${row.identity.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <label key={row.agentId} className="hs-channel-choice">
            <input type="checkbox" checked={memberIds.includes(row.agentId)} onChange={event => setMembers(previous => event.target.checked ? [...previous, row.agentId] : previous.filter(id => id !== row.agentId))} />
            <Avatar agent={row} /><span><strong>{row.identity.displayName}</strong><small>{row.identity.title ?? t("ws.role.colleague")}</small></span></label>)}</div></> : <p>{t("ws.channels.noColleagues")}</p>}
      </fieldset>
      {view.error ? <p className="wsd-notice is-error" role="alert">{t(view.error as Parameters<Translate>[0])}</p> : null}
      <div className="wsd-card-actions">{mode === "create" && view.creationUnknown ? <button className="hs-btn sec" onClick={() => void verify()} disabled={view.saving}>{t("ws.composer.verify")}</button>
        : <button className="hs-btn pri" onClick={() => void save()} disabled={busy || !name.trim()}>{t(mode === "create" ? "ws.channels.new" : "ws.channels.save")}</button>}</div>
    </> : null}
    <p className="hs-channel-local-note">{t("ws.channels.localNote")}</p>
  </ShellDialog>;
}

export function channelTranscriptGroups(snapshot: LocalChannelSnapshot) {
  const groups: { id: string; turnId: string; agentId: string | null; displayName: string; history: WorkspaceDevMessage[] }[] = [];
  for (const row of snapshot.messages) {
    const previous = groups[groups.length - 1];
    if (previous && previous.turnId === row.turnId && previous.agentId === row.agentId) previous.history.push(row.message);
    else groups.push({ id: row.id, turnId: row.turnId, agentId: row.agentId, displayName: row.displayName, history: [row.message] });
  }
  return groups;
}
export function LocalChannelThread({ view, colleagues, t, retry, transcript, approval }: { view: LocalChannelsView; colleagues: WorkspaceDevAgent[]; t: Translate; retry: () => void;
  transcript: (messages: WorkspaceDevMessage[], agent?: WorkspaceDevAgent) => ReactNode; approval: (card: WorkspaceDevApproval) => ReactNode }) {
  if (!view.channel) return <section className="hs-col hs-channel-empty"><HashtagIcon className="hico" /><p role="status">{t(view.loading ? "common.loading" : view.error ? "ws.channels.loadFailed" : "ws.channels.unavailable")}</p>
    <button className="hs-btn sec" onClick={retry}>{t("ws.tasks.retry")}</button></section>;
  const channel = view.channel, groups = channelTranscriptGroups(channel);
  return <div className="hs-col wsd-thread hs-channel-thread" data-local-channel={channel.channel.id}>
    {!groups.length ? <section className="hs-hello hs-channel-empty"><HashtagIcon className="hico" /><h2>{t("ws.channels.emptyConversation")}</h2><p>{t("ws.channels.emptyHint")}</p><small>{t("ws.channels.localNote")}</small></section> : null}
    {channel.turns.map(turn => <section className="hs-channel-turn" key={turn.id} aria-label={t("ws.channels.local")}>
      {groups.filter(group => group.turnId === turn.id).map(group => {
        const current = colleagues.find(row => row.agentId === group.agentId), agent = current ? { ...current, identity: { ...current.identity, displayName: group.displayName } } : group.agentId ? {
          agentId: group.agentId, kind: "colleague" as const, state: "archived", identity: { displayName: group.displayName }, runtime: { id: "pi", label: "Pi", available: false },
        } : undefined;
        return <div key={group.id} data-channel-speaker={group.agentId ?? "user"}>{transcript(group.history, agent)}</div>;
      })}
      {turn.replies.filter(row => ["failed", "interrupted"].includes(row.state)).map(row => <p key={row.agentId} className="hs-channel-status" role="status">{t("ws.channels.failedReply", { name: row.displayName })}</p>)}
    </section>)}
    {channel.approvals.map(card => <div key={card.id}>{approval(card)}</div>)}
    {channel.state === "interrupted" || channel.state === "cancelled" ? <p className="hs-channel-status" role="status">{t(channel.state === "interrupted" ? "ws.channels.interrupted" : "ws.channels.cancelled")}</p> : null}
    {["running", "draining"].includes(channel.state) ? <p className="wsd-typing" role="status">{t(channel.state === "draining" ? "ws.draining" : "ws.channels.replying")}</p> : null}
  </div>;
}

export function LocalChannelComposer({ view, model, colleagues, t, disconnected, hasConnection, configure }: { view: LocalChannelsView; model: WorkspaceLocalChannelsModel; colleagues: WorkspaceDevAgent[];
  t: Translate; disconnected: boolean; hasConnection: boolean; configure: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null), channel = view.channel;
  const recipients = view.recipientIds ?? channel?.channel.memberIds ?? [];
  const setRecipients = (value: string[]) => model.setRecipients(value);
  useEffect(() => { input.current?.focus(); }, [view.channelId]);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${Math.min(160, Math.max(32, input.current.scrollHeight))}px`; } }, [view.draft, view.channelId]);
  if (!channel) return null;
  const busy = ["running", "draining"].includes(channel.state), needsConnection = recipients.length > 0 && !hasConnection;
  const canSend = !!view.draft.trim() && view.draft.trim().length <= 4000 && !view.pending && !busy && !disconnected && !needsConnection;
  return <footer className="hs-compose hs-channel-compose">
    {needsConnection ? <p className="hs-channel-status">{t("ws.connection.body")} <button className="hs-btn sec" onClick={configure}>{t("ws.connection.configure")}</button></p> : null}
    {view.error ? <p className="wsd-notice is-error" role="alert">{t(view.error as Parameters<Translate>[0])}</p> : null}
    <details className="hs-channel-recipients"><summary>{t(!recipients.length ? "ws.channels.notesOnly" : recipients.length === channel.channel.memberIds.length ? "ws.channels.replyAll" : recipients.length === 1 ? "ws.channels.replyOne" : "ws.channels.replyCount", { n: recipients.length })}</summary>
      <fieldset disabled={busy || !!view.pending}><legend>{t("ws.channels.responders")}</legend><div className="hs-channel-picker-actions"><button className="hs-btn sec" onClick={() => setRecipients(channel.channel.memberIds)}>{t("ws.channels.all")}</button><button className="hs-btn sec" onClick={() => setRecipients([])}>{t("ws.channels.notesOnly")}</button></div>
        {channel.channel.memberIds.map(id => <label className="hs-channel-recipient" key={id}><input type="checkbox" checked={recipients.includes(id)} onChange={event => setRecipients(event.target.checked ? [...recipients, id] : recipients.filter(value => value !== id))} />{colleagues.find(row => row.agentId === id)?.identity.displayName ?? id}</label>)}
      </fieldset></details>
    <div className="hs-field"><textarea ref={input} aria-label={t("ws.channels.placeholder", { name: channel.channel.name })} placeholder={t("ws.channels.placeholder", { name: channel.channel.name })} value={view.draft} rows={1} maxLength={4000} disabled={disconnected}
      onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void model.send(recipients); } }} />
      {busy ? <button className="hs-stop" onClick={() => void model.cancel()} disabled={disconnected || channel.state === "draining"}><StopIcon className="hico" />{t("ws.composer.stop")}</button>
        : view.pending?.state === "unknown" ? <button className="hs-btn sec" onClick={() => void model.verifyPending()} disabled={disconnected}>{t("ws.composer.verify")}</button>
          : <button className="hs-send" aria-label={t("ws.composer.send")} disabled={!canSend} onClick={() => void model.send(recipients)}><PaperAirplaneIcon className="hico" /></button>}
    </div><p className="hs-hint"><span>{t("ws.channels.localNote")}</span><span>{t("ws.composer.hint.keys")}</span></p>
  </footer>;
}
