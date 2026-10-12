import { memo } from "react";
import type { AgentInfo } from "./client";
import { AgentPortrait } from "./AgentPortrait";
import { agentDisplayName } from "./agent-visual";
import { isRootAgent } from "./agent-session";

export const AgentContact = memo(function AgentContact({
  agent, preview, time, working, unread, selected, locale, onOpen, onDetails,
}: {
  agent: AgentInfo;
  preview: string;
  time?: string;
  working: boolean;
  unread: boolean;
  selected: boolean;
  locale: "en" | "zh";
  onOpen: () => void;
  onDetails: () => void;
}) {
  const name = agentDisplayName(agent);
  const root = isRootAgent(agent);
  return (
    <div className={`inbox-contact-shell${root ? " is-root" : ""}`}>
      <button type="button" className={`inbox-contact${selected ? " is-active" : ""}`}
        aria-current={selected ? "true" : undefined}
        onContextMenu={(event) => { event.preventDefault(); onDetails(); }} onClick={onOpen}>
        <AgentPortrait agentRef={agent.ref} name={agent.name} identity={agent.identity}
          systemRole={agent.systemRole} size={root ? "large" : "medium"} state={working ? "working" : "idle"} />
        <span className="inbox-contact-copy">
          <span className="inbox-contact-line"><strong>{name}</strong>
            {root ? <b className="inbox-agent-root-badge">{locale === "zh" ? "主助手" : "Main"}</b> : null}
            {time ? <time>{time}</time> : null}
          </span>
          <span className="inbox-contact-line preview"><span>{preview}</span>
            {unread ? <i className="inbox-unread-dot" aria-label={locale === "zh" ? "有新消息" : "New messages"} /> : null}
          </span>
        </span>
      </button>
      <button type="button" className="inbox-contact-details"
        title={locale === "zh" ? `${name} · 详情与历史` : `${name} · Details and history`}
        aria-label={locale === "zh" ? `${name}的详情与历史` : `Details and history for ${name}`}
        onClick={onDetails}><span aria-hidden="true">···</span></button>
    </div>
  );
});
