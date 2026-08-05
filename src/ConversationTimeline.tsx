import { useMemo, type RefObject } from "react";
import type { TaskLifecycleEvent } from "./client";
import { countExecutionDetails, groupConversationItems } from "./execution-presentation";
import type { Key } from "./i18n";
import { Md } from "./markdown";

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
      answered?: ApprovalResolution;
    };

interface ConversationTimelineProps {
  items: ConversationItem[];
  busy: boolean;
  taskState?: TaskLifecycleEvent;
  bottomRef: RefObject<HTMLDivElement | null>;
  t: (key: Key) => string;
  onRewind: (itemIndex: number) => void;
  onApproval: (approvalId: string, verdict: ApprovalVerdict) => void;
}

/** Pure projection of one session transcript. Runtime state and routing stay outside this component. */
export function ConversationTimeline({
  items,
  busy,
  taskState,
  bottomRef,
  t,
  onRewind,
  onApproval,
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
  const blocker = visibleTask?.checkpoint.blockReason || (
    visibleTask?.state === "blocked" || visibleTask?.state === "paused"
      ? visibleTask.detail
      : undefined
  );
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
            {visibleTask.checkpoint.current || visibleTask.brief?.goal || visibleTask.objective}
          </div>
          {visibleTask.checkpoint.total > 0 && (
            <progress
              aria-label={t("taskProgress")}
              max={visibleTask.checkpoint.total}
              value={Math.min(visibleTask.checkpoint.done, visibleTask.checkpoint.total)}
            />
          )}
          {blocker && (
            <div className="task-progress-detail">
              <span>{t("taskBlockReason")}</span>
              {visibleTask.checkpoint.blockedStep && <strong>{visibleTask.checkpoint.blockedStep}</strong>}
              <div>{blocker}</div>
            </div>
          )}
          {(visibleTask.state === "blocked" || visibleTask.state === "paused") && visibleTask.checkpoint.nextStep && (
            <div className="task-progress-next">
              <span>{t("taskNextStep")}</span>
              {visibleTask.checkpoint.nextStep}
            </div>
          )}
        </section>
      )}
      <div className="scroll">
        {segments.map((segment) => {
          if (segment.kind === "execution") {
            const counts = countExecutionDetails(segment.items);
            const summary = [
              counts.tools > 0 ? `${counts.tools} ${t("executionTools")}` : "",
              counts.changes > 0 ? `${counts.changes} ${t("executionChanges")}` : "",
            ].filter(Boolean).join(" · ");
            return (
              <details className="execution-log" key={`execution-${segment.items[0]?.index ?? 0}`}>
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
              return (
                <div key={index} className="usage dim">
                  · {item.usage.input}→{item.usage.output} {t("tokens")} ·
                </div>
              );
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
                      <button
                        className="ghost"
                        onClick={() => onApproval(item.approvalId, "always")}
                      >
                        {t("always")}
                      </button>
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
                {toolCount > 0 && ` · ⚙${toolCount}`}
                {diffCount > 0 && ` · ±${diffCount}`}
              </div>
            );
          })()}
        <div ref={bottomRef} />
      </div>
    </>
  );
}
