import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import HaraLogo from "./mark";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import WorkspaceRuntimeSettings from "./WorkspaceRuntimeSettings";
import { WorkspaceConnections, WorkspaceFeaturePanel, WorkspaceThemeSettings, type useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { WorkspaceSoftwareUpdate, type DesktopVersionInfo } from "./WorkspaceSoftwareUpdate";
import { hasUpdateAttention, type WorkspaceUpdater } from "./workspace-updater-state";
import "./workspace-settings.css";

export type SettingsPage = "overview" | "connections" | "runtimes" | "schedules" | "skills" | "members" | "general" | "appearance" | "updates";
const pages: Record<SettingsPage, { name: string; icon: string; detail: string }> = {
  overview: { name: "概览", icon: "⌂", detail: "工作空间各自独立；这台 Mac 的外观与软件更新由所有空间共用。" },
  connections: { name: "连接", icon: "⌁", detail: "这个空间里的 Hara 和同事使用这些连接。切换当前连接只影响之后的新任务。" },
  runtimes: { name: "运行时", icon: "▣", detail: "查看本机已有的运行时，按需批准安装。不会自动下载或授予执行权限。" },
  schedules: { name: "定时任务", icon: "◷", detail: "按时间交给 Hara 或一位同事去做；结果留在这个空间的对话里。" },
  skills: { name: "技能", icon: "✧", detail: "开启后把已审阅版本锁定在本空间，技能库更新不会自动改变它。" },
  members: { name: "成员", icon: "♧", detail: "这个团队空间中的成员与角色。" },
  general: { name: "空间通用", icon: "◇", detail: "空间身份、角色与本机工作资料。" },
  appearance: { name: "外观与语言", icon: "◐", detail: "这台 Mac 的显示偏好，立即生效，不随工作空间切换。" },
  updates: { name: "软件更新", icon: "↻", detail: "检查 Hara 更新，查看版本和下载进度。" },
};
export interface WorkspaceSettingsProps { mainModel: WorkspaceDevModel; initialPage: SettingsPage; root: string; production: boolean;
  theme: ReturnType<typeof useStableWorkspaceTheme>; updater: WorkspaceUpdater; versionInfo: DesktopVersionInfo | null;
  onClose(): void; onCreateSkill(workspaceId: string): void }
export default function WorkspaceSettings(props: WorkspaceSettingsProps) {
  const [session, setSession] = useState<{ model: WorkspaceDevModel; close(): void } | null>(null), [error, setError] = useState("");
  const initialWorkspace = useRef(props.mainModel.getSnapshot().workspaceId);
  useEffect(() => { let active = true, owned: { model: WorkspaceDevModel; close(): void } | undefined;
    void props.mainModel.openSettingsSession().then(async value => { owned = value; if (!active) { value.close(); return; }
      await value.model.loadDirectory(); if (initialWorkspace.current) await value.model.selectWorkspace(initialWorkspace.current);
      if (active) setSession(value); else value.close();
    }).catch(() => { if (active) setError("暂时无法打开独立的设置连接。主对话与任务未改动，请返回后重试。"); });
    return () => { active = false; owned?.close(); };
  }, [props.mainModel]);
  if (!session) return <div className="wsd-app wss-app"><aside className="wss-nav"><button onClick={props.onClose}>← 返回 Hara</button><h1>设置</h1></aside><main className="wss-main"><p role="status">{error || "正在打开设置…"}</p></main></div>;
  return <SettingsContent {...props} model={session.model} />;
}
export function SettingsContent({ model, initialPage, root, production, theme, updater, versionInfo, onClose, onCreateSkill }: WorkspaceSettingsProps & { model: WorkspaceDevModel }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), updates = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  const [page, setPage] = useState<SettingsPage>(initialPage), [scopeOpen, setScopeOpen] = useState(false), [dirty, setDirty] = useState(false);
  const scopeTrigger = useRef<HTMLButtonElement>(null), scopeMenu = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const selected = view.directory?.workspaces.find(row => row.workspaceId === view.workspaceId), workspace = view.workspace;
  const device = page === "appearance" || page === "updates", readonly = selected && !["owner", "admin"].includes(selected.role);
  const canLeave = useCallback(() => !dirty || window.confirm("放弃未保存的修改？"), [dirty]);
  const navigate = (next: SettingsPage) => { if (next !== page && !canLeave()) return; setDirty(false); setPage(next); body.current?.scrollTo(0, 0); };
  const close = () => { if (canLeave()) onClose(); };
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.metaKey && event.key === "," || event.key === "Escape" && !scopeOpen) { event.preventDefault(); close(); }
    if (event.key === "Escape" && scopeOpen) { setScopeOpen(false); scopeTrigger.current?.focus(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [canLeave, scopeOpen]);
  useEffect(() => { if (!scopeOpen) return; scopeMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!scopeMenu.current?.contains(event.target as Node) && !scopeTrigger.current?.contains(event.target as Node)) setScopeOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [scopeOpen]);
  const switchScope = (workspaceId: string) => { if (workspaceId !== view.workspaceId && !canLeave()) return; setDirty(false); setScopeOpen(false); scopeTrigger.current?.focus(); void model.selectWorkspace(workspaceId); };
  const workspacePages: SettingsPage[] = ["connections", "runtimes", "schedules", "skills", ...(selected?.kind === "team" ? ["members" as const] : []), "general"];
  const navItem = (id: SettingsPage) => <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}><span aria-hidden>{pages[id].icon}</span><span>{pages[id].name}</span>{id === "updates" && hasUpdateAttention(updates) ? <i className="wss-update-dot" /> : null}</button>;
  const key = workspace ? `${workspace.workspaceId}:${workspace.resourceGeneration}:${page}` : "loading";
  return <div className="wsd-app wss-app">
    <aside className="wss-nav"><button className="wss-back" onClick={close}>← 返回 Hara</button><h1>设置</h1><nav aria-label="设置导航">
      {navItem("overview")}<div className="wss-nav-group"><strong>工作空间</strong><small>仅当前空间</small></div>
      <div className="wss-scope"><button ref={scopeTrigger} aria-haspopup="menu" aria-expanded={scopeOpen} onClick={() => setScopeOpen(value => !value)} disabled={!view.directory?.workspaces.length}>
        <span className="wss-scope-mark">{selected?.label?.slice(0, 1) ?? "H"}</span><span><strong>{selected?.label ?? "尚未建立空间"}</strong><small>{selected?.kind === "team" ? "团队" : "个人"} · {selected?.role === "owner" ? "你是所有者" : selected?.role === "admin" ? "你是管理员" : "你是成员"}</small></span><span>⌄</span></button>
        {scopeOpen ? <div ref={scopeMenu} role="menu" aria-label="设置哪个工作空间？"><p>切换后主对话的空间不变。</p>{view.directory?.workspaces.filter(row => row.active).map(row => <button key={row.workspaceId} role="menuitemradio" aria-checked={row.workspaceId === view.workspaceId} onClick={() => switchScope(row.workspaceId)}>{row.label}</button>)}</div> : null}</div>
      {workspacePages.map(navItem)}<div className="wss-nav-group"><strong>这台 Mac</strong><small>所有空间</small></div>{navItem("appearance")}{navItem("updates")}
    </nav><footer><HaraLogo size={19} /><span>Hara {versionInfo?.desktop ?? ""}<small>设置保存在这台 Mac。<br />空间资料不跨空间共享。</small></span></footer></aside>
    <main className="wss-main" ref={body}><header className="wss-heading"><div><p>设置 / {device ? "这台 Mac" : `工作空间 / ${workspace?.label ?? "—"}`}</p><h1>{pages[page].name}</h1></div>
      <span className="wss-scope-chip">{device ? "○ 这台 Mac · 所有空间" : "■ 仅本空间"}</span></header><p className="wss-description">{pages[page].detail}</p>
      {view.error ? <p className="wss-callout" role="alert">{view.error}</p> : null}
      {page === "overview" ? <><h3>{workspace?.label ?? "工作空间"}</h3><div className="wss-overview">{workspacePages.filter(id => id !== "members").map(id => <button key={id} onClick={() => navigate(id)}><span className="wss-overview-icon">{pages[id].icon}</span><h2>{pages[id].name}</h2><p>{id === "connections" ? `${workspace?.connections.connections.filter(row => row.status === "active").length ?? 0} 个连接${workspace?.connections.migrationPending ? " · 待授权" : ""}` : id === "runtimes" ? "pi 已内置，其他运行时按需安装" : pages[id].detail}</p><span>管理 {pages[id].name} →</span></button>)}</div>
        <h3>这台 Mac · 所有空间</h3><div className="wss-overview">{(["appearance", "updates"] as const).map(id => <button key={id} onClick={() => navigate(id)}><h2>{pages[id].name}</h2><p>{id === "appearance" ? "跟随系统 / 浅色 / 深色" : ["available", "ready"].includes(updates.phase) ? `Hara ${updates.version} 可用` : "检查更新与版本信息"}</p><span>打开 →</span></button>)}</div></> : null}
      {page === "appearance" ? <div className="wss-page-card"><WorkspaceThemeSettings theme={theme} /></div> : page === "updates" ? <WorkspaceSoftwareUpdate controller={updater} info={versionInfo} />
        : page === "overview" ? null : !workspace ? <p role="status">{view.loading ? "正在读取这个空间…" : "请先在 Hara 建立一个工作空间。"}</p> : <fieldset className="wss-content" key={key} disabled={Boolean(readonly)}>
          {readonly ? <p className="wss-callout">只有所有者和管理员可以修改。这个空间的设置为只读。</p> : null}
          {page === "connections" ? production ? <WorkspaceConnections model={model} workspace={workspace} onDirty={setDirty} /> : <p>隔离合成模式不保存真实模型连接。</p> : null}
          {page === "runtimes" ? production ? <WorkspaceRuntimeSettings model={model} workspace={workspace} /> : <p>pi 已内置；隔离模式不下载运行时。</p> : null}
          {page === "schedules" || page === "skills" ? <WorkspaceFeaturePanel model={model} workspace={workspace} kind={page} onDirty={setDirty} onCreateSkill={() => { if (canLeave()) onCreateSkill(workspace.workspaceId); }} /> : null}
          {page === "general" ? <General workspace={workspace} root={root} role={selected?.role ?? "owner"} /> : null}
          {page === "members" ? <p>成员目录需要连接工作空间服务。本机版不会把模型连接或旧组织当成成员目录。</p> : null}
        </fieldset>}
    </main>
  </div>;
}
function General({ workspace, root, role }: { workspace: WorkspaceDevSnapshot; root: string; role: string }) {
  return <section className="wss-page-card"><h2>{workspace.label}</h2><dl><dt>空间 ID</dt><dd>{workspace.workspaceId}</dd><dt>类型</dt><dd>个人</dd><dt>角色</dt><dd>{role === "owner" ? "所有者" : role}</dd><dt>本机工作资料</dt><dd><code>{root}/project/{workspace.workspaceId}</code></dd><dt>历史任务</dt><dd>{workspace.conversation.pastTaskCount ?? 0}</dd><dt>模型步骤</dt><dd>{workspace.conversation.usage.modelCalls}（不是供应商账单）</dd></dl><p>个人空间不能删除。这里不展示或修改其他空间的数据。</p></section>;
}
