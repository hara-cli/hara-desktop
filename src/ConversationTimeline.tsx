import { useMemo, type RefObject } from "react";
import type { TaskLifecycleEvent } from "./client";
import {
  countExecutionDetails,
  executionToolNames,
  groupConversationItems,
} from "./execution-presentation";
import {
  executionViewExpandsLog,
  executionViewShowsLog,
  executionViewShowsUsage,
  type ExecutionViewMode,
} from "./execution-view";
import type { Key } from "./i18n";
import { Md } from "./markdown";
import { userVisibleTaskText } from "./user-visible-text";
import { authenticationPausePresentation } from "./auth-recovery";

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

export type ApprovalVerdict = "allow" | "always" | "deny";
export type ApprovalResolution = ApprovalVerdict | "expired";

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
  | { kind: "diff"; text: string }
  | { kind: "end"; usage: { input: number; output: number } }
  | {
      kind: "approval";
      approvalId: string;
      question: string;
      allowAlways?: boolean;
      answered?: ApprovalResolution;
    };

interface ConversationTimelineProps {
  items: ConversationItem[];
  busy: boolean;
  taskState?: TaskLifecycleEvent;
  displayMode: ExecutionViewMode;
  bottomRef: RefObject<HTMLDivElement | null>;
  t: (key: Key) => string;
  onRewind: (itemIndex: number) => void;
  onApproval: (approvalId: string, verdict: ApprovalVerdict) => void;
  onContinueTask?: () => void;
}

/** Pure projection of one session transcript. Runtime state and routing stay outside this component. */
export function ConversationTimeline({
  items,
  busy,
  taskState,
  displayMode,
  bottomRef,
  t,
  onRewind,
  onApproval,
  onContinueTask,
}: ConversationTimelineProps) {
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

  return (
    <>
      {visibleTask && (
        <section className={`task-progress ${visibleTask.state}`} aria-live="polite">
          <div className="task-progress-head">
            <strong>{taskLabel}</strong>
            {visibleTask.checkpoint.total > 0 && (
              <span>
                {visibleTask.checkpoint.done}/{visibleTask.checkpoint.total}
              </span>
            )}
          </div>
          <div className="task-progress-current">
            {taskCurrent}
          </div>
          {visibleTask.checkpoint.total > 0 && (
            <progress
              aria-label={t("taskProgress")}
              max={visibleTask.checkpoint.total}
              value={Math.min(visibleTask.checkpoint.done, visibleTask.checkpoint.total)}
            />
          )}
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
                  <button type="button" disabled={busy} onClick={onContinueTask}>
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
            </div>
          ) : blocker ? (
            <div className="task-progress-detail">
              <span>{dependency ? t("taskUserDependency") : t("taskBlockReason")}</span>
              {(dependencyLabel || blockedStep) && <strong>{dependencyLabel || blockedStep}</strong>}
              <div>{blocker}</div>
              {dependencyEvidence ? <small>{dependencyEvidence}</small> : null}
            </div>
          ) : null}
          {!authenticationPause && (visibleTask.state === "blocked" || visibleTask.state === "paused") && nextStep && (
            <div className="task-progress-next">
              <span>{t("taskNextStep")}</span>
              {nextStep}
            </div>
          )}
        </section>
      )}
      <div className="scroll">
        {segments.map((segment) => {
          if (segment.kind === "execution") {
            if (!executionViewShowsLog(displayMode)) return null;
            const counts = countExecutionDetails(segment.items);
            const tools = executionToolNames(segment.items);
            const summary = [
              counts.tools > 0 ? `${counts.tools} ${t("executionTools")}` : "",
              counts.changes > 0 ? `${counts.changes} ${t("executionChanges")}` : "",
              tools.length > 0 ? tools.join(" · ") : "",
            ].filter(Boolean).join(" · ");
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
                      return (
                        <div key={index} className="tool">
                          ⚙ {item.name} <span className="dim">{item.preview}</span>
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
                    <span
                      className="rew"
                      title={t("rewindHere")}
                      onClick={() => onRewind(index)}
                    >
                      ↺
                    </span>
                  )}
                </div>
              );
            case "text":
              return (
                <div key={index} className="msg assistant">
                  <Md text={item.text} />
                </div>
              );
            case "tool":
            case "diff":
              return null;
            case "notice":
              return (
                <div key={index} className="notice">
                  {item.text}
                </div>
              );
            case "end":
              return executionViewShowsUsage(displayMode) ? (
                <div key={index} className="usage dim">
                  · {item.usage.input}→{item.usage.output} {t("tokens")} ·
                </div>
              ) : null;
            case "approval":
              return (
                <div key={index} className={`appr ${item.answered ? "done" : ""}`}>
                  <div className="modal-title">{t("approvalTitle")}</div>
                  <div className="question">{item.question}</div>
                  {item.answered ? (
                    <div className="dim">{t(item.answered)}</div>
                  ) : (
                    <div className="row">
                      <button onClick={() => onApproval(item.approvalId, "allow")}>
                        {t("allow")}
                      </button>
                      {item.allowAlways !== false ? (
                        <button
                          className="ghost"
                          onClick={() => onApproval(item.approvalId, "always")}
                        >
                          {t("always")}
                        </button>
                      ) : null}
                      <button
                        className="deny"
                        onClick={() => onApproval(item.approvalId, "deny")}
                      >
                        {t("deny")}
                      </button>
                    </div>
                  )}
                </div>
              );
          }
        })}
        {busy &&
          (() => {
            const lastUser = items.map((item) => item.kind).lastIndexOf("user");
            const tail = items.slice(lastUser + 1);
            const toolCount = tail.filter((item) => item.kind === "tool").length;
            const diffCount = tail.filter((item) => item.kind === "diff").length;
            return (
              <div className="busy">
                {t("working")}
                {displayMode !== "concise" && toolCount > 0 && ` · ⚙${toolCount}`}
                {displayMode !== "concise" && diffCount > 0 && ` · ±${diffCount}`}
              </div>
            );
          })()}
        <div ref={bottomRef} />
      </div>
    </>
  );
}
