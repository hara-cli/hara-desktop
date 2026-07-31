import { useMemo, useState, type ReactNode } from "react";

import type {
  DeskConnection,
  DeskSnapshot,
  DeskTask,
  DeskTaskDetails,
  DeskTaskState,
  OrganizationConnection,
  OrganizationConnectionsState,
} from "./client";
import {
  groupsTaskKey,
  type GroupsState,
} from "./groups-state";
import GroupsPreview, {
  GroupsSidebar as GroupsPreviewSidebar,
  type GroupsPreviewCopy,
} from "./GroupsPreview";
import { IconUsers } from "./icons";

export interface GroupsCopy extends GroupsPreviewCopy {
  locale: "en" | "zh";
  directoryLoading: string;
  directoryError: string;
  retry: string;
  organizations: string;
  noOrganizations: string;
  noOrganizationsHint: string;
  manageOrganizations: string;
  activeOrganization: string;
  selectedOrganization: string;
  deskConnected: string;
  deskNotConnected: string;
  deskNeedsRebind: string;
  switchLocked: string;
  switchOrganization: string;
  switchingOrganization: string;
  readOnly: string;
  readyTitle: string;
  readyHint: string;
  readBoard: string;
  readingBoard: string;
  refreshBoard: string;
  registrationTitle: string;
  registrationHint: string;
  rebindHint: string;
  legacyUnbound: string;
  tasksMetric: string;
  agentsMetric: string;
  activityMetric: string;
  circlesMetric: string;
  lastRead: string;
  truncated: string;
  noTasks: string;
  noTasksHint: string;
  taskDetails: string;
  backToBoard: string;
  pinnedOrganization: string;
  taskTimeline: string;
  noTimeline: string;
  createdBy: string;
  claimedBy: string;
  risk: string;
  stateOpen: string;
  stateClaimed: string;
  stateDone: string;
  stateCancelled: string;
  kindFeedback: string;
  kindDispatch: string;
  riskLow: string;
  riskHigh: string;
}

export type GroupsDirectoryPhase =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

export interface GroupsDirectoryState {
  phase: GroupsDirectoryPhase;
  organizations?: OrganizationConnectionsState;
  desk?: {
    connections: DeskConnection[];
    legacyUnbound: boolean;
  };
  error?: string;
}

interface GroupsSharedProps {
  copy: GroupsCopy;
  directory: GroupsDirectoryState;
  state: GroupsState;
  switchingProfileId?: string;
  onSelectOrganization: (profileId: string) => void;
  onRetryDirectory: () => void;
  onManageOrganizations: () => void;
}

interface GroupsStageProps extends GroupsSharedProps {
  onReadBoard: (profileId: string, state: DeskTaskState) => void;
  onOpenTask: (profileId: string, taskId: string) => void;
  onCloseTask: () => void;
  onManageModules: () => void;
  onHide: () => void;
}

const organizationFor = (
  organizations: OrganizationConnectionsState | undefined,
  profileId: string | undefined,
): OrganizationConnection | undefined =>
  organizations?.connections.find((connection) => connection.id === profileId);

const deskFor = (
  connections: DeskConnection[] | undefined,
  profileId: string | undefined,
): DeskConnection | undefined =>
  connections?.find((connection) => connection.profileId === profileId);

const owns = <T,>(record: Record<string, T>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const initials = (label: string): string => {
  const compact = label.trim();
  if (!compact) return "H";
  const parts = compact.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1]?.[0] ?? ""}` : compact.slice(0, 2))
    .toUpperCase();
};

const dateTime = (value: number, locale: "en" | "zh"): string => {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "—";
  }
};

const taskStateLabel = (copy: GroupsCopy, state: DeskTaskState): string => {
  if (state === "claimed") return copy.stateClaimed;
  if (state === "done") return copy.stateDone;
  if (state === "cancelled") return copy.stateCancelled;
  return copy.stateOpen;
};

const taskKindLabel = (copy: GroupsCopy, task: DeskTask): string =>
  task.kind === "dispatch" ? copy.kindDispatch : copy.kindFeedback;

function DirectoryError({
  copy,
  error,
  onRetry,
}: {
  copy: GroupsCopy;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <section className="groups-error" role="alert">
      <span className="groups-error-code">CONNECTION / LOCAL</span>
      <h2>{copy.directoryError}</h2>
      <p>{error}</p>
      <button type="button" onClick={onRetry}>{copy.retry}</button>
    </section>
  );
}

export function GroupsSidebar({
  brand,
  footer,
  copy,
  directory,
  state,
  switchingProfileId,
  onSelectOrganization,
  onRetryDirectory,
  onManageOrganizations,
}: GroupsSharedProps & {
  brand: ReactNode;
  footer: ReactNode;
}) {
  const organizations = directory.organizations?.connections ?? [];
  const deskConnections = directory.desk?.connections ?? [];
  const deskByProfile = useMemo(
    () => new Map(deskConnections.map((connection) => [connection.profileId, connection])),
    [deskConnections],
  );

  if (directory.phase === "unsupported") {
    return <GroupsPreviewSidebar brand={brand} footer={footer} copy={copy} />;
  }

  return (
    <aside className="sidebar groups-sidebar groups-directory-sidebar">
      {brand}
      <div className="groups-sidebar-heading">
        <span className="groups-sidebar-mark" aria-hidden>
          <IconUsers size={18} />
        </span>
        <span>
          <strong>{copy.sidebarTitle}</strong>
          <small>{copy.readOnly}</small>
        </span>
      </div>

      <div className="groups-directory-label">
        <span>{copy.organizations}</span>
        <span>{organizations.length.toString().padStart(2, "0")}</span>
      </div>

      {directory.phase === "loading" || directory.phase === "idle" ? (
        <div className="groups-directory-loading" aria-live="polite">
          <span />
          <span />
          <span />
          <small>{copy.directoryLoading}</small>
        </div>
      ) : directory.phase === "error" ? (
        <button className="groups-directory-retry" type="button" onClick={onRetryDirectory}>
          {copy.retry}
        </button>
      ) : organizations.length === 0 ? (
        <div className="groups-directory-empty">
          <strong>{copy.noOrganizations}</strong>
          <small>{copy.noOrganizationsHint}</small>
          <button type="button" onClick={onManageOrganizations}>{copy.manageOrganizations}</button>
        </div>
      ) : (
        <nav className="groups-organization-list" aria-label={copy.organizations}>
          {organizations.map((organization) => {
            const desk = deskByProfile.get(organization.id);
            const selected = state.selectedProfileId === organization.id;
            const switching = switchingProfileId === organization.id;
            return (
              <button
                type="button"
                key={organization.id}
                className={selected ? "is-selected" : ""}
                aria-current={selected ? "page" : undefined}
                aria-busy={switching || undefined}
                disabled={Boolean(switchingProfileId)}
                onClick={() => onSelectOrganization(organization.id)}
              >
                <span className="groups-org-avatar" aria-hidden>
                  {initials(organization.label)}
                  <i className={desk?.configured ? "is-online" : ""} />
                </span>
                <span className="groups-org-copy">
                  <strong>{organization.label}</strong>
                  <small>
                    {switching
                      ? copy.switchingOrganization
                      : desk?.configured
                        ? desk.host || copy.deskConnected
                        : desk?.needsRebind
                          ? copy.deskNeedsRebind
                        : copy.deskNotConnected}
                  </small>
                </span>
                {organization.active ? (
                  <span className="groups-org-active">{copy.activeOrganization}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      )}

      <div className="groups-sidebar-space" />
      <div className="groups-sidebar-footnote">
        <span className="groups-status-light is-local" aria-hidden />
        <span>{copy.readOnly}</span>
      </div>
      {footer}
    </aside>
  );
}

function SnapshotMetrics({
  snapshot,
  copy,
}: {
  snapshot: DeskSnapshot;
  copy: GroupsCopy;
}) {
  const metrics = [
    [copy.tasksMetric, snapshot.tasks.length],
    [copy.agentsMetric, snapshot.agents.filter((agent) => !agent.revoked).length],
    [copy.activityMetric, snapshot.events.length],
    [copy.circlesMetric, snapshot.circles.length],
  ] as const;
  return (
    <section className="groups-metrics" aria-label={copy.lastRead}>
      {metrics.map(([label, value], index) => (
        <div key={label}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{value}</strong>
          <small>{label}</small>
        </div>
      ))}
    </section>
  );
}

function TaskCard({
  task,
  copy,
  onOpen,
}: {
  task: DeskTask;
  copy: GroupsCopy;
  onOpen: () => void;
}) {
  return (
    <button className="groups-task-card" type="button" onClick={onOpen}>
      <span className="groups-task-meta">
        <i className={`is-${task.state}`} />
        <span>{taskKindLabel(copy, task)}</span>
        <span className={task.risk === "high" ? "is-high" : ""}>
          {task.risk === "high" ? copy.riskHigh : copy.riskLow}
        </span>
      </span>
      <strong>{task.title}</strong>
      <p>{task.excerpt || "—"}</p>
      <span className="groups-task-foot">
        <span>{taskStateLabel(copy, task.state)}</span>
        <span>{dateTime(task.updatedAt, copy.locale)} →</span>
      </span>
    </button>
  );
}

function TaskDossier({
  copy,
  organization,
  details,
  phase,
  error,
  onBack,
  onRetry,
}: {
  copy: GroupsCopy;
  organization?: OrganizationConnection;
  details?: DeskTaskDetails;
  phase: "idle" | "loading" | "ready" | "error";
  error?: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="groups-stage groups-task-stage" aria-labelledby="groups-task-title">
      <div className="groups-stage-grid" aria-hidden />
      <div className="groups-stage-shell">
        <button className="groups-back" type="button" onClick={onBack}>
          ← {copy.backToBoard}
        </button>
        <header className="groups-stage-head">
          <div>
            <span className="groups-eyebrow">{copy.taskDetails}</span>
            <h1 id="groups-task-title">{details?.task.title ?? copy.readingBoard}</h1>
            <p>
              {copy.pinnedOrganization}: <strong>{organization?.label ?? details?.profileId ?? "—"}</strong>
            </p>
          </div>
          <span className="groups-local-seal">{copy.readOnly}</span>
        </header>

        {phase === "loading" || phase === "idle" ? (
          <div className="groups-board-loading" aria-live="polite">
            <span />
            <span />
            <span />
            <p>{copy.readingBoard}</p>
          </div>
        ) : phase === "error" ? (
          <DirectoryError copy={copy} error={error} onRetry={onRetry} />
        ) : details ? (
          <div className="groups-dossier-grid">
            <article className="groups-dossier">
              <span className="groups-dossier-id">{details.task.id}</span>
              <p className="groups-dossier-body">{details.task.body || "—"}</p>
              <dl>
                <div>
                  <dt>{copy.createdBy}</dt>
                  <dd>{details.task.createdBy || "—"}</dd>
                </div>
                <div>
                  <dt>{copy.claimedBy}</dt>
                  <dd>{details.task.claimedBy || "—"}</dd>
                </div>
                <div>
                  <dt>{copy.risk}</dt>
                  <dd>{details.task.risk === "high" ? copy.riskHigh : copy.riskLow}</dd>
                </div>
                <div>
                  <dt>{copy.selectedOrganization}</dt>
                  <dd>{organization?.label ?? details.profileId}</dd>
                </div>
              </dl>
            </article>
            <section className="groups-timeline">
              <h2>{copy.taskTimeline}</h2>
              {details.events.length === 0 ? (
                <p className="groups-empty-copy">{copy.noTimeline}</p>
              ) : (
                <ol>
                  {details.events.map((event) => (
                    <li key={event.id}>
                      <span>{event.action}</span>
                      <strong>{event.actor}</strong>
                      <small>{event.detail || dateTime(event.at, copy.locale)}</small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function Groups({
  copy,
  directory,
  state,
  onRetryDirectory,
  onManageOrganizations,
  onReadBoard,
  onOpenTask,
  onCloseTask,
  onManageModules,
  onHide,
}: GroupsStageProps) {
  const [taskState, setTaskState] = useState<DeskTaskState>("open");
  const organizations = directory.organizations;
  const selectedOrganization = organizationFor(organizations, state.selectedProfileId);
  const selectedDesk = deskFor(directory.desk?.connections, state.selectedProfileId);
  const selectedSnapshot = state.selectedProfileId
    && owns(state.snapshotsByProfile, state.selectedProfileId)
    ? state.snapshotsByProfile[state.selectedProfileId]
    : undefined;

  if (directory.phase === "unsupported") {
    return <GroupsPreview copy={copy} onManage={onManageModules} onHide={onHide} />;
  }

  const openTaskOrganization = organizationFor(organizations, state.openTask?.profileId);
  const openTaskDesk = deskFor(directory.desk?.connections, state.openTask?.profileId);
  if (state.openTask && openTaskOrganization && openTaskDesk?.configured) {
    const key = groupsTaskKey(state.openTask.profileId, state.openTask.taskId);
    const details = state.tasksByKey[key];
    return (
      <TaskDossier
        copy={copy}
        organization={openTaskOrganization}
        details={details?.data}
        phase={details?.phase ?? "idle"}
        error={details?.error}
        onBack={onCloseTask}
        onRetry={() => onOpenTask(state.openTask!.profileId, state.openTask!.taskId)}
      />
    );
  }

  return (
    <main className="groups-stage groups-board-stage" aria-labelledby="groups-board-title">
      <div className="groups-stage-grid" aria-hidden />
      <div className="groups-stage-shell">
        <header className="groups-stage-head groups-board-head">
          <div>
            <span className="groups-eyebrow">ORGANIZATION DESK / NATIVE</span>
            <h1 id="groups-board-title">
              {selectedOrganization?.label ?? copy.organizationTitle}
            </h1>
            <p>{copy.organizationHint}</p>
          </div>
          <div className="groups-board-actions">
            <span className="groups-local-seal">{copy.readOnly}</span>
          </div>
        </header>

        {directory.phase === "loading" || directory.phase === "idle" ? (
          <div className="groups-board-loading" aria-live="polite">
            <span />
            <span />
            <span />
            <p>{copy.directoryLoading}</p>
          </div>
        ) : directory.phase === "error" ? (
          <DirectoryError copy={copy} error={directory.error} onRetry={onRetryDirectory} />
        ) : !selectedOrganization ? (
          <section className="groups-empty-state">
            <span className="groups-empty-index">00 / ORGANIZATION</span>
            <h2>{copy.noOrganizations}</h2>
            <p>{copy.noOrganizationsHint}</p>
            <button type="button" onClick={onManageOrganizations}>{copy.manageOrganizations}</button>
          </section>
        ) : !selectedDesk?.configured ? (
          <section className="groups-registration">
            <span className="groups-empty-index">01 / DESK BINDING</span>
            <h2>{copy.registrationTitle}</h2>
            <p>{selectedDesk?.needsRebind ? copy.rebindHint : copy.registrationHint}</p>
            {directory.desk?.legacyUnbound ? (
              <p className="groups-legacy-note">{copy.legacyUnbound}</p>
            ) : null}
            <button type="button" className="ghost" onClick={onManageOrganizations}>
              {copy.manageOrganizations}
            </button>
          </section>
        ) : selectedSnapshot?.phase === "idle" || !selectedSnapshot ? (
          <section className="groups-ready-state">
            <span className="groups-ready-orbit" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="groups-empty-index">02 / EXPLICIT READ</span>
            <h2>{copy.readyTitle}</h2>
            <p>{copy.readyHint}</p>
            <div className="groups-state-picker" role="group" aria-label={copy.tasksMetric}>
              {(["open", "claimed", "done", "cancelled"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={taskState === value ? "is-active" : ""}
                  aria-pressed={taskState === value}
                  onClick={() => setTaskState(value)}
                >
                  {taskStateLabel(copy, value)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="groups-primary-action"
              onClick={() => onReadBoard(selectedOrganization.id, taskState)}
            >
              {copy.readBoard}
            </button>
          </section>
        ) : selectedSnapshot.phase === "loading" && !selectedSnapshot.data ? (
          <div className="groups-board-loading" aria-live="polite">
            <span />
            <span />
            <span />
            <p>{copy.readingBoard}</p>
          </div>
        ) : selectedSnapshot.phase === "error" && !selectedSnapshot.data ? (
          <DirectoryError
            copy={copy}
            error={selectedSnapshot.error}
            onRetry={() => onReadBoard(selectedOrganization.id, taskState)}
          />
        ) : selectedSnapshot.data ? (
          <>
            <div className="groups-snapshot-toolbar">
              <span>
                {copy.lastRead}: {dateTime(selectedSnapshot.data.fetchedAt, copy.locale)}
                {selectedSnapshot.data.truncated ? ` · ${copy.truncated}` : ""}
              </span>
              <div className="groups-state-picker" role="group" aria-label={copy.tasksMetric}>
                {(["open", "claimed", "done", "cancelled"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={taskState === value ? "is-active" : ""}
                    aria-pressed={taskState === value}
                    onClick={() => setTaskState(value)}
                  >
                    {taskStateLabel(copy, value)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ghost"
                disabled={selectedSnapshot.phase === "loading"}
                onClick={() => onReadBoard(selectedOrganization.id, taskState)}
              >
                {selectedSnapshot.phase === "loading" ? copy.readingBoard : copy.refreshBoard}
              </button>
            </div>
            <SnapshotMetrics snapshot={selectedSnapshot.data} copy={copy} />
            {selectedSnapshot.data.tasks.length === 0 ? (
              <section className="groups-empty-state is-compact">
                <h2>{copy.noTasks}</h2>
                <p>{copy.noTasksHint}</p>
              </section>
            ) : (
              <section className="groups-task-grid" aria-label={copy.tasksMetric}>
                {selectedSnapshot.data.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    copy={copy}
                    onOpen={() => onOpenTask(selectedOrganization.id, task.id)}
                  />
                ))}
              </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
