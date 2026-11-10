import { useRef, type ReactNode } from "react";
import { redesignText } from "./desktop-redesign-copy";
import { Avatar } from "./WorkspaceShell";
import { MessageActions } from "./MessageActions";
import { messageShortRole } from "./conversation-message-layout";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import type { makeT } from "./i18n";

export function WorkspaceMessage({ text, user = false, continuation = false, showAuthor = false, agent, locale, metadata, children, t, onReply }: {
  text: string; user?: boolean; continuation?: boolean; showAuthor?: boolean; agent?: WorkspaceDevAgent; locale: string; metadata?: ReactNode; children: ReactNode;
  t: ReturnType<typeof makeT>; onReply?: () => void;
}) {
  const body = useRef<HTMLDivElement>(null), role = messageShortRole(agent?.identity);
  return <article aria-label={user ? redesignText(locale, "yourMessage") : redesignText(locale, "messageFrom", { name: agent?.identity.displayName ?? "Hara" })} className={`wsd-message-group hd-chat-message${user ? " is-user" : " is-agent"}${continuation ? " cont" : ""}${showAuthor ? " has-author" : " is-direct"}`}>
    {showAuthor && !user && !continuation ? <div className="hs-who">{agent?.identity.displayName ?? "Hara"}{role ? <span className="hd-message-role"> · {role}</span> : null}</div> : null}
    <div className={`hs-msg${user ? " me" : ""} wsd-message${user ? " is-user" : " is-agent"}${continuation ? " cont" : ""}`}>
      {showAuthor && !user ? <Avatar agent={agent} /> : null}
      <div className="hd-message-body">
        <div ref={body} className="hs-bub wsd-bubble">{children}</div>
        <MessageActions text={text} body={body} locale={locale} copyLabel={redesignText(locale, "copyMessage")} copiedLabel={t("taskCopied")} failedLabel={t("copyFailed")} onReply={onReply} />
      </div>
    </div>
    {metadata ? <div className="hd-message-meta">{metadata}</div> : null}
  </article>;
}
