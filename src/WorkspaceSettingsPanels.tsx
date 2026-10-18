import { useEffect, useRef, useState } from "react";
import { WorkspaceConnectionForm } from "./WorkspaceRuntimeSettings";
import type { LegacyConnectionPreview, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceFeatureView, WorkspaceModelConnection, WorkspacePreferenceView } from "./workspace-dev-state";
import { bindThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from "./theme";

export function useStableWorkspaceTheme(model: WorkspaceDevModel) {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference);
  const [settings, setSettings] = useState<WorkspacePreferenceView | null>(null), [notice, setNotice] = useState("");
  const busy = useRef(false);
  useEffect(() => { let active = true; void model.preferences().then(value => { if (active) { setSettings(value); setPreference(value.theme); saveThemePreference(value.theme); } })
    .catch(() => { if (active) setNotice("穩定主題偏好尚未讀取，暫用本機快取／系統外觀。"); }); return () => { active = false; }; }, [model]);
  useEffect(() => bindThemePreference(preference), [preference]);
  const change = async (value: ThemePreference) => {
    if (!settings || settings.readOnly || busy.current) return; busy.current = true;
    try { const saved = await model.savePreference(value, settings.revision); setSettings(saved); setPreference(saved.theme); saveThemePreference(saved.theme); setNotice(""); }
    catch { setNotice("主題保存未確認，請重新打開設定核對；不會自動重送。"); }
    finally { busy.current = false; }
  };
  return { preference, settings, notice, change };
}
export function WorkspaceThemeSettings({ theme }: { theme: ReturnType<typeof useStableWorkspaceTheme> }) {
  return <section aria-label="外觀設定"><h3>外觀</h3><label>主題<select aria-label="主題" value={theme.preference} disabled={!theme.settings || theme.settings.readOnly}
    onChange={event => void theme.change(event.target.value as ThemePreference)}><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select></label>
    <small>偏好保存在固定本機儲存，不隨 app 版本或 bundle id 改變。</small>{theme.notice ? <p role="status">{theme.notice}</p> : null}</section>;
}
export function WorkspaceConnections({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const [editing, setEditing] = useState<WorkspaceModelConnection | null>(null), [adding, setAdding] = useState(false);
  const [legacy, setLegacy] = useState<LegacyConnectionPreview[]>([]), [confirmImport, setConfirmImport] = useState<LegacyConnectionPreview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkspaceModelConnection | null>(null), [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false), fence = useRef(false);
  const readOnly = workspace.connections.readOnly === true;
  useEffect(() => { let active = true; void model.legacyConnections().then(rows => { if (active) setLegacy(rows); }).catch(() => { if (active) setNotice("舊連接預覽不可用；原資料未改動。"); });
    return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const perform = async (action: () => Promise<void>) => { if (fence.current) return; fence.current = true; setPending(true); setNotice("");
    try { await action(); setConfirmDelete(null); setConfirmImport(null); }
    catch { setNotice("結果尚未確認，請刷新核對；沒有自動重送或記錄密鑰。"); }
    finally { fence.current = false; setPending(false); } };
  return <section aria-label="本空間模型連接"><h3>模型連接</h3>
    {readOnly ? <p role="alert">設定為唯讀（較新版本或備份恢復），原檔已保留。</p> : null}
    {workspace.connections.connections.filter(row => row.status === "active").map(connection => <div className="wsd-connection" key={connection.id}>
      <strong>{connection.label}{connection.id === workspace.connections.defaultConnectionId ? <span className="wsd-pill">目前連接</span> : null}</strong>
      <small>{connection.provider === "anthropic" ? "Anthropic 相容" : "OpenAI 相容"} · {connection.defaultModel}</small><code className="wsd-root">{connection.baseURL}</code><small>Key：已保存</small>
      <div className="wsd-card-actions"><button disabled={pending || readOnly || connection.id === workspace.connections.defaultConnectionId} onClick={() => void perform(() => model.changeConnection(connection.id))}>設為目前連接</button>
        <button disabled={pending || readOnly} onClick={() => { setEditing(connection); setAdding(false); }}>編輯</button><button disabled={pending || readOnly} onClick={() => setConfirmDelete(connection)}>刪除</button></div>
    </div>)}
    {workspace.connections.connections.filter(row => row.cleanupPending).map(connection => <div className="wsd-connection" key={`cleanup-${connection.id}`}><strong>{connection.label} · 舊憑據待清理</strong><p>舊綁定已失效；系統未確認清理。只有按下此按鈕才會重試，不會重新執行任務。</p>
      <button disabled={pending || readOnly} onClick={() => void perform(async () => { await model.workspaceRequest("workspace.connection.cleanup", { connectionId: connection.id, expectedRevision: workspace.connections.revision, approved: true }); await model.refresh(); })}>確認重試清理舊 Key</button></div>)}
    <button disabled={pending || readOnly} onClick={() => { setAdding(current => !current); setEditing(null); }}>新增連接</button>
    {!readOnly && (adding || editing || workspace.connections.connections.length === 0) ? <WorkspaceConnectionForm key={editing?.id ?? "new"} model={model} existing={editing ?? undefined} onSaved={() => { setEditing(null); setAdding(false); }} /> : null}
    {legacy.length ? <details className="wsd-legacy-import"><summary>發現舊連接，確認後匯入</summary><p>只複製你選擇的一條到本空間；不會共享其他空間的可變密鑰。</p>
      {legacy.map(row => <div className="wsd-connection" key={row.id}><strong>{row.label}</strong><small>{row.provider} · {row.defaultModel}</small><code>{row.baseURL}</code><small>Key：{row.keySaved ? "已保存" : "未保存"}</small>
        <button disabled={pending || readOnly || !row.keySaved} onClick={() => setConfirmImport(row)}>匯入這條連接</button></div>)}</details> : null}
    {confirmImport ? <section className="wsd-approval" role="dialog" aria-label="確認匯入舊連接"><h3>匯入 {confirmImport.label}？</h3><p>{confirmImport.provider} · {confirmImport.defaultModel}</p><code>{confirmImport.baseURL}</code><p>Key：已保存。只由本機引擎在系統鑰匙串內保存副本，不顯示 Key。</p>
      <button disabled={pending} onClick={() => setConfirmImport(null)}>取消</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.importConnection(confirmImport.id))}>確認匯入到本空間</button></section> : null}
    {confirmDelete ? <section className="wsd-approval" role="dialog" aria-label="確認刪除連接"><h3>刪除 {confirmDelete.label}？</h3><p>會撤銷原任務綁定並移除對應 Keychain 項目。刪除目前連接時，改用本空間最早建立的其餘連接；沒有則清空，不跨空間回退。</p>
      <button disabled={pending} onClick={() => setConfirmDelete(null)}>取消</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.changeConnection(confirmDelete.id, true))}>確認刪除連接與 Key</button></section> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
export function WorkspaceFeaturePanel({ model, workspace, kind, onClose }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; kind: "schedules" | "skills"; onClose: () => void }) {
  const [value, setValue] = useState<WorkspaceFeatureView | null>(null), [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<{ id: string; content: string } | null>(null), [upgrade, setUpgrade] = useState<WorkspaceFeatureView["skills"][number] | null>(null);
  const busy = useRef(false);
  useEffect(() => { let active = true; void model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list").then(rows => { if (active) setValue(rows); })
    .catch(() => { if (active) setNotice("暫時無法讀取本空間資料；沒有回退到全局舊入口。"); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const update = async (id: string, enabled: boolean, version?: string) => { if (!value || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.features.update", { kind: kind === "skills" ? "skill" : "schedule", id, enabled, expectedRevision: value.revision, ...(version ? { version } : {}) })); setUpgrade(null); }
    catch { setNotice("設定未確認，請重新打開核對；不會自動重送。"); } finally { busy.current = false; setPending(false); } };
  const editSkill = async (id: string) => { if (busy.current) return; busy.current = true; setPending(true);
    try { const row = await model.workspaceRequest<{ id: string; content: string }>("workspace.skill.read", { id }); setEditor({ id: row.id, content: row.content }); }
    catch { setNotice("未能讀取已鎖定版本，沒有修改技能。"); } finally { busy.current = false; setPending(false); } };
  const saveSkill = async () => { if (!value || !editor || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.skill.fork", { id: editor.id, content: editor.content, expectedRevision: value.revision, approved: true })); setEditor(null); }
    catch { setNotice("私人副本未確認，請重新打開核對；全局技能未修改。"); } finally { busy.current = false; setPending(false); } };
  return <section className="wsd-feature-panel" aria-label={kind === "skills" ? "本空間技能" : "本空間定時任務"}><button onClick={onClose}>返回聊天</button>
    <h2>{kind === "skills" ? "技能" : "定時任務"}</h2><p>{workspace.label} · 只顯示目前工作空間</p>
    {!value ? <p role="status">{notice || "正在讀取…"}</p> : kind === "skills" ? <>
      <p>全局庫只提供技能版本；啟用後鎖定副本到本空間。Pi 只讀本空間已啟用版本，不會因此取得額外工具或密鑰。</p>
      {!value.skills.length ? <p>技能庫目前沒有可用的文本技能。可把已審閱的 SKILL.md 與文本資源放入全局 ~/.hara/skills 或本空間項目的 .hara/skills，再重新打開此頁；不會自動下載。</p> : value.skills.map(row => <div className="wsd-connection" key={row.id}><strong>{row.id}</strong><p>{row.description}</p>
        <small>{row.source === "private" ? "本空間私人副本" : "全局庫版本"} · {row.version.slice(0, 12)} · {row.locked ? "已鎖定" : "尚未啟用"}</small>
        <label><input type="checkbox" disabled={pending} checked={row.enabled} onChange={event => void update(row.id, event.target.checked, row.version)} />本空間允許使用</label>
        {row.locked ? <button disabled={pending} onClick={() => void editSkill(row.id)}>編輯本空間副本</button> : null}
        {row.locked && row.source === "global" && row.availableVersion !== row.version ? <button disabled={pending} onClick={() => setUpgrade(row)}>檢視新版本</button> : null}</div>)}
      {upgrade ? <section className="wsd-approval" role="dialog" aria-label="確認更新技能版本"><h3>更新 {upgrade.id} 的空間鎖定版本？</h3><p>{upgrade.version.slice(0, 12)} → {upgrade.availableVersion.slice(0, 12)}。只影響本空間，不自動重跑任務。</p>
        <button disabled={pending} onClick={() => setUpgrade(null)}>取消</button><button disabled={pending} onClick={() => void update(upgrade.id, upgrade.enabled, upgrade.availableVersion)}>確認更新版本</button></section> : null}
      {editor ? <section className="wsd-approval" role="dialog" aria-label="編輯空間私人技能"><h3>{editor.id} · 私人副本</h3><p>保存後只改本空間，原全局版本與其他空間不受影響。</p>
        <textarea aria-label="技能指令" value={editor.content} maxLength={64000} onChange={event => setEditor(current => current ? { ...current, content: event.target.value } : null)} />
        <button disabled={pending} onClick={() => setEditor(null)}>取消</button><button disabled={pending} onClick={() => void saveSkill()}>確認保存私人副本</button></section> : null}</> : <>
      {!value.schedules.length ? <p>本空間尚無已遷入的定時任務。舊全局任務仍由原調度器管理，未被停用或自動遷移；真實遷移需另行確認。</p> : value.schedules.map(row => <div className="wsd-connection" key={row.id}><strong>{row.name}</strong><code>{row.schedule.expr ?? row.schedule.display}</code>
        <label><input type="checkbox" checked={row.enabled} disabled={pending} onChange={event => void update(row.id, event.target.checked)} />已啟用</label></div>)}
      <small>目前提供空間計畫資料管理；不在此入口啟動第二個調度器或重跑舊任務。</small></>}
    {notice && value ? <p role="status">{notice}</p> : null}</section>;
}
