import type { RefObject } from "react";
import type { Key } from "./i18n";
import { Md } from "./markdown";

export type ApprovalVerdict = "allow" | "always" | "deny";
export type ApprovalResolution = ApprovalVerdict | "expired";

export type ConversationItem =
  | {
      kind: "user";
      text: string;
      /** Present only while a locally displayed message has not been accepted by hara serve. */
      pendingId?: string;
    }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
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
  temperament: "im" | "ide";
  bottomRef: RefObject<HTMLDivElement | null>;
  t: (key: Key) => string;
  onRewind: (itemIndex: number) => void;
  onApproval: (approvalId: string, verdict: ApprovalVerdict) => void;
}

/** Pure projection of one session transcript. Runtime state and routing stay outside this component. */
export function ConversationTimeline({
  items,
  busy,
  temperament,
  bottomRef,
  t,
  onRewind,
  onApproval,
}: ConversationTimelineProps) {
  return (
    <div className="scroll">
      {items.map((item, index) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={index} className="msg user">
                {item.text}
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
          case "reasoning":
            return (
              <details key={index} className="reasoning" open={temperament === "ide"}>
                <summary>{t("thinking")}</summary>
                {item.text}
              </details>
            );
          case "tool":
            return (
              <div key={index} className="tool">
                ⚙ {item.name} <span className="dim">{item.preview}</span>
              </div>
            );
          case "notice":
            return (
              <div key={index} className="notice">
                {item.text}
              </div>
            );
          case "diff":
            return (
              <pre key={index} className="diff">
                {item.text}
              </pre>
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
  );
}
