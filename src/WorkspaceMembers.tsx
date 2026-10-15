import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CollaborationView } from "./workspace-collaboration-state";

interface Props {
  members: CollaborationView["members"]; labels: Map<string, string>; ownPrincipalId?: string;
  locale: "en" | "zh"; errorText?: string; onClose: () => void; onRefresh: () => void; onMore: () => void;
  mentionSelection?: { ids: ReadonlySet<string>; disabled: boolean; onToggle: (principalId: string, selected: boolean) => void };
}

/** Non-modal, local presentation of the selected Workspace's Account-authorized roster. */
export default function WorkspaceMembers({ members, labels, ownPrincipalId, locale, errorText, onClose, onRefresh, onMore, mentionSelection }: Props) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null), titleId = useId();
  useLayoutEffect(() => { search.current?.focus(); }, []);
  const copy = (zh: string, en: string) => locale === "zh" ? zh : en;
  const needle = query.normalize("NFKC").trim().toLowerCase();
  const visible = members.items.filter(item => (labels.get(item.principalId) ?? item.displayName).normalize("NFKC").toLowerCase().includes(needle));
  const role = { OWNER: copy("擁有者", "Owner"), ADMIN: copy("管理員", "Admin"), MEMBER: copy("成員", "Member") };
  return <aside className="workspace-collaboration-members" role="dialog" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><div><h2 id={titleId}>{copy("空間成員", "Workspace members")}</h2>
      <p>{copy("人類身份來自此空間的帳號名冊。", "Human identities come from this Workspace's Account roster.")}</p></div>
      <button type="button" aria-label={copy("關閉成員名冊", "Close members")} onClick={onClose}>×</button></header>
    <label className="workspace-collaboration-members-search"><span>{copy("搜尋已載入的成員", "Search loaded members")}</span>
      <input ref={search} value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder={copy("姓名…", "Name…")} /></label>
    <div className="workspace-collaboration-members-list" aria-busy={members.phase === "loading"}>
      {members.phase === "unsupported" ? <p>{copy("目前引擎尚未接上成員名冊。", "This engine has no member-directory connection.")}</p> : null}
      {members.phase === "loading" ? <p role="status">{copy("正在讀取名冊…", "Loading members…")}</p> : null}
      {members.phase === "error" ? <div role="alert"><p>{errorText}</p><button type="button" onClick={members.nextCursor ? onMore : onRefresh}>{copy("重新讀取", "Retry members")}</button></div> : null}
      <ul>{visible.map(member => <li key={member.principalId}>
        <span className="workspace-collaboration-member-avatar" aria-hidden>{Array.from(member.displayName.trim()).slice(0, 2).join("")}</span>
        <div><strong>{labels.get(member.principalId) ?? member.displayName}</strong>
          <span>{copy("人類", "Human")} · {role[member.role]}{member.principalId === ownPrincipalId ? " · " + copy("你", "You") : ""}</span></div>
        {mentionSelection ? <button type="button" aria-pressed={mentionSelection.ids.has(member.principalId)}
          aria-label={copy("提及 ", "Mention ") + (labels.get(member.principalId) ?? member.displayName)}
          disabled={mentionSelection.disabled || members.phase !== "ready" || (!mentionSelection.ids.has(member.principalId) && mentionSelection.ids.size >= 10)}
          onClick={() => mentionSelection.onToggle(member.principalId, !mentionSelection.ids.has(member.principalId))}>
          {mentionSelection.ids.has(member.principalId) ? copy("已選", "Selected") : "@"}</button> : null}
      </li>)}</ul>
      {members.phase === "ready" && !visible.length ? <p>{copy("已載入名冊中沒有符合的成員。", "No matches in the loaded roster.")}</p> : null}
      {members.phase === "ready" && members.nextCursor && !members.limited ? <button type="button" onClick={onMore}>{copy("載入更多成員", "Load more members")}</button> : null}
    </div>
    <footer><span>{copy("已載入", "Loaded")} {members.items.length}{members.nextCursor ? "+" : ""}</span>
      <button type="button" disabled={members.phase === "loading" || members.phase === "unsupported"} onClick={onRefresh}>{copy("更新名冊", "Refresh roster")}</button></footer>
    <small>{members.limited ? copy("本次最多載入 1000 位成員。", "This view loads at most 1,000 members.") : copy("搜尋僅涵蓋已載入名冊，並非全域搜尋。", "Search covers loaded members, not a global directory.")}
      {mentionSelection ? copy(" 每則訊息最多選擇 10 位提及對象；選人不會發送訊息。", " Select up to 10 mention targets per message; selecting does not send.") : ""}
      {copy(" 尚未接入 Agent 成員；此處不授予執行權限。", " Agent members are not connected; this view grants no execution permissions.")}</small>
  </aside>;
}
