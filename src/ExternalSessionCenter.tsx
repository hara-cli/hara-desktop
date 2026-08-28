import { useEffect, useState, type FormEvent } from "react";
import type {
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
  forkFirst: string;
  metadataOnlyBody: string;
  personalOnlyBody: string;
  forkFirstBody: string;
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
  fork: string;
  forking: string;
  composerPlaceholder: string;
  send: string;
  stop: string;
  approve: string;
  alwaysApprove: string;
  deny: string;
  you: string;
  assistant: string;
  system: string;
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
  actionBusy: "" | "fork" | "turn" | "interrupt";
  error: string;
  actionError: string;
  personal: boolean;
  locale: "en" | "zh";
  copy: ExternalSessionCenterCopy;
  onRefresh: () => void;
  onBack: () => void;
  onSelectSource: (sourceId: ExternalSessionSourceId) => void;
  onFork: () => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onApproval: (verdict: "deny" | "allow" | "always") => Promise<void>;
}

const sourceMark = (sourceId: ExternalSessionInfo["sourceId"]): string => (
  sourceId === "codex" ? "CX" : "CL"
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
  error,
  actionError,
  personal,
  locale,
  copy,
  onRefresh,
  onBack,
  onSelectSource,
  onFork,
  onSubmit,
  onInterrupt,
  onApproval,
}: ExternalSessionCenterProps) {
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(""), [selected?.id]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || actionBusy) return;
    setDraft("");
    void onSubmit(text).catch(() => setDraft(text));
  };

  if (!personal) {
    return (
      <main className="external-session-center is-locked">
        <section className="external-session-lock" aria-labelledby="external-session-lock-title">
          <span className="external-session-lock-mark" aria-hidden>⌁</span>
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
      <header className="external-session-hero">
        <div>
          <p>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <div>{copy.description}</div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading || Boolean(actionBusy)}>
          <span aria-hidden className={loading ? "is-spinning" : ""}><IconRefresh size={15} /></span>
          {loading ? copy.refreshing : copy.refresh}
        </button>
      </header>

      <section className="external-session-meter" aria-label={copy.safeBridge}>
        <div><strong>{String(readySources).padStart(2, "0")}</strong><span>{copy.sources}</span></div>
        <div><strong>{String(sessions.length).padStart(2, "0")}</strong><span>{copy.sessions}</span></div>
        <div className="external-session-meter-seal"><span aria-hidden>◆</span><strong>{copy.safeBridge}</strong></div>
      </section>

      {error ? <div className="external-session-error" role="alert">{error}</div> : null}

      <section className="external-source-grid" aria-label={copy.sources}>
        {(sources ?? []).map((source) => (
          <button
            type="button"
            className={`external-source-card is-${source.state}${selectedSourceId === source.id ? " is-selected" : ""}`}
            key={source.id}
            onClick={() => onSelectSource(source.id)}
            disabled={loading || source.state !== "ready"}
            aria-pressed={selectedSourceId === source.id}
          >
            <span className={`external-source-logo is-${source.id}`} aria-hidden>{sourceMark(source.id)}</span>
            <span><strong>{source.label}</strong><span>{copy.sourceStates[source.state]}</span></span>
            <small>{source.version || "—"}</small>
          </button>
        ))}
      </section>

      {selected ? (
        <section className="external-session-dossier" aria-labelledby="external-session-selected-title">
          <button type="button" className="external-session-back" onClick={onBack}><IconBack size={15} /> {copy.back}</button>
          <div className="external-session-dossier-head">
            <span className={`external-source-logo is-${selected.sourceId}`} aria-hidden>{sourceMark(selected.sourceId)}</span>
            <div>
              <p>{copy.selectedEyebrow}</p>
              <h2 id="external-session-selected-title">{selected.title}</h2>
              <span>{selected.workspaceName}</span>
            </div>
            <b className={`external-session-state is-${selected.state}`}>{copy.sessionStates[selected.state]}</b>
          </div>

          <div className="external-session-workspace">
            <section className="external-session-conversation" aria-label={copy.transcript}>
              <header><strong>{copy.transcript}</strong><span>{selected.sourceId === "codex" ? "Codex" : "Claude Code"}</span></header>
              <div className="external-session-timeline" aria-live="polite">
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
                ) : (
                  <article className={`external-session-activity is-${item.kind}`} key={item.id}>
                    <span>{item.kind === "tool" ? item.name : copy.system}</span><p>{item.text}</p>
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

              {actionError ? <div className="external-session-error" role="alert">{actionError}</div> : null}
              {transcript?.readOnly ? (
                <div className="external-session-continuation is-read-only">
                  <div><strong>{copy.readOnlyTitle}</strong><p>{copy.readOnlyBody}</p></div>
                  <button type="button" className="is-primary" disabled={Boolean(actionBusy)} onClick={() => void onFork()}>
                    {actionBusy === "fork" ? copy.forking : copy.fork}
                  </button>
                </div>
              ) : transcript ? (
                <form className="external-session-composer" onSubmit={submit}>
                  <label><span>{copy.writableTitle}</span><small>{copy.writableBody}</small></label>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    placeholder={copy.composerPlaceholder}
                    disabled={Boolean(actionBusy) || Boolean(approval)}
                    rows={3}
                  />
                  <div>
                    {actionBusy === "turn" || approval
                      ? <button type="button" onClick={() => void onInterrupt()} disabled={actionBusy === "interrupt"}>{copy.stop}</button>
                      : null}
                    <button type="submit" className="is-primary" disabled={!draft.trim() || Boolean(actionBusy) || Boolean(approval)}>{copy.send}</button>
                  </div>
                </form>
              ) : null}
            </section>

            <aside className="external-session-inspector">
              <dl className="external-session-facts">
                <div><dt>{copy.workspace}</dt><dd>{selected.workspaceName}</dd></div>
                <div><dt>{copy.source}</dt><dd>{selected.sourceId === "codex" ? "Codex" : "Claude Code"}</dd></div>
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
          <div className="external-session-overview-title"><span aria-hidden><IconCommandLine size={27} /></span><div><h2 id="external-session-overview-title">{copy.noSelectionTitle}</h2><p>{copy.noSelectionBody}</p></div></div>
          <div className="external-session-principles">
            <article><b>01</b><strong>{copy.metadataOnly}</strong><p>{copy.metadataOnlyBody}</p></article>
            <article><b>02</b><strong>{copy.personalOnly}</strong><p>{copy.personalOnlyBody}</p></article>
            <article><b>03</b><strong>{copy.forkFirst}</strong><p>{copy.forkFirstBody}</p></article>
          </div>
        </section>
      )}
    </main>
  );
}
