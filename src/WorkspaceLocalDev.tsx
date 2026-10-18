import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import HaraLogo from "./mark";
import { WorkspaceDevConnectionClient, type WorkspaceDevConnection } from "./workspace-dev-rpc";
import { WorkspaceDevModel, type WorkspaceDevMessage, type WorkspaceDevAgent, type WorkspaceDevApproval } from "./workspace-dev-state";
import "./workspace-local-dev.css";
import { useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import WorkspaceSettings, { type SettingsPage } from "./WorkspaceSettings";
import { WorkspaceUpdateNotice, useWorkspaceUpdater } from "./WorkspaceSoftwareUpdate";
import { hasUpdateAttention } from "./workspace-updater-state";
import "./workspace-theme.css";
const BrowserExtension = lazy(() => import("./WorkspaceBrowserExtension"));

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
function Transcript({ history, agent, detailed = false, collapse = true, onSchedules }: { history: WorkspaceDevMessage[]; agent?: WorkspaceDevAgent; detailed?: boolean; collapse?: boolean; onSchedules?: () => void }) {
  return <>{history.map((message, index) => {
    if (message.role === "tool") return null;
    if (message.role === "user") return <div className="wsd-message is-user" key={`user-${index}`}><div className="wsd-bubble">{message.content}</div></div>;
    const next = history[index + 1], results = next?.role === "tool" ? next.results : [];
    return <div className="wsd-message is-agent" key={`assistant-${index}`}>
      {message.text.trim() ? <><div className="wsd-message-author"><Avatar agent={agent} /><span>{agent?.identity.displayName ?? "Hara"}</span></div><div className="wsd-bubble">{message.text}</div></> : null}
      {message.tools.some(name => /schedule|cron/.test(name)) && onSchedules ? <button onClick={onSchedules}>在 设置 › 定时任务 管理</button> : null}
      {message.tools.length ? <details className="wsd-execution" open={detailed && !collapse}><summary>{message.tools.length} 個操作 <span>查看執行詳情</span></summary>
        <div className="wsd-execution-body">{results.map(result => <div key={result.id}><strong>{TOOL_LABELS[result.name] ?? result.name}</strong>
          <pre className={result.isError ? "is-error" : ""}>{result.content.slice(0, 5000)}</pre></div>)}</div></details> : null}
    </div>;
  })}</>;
}
export function WorkspaceScreen({ model, disconnected, onReconnect, root, mode }: { model: WorkspaceDevModel; disconnected: string; onReconnect: () => void; root: string; mode: "workspace" | "lab" }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [settings, setSettings] = useState<SettingsPage | null>(null), [creating, setCreating] = useState(false), [name, setName] = useState("我的工作空間");
  const [section, setSection] = useState<"chat" | "colleagues" | "tasks">("chat"), [browser, setBrowser] = useState(false);
  const theme = useStableWorkspaceTheme(model);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const workspace = view.workspace, agents = workspace?.agents ?? view.roster, agent = agents.find(row => row.agentId === view.agentId);
  const busy = workspace ? ["running", "draining"].includes(workspace.conversation.state) : false;
  const hasConnection = Boolean(workspace?.connections.defaultConnectionId);
  const realKey = view.directory?.executionMode === "ark-real-key";
  const production = view.directory?.executionMode === "workspace";
  const updates = useWorkspaceUpdater(model, production), updateView = useSyncExternalStore(updates.controller.subscribe, updates.controller.getSnapshot, updates.controller.getSnapshot);
  const connect = () => production ? setSettings("connections") : realKey ? model.addApprovedConnection() : model.addSynthetic();
  const canSend = Boolean(workspace && hasConnection && view.draft.trim() && !view.sending && !busy && !view.pendingUnknown && !disconnected);
  useEffect(() => { if (nearBottom.current) end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [workspace?.conversation.history.length, workspace?.approvals.length, busy]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [model, busy]);
  useEffect(() => { if (workspace?.selectedAgentId) input.current?.focus(); }, [workspace?.selectedAgentId]);
  useEffect(() => { setBrowser(false); }, [workspace?.workspaceId, workspace?.resourceGeneration]);
  useEffect(() => { const open = (event: KeyboardEvent) => { if (event.metaKey && event.key === "," && settings === null) { event.preventDefault(); setSettings("overview"); } };
    window.addEventListener("keydown", open); return () => window.removeEventListener("keydown", open); }, [settings]);
  const create = async () => { await model.createWorkspace(name); setCreating(false); };
  const draftToHara = async (text: string, workspaceId = view.workspaceId) => {
    if (workspaceId && model.getSnapshot().workspaceId !== workspaceId) await model.selectWorkspace(workspaceId);
    if (model.getSnapshot().workspaceId !== workspaceId) return;
    const main = model.getSnapshot().workspace?.agents.find(row => row.kind === "main");
    if (main && model.getSnapshot().agentId !== main.agentId) await model.selectAgent(main.agentId);
    setSettings(null); setSection("chat"); model.setDraft(text);
  };
  if (settings !== null) return <WorkspaceSettings mainModel={model} initialPage={settings} root={root} production={production} theme={theme} updater={updates.controller} versionInfo={updates.info}
    onClose={() => setSettings(null)} onCreateSkill={id => void draftToHara("请和我一起设计这个工作空间的技能。先讨论目标和边界，预览 SKILL.md，等我确认后再保存；不增加工具、权限或密钥。", id)} />;
  return <div className={`wsd-app ${browser ? "has-browser" : ""}`}>
    <aside className="wsd-sidebar">
      <div className="wsd-brand"><HaraLogo size={29} /><span>Hara</span>{mode === "lab" ? <small>WORKSPACE LAB</small> : null}</div>
      <label className="wsd-space-label">目前空間</label>
      <div className="wsd-space-switch"><select aria-label="切換 Workspace" value={view.workspaceId ?? ""} disabled={view.loading || !view.directory?.workspaces.length}
        onChange={event => { setSection("chat"); setBrowser(false); void model.selectWorkspace(event.target.value); }}>
        <option value="" disabled>選擇工作空間</option>{view.directory?.workspaces.map(row => <option value={row.workspaceId} key={row.workspaceId} disabled={!row.active}>{row.label}</option>)}
      </select><button aria-label="建立新 Workspace" title="建立新 Workspace" onClick={() => setCreating(true)}>＋</button></div>
      {view.workspaceId && agents.length ? <>
        {agents.filter(row => row.kind === "main").map(row => <button key={row.agentId} disabled={view.loading} aria-current={section === "chat" && row.agentId === view.agentId ? "page" : undefined} className={`wsd-contact is-main ${row.agentId === view.agentId && section === "chat" ? "is-selected" : ""}`}
          onClick={() => { setSection("chat"); if (row.agentId !== view.agentId) void model.selectAgent(row.agentId); }}><Avatar agent={row} large />
          <span><strong>{row.identity.displayName}<small>主 Hara</small></strong><em>你的總調度，也是聊天的起點</em></span><span className="wsd-online" /></button>)}
        <nav className="wsd-primary-nav" aria-label="工作空间主导航"><button aria-current={section === "colleagues" ? "page" : undefined} onClick={() => setSection("colleagues")}>同事 <small>{agents.filter(row => row.kind === "colleague" && row.state !== "archived").length}</small></button>
          <button aria-current={section === "tasks" ? "page" : undefined} onClick={() => setSection("tasks")}>任务与工单</button></nav>
        <div className="wsd-section-label">私信</div>
        <div className="wsd-colleagues">{agents.filter(row => row.kind === "colleague" && row.state !== "archived").slice(-3).map(row => <button disabled={view.loading} className={`wsd-contact ${row.agentId === view.agentId && section === "chat" ? "is-selected" : ""}`} key={row.agentId}
          onClick={() => { setSection("chat"); if (row.agentId !== view.agentId) void model.selectAgent(row.agentId); }}><Avatar agent={row} /><span><strong>{row.identity.displayName}</strong><em>{row.identity.title ?? "同事"} · {row.runtime.id === "pi" ? "Pi" : row.runtime.label}</em></span></button>)}
          {!agents.some(row => row.kind === "colleague") ? <p className="wsd-sidebar-note">跟 Hara 聊聊你需要誰，<br />它會提議合適的同事。</p> : null}</div>
        <div className="wsd-quota"><span>本空间 · {agents.filter(row => row.kind === "colleague" && row.state !== "archived").length} 位同事</span><div><i style={{ width: `${Math.min(100, agents.filter(row => row.kind === "colleague" && row.state !== "archived").length * 10)}%` }} /></div><small>主 Hara 与已归档同事不计入</small></div>
      </> : <p className="wsd-sidebar-note">每個空間都有自己的<br />Hara、同事、連接與記憶。</p>}
      <div className="wsd-sidebar-footer"><span className="wsd-test-mode"><i />你</span><button className="wsd-settings-entry" onClick={() => setSettings("overview")} aria-label={hasUpdateAttention(updateView) ? "设置（有新版本）" : "设置"}>⚙ 设置{hasUpdateAttention(updateView) ? <i className="wss-update-dot" /> : null}</button></div>
    </aside>
    <main className="wsd-chat">
      <header className="wsd-header"><div className="wsd-header-person"><Avatar agent={agent} /><div><strong>{section === "colleagues" ? "同事" : section === "tasks" ? "任务与工单" : agent?.identity.displayName ?? "歡迎來到 Hara"}</strong><small>{agent ? `${agent.kind === "main" ? "主 Hara" : agent.identity.title ?? "同事"} · Pi 內建 Runtime` : "從一個屬於你的空間開始"}</small></div></div>
        <button onClick={() => setBrowser(value => !value)} disabled={!workspace} aria-expanded={browser}>浏览器扩展 <span>↗</span></button></header>
      {disconnected ? <div className="wsd-notice" role="alert">連接中斷；歷史與產物仍在本機，不會自動重跑。<button onClick={onReconnect}>重新連接</button></div> : null}
      {view.error ? <div className="wsd-notice is-error" role="alert">{view.error}</div> : null}
      {view.syncNotice ? <div className="wsd-notice" role="status">{view.syncNotice}</div> : null}
      <div className="wsd-scroll" onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 180; }}>
        {section === "colleagues" && workspace ? <section className="wsd-directory"><header><h2>一起工作的人</h2><button className="wsd-primary" onClick={() => void draftToHara("我想建立一位同事，请先和我讨论职责与边界，再用确认卡片创建。")}>＋ 与 Hara 讨论新同事</button></header>
          {agents.filter(row => row.kind === "colleague" && row.state !== "archived").map(row => <button className="wsd-contact" key={row.agentId} onClick={() => { setSection("chat"); void model.selectAgent(row.agentId); }}><Avatar agent={row} /><span><strong>{row.identity.displayName}</strong><em>{row.identity.title ?? "同事"} · {row.runtime.label}</em></span><span>打开对话 →</span></button>)}
          {!agents.some(row => row.kind === "colleague") ? <p>告诉 Hara 你需要谁，它会提议合适的同事。确认之前不会创建或授予权限。</p> : null}</section> : section === "tasks" && workspace ? <WorkspaceTasks model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} />
        : !workspace && view.loading && view.workspaceId ? <div className="wsd-sidebar-note">正在打開對話…</div> : !workspace ? <section className="wsd-welcome"><div className="wsd-welcome-mark"><HaraLogo size={57} /></div><p className="wsd-kicker">YOUR PEOPLE. YOUR SPACE.</p>
          <h1>一個空間，<br />從你和 Hara 開始。</h1><p>聊天、找同事、一起完成事情。<br />連接、任務與歷史都留在各自的 Workspace。</p>
          <button className="wsd-primary" onClick={() => setCreating(true)} disabled={view.loading}>{view.loading ? "正在打開空間…" : "建立個人 Workspace"}</button>
          <small>{production ? "每個工作空間都有獨立的同事、模型連接與工作記錄。原有記憶保留，不會自動匯入。" : <>這是隔離的本機 Dev，不讀寫日常 Hara 資料。{realKey ? "本次使用已批准的火山 Key 文件引用。" : "不連接真實模型。"}</>}</small></section>
          : <div className="wsd-thread">
            {!hasConnection ? <section className="wsd-connect-card"><div className="wsd-kicker">先準備好這個空間</div><h2>跟 Hara 聊天，先接上模型。</h2>
              <p>{production ? "先為這個工作空間添加模型連接。其他空間的密鑰和用量不會自動帶入。" : realKey ? `使用已批准的火山 Coding Plan 連接；Key 只在本機引擎讀取，不會傳到這個介面。整片上限 ${workspace.budget?.maxTokens ?? "待核對"} token／${workspace.budget?.maxRequests ?? "待核對"} 次請求，跨任務及重啟累計。` : "本次只啟用固定合成腳本，驗證 Pi 與任務流程。沒有外部模型請求或額度消耗。"}</p><button className="wsd-primary" onClick={() => void connect()}>{production ? "配置本空間連接" : realKey ? "引用已授權火山 Key" : "啟用本機合成連接"}</button></section> : null}
            {hasConnection && !workspace.conversation.history.length ? <div className="wsd-chat-start"><h2>今天，想一起完成什麼？</h2><p>先打個招呼，或請我「建立同事 Coder」。</p>
              <button onClick={() => model.setDraft("建立一位同事 Coder，負責本空間的文件工作")}>建立一位同事 <span>↗</span></button></div> : null}
            <Transcript history={workspace.conversation.history} agent={agent} detailed={theme.settings?.executionDetails === "detailed"} collapse={theme.settings?.collapseDetails !== false} onSchedules={() => setSettings("schedules")} />
            {workspace.approvals.map(card => <ApprovalCard key={card.id} card={card} model={model} />)}
            {workspace.conversation.completion?.state === "verified" && workspace.conversation.taskState === "completed" ? <p className="wsd-verified">✓ 已核驗結果 <span>任務已閉環，詳情按需展開</span></p> : null}
            {["needs_recovery", "blocked", "cancelled", "interrupted"].includes(workspace.conversation.state) ? <section className="wsd-resume"><strong>{workspace.conversation.state === "cancelled" ? "本次執行已取消" : "上次任務尚未完成"}</strong>
              {workspace.conversation.blockReason ? <p role="alert">{workspace.conversation.blockReason}</p> : null}
              <p>歷史與已產生的文件都保留了。請先檢查結果，再明確繼續原任務；重啟不會自動重跑。</p>
              {workspace.conversation.resumeAdmission?.allowed === false ? <p>原任務的續跑預算不可用，沒有新增模型調用；請先檢查結果與預算。</p> : null}
              <button onClick={() => void model.send(true)} disabled={view.sending || view.pendingUnknown || !hasConnection || workspace.conversation.resumeAdmission?.allowed === false}>繼續原任務</button></section> : null}
            {busy && !workspace.approvals.length ? <div className="wsd-typing"><Avatar agent={agent} /><span>{workspace.conversation.state === "draining" ? "正在取消，等待原操作安全結束" : `${agent?.identity.displayName ?? "Hara"} 正在回覆`}</span><i /><i /><i /></div> : null}
            <div ref={end} /></div>}
      </div>
      {workspace && section === "chat" ? <footer className="wsd-composer-wrap"><div className="wsd-composer"><textarea ref={input} aria-label={`發訊息給 ${agent?.identity.displayName ?? "Hara"}`} value={view.draft}
        placeholder={hasConnection ? `發訊息給 ${agent?.identity.displayName ?? "Hara"}…` : "請先啟用這個空間的連接"} disabled={!hasConnection || Boolean(disconnected)} rows={2}
        onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void model.send(); } }} />
        <div className="wsd-composer-bar"><span>Pi <i /> 本空間預設連接</span>{busy ? <button onClick={() => void model.cancel()} disabled={workspace.conversation.state === "draining"}>停止</button>
          : view.pendingUnknown ? <button onClick={() => void model.verifyPending()}>核對上次送出結果</button> : <button className="wsd-send" onClick={() => void model.send()} disabled={!canSend} aria-label="發送訊息">↑</button>}</div></div>
        <p>{production ? "Pi · 本空間連接 · 任務與歷史保存在本機" : realKey ? "真實模型 · 火山 Coding Plan · 本機隔離驗收" : "合成模式 · 固定場景腳本，不代表真實模型能力"} <span>Enter 發送，Shift + Enter 換行</span></p></footer> : null}
    </main>
    {creating ? <div className="wsd-modal-backdrop"><section className="wsd-modal" role="dialog" aria-modal="true" aria-labelledby="wsd-create-title"><button className="wsd-close" aria-label="關閉建立空間" onClick={() => setCreating(false)}>×</button>
      <p className="wsd-kicker">A FRESH WORKSPACE</p><h2 id="wsd-create-title">給新空間一個名字。</h2><p>會為你準備獨立的主 Hara。連接與同事稍後透過聊天安排。</p><label>空間名稱<input autoFocus aria-label="Workspace 名稱" value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) void create(); }} /></label>
      <button className="wsd-primary" onClick={() => void create()} disabled={view.loading || !name.trim()}>建立 Workspace</button></section></div> : null}
    {browser && workspace ? <Suspense fallback={<aside className="wsd-sidebar-note">正在打开浏览器扩展…</aside>}><BrowserExtension key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} label={workspace.label} onClose={() => setBrowser(false)} /></Suspense> : null}
    <WorkspaceUpdateNotice controller={updates.controller} onView={() => setSettings("updates")} />
  </div>;
}

function WorkspaceTasks({ model, workspaceId, generation }: { model: WorkspaceDevModel; workspaceId: string; generation: string }) {
  const [rows, setRows] = useState<{ taskId: string; objective: string; status: string; colleague: string }[] | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void model.workspaceRequest<{ taskId: string; objective: string; status: string; colleague: string }[]>("workspace.tasks").then(value => { if (active) setRows(value); })
    .catch(() => { if (active) setError("暂时无法读取本空间任务；没有回退到其他空间或旧工单入口。"); }); return () => { active = false; }; }, [model, workspaceId, generation]);
  const labels: Record<string, string> = { completed: "已完成", running: "进行中", blocked: "待处理", paused: "已暂停", cancelled: "已取消" };
  return <section className="wsd-directory"><h2>任务与工单</h2><p>这里是这个空间的工作记录。定时计划在设置中管理。</p>{!rows ? <p role="status">{error || "正在读取…"}</p> : !rows.length ? <p>还没有任务。向 Hara 或一位同事说说你想完成什么。</p>
    : rows.map(row => <article className="wsd-task-row" key={row.taskId}><strong>{row.objective}</strong><p>{row.colleague} · {labels[row.status] ?? row.status}</p></article>)}</section>;
}
export default function WorkspaceLocalDev({ mode = "workspace" }: { mode?: "workspace" | "lab" }) {
  const [model, setModel] = useState<WorkspaceDevModel | null>(null), [error, setError] = useState(""), [root, setRoot] = useState(""), [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    let active = true, client: WorkspaceDevConnectionClient | undefined;
    setError(""); setModel(null);
    void (async () => {
      const info = await invoke<WorkspaceDevConnection>(mode === "lab" ? "workspace_dev_connection" : "workspace_connection"); if (!active) return;
      client = new WorkspaceDevConnectionClient(info, () => { if (active) setError("本機引擎連接已中斷"); });
      await client.initialize(info.token); if (!active) { client.close(); return; }
      const next = new WorkspaceDevModel(client, undefined, info.syntheticOnly, info.executionMode); client.setChangedListener(id => { if (active && next.getSnapshot().workspaceId === id) void next.refresh(); });
      next.setSettingsFactory(async () => {
        let live = true; const settingsClient = new WorkspaceDevConnectionClient(info, () => {});
        try { await settingsClient.initialize(info.token); const settingsModel = new WorkspaceDevModel(settingsClient, undefined, info.syntheticOnly, info.executionMode, true);
          settingsClient.setChangedListener(id => { if (live && settingsModel.getSnapshot().workspaceId === id) void settingsModel.refresh(); });
          return { model: settingsModel, close() { live = false; settingsClient.close(); } };
        } catch { settingsClient.close(); throw new Error("独立设置连接不可用"); }
      });
      setRoot(info.root); setModel(next); await next.loadDirectory();
      const directory = next.getSnapshot().directory;
      if (active && directory?.activeWorkspaceId && directory.workspaces.some(row => row.workspaceId === directory.activeWorkspaceId && row.active)) await next.selectWorkspace(directory.activeWorkspaceId);
    })().catch(() => { if (active) setError(mode === "lab" ? "無法連接這次隔離的 Workspace Dev。請先啟動專用驗收腳本；沒有連接或啟停正式版引擎。" : "尚未連接到本機工作空間引擎。原資料已保留；可重試連接，不會重新發送任務或切換舊連接。"); });
    return () => { active = false; client?.close(); };
  }, [reconnect, mode]);
  if (!model) return <div className="wsd-boot"><HaraLogo size={48} /><h1>{mode === "lab" ? "Hara Workspace Lab" : "Hara"}</h1><p>{error || "正在連接你的工作空間…"}</p>{error ? <button onClick={() => setReconnect(value => value + 1)}>重新連接</button> : null}<small>{mode === "lab" ? "獨立本機驗收 · 不讀寫日常 Hara 資料或歷史" : "原有資料保留，不會自動切換連接或重新發送任務"}</small></div>;
  return <WorkspaceScreen model={model} disconnected={error} root={root} mode={mode} onReconnect={() => setReconnect(value => value + 1)} />;
}
