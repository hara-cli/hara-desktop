import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo } from "./client";
import { mainAgentRef } from "./agent-office";
import { AgentPortrait } from "./AgentPortrait";
import { agentDisplayName, agentPublicTitle } from "./agent-visual";
import "./AgentPicker.css";

interface AgentPickerProps {
  agents: AgentInfo[];
  currentAgentRef?: string;
  dismissedAgentRefs?: readonly string[];
  locale: "en" | "zh";
  disabled?: boolean;
  onSelect: (agentRef: string) => void;
  onOpenOffice: () => void;
}

export default function AgentPicker({
  agents,
  currentAgentRef,
  dismissedAgentRefs = [],
  locale,
  disabled,
  onSelect,
  onOpenOffice,
}: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = mainAgentRef(currentAgentRef);
  const dismissedActive = activeRef !== "main" && dismissedAgentRefs.includes(activeRef);
  const active = agents.find((agent) => agent.ref === activeRef)
    ?? (dismissedActive ? undefined : agents.find((agent) => agent.ref === "main"));
  const dismissedName = dismissedActive ? activeRef.slice(activeRef.indexOf(":") + 1) : "";
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agents
      .filter((agent) => !needle || [
        agent.name,
        agent.ref,
        agent.description,
        agent.identity?.displayName,
        agent.identity?.title,
        agent.identity?.bio,
        ...(agent.identity?.traits ?? []),
      ].filter(Boolean).join(" ").toLowerCase().includes(needle))
      .sort((left, right) => Number(right.ref === activeRef) - Number(left.ref === activeRef)
        || Number(right.scope === "project") - Number(left.scope === "project")
        || left.name.localeCompare(right.name));
  }, [activeRef, agents, query]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="agent-picker" ref={rootRef}>
      <button
        type="button"
        className="agent-picker-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {active ? (
          <AgentPortrait agentRef={active.ref} name={active.name} identity={active.identity} size="small" />
        ) : <span className="agent-picker-fallback" aria-hidden>—</span>}
        <span className="agent-picker-identity">
          <small>{dismissedActive
            ? (locale === "zh" ? "已离职 Agent" : "Dismissed Agent")
            : (locale === "zh" ? "当前 Agent" : "Agent")}</small>
          <strong>{active ? agentDisplayName(active) : dismissedName || "Hara"}</strong>
        </span>
        <span className="agent-picker-trigger-meta" aria-hidden><b>{agents.length}</b><i>⌄</i></span>
      </button>
      <button
        type="button"
        className="agent-picker-office"
        title={locale === "zh" ? `打开 Agent 办公室 · ${agents.length} 位成员` : `Open Agent Office · ${agents.length} members`}
        aria-label={locale === "zh" ? "打开 Agent 办公室" : "Open Agent Office"}
        disabled={disabled}
        onClick={onOpenOffice}
      >
        <span aria-hidden>◫</span><b>{agents.length}</b>
      </button>
      {open ? (
        <div className="agent-picker-menu" role="dialog" aria-label={locale === "zh" ? "选择 Agent" : "Choose an Agent"}>
          <header>
            <div>
              <strong>{locale === "zh" ? "选择一起工作的 Agent" : "Choose an Agent"}</strong>
              <small>{locale === "zh" ? `${agents.length} 位成员 · 每个 Agent 拥有独立会话历史` : `${agents.length} members · Every Agent keeps separate history`}</small>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenOffice();
              }}
            >
              ◫ {locale === "zh" ? "进入办公室" : "Open office"}
            </button>
          </header>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            placeholder={locale === "zh" ? "搜索名称、项目或职责" : "Search name, project, or role"}
          />
          <div className="agent-picker-list">
            {visible.map((agent) => (
              <button
                type="button"
                key={agent.ref}
                className={agent.ref === activeRef ? "is-active" : ""}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onSelect(agent.ref);
                }}
              >
                <AgentPortrait agentRef={agent.ref} name={agent.name} identity={agent.identity} size="small" />
                <span>
                  <strong>{agentDisplayName(agent)}{agent.identity?.emoji ? <em>{agent.identity.emoji}</em> : null}</strong>
                  <small>{agentPublicTitle(agent) || (agent.scope === "main"
                    ? (locale === "zh" ? "Hara 主 Agent" : "Main Hara Agent")
                    : agent.ref)}</small>
                </span>
                <i>{agent.scope === "project"
                  ? agent.project
                  : agent.scope === "global"
                    ? (locale === "zh" ? "全局" : "Global")
                    : (locale === "zh" ? "主 Agent" : "Main")}</i>
              </button>
            ))}
            {visible.length === 0 ? <p>{locale === "zh" ? "没有匹配的 Agent" : "No matching Agents"}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
