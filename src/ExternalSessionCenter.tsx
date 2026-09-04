import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ExternalRuntimeAgentKind,
  ExternalRuntimeLaunchOptions,
  ExternalSessionInfo,
  ExternalSessionMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceId,
  ExternalSessionSourceInfo,
  ExternalSessionSourceState,
  ExternalSessionState,
  ExternalTerminalKey,
  ExternalTerminalSnapshot,
} from "./client";
import { IconBack, IconCommandLine, IconRefresh } from "./icons";
import { isImeCompositionKey } from "./ime";
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
  liveCodexTitle: string;
  liveCodexBody: string;
  liveClaudeTitle: string;
  liveClaudeBody: string;
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
  remove: string;
  removing: string;
  startAnother: string;
  terminalUnavailableTitle: string;
  terminalUnavailableBody: string;
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
  runtimeEngine: string;
  runtimeModel: string;
  runtimeModelPlaceholder: string;
  runtimeEffort: string;
  runtimeWorkMode: string;
  runtimeFast: string;
  runtimeStart: string;
  runtimeDefault: string;
  runtimeCodexWork: string;
  runtimeCodexPlan: string;
  runtimeClaudeWork: string;
  runtimeClaudePlan: string;
  runtimeClaudeManual: string;
  runtimeClaudeAuto: string;
  runtimeClaudeDontAsk: string;
  detailsView: string;
  terminalView: string;
  terminalTitle: string;
  terminalBody: string;
  terminalEmpty: string;
  terminalPlaceholder: string;
  terminalSend: string;
  terminalRefresh: string;
  terminalLocalOnly: string;
  terminalKeyHelp: string;
  terminalKeyConfirm: string;
  terminalKeyCancel: string;
  terminalKeyUp: string;
  terminalKeyDown: string;
  terminalKeySwitch: string;
  terminalKeyInterrupt: string;
  terminalKeySent: string;
  terminalInterruptSent: string;
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
  actionBusy: "" | "resume" | "turn" | "interrupt" | "remove";
  creatingKind: ExternalRuntimeAgentKind | null;
  error: string;
  actionError: string;
  personal: boolean;
  locale: "en" | "zh";
  copy: ExternalSessionCenterCopy;
  onRefresh: () => void;
  onBack: () => void;
  onSelectSource: (sourceId: ExternalSessionSourceId) => void;
  onCreate: (agentKind: ExternalRuntimeAgentKind, launch: ExternalRuntimeLaunchOptions) => Promise<void>;
  onResume: () => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
  onSteer: (text: string) => Promise<void>;
  onInterrupt: () => Promise<void>;
  onRemove?: () => Promise<void>;
  onApproval: (verdict: "deny" | "allow" | "always") => Promise<void>;
  onReadTerminal: () => Promise<ExternalTerminalSnapshot>;
  onTerminalInput: (text: string) => Promise<void>;
  onTerminalKey: (key: ExternalTerminalKey) => Promise<void>;
}

const sourceMark = (sourceId: ExternalSessionInfo["sourceId"]): string => (
  sourceId === "runtime" ? "HR" : sourceId === "codex" ? "CX" : "CL"
);

const sourceDisplayName = (session: ExternalSessionInfo): string => (
  session.sourceId === "runtime"
    ? `Hara Live · ${session.agentKind === "claude" ? "Claude Code" : "Codex"}`
    : session.sourceId === "codex" ? "Codex" : "Claude Code"
);

type TerminalControlCopyKey =
  | "terminalKeyConfirm"
  | "terminalKeyCancel"
  | "terminalKeyUp"
  | "terminalKeyDown"
  | "terminalKeySwitch"
  | "terminalKeyInterrupt";

const TERMINAL_CONTROLS: ReadonlyArray<{
  key: ExternalTerminalKey;
  keyLabel: string;
  actionCopy: TerminalControlCopyKey;
  tone?: "confirm" | "interrupt";
}> = [
  { key: "esc", keyLabel: "Esc", actionCopy: "terminalKeyCancel" },
  { key: "up", keyLabel: "↑", actionCopy: "terminalKeyUp" },
  { key: "down", keyLabel: "↓", actionCopy: "terminalKeyDown" },
  { key: "enter", keyLabel: "Enter", actionCopy: "terminalKeyConfirm", tone: "confirm" },
  { key: "tab", keyLabel: "Tab", actionCopy: "terminalKeySwitch" },
  { key: "ctrl+c", keyLabel: "Ctrl+C", actionCopy: "terminalKeyInterrupt", tone: "interrupt" },
];

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
  onRemove,
  onApproval,
  onReadTerminal,
  onTerminalInput,
  onTerminalKey,
}: ExternalSessionCenterProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [runtimeAgentKind, setRuntimeAgentKind] = useState<ExternalRuntimeAgentKind>("codex");
  const [runtimeModels, setRuntimeModels] = useState<Record<ExternalRuntimeAgentKind, string>>({ codex: "", claude: "" });
  const [runtimeEfforts, setRuntimeEfforts] = useState<Record<ExternalRuntimeAgentKind, string>>({ codex: "", claude: "" });
  const [runtimeModes, setRuntimeModes] = useState<Record<ExternalRuntimeAgentKind, string>>({ codex: "workspace-write", claude: "acceptEdits" });
  const [runtimeFast, setRuntimeFast] = useState(false);
  const [inspectorViews, setInspectorViews] = useState<Record<string, "details" | "terminal">>({});
  const [terminalSnapshots, setTerminalSnapshots] = useState<Record<string, ExternalTerminalSnapshot>>({});
  const [terminalDrafts, setTerminalDrafts] = useState<Record<string, string>>({});
  const [terminalErrors, setTerminalErrors] = useState<Record<string, string>>({});
  const [terminalKeyNotices, setTerminalKeyNotices] = useState<Record<string, string>>({});
  const [terminalBusy, setTerminalBusy] = useState<Record<string, boolean>>({});
  const composingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLPreElement>(null);
  const selectedId = selected?.id ?? "";
  const draft = selectedId ? drafts[selectedId] ?? "" : "";
  const setDraft = useCallback((value: string) => {
    if (!selectedId) return;
    setDrafts((current) => ({ ...current, [selectedId]: value }));
  }, [selectedId]);
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
  const liveClaude = selected?.agentKind === "claude" || selected?.sourceId === "claude";
  const composerTitle = running
    ? (canSteer ? copy.followUpTitle : copy.waitTitle)
    : controlMode === "live"
      ? (liveClaude ? copy.liveClaudeTitle : copy.liveCodexTitle)
      : copy.writableTitle;
  const composerBody = running
    ? (canSteer ? copy.followUpBody : copy.waitBody)
    : controlMode === "live"
      ? (liveClaude ? copy.liveClaudeBody : copy.liveCodexBody)
      : copy.writableBody;
  const terminalSupported = selected?.sourceId === "runtime"
    && activeSource?.capabilities.terminalView === true;
  const removable = selected?.sourceId === "runtime"
    && activeSource?.capabilities.remove === true
    && Boolean(onRemove);
  const inspectorView = selectedId
    ? inspectorViews[selectedId] ?? (
        selected?.sourceId === "runtime" && (selected.state === "waiting" || selected.state === "error")
          ? "terminal"
          : "details"
      )
    : "details";
  const terminalSnapshot = selectedId ? terminalSnapshots[selectedId] : undefined;
  const terminalDraft = selectedId ? terminalDrafts[selectedId] ?? "" : "";
  const terminalError = selectedId ? terminalErrors[selectedId] ?? "" : "";
  const terminalKeyNotice = selectedId ? terminalKeyNotices[selectedId] ?? "" : "";

  const refreshTerminal = useCallback(async () => {
    if (!selectedId || !terminalSupported) return;
    try {
      const snapshot = await onReadTerminal();
      if (snapshot.sessionId !== selectedId) return;
      setTerminalSnapshots((current) => ({ ...current, [selectedId]: snapshot }));
      setTerminalErrors((current) => ({ ...current, [selectedId]: "" }));
    } catch (error) {
      setTerminalErrors((current) => ({ ...current, [selectedId]: String(error instanceof Error ? error.message : error).slice(0, 240) }));
    }
  }, [onReadTerminal, selectedId, terminalSupported]);

  useEffect(() => {
    if (inspectorView !== "terminal" || !terminalSupported) return;
    void refreshTerminal();
    if (selected?.state === "error") return;
    const timer = window.setInterval(() => void refreshTerminal(), 1_000);
    return () => window.clearInterval(timer);
  }, [inspectorView, refreshTerminal, selected?.state, terminalSupported]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [terminalSnapshot?.text]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || composerBlocked) return;
    setDraft("");
    const send = canSendFollowUp ? onSteer : onSubmit;
    void send(text).catch(() => {
      setDrafts((current) => ({ ...current, [selectedId]: current[selectedId] || text }));
    });
  };

  const createRuntime = (): void => {
    const model = runtimeModels[runtimeAgentKind].trim();
    const effort = runtimeEfforts[runtimeAgentKind];
    const mode = runtimeModes[runtimeAgentKind];
    const launch: ExternalRuntimeLaunchOptions = {
      ...(model ? { model } : {}),
      ...(effort ? { effort: effort as ExternalRuntimeLaunchOptions["effort"] } : {}),
      ...(runtimeAgentKind === "codex"
        ? {
            sandboxMode: mode as ExternalRuntimeLaunchOptions["sandboxMode"],
            ...(runtimeFast ? { serviceTier: "fast" as const } : {}),
          }
        : { permissionMode: mode as ExternalRuntimeLaunchOptions["permissionMode"] }),
    };
    void onCreate(runtimeAgentKind, launch);
  };

  const submitTerminal = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!selectedId || !terminalDraft.trim() || terminalBusy[selectedId]) return;
    const text = terminalDraft.trim();
    setTerminalDrafts((current) => ({ ...current, [selectedId]: "" }));
    setTerminalBusy((current) => ({ ...current, [selectedId]: true }));
    try {
      await onTerminalInput(text);
      await refreshTerminal();
    } catch (error) {
      setTerminalDrafts((current) => ({ ...current, [selectedId]: current[selectedId] || text }));
      setTerminalErrors((current) => ({ ...current, [selectedId]: String(error instanceof Error ? error.message : error).slice(0, 240) }));
    } finally {
      setTerminalBusy((current) => ({ ...current, [selectedId]: false }));
    }
  };

  const sendTerminalKey = async (control: (typeof TERMINAL_CONTROLS)[number]): Promise<void> => {
    if (!selectedId || terminalBusy[selectedId]) return;
    const actionLabel = copy[control.actionCopy];
    setTerminalBusy((current) => ({ ...current, [selectedId]: true }));
    setTerminalErrors((current) => ({ ...current, [selectedId]: "" }));
    setTerminalKeyNotices((current) => ({ ...current, [selectedId]: "" }));
    try {
      await onTerminalKey(control.key);
      setTerminalKeyNotices((current) => ({
        ...current,
        [selectedId]: control.key === "ctrl+c"
          ? copy.terminalInterruptSent
          : copy.terminalKeySent
              .replace("{action}", actionLabel)
              .replace("{key}", control.keyLabel),
      }));
      await refreshTerminal();
    } catch (error) {
      setTerminalErrors((current) => ({ ...current, [selectedId]: String(error instanceof Error ? error.message : error).slice(0, 240) }));
    } finally {
      setTerminalBusy((current) => ({ ...current, [selectedId]: false }));
    }
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
            <div className="external-runtime-intro">
              <span className="external-source-logo is-runtime" aria-hidden>HR</span>
              <span>
                <strong id="external-runtime-launcher-title">{copy.runtimeTitle}</strong>
                <small>{copy.runtimeBody}</small>
              </span>
            </div>
            <div className="external-runtime-config">
              <fieldset>
                <legend>{copy.runtimeEngine}</legend>
                <div className="external-runtime-segmented">
                  <button type="button" className={runtimeAgentKind === "codex" ? "is-selected" : ""} onClick={() => setRuntimeAgentKind("codex")}>{copy.runtimeCodex}</button>
                  <button type="button" className={runtimeAgentKind === "claude" ? "is-selected" : ""} onClick={() => setRuntimeAgentKind("claude")}>{copy.runtimeClaude}</button>
                </div>
              </fieldset>
              <label>
                <span>{copy.runtimeModel}</span>
                <input
                  value={runtimeModels[runtimeAgentKind]}
                  list={`external-runtime-models-${runtimeAgentKind}`}
                  placeholder={copy.runtimeModelPlaceholder}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setRuntimeModels((current) => ({ ...current, [runtimeAgentKind]: value }));
                  }}
                />
                <datalist id={`external-runtime-models-${runtimeAgentKind}`}>
                  {(runtimeAgentKind === "codex"
                    ? ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]
                    : ["default", "best", "sonnet", "opus", "haiku", "opusplan"]
                  ).map((model) => <option value={model} key={model} />)}
                </datalist>
              </label>
              <label>
                <span>{copy.runtimeEffort}</span>
                <select value={runtimeEfforts[runtimeAgentKind]} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRuntimeEfforts((current) => ({ ...current, [runtimeAgentKind]: value }));
                }}>
                  <option value="">{copy.runtimeDefault}</option>
                  {(runtimeAgentKind === "codex"
                    ? ["minimal", "low", "medium", "high", "xhigh"]
                    : ["low", "medium", "high", "xhigh", "max"]
                  ).map((effort) => <option value={effort} key={effort}>{effort}</option>)}
                </select>
              </label>
              <label>
                <span>{copy.runtimeWorkMode}</span>
                <select value={runtimeModes[runtimeAgentKind]} onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRuntimeModes((current) => ({ ...current, [runtimeAgentKind]: value }));
                }}>
                  {runtimeAgentKind === "codex" ? (
                    <>
                      <option value="workspace-write">{copy.runtimeCodexWork}</option>
                      <option value="read-only">{copy.runtimeCodexPlan}</option>
                    </>
                  ) : (
                    <>
                      <option value="acceptEdits">{copy.runtimeClaudeWork}</option>
                      <option value="plan">{copy.runtimeClaudePlan}</option>
                      <option value="manual">{copy.runtimeClaudeManual}</option>
                      <option value="auto">{copy.runtimeClaudeAuto}</option>
                      <option value="dontAsk">{copy.runtimeClaudeDontAsk}</option>
                    </>
                  )}
                </select>
              </label>
              {runtimeAgentKind === "codex" ? (
                <label className="external-runtime-check">
                  <input type="checkbox" checked={runtimeFast} onChange={(event) => setRuntimeFast(event.currentTarget.checked)} />
                  <span>{copy.runtimeFast}</span>
                </label>
              ) : <span />}
              <button type="button" className="is-primary external-runtime-start" disabled={Boolean(creatingKind) || Boolean(actionBusy)} onClick={createRuntime}>
                {creatingKind ? copy.runtimeCreating : copy.runtimeStart}
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
                {removable ? (
                  <button
                    type="button"
                    className="external-session-remove"
                    disabled={Boolean(actionBusy)}
                    onClick={() => void onRemove?.()}
                  >
                    {actionBusy === "remove" ? copy.removing : copy.remove}
                  </button>
                ) : null}
              </div>
            </header>

            <div className={`external-session-layout${inspectorView === "terminal" && terminalSupported ? " is-terminal-expanded" : ""}`}>
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
                      onCompositionStart={() => {
                        composingRef.current = true;
                      }}
                      onCompositionEnd={() => {
                        composingRef.current = false;
                      }}
                      onKeyDown={(event) => {
                        if (composingRef.current || isImeCompositionKey(event.nativeEvent)) return;
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
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

              <aside className={`external-session-inspector is-${inspectorView}`}>
                <div className="external-inspector-switcher" role="tablist">
                  <button type="button" role="tab" aria-selected={inspectorView === "details"} className={inspectorView === "details" ? "is-selected" : ""} onClick={() => setInspectorViews((current) => ({ ...current, [selected.id]: "details" }))}>{copy.detailsView}</button>
                  {terminalSupported ? <button type="button" role="tab" aria-selected={inspectorView === "terminal"} className={inspectorView === "terminal" ? "is-selected" : ""} onClick={() => setInspectorViews((current) => ({ ...current, [selected.id]: "terminal" }))}>{copy.terminalView}</button> : null}
                </div>
                {inspectorView === "terminal" && terminalSupported ? (
                  <section className="external-native-terminal" aria-label={copy.terminalTitle}>
                    <header>
                      <span><i aria-hidden />{copy.terminalTitle}</span>
                      <button type="button" onClick={() => void refreshTerminal()} disabled={Boolean(terminalBusy[selected.id])}>{copy.terminalRefresh}</button>
                    </header>
                    <p>{copy.terminalBody}</p>
                    {actionError ? <div className="external-terminal-error" role="alert">{actionError}</div> : null}
                    {terminalError ? (
                      <div className="external-terminal-unavailable" role="alert">
                        <strong>{copy.terminalUnavailableTitle}</strong>
                        <p>{copy.terminalUnavailableBody}</p>
                        <small>{terminalError}</small>
                        <div>
                          <button type="button" onClick={() => void refreshTerminal()} disabled={Boolean(terminalBusy[selected.id])}>{copy.terminalRefresh}</button>
                          <button type="button" className="is-primary" onClick={onBack}>{copy.startAnother}</button>
                          {removable ? <button type="button" onClick={() => void onRemove?.()} disabled={Boolean(actionBusy)}>{actionBusy === "remove" ? copy.removing : copy.remove}</button> : null}
                        </div>
                      </div>
                    ) : (
                      <>
                        <pre ref={terminalRef} tabIndex={0} data-native-context-menu="true">{terminalSnapshot?.text || copy.terminalEmpty}</pre>
                        <div className="external-terminal-keys" aria-label={copy.terminalKeyHelp}>
                          {TERMINAL_CONTROLS.map((control) => {
                            const actionLabel = copy[control.actionCopy];
                            return (
                              <button
                                type="button"
                                key={control.key}
                                className={control.tone ? `is-${control.tone}` : undefined}
                                aria-label={`${actionLabel} (${control.keyLabel})`}
                                title={`${actionLabel} · ${control.keyLabel}`}
                                disabled={Boolean(terminalBusy[selected.id])}
                                onClick={() => void sendTerminalKey(control)}
                              >
                                <kbd>{control.keyLabel}</kbd>
                                <span>{actionLabel}</span>
                              </button>
                            );
                          })}
                          <span className="external-terminal-key-notice" role="status" aria-live="polite">{terminalKeyNotice}</span>
                        </div>
                        <form onSubmit={(event) => void submitTerminal(event)}>
                          <input
                            value={terminalDraft}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setTerminalDrafts((current) => ({ ...current, [selected.id]: value }));
                            }}
                            placeholder={copy.terminalPlaceholder}
                            disabled={Boolean(terminalBusy[selected.id])}
                          />
                          <button type="submit" className="is-primary" disabled={!terminalDraft.trim() || Boolean(terminalBusy[selected.id])}>{copy.terminalSend}</button>
                        </form>
                      </>
                    )}
                    <small>{copy.terminalLocalOnly}</small>
                  </section>
                ) : (
                  <>
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
                  </>
                )}
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
