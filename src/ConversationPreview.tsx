// Development-only, synthetic component fixture. No Engine, native APIs, external messages, or keys.
import { useEffect, useRef, useState } from "react";
import type { AgentInfo } from "./client";
import { AgentContact } from "./AgentContact";
import AgentInboxList from "./AgentInboxList";
import AgentProfileEditor from "./AgentProfileEditor";
import AgentDetailsDrawer from "./AgentDetailsDrawer";
import NewConversationMenu from "./NewConversationMenu";
import { ComposerInputRow } from "./ComposerInputRow";
import { ConversationTimeline, type ConversationItem } from "./ConversationTimeline";
import { DecisionCard } from "./DecisionCard";
import ExtensionDock from "./ExtensionDock";
import { makeT, type Locale } from "./i18n";
import { agentDisplayName } from "./agent-visual";
import { inboxMessagePreview } from "./workbench-inbox";
import { isImeCompositionKey } from "./ime";
import { IconBack, IconChevronDown, IconPlus, IconCog } from "./icons";
import "./App.css";
import "./ConversationWorkspace.css";

export default function ConversationPreview({ locale, scenario, theme, extension }: {
  locale: Locale;
  scenario?: string | null;
  theme?: string | null;
  extension?: boolean;
}) {
  const zh = locale === "zh";
  const t = makeT(locale);
  const [agents, setAgents] = useState<AgentInfo[]>(() => [
    { ref: "main", name: "Hara", description: zh ? "理解需求，安排工作，跟进结果" : "Understands, coordinates, and follows through", home: "/workspace/hara", scope: "main", owner: "personal", allowedActions: ["chat", "edit_profile"], revision: "synthetic-profile", systemRole: "root_orchestrator", identity: { version: 1, displayName: "Hara", title: zh ? "你的主理 Agent" : "Your main Agent", bio: zh ? "和我聊聊你想做的事。我会安排合适的同事一起推进。" : "Tell me what you have in mind. I will bring in the right colleague to help.", traits: zh ? ["主动", "务实", "有始有终"] : ["Resourceful", "Practical", "Accountable"], source: "hara" } },
    { ref: "global:lin", name: "Lin", description: zh ? "开发与代码审查" : "Development and code review", home: "/workspace/sample-project", scope: "global", owner: "personal", allowedActions: ["chat", "edit_profile"] },
    { ref: "global:mori", name: "Mori", description: zh ? "产品设计" : "Product design", home: "", scope: "global", owner: "personal", allowedActions: ["chat"] },
    ...(scenario === "roster" ? Array.from({length: 24}, (_, index): AgentInfo => ({
      ref: `global:colleague-${index}`, name: `Colleague ${index + 1}`, description: "Synthetic colleague",
      home: "", scope: "global", owner: "personal", allowedActions: ["chat"],
    })) : []),
  ]);
  const [selected, setSelected] = useState("main");
  const [details, setDetails] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [directory, setDirectory] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [extensionVisible, setExtensionVisible] = useState(extension === true);
  const [mode, setMode] = useState<"docked" | "maximized">("docked");
  const [items, setItems] = useState<ConversationItem[]>(() => [
    { kind: "user", text: zh ? "帮我看一下这个页面，交互还能怎么简化？" : "Could you review this page and help simplify the interactions?" },
    { kind: "text", text: zh ? "可以。我先看用户最常做的事，再把不常用的操作收起来。" : "Of course. I will start with the everyday flow, then tuck the less frequent actions out of the way." },
    { kind: "tool", name: "read_file", preview: "Synthetic component fixture" },
    { kind: "text", text: zh ? "我建议保留三个重点：\n\n- 左侧找到同事，点开就接着聊。\n- 需要你决定时，直接在消息里选择。\n- 细节按需展开，任务结束后给你一个明确结果。\n\n原来的历史和权限边界都会保留。" : "I would keep three things in focus:\n\n- Find a colleague on the left and pick up the chat.\n- Make decisions right in the conversation.\n- Open details only when you need them, with a clear result at the end.\n\nYour history and permission boundaries stay intact." },
    ...(scenario === "long" ? [{ kind: "text" as const, text: `## ${zh ? "长内容与代码" : "Long content and code"}\n\n${(zh ? "这是一段用于检查窄窗口阅读的示例文字，不包含业务数据。" : "This is synthetic sample text for checking long-form reading in a narrow window. ").repeat(20)}\n\n| ${zh ? "功能" : "Feature"} | ${zh ? "位置" : "Location"} |\n|---|---|\n| ${zh ? "历史" : "History"} | ${zh ? "同事详情" : "Colleague details"} |\n\n\`\`\`typescript\nconst message = { sender: "Hara", body: "${"long_content_".repeat(24)}" };\n\`\`\`` }] : []),
    ...(scenario === "approval" ? [{ kind: "approval" as const, approvalId: "synthetic-approval", question: zh ? "允许 Lin 修改本次指定的示例文件吗？" : "Allow Lin to edit the sample file for this action?", allowAlways: false }] : []),
  ]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const agent = agents.find((entry) => entry.ref === selected)!;
  const detail = agents.find((entry) => entry.ref === details);
  const profileAgent = agents.find((entry) => entry.ref === profile);
  const pendingApproval = items.some((item) => item.kind === "approval" && !item.answered);
  useEffect(() => { document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"; }, [theme]);
  const send = () => {
    if (!input.trim()) return;
    setItems((current) => [...current, { kind: "user", text: input }, { kind: "text", text: zh ? "收到。这是本地组件预览，不会执行真实任务。" : "Got it. This is a local component preview; no real task is executed." }]);
    setInput("");
  };
  const chat = <main className="chat im">
    <div className="anchor"><div className="conversation-destination">
      <button type="button" className="conversation-directory-button" aria-label={zh ? "返回聊天列表" : "Back to chats"} onClick={() => setDirectory(true)}><IconBack size={18} /></button>
      <button type="button" className="conversation-person" onClick={() => setDetails(selected)} aria-haspopup="dialog">
        <span><b>{agentDisplayName(agent)}</b><small>{agent.description}</small></span><IconChevronDown size={13} /></button>
    </div><div className="anchor-actions"><button className="paneltab" onClick={() => setExtensionVisible((value) => !value)}>{zh ? "侧屏" : "Side panel"}</button></div></div>
    <ConversationTimeline items={items} busy={false} assistantName={agentDisplayName(agent)} sessionId="synthetic-session"
      displayMode="concise" bottomRef={bottom} t={t} onRewind={() => setNotice("preview-only")}
      onApproval={async (approvalId, verdict) => setItems((current) => current.map((item) => item.kind === "approval" && item.approvalId === approvalId ? { ...item, answered: verdict } : item))}
      interactionCards={scenario === "decision" ? <DecisionCard question={zh ? "你想先优化哪个部分？" : "Which part should we improve first?"}
        options={zh ? ["先简化聊天", "先整理同事入口", "先保留现状"] : ["Simplify the chat first", "Organize colleague navigation", "Keep things as they are"]}
        busy={false} t={t} onSelect={async (option) => { setNotice(option); }} /> : undefined} />
    <div className="inputbar"><div className="composer-shell"><div className="composer-context-row" />
      <ComposerInputRow inputRef={textarea} value={input} busy={false} canSend={Boolean(input.trim())}
        sendLabel={t("send")} stopLabel={t("stop")} onSend={send} onStop={() => {}}>
        <textarea ref={textarea} rows={1} aria-label={zh ? "消息" : "Message"} value={input}
          placeholder={zh ? `发消息给 ${agentDisplayName(agent)}…` : `Message ${agentDisplayName(agent)}…`}
          onChange={(event) => setInput(event.target.value)} onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => {
            if (composing.current || isImeCompositionKey(event.nativeEvent)) return;
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
          }} />
      </ComposerInputRow>
      <div className="composer-toolbar"><button className="composer-tool-button" onClick={() => setNotice("preview-only")}><IconPlus size={15} />{zh ? "添加上下文" : "Add context"}</button>
        <button className="model-pill" onClick={() => setNotice("preview-only")}><IconCog size={14} />{zh ? "运行设置" : "Runtime"}<IconChevronDown size={13} /></button></div>
    </div></div>
  </main>;
  return <div className={`app conversation-first has-active-conversation${directory ? " is-contact-directory" : ""}`} data-conversation-preview>
    <nav className="rail" aria-label="Preview"><span style={{ color: "var(--accent)", fontWeight: 750 }}>H</span></nav>
    <aside className="sidebar workbench-sidebar"><div className="brand" style={{ fontSize: 24, padding: "12px 6px" }}>Hara</div>
      <div className="workbench-inbox-heading"><strong>{zh ? "聊天" : "Chats"}</strong></div>
      <div className="workbench-sidebar-actions"><NewConversationMenu agents={agents} locale={locale} canCreateAgent
        onSelectAgent={(ref) => { setSelected(ref); setDirectory(false); }} onCreateAgent={() => setNotice("preview-only")}
        onNewTopic={() => { setItems([]); setDirectory(false); }} /></div>
      <input className="search" aria-label={zh ? "搜索聊天" : "Search chats"} placeholder={zh ? "搜索…" : "Search…"} />
      <div className="sessions workbench-inbox"><AgentInboxList entries={agents.map((agent) => ({agent, sessions: []}))} locale={locale}
        renderContact={({agent: entry}) => <AgentContact key={entry.ref} agent={entry} locale={locale}
        preview={entry.ref === "main" ? inboxMessagePreview(items) : entry.description} time="12:42" working={false}
        selected={selected === entry.ref} unread={entry.ref === "global:lin"} onOpen={() => { setSelected(entry.ref); setDirectory(false); }} onDetails={() => setDetails(entry.ref)} />} /></div>
      <small style={{ padding: 8, color: "var(--dim)" }}>{notice || (zh ? "仅合成组件预览 · 无外部操作" : "Synthetic component preview · No external actions")}</small>
    </aside>
    {extension ? <div className={`extension-work conversation-extension-work${pendingApproval ? " has-pending-approval" : ""}${extensionVisible ? " has-visible-extension" : ""}${mode === "maximized" && extensionVisible ? " is-extension-maximized" : ""}`}>
      <div className="extension-primary">{chat}</div><ExtensionDock kind="files" kindLabel={zh ? "文件" : "Files"} title="sample.ts" source="Synthetic" context="Preview" mode={mode}
        collapsed={!extensionVisible} onModeChange={setMode} onClose={() => setExtensionVisible(false)}
        copy={{ extension: zh ? "侧屏" : "Side panel", resize: "Resize", maximize: "Maximize", restore: "Restore", popOut: "Pop out", hide: "Hide", backToChat: zh ? "返回聊天" : "Back to chat", close: "Close", add: "Add" }}>
        <pre style={{ padding: 24 }}>// Synthetic file preview. No native execution.</pre></ExtensionDock></div> : chat}
    {detail ? <AgentDetailsDrawer agent={detail} locale={locale} historyCount={3} onClose={() => setDetails(null)}
      onHistory={() => { setNotice(zh ? "聊天历史：3 段话题（预览）" : "Chat history: 3 topics (preview)"); setDetails(null); setDirectory(true); }}
      onManage={() => { setProfile(detail.ref); setDetails(null); }} /> : null}
    {profileAgent ? <AgentProfileEditor key={profileAgent.ref} agent={profileAgent} locale={locale}
      onClose={() => setProfile(null)} onSave={(identity) => {
        setAgents((current) => current.map((entry) => entry.ref === profileAgent.ref
          ? {...entry, identity: {...identity, version: 1, source: "hara"}} : entry));
        setProfile(null);
      }} /> : null}
  </div>;
}
