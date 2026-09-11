import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import type {
  DeskConnection,
  DeskCreateTaskInput,
  DeskAgent,
  DeskPriority,
  DeskSeverity,
  DeskSnapshot,
  DeskTask,
  DeskTaskDetails,
  DeskTaskMutationResult,
  DeskTaskState,
  DeskTransitionTaskInput,
  OrganizationConnection,
  OrganizationConnectionsState,
} from "./client";
import {
  groupsTaskKey,
  type GroupsState,
} from "./groups-state";
import {
  canClaimDeskTask,
  DESK_TASK_STATES,
  deskTaskClaimExpired,
  deskTransitionRequiresNote,
  deskTransitionRequiresRelease,
  desktopTaskTransitions,
  shouldAutoReadDeskBoard,
} from "./groups-manager-policy";
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
  managed: string;
  joinOrganization: string;
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
  stateBlocked: string;
  stateWaitingUser: string;
  stateWaitingRelease: string;
  stateWaitingVerification: string;
  stateReview: string;
  stateDone: string;
  stateCancelled: string;
  kindFeedback: string;
  kindDispatch: string;
  riskLow: string;
  riskHigh: string;
  createWork: string;
  createFeedback: string;
  createTask: string;
  createTitle: string;
  createTitlePlaceholder: string;
  createBody: string;
  createBodyPlaceholder: string;
  priority: string;
  severity: string;
  priorityUrgent: string;
  priorityHigh: string;
  priorityNormal: string;
  priorityLow: string;
  severityCritical: string;
  severityMajor: string;
  severityMinor: string;
  severityCosmetic: string;
  taskActions: string;
  claimTask: string;
  reclaimTask: string;
  claimExpiredHint: string;
  riskApprovalRequired: string;
  acknowledgeRisk: string;
  acknowledgeRiskConfirm: string;
  moveTo: string;
  actionNote: string;
  actionNotePlaceholder: string;
  releaseVersion: string;
  verificationSteps: string;
  applyTransition: string;
  cancelTask: string;
  cancelConfirm: string;
  addComment: string;
  commentPlaceholder: string;
  comments: string;
  noComments: string;
  saving: string;
  manageUnavailable: string;
  taskSessionOwned: string;
  occurrence: string;
  sources: string;
  diffs: string;
  sla: string;
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
  onJoinOrganization: () => void;
  canManage: boolean;
}

interface GroupsStageProps extends GroupsSharedProps {
  onReadBoard: (profileId: string, state: DeskTaskState) => void;
  onOpenTask: (profileId: string, taskId: string) => void;
  onCloseTask: () => void;
  onCreateTask: (profileId: string, input: DeskCreateTaskInput) => Promise<DeskTaskMutationResult>;
  onClaimTask: (profileId: string, taskId: string) => Promise<DeskTaskMutationResult>;
  onAckTask: (profileId: string, taskId: string) => Promise<DeskTaskMutationResult>;
  onTransitionTask: (
    profileId: string,
    taskId: string,
    input: DeskTransitionTaskInput,
  ) => Promise<DeskTaskMutationResult>;
  onCompleteTask: (
    profileId: string,
    taskId: string,
    input: { detail?: string; releaseVersion?: string; verificationSteps?: string; claimFence?: number },
  ) => Promise<DeskTaskMutationResult>;
  onCancelTask: (profileId: string, taskId: string, detail: string, claimFence?: number) => Promise<DeskTaskMutationResult>;
  onCommentTask: (profileId: string, taskId: string, body: string) => Promise<void>;
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
  if (state === "blocked") return copy.stateBlocked;
  if (state === "waiting_user") return copy.stateWaitingUser;
  if (state === "waiting_release") return copy.stateWaitingRelease;
  if (state === "waiting_verification") return copy.stateWaitingVerification;
  if (state === "review") return copy.stateReview;
  if (state === "done") return copy.stateDone;
  if (state === "cancelled") return copy.stateCancelled;
  return copy.stateOpen;
};

const priorityLabel = (copy: GroupsCopy, priority: DeskPriority): string => ({
  urgent: copy.priorityUrgent,
  high: copy.priorityHigh,
  normal: copy.priorityNormal,
  low: copy.priorityLow,
})[priority];

const severityLabel = (copy: GroupsCopy, severity: DeskSeverity): string => ({
  critical: copy.severityCritical,
  major: copy.severityMajor,
  minor: copy.severityMinor,
  cosmetic: copy.severityCosmetic,
})[severity];

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
  onJoinOrganization,
  canManage,
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
          <small>{canManage ? copy.managed : copy.readOnly}</small>
        </span>
      </div>

      <div className="groups-directory-label">
        <span>{copy.organizations}</span>
        <span>
          {organizations.length.toString().padStart(2, "0")}
          <button type="button" onClick={onJoinOrganization} aria-label={copy.joinOrganization} title={copy.joinOrganization}>＋</button>
        </span>
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
          <button type="button" onClick={onJoinOrganization}>{copy.joinOrganization}</button>
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

      <button className="groups-directory-manage" type="button" onClick={onManageOrganizations}>
        {copy.manageOrganizations}
      </button>
      <div className="groups-sidebar-space" />
      <div className="groups-sidebar-footnote">
        <span className="groups-status-light is-local" aria-hidden />
        <span>{canManage ? copy.managed : copy.readOnly}</span>
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

function TaskComposer({
  copy,
  profileId,
  onCreate,
  onCreated,
  onClose,
}: {
  copy: GroupsCopy;
  profileId: string;
  onCreate: (profileId: string, input: DeskCreateTaskInput) => Promise<DeskTaskMutationResult>;
  onCreated: (result: DeskTaskMutationResult) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"feedback" | "dispatch">("feedback");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [risk, setRisk] = useState<"low" | "high">("low");
  const [priority, setPriority] = useState<DeskPriority>("normal");
  const [severity, setSeverity] = useState<DeskSeverity>("minor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onCreate(profileId, {
        kind,
        title: title.trim(),
        body,
        risk,
        priority,
        severity,
      });
      onCreated(result);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason).slice(0, 240));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="groups-task-composer" aria-labelledby="groups-create-work-title">
      <header>
        <div>
          <span>NEW / ORGANIZATION</span>
          <h2 id="groups-create-work-title">{copy.createWork}</h2>
        </div>
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>×</button>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <div className="groups-kind-picker" role="group" aria-label={copy.createWork}>
          <button type="button" className={kind === "feedback" ? "is-active" : ""} aria-pressed={kind === "feedback"} onClick={() => setKind("feedback")}>{copy.createFeedback}</button>
          <button type="button" className={kind === "dispatch" ? "is-active" : ""} aria-pressed={kind === "dispatch"} onClick={() => setKind("dispatch")}>{copy.createTask}</button>
        </div>
        <label className="groups-composer-wide">
          <span>{copy.createTitle}</span>
          <input autoFocus value={title} maxLength={200} placeholder={copy.createTitlePlaceholder} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="groups-composer-wide">
          <span>{copy.createBody}</span>
          <textarea value={body} maxLength={20_000} rows={5} placeholder={copy.createBodyPlaceholder} onChange={(event) => setBody(event.target.value)} />
        </label>
        <div className="groups-composer-options">
          <label>
            <span>{copy.priority}</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as DeskPriority)}>
              {(["urgent", "high", "normal", "low"] as const).map((value) => <option key={value} value={value}>{priorityLabel(copy, value)}</option>)}
            </select>
          </label>
          <label>
            <span>{copy.severity}</span>
            <select value={severity} onChange={(event) => setSeverity(event.target.value as DeskSeverity)}>
              {(["critical", "major", "minor", "cosmetic"] as const).map((value) => <option key={value} value={value}>{severityLabel(copy, value)}</option>)}
            </select>
          </label>
          <label>
            <span>{copy.risk}</span>
            <select value={risk} onChange={(event) => setRisk(event.target.value as "low" | "high")}>
              <option value="low">{copy.riskLow}</option>
              <option value="high">{copy.riskHigh}</option>
            </select>
          </label>
        </div>
        {error ? <p className="groups-manager-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>{copy.backToBoard}</button>
          <button type="submit" disabled={busy || !title.trim()}>{busy ? copy.saving : kind === "feedback" ? copy.createFeedback : copy.createTask}</button>
        </footer>
      </form>
    </section>
  );
}

function TaskDossier({
  copy,
  organization,
  actor,
  canManage,
  details,
  phase,
  error,
  onBack,
  onRetry,
  onRefresh,
  onClaim,
  onAck,
  onTransition,
  onComplete,
  onCancel,
  onComment,
}: {
  copy: GroupsCopy;
  organization?: OrganizationConnection;
  actor?: DeskAgent;
  canManage: boolean;
  details?: DeskTaskDetails;
  phase: "idle" | "loading" | "ready" | "error";
  error?: string;
  onBack: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onClaim: (taskId: string) => Promise<DeskTaskMutationResult>;
  onAck: (taskId: string) => Promise<DeskTaskMutationResult>;
  onTransition: (taskId: string, input: DeskTransitionTaskInput) => Promise<DeskTaskMutationResult>;
  onComplete: (
    taskId: string,
    input: { detail?: string; releaseVersion?: string; verificationSteps?: string; claimFence?: number },
  ) => Promise<DeskTaskMutationResult>;
  onCancel: (taskId: string, detail: string, claimFence?: number) => Promise<DeskTaskMutationResult>;
  onComment: (taskId: string, body: string) => Promise<void>;
}) {
  const [transitionTarget, setTransitionTarget] = useState<DeskTaskState>("claimed");
  const [note, setNote] = useState("");
  const [releaseVersion, setReleaseVersion] = useState("");
  const [verificationSteps, setVerificationSteps] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [managerError, setManagerError] = useState("");
  const [leaseClock, setLeaseClock] = useState(() => Date.now());

  const task = details?.task;
  const expiredClaim = task ? deskTaskClaimExpired(task, leaseClock) : false;
  // One private, renewable workbench Session is maintained by the local Engine for this Agent.
  // The renderer receives only the public Agent/task identities and fencing number, never its hds token.
  const sessionOwnedElsewhere = Boolean(
    task?.claimedSessionId
    && !expiredClaim
    && task.claimedBy !== actor?.id
    && actor?.role !== "owner",
  );
  const availableTargets = task ? desktopTaskTransitions(task, actor, leaseClock) : [];
  const claimable = task ? canClaimDeskTask(task, actor, leaseClock) : false;

  useEffect(() => {
    const expiresAt = task?.state === "claimed" ? task.claimExpiresAt : null;
    const current = Date.now();
    setLeaseClock(current);
    if (typeof expiresAt !== "number" || expiresAt <= current) return;
    const timer = window.setTimeout(
      () => setLeaseClock(Date.now()),
      Math.min(expiresAt - current + 50, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [task?.id, task?.state, task?.claimExpiresAt, task?.claimFence]);

  useEffect(() => {
    if (!task) return;
    setTransitionTarget(desktopTaskTransitions(task, actor, Date.now())[0] ?? task.state);
    setNote("");
    setReleaseVersion(task.releaseVersion ?? "");
    setVerificationSteps(task.verificationSteps ?? "");
    setComment("");
    setManagerError("");
  }, [actor?.id, actor?.role, task?.id, task?.state, task?.claimFence, task?.claimExpiresAt, task?.releaseVersion, task?.verificationSteps]);

  const runMutation = async (name: string, mutation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    setManagerError("");
    try {
      await mutation();
      onRefresh();
    } catch (reason) {
      setManagerError(String(reason instanceof Error ? reason.message : reason).slice(0, 320));
    } finally {
      setBusy("");
    }
  };

  const submitTransition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task || !availableTargets.includes(transitionTarget)) return;
    const detail = note.trim();
    if (deskTransitionRequiresNote(transitionTarget) && !detail) return;
    if (transitionTarget === "waiting_verification" && (!releaseVersion.trim() || !verificationSteps.trim())) return;
    if (transitionTarget === "cancelled") {
      if (!window.confirm(copy.cancelConfirm)) return;
      await runMutation("transition", () => onCancel(
        task.id,
        detail,
        task.claimedSessionId && task.claimedBy === actor?.id ? task.claimFence : undefined,
      ));
      return;
    }
    if (transitionTarget === "done" && task.claimedBy === actor?.id) {
      await runMutation("transition", () => onComplete(task.id, {
        detail,
        ...(releaseVersion.trim() ? { releaseVersion: releaseVersion.trim() } : {}),
        ...(verificationSteps.trim() ? { verificationSteps: verificationSteps.trim() } : {}),
        ...(task.claimedSessionId ? { claimFence: task.claimFence } : {}),
      }));
      return;
    }
    await runMutation("transition", () => onTransition(task.id, {
      state: transitionTarget,
      ...(detail ? { note: detail } : {}),
      ...(releaseVersion.trim() ? { releaseVersion: releaseVersion.trim() } : {}),
      ...(verificationSteps.trim() ? { verificationSteps: verificationSteps.trim() } : {}),
      ...(task.claimedSessionId && task.claimedBy === actor?.id
        ? { claimFence: task.claimFence }
        : {}),
    }));
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task || !comment.trim()) return;
    await runMutation("comment", async () => {
      await onComment(task.id, comment.trim());
      setComment("");
    });
  };

  const requiresTransitionNote = deskTransitionRequiresNote(transitionTarget);
  const requiresRelease = task ? deskTransitionRequiresRelease(task, transitionTarget) : false;

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
          <span className="groups-local-seal">{canManage ? copy.managed : copy.readOnly}</span>
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
              <div className="groups-dossier-status">
                <span className="groups-dossier-id">{details.task.id}</span>
                <span><i className={`is-${details.task.state}`} />{taskStateLabel(copy, details.task.state)}</span>
              </div>
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
                  <dt>{copy.priority}</dt>
                  <dd>{details.task.priority ? priorityLabel(copy, details.task.priority) : "—"}</dd>
                </div>
                <div>
                  <dt>{copy.severity}</dt>
                  <dd>{details.task.severity ? severityLabel(copy, details.task.severity) : "—"}</dd>
                </div>
                <div>
                  <dt>{copy.occurrence}</dt>
                  <dd>{details.task.occurrenceCount ?? 1}</dd>
                </div>
                <div>
                  <dt>{copy.sla}</dt>
                  <dd>{details.task.slaDueAt ? dateTime(details.task.slaDueAt, copy.locale) : "—"}</dd>
                </div>
                <div>
                  <dt>{copy.selectedOrganization}</dt>
                  <dd>{organization?.label ?? details.profileId}</dd>
                </div>
              </dl>

              {canManage ? (
                <section className="groups-workflow" aria-labelledby="groups-task-actions-title">
                  <div className="groups-workflow-head">
                    <h2 id="groups-task-actions-title">{copy.taskActions}</h2>
                    <span>{actor ? `${actor.name} · ${actor.client}` : "—"}</span>
                  </div>
                  <div className="groups-workflow-quick-actions">
                    {claimable ? (
                      <button type="button" disabled={Boolean(busy) || !actor} onClick={() => void runMutation("claim", () => onClaim(details.task.id))}>
                        {busy === "claim" ? copy.saving : expiredClaim ? copy.reclaimTask : copy.claimTask}
                      </button>
                    ) : null}
                    {details.task.risk === "high" && !details.task.ackedBy && actor?.role === "owner" ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          const confirmation = copy.acknowledgeRiskConfirm
                            .replace("{organization}", organization?.label ?? details.profileId)
                            .replace("{id}", details.task.id)
                            .replace("{title}", details.task.title);
                          if (!window.confirm(confirmation)) return;
                          void runMutation("ack", () => onAck(details.task.id));
                        }}
                      >
                        {busy === "ack" ? copy.saving : copy.acknowledgeRisk}
                      </button>
                    ) : null}
                  </div>
                  {details.task.risk === "high" && !details.task.ackedBy ? (
                    <p className="groups-manager-note">{copy.riskApprovalRequired}</p>
                  ) : expiredClaim ? (
                    <p className="groups-manager-note">{copy.claimExpiredHint}</p>
                  ) : null}
                  {availableTargets.length > 0 && !sessionOwnedElsewhere ? (
                    <form className="groups-transition-form" onSubmit={(event) => void submitTransition(event)}>
                      <label>
                        <span>{copy.moveTo}</span>
                        <select value={transitionTarget} disabled={Boolean(busy)} onChange={(event) => setTransitionTarget(event.target.value as DeskTaskState)}>
                          {availableTargets.map((value) => <option key={value} value={value}>{taskStateLabel(copy, value)}</option>)}
                        </select>
                      </label>
                      <label className="groups-workflow-wide">
                        <span>{copy.actionNote}{requiresTransitionNote ? " *" : ""}</span>
                        <textarea rows={3} maxLength={2000} value={note} placeholder={copy.actionNotePlaceholder} disabled={Boolean(busy)} onChange={(event) => setNote(event.target.value)} />
                      </label>
                      {requiresRelease ? (
                        <div className="groups-release-fields">
                          <label>
                            <span>{copy.releaseVersion}</span>
                            <input maxLength={64} value={releaseVersion} disabled={Boolean(busy)} onChange={(event) => setReleaseVersion(event.target.value)} />
                          </label>
                          <label>
                            <span>{copy.verificationSteps}</span>
                            <textarea rows={3} maxLength={4000} value={verificationSteps} disabled={Boolean(busy)} onChange={(event) => setVerificationSteps(event.target.value)} />
                          </label>
                        </div>
                      ) : null}
                      <button
                        type="submit"
                        disabled={Boolean(busy)
                          || (requiresTransitionNote && !note.trim())
                          || (requiresRelease && (!releaseVersion.trim() || !verificationSteps.trim()))}
                      >
                        {busy === "transition" ? copy.saving : transitionTarget === "cancelled" ? copy.cancelTask : copy.applyTransition}
                      </button>
                    </form>
                  ) : sessionOwnedElsewhere ? (
                    <p className="groups-manager-note">{copy.taskSessionOwned}</p>
                  ) : null}
                  {managerError ? <p className="groups-manager-error" role="alert">{managerError}</p> : null}
                </section>
              ) : (
                <p className="groups-manager-note">{copy.manageUnavailable}</p>
              )}
            </article>
            <div className="groups-dossier-aside">
              <section className="groups-timeline">
                <h2>{copy.taskTimeline}</h2>
                {(details.events ?? []).length === 0 ? (
                  <p className="groups-empty-copy">{copy.noTimeline}</p>
                ) : (
                  <ol>
                    {(details.events ?? []).map((event) => (
                      <li key={event.id}>
                        <span>{event.action}</span>
                        <strong>{event.actor}</strong>
                        <small>{event.detail || dateTime(event.at, copy.locale)}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section className="groups-comments">
                <h2>{copy.comments}</h2>
                {(details.comments ?? []).length === 0 ? (
                  <p className="groups-empty-copy">{copy.noComments}</p>
                ) : (
                  <ol>
                    {(details.comments ?? []).map((item) => (
                      <li key={item.id}>
                        <strong>{item.actor}</strong>
                        <p>{item.body}</p>
                        <small>{dateTime(item.at, copy.locale)}</small>
                      </li>
                    ))}
                  </ol>
                )}
                {canManage ? (
                  <form onSubmit={(event) => void submitComment(event)}>
                    <textarea rows={3} maxLength={4000} value={comment} placeholder={copy.commentPlaceholder} disabled={Boolean(busy)} onChange={(event) => setComment(event.target.value)} />
                    <button type="submit" disabled={Boolean(busy) || !comment.trim()}>{busy === "comment" ? copy.saving : copy.addComment}</button>
                  </form>
                ) : null}
              </section>
              {(details.sources ?? []).length > 0 || (details.diffs ?? []).length > 0 ? (
                <section className="groups-evidence">
                  {(details.sources ?? []).length > 0 ? (
                    <div>
                      <h2>{copy.sources}</h2>
                      <ul>{(details.sources ?? []).map((source) => <li key={source.id}>{source.sourceKind} · {source.reporterRef || source.sourceMessageId}</li>)}</ul>
                    </div>
                  ) : null}
                  {(details.diffs ?? []).length > 0 ? (
                    <div>
                      <h2>{copy.diffs}</h2>
                      <ul>{(details.diffs ?? []).map((diff) => <li key={diff.id}>{diff.worktreeLabel || diff.headRef} · {diff.state}</li>)}</ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
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
  onJoinOrganization,
  canManage,
  onReadBoard,
  onOpenTask,
  onCloseTask,
  onCreateTask,
  onClaimTask,
  onAckTask,
  onTransitionTask,
  onCompleteTask,
  onCancelTask,
  onCommentTask,
  onManageModules,
  onHide,
}: GroupsStageProps) {
  const [taskState, setTaskState] = useState<DeskTaskState>("open");
  const [composerOpen, setComposerOpen] = useState(false);
  useEffect(() => setComposerOpen(false), [state.selectedProfileId]);
  const organizations = directory.organizations;
  const selectedOrganization = organizationFor(organizations, state.selectedProfileId);
  const selectedDesk = deskFor(directory.desk?.connections, state.selectedProfileId);
  const selectedSnapshot = state.selectedProfileId
    && owns(state.snapshotsByProfile, state.selectedProfileId)
    ? state.snapshotsByProfile[state.selectedProfileId]
    : undefined;

  useEffect(() => {
    if (!shouldAutoReadDeskBoard(
      directory.phase,
      selectedOrganization?.id,
      Boolean(selectedDesk?.configured),
      selectedSnapshot?.phase,
    )) return;
    onReadBoard(selectedOrganization!.id, taskState);
  }, [
    directory.phase,
    onReadBoard,
    selectedDesk?.configured,
    selectedOrganization?.id,
    selectedSnapshot?.phase,
    taskState,
  ]);

  if (directory.phase === "unsupported") {
    return <GroupsPreview copy={copy} onManage={onManageModules} onHide={onHide} />;
  }

  const openTaskOrganization = organizationFor(organizations, state.openTask?.profileId);
  const openTaskDesk = deskFor(directory.desk?.connections, state.openTask?.profileId);
  if (state.openTask && openTaskOrganization && openTaskDesk?.configured) {
    const key = groupsTaskKey(state.openTask.profileId, state.openTask.taskId);
    const details = state.tasksByKey[key];
    const openTaskSnapshot = owns(state.snapshotsByProfile, state.openTask.profileId)
      ? state.snapshotsByProfile[state.openTask.profileId]?.data
      : undefined;
    const profileId = state.openTask.profileId;
    const taskId = state.openTask.taskId;
    return (
      <TaskDossier
        copy={copy}
        organization={openTaskOrganization}
        actor={openTaskSnapshot?.me}
        canManage={canManage}
        details={details?.data}
        phase={details?.phase ?? "idle"}
        error={details?.error}
        onBack={onCloseTask}
        onRetry={() => onOpenTask(profileId, taskId)}
        onRefresh={() => {
          onOpenTask(profileId, taskId);
          onReadBoard(profileId, taskState);
        }}
        onClaim={(id) => onClaimTask(profileId, id)}
        onAck={(id) => onAckTask(profileId, id)}
        onTransition={(id, input) => onTransitionTask(profileId, id, input)}
        onComplete={(id, input) => onCompleteTask(profileId, id, input)}
        onCancel={(id, detail, claimFence) => onCancelTask(profileId, id, detail, claimFence)}
        onComment={(id, body) => onCommentTask(profileId, id, body)}
      />
    );
  }

  return (
    <main className="groups-stage groups-board-stage" aria-labelledby="groups-board-title">
      <div className="groups-stage-grid" aria-hidden />
      <div className="groups-stage-shell">
        <header className="groups-stage-head groups-board-head">
          <div>
            <span className="groups-eyebrow">ORGANIZATION WORKBENCH / DESK</span>
            <h1 id="groups-board-title">
              {selectedOrganization?.label ?? copy.organizationTitle}
            </h1>
            <p>{copy.organizationHint}</p>
          </div>
          <div className="groups-board-actions">
            <span className="groups-local-seal">{canManage ? copy.managed : copy.readOnly}</span>
            {canManage && selectedOrganization && selectedDesk?.configured ? (
              <button type="button" onClick={() => setComposerOpen((current) => !current)}>
                {composerOpen ? copy.backToBoard : `＋ ${copy.createWork}`}
              </button>
            ) : null}
          </div>
        </header>

        {composerOpen && selectedOrganization && selectedDesk?.configured ? (
          <TaskComposer
            copy={copy}
            profileId={selectedOrganization.id}
            onCreate={onCreateTask}
            onClose={() => setComposerOpen(false)}
            onCreated={(result) => {
              setComposerOpen(false);
              onReadBoard(selectedOrganization.id, taskState);
              onOpenTask(selectedOrganization.id, result.task.id);
            }}
          />
        ) : null}

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
            <button type="button" onClick={onJoinOrganization}>{copy.joinOrganization}</button>
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
            <span className="groups-empty-index">02 / DESK SYNC</span>
            <h2>{copy.readyTitle}</h2>
            <p>{copy.readyHint}</p>
            <div className="groups-state-picker" role="group" aria-label={copy.tasksMetric}>
              {DESK_TASK_STATES.map((value) => (
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
                {DESK_TASK_STATES.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={taskState === value ? "is-active" : ""}
                    aria-pressed={taskState === value}
                    onClick={() => {
                      setTaskState(value);
                      onReadBoard(selectedOrganization.id, value);
                    }}
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
            {!canManage ? <p className="groups-manager-note">{copy.manageUnavailable}</p> : null}
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
