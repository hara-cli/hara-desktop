import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AgentCreationApproval, ModelUsage, TaskApprovalOffer, TaskLifecycleEvent } from "./client";
import { approvalRequestExpired, createTaskApprovalSubmission, offeredTaskApproval } from "./task-approval-state";
import {
  countExecutionDetails,
  groupConversationItems,
} from "./execution-presentation";
import {
  executionViewExpandsLog,
  executionViewShowsLog,
  executionViewShowsUsage,
  type ExecutionViewMode,
} from "./execution-view";
import type { Key } from "./i18n";
import { AssistantMessage } from "./AssistantMessage";
import { userVisibleTaskText } from "./user-visible-text";
import { authenticationPausePresentation } from "./auth-recovery";
import { IconCog } from "./icons";
import { knownManualActionHintKeys } from "./task-manual-action";
import { copyTextToClipboard } from "./clipboard";
import { DecisionCard } from "./DecisionCard";
import { decisionCardIdentity } from "./decision-card-identity";
import { taskProgressStopExplanation } from "./task-progress-presentation";

type TaskDependencyKind = NonNullable<
  NonNullable<TaskLifecycleEvent["checkpoint"]["completion"]>["dependency"]
>["kind"];

const TASK_DEPENDENCY_LABELS: Record<TaskDependencyKind, Key> = {
  missing_secret: "taskDependencyMissingSecret",
  missing_authority: "taskDependencyMissingAuthority",
  physical_action: "taskDependencyPhysicalAction",
  material_choice: "taskDependencyMaterialChoice",
  external_state: "taskDependencyExternalState",
  destructive_confirmation: "taskDependencyDestructiveConfirmation",
};

export type ApprovalVerdict = "allow" | "always" | "deny" | "task";
export type ApprovalResolution = ApprovalVerdict | "expired";

const APPROVAL_STATUS_KEYS: Record<ApprovalResolution, Key> = {
  allow: "approvalAllowedOnce",
  always: "approvalAlwaysAllowed",
  deny: "approvalDenied",
  expired: "expired",
  task: "approvalTaskAccepted",
};

const EXECUTION_TOOL_LABEL_KEYS: Partial<Record<string, Key>> = {
  task_intake: "executionActionUnderstand",
  task_checkpoint: "executionActionCheckpoint",
  todo_write: "executionActionTodo",
  agent_contact: "executionActionContact",
  agent_create: "executionActionCreateAgent",
};

export function ApprovalCard({
  approvalId,
  question,
  allowAlways,
  answered,
  presentation,
  taskApproval,
  allowForTask,
  expiresAt,
  taskApprovalCommandId,
  taskApprovalSupported,
  sessionId,
  disabled = false,
  t,
  onApproval,
}: {
  approvalId: string;
  question: string;
  allowAlways?: boolean;
  answered?: ApprovalResolution;
  presentation?: AgentCreationApproval;
  taskApproval?: TaskApprovalOffer;
  allowForTask?: boolean;
  expiresAt?: string;
  taskApprovalCommandId?: string;
  taskApprovalSupported: boolean;
  sessionId?: string;
  disabled?: boolean;
  t: (key: Key) => string;
  onApproval: (approvalId: string, verdict: ApprovalVerdict, commandId?: string, sessionId?: string) => Promise<void>;
}) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [taskSubmission] = useState(() => createTaskApprovalSubmission(() => crypto.randomUUID(), taskApprovalCommandId));
  const requestExpired = approvalRequestExpired(expiresAt, now);
  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(expiresAt) - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const resolution = answered ?? (requestExpired ? "expired" : undefined);
  const proposal = presentation?.kind === "agent-create" ? presentation : undefined;
  const taskChoice = offeredTaskApproval({ taskApproval, allowForTask, expiresAt, presentation }, taskApprovalSupported && !!sessionId, now);
  const submit = async (verdict: ApprovalVerdict): Promise<void> => {
    if (disabled || answered || locked.current) return;
    if ((taskApprovalCommandId || !taskSubmission.canChoose(verdict)) && verdict !== "task") return;
    if (approvalRequestExpired(expiresAt) || (verdict === "task" && (!taskChoice || taskSubmission.isLocked()))) return;
    locked.current = true;
    setPending(true);
    setFailed(false);
    try {
      if (verdict === "task") {
        await taskSubmission.submit((commandId) => onApproval(approvalId, verdict, commandId, sessionId));
      } else {
        await onApproval(approvalId, verdict, undefined, sessionId);
      }
    } catch {
      locked.current = false;
      setPending(false);
      setFailed(true);
    }
  };
  const approved = resolution === "allow" || resolution === "always" || resolution === "task";
  const title = resolution
    ? approved ? t(proposal ? "agentCreateApproved" : "approvalActionApproved") : t("approvalActionClosed")
    : t(proposal ? "agentCreateTitle" : "approvalTitle");
  return (
    <section className={`appr approval-card${resolution ? " done" : ""}${approved ? " approved" : ""}`}>
      <header className="approval-card-head">
        <strong>{title}</strong>
        <span className={`approval-status${approved ? " approved" : ""}`}>
          <i aria-hidden />
          {resolution ? t(APPROVAL_STATUS_KEYS[resolution]) : t("approvalPending")}
        </span>
      </header>
      {proposal ? (
        <div className="agent-create-proposal">
          <dl>
            <div><dt>{t("agentCreateName")}</dt><dd>{proposal.name} <small>@{proposal.username}</small></dd></div>
            <div><dt>{t("agentCreateRole")}</dt><dd>{proposal.role}</dd></div>
          </dl>
          <p>{proposal.description}</p>
          <strong>{t("agentCreateInstructions")}</strong>
          <pre>{proposal.instructions}</pre>
        </div>
      ) : (
        <>
          <p className="approval-card-summary">{question}</p>
          <details className="approval-card-details">
            <summary>{t("approvalViewRequest")}</summary>
            <pre>{question}</pre>
          </details>
        </>
      )}
      {!resolution ? (
        <>
          <p className="approval-card-scope">{t(proposal ? "agentCreateScope" : "approvalScopeHint")}</p>
          {taskChoice ? <div className="task-approval-offer"><p>{t(taskApproval!.toolFamily === "bash" ? "taskApprovalBash" : taskApproval!.toolFamily === "python" ? "taskApprovalPython" : "taskApprovalFiles")} · {taskApproval!.summary}</p><small>{t("approvalTaskScope")}</small></div> : null}
          <div className="approval-card-actions">
            <button disabled={disabled || pending || !!taskApprovalCommandId || taskSubmission.hasAttempted()} aria-busy={pending} onClick={() => void submit("allow")}>
              {t(proposal ? "agentCreateConfirm" : "allow")}
            </button>
            {taskChoice ? (
              <button type="button" disabled={disabled || pending} className="ghost task-approval-choice" onClick={() => void submit("task")}>
                {t("approvalForTask")}
              </button>
            ) : null}
            {!proposal && allowAlways !== false ? (
              <button disabled={disabled || pending || !!taskApprovalCommandId || taskSubmission.hasAttempted()} className="ghost" onClick={() => void submit("always")}>
                {t("always")}
              </button>
            ) : null}
            <button disabled={disabled || pending || !!taskApprovalCommandId || taskSubmission.hasAttempted()} className="deny" onClick={() => void submit("deny")}>
              {t(proposal ? "agentCreateDecline" : "deny")}
            </button>
          </div>
          {failed ? <p role="alert" className="approval-card-scope">{t(taskSubmission.hasAttempted() ? "approvalTaskRetry" : "approvalSubmissionFailed")}</p> : null}
        </>
      ) : null}
    </section>
  );
}

export type ConversationItem =
  | {
      kind: "user";
      text: string;
      attachments?: {
        kind: "image" | "file" | "directory";
        name: string;
        strategy?: string;
      }[];
      /** Present only while a locally displayed message has not been accepted by hara serve. */
      pendingId?: string;
    }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; preview: string }
  | { kind: "notice"; text: string }
  | { kind: "output"; text: string; lines: number }
  | { kind: "diff"; text: string }
  | { kind: "end"; usage: ModelUsage }
  | {
      kind: "approval";
      approvalId: string;
      question: string;
      allowAlways?: boolean;
      answered?: ApprovalResolution;
      presentation?: AgentCreationApproval;
      taskApproval?: TaskApprovalOffer;
      /** Local-only retry identity; never an authority or part of history/model context. */
      taskApprovalCommandId?: string;
      allowForTask?: boolean;
      expiresAt?: string;
    };

interface ConversationTimelineProps {
  items: ConversationItem[];
  busy: boolean;
  assistantName?: string;
  taskState?: TaskLifecycleEvent;
  sessionId?: string;
  taskApprovalSupported?: boolean;
  displayMode: ExecutionViewMode;
  bottomRef: RefObject<HTMLDivElement | null>;
  interactionCards?: ReactNode;
  t: (key: Key) => string;
  onRewind: (itemIndex: number) => void;
  onApproval: (approvalId: string, verdict: ApprovalVerdict, commandId?: string, sessionId?: string) => Promise<void>;
  onContinueTask?: (instruction?: string) => void;
  onDecision?: (option: string) => Promise<void>;
}

function TaskProgressTelemetry({
  progress,
  t,
}: {
  progress: NonNullable<TaskLifecycleEvent["progress"]>;
  t: (key: Key) => string;
}) {
  const stateLabel = progress.state === "stopped"
    ? t("taskProgressStopped")
    : progress.state === "warning"
      ? t("taskProgressWarning")
      : undefined;
  return (
    <div className={`task-progress-telemetry is-${progress.state}`}>
      {stateLabel ? (
        <div className="task-progress-telemetry-state" role="status">
          <i aria-hidden="true" />
          <strong>{stateLabel}</strong>
          <span>{progress.checkpointStaleRounds} {t("taskProgressCheckpointStale")}</span>
        </div>
      ) : null}
      <div className="task-progress-metrics" aria-label={t("taskProgress")}>
        <span>
          <small>{t("taskProgressRound")}</small>
          <b>{progress.rounds}/{progress.maxRounds}</b>
        </span>
        <span>
          <small>{t("taskProgressActions")}</small>
          <b>{progress.toolCalls.toLocaleString()}</b>
        </span>
        <span title={t("modelIoTip")}>
          <small>{t("modelIo")}</small>
          <b>{progress.tokens.total.toLocaleString()}</b>
        </span>
        <span>
          <small>{t("taskProgressTodo")}</small>
          <b>{progress.todo.done}/{progress.todo.total}</b>
        </span>
      </div>
    </div>
  );
}

/** Pure projection of one session transcript. Runtime state and routing stay outside this component. */
export const ConversationTimeline = memo(function ConversationTimeline({
  items,
  busy,
  assistantName = "Hara",
  taskState,
  sessionId,
  taskApprovalSupported = false,
  displayMode,
  bottomRef,
  interactionCards,
  t,
  onRewind,
  onApproval,
  onContinueTask,
  onDecision,
}: ConversationTimelineProps) {
  const assistantInitials = Array.from(assistantName.trim() || "Hara")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase();
  const [copiedAction, setCopiedAction] = useState<"command" | "verify" | "resume" | null>(null);
  const visibleTask = taskState && taskState.state !== "completed" ? taskState : undefined;
  const taskLabel = visibleTask
    ? t(
        visibleTask.state === "waiting"
          ? "taskWaiting"
          : visibleTask.state === "paused"
            ? "taskPaused"
            : visibleTask.state === "blocked"
              ? "taskBlocked"
              : "taskRunning",
      )
    : "";
  const dependency = visibleTask?.checkpoint.completion?.state === "awaiting_user"
    ? visibleTask.checkpoint.completion.dependency
    : undefined;
  const dependencyLabel = dependency
    ? t(TASK_DEPENDENCY_LABELS[dependency.kind])
    : "";
  const decisionOptions = dependency?.kind === "material_choice"
    ? (dependency.options ?? []).map((option) => option.trim()).filter(Boolean).slice(0, 8)
    : [];
  const manualAction = dependency?.manualAction;
  useEffect(
    () => setCopiedAction(null),
    [visibleTask?.taskId, manualAction?.command, manualAction?.verifyCommand, manualAction?.resumePhrase],
  );
  const dependencyEvidence = dependency?.evidence[0]
    ? userVisibleTaskText(dependency.evidence[0], "")
    : "";
  const blockerSource = dependency?.detail || visibleTask?.checkpoint.blockReason || (
    visibleTask?.state === "blocked" || visibleTask?.state === "paused"
      ? visibleTask.detail
      : undefined
  );
  const blocker = blockerSource ? userVisibleTaskText(blockerSource, "") : "";
  const blockedStep = visibleTask?.checkpoint.blockedStep
    ? userVisibleTaskText(visibleTask.checkpoint.blockedStep, "")
    : "";
  const nextStep = visibleTask?.checkpoint.nextStep
    ? userVisibleTaskText(visibleTask.checkpoint.nextStep, "")
    : "";
  const authenticationPause = authenticationPausePresentation({
    dependencyKind: dependency?.kind,
    capability: dependency?.capability,
    detail: dependency?.detail,
    evidence: dependency?.evidence,
    blockReason: visibleTask?.checkpoint.blockReason || visibleTask?.detail,
    nextStep: visibleTask?.checkpoint.nextStep,
  });
  const taskCurrent = visibleTask
    ? userVisibleTaskText(
        visibleTask.checkpoint.current || visibleTask.brief?.goal || visibleTask.objective,
        taskLabel,
      )
    : "";
  const segments = useMemo(() => groupConversationItems(items), [items]);
  const copyAction = (kind: "command" | "verify" | "resume", value: string): void => {
    void copyTextToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopiedAction(kind);
      window.setTimeout(() => setCopiedAction((current) => current === kind ? null : current), 1_600);
    });
  };
  const manualCommand = manualAction?.command;
  const verifyCommand = manualAction?.verifyCommand;
  const resumePhrase = manualAction?.resumePhrase;
  const manualHints = manualAction?.hints ?? [];
  const knownHintKeys = knownManualActionHintKeys([
    dependency?.detail,
    ...(dependency?.evidence ?? []),
  ]);
  const manualActionCard = manualAction || knownHintKeys.length ? (
    <details className="task-manual-action">
      <summary>
        <span className="task-manual-summary-mark" aria-hidden="true">›</span>
        <strong>
          {manualCommand
            ? t("taskManualCommand")
            : verifyCommand
              ? t("taskVerifyCommand")
              : resumePhrase
                ? t("taskResumePhrase")
                : t("taskAuthenticationDetails")}
        </strong>
        <small>{t("showDetails")}</small>
      </summary>
      <div className="task-manual-action-body">
        {manualCommand ? (
          <div className="task-manual-command">
            <div>
              <strong>{t("taskManualCommand")}</strong>
              <small>{t("taskManualCommandSafe")}</small>
            </div>
            <pre><code>{manualCommand}</code></pre>
            <button type="button" onClick={() => copyAction("command", manualCommand)}>
              {copiedAction === "command" ? t("taskCopied") : t("taskCopyCommand")}
            </button>
          </div>
        ) : null}
        {verifyCommand ? (
          <div className="task-manual-command is-verification">
            <div>
              <strong>{t("taskVerifyCommand")}</strong>
              <small>{t("taskVerifyCommandSafe")}</small>
            </div>
            <pre><code>{verifyCommand}</code></pre>
            <button type="button" onClick={() => copyAction("verify", verifyCommand)}>
              {copiedAction === "verify" ? t("taskCopied") : t("taskCopyVerifyCommand")}
            </button>
          </div>
        ) : null}
        {manualHints.length || knownHintKeys.length ? (
          <div className="task-manual-hints">
            <span>{t("taskFlagHints")}</span>
            {manualHints.map((hint, index) => (
              <div key={`${hint.term}-${index}`}>
                <abbr title={hint.detail}><code>{hint.term}</code></abbr>
                <small>{hint.detail}</small>
              </div>
            ))}
            {knownHintKeys.map((key) => (
              <div className="task-manual-known-hint" key={key}>
                <span aria-hidden="true">!</span>
                <small>{t(key)}</small>
              </div>
            ))}
          </div>
        ) : null}
        {resumePhrase ? (
          <div className="task-resume-phrase">
            <span>{t("taskResumePhrase")}</span>
            <code>{resumePhrase}</code>
            <button type="button" onClick={() => copyAction("resume", resumePhrase)}>
              {copiedAction === "resume" ? t("taskCopied") : t("taskCopyPhrase")}
            </button>
            {onContinueTask && !authenticationPause ? (
              <button type="button" disabled={busy} onClick={() => onContinueTask(resumePhrase)}>
                {t("taskContinueWithPhrase")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  ) : null;

  const showActionableTask = !!visibleTask && (
    !!dependency
    || !!authenticationPause
    || visibleTask.state === "blocked"
    || visibleTask.state === "paused"
  );
  const taskProgressCard = decisionOptions.length > 0 && dependency && onDecision ? (
    <DecisionCard
      key={decisionCardIdentity(
        sessionId,
        visibleTask?.taskId,
        visibleTask?.turnId,
        dependency.detail,
        decisionOptions,
      )}
      question={blocker || dependency.detail}
      options={decisionOptions}
      busy={busy}
      t={t}
      onSelect={onDecision}
    />
  ) : showActionableTask && visibleTask ? (
    <section className={`task-progress ${visibleTask.state}`} aria-live="polite">
      <div className="task-progress-head">
        <strong>{taskLabel}</strong>
        {displayMode === "debug" && visibleTask.checkpoint.total > 0 && (
          <span>
            {visibleTask.checkpoint.done}/{visibleTask.checkpoint.total}
          </span>
        )}
      </div>
      {displayMode !== "concise" ? (
        <div className="task-progress-current">
          {taskCurrent}
        </div>
      ) : null}
      {displayMode === "debug" && visibleTask.checkpoint.total > 0 && (
        <progress
          aria-label={t("taskProgress")}
          max={visibleTask.checkpoint.total}
          value={Math.min(visibleTask.checkpoint.done, visibleTask.checkpoint.total)}
        />
      )}
      {displayMode === "debug" && visibleTask.progress
        ? <TaskProgressTelemetry progress={visibleTask.progress} t={t} />
        : null}
      {visibleTask.progress?.state === "stopped" ? (
        <div className="task-progress-stop-reason" role="status">
          <strong>{t("taskProgressStopReason")}</strong>
          <p>{taskProgressStopExplanation(visibleTask.progress, t)}</p>
          <small>{t("taskProgressStopRecovery")}</small>
        </div>
      ) : null}
      {authenticationPause ? (
        <div className="task-auth-recovery" role="status">
          <div className="task-auth-recovery-copy">
            <span>{t("taskUserDependency")}</span>
            <strong>{t("taskAuthenticationExpired")}</strong>
            <p>{t("taskAuthenticationPaused")}</p>
            {authenticationPause.capability ? (
              <small>
                {t("taskAuthenticationTarget").replace("{target}", authenticationPause.capability)}
              </small>
            ) : null}
          </div>
          <div className="task-auth-recovery-actions">
            {onContinueTask ? (
              <button type="button" disabled={busy} onClick={() => onContinueTask(resumePhrase)}>
                {t("taskAuthenticationContinue")}
              </button>
            ) : null}
            <details>
              <summary>{t("taskAuthenticationDetails")}</summary>
              <p>
                {t(authenticationPause.automaticRefreshFailed
                  ? "taskAuthenticationRefreshFailed"
                  : "taskAuthenticationRejected")}
              </p>
            </details>
          </div>
          {manualActionCard}
        </div>
      ) : blocker ? (
        <div className="task-progress-detail">
          <span>{dependency ? t("taskUserDependency") : t("taskBlockReason")}</span>
          {(dependencyLabel || blockedStep) && <strong>{dependencyLabel || blockedStep}</strong>}
          <div>{blocker}</div>
          {dependencyEvidence ? <small>{dependencyEvidence}</small> : null}
        </div>
      ) : null}
      {!authenticationPause && manualActionCard}
      {!authenticationPause && (visibleTask.state === "blocked" || visibleTask.state === "paused") && nextStep && (
        <div className="task-progress-next">
          <span>{t("taskNextStep")}</span>
          {nextStep}
        </div>
      )}
    </section>
  ) : null;

  return (
    <div className="scroll">
        {segments.map((segment) => {
          if (segment.kind === "execution") {
            if (!executionViewShowsLog(displayMode)) return null;
            const counts = countExecutionDetails(segment.items);
            const stepCount = counts.tools + counts.changes;
            const summary = `${stepCount} ${t(stepCount === 1 ? "executionStep" : "executionSteps")}`;
            return (
              <details
                className="execution-log"
                open={executionViewExpandsLog(displayMode) ? true : undefined}
                key={`execution-${displayMode}-${segment.items[0]?.index ?? 0}`}
              >
                <summary>
                  <strong>{t("executionDetails")}</strong>
                  {summary && <span>{summary}</span>}
                </summary>
                <div className="execution-log-body">
                  {segment.items.map(({ item, index }) => {
                    if (item.kind === "tool") {
                      const labelKey = EXECUTION_TOOL_LABEL_KEYS[item.name];
                      return (
                        <div key={index} className="tool">
                          <IconCog size={13} />
                          <strong>{labelKey ? t(labelKey) : t("executionAction")}</strong>
                          {displayMode === "debug" ? (
                            <code className="execution-tool-name">{item.name}</code>
                          ) : null}
                          {item.preview ? <span className="dim">{item.preview}</span> : null}
                        </div>
                      );
                    }
                    return item.kind === "diff" ? (
                      <pre key={index} className="diff">{item.text}</pre>
                    ) : null;
                  })}
                </div>
              </details>
            );
          }
          const { item, index } = segment;
          switch (item.kind) {
            case "user":
              return (
                <div key={index} className="msg user">
                  {item.text && <div className="user-message-text">{item.text}</div>}
                  {!!item.attachments?.length && (
                    <div className="message-attachments">
                      {item.attachments.map((attachment, attachmentIndex) => (
                        <span
                          key={`${attachment.kind}:${attachment.name}:${attachmentIndex}`}
                          className={`message-attachment ${attachment.kind}`}
                          title={attachment.strategy}
                        >
                          <span aria-hidden="true">
                            {attachment.kind === "image" ? "▧" : attachment.kind === "directory" ? "▱" : "▤"}
                          </span>
                          {attachment.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {!busy && !item.pendingId && (
                    <button
                      type="button"
                      className="rew"
                      title={t("rewindHere")}
                      onClick={() => onRewind(index)}
                      aria-label={t("rewindHere")}
                    >
                      ↺
                    </button>
                  )}
                </div>
              );
            case "text":
              return (
                <AssistantMessage key={index} text={item.text} t={t} author={assistantName} />
              );
            case "tool":
            case "diff":
              return null;
            case "notice":
              if (visibleTask?.progress?.state === "stopped"
                && (item.text.startsWith("⏸ agent paused") || item.text.startsWith("⏸ 任务已暂停"))) {
                return (
                  <details key={index} className="tool-output-log">
                    <summary><strong>{t("pauseDiagnostic")}</strong></summary>
                    <pre>{item.text}</pre>
                  </details>
                );
              }
              return (
                <div key={index} className="notice">
                  {item.text}
                </div>
              );
            case "output":
              return executionViewShowsLog(displayMode) ? (
                <details
                  key={`output-${index}`}
                  className="tool-output-log"
                  open={executionViewExpandsLog(displayMode) ? true : undefined}
                >
                  <summary>
                    <strong>{t("toolOutput")}</strong>
                    <span>{item.lines} {t("outputLines")}</span>
                  </summary>
                  <pre>{item.text}</pre>
                </details>
              ) : null;
            case "end":
              return executionViewShowsUsage(displayMode) ? (
                <div key={index} className="usage dim" title={t("modelIoTip")}>
                  · {t("modelIo")} · {t("modelInput")} {item.usage.input.toLocaleString()}
                  {" + "}{t("modelOutput")} {item.usage.output.toLocaleString()}
                  {item.usage.requests !== undefined
                    ? ` · ${item.usage.requests.toLocaleString()} ${t("modelRequests")}`
                    : ""}
                  {item.usage.lastInput !== undefined
                    ? ` · ${t("latestContext")} ${item.usage.lastInput.toLocaleString()}`
                    : ""}
                  {item.usage.cachedInput !== undefined
                    ? ` · ${t("cachedInput")} ${item.usage.cachedInput.toLocaleString()}`
                    : ""} ·
                </div>
              ) : null;
            case "approval":
              return (
                <ApprovalCard
                  key={item.approvalId}
                  approvalId={item.approvalId}
                  question={item.question}
                  allowAlways={item.allowAlways}
                  answered={item.answered}
                  presentation={item.presentation}
                  taskApproval={item.taskApproval}
                  allowForTask={item.allowForTask}
                  expiresAt={item.expiresAt}
                  taskApprovalCommandId={item.taskApprovalCommandId}
                  taskApprovalSupported={taskApprovalSupported}
                  sessionId={sessionId}
                  t={t}
                  onApproval={onApproval}
                />
              );
          }
        })}
        {taskProgressCard}
        {busy &&
          (() => {
            const lastUser = items.map((item) => item.kind).lastIndexOf("user");
            const tail = items.slice(lastUser + 1);
            const toolCount = tail.filter((item) => item.kind === "tool").length;
            const diffCount = tail.filter((item) => item.kind === "diff").length;
            return (
              <div className="busy" role="status" aria-live="polite">
                <span className="busy-agent-avatar" aria-hidden="true">{assistantInitials}</span>
                <span className="busy-agent-copy">
                  <strong>{assistantName}</strong>
                  <span>{t("working")}</span>
                </span>
                <span className="busy-typing" aria-hidden="true"><i /><i /><i /></span>
                {displayMode !== "concise" && toolCount > 0 && <span className="busy-tool-count"><IconCog size={12} />{toolCount}</span>}
                {displayMode !== "concise" && diffCount > 0 && <span className="busy-diff-count">±{diffCount}</span>}
              </div>
            );
          })()}
        {interactionCards}
        <div ref={bottomRef} />
    </div>
  );
});
