import { useEffect, useState } from "react";
import type { AgentInfo, CronJobInfo } from "./client";
import { AgentPortrait } from "./AgentPortrait";
import "./ColleagueManagePanel.css";

interface Props {
  agent: AgentInfo;
  jobs: CronJobInfo[] | null;
  scheduleSupported: boolean;
  locale: "zh" | "en";
  onSaveProfile: (name: string, bio: string) => Promise<void>;
  onOpenProfile: () => void;
  onToggle: (job: CronJobInfo, enabled: boolean) => Promise<void>;
  onUpdate: (job: CronJobInfo, name: string, schedule: string, task: string, tz: string) => Promise<void>;
  onDelete: (job: CronJobInfo) => Promise<void>;
}

export default function ColleagueManagePanel({ agent, jobs, scheduleSupported, locale, onSaveProfile, onOpenProfile, onToggle, onUpdate, onDelete }: Props) {
  const zh = locale === "zh";
  const [name, setName] = useState(agent.identity?.displayName || agent.name);
  const [bio, setBio] = useState(agent.identity?.bio || agent.description || "");
  const [editing, setEditing] = useState<string | null>(null);
  const [jobName, setJobName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [task, setTask] = useState("");
  const [tz, setTz] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = agent.allowedActions.includes("edit_profile") && Boolean(agent.revision);
  useEffect(() => {
    setName(agent.identity?.displayName || agent.name);
    setBio(agent.identity?.bio || agent.description || "");
    setEditing(null);
    setError("");
  }, [agent.ref, agent.revision]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause).slice(0, 220)); }
    finally { setBusy(false); }
  };
  const beginEdit = (job: CronJobInfo) => {
    setEditing(job.id);
    setJobName(job.name);
    setSchedule(job.scheduleSpec || "");
    setTask(job.task || "");
    setTz(job.tz || "");
    setError("");
  };
  const formatNext = (value?: number, timeZone?: string) => value ? new Intl.DateTimeFormat(locale === "zh" ? "zh-TW" : "en-US", {
    dateStyle: "short", timeStyle: "short", ...(timeZone ? { timeZone } : {}),
  }).format(value) : (zh ? "暂无下次时间" : "No next run");

  return <aside className="colleague-manage" aria-label={zh ? `${name}的内部管理` : `Manage ${name}`}>
    <header className="colleague-manage-head">
      <small>{zh ? "该同事 · 内部管理" : "Colleague · management"}</small>
      <strong>{agent.identity?.displayName || agent.name}</strong>
      <span>{zh ? "资料与定时都属于这位同事" : "Profile and schedules for this colleague"}</span>
    </header>
    <div className="colleague-manage-scroll">
      <section className="colleague-manage-card" aria-label={zh ? "基本信息" : "Profile"}>
        <h3>{zh ? "基本信息" : "Profile"}</h3>
        <div className="colleague-manage-avatar"><AgentPortrait agentRef={agent.ref} name={agent.name} identity={agent.identity} size="medium" />
          <button type="button" disabled={!editable || busy} onClick={onOpenProfile}>{zh ? "更换头像" : "Change avatar"}</button></div>
        <label>{zh ? "显示名" : "Display name"}<input maxLength={64} value={name} disabled={!editable || busy} onChange={(event) => setName(event.target.value)} /></label>
        <label>{zh ? "说明" : "Description"}<textarea maxLength={220} rows={3} value={bio} disabled={!editable || busy} onChange={(event) => setBio(event.target.value)} /></label>
        {editable ? <button type="button" className="colleague-manage-save" disabled={busy || !name.trim()} onClick={() => void perform(() => onSaveProfile(name.trim(), bio.trim()))}>{zh ? "保存资料" : "Save profile"}</button> : null}
      </section>
      <section className="colleague-manage-card" aria-label={zh ? "本同事定时" : "This colleague's schedules"}>
        <h3>{zh ? "定时" : "Schedules"}<small>{zh ? "本同事" : "This colleague"} · {jobs?.length ?? 0}</small></h3>
        {!scheduleSupported ? <p className="colleague-manage-empty">{zh ? "需更新 Hara 引擎才能管理同事定时。" : "Update the Hara engine to manage colleague schedules."}</p> : jobs === null ? <p className="colleague-manage-empty">{zh ? "正在读取定时…" : "Loading schedules…"}</p> : jobs.length === 0 ? <p className="colleague-manage-empty">{zh ? `还没有挂在 ${name} 上的定时。直接在聊天里说“每天…”或“每周…”，确认后会出现在这里。` : `No schedules for ${name} yet. Ask in chat for a daily or weekly schedule and confirm it there.`}</p> : jobs.map((job) => <article className="colleague-manage-job" key={job.id}>
          <div className="colleague-manage-job-top"><input type="checkbox" aria-label={(zh ? "启用 " : "Enable ") + job.name} checked={job.enabled} disabled={busy} onChange={(event) => void perform(() => onToggle(job, event.target.checked))} /><strong>{job.name}</strong></div>
          <p>{job.schedule || job.scheduleSpec} {job.tz ? `· ${job.tz}` : ""}</p>
          <small>{zh ? "下次" : "Next"} · {formatNext(job.nextRunAt, job.tz)}</small>
          {editing === job.id ? <div className="colleague-manage-edit">
            <label>{zh ? "名称" : "Name"}<input value={jobName} maxLength={60} onChange={(event) => setJobName(event.target.value)} /></label>
            <label>{zh ? "节奏" : "Schedule"}<input value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label>
            <label>{zh ? "时区" : "Timezone"}<input value={tz} onChange={(event) => setTz(event.target.value)} /></label>
            <label>{zh ? "指令" : "Instruction"}<textarea rows={3} value={task} onChange={(event) => setTask(event.target.value)} /></label>
            <button type="button" disabled={busy || !jobName.trim() || !schedule.trim() || !task.trim()} onClick={() => void perform(async () => { await onUpdate(job, jobName.trim(), schedule.trim(), task.trim(), tz.trim()); setEditing(null); })}>{zh ? "保存" : "Save"}</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>{zh ? "取消" : "Cancel"}</button>
          </div> : <div className="colleague-manage-actions">
            <button type="button" disabled={busy} onClick={() => beginEdit(job)}>{zh ? "编辑" : "Edit"}</button>
            <button type="button" disabled={busy} onClick={() => void perform(() => onToggle(job, !job.enabled))}>{job.enabled ? (zh ? "停用" : "Pause") : (zh ? "启用" : "Resume")}</button>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(zh ? `删除定时“${job.name}”？` : `Delete schedule “${job.name}”?`)) void perform(() => onDelete(job)); }}>{zh ? "删除" : "Delete"}</button>
          </div>}
        </article>)}
        <p className="colleague-manage-hint">{zh ? "在左侧聊天里创建；此处管理本同事的定时。" : "Create in chat; manage this colleague's schedules here."}</p>
      </section>
      {error ? <p className="colleague-manage-error" role="alert">{error}</p> : null}
    </div>
  </aside>;
}
