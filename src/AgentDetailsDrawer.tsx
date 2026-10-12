import { useEffect, useId, useRef } from "react";
import type { AgentInfo } from "./client";
import { AgentPortrait } from "./AgentPortrait";
import { agentDisplayName, agentPublicTitle } from "./agent-visual";
import { isRootAgent } from "./agent-session";
import { IconClose, IconFolder, IconArchive, IconEdit } from "./icons";

/** Public catalog data only. Opening/closing this drawer never touches an Agent or runtime lifecycle. */
export default function AgentDetailsDrawer({ agent, locale, historyCount, onClose, onHistory, onManage }: {
  agent: AgentInfo;
  locale: "en" | "zh";
  historyCount: number;
  onClose: () => void;
  onHistory: () => void;
  onManage: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const zh = locale === "zh";
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const siblings = Array.from(root.current?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== root.current);
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); close.current();
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      siblings.forEach((element, index) => { element.inert = previousInert[index] ?? false; });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="agent-details-backdrop" ref={root} onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="agent-details-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <header><strong>{zh ? "同事详情" : "Colleague details"}</strong>
          <button type="button" onClick={onClose} aria-label={zh ? "关闭详情，返回聊天" : "Close details and return to chat"}>
            <IconClose size={18} /></button></header>
        <div className="agent-details-content">
          <section className="agent-details-identity">
            <AgentPortrait agentRef={agent.ref} name={agent.name} identity={agent.identity} size="large" />
            <h2 id={titleId}>{agentDisplayName(agent)}</h2>
            <p>{agentPublicTitle(agent)}</p>
            {isRootAgent(agent) ? <span className="agent-details-root">{zh ? "你的主 Agent · 对话与团队的托底者" : "Your main Agent · Coordinates and follows through"}</span> : null}
          </section>
          {agent.identity?.bio || agent.description ? <p className="agent-details-bio">{agent.identity?.bio || agent.description}</p> : null}
          {agent.identity?.traits?.length ? <ul className="agent-details-traits" aria-label={zh ? "个性" : "Traits"}>
            {agent.identity.traits.map((trait, index) => <li key={`${index}:${trait}`}>{trait}</li>)}
          </ul> : null}
          <div className="agent-details-rows">
            <button type="button" onClick={onHistory} disabled={!historyCount}>
              <IconArchive size={18} /><span><strong>{zh ? "聊天历史" : "Chat history"}</strong>
                <small>{zh ? `${historyCount} 段对话记录，原始记录保留` : `${historyCount} conversations; original records are kept`}</small></span><b>›</b>
            </button>
            {agent.home ? <div className="agent-details-row"><IconFolder size={18} />
              <span><strong>{zh ? "工作目录" : "Workspace"}</strong><small className="agent-details-path">{agent.home}</small></span></div> : null}
            <button type="button" onClick={onManage}><IconEdit size={18} /><span>
              <strong>{agent.allowedActions.includes("edit_profile") ? (zh ? "编辑名片与偏好" : "Edit profile and preferences") : (zh ? "查看管理边界" : "View management policy")}</strong>
              <small>{zh ? "昵称、个性与执行偏好" : "Name, personality, and execution preferences"}</small></span><b>›</b></button>
          </div>
          <section className="agent-details-boundary"><strong>{zh ? "执行与权限" : "Execution and permissions"}</strong>
            <p>{zh ? "编程、电脑操作和外部发送仍按任务单独授权。浏览名片不会增加权限，关闭详情也不会停止工作。" : "Coding, computer actions, and external sends keep their task-specific approvals. Viewing this profile grants no access; closing it stops no work."}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
