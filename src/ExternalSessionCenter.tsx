import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ExternalRuntimeAgentKind,
  ExternalSessionInfo,
  ExternalSessionMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceId,
  ExternalSessionSourceInfo,
  ExternalSessionSourceState,
  ExternalSessionState,
} from "./client";
import { IconBack, IconCommandLine, IconRefresh } from "./icons";
import "./ExternalSessionCenter.css";

export type ExternalSessionActivity =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; name: string; text: string }
  | { id: string; kind: "notice"; text: string };

export interface ExternalSessionApproval {
  approvalId: string;
  question: string;
  allowAlways: boolean;
}

export interface ExternalSessionCenterCopy {
  eyebrow: string;
  title: string;
  description: string;
  refresh: string;
  refreshing: string;
  unavailableTitle: string;
  unavailableBody: string;
  sources: string;
  sessions: string;
  safeBridge: string;
  metadataOnly: string;
  personalOnly: string;
  resumeFirst: string;
  metadataOnlyBody: string;
  personalOnlyBody: string;
  resumeFirstBody: string;
  selectedEyebrow: string;
  workspace: string;
  source: string;
  origin: string;
  updated: string;
  state: string;
  protectionTitle: string;
  protectionBody: string;
  nextStage: string;
  nextStageBody: string;
  noSelectionTitle: string;
  noSelectionBody: string;
  back: string;
  transcript: string;
  loadingTranscript: string;
  noMessages: string;
  readOnlyTitle: string;
  readOnlyBody: string;
  writableTitle: string;
  writableBody: string;
  liveTitle: string;
  liveBody: string;
  followUpTitle: string;
  followUpBody: string;
  waitTitle: string;
  waitBody: string;
  followUpPlaceholder: string;
  followUpSend: string;
  modeHistory: string;
  modeManaged: string;
  modeLive: string;
  resume: string;
  resuming: string;
  composerPlaceholder: string;
  send: string;
  stop: string;
  approve: string;
  alwaysApprove: string;
  deny: string;
  you: string;
  assistant: string;
  system: string;
  runtimeTitle: string;
  runtimeBody: string;
  runtimeCodex: string;
  runtimeClaude: string;
  runtimeCreating: string;
  sourceStates: Record<ExternalSessionSourceState, string>;
  sessionStates: Record<ExternalSessionState, string>;
}

interface ExternalSessionCenterProps {
  sources: ExternalSessionSourceInfo[] | null;
  sessions: ExternalSessionInfo[];
  selected?: ExternalSessionInfo;
  selectedSourceId: ExternalSessionSourceId;
  transcript: ExternalSessionReadResult | null;
  activity: ExternalSessionActivity[];
  approval: ExternalSessionApproval | null;
  loading: boolean;
  transcriptLoading: boolean;
  actionBusy: "" | "resume" | "turn" | "interrupt";
  creatingKind: ExternalRuntimeAgentKind | null;
  error: string;
  actionError: string;
  personal: boolean;
  locale: "en" | "zh";
  copy: ExternalSessionCenterCopy;
  onRefresh: () => void;
  onBack: () => void;
  onSelectSource: (sourceId: ExternalSessionSourceId) => void;
  onCreate: (agentKind: ExternalRuntimeAgentKind) => Promise<void>;
  onResume: () => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
  onSteer: (text: string) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onApproval: (verdict: "deny" | "allow" | "always") => Promise<void>;
}

const sourceMark = (sourceId: ExternalSessionInfo["sourceId"]): string => (
  sourceId === "runtime" ? "HR" : sourceId === "codex" ? "CX" : "CL"
);

const sourceDisplayName = (session: ExternalSessionInfo): string => (
  session.sourceId === "runtime"
    ? `Hara Live · ${session.agentKind === "claude" ? "Claude Code" : "Codex"}`
    : session.sourceId === "codex" ? "Codex" : "Claude Code"
);

const roleLabel = (role: ExternalSessionMessage["role"], copy: ExternalSessionCenterCopy): string => (
  role === "user" ? copy.you : role === "assistant" ? copy.assistant : copy.system
);

export default function ExternalSessionCenter({
  sources,
  sessions,
  selected,
  selectedSourceId,
  transcript,
  activity,
  approval,
  loading,
  transcriptLoading,
  actionBusy,
  creatingKind,
  error,
  actionError,
  personal,
  locale,
  copy,
  onRefresh,
  onBack,
  onSelectSource,
  onCreate,
  onResume,
  onSubmit,
  onSteer,
  onInterrupt,
  onApproval,
}: ExternalSessionCenterProps) {
  const [draft, setDraft] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(""), [selected?.id]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [activity.length, approval?.approvalId, selected?.id, transcript?.messages.length]);

  const activeSource = sources?.find((source) => source.id === selected?.sourceId);
  const runtimeSource = sources?.find((source) => source.id === "runtime");
  const running = actionBusy === "turn";
  const canSteer = activeSource?.capabilities.steer === true;
  const canSendFollowUp = running && canSteer;
  const composerBlocked = Boolean(approval) || (Boolean(actionBusy) && !canSendFollowUp);
  const controlMode = transcript?.controlMode ?? (transcript?.readOnly ? "history" : "managed");
  const modeLabel = controlMode === "live"
    ? copy.modeLive
    : controlMode === "managed" ? copy.modeManaged : copy.modeHistory;
  const composerTitle = running
    ? (canSteer ? copy.followUpTitle : copy.waitTitle)
    : controlMode === "live" ? copy.liveTitle : copy.writableTitle;
  const composerBody = running
    ? (canSteer ? copy.followUpBody : copy.waitBody)
    : controlMode === "live" ? copy.liveBody : copy.writableBody;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || composerBlocked) return;
    setDraft("");
    const send = canSendFollowUp ? onSteer : onSubmit;
    void send(text).catch(() => setDraft((current) => current || text));
  };

  if (!personal) {
    return (
      <main className="external-session-center is-locked">
        <section className="external-session-lock" aria-labelledby="external-session-lock-title">
          <span className="external-session-lock-mark" aria-hidden><IconCommandLine size={25} /></span>
          <p>{copy.eyebrow}</p>
          <h1 id="external-session-lock-title">{copy.unavailableTitle}</h1>
          <div>{copy.unavailableBody}</div>
        </section>
      </main>
    );
  }

  const readySources = sources?.filter((source) => source.state === "ready").length ?? 0;
  return (
    <main className="external-session-center">
      <div className="external-session-frame">
        <header className="external-session-topbar">
          <div>
            <p>{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
            <span>{copy.description}</span>
          </div>
          <button type="button" className="external-session-refresh" onClick={onRefresh} disabled={loading || Boolean(actionBusy)}>
            <span aria-hidden className={loading ? "is-spinning" : ""}><IconRefresh size={15} /></span>
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </header>

        <section className="external-session-controlbar" aria-label={copy.safeBridge}>
          <div className="external-session-counts">
            <span><b>{String(readySources).padStart(2, "0")}</b>{copy.sources}</span>
            <span><b>{String(sessions.length).padStart(2, "0")}</b>{copy.sessions}</span>
          </div>
          <div className="external-source-switcher" aria-label={copy.sources}>
            {(sources ?? []).map((source) => (
              <button
                type="button"
                className={`external-source-tab is-${source.state}${selectedSourceId === source.id ? " is-selected" : ""}`}
                key={source.id}
                onClick={() => onSelectSource(source.id)}
                disabled={loading || source.state !== "ready"}
                aria-pressed={selectedSourceId === source.id}
              >
                <span className={`external-source-logo is-${source.id}`} aria-hidden>{sourceMark(source.id)}</span>
                <span><strong>{source.label}</strong><small>{copy.sourceStates[source.state]}</small></span>
                <em>{source.capabilities.observeLive ? copy.modeLive : copy.modeHistory}</em>
              </button>
            ))}
          </div>
          <span className="external-session-seal"><i aria-hidden />{copy.safeBridge}</span>
        </section>

        {error ? <div className="external-session-error" role="alert">{error}</div> : null}

        {selectedSourceId === "runtime" && runtimeSource?.capabilities.create ? (
          <section className="external-runtime-launcher" aria-labelledby="external-runtime-launcher-title">
            <div>
              <span className="external-source-logo is-runtime" aria-hidden>HR</span>
              <span>
                <strong id="external-runtime-launcher-title">{copy.runtimeTitle}</strong>
                <small>{copy.runtimeBody}</small>
              </span>
            </div>
            <div>
              <button
                type="button"
                className="is-primary"
                disabled={Boolean(creatingKind) || Boolean(actionBusy)}
                onClick={() => void onCreate("codex")}
              >
                {creatingKind === "codex" ? copy.runtimeCreating : copy.runtimeCodex}
              </button>
              <button
                type="button"
                disabled={Boolean(creatingKind) || Boolean(actionBusy)}
                onClick={() => void onCreate("claude")}
              >
                {creatingKind === "claude" ? copy.runtimeCreating : copy.runtimeClaude}
              </button>
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className="external-session-shell" aria-labelledby="external-session-selected-title">
            <header className="external-session-heading">
              <button type="button" className="external-session-back" onClick={onBack} aria-label={copy.back}>
                <IconBack size={17} />
              </button>
              <span className={`external-source-logo is-${selected.sourceId}`} aria-hidden>{sourceMark(selected.sourceId)}</span>
              <div>
                <p>{copy.selectedEyebrow}</p>
                <h2 id="external-session-selected-title">{selected.title}</h2>
                <span>{selected.workspaceName}</span>
              </div>
              <div className="external-session-chips">
                {transcript ? <b className={`external-session-mode is-${controlMode}`}>{modeLabel}</b> : null}
                <b className={`external-session-state is-${selected.state}`}>{copy.sessionStates[selected.state]}</b>
              </div>
            </header>

            <div className="external-session-layout">
              <section className="external-session-conversation" aria-label={copy.transcript}>
                <header><strong>{copy.transcript}</strong><span>{sourceDisplayName(selected)}</span></header>
                <div className="external-session-timeline" ref={timelineRef} aria-live="polite">
                  {transcriptLoading ? <p className="external-session-empty">{copy.loadingTranscript}</p> : null}
                  {!transcriptLoading && transcript?.messages.length === 0 && activity.length === 0
                    ? <p className="external-session-empty">{copy.noMessages}</p>
                    : null}
                  {transcript?.messages.map((message) => (
                    <article className={`external-session-message is-${message.role}`} key={message.id}>
                      <span>{roleLabel(message.role, copy)}</span>
                      <p>{message.text}</p>
                    </article>
                  ))}
                  {activity.map((item) => item.kind === "text" || item.kind === "user" ? (
                    <article className={`external-session-message is-${item.kind === "user" ? "user" : "assistant"}${item.kind === "text" ? " is-live" : ""}`} key={item.id}>
                      <span>{item.kind === "user" ? copy.you : copy.assistant}</span><p>{item.text}</p>
                    </article>
                  ) : item.kind === "tool" ? (
                    <details className="external-session-activity is-tool" key={item.id}>
                      <summary><span>{item.name}</span><b>{item.text.slice(0, 90)}</b></summary>
                      <p>{item.text}</p>
                    </details>
                  ) : (
                    <article className="external-session-activity is-notice" key={item.id}>
                      <span>{copy.system}</span><p>{item.text}</p>
                    </article>
                  ))}
                </div>

                {approval ? (
                  <section className="external-session-approval" aria-label={approval.question}>
                    <strong>{approval.question}</strong>
                    <div>
                      <button type="button" onClick={() => void onApproval("deny")}>{copy.deny}</button>
                      <button type="button" onClick={() => void onApproval("allow")}>{copy.approve}</button>
                      {approval.allowAlways
                        ? <button type="button" className="is-primary" onClick={() => void onApproval("always")}>{copy.alwaysApprove}</button>
                        : null}
                    </div>
                  </section>
                ) : null}

                {actionError ? <div className="external-session-error is-inline" role="alert">{actionError}</div> : null}
                {transcript?.readOnly ? (
                  <div className="external-session-continuation is-read-only">
                    <div><strong>{copy.readOnlyTitle}</strong><p>{copy.readOnlyBody}</p></div>
                    <button type="button" className="is-primary" disabled={Boolean(actionBusy)} onClick={() => void onResume()}>
                      {actionBusy === "resume" ? copy.resuming : copy.resume}
                    </button>
                  </div>
                ) : transcript ? (
                  <form className={`external-session-composer is-${controlMode}${running ? " is-running" : ""}`} onSubmit={submit}>
                    <label><span>{composerTitle}</span><small>{composerBody}</small></label>
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                      placeholder={canSendFollowUp ? copy.followUpPlaceholder : copy.composerPlaceholder}
                      disabled={composerBlocked}
                      rows={3}
                    />
                    <div>
                      {running || approval || actionBusy === "interrupt"
                        ? <button type="button" onClick={() => void onInterrupt()} disabled={actionBusy === "interrupt"}>{copy.stop}</button>
                        : null}
                      <button type="submit" className="is-primary" disabled={!draft.trim() || composerBlocked}>
                        {canSendFollowUp ? copy.followUpSend : copy.send}
                      </button>
                    </div>
                  </form>
                ) : null}
              </section>

              <aside className="external-session-inspector">
                <dl className="external-session-facts">
                  <div><dt>{copy.workspace}</dt><dd>{selected.workspaceName}</dd></div>
                  <div><dt>{copy.source}</dt><dd>{sourceDisplayName(selected)}</dd></div>
                  <div><dt>{copy.origin}</dt><dd>{selected.origin ?? "—"}</dd></div>
                  <div><dt>{copy.updated}</dt><dd>{new Date(selected.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}</dd></div>
                  <div><dt>{copy.state}</dt><dd>{copy.sessionStates[selected.state]}</dd></div>
                </dl>
                <div className="external-session-policy-grid">
                  <article><span aria-hidden>01</span><strong>{copy.protectionTitle}</strong><p>{copy.protectionBody}</p></article>
                  <article><span aria-hidden>02</span><strong>{copy.nextStage}</strong><p>{copy.nextStageBody}</p></article>
                </div>
              </aside>
            </div>
          </section>
        ) : (
          <section className="external-session-overview" aria-labelledby="external-session-overview-title">
            <div className="external-session-overview-title">
              <span aria-hidden><IconCommandLine size={26} /></span>
              <div><h2 id="external-session-overview-title">{copy.noSelectionTitle}</h2><p>{copy.noSelectionBody}</p></div>
            </div>
            <div className="external-session-principles">
              <article><b>01</b><strong>{copy.metadataOnly}</strong><p>{copy.metadataOnlyBody}</p></article>
              <article><b>02</b><strong>{copy.personalOnly}</strong><p>{copy.personalOnlyBody}</p></article>
              <article><b>03</b><strong>{copy.resumeFirst}</strong><p>{copy.resumeFirstBody}</p></article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
