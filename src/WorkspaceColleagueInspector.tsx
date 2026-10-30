import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { WorkspaceDevAgent, WorkspaceFeatureView } from "./workspace-dev-state";
import WorkspaceRuntimeAccess from "./WorkspaceRuntimeAccess";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";

type Schedule = WorkspaceFeatureView["schedules"][number];

export default function WorkspaceColleagueInspector({ agent, workspace, features, locale, error, inert, supported, onClose, onRefresh, onToggle, onSave, onDelete, onRuntime, onModel }: {
  agent: WorkspaceDevAgent;
  workspace: WorkspaceDevSnapshot;
  features: WorkspaceFeatureView | null;
  locale: "en" | "zh-Hans" | "zh-Hant";
  error: string;
  inert: boolean;
  supported: boolean;
  onClose(): void;
  onRefresh(): void;
  onToggle(schedule: Schedule): Promise<void>;
  onSave(schedule: Schedule, values: { name: string; cron: string; tz: string; task: string }): Promise<void>;
  onDelete(schedule: Schedule): Promise<void>;
  onRuntime(): void;
  onModel(): void;
}) {
  const zh = locale !== "en";
  const schedules = features?.schedules.filter((row) => row.agentId === agent.agentId) ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState({ name: "", cron: "", tz: "", task: "" });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
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
    <header><h2>{agent.kind === "main" ? (zh ? "Hara · 管理" : "Hara management") : (zh ? "该同事 · 内部管理" : "Colleague management")}</h2><button className="hs-icon" aria-label={zh ? "关闭管理栏" : "Close management"} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <div className="vg-colleague-identity"><strong>{agent.identity.displayName}</strong><span>{agent.identity.title || (zh ? "Hara 同事" : "Hara colleague")}</span></div>
    <WorkspaceRuntimeAccess agent={agent} workspace={workspace} locale={locale} onRuntime={onRuntime} onModel={onModel} />
    <section className="vg-context-card"><h3>{zh ? "基本信息" : "Profile"}</h3><dl><dt>{zh ? "显示名" : "Display name"}</dt><dd>{agent.identity.displayName}</dd><dt>{zh ? "职责" : "Role"}</dt><dd>{agent.identity.title || "—"}</dd><dt>{zh ? "运行环境" : "Runtime"}</dt><dd>{agent.runtime.label}</dd></dl></section>
    {agent.kind === "colleague" ? <section className="vg-context-card vg-colleague-schedules"><h3>{zh ? "定时" : "Schedules"}<span>{schedules.length}</span></h3>
      {!supported ? <p className="vg-muted" role="status">{zh ? "更新 Hara 引擎后可管理同事定时。" : "Update Hara Core to manage colleague schedules."}</p>
        : !features ? <p className="vg-muted" role="status">{zh ? "正在读取本同事定时…" : "Loading colleague schedules…"}</p>
        : schedules.length === 0 ? <p className="vg-muted">{zh ? `还没有挂在 ${agent.identity.displayName} 上的定时。在聊天里说“每天 09:00 …”，确认后会出现在这里。` : `No schedules for ${agent.identity.displayName}. Ask in chat for a daily schedule and confirm it there.`}</p>
          : schedules.map((schedule) => <article key={schedule.id} className="vg-colleague-job">
            <div className="vg-colleague-job-head"><input type="checkbox" aria-label={(zh ? "启用 " : "Enable ") + schedule.name} checked={schedule.enabled} disabled={busy} onChange={() => void run(() => onToggle(schedule))} /><strong>{schedule.name}</strong></div>
            <p>{schedule.schedule.expr ?? schedule.schedule.display ?? "—"}{schedule.tz ? ` · ${schedule.tz}` : ""}</p>
            <small>{zh ? "下次" : "Next"} · {features.scheduler?.schedules.find((row) => row.id === schedule.id)?.nextRunAt ? new Date(features.scheduler.schedules.find((row) => row.id === schedule.id)!.nextRunAt!).toLocaleString(locale) : "—"}</small>
            {editing === schedule.id ? <div className="vg-colleague-edit">
              <label>{zh ? "名称" : "Name"}<input value={values.name} maxLength={60} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
              <label>{zh ? "节奏（Cron）" : "Schedule (Cron)"}<input value={values.cron} onChange={(event) => setValues({ ...values, cron: event.target.value })} /></label>
              <label>{zh ? "时区" : "Time zone"}<input value={values.tz} onChange={(event) => setValues({ ...values, tz: event.target.value })} /></label>
              <label>{zh ? "指令" : "Instruction"}<textarea rows={3} value={values.task} onChange={(event) => setValues({ ...values, task: event.target.value })} /></label>
              <div><button disabled={busy || !values.name.trim() || !values.cron.trim() || !values.task.trim()} onClick={() => void run(async () => { await onSave(schedule, values); setEditing(null); })}>{zh ? "保存" : "Save"}</button><button disabled={busy} onClick={() => setEditing(null)}>{zh ? "取消" : "Cancel"}</button></div>
            </div> : <div className="vg-colleague-actions"><button onClick={() => beginEdit(schedule)} disabled={busy}>{zh ? "编辑" : "Edit"}</button><button onClick={() => void run(() => onToggle(schedule))} disabled={busy}>{schedule.enabled ? (zh ? "停用" : "Pause") : (zh ? "启用" : "Resume")}</button><button disabled={busy} onClick={() => { if (window.confirm(zh ? `删除“${schedule.name}”？` : `Delete “${schedule.name}”?`)) void run(() => onDelete(schedule)); }}>{zh ? "删除" : "Delete"}</button></div>}
          </article>)}
      <p className="vg-muted">{zh ? "在聊天里创建；这里只管理这位同事的定时。" : "Create in chat; manage only this colleague here."}</p>
      {error || localError ? <p role="alert" className="vg-colleague-error">{error || localError} <button onClick={onRefresh}>{zh ? "重试" : "Retry"}</button></p> : null}
    </section> : null}
  </aside>;
}
