import { redesignText } from "./desktop-redesign-copy";
import { makeT } from "./i18n";
import { copyTextToClipboard } from "./clipboard";
import { WorkspaceExtensions } from "./WorkspaceExtensions";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { WorkspaceDevAgent, WorkspaceFeatureView, WorkspaceAgentProfilePatch } from "./workspace-dev-state";
import WorkspaceRuntimeAccess from "./WorkspaceRuntimeAccess";
import ColleagueRuntimeForm from "./ColleagueRuntimeForm";
import type { WorkspaceDevSnapshot, WorkspaceRuntimeModels, WorkspaceConnectionModels, WorkspaceSessionRestart, RuntimeLoginSource, RuntimePermissionTier } from "./workspace-dev-state";
import type { AgentRuntimeId } from "./client";
import { WorkspaceAgentProfileSheet } from "./AgentProfileEditor";
import { WorkspaceAgentAvatar } from "./WorkspaceAgentAvatar";

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
  onSaveProfile(profile: WorkspaceAgentProfilePatch): Promise<void>;
}) {
  // B1: every authored string is a key now; the old `c(hans, en, hant)` helper existed
  // only because the copy was inline, and it is gone along with the ternaries.
  const t = makeT(locale);
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
  return <aside id="workspace-inspector" className="vg-inspector vg-colleague-manage" aria-label={t("ws.colleague.manage.ariaManage", { name: agent.identity.displayName })} inert={inert}>
    <header><h2>{agent.identity.displayName} · {r("manage")}</h2><button className="hs-icon" aria-label={t("ws.colleague.manage.close")} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <div className="vg-colleague-identity hd-profile-identity"><button type="button" className="hd-profile-avatar" aria-label={t("ws.colleague.manage.editProfile")} onClick={() => setProfileOpen(true)}><WorkspaceAgentAvatar agent={agent} /></button><div><strong>{agent.identity.displayName}</strong><span>{agent.kind === "main" ? r("orchestrator") : agent.identity.title || r("colleagues")}</span></div></div>
    {extensionsModel?.supportsRuntimeForm?.() ? <ColleagueRuntimeForm agent={agent} workspace={workspace} model={extensionsModel} locale={locale} permissionSupported={permissionSupported} onApplyPermissionTier={onApplyPermissionTier} onRuntimeDirectory={onRuntimeDirectory} onConnections={onConnections} />
      : <WorkspaceRuntimeAccess agent={agent} workspace={workspace} locale={locale} listModels={listModels} listConnectionModels={listConnectionModels} connectionModelSupported={connectionModelSupported} onApplyRuntime={onApplyRuntime} permissionSupported={permissionSupported} onApplyPermissionTier={onApplyPermissionTier} onApplyModel={onApplyModel} onApplyConnectionModel={onApplyConnectionModel} onRescan={onRescan} onRegisterRuntime={onRegisterRuntime} onRuntimeDirectory={onRuntimeDirectory} platform={extensionsModel?.runtimePlatform?.()} />}
    <details className="hd-manage-section"><summary>{r("profile")}<small>{agent.kind === "main" ? r("orchestrator") : agent.identity.title}</small></summary><section className="vg-context-card"><h3>{r("profile")}</h3><dl><dt>{t("ws.colleague.manage.displayName")}</dt><dd>{agent.identity.displayName}</dd><dt>{t("ws.colleague.manage.role")}</dt><dd>{agent.kind === "main" ? r("orchestrator") : agent.identity.title || "—"}</dd><dt>{t("ws.colleague.manage.runtime")}</dt><dd>{agent.runtime.label}</dd></dl><button onClick={() => setProfileOpen(true)}>{t("ws.colleague.manage.editProfile")}</button></section></details>
    {agent.kind === "colleague" && workspace.selectedAgentId === agent.agentId && workspace.colleagueHome ? <details className="hd-manage-section"><summary>{r("workingFolder")}</summary><section className="vg-context-card">
      <dl><dt>{r("workingFolder")}</dt><dd><code>{workspace.colleagueHome.path}</code></dd><dt>{r("relatedFolder")}</dt><dd><code>{workspace.colleagueHome.legacyPath}</code></dd></dl>
      {!workspace.colleagueHome.created ? <p>{r("folderLazy")}</p> : !workspace.colleagueHome.available ? <p role="alert">{r("folderUnavailable")}</p> : null}
      {workspace.colleagueHome.codexMigrationPending ? <p>{r("codexFolderPending")}</p> : null}<p>{r("privateMemory")}</p>
    </section></details> : null}
    {profileOpen ? <WorkspaceAgentProfileSheet agent={agent} locale={locale} onClose={() => setProfileOpen(false)} onSave={onSaveProfile} /> : null}
    {agent.kind === "colleague" ? <details className="hd-manage-section"><summary>{r("schedules")}<small>{schedules.length}</small></summary><section className="vg-context-card vg-colleague-schedules"><h3>{r("schedules")}<span>{schedules.length}</span></h3>
      {!supported ? <p className="vg-muted" role="status">{t("ws.colleague.manage.schedulesUpgrade")}</p>
        : !features ? <p className="vg-muted" role="status">{t("ws.colleague.manage.schedulesLoading")}</p>
        : schedules.length === 0 ? <p className="vg-muted">{t("ws.colleague.manage.schedulesEmpty", { name: agent.identity.displayName })}</p>
          : schedules.map((schedule) => <article key={schedule.id} className="vg-colleague-job">
            <div className="vg-colleague-job-head"><input type="checkbox" aria-label={t("ws.colleague.manage.enableAria", { name: schedule.name })} checked={schedule.enabled} disabled={busy} onChange={() => void run(() => onToggle(schedule))} /><strong>{schedule.name}</strong></div>
            <p>{schedule.schedule.expr ?? schedule.schedule.display ?? "—"}{schedule.tz ? ` · ${schedule.tz}` : ""}</p>
            <small>{t("ws.colleague.manage.next")} · {features.scheduler?.schedules.find((row) => row.id === schedule.id)?.nextRunAt ? new Date(features.scheduler.schedules.find((row) => row.id === schedule.id)!.nextRunAt!).toLocaleString(locale) : "—"}</small>
            {editing === schedule.id ? <div className="vg-colleague-edit">
              <label>{t("ws.colleague.manage.name")}<input value={values.name} maxLength={60} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
              <label>{t("ws.colleague.manage.cron")}<input value={values.cron} onChange={(event) => setValues({ ...values, cron: event.target.value })} /></label>
              <label>{t("ws.colleague.manage.tz")}<input value={values.tz} onChange={(event) => setValues({ ...values, tz: event.target.value })} /></label>
              <label>{t("ws.colleague.manage.instruction")}<textarea rows={3} value={values.task} onChange={(event) => setValues({ ...values, task: event.target.value })} /></label>
              <div><button disabled={busy || !values.name.trim() || !values.cron.trim() || !values.task.trim()} onClick={() => void run(async () => { await onSave(schedule, values); setEditing(null); })}>{t("ws.action.save")}</button><button disabled={busy} onClick={() => setEditing(null)}>{t("ws.cancel")}</button></div>
            </div> : <div className="vg-colleague-actions"><button onClick={() => beginEdit(schedule)} disabled={busy}>{t("ws.colleague.manage.edit")}</button><button onClick={() => void run(() => onToggle(schedule))} disabled={busy}>{schedule.enabled ? t("ws.colleague.manage.pause") : t("ws.colleague.manage.resume")}</button><button disabled={busy} onClick={() => { if (window.confirm(t("ws.colleague.manage.deleteConfirm", { name: schedule.name }))) void run(() => onDelete(schedule)); }}>{t("ws.action.delete")}</button></div>}
          </article>)}
      <p className="vg-muted">{t("ws.colleague.manage.footer")}</p>
      {error || localError ? <p role="alert" className="vg-colleague-error">{error || localError} <button onClick={onRefresh}>{t("ws.action.retry")}</button></p> : null}
    </section></details> : null}
    <details className="hd-manage-section" onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>{r("advanced")}</summary><div>{advancedOpen && extensionsModel && agent.agentEpoch ? <WorkspaceExtensions model={extensionsModel} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} agent={{ agentId: agent.agentId, agentEpoch: agent.agentEpoch }} /> : null}<button type="button" className="hs-btn sec" onClick={async () => setCopied(await copyTextToClipboard(workspace.conversation.sessionId) ? "copied" : "copyFailed")}>{copied ? r(copied) : r("copyId")}</button>{copied === "copyFailed" ? <code>{workspace.conversation.sessionId}</code> : null}</div></details>
  </aside>;
}
