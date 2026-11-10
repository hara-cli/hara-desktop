import { makeT } from "./i18n";
import { redesignText } from "./desktop-redesign-copy";
import { taskStatus } from "./workspace-shell-state";
import { workspaceMessageText } from "./workspace-settings-copy";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceFeatureView } from "./workspace-dev-state";

type Props = { agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; features: WorkspaceFeatureView | null;
  locale: "en" | "zh-Hans" | "zh-Hant"; supported: boolean; error: string; onRefresh(): void };
export function scopedInspectorFeatures(workspace: WorkspaceDevSnapshot, features: WorkspaceFeatureView | null) {
  return features?.workspaceId === workspace.workspaceId ? features : null;
}
function FeatureNotice({ locale, supported, features, error, onRefresh }: Pick<Props, "locale" | "supported" | "features" | "error" | "onRefresh">) {
  const t = makeT(locale), r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  if (!supported) return <p role="status">{r("inspectorDataUnavailable")}</p>;
  if (error) return <p role="alert">{workspaceMessageText(t, error)} <button type="button" className="hs-btn sec" onClick={onRefresh}>{r("retry")}</button></p>;
  return features ? null : <p role="status">{r("loading")}</p>;
}
export function WorkspaceInspectorActivity({ agent, workspace, features: input, locale, supported, error, onRefresh, onSchedules }: Props & { onSchedules(): void }) {
  const t = makeT(locale), r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const features = scopedInspectorFeatures(workspace, input), selected = workspace.selectedAgentId === agent.agentId;
  const conversation = selected ? workspace.conversation : undefined;
  const schedules = features?.schedules.filter(row => row.agentId === agent.agentId) ?? [];
  const state = conversation?.taskState ?? conversation?.state;
  const idle = state === "idle", status = taskStatus(state);
  return <>
    <section className="hd-inspector-section" aria-label={r("inspectorCurrentTask")}><h3>{r("inspectorCurrentTask")}</h3>
      <p className="hd-inspector-state" role="status">{idle ? r("inspectorIdle") : state === "failed" ? t("ws.schedules.failed") : t(`ws.tasks.status.${status}`)}</p>
      {conversation?.taskId && conversation.objective ? <p className="hd-inspector-objective">{conversation.objective}</p> : null}
      <dl><dt>{t("ws.colleague.manage.runtime")}</dt><dd>{agent.runtime.label}</dd><dt>{r("inspectorLocation")}</dt><dd>{r("inspectorLocationUnknown")}</dd></dl>
    </section>
    {agent.kind === "colleague" ? <section className="hd-inspector-section" aria-label={r("schedules")}><h3>{r("schedules")}{supported && features && !error ? <small>{schedules.length}</small> : null}</h3>
      <FeatureNotice locale={locale} supported={supported} features={features} error={error} onRefresh={onRefresh} />
      {supported && features && !error ? schedules.length ? <ul className="hd-inspector-list">{schedules.map(row => {
        const next = features.scheduler?.schedules.find(item => item.id === row.id)?.nextRunAt;
        return <li key={row.id}><strong>{row.name}</strong><span>{r(row.enabled ? "inspectorEnabled" : "inspectorPaused")}</span><small>{row.schedule.display ?? row.schedule.expr ?? (row.schedule.runAt ? new Date(row.schedule.runAt).toLocaleString(locale) : r("inspectorTimingUnknown"))}{row.tz ? ` · ${row.tz}` : ""}</small>
          {typeof next === "number" && Number.isFinite(next) ? <small>{t("ws.colleague.manage.next")} · {new Date(next).toLocaleString(locale)}</small> : null}</li>;
      })}</ul> : <p>{t("ws.colleague.manage.schedulesEmpty", { name: agent.identity.displayName })}</p> : null}
      {supported ? <button type="button" className="hs-btn sec" onClick={onSchedules}>{r("inspectorManageSchedules")}</button> : null}
    </section> : null}
  </>;
}
export function WorkspaceInspectorResources({ agent, workspace, features: input, locale, supported, error, onRefresh }: Props) {
  const t = makeT(locale), r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const home = agent.kind === "colleague" && workspace.selectedAgentId === agent.agentId ? workspace.colleagueHome : undefined;
  const features = scopedInspectorFeatures(workspace, input);
  return <>
    <section className="hd-inspector-section" aria-label={r("inspectorFiles")}><h3>{r("inspectorFiles")}</h3>
      {home ? <><dl><dt>{r("workingFolder")}</dt><dd><code>{home.path}</code></dd><dt>{r("relatedFolder")}</dt><dd><code>{home.legacyPath}</code></dd></dl>
        {!home.created ? <p>{r("folderLazy")}</p> : !home.available ? <p role="alert">{r("folderUnavailable")}</p> : null}{home.codexMigrationPending ? <p>{r("codexFolderPending")}</p> : null}</> : <p>{r("inspectorFolderUnknown")}</p>}
      <p className="hd-inspector-note">{r("inspectorFilesUnavailable")}</p>
    </section>
    <section className="hd-inspector-section" aria-label={r("inspectorSkills")}><h3>{r("inspectorSkills")}</h3>
      <FeatureNotice locale={locale} supported={supported} features={features} error={error} onRefresh={onRefresh} />
      {supported && features && !error ? features.skills.length ? <ul className="hd-inspector-list">{features.skills.map(skill => <li key={skill.id}><strong>{skill.id}</strong><span>{r(skill.enabled ? "inspectorEnabled" : "inspectorDisabled")}</span><p>{skill.description}</p><small>{t(skill.source === "private" ? "ws.skills.private" : "ws.skills.global")}</small></li>)}</ul> : <p>{t("ws.skills.empty")}</p> : null}
    </section>
    <section className="hd-inspector-section" aria-label={r("memory")}><h3>{r("memory")}</h3><p>{home?.memoryScope === "private" ? r("privateMemory") : r("inspectorMemoryUnknown")}</p><p className="hd-inspector-note">{r("inspectorMemoryUnavailable")}</p></section>
  </>;
}
