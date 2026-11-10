import { WorkspaceRpcErrorNotice } from "./WorkspaceRpcErrorNotice.tsx";
import { localizedWorkspaceView } from "./workspace-default-labels.ts";
import { currentClientLocale } from "./core-i18n.ts";
import { open as chooseFile } from "@tauri-apps/plugin-dialog";
import { conversationMarkdown, findTranscriptMatch } from "./workspace-conversation-actions";
import { WorkspaceSidebarC, type SidebarEntry } from "./WorkspaceSidebarC";
import { WorkspaceUndoToast, type UndoNotice } from "./WorkspaceUndoToast";
import { redesignText } from "./desktop-redesign-copy";
import { rosterConversationActivity, rosterGroupMembers, type RosterPreference } from "./workspace-roster";
import { agentAvatarAccent } from "./agent-visual";
import "./desktop-redesign.css";
import type { WorkspaceMediaAccess } from "./workspace-media";
import { isInternalUserText, userVisibleText } from "./user-visible-text";
import type { AgentRuntimeId } from "./client";
import { WorkspaceContextCompaction } from "./WorkspaceContextCompaction";
import type { ContextCompactionView } from "./context-compaction";
import { WorkspaceDraftTiming, WorkspaceOptimisticMessage, WorkspaceTimingChip, WorkspaceWaiting, compactFailureHandled } from "./WorkspaceWaitTiming";
import { currentWaitReport, type WaitConversation } from "./wait-timing";
import type { MessageTimingReport } from "./message-timing.ts";
import { runtimeVersionFor } from "./runtime-version-drift";
import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GlobeAltIcon,
  ViewColumnsIcon, MagnifyingGlassIcon, UserPlusIcon, UsersIcon, XMarkIcon, EllipsisHorizontalIcon, PencilSquareIcon, PaperClipIcon, AtSymbolIcon, CalendarDaysIcon, ShieldCheckIcon, ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import HaraLogo from "./mark";
import { Md } from "./markdown";
import { makeT, type Key } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import type { WorkspaceDevConnection } from "./workspace-dev-rpc";
import { WorkspaceStartupModel } from "./workspace-startup";
import { WorkspaceBoot } from "./WorkspaceBoot";
import { WorkspaceTaskRecovery } from "./WorkspaceTaskRecovery";
import { WorkspaceRuntimeStages } from "./WorkspaceRuntimeStages";
import { runtimeStagesBefore, type RuntimeDiagnosticReceipt, type RuntimeStageReport } from "./runtime-stage-events";
import { WorkspaceAsyncQuestions, WorkspaceUserQuestion } from "./WorkspaceUserQuestion";
import type { WorkspaceRuntimePlatform } from "./runtime-platform.ts";
import { WorkspaceDevModel, workspaceAsyncAsks, type ColleagueCreateDraft, type WorkspaceDevMessage, type WorkspaceDevAgent, type WorkspaceDevApproval, type WorkspaceFeatureView, type WorkspaceDevArchiveStatus } from "./workspace-dev-state";
import { parseColleagueScheduleRequest, type ColleagueScheduleDraft } from "./colleague-schedule.js";
import { useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { Avatar, ColleaguesPage, ShellDialog } from "./WorkspaceShell";
import { useWorkspaceLocale, useWorkspaceOverview, workspacePlatform } from "./workspace-shell-hooks";
import { conversationTimeline, messageContinues, normalizeShellRoute, pendingApprovals, transcriptBlocks, type AwaitItem } from "./workspace-shell-state";
import { captureWorkspaceReadingPosition } from "./workspace-chat-scroll";
import { colleagueUsageView } from "./workspace-account-usage";
import { WorkspaceLocalChannelsModel } from "./workspace-local-channels";
import { LocalChannelComposer, LocalChannelDialog, LocalChannelThread } from "./WorkspaceLocalChannels";
import "./workspace-entry.css";
import "./workspace-local-dev.css";
import "./workspace-theme.css";
import "./workspace-states.css";
import "./workspace-shell-layout.css";
import WorkspaceInspector, { WorkspaceOverview } from "./WorkspaceInspector";
import WorkspaceColleagueInspector from "./WorkspaceColleagueInspector";
import { WorkspaceRosterMenu } from "./WorkspaceRosterMenu";
import WorkspaceGroupInspector from "./WorkspaceGroupInspector";
import "./violet-tokens.css";
import "./violet-workspace.css";
import WorkspaceSettings, { type SettingsPage } from "./WorkspaceSettings";
import { useWorkspaceUpdater, WorkspaceUpdateNotice } from "./WorkspaceSoftwareUpdate";
const BrowserExtension = lazy(() => import("./WorkspaceBrowserExtension"));

type Translate = ReturnType<typeof makeT>;
const TOOL_LABELS: Record<string, Key> = Object.fromEntries(["task_intake", "task_checkpoint", "todo_write", "workspace_read", "workspace_write", "workspace_verify", "workspace_instruction_update", "workspace_memory_write", "workspace_memory_promote", "agent_list", "agent_create", "group_create", "agent_contact", "schedule_create", "schedule_list", "schedule_cancel"]
  .map(name => [name, `ws.execution.${name}` as Key]));
export function ApprovalCard({ card, model, t, disabled = false, onSettled, inDialog = false, locale = "en", onRestoreArchived }: { card: WorkspaceDevApproval;
  model: { respond(card: WorkspaceDevApproval, approved: boolean, draft?: ColleagueCreateDraft): Promise<void>;
    getSnapshot(): { workspace: { approvals: WorkspaceDevApproval[]; runtimeOptions?: { id: string; label: string; available: boolean }[]; agents?: WorkspaceDevAgent[] } | null };
    runtimePlatform?(): WorkspaceRuntimePlatform };
  t: Translate; disabled?: boolean; onSettled?: () => void; inDialog?: boolean; locale?: string; onRestoreArchived?: (agent: WorkspaceDevAgent) => Promise<void> }) {
  const schedule = card.kind === "schedule_create", group = card.kind === "group_create", colleague = card.kind === undefined || card.kind === "agent_create";
  // Self-contained: an older model without platform data keeps the macOS tiers it shipped with.
  const platform: WorkspaceRuntimePlatform = model.runtimePlatform?.() ?? { writeProtection: "seatbelt", permissionTiers: ["full-protected", "controlled"] };
  const [pending, setPending] = useState(false), fence = useRef(false);
  const [draft, setDraft] = useState<ColleagueCreateDraft | null>(() => card.kind === undefined || card.kind === "agent_create" ? { ...card.draft } : null);
  const runtimeOptions = model.getSnapshot().workspace?.runtimeOptions?.filter(row => row.available && row.id !== "hara") ?? [];
  const duplicateName = colleague && draft?.displayName.trim() && model.getSnapshot().workspace?.agents?.some(row => row.state === "active"
    && row.identity.displayName.trim().toLocaleLowerCase() === draft.displayName.trim().toLocaleLowerCase());
  const archivedMatch = colleague && draft?.displayName.trim() ? model.getSnapshot().workspace?.agents?.find(row => row.kind === "colleague" && row.state === "archived"
    && row.identity.displayName.trim().toLocaleLowerCase() === draft.displayName.trim().toLocaleLowerCase()) : undefined;
  const [restoreFailed, setRestoreFailed] = useState(false);
  const r = (key: Parameters<typeof redesignText>[1], values?: Record<string, string | number>) => redesignText(locale, key, values);
  const heading = (label: string) => <header className="hd-card-head">{schedule ? <CalendarDaysIcon aria-hidden="true" /> : colleague ? <UserPlusIcon aria-hidden="true" /> : group ? <UsersIcon aria-hidden="true" /> : <ShieldCheckIcon aria-hidden="true" />}<strong>{label}</strong><span className="hd-card-state">{r("pending")}</span></header>;
  const edit = (key: keyof ColleagueCreateDraft, value: string) => setDraft(previous => previous ? { ...previous, [key]: value } : previous);
  const decide = async (approved: boolean) => {
    if (fence.current || disabled || approved && colleague && (!draft?.username.trim() || !draft.displayName.trim() || !draft.title.trim() || !runtimeOptions.some(row => row.id === draft.runtimeId))) return;
    fence.current = true; setPending(true);
    try { await model.respond(card, approved, approved && colleague ? draft ?? undefined : undefined);
      if (!model.getSnapshot().workspace?.approvals.some(row => row.id === card.id)) onSettled?.();
    } finally { fence.current = false; setPending(false); }
  };
  if (card.kind === "extension_call") return <section className="hs-card wsd-approval" role="group" aria-label={t("ws.extensionApproval.label")} id={`${inDialog ? "approval-dialog" : "approval"}-${card.id}`} tabIndex={-1}>
    {heading(t("ws.extensionApproval.label"))}<h3>{card.draft.sourceName} / {card.draft.toolName}</h3>
    <p>{t(card.draft.action === "read" ? "ws.extensionApproval.read" : "ws.extensionApproval.exec")}</p>
    <pre>{card.draft.target}</pre><p>{t("ws.extensionApproval.boundary")}</p>
    <div className="wsd-card-actions"><button className="hs-btn sec" disabled={pending || disabled} onClick={() => void decide(false)}>{t("ws.extensionApproval.decline")}</button>
      <button className="hs-btn pri" disabled={pending || disabled} onClick={() => void decide(true)}>{t("ws.extensionApproval.confirm")}</button></div>
  </section>;
  if (card.kind === "instruction_update" || card.kind === "memory_promote") return <section className="hs-card wsd-approval" role="group" aria-label={r(card.kind === "instruction_update" ? "instructionApproval" : "memoryApproval")} id={`${inDialog ? "approval-dialog" : "approval"}-${card.id}`} tabIndex={-1}>
    {heading(r(card.kind === "instruction_update" ? "instructionApproval" : "memoryApproval"))}
    {card.kind === "instruction_update" ? <h3>{card.draft.file}</h3> : <p>{r("sharedWorkspaceMemory")}</p>}
    <pre className="hd-proposal-content">{card.draft.content}</pre>
    <p className="hd-card-boundary">{r(card.kind === "instruction_update" ? "instructionBoundary" : "memoryBoundary")}</p>
    <div className="wsd-card-actions"><button className="hs-btn sec" disabled={pending || disabled} onClick={() => void decide(false)}>{r("groupDecline")}</button>
      <button className="hs-btn pri" disabled={pending || disabled} onClick={() => void decide(true)}>{r("confirmChange")}</button></div>
  </section>;
  if (card.kind === "group_create") return <section className="hs-card wsd-approval" role="group" aria-label={r("groupApproval")} id={`${inDialog ? "approval-dialog" : "approval"}-${card.id}`} tabIndex={-1}>
    {heading(r("groupApproval"))}<h3>{card.draft.name}</h3>
    <p>{t("ws.channels.members")}</p><ul>{card.draft.memberIds.map((id, index) => <li key={id}>{card.draft.memberNames[index] ?? id}</li>)}</ul>
    <p className="hd-card-boundary">{r("groupBoundary")}</p>
    <div className="wsd-card-actions"><button className="hs-btn sec" disabled={pending || disabled} onClick={() => void decide(false)}>{r("groupDecline")}</button>
      <button className="hs-btn pri" disabled={pending || disabled || card.draft.memberIds.length < 2} onClick={() => void decide(true)}>{r("groupConfirm")}</button></div>
  </section>;
  return <section className="hs-card wsd-approval" role="group" aria-label={t(schedule ? "ws.scheduleApproval.label" : "ws.approval.label")} id={`${inDialog ? "approval-dialog" : "approval"}-${card.id}`} tabIndex={-1}>
    {heading(t(schedule ? "ws.scheduleApproval.label" : "ws.approval.label"))}
    {schedule ? <><h3>{t("ws.scheduleApproval.title", { name: card.draft.title })}</h3>
      <p>{card.draft.timing} · {card.draft.tz}</p><details><summary>{t("ws.scheduleApproval.details")}</summary><p>{card.draft.task}</p><p>{t("ws.scheduleApproval.boundary")}</p></details></>
      : <><h3>{t("ws.approval.draftTitle")}</h3>
      <div className="wsd-colleague-draft">
        <label>{t("ws.approval.name")}<input value={draft?.displayName ?? ""} maxLength={80} onChange={event => edit("displayName", event.target.value)} disabled={pending || disabled} /></label>
        <details className="hd-card-advanced"><summary>{t("ws.approval.advanced")}</summary><label>{t("ws.approval.handle")}<input value={draft?.username ?? ""} maxLength={64} onChange={event => edit("username", event.target.value)} disabled={pending || disabled} /></label></details>
        <label>{t("ws.approval.role")}<input value={draft?.title ?? ""} maxLength={180} onChange={event => edit("title", event.target.value)} disabled={pending || disabled} /></label>
        <label>{t("ws.approval.project")}<input value={draft?.project ?? ""} list={`project-${card.id}`} maxLength={240} onChange={event => edit("project", event.target.value)} disabled={pending || disabled} />
          <datalist id={`project-${card.id}`}>{card.projectOptions?.map(option => <option key={option} value={option} />)}</datalist></label>
        <label>{t("ws.approval.runtimeField")}<select value={draft?.runtimeId ?? ""} onChange={event => edit("runtimeId", event.target.value)} disabled={pending || disabled}>
          {runtimeOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>{t("ws.approval.tier")}<select value={draft?.permissionTier ?? platform.permissionTiers[0]} onChange={event => edit("permissionTier", event.target.value)} disabled={pending || disabled}>
          {platform.permissionTiers.includes("full-protected") ? <option value="full-protected">{t("ws.approval.fullProtected")}</option> : null}<option value="controlled">{t("ws.approval.controlled")}</option></select></label>
        {platform.writeProtection === "none" ? <p className="vg-platform-note" role="note">{t("ws.permissions.noOsProtection")}</p> : null}
        <details><summary>{t("ws.approval.details")}</summary><label>{t("ws.approval.instructions")}<textarea value={draft?.instructions ?? ""} maxLength={8000}
          onChange={event => edit("instructions", event.target.value)} disabled={pending || disabled} /></label></details>
      </div>{duplicateName ? <p role="status">{t("ws.approval.duplicateName")}</p> : null}{archivedMatch ? <p className="hd-archived-duplicate" role="status">{r("archivedName", { name: archivedMatch.identity.displayName })}{onRestoreArchived ? <button type="button" className="hs-btn sec" disabled={disabled || pending} onClick={async () => {
        if (fence.current) return; fence.current = true; setPending(true); setRestoreFailed(false);
        try { await onRestoreArchived(archivedMatch); } catch { setRestoreFailed(true); } finally { fence.current = false; setPending(false); }
      }}>{r("restore")}</button> : null}{restoreFailed ? <span role="alert">{r("archiveFailed")}</span> : null}</p> : null}</>}
    <div className="wsd-card-actions"><small className="hd-card-boundary">{t(schedule ? "ws.scheduleApproval.boundary" : "ws.approval.boundary")}</small><button className="hs-btn sec" onClick={() => void decide(false)} disabled={pending || disabled}>{t(schedule ? "ws.scheduleApproval.decline" : "ws.approval.decline")}</button>
      <button className="hs-btn pri" onClick={() => void decide(true)} disabled={pending || disabled || !schedule && (!draft?.username.trim() || !draft.displayName.trim() || !draft.title.trim() || !runtimeOptions.some(row => row.id === draft.runtimeId))}>{t(schedule ? "ws.scheduleApproval.confirm" : "ws.approval.confirm")}</button></div>
  </section>;
}
type ApprovalSettleState = "created" | "declined" | "expired" | "aborted";
export function parseAgentCreateSettle(content: string): { state: ApprovalSettleState; name?: string; agentId?: string } | null {
  try {
    const value = JSON.parse(content) as { created?: unknown; humanConfirmed?: unknown; approvalState?: unknown; agent?: { agentId?: unknown; identity?: { displayName?: unknown }; profile?: { displayName?: unknown } }; draft?: { displayName?: unknown }; displayName?: unknown };
    if (value?.created === true && value.humanConfirmed === true && value.approvalState === "consumed" && typeof value.agent?.agentId === "string"
      && typeof value.agent.identity?.displayName === "string" && value.agent.identity.displayName.trim()) return { state: "created", name: value.agent.identity.displayName, agentId: value.agent.agentId };
    if (value?.created !== false) return null;
    const state = value.approvalState;
    if (state !== "declined" && state !== "expired" && state !== "aborted") return null;
    const name = [value.agent?.profile?.displayName, value.draft?.displayName, value.displayName].find(row => typeof row === "string" && row.trim()) as string | undefined;
    return { state, name };
  } catch { return null; }
}
function SettledApprovalCard({ state, name, agentId, t, locale, onOpenAgent }: { state: ApprovalSettleState; name?: string; agentId?: string; t: Translate; locale: string; onOpenAgent?: (id: string) => void }) {
  if (state === "created") return <section className="hs-card wsd-approval wsd-approval-settled" role="status"><p>{redesignText(locale, "createdColleague", { name: name ?? "" })}</p>{agentId && onOpenAgent ? <button type="button" className="hd-text-button" onClick={() => onOpenAgent(agentId)}>{redesignText(locale, "open")}</button> : null}</section>;
  const label = name?.trim() || t("ws.approval.label");
  const copy = state === "declined" ? "ws.approval.settledDeclined" : state === "expired" ? "ws.approval.settledExpired" : "ws.approval.settledAborted";
  return <section className="hs-card wsd-approval wsd-approval-settled" role="status" aria-label={t("ws.approval.settledKicker")}>
    <div className="wsd-kicker">{t("ws.approval.settledKicker")}</div>
    <p>{t(copy, { name: label })}</p>
  </section>;
}
export function Transcript({ history, agent, t, media, onOpenAgent, locale = "en", detailed = false, stages = [], historyOffset = 0, onExportStage, stageDisabled = false, alwaysShowTimingDiagnostics = false, messageTimings = [], conversation, contextCompactions, compactions = contextCompactions ?? [] }: {
  locale?: string; media?: WorkspaceMediaAccess; onOpenAgent?: (id: string) => void; conversation?: WaitConversation; contextCompactions?: readonly ContextCompactionView[]; compactions?: readonly ContextCompactionView[];
  messageTimings?: readonly MessageTimingReport[];
  history: WorkspaceDevMessage[]; agent?: WorkspaceDevAgent; t: Translate; detailed?: boolean; stages?: RuntimeStageReport[];
  alwaysShowTimingDiagnostics?: boolean; historyOffset?: number; onExportStage?: (report: RuntimeStageReport) => Promise<RuntimeDiagnosticReceipt>; stageDisabled?: boolean;
}) {
  let previous: WorkspaceDevMessage | undefined;
  const stageBoundaries = runtimeStagesBefore(stages, history, historyOffset);
  const [diagnostics, setDiagnostics] = useState<{ attemptId: string; request: number } | null>(null);
  const assistantReports = new Map<number, RuntimeStageReport[]>(), withoutAssistant = new Set<string>();
  for (const [boundary, reports] of stageBoundaries) for (const report of reports) {
    if (report.state === "running" || conversation?.runId === report.runId && ["running", "draining"].includes(conversation.state)) continue;
    let last = -1;
    for (let index = Math.max(0, report.historyStart - historyOffset); index < Math.min(history.length, boundary - historyOffset); index++) if (history[index].role === "assistant") last = index;
    if (last < 0) withoutAssistant.add(report.attemptId);
    else assistantReports.set(last, [...(assistantReports.get(last) ?? []), report]);
  }
  const chip = (report: RuntimeStageReport) => <WorkspaceTimingChip key={report.attemptId} report={report} timings={messageTimings} conversation={conversation} compactions={compactions} t={t} disabled={stageDisabled} onDiagnostics={() => setDiagnostics(previous => ({ attemptId: report.attemptId, request: (previous?.request ?? 0) + 1 }))} />;
  const renderStages = (boundary: number) => (stageBoundaries.get(boundary) ?? []).map(report => <Fragment key={report.attemptId}>
    {withoutAssistant.has(report.attemptId) ? <div className="hs-who wsd-timing-orphan">{chip(report)}</div> : null}
    {alwaysShowTimingDiagnostics || diagnostics?.attemptId === report.attemptId || report.errorKind ? <WorkspaceRuntimeStages
      report={report} t={t} messageTimings={messageTimings} alwaysShow={alwaysShowTimingDiagnostics} forceVisible expanded={diagnostics?.attemptId === report.attemptId} expandRequest={diagnostics?.request} onExport={onExportStage} disabled={stageDisabled} /> : null}
  </Fragment>);
  const renderedCompactions = new Set<string>();
  const renderCompactions = (boundary: number) => compactions.filter(row => row.historyStart >= historyOffset && row.historyStart <= boundary && !renderedCompactions.has(row.id)).map(row => {
    renderedCompactions.add(row.id); return <WorkspaceContextCompaction key={row.id} value={row} t={t} />;
  });
  const renderItem = (item: ReturnType<typeof transcriptBlocks>[number]) => {
    if (item.kind === "execution") {
      const settled = item.results.flatMap(({ key, result }) => {
        if (result.name !== "agent_create" || result.isError) return [];
        const parsed = parseAgentCreateSettle(result.content);
        return parsed ? [{ key, ...parsed }] : [];
      });
      if (detailed || settled.length || item.results.some(({ result }) => result.isError)) previous = undefined;
      // Settled approval cards stay visible in brief mode (do not hide inside ops disclosure).
      const settledCards = settled.map(row => <div className="wsd-message-group" key={`settled-${row.key}`}><SettledApprovalCard state={row.state} name={row.name} agentId={row.agentId} t={t} locale={locale} onOpenAgent={onOpenAgent} /></div>);
      if (!detailed && !item.results.some(({ result }) => result.isError)) {
        return settledCards.length ? <div key={`settled-batch-${item.index}`}>{settledCards}</div> : null;
      }
      return <div className="wsd-message-group" key={`execution-${item.index}`}>
        {settledCards}
        <details className="wsd-execution" open={detailed || undefined}>
        <summary>{t(item.count === 1 ? "ws.execution.one" : "ws.execution.count", { n: item.count })}{" · "}<span>{t("ws.execution.details")}</span></summary>
        <div className="wsd-execution-body">{item.results.map(({ key, result }) => <div key={key}><strong>{TOOL_LABELS[result.name] ? t(TOOL_LABELS[result.name]) : result.name}</strong>
          <pre className={result.isError ? "is-error" : ""}>{result.content.slice(0, 5000)}</pre></div>)}</div></details></div>;
    }
    const { message, index } = item;
    const continuation = messageContinues(previous, message) || !!previous && previous.role === message.role && previous.createdAt === undefined && message.createdAt === undefined; previous = message;
    if (message.role === "user" && isInternalUserText(message.content)) return null;
    if (message.role === "user") return <div className="wsd-message-group" key={`user-${index}`}><div className={`hs-msg me wsd-message is-user ${continuation ? "cont" : ""}`}><div className="hs-bub wsd-bubble">{userVisibleText(message.content)}</div></div>{message.createdAt ? <div className="hd-message-meta is-user"><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></div> : null}</div>;
    return <div className={`wsd-message-group ${continuation ? "cont" : ""}`} key={`assistant-${index}`}>
      {!continuation ? <div className="hs-who">{agent?.identity.displayName ?? "Hara"}</div> : null}
      <div className={`hs-msg wsd-message is-agent ${continuation ? "cont" : ""}`}><Avatar agent={agent} /><div className="hs-bub wsd-bubble"><Md text={message.text} media={media} locale={locale} mediaUnavailableLabel={t("ws.media.unavailable")} revealMediaLabel={t("ws.media.reveal")}
        copyCodeLabel={t("copyCode")} copiedLabel={t("taskCopied")} copyFailedLabel={t("copyFailed")} /></div></div>
      {message.createdAt || assistantReports.has(index) ? <div className="hd-message-meta">{message.createdAt || assistantReports.get(index)?.[0]?.provenance?.startedAt ? <time dateTime={message.createdAt ?? assistantReports.get(index)?.[0]?.provenance?.startedAt}>{new Date((message.createdAt ?? assistantReports.get(index)?.[0]?.provenance?.startedAt)!).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · </time> : null}{assistantReports.get(index)?.map(chip)}</div> : null}
    </div>;
  };
  return <>{transcriptBlocks(history).map(item => <Fragment key={`${item.kind}-${item.index}`}>
    {renderCompactions(item.index + historyOffset)}
    {item.kind === "message" && item.message.role === "user" ? renderStages(item.index + historyOffset) : null}
    {renderItem(item)}
  </Fragment>)}{renderStages(historyOffset + history.length)}{renderCompactions(historyOffset + history.length)}</>;
}
/** A server render has no live view or paint evidence. */
const emptyAssistantPreviewSnapshot = () => null;
/** Preview owns its subscription so a prose batch does not rerender the full transcript. */
export function AssistantDraft({ model, agent, t, follow }: { model: WorkspaceDevModel; agent?: WorkspaceDevAgent; t: Translate; follow(): void }) {
  const preview = useSyncExternalStore(model.subscribeAssistantPreview, model.getAssistantPreviewSnapshot, emptyAssistantPreviewSnapshot);
  const bubble = useRef<HTMLDivElement>(null), painted = useRef<string | null>(null);
  useLayoutEffect(() => { if (preview) follow(); }, [preview?.seq, follow]);
  useEffect(() => {
    if (!preview || painted.current === preview.attemptId) return;
    let first = 0, second = 0, stopped = false;
    const observe = () => {
      if (stopped || document.visibilityState !== "visible" || first || second) return;
      first = requestAnimationFrame(() => { first = 0; second = requestAnimationFrame(() => {
        second = 0;
        const node = bubble.current, rect = node?.getBoundingClientRect();
        if (stopped || document.visibilityState !== "visible" || !node?.isConnected || !rect || rect.width <= 0 || rect.height <= 0
          || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return;
        painted.current = preview.attemptId; void model.paintAssistantPreview(preview);
      }); });
    };
    observe(); document.addEventListener("visibilitychange", observe); window.addEventListener("scroll", observe, { capture: true, passive: true });
    return () => { stopped = true; cancelAnimationFrame(first); cancelAnimationFrame(second);
      document.removeEventListener("visibilitychange", observe); window.removeEventListener("scroll", observe, true); };
  }, [model, preview?.attemptId, preview?.itemId]);
  if (!preview) return null;
  return <div className="wsd-message-group wsd-assistant-draft" data-attempt-id={preview.attemptId} data-preview-seq={preview.seq}>
    <div className="hs-who">{agent?.identity.displayName ?? "Hara"} <WorkspaceDraftTiming model={model} t={t} /></div>
    <div className="hs-msg wsd-message is-agent"><Avatar agent={agent} /><div ref={bubble} className="hs-bub wsd-bubble wsd-preview-text" aria-label={t("ws.preview.label")}>{preview.text}</div></div>
  </div>;
}
const emptyWaitTimingSnapshot = () => null;

export function WorkspaceScreen({ model, disconnected, onReconnect, root, mode, onOpenBrowser }: { model: WorkspaceDevModel; disconnected: string; onReconnect: () => void; root: string;
  mode: "workspace" | "lab"; onOpenBrowser?: () => void }) {
  const rawView = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const localWait = useSyncExternalStore(model.subscribeWaitTiming, model.getWaitTimingSnapshot, emptyWaitTimingSnapshot);
  const channels = useMemo(() => new WorkspaceLocalChannelsModel(model), [model]);
  const channelView = useSyncExternalStore(channels.subscribe, channels.getSnapshot, channels.getSnapshot);
  const [channelDialog, setChannelDialog] = useState<"create" | "members" | "invite" | null>(null);
  const channelApprovalActions = useMemo(() => ({ respond: (card: WorkspaceDevApproval, approved: boolean) => channels.respond(card, approved),
    getSnapshot: () => ({ workspace: { approvals: channels.getSnapshot().channel?.approvals ?? [] } }) }), [channels]);
  const { locale, t } = useWorkspaceLocale();
  const view = useMemo(() => localizedWorkspaceView(rawView, locale), [rawView, locale]);
  const [settings, setSettingsState] = useState(false), [creating, setCreating] = useState(false), [name, setName] = useState(() => t("ws.space.default"));
  const [search, setSearch] = useState("");
  const [route, setRoute] = useState(() => normalizeShellRoute(typeof location === "undefined" ? "" : location.hash));
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; scope: string } | null>(null), [focusApproval, setFocusApproval] = useState<string | null>(null);
  const theme = useStableWorkspaceTheme(model);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("overview"), [browser, setBrowser] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false), [findOpen, setFindOpen] = useState(false), [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState({ count: 0, index: 0 });
  const [exporting, setExporting] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false), [attaching, setAttaching] = useState(false);
  const mentionMenu = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null), manageButton = useRef<HTMLButtonElement>(null);
  const [undoNotice, setUndoNotice] = useState<UndoNotice | null>(null), [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ agent: WorkspaceDevAgent; status: WorkspaceDevArchiveStatus; scope: string } | null>(null);
  const toastCounter = useRef(0);
  const [workspaceRename, setWorkspaceRename] = useState<string | null>(null), [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceRenameBusy, setWorkspaceRenameBusy] = useState(false);
  const [inlineRename, setInlineRename] = useState<{ id: string; name: string; kind: "colleague" | "group"; pending: boolean } | null>(null);
  const r = (key: Parameters<typeof redesignText>[1], values: Record<string, string | number> = {}) => redesignText(locale, key, values);
  const [rosterMenu, setRosterMenu] = useState<{ workspaceId: string; agentId: string; kind?: "colleague" | "group"; x: number; y: number } | null>(null);
  const [rosterPrefs, setRosterPrefs] = useState<Record<string, RosterPreference>>({});
  const [rosterPrefsWorkspaceId, setRosterPrefsWorkspaceId] = useState<string | null>(null);
  const [rosterMove, setRosterMove] = useState<WorkspaceDevAgent | null>(null), [sectionName, setSectionName] = useState("");
  const [renameAgentId, setRenameAgentId] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), nearBottom = useRef(true), selectedRow = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null), scrollContext = useRef("");
  const scrollResume = useRef<{ key: string; top: number; atBottom: boolean } | null>(null);
  const routedScope = useRef<string | null>(null);
  const channelRouteSelection = useRef<string | null>(null);
  const workspace = view.workspace, agents = workspace?.agents ?? view.roster, agent = agents.find(row => row.agentId === view.agentId);
  const stageReports = useMemo(() => model.runtimeStageReports(), [model, workspace]);
  const followPreview = useCallback(() => { if (nearBottom.current) end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, []);
  const exportStageReport = useCallback((report: RuntimeStageReport) => model.exportRuntimeDiagnostic(report), [model]);
  const listBotModels = useCallback((runtimeId: string) => model.listRuntimeModels(runtimeId), [model]);
  const listConnectionModels = useCallback((agentId: string, connectionId: string) => model.listConnectionModels(agentId, connectionId), [model]);
  const colleagues = useMemo(() => agents.filter(row => row.kind === "colleague" && row.state !== "archived"), [agents]);
  // readOverview admits only the controller's own snapshot object; the localized projection is a renderer-only copy.
  const shell = useWorkspaceOverview(model, rawView.workspace);
  // Agent loading temporarily clears the snapshot. Keep view-only notices within this exact
  // Workspace generation; model/RPC methods still require a current authoritative snapshot.
  const retainedScope = useRef({ workspaceId: "", value: "" });
  if (workspace) retainedScope.current = { workspaceId: workspace.workspaceId, value: JSON.stringify([workspace.workspaceId, workspace.resourceGeneration]) };
  else if (view.workspaceId !== retainedScope.current.workspaceId) retainedScope.current = { workspaceId: view.workspaceId ?? "", value: "" };
  const scope = retainedScope.current.value;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => { setArchiveConfirm(null); }, [scope]);
  const hostChannelSelected = useRef(false);
  const activeRosterPrefs = rosterPrefsWorkspaceId === workspace?.workspaceId ? rosterPrefs : {};
  useEffect(() => { setRosterMenu(null); setArchiveConfirm(null); setRosterMove(null);
    try { const saved: unknown = JSON.parse(localStorage.getItem(`hara.roster.${workspace?.workspaceId}`) || "{}");
      setRosterPrefs(saved && typeof saved === "object" && !Array.isArray(saved) ? saved as typeof rosterPrefs : {});
    } catch { setRosterPrefs({}); }
    setRosterPrefsWorkspaceId(workspace?.workspaceId ?? null);
  }, [workspace?.workspaceId]);
  const updateRosterPref = (agentId: string, change: RosterPreference) => {
    const next = { ...activeRosterPrefs, [agentId]: { ...activeRosterPrefs[agentId], ...change } }; setRosterPrefs(next);
    setRosterPrefsWorkspaceId(workspace?.workspaceId ?? null);
    try { if (workspace) localStorage.setItem(`hara.roster.${workspace.workspaceId}`, JSON.stringify(next)); } catch { /* view preference only */ }
  };
  const scheduleSupported = model.supportsColleagueSchedules?.() === true;
  const [features, setScheduleFeatures] = useState<WorkspaceFeatureView | null>(null);
  const [featuresError, setScheduleLoadError] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<{ id: string; scope: string; agentId: string; draft: ColleagueScheduleDraft } | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState<{ scope: string; agentId: string; name: string } | null>(null);
  const refreshFeatures = useCallback(async () => {
    try { const value = await model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list"); setScheduleFeatures(value); setScheduleLoadError(""); return value; }
    catch (cause) { setScheduleLoadError(cause instanceof Error ? cause.message : String(cause)); return null; }
  }, [model]);
  useEffect(() => { setScheduleFeatures(null); setScheduleLoadError(""); if (scope && scheduleSupported) void refreshFeatures(); }, [scope, scheduleSupported, refreshFeatures]);
  const busy = Boolean(workspace && ["running", "draining"].includes(workspace.conversation.state));
  const hasConnection = Boolean(workspace?.connections.defaultConnectionId), realKey = view.directory?.executionMode === "ark-real-key", production = view.directory?.executionMode === "workspace";
  const accountUsage = new Map((workspace?.accountUsage ?? []).map(row => [row.agentId, row]));
  const selectedUsage = colleagueUsageView(accountUsage.get(view.agentId ?? ""), locale);
  const updates = useWorkspaceUpdater(model, production);
  const inChannel = route.section === "channel";
  const showColleagueInspector = inspector && !browser && route.section === "chat" && !!agent && (agent.kind === "colleague" || agent.kind === "main");
  const showGroupInspector = inspector && !browser && inChannel;
  const showContextInspector = inspector && !browser && route.section !== "chat" && !inChannel;
  const selectedChannel = inChannel ? channelView.channel?.channel ?? channelView.catalog?.channels.find(row => row.id === route.channelId) : undefined;
  const detailedChannel = theme.settings?.executionDetails === "detailed" && theme.settings?.collapseDetails === false;
  const renderChannelTranscript = useCallback((messages: WorkspaceDevMessage[], author?: WorkspaceDevAgent) => <Transcript media={model} locale={locale} history={messages} agent={author} t={t} detailed={detailedChannel} />, [model, t, detailedChannel, locale]);
  const channelFollowing = useCallback((following: boolean) => { nearBottom.current = following; }, []);
  useEffect(() => { void channels.bind(workspace?.workspaceId ?? "", workspace?.resourceGeneration ?? ""); setChannelDialog(null); }, [channels, scope]);
  useEffect(() => { if (workspace) void channels.refresh(); }, [channels, workspace]);
  useEffect(() => {
    if (!scope || channelView.scope !== scope || !channelView.catalog) return;
    let next = route;
    if (routedScope.current !== scope) {
      const initial = routedScope.current === null; routedScope.current = scope;
      if (!initial || route.section === "chat") {
        const preferred = channels.preferredChannelId();
        if (preferred && channelView.catalog.channels.some(row => row.id === preferred)) next = { section: "channel", tab: "people", channelId: preferred };
        else if (!initial && route.section === "channel") next = { section: "chat", tab: "people" };
        if (next !== route) {
          setRoute(next);
          const hash = next.section === "channel" ? `#channels/${next.channelId}` : "";
          history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
        }
      }
    }
    if (next.section !== "channel" || !next.channelId || !channelView.catalog.channels.some(row => row.id === next.channelId)) { channelRouteSelection.current = null; return; }
    const selection = JSON.stringify([scope, next.channelId]);
    // Reconcile a route once. An accepted create may select its new room before onCreated updates the URL.
    if (channelRouteSelection.current === selection) return;
    channelRouteSelection.current = selection;
    if (channelView.channelId !== next.channelId) { hostChannelSelected.current = true; void channels.select(next.channelId); }
  }, [channels, scope, route, channelView.scope, channelView.catalog, channelView.channelId]);
  useEffect(() => { if (!["running", "draining"].includes(channelView.channel?.state ?? "")) return;
    const timer = setInterval(() => { void channels.refresh(); }, 1000); return () => clearInterval(timer);
  }, [channels, channelView.channel?.state]);
  scrollContext.current = JSON.stringify([scope, view.agentId, route]);
  const setSettings = (open: boolean) => {
    if (open && scroll.current) scrollResume.current = { key: scrollContext.current, ...captureWorkspaceReadingPosition(scroll.current) };
    setSettingsState(open);
  };
  useLayoutEffect(() => {
    if (settings || !scrollResume.current || !scroll.current) return;
    const saved = scrollResume.current; scrollResume.current = null;
    if (saved.key === scrollContext.current) scroll.current.scrollTop = saved.atBottom ? scroll.current.scrollHeight : saved.top;
  }, [settings]);

  useEffect(() => { setBrowser(false); }, [scope]);
  const connect = () => production ? (setSettingsPage("connections"), setSettings(true)) : realKey ? model.addApprovedConnection() : model.addSynthetic();
  const canSend = Boolean(workspace && agent?.state === "active" && hasConnection && (!view.runtimeBlocked || workspace.conversation.pendingQuestion) && view.draft.trim() && !view.sending && !view.runtimeChanging && !busy && !view.pendingUnknown && !disconnected);
  // One composer: a pending sync question takes the draft as its answer; a lone async ask takes it while the run continues.
  const question = workspace?.conversation.pendingQuestion ?? null;
  const asyncAsks = workspace && model.supportsAsyncQuestions?.() === true ? workspaceAsyncAsks(workspace.conversation) : [];
  const asyncTarget = busy && asyncAsks.length === 1 ? asyncAsks[0] : null;
  const canAnswerAsync = Boolean(asyncTarget && view.draft.trim() && !disconnected);
  const submitComposer = () => {
    if (asyncTarget) { if (canAnswerAsync) void model.answerAsync(asyncTarget.requestId, view.draft, true); }
    else if (canSend) {
      const draft = !question && scheduleSupported && agent?.kind === "colleague" ? parseColleagueScheduleRequest(view.draft) : null;
      if (draft && agent && scope) {
        setPendingSchedule({ id: crypto.randomUUID(), scope, agentId: agent.agentId, draft });
        setScheduleError(""); setScheduleNotice(null); model.setDraft(""); setInspector(true);
        return;
      }
      void (question ? model.answerDraft() : model.send());
    }
  };
  const confirmSchedule = async () => {
    const pending = pendingSchedule;
    if (!pending || scheduleBusy || !scheduleSupported || pending.scope !== scope || pending.agentId !== workspace?.selectedAgentId || agent?.kind !== "colleague") return;
    setScheduleBusy(true); setScheduleError("");
    try {
      const current = features ?? await refreshFeatures();
      if (!current) throw new Error(t("ws.scheduleDraft.unavailable"));
      const value = await model.workspaceRequest<WorkspaceFeatureView>("workspace.schedule.save", { input: {
        id: pending.id, name: pending.draft.name.trim(), schedule: { kind: "cron", expr: pending.draft.schedule.trim() },
        task: pending.draft.task.trim(), tz: pending.draft.tz.trim(), agentId: pending.agentId, enabled: true,
      }, expectedRevision: current.revision, approved: true });
      setScheduleFeatures(value); setPendingSchedule(null); setScheduleNotice({ scope, agentId: pending.agentId, name: pending.draft.name });
    } catch (cause) {
      const current = await refreshFeatures();
      if (current?.schedules.some((row) => row.id === pending.id && row.agentId === pending.agentId)) {
        setPendingSchedule(null); setScheduleNotice({ scope, agentId: pending.agentId, name: pending.draft.name });
      } else setScheduleError(cause instanceof Error ? cause.message : String(cause));
    } finally { setScheduleBusy(false); }
  };
  const updateColleagueSchedule = async (method: string, extra: Record<string, unknown>, ownerAgentId: string | undefined) => {
    const current = features;
    if (!current || !workspace || agent?.kind !== "colleague" || ownerAgentId !== agent.agentId) throw new Error("Colleague schedule context changed");
    const value = await model.workspaceRequest<WorkspaceFeatureView>(method, { ...extra, expectedRevision: current.revision });
    setScheduleFeatures(value); setScheduleLoadError("");
    if (method === "workspace.features.update") await refreshFeatures();
  };
  const navigate = (section: "chat" | "workspace" | "colleagues", tab: "people" | "tasks" = "people") => {
    channels.clearSelection();
    setRoute({ section, tab });
    const hash = section === "chat" ? "" : section === "workspace" ? "#workspace" : tab === "tasks" ? "#colleagues/tasks" : "#colleagues";
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  };
  const openChannel = async (channelId: string) => {
    setRoute({ section: "channel", tab: "people", channelId });
    history.replaceState(null, "", `${location.pathname}${location.search}#channels/${channelId}`);
    if (channels.getSnapshot().channelId !== channelId || !channels.getSnapshot().channel) { hostChannelSelected.current = true; await channels.select(channelId); }
  };
  useEffect(() => {
    const update = () => { const next = normalizeShellRoute(location.hash); if (next.section !== "channel") channels.clearSelection(); setRoute(next); };
    window.addEventListener("hashchange", update);
    if (/^#\/?tasks$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#colleagues/tasks`);
    return () => window.removeEventListener("hashchange", update);
  }, [channels]);
  useEffect(() => { if (nearBottom.current && route.section === "chat") end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [workspace?.conversation.history.length, workspace?.approvals.length, workspace?.conversation.pendingQuestion?.id, busy, route.section]);
  useEffect(() => { if (nearBottom.current && inChannel && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [channelView.channel?.messages.length, channelView.channel?.approvals.length, channelView.channel?.state, inChannel]);
  useEffect(() => { if (inChannel) { nearBottom.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; } }, [channelView.channelId, inChannel]);
  // workspace.changed push coalesces refreshes; Startup reconnect performs a fresh snapshot.
  // Live seconds belong to WaitElapsed, never to a whole-conversation poll.
  useEffect(() => {
    if (disconnected || inChannel || !busy) return;
    return model.watchStaleConversation();
  }, [model, disconnected, inChannel, busy]);
  useEffect(() => { nearBottom.current = true; if (workspace?.selectedAgentId && route.section === "chat") input.current?.focus(); }, [workspace?.selectedAgentId, route.section]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || (!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== "i" || settings || creating || workspaceRename || channelDialog || approvalDialog) return;
      event.preventDefault(); setBrowser(false); setInspector(value => browser || !value);
    };
    const closeNarrow = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || window.innerWidth >= 1100 || settings || creating || workspaceRename || channelDialog || approvalDialog) return;
      if (inspector) { setInspector(false); manageButton.current?.focus(); }
      // Errata S1b: the narrow browser overlay closes like the manage drawer, unless a control consumed Escape.
      else if (browser && !event.defaultPrevented) { setBrowser(false); moreRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    document.addEventListener("keydown", shortcut); document.addEventListener("keydown", closeNarrow);
    return () => { document.removeEventListener("keydown", shortcut); document.removeEventListener("keydown", closeNarrow); };
  }, [inspector, browser, settings, creating, workspaceRename, channelDialog, approvalDialog]);
  useEffect(() => { hostChannelSelected.current = false; setMoreOpen(false); setFindOpen(false); setFindQuery(""); setUndoNotice(null); setInlineRename(null); setWorkspaceRename(null); }, [scope]);
  useEffect(() => { if (!moreOpen) return; moreRef.current?.querySelector<HTMLButtonElement>('[role="menu"] button')?.focus();
    const outside = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [moreOpen]);
  useLayoutEffect(() => { const node = input.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(160, Math.max(32, node.scrollHeight))}px`; }, [view.draft, workspace?.selectedAgentId, route.section, workspace?.conversation.pendingQuestion?.id]);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [view.agentId, view.workspaceId, route.section]);
  useEffect(() => {
    if (!focusApproval || !workspace) return;
    const node = document.getElementById(`approval-${focusApproval}`);
    if (node) { node.scrollIntoView({ block: "nearest" }); node.focus(); setFocusApproval(null); }
  }, [focusApproval, workspace]);
  useEffect(() => {
    const open = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSettings(true); } };
    window.addEventListener("keydown", open); return () => window.removeEventListener("keydown", open);
  }, []);
  const openAgent = async (agentId: string, approvalId?: string, confirm = false) => {
    const expected = model.getSnapshot().workspace;
    if (!expected || disconnected) return; navigate("chat");
    // Reselecting the same private controller would dismiss its live approvals. Navigation back
    // from Tasks/Manage only refreshes; returning from a group must explicitly bind the private view.
    if (expected.selectedAgentId === agentId && !hostChannelSelected.current) await model.refresh();
    else { await model.selectAgent(agentId); hostChannelSelected.current = false; }
    const current = model.getSnapshot().workspace;
    if (!current || current.workspaceId !== expected.workspaceId || current.resourceGeneration !== expected.resourceGeneration || current.selectedAgentId !== agentId) return;
    if (approvalId) {
      setFocusApproval(approvalId);
      if (confirm && pendingApprovals(current, Date.now()).some(card => card.id === approvalId)) setApprovalDialog({ id: approvalId, scope: JSON.stringify([current.workspaceId, current.resourceGeneration]) });
    }
  };
  const openItem = (item: AwaitItem, confirm = false) => { void openAgent(item.agentId, item.approval?.id, confirm); };
  const discuss = async () => {
    const expected = model.getSnapshot().workspace, main = expected?.agents.find(row => row.kind === "main");
    if (!expected || !main) return; await openAgent(main.agentId);
    const current = model.getSnapshot().workspace;
    if (current?.workspaceId === expected.workspaceId && current.resourceGeneration === expected.resourceGeneration && current.selectedAgentId === main.agentId) model.setDraft(t("ws.colleagues.prompt"));
  };
  const create = async () => { await model.createWorkspace(name); if (!model.getSnapshot().error) { setCreating(false); navigate("chat"); } };
  const timeline = workspace ? conversationTimeline([workspace], workspace.selectedAgentId, shell.now) : [];
  const liveApprovals = timeline.flatMap(item => item.kind === "approval" ? [item.approval] : []);
  const dialogCard = approvalDialog?.scope === scope ? liveApprovals.find(card => card.id === approvalDialog.id) : undefined;
  const dmRows = useMemo(() => colleagues.map(row => {
    const snapshot = shell.snapshots.find(value => value.selectedAgentId === row.agentId);
    const last = rosterConversationActivity(snapshot?.conversation.history ?? []);
    return { agent: row, preview: last.preview, timestamp: last.timestamp,
      order: Date.parse(last.timestamp ?? "") || shell.activity[row.agentId]?.observedAt || 0 };
  }).sort((a, b) => b.order - a.order), [colleagues, shell.snapshots, shell.activity]);
  const closeSettings = () => { setSettings(false); };
  const openSettingsPage = (page: SettingsPage) => { setSettingsPage(page); setSettings(true); };
  const modalOpen = settings || creating || !!workspaceRename || !!channelDialog || !!rosterMove || approvalDialog?.scope === scope || archiveConfirm?.scope === scope;
  useEffect(() => { if (mentionOpen) mentionMenu.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [mentionOpen]);
  const attachReference = async () => {
    if (attaching || disconnected) return; setAttaching(true); const selectedScope = model.mediaScope;
    try { const file = await chooseFile({ multiple: false, directory: false, filters: [{ name: r("attach"), extensions: ["gif", "png", "jpg", "jpeg", "webp", "mp4", "m4v", "mov", "webm", "pdf", "zip", "xlsx", "md", "txt"] }] });
      if (typeof file !== "string" || selectedScope !== model.mediaScope) return;
      const description = await model.describeMedia(file, selectedScope);
      if (description.state !== "ready") { setUndoNotice({ id: ++toastCounter.current, scope, text: r(description.state === "outside" ? "outside" : description.state === "missing" ? "moved" : description.reason === "symlink" ? "mediaSymlink" : description.reason === "path_spelling" ? "mediaSpelling" : "fileRefFailed") }); return; }
      const next = `${model.getSnapshot().draft.trimEnd()}\n${file}\n`; if (next.length > 24000) throw new Error("Draft exceeds limit");
      model.setDraft(next); input.current?.focus();
    } catch { setUndoNotice({ id: ++toastCounter.current, scope, text: r("fileRefFailed") }); }
    finally { setAttaching(false); }
  };
  const findMessage = (index: number) => { if (scroll.current) setFindResult(findTranscriptMatch(scroll.current, findQuery, index)); };
  useEffect(() => { if (findOpen) findMessage(0); }, [findOpen, findQuery, workspace?.conversation.revision, channelView.channel?.revision]);
  const exportConversation = async () => {
    if (!workspace || exporting) return; setExporting(true);
    const channelMessages = inChannel ? channelView.channel?.messages ?? [] : null;
    const messages = channelMessages?.map(row => row.message) ?? workspace.conversation.history;
    const authors = channelMessages?.map(row => row.message.role === "user" && row.displayName === "You" ? r("exportYou") : row.displayName || r("unknownAuthor"));
    try { const saved = await invoke<boolean>("workspace_export_conversation", { text: conversationMarkdown(messages, inChannel ? selectedChannel?.name ?? "Hara" : agent?.identity.displayName ?? "Hara",
      { historyStart: inChannel ? 0 : view.localHistoryStart, userLabel: r("exportYou"), authors }) });
      if (saved) setUndoNotice({ id: ++toastCounter.current, scope, text: r("exported") });
    } catch { setUndoNotice({ id: ++toastCounter.current, scope, text: r("exportFailed") }); }
    finally { setExporting(false); }
  };
  const draftSkill = async (workspaceId: string) => {
    if (model.getSnapshot().workspaceId !== workspaceId) await model.selectWorkspace(workspaceId);
    const current = model.getSnapshot().workspace;
    if (current?.workspaceId !== workspaceId) return;
    const main = current.agents.find(row => row.kind === "main");
    if (main) await model.selectAgent(main.agentId);
    if (model.getSnapshot().workspaceId !== workspaceId) return;
    closeSettings(); navigate("chat"); model.setDraft(t("skillCreationPrompt"));
  };
  // Keep only speaker identities in memory; leaving a group does not shuffle its avatar back.
  const [groupSpeakers, setGroupSpeakers] = useState<{ scope: string; ids: Record<string, string[]> }>({ scope: "", ids: {} });
  useEffect(() => {
    const channel = channelView.channel;
    if (!channel || channelView.scope !== scope) return;
    const ids = [...new Set([...channel.messages].reverse().flatMap(row => row.agentId && rosterConversationActivity([row.message]).preview ? [row.agentId] : []))];
    setGroupSpeakers(previous => {
      const current = previous.scope === scope ? previous.ids : {};
      if (JSON.stringify(current[channel.channel.id]) === JSON.stringify(ids)) return previous;
      return { scope, ids: { ...current, [channel.channel.id]: ids } };
    });
  }, [channelView.channel, channelView.scope, scope]);
  const rosterEntries: SidebarEntry[] = [
    ...dmRows.map(row => ({ id: row.agent.agentId, kind: "colleague" as const, name: row.agent.identity.displayName, role: row.agent.identity.title ?? "", shortRole: row.agent.identity.shortTitle, needsYou: shell.waiting.filter(item => item.agentId === row.agent.agentId).length, preview: row.preview, timestamp: row.timestamp, order: row.order, unread: shell.activity[row.agent.agentId]?.unread ?? 0, agent: row.agent })),
    ...(channelView.catalog?.channels ?? []).map(row => { const timestamp = row.lastMessageAt ?? row.createdAt, key = `channel:${row.id}`, read = activeRosterPrefs[key]?.readCount;
      return { id: key, kind: "group" as const, name: row.name, role: r(row.memberIds.length === 1 ? "groupMember" : "groupMembers", { n: row.memberIds.length }), members: rosterGroupMembers(row.memberIds.map(id => { const member = agents.find(agent => agent.agentId === id); return { id, accent: agentAvatarAccent(id, member?.identity) }; }), groupSpeakers.scope === scope ? groupSpeakers.ids[row.id] : []), preview: row.activityAvailable === false ? r("activityUnavailable") : row.preview || r("noMessages"), timestamp, order: Date.parse(timestamp) || 0,
        unread: inChannel && channelView.channelId === row.id ? 0 : typeof read === "number" && typeof row.messageCount === "number" ? Math.max(0, row.messageCount - read) : 0 }; }),
  ];
  useEffect(() => {
    if (!workspace || rosterPrefsWorkspaceId !== workspace.workspaceId || !channelView.catalog) return;
    const next = { ...activeRosterPrefs }; let changed = false;
    for (const row of channelView.catalog.channels) {
      const key = `channel:${row.id}`, count = row.messageCount ?? 0;
      if (next[key]?.readCount === undefined || inChannel && channelView.channelId === row.id && next[key]?.readCount !== count) { next[key] = { ...next[key], readCount: count }; changed = true; }
    }
    if (changed) { setRosterPrefs(next); try { localStorage.setItem(`hara.roster.${workspace.workspaceId}`, JSON.stringify(next)); } catch { /* local view preference only */ } }
  }, [channelView.catalog, inChannel, channelView.channelId, rosterPrefsWorkspaceId]);
  const menuGroup = rosterMenu?.kind === "group" ? channelView.catalog?.channels.find(row => `channel:${row.id}` === rosterMenu.agentId) : undefined;
  const menuAgent = workspace && rosterMenu?.workspaceId === workspace.workspaceId ? menuGroup ? { agentId: rosterMenu.agentId, kind: "colleague" as const, state: "active", identity: { displayName: menuGroup.name }, runtime: { id: "pi", label: "Pi", available: true } } : agents.find(row => row.agentId === rosterMenu?.agentId) : undefined;
  const folderOptions = [...new Set(Object.values(activeRosterPrefs).map(pref => pref.section).filter((value): value is string => Boolean(value)))].sort();
  const mainAgent = agents.find(row => row.kind === "main");
  const mainSnapshot = shell.snapshots.find(row => row.selectedAgentId === mainAgent?.agentId);
  const mainActivity = rosterConversationActivity(mainSnapshot?.conversation.history ?? []);
  const mainEntry: SidebarEntry | undefined = mainAgent ? { id: mainAgent.agentId, kind: "colleague", name: mainAgent.identity.displayName, role: r("orchestrator"), preview: mainActivity.preview, timestamp: mainActivity.timestamp, order: 0,
    unread: shell.activity[mainAgent.agentId]?.unread ?? 0, needsYou: shell.waiting.filter(item => item.agentId === mainAgent.agentId).length, agent: mainAgent } : undefined;
  const hideRoster = (target: WorkspaceDevAgent) => {
    const hidden = !activeRosterPrefs[target.agentId]?.hidden; updateRosterPref(target.agentId, { hidden });
    if (hidden) setUndoNotice({ id: ++toastCounter.current, scope, text: r("hiddenNotice", { name: target.identity.displayName }), undo: () => updateRosterPref(target.agentId, { hidden: false }) });
  };
  const archiveRoster = async (target: WorkspaceDevAgent, confirmed?: WorkspaceDevArchiveStatus) => {
    if (archiveBusy) return; const operationScope = scope; setArchiveBusy(true);
    try {
      const status = confirmed ?? await model.agentArchiveStatus(target);
      if (scopeRef.current !== operationScope || status.workspaceId !== workspace?.workspaceId || status.resourceGeneration !== workspace?.resourceGeneration) return;
      if (!confirmed && status.runs.length) { setArchiveConfirm({ agent: target, status, scope: operationScope }); return; }
      setArchiveConfirm(null);
      const result = await model.setAgentArchived(target, true, status);
      if (scopeRef.current !== operationScope) return;
      const schedules = result.pausedSchedules ? r("pausedSchedules", { n: result.pausedSchedules }) : "";
      const stopped = result.stoppedTasks ?? status.runs.length;
      const note = result.pausedSchedules || stopped ? ` ${r("undoArchiveWarning")}` : "";
      setUndoNotice({ id: ++toastCounter.current, scope: operationScope, text: r("deletedNotice", { name: target.identity.displayName, schedules }) + note,
        undo: async () => { await model.setAgentArchived(result.agent, false); } });
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      const reason = error && typeof error === "object" && "archiveReason" in error ? error.archiveReason : null;
      setArchiveConfirm(null); setUndoNotice({ id: ++toastCounter.current, scope: operationScope,
        text: r(reason === "archive_drain_timeout" ? "archiveDrainTimeout" : reason === "archive_confirmation_required" ? "archiveRunsChanged" : reason === "archive_schedule_rollback_failed" ? "archiveRollbackFailed" : "archiveFailed") });
    } finally { setArchiveBusy(false); }
  };
  const commitRename = async () => {
    if (!inlineRename?.name.trim() || inlineRename.pending) return;
    const editing = inlineRename, editingScope = scope; setInlineRename({ ...editing, pending: true });
    try {
      if (editing.kind === "group") { const id = editing.id.slice(8); await openChannel(id); const current = channels.getSnapshot();
        if (scopeRef.current !== editingScope || current.scope !== editingScope || current.channelId !== id || current.channel?.channel.id !== id
          || !await channels.updateMembers(editing.name.trim(), current.channel.channel.memberIds)) throw new Error("Rename view changed"); }
      else { const target = agents.find(row => row.agentId === editing.id); if (!target) throw new Error("Rename view changed"); await model.updateAgentPersona(target, { displayName: editing.name.trim() }); }
      if (scopeRef.current === editingScope) setInlineRename(previous => previous?.id === editing.id ? null : previous);
    } catch { if (scopeRef.current === editingScope) { setInlineRename(previous => previous?.id === editing.id ? { ...previous, pending: false } : previous); setUndoNotice({ id: ++toastCounter.current, scope: editingScope, text: r("changeFailed") }); } }
  };
  const manageRosterAgent = async (target: WorkspaceDevAgent, rename = false) => {
    await openAgent(target.agentId);
    if (model.getSnapshot().workspace?.selectedAgentId === target.agentId) { setBrowser(false); setInspector(true); setRenameAgentId(rename ? target.agentId : null); }
  };
  return <div className="hs wsd-app vg-app hd-redesign" lang={locale} data-platform={workspacePlatform()} data-workspace-mode={mode}><div className="hs-frame"><div className={`hs-win${browser ? " has-browser" : showColleagueInspector || showGroupInspector || showContextInspector ? " has-inspector" : ""}`}>
    <WorkspaceSidebarC locale={locale} workspaceId={view.workspaceId} workspaceName={workspace?.label ?? t("vg.workspace")} directory={view.directory} main={mainAgent} mainPreview={mainActivity.preview} mainEntry={mainEntry}
      mainActive={route.section === "chat" && view.agentId === mainAgent?.agentId} selectedId={inChannel ? `channel:${channelView.channelId}` : route.section === "chat" ? view.agentId : null}
      rename={inlineRename ? { ...inlineRename, duplicate: agents.some(row => row.state === "active" && row.agentId !== inlineRename.id && row.identity.displayName.trim().toLocaleLowerCase() === inlineRename.name.trim().toLocaleLowerCase()) } : null}
      duplicateLabel={t("ws.approval.duplicateName")} onRenameChange={name => setInlineRename(previous => previous ? { ...previous, name } : null)} onRenameCommit={() => void commitRename()} onRenameCancel={() => setInlineRename(null)}
      entries={rosterEntries} preferences={activeRosterPrefs} search={search} needsYou={shell.waiting.length} count={colleagues.length} disconnected={Boolean(disconnected)} loading={view.loading} inert={Boolean(modalOpen)} menuOpen={Boolean(rosterMenu)} userLabel={t("ws.me")} settingsLabel={t("ws.settings")}
      onSearch={setSearch} onPreference={updateRosterPref} onSelect={(id, kind) => { updateRosterPref(id, { unread: false }); if (kind === "group") openChannel(id.slice(8)); else void openAgent(id); }}
      onContextMenu={(event, id, kind) => { if (workspace) setRosterMenu({ workspaceId: workspace.workspaceId, agentId: id, kind, x: event.clientX || event.currentTarget.getBoundingClientRect().right, y: event.clientY || event.currentTarget.getBoundingClientRect().bottom }); }}
      onNeedsYou={() => navigate("colleagues", "tasks")} onColleagues={() => navigate("colleagues", "people")} onWorkspace={id => { closeSettings(); setSearch(""); setApprovalDialog(null); navigate("chat"); void model.selectWorkspace(id); }}
      onDiscuss={() => void discuss()} onNewGroup={channelView.supported && !disconnected ? () => setChannelDialog("create") : undefined}
      onSettings={() => setSettings(true)} onAccount={() => openSettingsPage("general")} onRenameWorkspace={workspace ? () => { setWorkspaceRename(workspace.workspaceId); setWorkspaceNameDraft(workspace.label); } : undefined} />
    <main className="hs-chat wsd-chat" inert={modalOpen} onPointerDown={() => { if (inspector && window.innerWidth < 1100) setInspector(false); }}>
      <header className="hs-head wsd-header hd-header">{inChannel ? <span className="hs-ava" aria-hidden="true"><UsersIcon className="hico" /></span> : <Avatar agent={agent} />}<div className="hs-header-person"><strong>{route.section === "workspace" ? t("vg.workspace") : inChannel ? selectedChannel?.name ?? t("ws.channels.local") : route.section === "colleagues" ? t("ws.nav.colleagues") : agent?.identity.displayName ?? "Hara"}</strong>
        <small>{inChannel ? selectedChannel?.memberIds.map(id => agents.find(row => row.agentId === id)?.identity.displayName).filter(Boolean).join(" · ") : agent ? `${agent.kind === "main" ? r("orchestrator") : agent.identity.title ?? t("ws.role.colleague")} · ${agent.runtime.id === "pi" ? "Pi" : agent.runtime.label}` : t("ws.welcome.title")}</small></div><span className="sp" />
        {!inChannel && workspace && route.section === "chat" && model.supportsNativeSessions() && workspace.conversation.nativeSession ? <button type="button" className="hs-icon" aria-label={r("newSession")} data-new-native-session={model.supportsNativeSessions() && workspace.conversation.nativeSession ? "true" : undefined}
          disabled={Boolean(disconnected) || view.sending || view.runtimeChanging || view.pendingUnknown || busy || Boolean(question) || Boolean(workspace.conversation.pendingInteractions?.length)}
          onClick={() => { if (model.supportsNativeSessions() && workspace.conversation.nativeSession) void model.newNativeSession(); }}><PencilSquareIcon className="hico" /></button> : null}
        <div className="hd-header-more" ref={moreRef}><button type="button" className="hs-icon" aria-label={r("more")} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><EllipsisHorizontalIcon className="hico" /></button>
          {moreOpen ? <div className="hd-more-menu" role="menu" aria-label={r("more")} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); moreRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); } else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } }}>
            <button type="button" role="menuitem" disabled={!workspace} onClick={() => { setMoreOpen(false); setBrowser(true); onOpenBrowser?.(); }}><GlobeAltIcon className="hico" />{r("browser")}</button>
            <button type="button" role="menuitem" disabled={!workspace || exporting} onClick={() => { setMoreOpen(false); void exportConversation(); }}>{r("export")}</button>
            <button type="button" role="menuitem" disabled={!workspace} onClick={() => { setMoreOpen(false); setFindOpen(true); }}><MagnifyingGlassIcon className="hico" />{r("find")}</button>
            {inChannel ? <><button type="button" role="menuitem" disabled={!selectedChannel || !!disconnected} onClick={() => { setMoreOpen(false); setChannelDialog("members"); }}>{t("ws.channels.members")}</button><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setChannelDialog("invite"); }}>{t("ws.channels.invite")}</button></> : null}
          </div> : null}</div>
        <span className="hd-header-divider" aria-hidden="true" />{workspace ? <button type="button" ref={manageButton} className="hs-icon" aria-label={r(inspector && !browser ? "hideManage" : "manage")} aria-keyshortcuts="Meta+I Control+I" aria-expanded={inspector && !browser} aria-controls="workspace-inspector" onClick={() => { if (browser) { setBrowser(false); setInspector(true); } else setInspector(value => !value); }}><ViewColumnsIcon className="hico" /></button> : null}
      </header>
      {findOpen ? <div className="hd-find-bar" role="search"><input type="search" aria-label={r("find")} value={findQuery} autoFocus onChange={event => setFindQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setFindOpen(false); } else if (event.key === "Enter") { event.preventDefault(); findMessage(findResult.index + (event.shiftKey ? -1 : 1)); } }} /><span role="status">{findResult.count ? `${findResult.index + 1} / ${findResult.count}` : "0"}</span><button type="button" disabled={!findResult.count} aria-label={t("ws.find.previous")} onClick={() => findMessage(findResult.index - 1)}><ChevronUpIcon className="hico" /></button><button type="button" disabled={!findResult.count} aria-label={t("ws.find.next")} onClick={() => findMessage(findResult.index + 1)}><ChevronDownIcon className="hico" /></button><button type="button" onClick={() => setFindOpen(false)} aria-label={r("close")}>×</button></div> : null}
      {disconnected ? <div className="wsd-notice hd-offline-banner" role="status"><span>{r("offline")}</span><button type="button" className="hs-btn sec" onClick={onReconnect}>{r("retryNow")}</button></div> : null}
      <WorkspaceRpcErrorNotice value={view.error} technicalDetail={view.errorTechnicalDetail} locale={locale} t={t} className="wsd-notice is-error" />
      {view.syncNotice ? <div className="wsd-notice" role="status">{workspaceMessageText(t, view.syncNotice)}</div> : null}
      {agent?.kind === "colleague" && !inChannel && selectedUsage.notice ? <div className="wsd-notice hs-usage-attention" role="status">{selectedUsage.notice}</div> : null}
      {shell.incomplete && agent?.kind !== "main" && !inChannel ? <div className="wsd-notice" role="status" data-overview-incomplete>{t("ws.tasks.unavailable")}<button className="hs-btn sec" onClick={shell.refresh}>{t("ws.tasks.retry")}</button></div> : null}
      <div ref={scroll} className="hs-scroll wsd-scroll" onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 180; }}>
        {route.section === "workspace" && workspace ? <WorkspaceOverview shell={shell} agents={colleagues} t={t} onOpen={id => void openAgent(id)} />
          : inChannel && workspace ? <LocalChannelThread key={`${scope}:${channelView.channelId}`} view={channelView} colleagues={agents} t={t} retry={() => { if (route.channelId) void channels.select(route.channelId); }}
          transcript={renderChannelTranscript} model={channels} disabled={Boolean(disconnected)} scrollRoot={scroll} onFollowChange={channelFollowing} onRepair={() => { setSettingsPage("connections"); setSettings(true); }}
          approval={card => <ApprovalCard card={card} model={channelApprovalActions} t={t} locale={locale} disabled={!!disconnected} />} />
          : route.section === "colleagues" && workspace ? <ColleaguesPage shell={shell} agents={colleagues} tab={route.tab} setTab={tab => navigate("colleagues", tab)} t={t} openAgent={id => void openAgent(id)} openItem={item => openItem(item)} discuss={() => void discuss()}
            onContextMenu={(event, target) => { event.preventDefault(); setRosterMenu({ workspaceId: workspace.workspaceId, agentId: target.agentId, x: event.clientX, y: event.clientY }); }} />
          : !workspace && view.loading && view.workspaceId ? <p role="status">{t("common.loading")}</p> : !workspace ? <section className="wsd-welcome"><HaraLogo size={48} /><h1>{t("ws.welcome.title")}</h1><p>{t("ws.welcome.body")}</p>
            {!view.directory?.workspaces.some(row => row.active) ? <button className="hs-btn pri" onClick={() => setCreating(true)} disabled={view.loading}>{t("ws.welcome.create")}</button> : null}<small>{t(production ? "ws.welcome.note" : "ws.lab.note")}</small></section>
          : <div className="hs-col wsd-thread">
            {!hasConnection ? <section className="wsd-connect-card"><h2>{t("ws.connection.title")}</h2><p>{t(production ? "ws.connection.body" : realKey ? "ws.lab.real" : "ws.lab.synthetic")}</p>
              <button className="hs-btn pri" onClick={() => void connect()}>{t(production ? "ws.connection.configure" : realKey ? "ws.connection.approved" : "ws.connection.synthetic")}</button></section> : null}
            {hasConnection && !workspace.conversation.history.length ? <div className="hs-hello"><h2>{t("ws.home.title")}</h2><p>{t("ws.home.hint")}</p><div className="hs-chips"><button className="hs-chip" onClick={() => void discuss()}><UserPlusIcon className="hico" />{t("ws.home.chip.colleague")}</button>
              <button className="hs-chip" onClick={() => model.setDraft(t("ws.home.chip.tasks"))}>{t("ws.home.chip.tasks")}</button></div></div> : null}
            {workspace.conversation.nativeRisks?.length ? <aside className="wsd-notice" aria-label={t("ws.permissions.risks")}>
              <strong>{t("ws.permissions.risks")}</strong><ul>{workspace.conversation.nativeRisks.map(event => <li key={event.id}>{t(event.kind === "external-publish" ? "ws.permissions.publish" : "ws.permissions.delete")} · {t("ws.permissions.observed")}</li>)}</ul>
            </aside> : null}
            <Transcript media={model} locale={locale} onOpenAgent={id => { if (agents.some(row => row.agentId === id && row.state === "active")) void openAgent(id); }} history={workspace.conversation.history.slice(view.localHistoryStart)} agent={agent} t={t} detailed={theme.settings?.executionDetails === "detailed" && theme.settings?.collapseDetails === false}
              conversation={workspace.conversation} compactions={workspace.conversation.contextCompactions} messageTimings={workspace.conversation.messageTimings} alwaysShowTimingDiagnostics={theme.settings?.alwaysShowTimingDiagnostics === true} stages={stageReports} historyOffset={view.localHistoryStart} onExportStage={exportStageReport} stageDisabled={Boolean(disconnected) || view.loading} />
            <WorkspaceOptimisticMessage model={model} t={t} />
            {!disconnected ? <AssistantDraft model={model} agent={agent} t={t} follow={followPreview} /> : null}
            {pendingSchedule?.scope === scope && pendingSchedule.agentId === agent?.agentId ? <section className="vg-chat-schedule-card" aria-label={t("ws.scheduleDraft.title")}>
              <header><strong>{t("ws.scheduleDraft.title")}</strong><small>{t("ws.scheduleDraft.colleague")} · {agent.identity.displayName}</small></header>
              <label>{t("ws.scheduleDraft.name")}<input maxLength={60} value={pendingSchedule.draft.name} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, name: event.target.value } })} /></label>
              <label>{t("ws.scheduleDraft.cron")}<input value={pendingSchedule.draft.schedule} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, schedule: event.target.value } })} /></label>
              <label>{t("ws.scheduleDraft.tz")}<input value={pendingSchedule.draft.tz} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, tz: event.target.value } })} /></label>
              <label>{t("ws.scheduleDraft.instruction")}<textarea rows={3} value={pendingSchedule.draft.task} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, task: event.target.value } })} /></label>
              {scheduleError ? <p role="alert">{scheduleError}</p> : null}
              <div className="vg-chat-schedule-actions"><button disabled={scheduleBusy || !pendingSchedule.draft.name.trim() || !pendingSchedule.draft.schedule.trim() || !pendingSchedule.draft.task.trim()} onClick={() => void confirmSchedule()}>{scheduleBusy ? t("ws.scheduleDraft.creating") : t("ws.scheduleDraft.create")}</button><button disabled={scheduleBusy} onClick={() => { model.setDraft(pendingSchedule.draft.task); setPendingSchedule(null); setScheduleError(""); }}>{t("ws.rf.cancel")}</button></div>
            </section> : null}
            {scheduleNotice?.scope === scope && scheduleNotice.agentId === agent?.agentId && !pendingSchedule ? <p className="vg-schedule-notice" role="status">{t("ws.scheduleDraft.createdNotice", { name: scheduleNotice.name })}</p> : null}
            {liveApprovals.map(card => <ApprovalCard key={card.id} card={card} model={model} t={t} locale={locale} onRestoreArchived={model.supportsAgentArchive() ? async target => { await model.setAgentArchived(target, false); } : undefined} disabled={Boolean(disconnected)} />)}
            {!compactFailureHandled(workspace.conversation, currentWaitReport(workspace.conversation, stageReports, localWait)) ? <WorkspaceTaskRecovery runtimeStages={stageReports} conversation={workspace.conversation} t={t} disabled={Boolean(disconnected) || view.sending || view.runtimeChanging || view.pendingUnknown}
              runtimeVersion={runtimeVersionFor(workspace.runtimes?.options, agent?.runtime.id)}
              runtimeId={agent?.runtime.id} loginSource={workspace.runtimes?.options.find(row => row.runtimeId === agent?.runtime.id)?.loginSource} onLogin={() => openSettingsPage("runtimes")} onRescan={() => void model.detectRuntimes().catch(() => {})}
              onRuntimeSettings={() => openSettingsPage("runtimes")}
              onNewSession={model.supportsNativeSessions() && workspace.conversation.nativeSession ? () => void model.newNativeSession() : undefined}
              continueDisabled={!hasConnection || view.runtimeBlocked || busy} dismissedIdentity={view.dismissedRecoveryIdentity}
              onContinue={() => void model.send(true)} onRepair={() => { setSettingsPage("connections");setSettings(true); }}
              runtimeUpdate={(() => { const row = workspace.runtimes?.options.find(item => item.runtimeId === agent?.runtime.id);
                return agent && model.supportsRuntimeForm?.() && row?.use === "confirm_update" && row.fingerprint ? { engine: agent.runtime.label, version: row.version } : null; })()}
              onConfirmUpdate={() => { const row = workspace.runtimes?.options.find(item => item.runtimeId === agent?.runtime.id);
                if (!agent || !row?.fingerprint) return;
                void model.applyRuntimeForm(agent, { runtimeId: agent.runtime.id as AgentRuntimeId, confirm: { fingerprint: row.fingerprint, loginSource: row.loginSource ?? "host" } })
                  .then(result => { if (!result.failed) void model.send(true); }).catch(() => { /* The card stays; Settings shows the reason. */ }); }}
              onDismiss={() => model.dismissRecovery()} /> : null}
            {question ? <WorkspaceUserQuestion key={`${scope}:${question.id}`} conversation={workspace.conversation} t={t}
              disabled={Boolean(disconnected) || view.sending || view.pendingUnknown} supported={model.supportsUserQuestions?.() === true}
              onTypeAnswer={() => input.current?.focus()} onAnswer={(questionId, answer) => void model.answer(questionId, answer)} onPause={questionId => void model.pauseQuestion(questionId)} onRepair={() => { setSettingsPage("connections"); setSettings(true); }} /> : null}
            <WorkspaceWaiting key={`${scope}:${workspace.conversation.sessionId}`} model={model} t={t} name={agent?.identity.displayName ?? "Hara"} runtime={agent?.runtime.label ?? "Hara"} disabled={Boolean(disconnected) || view.runtimeChanging}
              onSettings={() => openSettingsPage("runtimes")} /><div ref={end} />
          </div>}
      </div>
      {workspace && inChannel ? <LocalChannelComposer showAutonomy={false} key={`${scope}:${channelView.channelId}`} view={channelView} model={channels} colleagues={colleagues} t={t} disconnected={!!disconnected} hasConnection={hasConnection} configure={() => void connect()} /> : null}
      {workspace && route.section === "chat" ? <footer className="hs-compose wsd-composer-wrap" data-composer={question ? "question" : undefined}><WorkspaceAsyncQuestions asks={asyncAsks} t={t}
          onTypeAnswer={() => input.current?.focus()} disabled={Boolean(disconnected)} onAnswer={(questionId, answer) => void model.answerAsync(questionId, answer)} /><div className="hs-field wsd-composer"><textarea ref={input} aria-label={t("ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" })} value={view.draft}
        placeholder={!hasConnection ? t("ws.composer.noConnection") : t(question ? "ws.question.composerPlaceholder" : "ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" })} disabled={!hasConnection || view.runtimeChanging} rows={1}
        onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitComposer(); } }} />
        <div className="hd-composer-tools"><button type="button" aria-label={r("attach")} disabled={!hasConnection || !!disconnected || attaching} onClick={() => void attachReference()}><PaperClipIcon className="hico" /></button><button type="button" aria-label={r("mention")} aria-expanded={mentionOpen} aria-haspopup="menu" disabled={!hasConnection || view.runtimeChanging} onClick={() => setMentionOpen(value => !value)}><AtSymbolIcon className="hico" /></button></div>
        {mentionOpen ? <div ref={mentionMenu} className="hd-mention-menu" role="menu" aria-label={r("mention")} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionOpen(false); input.current?.focus(); } else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")], index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } }}>{colleagues.map(person => <button type="button" role="menuitem" key={person.agentId} onClick={() => { model.setDraft(`${model.getSnapshot().draft}@${person.identity.displayName} `); setMentionOpen(false); input.current?.focus(); }}>{person.identity.displayName}<small>{person.identity.title}</small></button>)}</div> : null}
        {busy ? <button className="hs-stop" onClick={() => void model.cancel()} disabled={Boolean(disconnected) || workspace.conversation.state === "draining"}><StopIcon className="hico" />{t("ws.composer.stop")}</button>
          : view.pendingUnknown ? <button className="hs-btn sec" onClick={() => void model.verifyPending()} disabled={Boolean(disconnected)}>{t("ws.composer.verify")}</button> : <button className="hs-send wsd-send" onClick={submitComposer} disabled={!canSend} aria-label={t("ws.composer.send")}><PaperAirplaneIcon className="hico" /></button>}
          {asyncTarget ? <button className="hs-send wsd-send" onClick={submitComposer} disabled={!canAnswerAsync} aria-label={t("ws.question.async.send")}><PaperAirplaneIcon className="hico" /></button> : null}</div>
        {view.runtimeBlocked && !question && !busy ? <p role="status">{t("ws.runtimeAccess.runBlocked")} <button type="button" className="hs-btn sec" onClick={() => setInspector(true)}>{t("ws.runtimeAccess.openInspector")}</button></p> : null}
        {view.draft.trim() ? <p className="hs-hint"><span>{t("ws.composer.hint.keys")}</span></p> : null}</footer> : null}
    </main>
    {showColleagueInspector && agent && workspace ? <WorkspaceColleagueInspector key={`${workspace.workspaceId}:${workspace.resourceGeneration}:${agent.agentId}:${renameAgentId === agent.agentId ? "rename" : "manage"}`} extensionsModel={model} initialProfileOpen={renameAgentId === agent.agentId} agent={agent} workspace={workspace} features={features} supported={scheduleSupported} locale={locale} error={featuresError} inert={Boolean(modalOpen)} onClose={() => { setInspector(false); setRenameAgentId(null); }} onRefresh={() => void refreshFeatures()}
      listModels={listBotModels} listConnectionModels={listConnectionModels} connectionModelSupported={model.supportsConnectionModels?.() === true} permissionSupported={model.supportsRuntimePermissions?.() === true} onApplyPermissionTier={tier => model.setAgentPermissionTier(agent, tier)} onApplyRuntime={(runtimeId, sessionRestart) => model.setAgentRuntime(agent, runtimeId, sessionRestart)}
      onApplyModel={(runtimeId, modelId, revision, effort) => model.selectRuntimeModel(runtimeId, modelId, revision, effort)}
      onApplyConnectionModel={(connectionId, modelId, revision, effort) => model.selectConnectionModel(connectionId, modelId, revision, effort)}
      onRescan={() => model.detectRuntimes()} onRegisterRuntime={(runtimeId, fingerprint, loginSource) => model.registerLocalRuntime(runtimeId, fingerprint, workspace.workspaceId, workspace.resourceGeneration, loginSource)}
      onRuntimeDirectory={() => openSettingsPage("runtimes")} onConnections={() => openSettingsPage("connections")} onSaveProfile={profile => model.updateAgentPersona(agent, profile)}
      onToggle={(schedule) => updateColleagueSchedule("workspace.features.update", { kind: "schedule", id: schedule.id, enabled: !schedule.enabled }, schedule.agentId)}
      onSave={(schedule, values) => updateColleagueSchedule("workspace.schedule.save", { input: { id: schedule.id, name: values.name.trim(), schedule: { kind: "cron", expr: values.cron.trim() }, tz: values.tz.trim(), task: values.task.trim(), agentId: agent.agentId, enabled: schedule.enabled }, approved: true }, schedule.agentId)}
      onDelete={(schedule) => updateColleagueSchedule("workspace.schedule.delete", { id: schedule.id, approved: true }, schedule.agentId)} />
      : showGroupInspector && selectedChannel ? <WorkspaceGroupInspector name={selectedChannel.name} memberIds={selectedChannel.memberIds} agents={agents} locale={locale} inert={Boolean(modalOpen)} view={channelView} model={channels} disabled={!!disconnected} onClose={() => setInspector(false)} onMembers={() => setChannelDialog("members")} />
      : showContextInspector ? <WorkspaceInspector workspace={workspace} agent={agent} shell={shell} t={t} inert={Boolean(modalOpen)} onClose={() => setInspector(false)} onAttention={() => { if (shell.waiting[0]) openItem(shell.waiting[0]); }} /> : null}
    {browser && workspace ? <Suspense fallback={<aside id="workspace-browser-panel" className="hs-browser" role="status">{t("common.loading")}</aside>}><BrowserExtension key={scope} label={workspace.label} locale={locale} inert={Boolean(modalOpen)} onClose={() => setBrowser(false)} /></Suspense> : null}

    {undoNotice?.scope === scope ? <WorkspaceUndoToast key={undoNotice.id} notice={undoNotice} locale={locale} onClose={() => setUndoNotice(null)} /> : null}
    {production ? <WorkspaceUpdateNotice controller={updates.controller} onView={() => { setSettingsPage("updates"); setSettings(true); }} /> : null}
    {creating ? <ShellDialog label={t("ws.space.new")} onClose={() => setCreating(false)}><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setCreating(false)}><XMarkIcon className="hico" /></button>
      <h2>{t("ws.create.title")}</h2><p>{t("ws.create.body")}</p><label>{t("ws.create.name")}<input aria-label={t("ws.create.name")} value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) void create(); }} /></label>
      <button className="hs-btn pri" onClick={() => void create()} disabled={view.loading || !name.trim()}>{t("ws.space.new")}</button></ShellDialog> : null}
    {workspaceRename ? <ShellDialog label={r("renameWorkspace")} onClose={() => { if (!workspaceRenameBusy) setWorkspaceRename(null); }}><h2>{r("renameWorkspace")}</h2><input autoFocus aria-label={t("ws.create.name")} maxLength={80} value={workspaceNameDraft} disabled={workspaceRenameBusy} onChange={event => setWorkspaceNameDraft(event.target.value)} />
      <div className="wsd-card-actions"><button type="button" className="hs-btn sec" disabled={workspaceRenameBusy} onClick={() => setWorkspaceRename(null)}>{t("ws.cancel")}</button><button type="button" className="hs-btn pri" disabled={workspaceRenameBusy || !workspaceNameDraft.trim()} onClick={async () => { if (workspaceRenameBusy) return; setWorkspaceRenameBusy(true); try { await model.renameWorkspace(workspaceNameDraft.trim(), workspaceRename); setWorkspaceRename(null); } catch { setUndoNotice({ id: ++toastCounter.current, scope, text: r("changeFailed") }); } finally { setWorkspaceRenameBusy(false); } }}>{t("ws.rf.apply")}</button></div></ShellDialog> : null}
    {channelDialog ? <LocalChannelDialog key={`${scope}:${channelDialog}:${channelView.channelId}`} mode={channelDialog} view={channelView} model={channels} colleagues={channelDialog === "members" ? agents.filter(row => row.kind === "colleague" && (row.state === "active" || channelView.channel?.channel.memberIds.includes(row.agentId))) : colleagues} t={t} onClose={() => setChannelDialog(null)} onCreated={openChannel} /> : null}
    {approvalDialog?.scope === scope ? <ShellDialog label={t("ws.approval.label")} onClose={() => setApprovalDialog(null)} className="wsd-approval-dialog"><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setApprovalDialog(null)}><XMarkIcon className="hico" /></button>
      {dialogCard ? <ApprovalCard card={dialogCard} model={model} t={t} locale={locale} onRestoreArchived={model.supportsAgentArchive() ? async target => { await model.setAgentArchived(target, false); } : undefined} inDialog disabled={Boolean(disconnected)} onSettled={() => setApprovalDialog(null)} /> : <p role="status">{t("ws.approval.stale")}</p>}</ShellDialog> : null}
    {rosterMenu && menuAgent ? <WorkspaceRosterMenu agent={menuAgent} targetKind={menuGroup ? "group" : "colleague"} x={rosterMenu.x} y={rosterMenu.y} locale={locale} pinned={Boolean(activeRosterPrefs[menuAgent.agentId]?.pinned)} hidden={Boolean(activeRosterPrefs[menuAgent.agentId]?.hidden)} unread={Boolean(activeRosterPrefs[menuAgent.agentId]?.unread)}
      folders={folderOptions} currentFolder={activeRosterPrefs[menuAgent.agentId]?.section}
      onClose={() => setRosterMenu(null)} onManage={() => { if (menuGroup) { openChannel(menuGroup.id); setBrowser(false); setInspector(true); } else void manageRosterAgent(menuAgent); }}
      onPin={() => updateRosterPref(menuAgent.agentId, { pinned: !activeRosterPrefs[menuAgent.agentId]?.pinned })}
      onMove={() => { setSectionName(""); setRosterMove(menuAgent); }} onMoveTo={section => updateRosterPref(menuAgent.agentId, { section })} onUnread={() => updateRosterPref(menuAgent.agentId, { unread: !activeRosterPrefs[menuAgent.agentId]?.unread })}
      onRename={() => setInlineRename({ id: menuAgent.agentId, name: menuAgent.identity.displayName, kind: menuGroup ? "group" : "colleague", pending: false })}
      onHide={() => hideRoster(menuAgent)}
      onArchive={!menuGroup && menuAgent.kind !== "main" && model.supportsAgentArchive() && !archiveBusy ? () => void archiveRoster(menuAgent) : undefined}
      onNewSession={!menuGroup && model.supportsNativeSessions() && shell.snapshots.some(row => row.selectedAgentId === menuAgent.agentId && row.conversation.nativeSession?.runtimeId === menuAgent.runtime.id) ? () => { void openAgent(menuAgent.agentId).then(() => { const current = model.getSnapshot().workspace; if (current?.selectedAgentId === menuAgent.agentId && !["running", "draining"].includes(current.conversation.state)) { if (model.supportsNativeSessions() && current.conversation.nativeSession) void model.newNativeSession(); } }); } : undefined} /> : null}
    {archiveConfirm?.scope === scope ? <ShellDialog label={r("archiveConfirmTitle", { name: archiveConfirm.agent.identity.displayName })} onClose={() => { if (!archiveBusy) setArchiveConfirm(null); }} className="wsd-roster-dialog hd-archive-dialog">
      <h2>{r("archiveConfirmTitle", { name: archiveConfirm.agent.identity.displayName })}</h2><p>{r("archiveConfirmBody", { n: archiveConfirm.status.runs.length })}</p>
      <ul>{archiveConfirm.status.runs.map(run => <li key={run.runId} data-archive-run={run.runId}><strong>{run.title || r(run.kind === "group" ? "archiveGroupTask" : "archiveChatTask")}</strong><small>{r(run.kind === "group" ? "archiveGroupTask" : "archiveChatTask")} · {run.taskId.slice(0, 8)}</small></li>)}</ul>
      <p>{r("undoArchiveWarning")}</p>{archiveConfirm.status.scheduledTasks ? <p>{r("archivePauseSchedules", { n: archiveConfirm.status.scheduledTasks })}</p> : null}
      <div className="wsd-card-actions"><button type="button" className="hs-btn sec" disabled={archiveBusy} onClick={() => setArchiveConfirm(null)}>{t("ws.cancel")}</button><button type="button" className="hs-btn pri" disabled={archiveBusy} onClick={() => void archiveRoster(archiveConfirm.agent, archiveConfirm.status)}>{r("archiveConfirmAction")}</button></div>
    </ShellDialog> : null}
    {rosterMove ? <ShellDialog label={r("newFolder")} onClose={() => setRosterMove(null)} className="wsd-roster-dialog">
      <h2>{r("newFolder")}</h2><label>{r("folderName")}<input value={sectionName} maxLength={60} onChange={event => setSectionName(event.target.value)} /></label>
      <div className="wsd-card-actions"><button onClick={() => setRosterMove(null)}>{t("ws.cancel")}</button><button className="hs-btn pri" disabled={!sectionName.trim()} onClick={() => { updateRosterPref(rosterMove.agentId, { section: sectionName.trim() }); setRosterMove(null); }}>{r("move")}</button></div>
    </ShellDialog> : null}
    {settings ? <WorkspaceSettings key={`settings:${view.workspaceId}`} mainModel={model} initialPage={settingsPage} root={root} production={production} theme={theme} updater={updates.controller} versionInfo={updates.info}
      onClose={closeSettings} onCreateSkill={id => void draftSkill(id)} /> : null}
  </div></div></div>;
}
export default function WorkspaceLocalDev({ mode = "workspace" }: { mode?: "workspace" | "lab" }) {
  const { t } = useWorkspaceLocale();
  const startup = useMemo(() => new WorkspaceStartupModel(() => invoke<WorkspaceDevConnection>(mode === "lab" ? "workspace_dev_connection" : "workspace_connection", mode === "lab" ? {} : { clientLocale: currentClientLocale().tag })), [mode]);
  const view = useSyncExternalStore(startup.subscribe, startup.getSnapshot, startup.getSnapshot);
  useEffect(() => { void startup.start();return () => startup.stop(); }, [startup]);
  if (!view.model) return <WorkspaceBoot view={view} t={t} mode={mode} onReconnect={() => void startup.start()} />;
  return <WorkspaceScreen model={view.model} disconnected={view.phase === "disconnected" ? t("ws.disconnected") : ""} root={view.root} mode={mode} onReconnect={() => void startup.start()} />;
}
