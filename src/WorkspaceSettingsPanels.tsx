import { useEffect, useRef, useState } from "react";
import { WorkspaceConnectionForm } from "./WorkspaceRuntimeSettings";
import type { LegacyConnectionPreview, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceFeatureView, WorkspaceModelConnection, WorkspacePreferenceView } from "./workspace-dev-state";
import { bindThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from "./theme";
import { makeT, type Locale } from "./i18n";

export function useStableWorkspaceTheme(model: WorkspaceDevModel) {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference);
  const [settings, setSettings] = useState<WorkspacePreferenceView | null>(null), [notice, setNotice] = useState("");
  const busy = useRef(false);
  useEffect(() => { let active = true; void model.preferences().then(value => { if (active) { setSettings(value); setPreference(value.theme); saveThemePreference(value.theme); } })
    .catch(() => { if (active) setNotice("穩定主題偏好尚未讀取，暫用本機快取／系統外觀。"); }); return () => { active = false; }; }, [model]);
  useEffect(() => bindThemePreference(preference), [preference]);
  const change = async (value: ThemePreference) => {
    if (!settings || settings.readOnly || busy.current) return; busy.current = true;
    try { const current = await model.preferences(); const saved = await model.savePreference(value, current.revision); setSettings(saved); setPreference(saved.theme); saveThemePreference(saved.theme); setNotice(""); }
    catch { setNotice("主題保存未確認，請重新打開設定核對；不會自動重送。"); }
    finally { busy.current = false; }
  };
  const changeDetails = async (executionDetails: "brief" | "detailed", collapseDetails: boolean) => {
    if (!settings || settings.readOnly || busy.current) return; busy.current = true;
    try { const saved = await model.saveDisplayPreference(executionDetails, collapseDetails); setSettings(saved); setNotice(""); }
    catch { setNotice("顯示偏好保存未確認，請重新打開設定核對。"); } finally { busy.current = false; }
  };
  return { preference, settings, notice, change, changeDetails };
}
export function WorkspaceThemeSettings({ theme, locale }: { theme: ReturnType<typeof useStableWorkspaceTheme>; locale?: Locale }) {
  if (locale) {
    const t = makeT(locale);
    return <section aria-label={t("ws.settings.appearance")}><label>{t("ws.theme.title")}<select aria-label={t("ws.theme.title")} value={theme.preference} disabled={!theme.settings || theme.settings.readOnly}
      onChange={event => void theme.change(event.target.value as ThemePreference)}><option value="system">{t("ws.theme.system")}</option><option value="light">{t("ws.theme.light")}</option><option value="dark">{t("ws.theme.dark")}</option></select></label>
      <small>{t("ws.theme.note")}</small>
      <label>{t("ws.display.mode")}<select aria-label={t("ws.display.mode")} value={theme.settings?.executionDetails ?? "brief"} disabled={!theme.settings || theme.settings.readOnly}
        onChange={event => void theme.changeDetails(event.target.value as "brief" | "detailed", theme.settings?.collapseDetails !== false)}><option value="brief">{t("ws.display.brief")}</option><option value="detailed">{t("ws.display.detailed")}</option></select></label>
      <div className="wss-setting-row"><span>{t("ws.display.collapse")}</span><button role="switch" aria-label={t("ws.display.collapse")} aria-checked={theme.settings?.collapseDetails !== false} className="wss-switch" disabled={!theme.settings || theme.settings.readOnly}
        onClick={() => void theme.changeDetails(theme.settings?.executionDetails ?? "brief", theme.settings?.collapseDetails === false)}><span /></button></div>{theme.notice ? <p role="status">{t("ws.theme.unavailable")}</p> : null}</section>;
  }
  return <section aria-label="外觀設定"><h3>外觀</h3><label>主題<select aria-label="主題" value={theme.preference} disabled={!theme.settings || theme.settings.readOnly}
    onChange={event => void theme.change(event.target.value as ThemePreference)}><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select></label>
    <small>偏好保存在固定本機儲存，不隨 app 版本或 bundle id 改變。</small>
    <div className="wss-setting-row"><div><strong>对话里的执行信息</strong><p>只改变呈现方式，不改变权限或执行过程。</p></div><select aria-label="执行信息显示方式" value={theme.settings?.executionDetails ?? "brief"} disabled={!theme.settings || theme.settings.readOnly}
      onChange={event => void theme.changeDetails(event.target.value as "brief" | "detailed", theme.settings?.collapseDetails !== false)}><option value="brief">简洁</option><option value="detailed">详细</option></select></div>
    <div className="wss-setting-row"><strong>默认折叠执行详情</strong><button role="switch" aria-label="默认折叠执行详情" aria-checked={theme.settings?.collapseDetails !== false} className="wss-switch" disabled={!theme.settings || theme.settings.readOnly}
      onClick={() => void theme.changeDetails(theme.settings?.executionDetails ?? "brief", theme.settings?.collapseDetails === false)}><span /></button></div>
    {theme.notice ? <p role="status">{theme.notice}</p> : null}</section>;
}
export function WorkspaceConnections({ model, workspace, onDirty }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; onDirty?: (value: boolean) => void }) {
  const [editing, setEditing] = useState<WorkspaceModelConnection | null>(null), [adding, setAdding] = useState(false);
  const [legacy, setLegacy] = useState<LegacyConnectionPreview[]>([]), [confirmImport, setConfirmImport] = useState<LegacyConnectionPreview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkspaceModelConnection | null>(null), [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false), fence = useRef(false);
  const migrationPending = workspace.connections.migrationPending === true, unavailable = workspace.connections.unavailable === true;
  const readOnly = workspace.connections.readOnly === true || migrationPending || unavailable;
  useEffect(() => { onDirty?.(Boolean(editing || adding)); return () => onDirty?.(false); }, [editing, adding, onDirty]);
  useEffect(() => { let active = true; void model.legacyConnections().then(rows => { if (active) setLegacy(rows); }).catch(() => { if (active) setNotice("舊連接預覽不可用；原資料未改動。"); });
    return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const perform = async (action: () => Promise<void>) => { if (fence.current) return; fence.current = true; setPending(true); setNotice("");
    try { await action(); setConfirmDelete(null); setConfirmImport(null); }
    catch { setNotice("結果尚未確認，請刷新核對；沒有自動重送或記錄密鑰。"); }
    finally { fence.current = false; setPending(false); } };
  return <section aria-label="本空間模型連接"><h3>模型連接</h3>
    {readOnly ? <p role="alert">{migrationPending ? "連接升級待完成：請確認後將舊連接存入本空間鑰匙串。原設定已保留；你仍可查看歷史與使用空間其他功能。"
      : unavailable ? "連接設定暫不可用，原檔與備份已保留。空間歷史和其他設定仍可用，沒有改接其他連接。" : workspace.connections.recovered ? "設定為唯讀，原檔缺失或無法讀取，目前顯示備份。請保留原檔與備份，聯絡維護者核對後恢復；此處不會覆寫唯一的好備份。" : "設定為唯讀（較新版本），原檔已保留；請使用相容版本開啟。"}</p> : null}
    {migrationPending && !workspace.connections.recovered ? <button disabled={pending} onClick={() => void perform(async () => {
      await model.workspaceRequest("workspace.connection.migration.retry", { expectedRevision: workspace.connections.revision, approved: true }); await model.refresh();
    })}>{workspace.connections.connections.some(row => row.keySaved === false) ? `确认将 ${workspace.connections.connections.filter(row => !row.credentialRequired).length} 条连接存入「${workspace.label}」钥匙串` : "我已確認系統憑據存儲，重試升級"}</button> : null}
    {workspace.connections.connections.filter(row => row.status === "active").map(connection => <div className="wsd-connection" key={connection.id}>
      <strong>{connection.label}{connection.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId) ? <span className="wsd-pill">{migrationPending || connection.credentialRequired ? "原默认 · 待授权" : "目前連接"}</span> : null}</strong>
      <small>{connection.provider === "anthropic" ? "Anthropic 相容" : "OpenAI 相容"} · {connection.defaultModel}</small><code className="wsd-root">{connection.baseURL}</code><small>Key •••••••••••• · {connection.keyState === "invalid" ? "Key 已失效，请更新" : connection.credentialRequired ? "待授权（请编辑添加 Key）" : connection.keySaved === false || migrationPending ? "待授权" : "已存入钥匙串"}</small>
      <div className="wsd-card-actions"><button disabled={pending || readOnly || connection.id === workspace.connections.defaultConnectionId} onClick={() => void perform(() => model.changeConnection(connection.id))}>設為目前連接</button>
        <button disabled={pending || readOnly} onClick={() => { setEditing(connection); setAdding(false); }}>編輯</button><button disabled={pending || readOnly} onClick={() => setConfirmDelete(connection)}>刪除</button></div>
    </div>)}
    {workspace.connections.connections.filter(row => row.cleanupPending).map(connection => <div className="wsd-connection" key={`cleanup-${connection.id}`}><strong>{connection.label} · 舊憑據待清理</strong><p>舊綁定已失效；系統未確認清理。只有按下此按鈕才會重試，不會重新執行任務。</p>
      <button disabled={pending || readOnly} onClick={() => void perform(async () => { await model.workspaceRequest("workspace.connection.cleanup", { connectionId: connection.id, expectedRevision: workspace.connections.revision, approved: true }); await model.refresh(); })}>確認重試清理舊 Key</button></div>)}
    <button disabled={pending || readOnly} onClick={() => { setAdding(current => !current); setEditing(null); }}>新增連接</button>
    {!readOnly && (adding || editing || workspace.connections.connections.length === 0) ? <WorkspaceConnectionForm key={editing?.id ?? "new"} model={model} existing={editing ?? undefined} onDirty={onDirty} onCancel={() => { setEditing(null); setAdding(false); }} onSaved={() => { setEditing(null); setAdding(false); }} /> : null}
    {legacy.length ? <details className="wsd-legacy-import"><summary>發現舊連接，確認後匯入</summary><p>只複製你選擇的一條到本空間；不會共享其他空間的可變密鑰。</p>
      {legacy.map(row => <div className="wsd-connection" key={row.id}><strong>{row.label}</strong><small>{row.provider} · {row.defaultModel}</small><code>{row.baseURL}</code><small>Key •••••••••••• · 待授权</small>
        <button disabled={pending || readOnly || !row.keySaved} onClick={() => setConfirmImport(row)}>匯入這條連接</button></div>)}</details> : null}
    {confirmImport ? <section className="wsd-approval" role="dialog" aria-label="確認匯入舊連接"><h3>匯入 {confirmImport.label}？</h3><p>{confirmImport.provider} · {confirmImport.defaultModel}</p><code>{confirmImport.baseURL}</code><p>確認後由本機引擎將舊憑據副本存入本空間鑰匙串，不顯示 Key。</p>
      <button disabled={pending} onClick={() => setConfirmImport(null)}>取消</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.importConnection(confirmImport.id))}>確認匯入到本空間</button></section> : null}
    {confirmDelete ? <section className="wsd-approval" role="dialog" aria-label="確認刪除連接"><h3>刪除 {confirmDelete.label}？</h3><p>會撤銷原任務綁定並移除對應 Keychain 項目。刪除目前連接時，改用本空間最早建立的其餘連接；沒有則清空，不跨空間回退。</p>
      <button disabled={pending} onClick={() => setConfirmDelete(null)}>取消</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.changeConnection(confirmDelete.id, true))}>確認刪除連接與 Key</button></section> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
export function WorkspaceFeaturePanel({ model, workspace, kind, onClose, onDirty, onCreateSkill }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; kind: "schedules" | "skills"; onClose?: () => void; onDirty?: (value: boolean) => void; onCreateSkill?: () => void }) {
  const [value, setValue] = useState<WorkspaceFeatureView | null>(null), [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<{ id: string; content: string } | null>(null), [upgrade, setUpgrade] = useState<WorkspaceFeatureView["skills"][number] | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<{ id: string; name: string; expr: string; task: string; agentId: string; enabled: boolean } | null>(null);
  const busy = useRef(false);
  useEffect(() => { onDirty?.(Boolean(editor || scheduleDraft)); return () => onDirty?.(false); }, [editor, scheduleDraft, onDirty]);
  useEffect(() => { let active = true; void model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list").then(rows => { if (active) setValue(rows); })
    .catch(() => { if (active) setNotice("暫時無法讀取本空間資料；沒有回退到全局舊入口。"); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const runningSchedule = Boolean(value?.scheduler?.schedules.some(row => row.lastRun?.state === "running"));
  useEffect(() => { if (!runningSchedule) return; let active = true; const timer = setInterval(() => {
    void model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list").then(rows => { if (active) setValue(rows); }).catch(() => { if (active) setNotice("正在核对原任务状态；不会重新运行。"); });
  }, 1500); return () => { active = false; clearInterval(timer); }; }, [model, runningSchedule, workspace.workspaceId, workspace.resourceGeneration]);
  const update = async (id: string, enabled: boolean, version?: string) => { if (!value || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.features.update", { kind: kind === "skills" ? "skill" : "schedule", id, enabled, expectedRevision: value.revision, ...(version ? { version } : {}) })); setUpgrade(null); }
    catch { setNotice("設定未確認，請重新打開核對；不會自動重送。"); } finally { busy.current = false; setPending(false); } };
  const editSkill = async (id: string) => { if (busy.current) return; busy.current = true; setPending(true);
    try { const row = await model.workspaceRequest<{ id: string; content: string }>("workspace.skill.read", { id }); setEditor({ id: row.id, content: row.content }); }
    catch { setNotice("未能讀取已鎖定版本，沒有修改技能。"); } finally { busy.current = false; setPending(false); } };
  const saveSkill = async () => { if (!value || !editor || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.skill.fork", { id: editor.id, content: editor.content, expectedRevision: value.revision, approved: true })); setEditor(null); }
    catch { setNotice("私人副本未確認，請重新打開核對；全局技能未修改。"); } finally { busy.current = false; setPending(false); } };
  const scheduleAction = async (method: string, extra: Record<string, unknown>) => { if (!value || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>(method, { ...extra, ...(method.endsWith(".run") ? {} : { expectedRevision: value.revision }), approved: true })); setScheduleDraft(null); }
    catch { setNotice("操作结果尚未确认，请重新打开核对；没有自动重送。"); } finally { busy.current = false; setPending(false); } };
  return <section className="wsd-feature-panel" aria-label={kind === "skills" ? "本空間技能" : "本空間定時任務"}>{onClose ? <button onClick={onClose}>返回聊天</button> : null}
    <h2>{kind === "skills" ? "技能" : "定時任務"}</h2><p>{workspace.label} · 只顯示目前工作空間</p>
    {!value ? <p role="status">{notice || "正在讀取…"}</p> : kind === "skills" ? <>
      {onCreateSkill ? <button onClick={onCreateSkill}>与 Hara 创建技能</button> : null}
      <p>全局庫只提供技能版本；啟用後鎖定副本到本空間。Pi 只讀本空間已啟用版本，不會因此取得額外工具或密鑰。</p>
      {!value.skills.length ? <p>技能庫目前沒有可用的文本技能。可把已審閱的 SKILL.md 與文本資源放入全局 ~/.hara/skills 或本空間項目的 .hara/skills，再重新打開此頁；不會自動下載。</p> : value.skills.map(row => <div className="wsd-connection" key={row.id}><strong>{row.id}</strong><p>{row.description}</p>
        <small>{row.source === "private" ? "本空間私人副本" : "全局庫版本"} · {row.version.slice(0, 12)} · {row.locked ? "已鎖定" : "尚未啟用"}</small>
        <label><input type="checkbox" role="switch" disabled={pending} checked={row.enabled} onChange={event => void update(row.id, event.target.checked, row.version)} />本空間允許使用</label>
        {row.locked ? <button disabled={pending} onClick={() => void editSkill(row.id)}>編輯本空間副本</button> : null}
        {row.locked && row.source === "global" && row.availableVersion !== row.version ? <button disabled={pending} onClick={() => setUpgrade(row)}>檢視新版本</button> : null}</div>)}
      {upgrade ? <section className="wsd-approval" role="dialog" aria-label="確認更新技能版本"><h3>更新 {upgrade.id} 的空間鎖定版本？</h3><p>{upgrade.version.slice(0, 12)} → {upgrade.availableVersion.slice(0, 12)}。只影響本空間，不自動重跑任務。</p>
        <button disabled={pending} onClick={() => setUpgrade(null)}>取消</button><button disabled={pending} onClick={() => void update(upgrade.id, upgrade.enabled, upgrade.availableVersion)}>確認更新版本</button></section> : null}
      {editor ? <section className="wsd-approval" role="dialog" aria-label="編輯空間私人技能"><h3>{editor.id} · 私人副本</h3><p>保存後只改本空間，原全局版本與其他空間不受影響。</p>
        <textarea aria-label="技能指令" value={editor.content} maxLength={64000} onChange={event => setEditor(current => current ? { ...current, content: event.target.value } : null)} />
        <button disabled={pending} onClick={() => setEditor(null)}>取消</button><button disabled={pending} onClick={() => void saveSkill()}>確認保存私人副本</button></section> : null}</> : <>
      <p className="wss-callout">旧版定时任务尚未接管：仍由原调度器管理。迁移、备份核对和停用旧调度须另行确认，此页不会执行真实迁移。</p>
      <button disabled={pending} onClick={() => setScheduleDraft({ id: crypto.randomUUID(), name: "", expr: "0 8 * * *", task: "", agentId: workspace.agents.find(row => row.kind === "main")?.agentId ?? "", enabled: true })}>新建定时任务</button>
      {!value.schedules.length ? <p>本空间还没有定时任务。可以新建，或与 Hara 讨论要做的事。</p> : value.schedules.map(row => { const status = value.scheduler?.schedules.find(item => item.id === row.id); return <div className="wsd-connection" key={row.id}><strong>{row.name}</strong><code>{row.schedule.expr ?? row.schedule.display}</code>
        <small>{status?.awaitingHandoff ? "等待旧调度接管确认" : status?.lastRun ? `上次：${status.lastRun.state}${status.lastRun.reason ? ` · ${status.lastRun.reason}` : ""}` : "尚未运行"}</small>
        <small>下次：{status?.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : "—"}</small>
        <label><input type="checkbox" role="switch" checked={row.enabled} disabled={pending} onChange={event => void update(row.id, event.target.checked)} />已啟用</label>
        <div className="wsd-card-actions"><button disabled={pending || status?.awaitingHandoff} onClick={() => { if (window.confirm(`现在在「${workspace.label}」运行「${row.name}」？这可能使用模型额度。`)) void scheduleAction("workspace.schedule.run", { id: row.id }); }}>立即运行</button>
          <button disabled={pending} onClick={() => { if (window.confirm(`删除「${workspace.label}」中的「${row.name}」？运行记录会保留。`)) void scheduleAction("workspace.schedule.delete", { id: row.id }); }}>删除</button></div>
        {status?.lastRun ? <details><summary>运行记录</summary><p>{new Date(status.lastRun.occurredAt).toLocaleString()} · {status.lastRun.state}</p></details> : null}</div>; })}
      {scheduleDraft ? <form className="wsd-connection-form wsd-approval" onSubmit={event => { event.preventDefault(); void scheduleAction("workspace.schedule.save", { input: { id: scheduleDraft.id, name: scheduleDraft.name, task: scheduleDraft.task, agentId: scheduleDraft.agentId, enabled: scheduleDraft.enabled, schedule: { kind: "cron", expr: scheduleDraft.expr } } }); }}>
        <h3>在「{workspace.label}」新建定时任务</h3><label>名称<input required maxLength={256} value={scheduleDraft.name} onChange={event => setScheduleDraft({ ...scheduleDraft, name: event.target.value })} /></label>
        <label>时间（Cron）<input required value={scheduleDraft.expr} onChange={event => setScheduleDraft({ ...scheduleDraft, expr: event.target.value })} /></label>
        <label>交给<select value={scheduleDraft.agentId} onChange={event => setScheduleDraft({ ...scheduleDraft, agentId: event.target.value })}>{workspace.agents.filter(row => row.state === "active").map(row => <option key={row.agentId} value={row.agentId}>{row.identity.displayName}</option>)}</select></label>
        <label>要做的事<textarea required maxLength={8000} value={scheduleDraft.task} onChange={event => setScheduleDraft({ ...scheduleDraft, task: event.target.value })} /></label>
        <p>结果保存在本空间对话中；启用后到时会执行，可能使用模型额度。</p><div className="wsd-card-actions"><button type="button" onClick={() => setScheduleDraft(null)}>取消</button><button className="wsd-primary" disabled={pending}>确认创建并启用</button></div></form> : null}</>}
    {notice && value ? <p role="status">{notice}</p> : null}</section>;
}
