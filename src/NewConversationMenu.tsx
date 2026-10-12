import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AgentInfo } from "./client";
import { agentDisplayName, agentPublicTitle } from "./agent-visual";
import { AgentPortrait } from "./AgentPortrait";
import { IconBack, IconPlus, IconSparkles, IconUsers } from "./icons";

/** A navigation menu, never an execution or permission grant. Selecting a colleague opens their
 * existing chat; only the separately named fresh-topic action can create a new execution segment. */
export default function NewConversationMenu({
  agents, locale, canCreateAgent, busy, onSelectAgent, onCreateAgent, onNewTopic,
}: {
  agents: readonly AgentInfo[];
  locale: "en" | "zh";
  canCreateAgent: boolean;
  busy?: boolean;
  onSelectAgent: (agentRef: string) => void;
  onCreateAgent: () => void;
  onNewTopic?: () => void;
}) {
  const [page, setPage] = useState<"actions" | "people" | null>(null);
  const [query, setQuery] = useState("");
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const zh = locale === "zh";
  useEffect(() => {
    if (!page) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(
      '[data-menu-autofocus], [role="menuitem"]:not(:disabled)',
    )?.focus());
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPage(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
    };
  }, [page]);
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setPage(null);
      trigger.current?.focus();
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown"
      ? (index + 1) % buttons.length
      : (index <= 0 ? buttons.length : index) - 1;
    buttons[next]?.focus();
  };
  const choose = (action: () => void) => { setPage(null); setQuery(""); action(); };
  const needle = query.trim().toLowerCase();
  const visible = agents.filter((agent) => !needle || [agentDisplayName(agent), agentPublicTitle(agent)]
    .some((value) => value.toLowerCase().includes(needle)));
  return (
    <div className="new-chat-menu" ref={root} onKeyDown={handleKeys} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setPage(null);
    }}>
      <button ref={trigger} type="button" className="new-chat-trigger" aria-haspopup="menu"
        aria-expanded={page !== null} aria-controls={page ? menuId : undefined}
        onClick={() => { setQuery(""); setPage((current) => current ? null : "actions"); }}>
        <IconPlus size={17} /><span>{zh ? "新建" : "New"}</span>
      </button>
      {page ? (
        <div className="new-chat-popover" id={menuId}>
          {page === "people" ? <>
            <div className="new-chat-people-head">
              <button type="button" className="new-chat-back" aria-label={zh ? "返回新建菜单" : "Back to New"}
                onClick={() => setPage("actions")}><IconBack size={16} /></button>
              <strong>{zh ? "和谁聊聊？" : "Who would you like to talk to?"}</strong>
            </div>
            <input data-menu-autofocus value={query} onChange={(event) => setQuery(event.target.value)}
              aria-label={zh ? "搜索同事" : "Search colleagues"} placeholder={zh ? "搜索名字或职责" : "Search name or role"} />
          </> : null}
          <div role="menu" aria-label={zh ? "新建" : "New"} className="new-chat-menu-items">
            {page === "actions" ? <>
              <button type="button" role="menuitem" onClick={() => setPage("people")}>
                <IconUsers size={18} /><span><strong>{zh ? "发起聊天" : "Start a chat"}</strong>
                  <small>{zh ? "选择同事，接着聊" : "Choose a colleague and pick up the conversation"}</small></span>
              </button>
              {onNewTopic ? <button type="button" role="menuitem" disabled={busy} onClick={() => choose(onNewTopic)}>
                <IconPlus size={18} /><span><strong>{zh ? "开始新话题" : "Start a fresh topic"}</strong>
                  <small>{zh ? "与当前同事另聊一件事，保留原有历史" : "A fresh start with this colleague; history is kept"}</small></span>
              </button> : null}
              {canCreateAgent ? <button type="button" role="menuitem" onClick={() => choose(onCreateAgent)}>
                <IconSparkles size={18} /><span><strong>{zh ? "创建 Agent" : "Create an Agent"}</strong>
                  <small>{zh ? "从推荐角色开始，或自定义一位同事" : "Start with a recommended role or make your own"}</small></span>
              </button> : null}
            </> : visible.map((agent) => (
              <button type="button" role="menuitem" key={agent.ref} onClick={() => choose(() => onSelectAgent(agent.ref))}>
                <AgentPortrait agentRef={agent.ref} name={agent.name} identity={agent.identity} systemRole={agent.systemRole} size="small" />
                <span><strong>{agentDisplayName(agent)}</strong><small>{agentPublicTitle(agent)}</small></span>
              </button>
            ))}
          </div>
          {page === "people" && !visible.length ? <p className="new-chat-empty">{zh ? "没有找到这位同事" : "No matching colleague"}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
