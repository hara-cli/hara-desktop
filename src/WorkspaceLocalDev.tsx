import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import HaraLogo from "./mark";
import { WorkspaceDevConnectionClient, type WorkspaceDevConnection } from "./workspace-dev-rpc";
import { WorkspaceDevModel, type WorkspaceDevMessage, type WorkspaceDevAgent, type WorkspaceDevApproval } from "./workspace-dev-state";
import "./workspace-local-dev.css";

const TOOL_LABELS: Record<string, string> = { task_intake: "確認任務", task_checkpoint: "保存驗證回執", todo_write: "更新步驟",
  workspace_read: "查看文件", workspace_write: "寫入文件", workspace_verify: "核驗內容", agent_list: "查看同事", agent_create: "建立同事", agent_contact: "委派同事" };
function Avatar({ agent, large = false }: { agent?: WorkspaceDevAgent; large?: boolean }) {
  return <span className={`wsd-avatar ${agent?.kind === "main" ? "is-main" : ""} ${large ? "is-large" : ""}`}>
    {agent?.kind === "main" ? <HaraLogo size={large ? 36 : 25} /> : (agent?.identity.displayName.slice(0, 1) ?? "H")}
  </span>;
}
function ApprovalCard({ card, model }: { card: WorkspaceDevApproval; model: WorkspaceDevModel }) {
  const [pending, setPending] = useState(false);
  const decide = async (approved: boolean) => { if (pending) return; setPending(true); try { await model.respond(card, approved); } finally { setPending(false); } };
  return <section className="wsd-approval" role="dialog" aria-label="確認建立同事">
    <div className="wsd-kicker">HARA 想請你確認</div><h3>讓 {card.draft.displayName} 加入這個空間？</h3>
    <p>{card.draft.title} <span className="wsd-pill">Pi · 內建</span></p>
    <details><summary>職責與邊界</summary><p>{card.draft.instructions}</p><p>只在目前 Workspace 工作；這張卡不授予額外工具或電腦權限。</p></details>
    <div className="wsd-card-actions"><button onClick={() => void decide(false)} disabled={pending}>暫不建立</button>
      <button className="wsd-primary" onClick={() => void decide(true)} disabled={pending}>確認建立同事</button></div>
  </section>;
}
function Transcript({ history, agent }: { history: WorkspaceDevMessage[]; agent?: WorkspaceDevAgent }) {
  return <>{history.map((message, index) => {
    if (message.role === "tool") return null;
    if (message.role === "user") return <div className="wsd-message is-user" key={`user-${index}`}><div className="wsd-bubble">{message.content}</div></div>;
    const next = history[index + 1], results = next?.role === "tool" ? next.results : [];
    return <div className="wsd-message is-agent" key={`assistant-${index}`}>
      {message.text.trim() ? <><div className="wsd-message-author"><Avatar agent={agent} /><span>{agent?.identity.displayName ?? "Hara"}</span></div><div className="wsd-bubble">{message.text}</div></> : null}
      {message.tools.length ? <details className="wsd-execution"><summary>{message.tools.length} 個操作 <span>查看執行詳情</span></summary>
        <div className="wsd-execution-body">{results.map(result => <div key={result.id}><strong>{TOOL_LABELS[result.name] ?? result.name}</strong>
          <pre className={result.isError ? "is-error" : ""}>{result.content.slice(0, 5000)}</pre></div>)}</div></details> : null}
    </div>;
  })}</>;
}
function WorkspaceScreen({ model, disconnected, onReconnect, root }: { model: WorkspaceDevModel; disconnected: string; onReconnect: () => void; root: string }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [settings, setSettings] = useState(false), [creating, setCreating] = useState(false), [name, setName] = useState("我的工作空間");
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const workspace = view.workspace, agents = workspace?.agents ?? view.roster, agent = agents.find(row => row.agentId === view.agentId);
  const busy = workspace ? ["running", "draining"].includes(workspace.conversation.state) : false;
  const hasConnection = Boolean(workspace?.connections.defaultConnectionId);
  const realKey = view.directory?.syntheticOnly === false;
  const connect = () => realKey ? model.addApprovedConnection() : model.addSynthetic();
  const canSend = Boolean(workspace && hasConnection && view.draft.trim() && !view.sending && !busy && !view.pendingUnknown && !disconnected);
  useEffect(() => { if (nearBottom.current) end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [workspace?.conversation.history.length, workspace?.approvals.length, busy]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [model, busy]);
  useEffect(() => { if (workspace?.selectedAgentId) input.current?.focus(); }, [workspace?.selectedAgentId]);
  const create = async () => { await model.createWorkspace(name); setCreating(false); };
  return <div className="wsd-app">
    <aside className="wsd-sidebar">
      <div className="wsd-brand"><HaraLogo size={29} /><span>Hara</span><small>WORKSPACE LAB</small></div>
      <label className="wsd-space-label">目前空間</label>
      <div className="wsd-space-switch"><select aria-label="切換 Workspace" value={view.workspaceId ?? ""} disabled={view.loading || !view.directory?.workspaces.length}
        onChange={event => { setSettings(false); void model.selectWorkspace(event.target.value); }}>
        <option value="" disabled>選擇工作空間</option>{view.directory?.workspaces.map(row => <option value={row.workspaceId} key={row.workspaceId} disabled={!row.active}>{row.label}</option>)}
      </select><button aria-label="建立新 Workspace" title="建立新 Workspace" onClick={() => setCreating(true)}>＋</button></div>
      {view.workspaceId && agents.length ? <>
        {agents.filter(row => row.kind === "main").map(row => <button key={row.agentId} disabled={view.loading} className={`wsd-contact is-main ${row.agentId === view.agentId ? "is-selected" : ""}`}
          onClick={() => { if (row.agentId !== view.agentId) void model.selectAgent(row.agentId); }}><Avatar agent={row} large />
          <span><strong>{row.identity.displayName}<small>主 Hara</small></strong><em>你的總調度，也是聊天的起點</em></span><span className="wsd-online" /></button>)}
        <div className="wsd-section-label">同事 <span>{agents.filter(row => row.kind === "colleague").length}</span></div>
        <div className="wsd-colleagues">{agents.filter(row => row.kind === "colleague").map(row => <button disabled={view.loading} className={`wsd-contact ${row.agentId === view.agentId ? "is-selected" : ""}`} key={row.agentId}
          onClick={() => { if (row.agentId !== view.agentId) void model.selectAgent(row.agentId); }}><Avatar agent={row} /><span><strong>{row.identity.displayName}</strong><em>{row.identity.title ?? "AI 同事"} · {row.runtime.id === "pi" ? "Pi" : row.runtime.label}</em></span></button>)}
          {!agents.some(row => row.kind === "colleague") ? <p className="wsd-sidebar-note">跟 Hara 聊聊你需要誰，<br />它會提議合適的同事。</p> : null}</div>
        <button className="wsd-new-colleague" disabled={view.loading} onClick={() => { const main = agents.find(row => row.kind === "main"); if (main && main.agentId !== view.agentId) void model.selectAgent(main.agentId); else model.setDraft("建立一位同事 Coder，負責本空間的文件工作"); }}>＋ 與 Hara 討論新同事</button>
      </> : <p className="wsd-sidebar-note">每個空間都有自己的<br />Hara、同事、連接與記憶。</p>}
      <div className="wsd-sidebar-footer"><span className="wsd-test-mode"><i />{realKey ? "火山真實模型驗收" : "本機合成驗收"}</span><button onClick={() => setSettings(current => !current)} disabled={!workspace} aria-label="空間設定">⚙</button></div>
    </aside>
    <main className="wsd-chat">
      <header className="wsd-header"><div className="wsd-header-person"><Avatar agent={agent} /><div><strong>{agent?.identity.displayName ?? "歡迎來到 Hara"}</strong><small>{agent ? `${agent.kind === "main" ? "主 Hara" : "AI 同事"} · Pi 內建 Runtime` : "從一個屬於你的空間開始"}</small></div></div>
        <button onClick={() => setSettings(current => !current)} disabled={!workspace}>空間設定 <span>↗</span></button></header>
      {disconnected ? <div className="wsd-notice" role="alert">連接中斷；歷史與產物仍在本機，不會自動重跑。<button onClick={onReconnect}>重新連接</button></div> : null}
      {view.error ? <div className="wsd-notice is-error" role="alert">{view.error}</div> : null}
      <div className="wsd-scroll" onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 180; }}>
        {!workspace && view.loading && view.workspaceId ? <div className="wsd-sidebar-note">正在打開對話…</div> : !workspace ? <section className="wsd-welcome"><div className="wsd-welcome-mark"><HaraLogo size={57} /></div><p className="wsd-kicker">YOUR PEOPLE. YOUR SPACE.</p>
          <h1>一個空間，<br />從你和 Hara 開始。</h1><p>聊天、找同事、一起完成事情。<br />連接、任務與歷史都留在各自的 Workspace。</p>
          <button className="wsd-primary" onClick={() => setCreating(true)} disabled={view.loading}>{view.loading ? "正在打開空間…" : "建立個人 Workspace"}</button>
          <small>這是隔離的本機 Dev，不讀寫日常 Hara 資料。{realKey ? "本次使用已批准的火山 Key 文件引用。" : "不連接真實模型。"}</small></section>
          : <div className="wsd-thread">
            {!hasConnection ? <section className="wsd-connect-card"><div className="wsd-kicker">先準備好這個空間</div><h2>跟 Hara 聊天，先接上模型。</h2>
              <p>{realKey ? `使用已批准的火山 Coding Plan 連接；Key 只在本機引擎讀取，不會傳到這個介面。整片上限 ${workspace.budget?.maxTokens ?? "待核對"} token／${workspace.budget?.maxRequests ?? "待核對"} 次請求，跨任務及重啟累計。` : "本次只啟用固定合成腳本，驗證 Pi 與任務流程。沒有外部模型請求或額度消耗。"}</p><button className="wsd-primary" onClick={() => void connect()}>{realKey ? "引用已授權火山 Key" : "啟用本機合成連接"}</button></section> : null}
            {hasConnection && !workspace.conversation.history.length ? <div className="wsd-chat-start"><h2>今天，想一起完成什麼？</h2><p>先打個招呼，或請我「建立同事 Coder」。</p>
              <button onClick={() => model.setDraft("建立一位同事 Coder，負責本空間的文件工作")}>建立一位同事 <span>↗</span></button></div> : null}
            <Transcript history={workspace.conversation.history} agent={agent} />
            {workspace.approvals.map(card => <ApprovalCard key={card.id} card={card} model={model} />)}
            {workspace.conversation.completion?.state === "verified" && workspace.conversation.taskState === "completed" ? <p className="wsd-verified">✓ 已核驗結果 <span>任務已閉環，詳情按需展開</span></p> : null}
            {["needs_recovery", "blocked", "cancelled", "interrupted"].includes(workspace.conversation.state) ? <section className="wsd-resume"><strong>{workspace.conversation.state === "cancelled" ? "本次執行已取消" : "上次任務尚未完成"}</strong>
              {workspace.conversation.blockReason ? <p role="alert">{workspace.conversation.blockReason}</p> : null}
              <p>歷史與已產生的文件都保留了。請先檢查結果，再明確繼續原任務；重啟不會自動重跑。</p><button onClick={() => void model.send(true)} disabled={view.sending || !hasConnection}>繼續原任務</button></section> : null}
            {busy && !workspace.approvals.length ? <div className="wsd-typing"><Avatar agent={agent} /><span>{workspace.conversation.state === "draining" ? "正在取消，等待原操作安全結束" : `${agent?.identity.displayName ?? "Hara"} 正在回覆`}</span><i /><i /><i /></div> : null}
            <div ref={end} /></div>}
      </div>
      {workspace ? <footer className="wsd-composer-wrap"><div className="wsd-composer"><textarea ref={input} aria-label={`發訊息給 ${agent?.identity.displayName ?? "Hara"}`} value={view.draft}
        placeholder={hasConnection ? `發訊息給 ${agent?.identity.displayName ?? "Hara"}…` : "請先啟用這個空間的連接"} disabled={!hasConnection || Boolean(disconnected)} rows={2}
        onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void model.send(); } }} />
        <div className="wsd-composer-bar"><span>Pi <i /> 本空間預設連接</span>{busy ? <button onClick={() => void model.cancel()} disabled={workspace.conversation.state === "draining"}>停止</button>
          : view.pendingUnknown ? <button onClick={() => void model.send(false, true)}>核對上次送出結果</button> : <button className="wsd-send" onClick={() => void model.send()} disabled={!canSend} aria-label="發送訊息">↑</button>}</div></div>
        <p>{realKey ? "真實模型 · 火山 Coding Plan · 本機隔離驗收" : "合成模式 · 固定場景腳本，不代表真實模型能力"} <span>Enter 發送，Shift + Enter 換行</span></p></footer> : null}
    </main>
    {creating ? <div className="wsd-modal-backdrop"><section className="wsd-modal" role="dialog" aria-modal="true" aria-labelledby="wsd-create-title"><button className="wsd-close" aria-label="關閉建立空間" onClick={() => setCreating(false)}>×</button>
      <p className="wsd-kicker">A FRESH WORKSPACE</p><h2 id="wsd-create-title">給新空間一個名字。</h2><p>會為你準備獨立的主 Hara。連接與同事稍後透過聊天安排。</p><label>空間名稱<input autoFocus aria-label="Workspace 名稱" value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) void create(); }} /></label>
      <button className="wsd-primary" onClick={() => void create()} disabled={view.loading || !name.trim()}>建立 Workspace</button></section></div> : null}
    {settings && workspace ? <aside className="wsd-settings" role="dialog" aria-label="目前 Workspace 設定"><button className="wsd-close" aria-label="關閉空間設定" onClick={() => setSettings(false)}>×</button>
      <p className="wsd-kicker">WORKSPACE SETTINGS</p><h2>{workspace.label}</h2><p>這裡的連接只屬於目前空間。開始執行後，任務會固定原連接，不跟隨預設切換。</p>
      <h3>模型連接</h3>{workspace.connections.connections.map(connection => <div className="wsd-connection" key={connection.id}><strong>{connection.label}</strong><small>{connection.defaultModel} · {connection.status === "active" ? "已配置" : "已撤銷"}</small></div>)}
      {!hasConnection ? <button className="wsd-primary" onClick={() => void connect()}>{realKey ? "引用已授權火山 Key" : "啟用本機合成連接"}</button> : null}
      <h3>Runtime</h3><p>Pi 已內建。本次僅開通 Pi；其他編程 Runtime 尚未接入這條通用 Agent 鏈路。</p>
      <details><summary>本機驗收資料</summary><p className="wsd-root">{root}</p><p>{workspace.conversation.pastTaskCount} 項歷史任務 · {workspace.conversation.usage.modelCalls} 次{realKey ? "模型步驟" : "合成步驟"}。不是供應商帳單。</p>
        {workspace.budget ? <p>全片 {workspace.budget.requests}/{workspace.budget.maxRequests} 次請求 · 已回報 {workspace.budget.inputTokens + workspace.budget.outputTokens}/{workspace.budget.maxTokens} token；未結算預留 {workspace.budget.uncertainReservedTokens}。</p> : null}</details>
      <small>未讀寫日常 Hara 資料，沒有發布。{realKey ? "真實模型實測受獨立預算限制。" : "未啟用真實模型。"}</small></aside> : null}
  </div>;
}

export default function WorkspaceLocalDev() {
  const [model, setModel] = useState<WorkspaceDevModel | null>(null), [error, setError] = useState(""), [root, setRoot] = useState(""), [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    let active = true, client: WorkspaceDevConnectionClient | undefined;
    setError(""); setModel(null);
    void (async () => {
      const info = await invoke<WorkspaceDevConnection>("workspace_dev_connection"); if (!active) return;
      client = new WorkspaceDevConnectionClient(info, () => { if (active) setError("本機引擎連接已中斷"); });
      await client.initialize(info.token); if (!active) { client.close(); return; }
      const next = new WorkspaceDevModel(client, undefined, info.syntheticOnly); client.setChangedListener(id => { if (active && next.getSnapshot().workspaceId === id) void next.refresh(); });
      setRoot(info.root); setModel(next); await next.loadDirectory();
      const directory = next.getSnapshot().directory;
      if (active && directory?.activeWorkspaceId && directory.workspaces.some(row => row.workspaceId === directory.activeWorkspaceId && row.active)) await next.selectWorkspace(directory.activeWorkspaceId);
    })().catch(() => { if (active) setError("無法連接這次隔離的 Workspace Dev。請先啟動專用驗收腳本；沒有連接或啟停正式版引擎。"); });
    return () => { active = false; client?.close(); };
  }, [reconnect]);
  if (!model) return <div className="wsd-boot"><HaraLogo size={48} /><h1>Hara Workspace Lab</h1><p>{error || "正在連接這次獨立的本機空間…"}</p>{error ? <button onClick={() => setReconnect(value => value + 1)}>重新連接</button> : null}<small>獨立本機驗收 · 不讀寫日常 Hara 資料或歷史</small></div>;
  return <WorkspaceScreen model={model} disconnected={error} root={root} onReconnect={() => setReconnect(value => value + 1)} />;
}
