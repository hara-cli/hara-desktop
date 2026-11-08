import { redesignText } from "./desktop-redesign-copy";
import { copyTextToClipboard } from "./clipboard";
import { WorkspaceExtensions } from "./WorkspaceExtensions";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { WorkspaceDevAgent, WorkspaceFeatureView } from "./workspace-dev-state";
import WorkspaceRuntimeAccess from "./WorkspaceRuntimeAccess";
import ColleagueRuntimeForm from "./ColleagueRuntimeForm";
import type { WorkspaceDevSnapshot, WorkspaceRuntimeModels, WorkspaceConnectionModels, WorkspaceSessionRestart, RuntimeLoginSource, RuntimePermissionTier } from "./workspace-dev-state";
import type { AgentRuntimeId } from "./client";
import { WorkspaceAgentProfileSheet } from "./AgentProfileEditor";

type Schedule = WorkspaceFeatureView["schedules"][number];

export default function WorkspaceColleagueInspector({ agent, workspace, features, locale, error, inert, supported, extensionsModel, initialProfileOpen = false, onClose, onRefresh, onToggle, onSave, onDelete, listModels, listConnectionModels, connectionModelSupported, onApplyRuntime, permissionSupported = false, onApplyPermissionTier, onApplyModel, onApplyConnectionModel, onRescan, onRegisterRuntime, onRuntimeDirectory, onConnections, onSaveProfile }: {
  agent: WorkspaceDevAgent;
  workspace: WorkspaceDevSnapshot;
  features: WorkspaceFeatureView | null;
  locale: "en" | "zh-Hans" | "zh-Hant";
  error: string;
  inert: boolean;
  supported: boolean;
  extensionsModel?: WorkspaceDevModel;
  initialProfileOpen?: boolean;
  onClose(): void;
  onRefresh(): void;
  onToggle(schedule: Schedule): Promise<void>;
  onSave(schedule: Schedule, values: { name: string; cron: string; tz: string; task: string }): Promise<void>;
  onDelete(schedule: Schedule): Promise<void>;
  listModels(runtimeId: string): Promise<WorkspaceRuntimeModels>;
  listConnectionModels(agentId: string, connectionId: string): Promise<WorkspaceConnectionModels>;
  connectionModelSupported: boolean;
  permissionSupported?: boolean;
  onApplyPermissionTier?(tier: RuntimePermissionTier): Promise<void>;
  onApplyRuntime(runtimeId: AgentRuntimeId, sessionRestart: WorkspaceSessionRestart): Promise<void>;
  onApplyModel(runtimeId: string, modelId: string, revision: number, effort: string | null): Promise<void>;
  onApplyConnectionModel(connectionId: string, modelId: string, revision: number, effort: string | null): Promise<void>;
  onRescan(): Promise<void>;
  onRegisterRuntime(runtimeId: string, fingerprint: string, loginSource: RuntimeLoginSource): Promise<void>;
  onRuntimeDirectory(): void;
  onConnections?(): void;
  onSaveProfile(profile: { displayName: string; title: string; emoji: string; avatar: string }): Promise<void>;
}) {
  const zh = locale !== "en";
  const c = (hans: string, en: string, hant: string) => locale === "en" ? en : locale === "zh-Hant" ? hant : hans;
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState<"copied" | "copyFailed" | null>(null);
  const schedules = features?.schedules.filter((row) => row.agentId === agent.agentId) ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState({ name: "", cron: "", tz: "", task: "" });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [profileOpen, setProfileOpen] = useState(initialProfileOpen);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setLocalError("");
    try { await action(); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const beginEdit = (schedule: Schedule) => {
    setEditing(schedule.id);
    setValues({ name: schedule.name, cron: schedule.schedule.expr ?? "", tz: schedule.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone, task: schedule.task ?? "" });
    setLocalError("");
  };
  return <aside id="workspace-inspector" className="vg-inspector vg-colleague-manage" aria-label={zh ? `${agent.identity.displayName} · 管理` : `Manage ${agent.identity.displayName}`} inert={inert}>
    <header><h2>{agent.identity.displayName} · {r("manage")}</h2><button className="hs-icon" aria-label={c("关闭管理栏", "Close management", "關閉管理欄")} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <div className="vg-colleague-identity"><strong>{agent.identity.displayName}</strong><span>{agent.kind === "main" ? r("orchestrator") : agent.identity.title || r("colleagues")}</span></div>
    {extensionsModel?.supportsRuntimeForm?.() ? <ColleagueRuntimeForm agent={agent} workspace={workspace} model={extensionsModel} locale={locale} permissionSupported={permissionSupported} onApplyPermissionTier={onApplyPermissionTier} onRuntimeDirectory={onRuntimeDirectory} onConnections={onConnections} />
      : <WorkspaceRuntimeAccess agent={agent} workspace={workspace} locale={locale} listModels={listModels} listConnectionModels={listConnectionModels} connectionModelSupported={connectionModelSupported} onApplyRuntime={onApplyRuntime} permissionSupported={permissionSupported} onApplyPermissionTier={onApplyPermissionTier} onApplyModel={onApplyModel} onApplyConnectionModel={onApplyConnectionModel} onRescan={onRescan} onRegisterRuntime={onRegisterRuntime} onRuntimeDirectory={onRuntimeDirectory} platform={extensionsModel?.runtimePlatform?.()} />}
    <details className="hd-manage-section"><summary>{r("profile")}<small>{agent.kind === "main" ? r("orchestrator") : agent.identity.title}</small></summary><section className="vg-context-card"><h3>{r("profile")}</h3><dl><dt>{c("显示名", "Display name", "顯示名稱")}</dt><dd>{agent.identity.displayName}</dd><dt>{c("职责", "Role", "職責")}</dt><dd>{agent.kind === "main" ? r("orchestrator") : agent.identity.title || "—"}</dd><dt>{c("运行环境", "Runtime", "執行環境")}</dt><dd>{agent.runtime.label}</dd></dl><button onClick={() => setProfileOpen(true)}>{locale === "zh-Hant" ? "編輯同事名片" : zh ? "编辑同事名片" : "Edit colleague profile"}</button></section></details>
    {agent.kind === "colleague" && workspace.selectedAgentId === agent.agentId && workspace.colleagueHome ? <details className="hd-manage-section"><summary>{r("workingFolder")}</summary><section className="vg-context-card">
      <dl><dt>{r("workingFolder")}</dt><dd><code>{workspace.colleagueHome.path}</code></dd><dt>{r("relatedFolder")}</dt><dd><code>{workspace.colleagueHome.legacyPath}</code></dd></dl>
      {!workspace.colleagueHome.created ? <p>{r("folderLazy")}</p> : !workspace.colleagueHome.available ? <p role="alert">{r("folderUnavailable")}</p> : null}
      {workspace.colleagueHome.codexMigrationPending ? <p>{r("codexFolderPending")}</p> : null}<p>{r("privateMemory")}</p>
    </section></details> : null}
    {profileOpen ? <WorkspaceAgentProfileSheet agent={agent} locale={zh ? "zh" : "en"} onClose={() => setProfileOpen(false)} onSave={onSaveProfile} /> : null}
    {agent.kind === "colleague" ? <details className="hd-manage-section"><summary>{r("schedules")}<small>{schedules.length}</small></summary><section className="vg-context-card vg-colleague-schedules"><h3>{r("schedules")}<span>{schedules.length}</span></h3>
      {!supported ? <p className="vg-muted" role="status">{c("更新 Hara 引擎后可管理同事定时。", "Update Hara Core to manage colleague schedules.", "更新 Hara 引擎後可管理同事排程。")}</p>
        : !features ? <p className="vg-muted" role="status">{c("正在读取本同事定时…", "Loading colleague schedules…", "正在讀取同事排程…")}</p>
        : schedules.length === 0 ? <p className="vg-muted">{c(`还没有挂在 ${agent.identity.displayName} 上的定时。在聊天里说“每天 09:00 …”，确认后会出现在这里。`, `No schedules for ${agent.identity.displayName}. Ask in chat for a daily schedule and confirm it there.`, `還沒有 ${agent.identity.displayName} 的排程。在聊天裡說「每天 09:00 …」，確認後會出現在這裡。`)}</p>
          : schedules.map((schedule) => <article key={schedule.id} className="vg-colleague-job">
            <div className="vg-colleague-job-head"><input type="checkbox" aria-label={(c("启用 ", "Enable ", "啟用 ")) + schedule.name} checked={schedule.enabled} disabled={busy} onChange={() => void run(() => onToggle(schedule))} /><strong>{schedule.name}</strong></div>
            <p>{schedule.schedule.expr ?? schedule.schedule.display ?? "—"}{schedule.tz ? ` · ${schedule.tz}` : ""}</p>
            <small>{c("下次", "Next", "下次")} · {features.scheduler?.schedules.find((row) => row.id === schedule.id)?.nextRunAt ? new Date(features.scheduler.schedules.find((row) => row.id === schedule.id)!.nextRunAt!).toLocaleString(locale) : "—"}</small>
            {editing === schedule.id ? <div className="vg-colleague-edit">
              <label>{c("名称", "Name", "名稱")}<input value={values.name} maxLength={60} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
              <label>{c("节奏（Cron）", "Schedule (Cron)", "週期（Cron）")}<input value={values.cron} onChange={(event) => setValues({ ...values, cron: event.target.value })} /></label>
              <label>{c("时区", "Time zone", "時區")}<input value={values.tz} onChange={(event) => setValues({ ...values, tz: event.target.value })} /></label>
              <label>{c("指令", "Instruction", "指令")}<textarea rows={3} value={values.task} onChange={(event) => setValues({ ...values, task: event.target.value })} /></label>
              <div><button disabled={busy || !values.name.trim() || !values.cron.trim() || !values.task.trim()} onClick={() => void run(async () => { await onSave(schedule, values); setEditing(null); })}>{c("保存", "Save", "儲存")}</button><button disabled={busy} onClick={() => setEditing(null)}>{c("取消", "Cancel", "取消")}</button></div>
            </div> : <div className="vg-colleague-actions"><button onClick={() => beginEdit(schedule)} disabled={busy}>{c("编辑", "Edit", "編輯")}</button><button onClick={() => void run(() => onToggle(schedule))} disabled={busy}>{schedule.enabled ? (c("停用", "Pause", "停用")) : (c("启用", "Resume", "啟用"))}</button><button disabled={busy} onClick={() => { if (window.confirm(c(`删除“${schedule.name}”？`, `Delete “${schedule.name}”?`, `刪除「${schedule.name}」？`))) void run(() => onDelete(schedule)); }}>{c("删除", "Delete", "刪除")}</button></div>}
          </article>)}
      <p className="vg-muted">{c("在聊天里创建；这里只管理这位同事的定时。", "Create in chat; manage only this colleague here.", "在聊天裡建立；這裡只管理這位同事的排程。")}</p>
      {error || localError ? <p role="alert" className="vg-colleague-error">{error || localError} <button onClick={onRefresh}>{c("重试", "Retry", "重試")}</button></p> : null}
    </section></details> : null}
    <details className="hd-manage-section" onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>{r("advanced")}</summary><div>{advancedOpen && extensionsModel && agent.agentEpoch ? <WorkspaceExtensions model={extensionsModel} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} agent={{ agentId: agent.agentId, agentEpoch: agent.agentEpoch }} /> : null}<button type="button" className="hs-btn sec" onClick={async () => setCopied(await copyTextToClipboard(workspace.conversation.sessionId) ? "copied" : "copyFailed")}>{copied ? r(copied) : r("copyId")}</button>{copied === "copyFailed" ? <code>{workspace.conversation.sessionId}</code> : null}</div></details>
  </aside>;
}
