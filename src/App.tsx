// Hara Desktop — Tauri shell over `hara serve` (WS JSON-RPC). The left module dock switches
// open-core work surfaces; people may hide/reorder entries while recovery/settings stays fixed.
// Places never share an active session. Groups performs explicit, profile-pinned organization Desk
// reads; Office owns local Artifact files instead of mixing them into project conversations.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  HaraClient,
  supportsNativePresentationWorkspace,
  type Discovery,
  type ApprovalMode,
  type SessionInfo,
  type ServerEvent,
  type PluginInfo,
  type SkillInfo,
  type PanelSpec,
  type ProjectPanel,
  type AutomationDraftInput,
  type AutomationListResult,
  type CtxInfo,
  type ProviderSettingsState,
  type ProviderConnection,
  type TaskLifecycleEvent,
  type WorkforceStateEvent,
  type ArtifactDetails,
  type ArtifactExportReceipt,
  type ArtifactKind,
  type ArtifactRevision,
  type ArtifactSummary,
  type ArtifactValidationReport,
  type PresentationArtifactDetails,
  type PresentationExportFormat,
  type PresentationProject,
  type ClientHistoryMessage,
  type EffectiveAttachmentCapabilities,
  type ModelCatalogEntry,
  type SessionAttachmentIntent,
  type SessionSubmitMode,
  type DeskConnection,
  type DeskTaskState,
  type OrganizationConnection,
  type OrganizationConnectionsState,
} from "./client";
import { detectLocale, saveLocale, makeT, type Key, type Locale } from "./i18n";
import { isImeCompositionKey } from "./ime";
import { classifyEngineVersion } from "./engine-version.js";
import { applyDesktopUpdateHandoff } from "./desktop-update.js";
import { checkDesktopUpdate, desktopUpdaterErrorText } from "./desktop-updater";
import {
  isAssistantWorkspace as isAssistantCwd,
  sessionActivationAllowed,
  sessionPlace,
  type SessionPlace,
  type SessionPlaceInput,
} from "./session-place";
import {
  HIDDEN_PROJECTS_STORAGE_KEY,
  OPENED_PROJECTS_STORAGE_KEY,
  isJunkProjectDirectory,
  projectGroups,
  projectListStateFromStorage,
  setProjectVisible,
  type ProjectListState,
} from "./project-list";
import {
  WorkStarter,
  type WorkbenchApp,
  type WorkStarterSubmission,
} from "./WorkStarter";
import type { PresentationTemplate } from "./OfficeHome";
import type {
  AutomationDraft,
  AutomationRun,
  AutomationViewId,
} from "./Automations";
import { AUTOMATION_COPY_EN } from "./automation-copy-en";
import {
  SettingsBadge,
  SettingsCard,
  SettingsItem,
  SettingsNotice,
  SettingsPage,
} from "./SettingsUI";
import {
  AppRail,
  type AppPlace,
  type AppRailItem,
} from "./AppRail";
import { ModuleDockSettings } from "./ModuleDockSettings";
import type {
  GroupsCopy,
  GroupsDirectoryState,
} from "./Groups";
import {
  groupsReducer,
  initialGroupsState,
} from "./groups-state";
import {
  CORE_NAVIGATION_CONTRIBUTIONS,
  NAVIGATION_PREFERENCES_KEY,
  initialAppPlace,
  moveNavigation,
  navigationIsVisible,
  parseNavigationPreferences,
  pluginNavigationContributionId,
  pluginNavigationContributions,
  visibleNavigation,
  withNavigationVisibility,
  type NavigationContribution,
  type PluginNavigationContribution,
  type NavigationPreferences,
} from "./navigation";
import {
  ConversationTimeline,
  type ApprovalVerdict,
  type ConversationItem,
} from "./ConversationTimeline";
import {
  EXECUTION_VIEW_MODES,
  EXECUTION_VIEW_PREFERENCE_KEY,
  parseExecutionViewMode,
  type ExecutionViewMode,
} from "./execution-view";
import {
  persistedUserTurnsFrom,
  resolveOptimisticUser,
  restoreAuthoritativeConversation,
} from "./conversation-state";
import {
  appendComposerAttachments,
  composerAttachment,
  composerAttachmentIssue,
  composerCanSend,
  emptyComposerDraft,
  maxImageAttachmentBytes,
  type ComposerAttachment,
  type ComposerDraft,
} from "./composer-state";
import {
  activateExtensionTab,
  activeExtensionTab,
  activeExtensionTabForContext,
  artifactExtensionTabId,
  classifyPanelSurface,
  closeExtensionTab,
  emptyExtensionDockState,
  extensionContextKey,
  extensionItemContextKey,
  extensionTabsForContext,
  localWebPreviewUrl,
  messageWithActiveWorkObject,
  nativePresentationRevisionFromTurn,
  publicPanelOrigin,
  presentationBrowserTabId,
  reviewTabId,
  workforceTabId,
  updateExtensionTab,
  upsertExtensionTab,
  webPreviewTabId,
  workbenchToolTabId,
  type ArtifactExtension,
  type ExtensionContext,
  type ExtensionDockItem,
  type ExtensionDockMode,
  type ExtensionDockState,
  type ExtensionSurfaceKind,
  type LegacyPanelExtension,
  type PresentationBrowserExtension,
  type ReviewExtension,
  type SessionExtensionOwner,
  type WebPreviewExtension,
  type WorkbenchToolExtension,
  type WorkbenchToolKind,
  type ExtensionDockAddKind,
  type WorkforceExtension,
} from "./extension-dock-state";
import { userVisibleText } from "./user-visible-text";
import {
  loadPresentationSurface,
  presentationErrorKey,
} from "./presentation-surface";
import { useDesktopCompanion } from "./companion/useDesktopCompanion";
import { IconEdit, IconArchive, IconStar, IconTrash, IconFork } from "./icons";
import { Md } from "./markdown";
import HaraLogo from "./mark";
import type {
  PetChatApproval,
  PetChatState,
  PetChatSubmit,
} from "./pets";
import {
  restoredTaskLifecycle,
  taskLifecycleIsNewer,
  taskStateIsLive,
  taskStatePetStatus,
  taskStateTitle,
  terminalTaskLifecycleFallback,
  type ResumedTaskSnapshot,
} from "./task-lifecycle";
import {
  boundedWorkforceState,
  workforceHasLiveActors,
  workforceFromTask,
  workforceStateIsNewer,
} from "./workforce-state";
import { AGENT_OFFICE_CAPABILITY } from "./preinstalled-capabilities";
import bundledEngineVersionText from "../src-tauri/binaries/SIDECAR_VERSION?raw";
import "./App.css";

type SettingsSection =
  | "providers"
  | "engine"
  | "security"
  | "lang"
  | "modules"
  | "pets"
  | "capabilities";

const loadGroups = () => import("./Groups");
const loadAutomations = () => import("./Automations");
const loadExtensionDock = () => import("./ExtensionDock");
const loadWorkbenchToolSurface = () => import("./WorkbenchToolSurface");
const loadWorkforceSurface = () => import("./WorkforceSurface");
const loadOfficeHome = () => import("./OfficeHome").then((module) => ({
  default: module.OfficeHome,
}));
const loadArtifactWorkbench = () => import("./ArtifactWorkbench").then((module) => ({
  default: module.ArtifactWorkbench,
}));
const loadPresentationWorkbench = () => import("./PresentationWorkbench");
const loadEmbeddedBrowserSurface = () => import("./EmbeddedBrowserSurface");
const loadCapabilityDirectory = () => import("./CapabilityDirectory").then((module) => ({
  default: module.CapabilityDirectory,
}));
const loadProviderSettings = () => import("./ProviderSettings").then((module) => ({
  default: module.ProviderSettings,
}));
const loadGatewaySettings = () => import("./GatewaySettings").then((module) => ({
  default: module.GatewaySettings,
}));
const loadDesktopCompanionSettings = () =>
  import("./companion/DesktopCompanionSettings").then((module) => ({
    default: module.DesktopCompanionSettings,
  }));

const GroupsStage = lazy(loadGroups);
const GroupsContextSidebar = lazy(() =>
  loadGroups().then((module) => ({
    default: module.GroupsSidebar,
  })));
const AutomationSidebar = lazy(() =>
  loadAutomations().then((module) => ({
    default: module.AutomationSidebar,
  })));
const AutomationsPage = lazy(() =>
  loadAutomations().then((module) => ({
    default: module.AutomationsPage,
  })));
const ExtensionDock = lazy(loadExtensionDock);
const ExtensionViewLauncher = lazy(() =>
  loadExtensionDock().then((module) => ({
    default: module.ExtensionViewLauncher,
  })));
const WorkbenchToolSurface = lazy(loadWorkbenchToolSurface);
const WorkforceSurface = lazy(loadWorkforceSurface);
const OfficeHome = lazy(loadOfficeHome);
const ArtifactWorkbench = lazy(loadArtifactWorkbench);
const PresentationWorkbench = lazy(loadPresentationWorkbench);
const EmbeddedBrowserSurface = lazy(loadEmbeddedBrowserSurface);
const CapabilityDirectory = lazy(loadCapabilityDirectory);
const ProviderSettings = lazy(loadProviderSettings);
const GatewaySettings = lazy(loadGatewaySettings);
const DesktopCompanionSettings = lazy(loadDesktopCompanionSettings);

const warmModule = (promise: Promise<unknown>): void => {
  void promise.catch(() => {
    // Preloading is opportunistic. The lazy boundary remains authoritative and surfaces a real
    // module-load failure if the user opens the destination.
  });
};

const preloadSettingsSection = (section: SettingsSection): void => {
  if (section === "providers") {
    warmModule(Promise.all([loadProviderSettings(), loadGatewaySettings()]));
  } else if (section === "pets") {
    warmModule(loadDesktopCompanionSettings());
  } else if (section === "capabilities") {
    warmModule(loadCapabilityDirectory());
  }
};

const preloadPlace = (place: AppPlace): void => {
  if (place === "auto") {
    warmModule(loadAutomations());
  } else if (place === "groups") {
    warmModule(loadGroups());
  } else if (place === "office") {
    warmModule(Promise.all([loadOfficeHome(), loadArtifactWorkbench(), loadPresentationWorkbench(), loadEmbeddedBrowserSurface(), loadExtensionDock()]));
  }
};

const artifactExtensionFor = (
  details: ArtifactDetails,
  sessionOwner?: SessionExtensionOwner,
): ArtifactExtension => {
  const owner: ArtifactExtension["owner"] = sessionOwner
    ? {
        ...sessionOwner,
        artifactId: details.artifact.artifactId,
        revisionId: details.currentRevision.revisionId,
      }
    : {
        place: "office",
        artifactId: details.artifact.artifactId,
        revisionId: details.currentRevision.revisionId,
      };
  return {
    type: "artifact",
    id: artifactExtensionTabId(details.artifact.artifactId, owner),
    title: details.artifact.title,
    surfaceKind: details.artifact.kind,
    owner,
    // Results open beside the current work context. Maximizing is always an explicit user action.
    mode: "docked",
  };
};

const safeSurfaceTitle = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || fallback;
};

const safeSurfaceOpaqueId = (value: unknown): value is string =>
  typeof value === "string"
  && value.length >= 4
  && value.length <= 256
  && !/[\u0000-\u001f\u007f]/.test(value);

const isArtifactSurfaceKind = (
  value: unknown,
): value is ArtifactExtension["surfaceKind"] =>
  value === "presentation" || value === "spreadsheet" || value === "document";

const webPreviewExtensionFor = (
  rawUrl: string,
  title: string,
  owner: SessionExtensionOwner,
): WebPreviewExtension | null => {
  const url = localWebPreviewUrl(rawUrl);
  if (!url) return null;
  return {
    type: "web-preview",
    id: webPreviewTabId(owner.sessionId, url.toString()),
    title: safeSurfaceTitle(title, "Web preview"),
    url: url.toString(),
    surfaceKind: "browser",
    owner,
    mode: "docked",
  };
};

const panelExtensionFor = (
  panel: PanelSpec & { plugin: string },
  url: string,
  owner: LegacyPanelExtension["owner"],
): LegacyPanelExtension => ({
  type: "legacy-panel",
  id: `panel:${owner.sessionId}:${panel.plugin}:${panel.id}`,
  title: panel.title,
  plugin: panel.plugin,
  panelId: panel.id,
  url,
  surfaceKind: classifyPanelSurface(panel.plugin, panel.id, panel.title),
  owner,
  mode: "docked",
});

const panelNavigationIcon = (
  plugin: string,
  panel: Pick<PanelSpec, "id" | "title">,
) => {
  const kind = classifyPanelSurface(plugin, panel.id, panel.title);
  if (kind === "presentation" || kind === "spreadsheet" || kind === "document" || kind === "design") {
    return "office" as const;
  }
  if (kind === "browser") return "projects" as const;
  return "tasks" as const;
};

const workbenchAppIconForPanel = (
  contribution: Pick<PluginNavigationContribution, "plugin" | "panelId" | "title">,
): WorkbenchApp["icon"] => {
  const kind = classifyPanelSurface(
    contribution.plugin,
    contribution.panelId,
    contribution.title,
  );
  if (kind === "browser") return "browser";
  if (kind === "design") return "design";
  if (kind === "presentation" || kind === "spreadsheet" || kind === "document") return "office";
  return "capability";
};

const panelOperationKey = (plugin: string, panelId: string): string =>
  `${plugin.length}:${plugin}:${panelId}`;

const groupsDirectoryProfiles = (
  organizations: OrganizationConnection[],
  deskConnections: DeskConnection[],
) => {
  const deskByProfile = new Map(
    deskConnections.map((connection) => [connection.profileId, connection]),
  );
  return organizations.map((organization) => {
    const desk = deskByProfile.get(organization.id);
    return {
      profileId: organization.id,
      // This is an in-memory partition key, not a credential. Enrollment identity and the CLI's
      // opaque binding epoch ensure a reused organization id cannot inherit an old Desk snapshot.
      revision: JSON.stringify([
        organization.gatewayUrl,
        organization.enrolledAt ?? "",
        organization.accessState,
        desk?.bindingRevision ?? "",
        desk?.configured === true,
        desk?.needsRebind === true,
        desk?.host ?? "",
        desk?.agentId ?? "",
      ]),
    };
  });
};

type Phase = "boot" | "no-server" | "connecting" | "ready" | "lost";
// Module destinations backed by the shell: talk / projects / orchestrate / groups / office / configure.
type Zone = AppPlace;
type PendingDesktopUpdate = {
  update: Update;
  version: string;
  phase: "downloaded" | "installed";
};
type DesktopUpdateProgress = {
  downloaded: number;
  total?: number;
};
type DesktopUpdateStorageStatus = {
  supported: boolean;
  directory: string;
  managedEntries: number;
  managedBytes: number;
  protectedEntries: number;
  removedEntries: number;
  reclaimedBytes: number;
  failedEntries: number;
  scanComplete: boolean;
};
type CommandLineHaraStatus = {
  path: string;
  bundledVersion: string;
  available: boolean;
  installed: boolean;
  current: boolean;
  managed: boolean;
  blocked: boolean;
};
type ClassifiedAttachmentPath = {
  path: string;
  kind: "file" | "directory";
  byteSize?: number;
};
type StagedModelChange = {
  revision: number;
  model: string;
  /** Empty string is the explicit Desktop representation of automatic effort. */
  effort: string;
};
type ModelChangeFlushResult = "none" | "applied" | "deferred" | "failed";

const APPROVAL_MODES: readonly ApprovalMode[] = ["suggest", "auto-edit", "full-auto"];
const parseApprovalMode = (value: string | null): ApprovalMode | "" =>
  APPROVAL_MODES.includes(value as ApprovalMode) ? value as ApprovalMode : "";

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");
const basename = (p: string): string => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
const fileExtension = (value: string): string => {
  const name = basename(value);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};
const NATIVE_PRESENTATION_IMPORT_EXTENSIONS = new Set([".hpres", ".json", ".md", ".markdown"]);
const isNativePresentation = (details: ArtifactDetails): boolean =>
  details.artifact.kind === "presentation" && details.content.extension === ".hpres";
/** Compact "MM-DD HH:mm" (year only when it differs) — locale toLocaleString is too chatty for a sidebar. */
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yr = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}-`;
  return `${yr}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Automated titles are "sourceName · time" — next to the origin chip that prefix is noise. */
const botTitle = (s: SessionInfo): string => {
  const t = s.title || "";
  return s.sourceName && t.startsWith(`${s.sourceName} · `) ? t.slice(s.sourceName.length + 3) : t;
};
const isAutomated = (s: SessionInfo): boolean => s.source === "cron" || s.source === "gateway";
const automationDraftInput = (
  draft: AutomationDraft,
  fallbackCwd?: string,
): AutomationDraftInput => {
  // Empty `tz` is an intentional, serializable clear request. Falling back with `||` would silently
  // restore the old saved timezone because JSON cannot represent `undefined`.
  const timezone = draft.tz !== undefined ? draft.tz : draft.timezone;
  const timezoneApplies =
    draft.scheduleKind === "daily"
    || draft.scheduleKind === "weekly"
    || draft.scheduleKind === "custom";
  return {
    name: draft.name,
    schedule: draft.schedule,
    task: draft.task,
    ...(draft.cwd || fallbackCwd ? { cwd: draft.cwd || fallbackCwd } : {}),
    ...(timezone !== undefined && timezoneApplies ? { tz: timezone } : {}),
    ...(draft.mode === "print" || draft.mode === "org" || draft.mode === "command"
      ? { mode: draft.mode }
      : {}),
    ...(draft.deliver ? { deliver: draft.deliver } : {}),
    ...(draft.deliverMode ? { deliverMode: draft.deliverMode } : {}),
    ...(draft.clearDeliver ? { clearDeliver: true } : {}),
    ...(draft.alertAfter ? { alertAfter: draft.alertAfter } : {}),
  };
};
/** gateway idle-rotation forks share an id prefix (`wechat-<chat>-<tag>[-N]`) — fold to one thread */
const forkBase = (id: string): string => id.replace(/-\d+$/, "");
const BUNDLED_ENGINE_VERSION = bundledEngineVersionText.trim();
const SERVER_BUSY = -32002;
const BUSY_SEND_RETRIES = 4;
const MODEL_CHANGE_BUSY_RETRY_DELAYS_MS = [50, 100, 180, 300, 480] as const;
const UPDATE_SNOOZE_KEY = "hara.desktopUpdateSnooze";
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1_000;
const ATTACHMENT_FEATURE = "composer.attachments.v1";
const READONLY_HISTORY_FEATURE = "sessions.readonly-history.v1";
const CROSS_PROFILE_FORK_FEATURE = "sessions.cross-profile-fork.v1";

const formatStorageBytes = (bytes: number, locale: Locale): string => {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes < 1_024) return `${Math.round(safeBytes)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = safeBytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (const next of units.slice(1)) {
    if (value < 1_024) break;
    value /= 1_024;
    unit = next;
  }
  return `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} ${unit}`;
};

const desktopUpdateIsSnoozed = (version: string): boolean => {
  try {
    const saved = JSON.parse(localStorage.getItem(UPDATE_SNOOZE_KEY) ?? "{}") as {
      version?: unknown;
      until?: unknown;
    };
    return saved.version === version && typeof saved.until === "number" && saved.until > Date.now();
  } catch {
    return false;
  }
};

const snoozeDesktopUpdate = (version: string): void => {
  localStorage.setItem(
    UPDATE_SNOOZE_KEY,
    JSON.stringify({ version, until: Date.now() + UPDATE_SNOOZE_MS }),
  );
};

const attachmentIssueText = (
  locale: Locale,
  issue: ReturnType<typeof composerAttachmentIssue>,
): string => {
  if (locale === "zh") {
    if (issue === "engine-update-required") return "当前 Hara 引擎太旧，请先更新 Desktop 后再添加附件。";
    if (issue === "image-too-large") return "图片超过 Hara 3.6 MB 附件上限，尚未发送给模型，也不会静默转用 OCR。请压缩或裁剪后重新添加。";
    if (issue === "model-capabilities-loading") return "正在读取当前模型的图片能力，请稍后再发送。";
    if (issue === "image-unsupported") return "当前模型不能读取图片；请选择原生支持图片的模型。";
    if (issue === "image-unknown") return "当前模型的图片能力尚未验证；请选择已验证支持图片的模型。";
    return "";
  }
  if (issue === "engine-update-required") return "Update Hara Desktop before adding attachments.";
  if (issue === "image-too-large") return "This image exceeds Hara's 3.6 MB attachment limit. It was not sent to the model or silently routed to OCR. Compress or crop it, then attach it again.";
  if (issue === "model-capabilities-loading") return "Loading the selected model's image capability.";
  if (issue === "image-unsupported") return "This model cannot read images. Choose a model with native image input.";
  if (issue === "image-unknown") return "This model's image capability is unverified. Choose a verified image-capable model.";
  return "";
};

const imageCapabilityText = (
  locale: Locale,
  capabilities: EffectiveAttachmentCapabilities | undefined,
): string => {
  const mode = capabilities?.image.mode;
  if (locale === "zh") {
    if (mode === "native") return "原生读取图片";
    if (mode === "vision-sidecar") return "图片兼容模式";
    if (mode === "unsupported") return "不支持图片";
    return "图片能力未验证";
  }
  if (mode === "native") return "Native image input";
  if (mode === "vision-sidecar") return "Image compatibility mode";
  if (mode === "unsupported") return "No image input";
  return "Image capability unverified";
};

const thinkingLabel = (locale: Locale, effort: string): string => {
  const labels: Record<string, [string, string]> = {
    off: ["关闭思考", "Thinking off"],
    low: ["快速", "Fast"],
    medium: ["平衡", "Balanced"],
    high: ["深入", "Deep"],
    max: ["最强", "Maximum"],
    xhigh: ["极深", "Extra deep"],
  };
  return labels[effort]?.[locale === "zh" ? 0 : 1] ?? effort;
};

interface QueuedInput {
  id: string;
  text: string;
  /** Immutable, renderer-authored context captured when the user submitted the visible text. */
  wireText?: string;
  attachments?: ComposerAttachment[];
  /** The optimistic transcript entry already exists; a later retry must not duplicate it. */
  recorded?: boolean;
}

const recentPetMessages = (items: ConversationItem[]): PetChatState["messages"] =>
  items
    .flatMap((item): PetChatState["messages"] => {
      if (item.kind === "user") return [{ role: "user", text: item.text.slice(0, 900) }];
      if (item.kind === "text") return [{ role: "assistant", text: plain(item.text).slice(0, 1_200) }];
      if (item.kind === "notice") return [{ role: "notice", text: plain(item.text).slice(0, 500) }];
      return [];
    })
    .slice(-6);

/** Serve persists internal routing wrappers for the model. Render only the user's original text. */
const displayHistoryText = (text: string): string => {
  return userVisibleText(text);
};

const conversationItemsFromHistory = (
  history: ClientHistoryMessage[],
): ConversationItem[] => history.map((message): ConversationItem =>
  message.role === "user"
    ? {
        kind: "user",
        text: displayHistoryText(message.text),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      }
    : { kind: "text", text: message.text });

const conversationHistory = (
  history: ClientHistoryMessage[],
): ConversationItem[] =>
  history.map((message): ConversationItem =>
    message.role === "user"
      ? {
          kind: "user",
          text: displayHistoryText(message.text),
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        }
      : { kind: "text", text: message.text },
  );

/** The assistant zone: one active desktop conversation + one thread per external origin.
 *  Starting a fresh conversation promotes the previous active one into folded history:
 *  - `current`: latest interactive desktop conversation in the assistant workspace
 *  - `bots`: gateway threads, one per platform+peer (forks folded) — WeChat etc., each its own lane
 *  - `history`: older desktop conversations, folded away until the user opens them */
function assistantZone(sessions: SessionInfo[]): { current: SessionInfo | null; bots: SessionInfo[]; history: SessionInfo[] } {
  const mine = sessions
    .filter((s) => isAssistantCwd(s.cwd) && s.source !== "gateway" && s.source !== "cron")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const folded = new Map<string, SessionInfo>();
  for (const s of sessions.filter((x) => x.source === "gateway")) {
    const key = forkBase(s.id);
    const prev = folded.get(key);
    if (!prev || s.updatedAt > prev.updatedAt) folded.set(key, s);
  }
  const bots = [...folded.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { current: mine[0] ?? null, bots, history: mine.slice(1) };
}

export default function App() {
  const clientRef = useRef<HaraClient | null>(null);
  const ensurePresentationWorkspaceRef = useRef<() => Promise<boolean>>(async () => false);
  const connectGenerationRef = useRef(0);
  const bootstrapStartedRef = useRef(false);
  const plannedUpdateRestartRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("boot");
  const [server, setServer] = useState<{ pid: number; version: string; provider: string; model: string; cwd: string } | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, ConversationItem[]>>({});
  const [readOnlySessions, setReadOnlySessions] = useState<Record<string, { reason: string }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [taskStates, setTaskStates] = useState<Record<string, TaskLifecycleEvent>>({});
  const [workforceStates, setWorkforceStates] = useState<Record<string, WorkforceStateEvent>>({});
  const transcriptsRef = useRef(transcripts);
  const readOnlySessionsRef = useRef(readOnlySessions);
  const busyRef = useRef(busy);
  const taskStatesRef = useRef(taskStates);
  const workforceStatesRef = useRef(workforceStates);
  const activeTurnsRef = useRef<Record<string, string>>({});
  const presentationSurfaceTurnsRef = useRef<Record<string, {
    startedAt: number;
    surfaceOffered: boolean;
    baselineRevisionIds: ReadonlySet<string>;
  }>>({});
  const handleEventRef = useRef<(event: ServerEvent) => void>(() => {});
  const pendingSendDispatchesRef = useRef<Record<string, {
    pendingId: string;
    turnId?: string;
    completed?: boolean;
  }>>({});
  const attachedSessionsRef = useRef(new Set<string>());
  transcriptsRef.current = transcripts;
  readOnlySessionsRef.current = readOnlySessions;
  busyRef.current = busy;
  taskStatesRef.current = taskStates;
  workforceStatesRef.current = workforceStates;
  const setSessionBusy = useCallback((sessionId: string, value: boolean) => {
    const next = { ...busyRef.current, [sessionId]: value };
    busyRef.current = next;
    setBusy(next);
  }, []);
  const setSessionReadOnly = useCallback((
    sessionId: string,
    state: { reason: string } | null,
  ) => {
    const { [sessionId]: _previous, ...rest } = readOnlySessionsRef.current;
    const next = state ? { ...rest, [sessionId]: state } : rest;
    readOnlySessionsRef.current = next;
    setReadOnlySessions(next);
  }, []);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>({});
  const activeDraft = active
    ? composerDrafts[active] ?? emptyComposerDraft()
    : emptyComposerDraft();
  const input = activeDraft.text;
  const pendingAttachments = activeDraft.attachments;
  const updateComposerDraft = useCallback((
    sessionId: string,
    update: (draft: ComposerDraft) => ComposerDraft,
  ) => {
    setComposerDrafts((drafts) => ({
      ...drafts,
      [sessionId]: update(drafts[sessionId] ?? emptyComposerDraft()),
    }));
  }, []);
  const setInput = (
    value: string | ((current: string) => string),
  ) => {
    if (!active) return;
    updateComposerDraft(active, (draft) => ({
      ...draft,
      text: typeof value === "function" ? value(draft.text) : value,
    }));
  };
  const [modelInfo, setModelInfo] = useState<{
    models: string[];
    entries?: ModelCatalogEntry[];
    current: string;
    currentAvailable?: boolean;
    recommendedModel?: string;
    profileId?: string;
    effort: string | null;
    effortLevels: string[];
    attachmentCapabilities?: EffectiveAttachmentCapabilities;
  } | null>(null);
  const [modelInfoScope, setModelInfoScope] = useState<string | null>(null);
  const [organizationRoutes, setOrganizationRoutes] = useState<OrganizationConnectionsState | null>(null);
  const organizationRoutesRequestRef = useRef(0);
  const refreshOrganizationRoutes = useCallback(async (cwd?: string) => {
    const client = clientRef.current;
    if (!client) return null;
    const requestId = ++organizationRoutesRequestRef.current;
    const next = await client.listOrganizationConnections(cwd);
    if (requestId !== organizationRoutesRequestRef.current || clientRef.current !== client) return next;
    setOrganizationRoutes(next);
    return next;
  }, []);
  const [providerRoutes, setProviderRoutes] = useState<ProviderSettingsState | null>(null);
  const providerRoutesRequestRef = useRef(0);
  const refreshProviderRoutes = useCallback(async (cwd?: string) => {
    const client = clientRef.current;
    if (!client) return null;
    const requestId = ++providerRoutesRequestRef.current;
    const next = await client.listProviderSettings(cwd);
    if (requestId !== providerRoutesRequestRef.current || clientRef.current !== client) return next;
    setProviderRoutes(next);
    return next;
  }, []);
  const [sessEffort, setSessEffort] = useState<Record<string, string>>({});
  const [stagedModelChanges, setStagedModelChanges] = useState<Record<string, StagedModelChange>>({});
  const stagedModelChangesRef = useRef<Record<string, StagedModelChange>>({});
  const stagedModelChangeSequenceRef = useRef(0);
  const stagedModelChangeFlushesRef = useRef<Record<string, Promise<ModelChangeFlushResult>>>({});
  const stageModelChange = useCallback((sessionId: string, model: string, effort: string) => {
    const change: StagedModelChange = {
      revision: ++stagedModelChangeSequenceRef.current,
      model,
      effort,
    };
    const next = { ...stagedModelChangesRef.current, [sessionId]: change };
    stagedModelChangesRef.current = next;
    setStagedModelChanges(next);
    return change;
  }, []);
  const clearStagedModelChange = useCallback((sessionId: string, revision?: number) => {
    const current = stagedModelChangesRef.current[sessionId];
    if (!current || (revision !== undefined && current.revision !== revision)) return;
    const { [sessionId]: _removed, ...rest } = stagedModelChangesRef.current;
    stagedModelChangesRef.current = rest;
    setStagedModelChanges(rest);
  }, []);
  const clearStagedModelChanges = useCallback(() => {
    stagedModelChangesRef.current = {};
    stagedModelChangeFlushesRef.current = {};
    setStagedModelChanges({});
  }, []);
  const modelInfoRequestRef = useRef(0);
  const refreshModelInfo = useCallback(async (opts?: { sessionId?: string; cwd?: string }) => {
    const client = clientRef.current;
    if (!client) return null;
    const requestId = ++modelInfoRequestRef.current;
    const info = await client.listModels(opts);
    if (requestId !== modelInfoRequestRef.current) return info;
    setModelInfo(info);
    setModelInfoScope(opts?.sessionId ?? null);
    if (opts?.sessionId && info) {
      setSessEffort((current) => ({ ...current, [opts.sessionId!]: info.effort ?? "" }));
    }
    return info;
  }, []);
  const [defaultApproval, setDefaultApproval] = useState<ApprovalMode | "">(() =>
    parseApprovalMode(localStorage.getItem("hara.approval")));
  const [executionViewMode, setExecutionViewMode] = useState<ExecutionViewMode>(() =>
    parseExecutionViewMode(localStorage.getItem(EXECUTION_VIEW_PREFERENCE_KEY)));
  const [err, setErr] = useState("");
  const [navigationPreferences, setNavigationPreferences] =
    useState<NavigationPreferences>(() =>
      parseNavigationPreferences(localStorage.getItem(NAVIGATION_PREFERENCES_KEY)));
  const [zone, setZoneRaw] = useState<Zone>(() =>
    initialAppPlace(localStorage.getItem("hara.zone"), navigationPreferences));
  const zoneRef = useRef<Zone>(zone);
  const workbenchPlaceRef = useRef<"chat" | "projects">(
    localStorage.getItem("hara.workbench.place") === "projects" || zone === "projects"
      ? "projects"
      : "chat",
  );
  const sessionOpenRequestRef = useRef(0);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const pluginsRef = useRef<PluginInfo[] | null>(null);
  const pluginNavigation = useMemo<PluginNavigationContribution[]>(() =>
    pluginNavigationContributions(
      (plugins ?? []).flatMap((plugin) => plugin.enabled
        ? (plugin.panels ?? []).map((panel) => ({
            plugin: plugin.name,
            panelId: panel.id,
            title: panel.title,
            description: plugin.description,
            icon: panelNavigationIcon(plugin.name, panel),
          }))
        : []),
    ), [plugins]);
  const navigationContributions = useMemo<NavigationContribution[]>(() => [
    ...CORE_NAVIGATION_CONTRIBUTIONS,
    ...pluginNavigation,
  ], [pluginNavigation]);
  const pluginNavigationById = useMemo(
    () => new Map(pluginNavigation.map((contribution) => [contribution.id, contribution])),
    [pluginNavigation],
  );
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const capabilitySkillsCwdRef = useRef<string | undefined>(undefined);
  const capabilityCatalogRequestRef = useRef(0);
  const [panelBusy, setPanelBusy] = useState("");
  const [starterBusy, setStarterBusy] = useState(false);
  const [assistantCreating, setAssistantCreating] = useState(false);
  const [engineRestarting, setEngineRestarting] = useState(false);
  // settings place: context column = group anchors, stage = the selected group's forms
  const [setSec, setSetSec] = useState<SettingsSection>("providers");
  // Context-owned extension screen. A panel/file never changes owner when the user changes place.
  const [projPanels, setProjPanels] = useState<Record<string, ProjectPanel[]>>({});
  const [extensionDockState, setExtensionDockState] = useState<ExtensionDockState>(emptyExtensionDockState);
  const [hiddenExtensionContexts, setHiddenExtensionContexts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const hiddenExtensionContextsRef = useRef(hiddenExtensionContexts);
  hiddenExtensionContextsRef.current = hiddenExtensionContexts;
  const extensionWindowContextRef = useRef("");
  const extensionDockStateRef = useRef(extensionDockState);
  extensionDockStateRef.current = extensionDockState;
  useEffect(() => {
    if (phase !== "ready") return;
    // Only the conversational Workbench needs extra horizontal room for a true left-chat/right-result split.
    // Office promotes an opened document to its full main stage and therefore must not resize the native window.
    const context: ExtensionContext | null = (zone === "chat" || zone === "projects") && active
      ? { place: zone, sessionId: active }
      : null;
    const contextKey = context ? extensionContextKey(context) : null;
    const tab = context ? activeExtensionTabForContext(extensionDockState, context) : null;
    const visibleKey = contextKey && tab && !hiddenExtensionContexts.has(contextKey)
      ? contextKey
      : "";
    if (!visibleKey || extensionWindowContextRef.current === visibleKey) {
      if (!visibleKey) extensionWindowContextRef.current = "";
      return;
    }
    extensionWindowContextRef.current = visibleKey;
    void invoke("ensure_extension_window_width").catch(() => {
      // Layout still remains a true in-window split when native expansion is unavailable.
    });
  }, [active, extensionDockState, hiddenExtensionContexts, phase, zone]);
  const revealExtensionItem = useCallback((item: ExtensionDockItem) => {
    const key = extensionItemContextKey(item);
    setHiddenExtensionContexts((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);
  const setExtensionDock = useCallback((next: ExtensionDockItem | null) => {
    if (next) revealExtensionItem(next);
    setExtensionDockState((state) => {
      const current = activeExtensionTab(state);
      if (!next) return current ? closeExtensionTab(state, current.id) : state;
      return upsertExtensionTab(state, next);
    });
  }, [revealExtensionItem]);
  const offerExtensionTab = useCallback((tab: ExtensionDockItem, activate = true) => {
    if (activate) revealExtensionItem(tab);
    setExtensionDockState((state) => {
      const previousActiveId = state.activeId;
      const next = upsertExtensionTab(state, tab);
      return activate ? next : { ...next, activeId: previousActiveId };
    });
  }, [revealExtensionItem]);
  const clearExtensionDock = useCallback(() => {
    setExtensionDockState(emptyExtensionDockState());
    setHiddenExtensionContexts(new Set());
  }, []);
  const [extensionLoading, setExtensionLoading] = useState(false);
  const [home, setHome] = useState("");
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [autoUnread, setAutoUnread] = useState(0); // ambient counter — never mixes with manual unread
  const [autoView, setAutoView] = useState<AutomationViewId>("tasks");
  const [auto, setAuto] = useState<AutomationListResult | null | "old-server">(null);
  const refreshAuto = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const next = await client.listAutomation();
      setAuto(next ?? "old-server");
    } catch {
      // The connection banner owns transport failures. Focus/interval refresh will retry.
    }
  }, []);
  const [artifacts, setArtifacts] = useState<{ artifacts: ArtifactSummary[]; invalid: number; truncated: boolean } | null | "old-server">(null);
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;
  const [activeArtifact, setActiveArtifact] = useState<ArtifactDetails | null>(null);
  const [activePresentation, setActivePresentation] = useState<PresentationArtifactDetails | null>(null);
  const [presentationPreviewHtml, setPresentationPreviewHtml] = useState<string | null>(null);
  const [artifactRevisions, setArtifactRevisions] = useState<ArtifactRevision[]>([]);
  const [artifactValidationReport, setArtifactValidationReport] = useState<ArtifactValidationReport | null>(null);
  const [artifactExportReceipt, setArtifactExportReceipt] = useState<ArtifactExportReceipt | null>(null);
  const [artifactBusy, setArtifactBusy] = useState<"" | "import" | "open" | "save" | "verify" | "export">("");
  const artifactOpenRequestRef = useRef(0);
  const refreshArtifacts = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const next = await client.listArtifacts();
      setArtifacts(next ?? "old-server");
    } catch {
      // The main connection banner owns transport failures; a later zone entry retries this read.
    }
  }, []);
  // 🤖 place: read-only replay of an automated run (never a live conversation — fork to continue)
  const [autoReplay, setAutoReplay] = useState<{ id: string; title: string; sourceName?: string; cwd: string; items: { role: string; text: string }[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.collapsed") ?? "{}");
    } catch {
      return {};
    }
  });
  const [projectListState, setProjectListState] = useState<ProjectListState>(() =>
    projectListStateFromStorage(
      localStorage.getItem(OPENED_PROJECTS_STORAGE_KEY),
      localStorage.getItem(HIDDEN_PROJECTS_STORAGE_KEY),
    ));
  const openedProjects = projectListState.opened;
  const [locale, setLocale] = useState<Locale>(detectLocale());
  const t = makeT(locale);
  const groupsCopy = useMemo<GroupsCopy>(() => {
    const translate = makeT(locale);
    return {
      locale,
      sidebarTitle: translate("groupsSidebarTitle"),
      disabled: translate("groupsDisabled"),
      sidebarHint: translate("groupsSidebarHint"),
      eyebrow: translate("groupsEyebrow"),
      title: translate("groupsTitle"),
      description: translate("groupsDescription"),
      entryVisible: translate("groupsEntryVisible"),
      entryVisibleHint: translate("groupsEntryVisibleHint"),
      remoteOff: translate("groupsRemoteOff"),
      remoteOffHint: translate("groupsRemoteOffHint"),
      publicTitle: translate("groupsPublicTitle"),
      publicHint: translate("groupsPublicHint"),
      organizationTitle: translate("groupsOrganizationTitle"),
      organizationHint: translate("groupsOrganizationHint"),
      boundaryTitle: translate("groupsBoundaryTitle"),
      boundaryHint: translate("groupsBoundaryHint"),
      manage: translate("groupsManage"),
      hide: translate("groupsHide"),
      directoryLoading: translate("groupsDirectoryLoading"),
      directoryError: translate("groupsDirectoryError"),
      retry: translate("groupsRetry"),
      organizations: translate("groupsOrganizations"),
      noOrganizations: translate("groupsNoOrganizations"),
      noOrganizationsHint: translate("groupsNoOrganizationsHint"),
      manageOrganizations: translate("groupsManageOrganizations"),
      activeOrganization: translate("groupsActiveOrganization"),
      selectedOrganization: translate("groupsSelectedOrganization"),
      deskConnected: translate("groupsDeskConnected"),
      deskNotConnected: translate("groupsDeskNotConnected"),
      deskNeedsRebind: translate("groupsDeskNeedsRebind"),
      switchLocked: translate("groupsSwitchLocked"),
      switchOrganization: translate("groupsSwitchOrganization"),
      switchingOrganization: translate("groupsSwitchingOrganization"),
      readOnly: translate("groupsReadOnly"),
      readyTitle: translate("groupsReadyTitle"),
      readyHint: translate("groupsReadyHint"),
      readBoard: translate("groupsReadBoard"),
      readingBoard: translate("groupsReadingBoard"),
      refreshBoard: translate("groupsRefreshBoard"),
      registrationTitle: translate("groupsRegistrationTitle"),
      registrationHint: translate("groupsRegistrationHint"),
      rebindHint: translate("groupsRebindHint"),
      legacyUnbound: translate("groupsLegacyUnbound"),
      tasksMetric: translate("groupsTasksMetric"),
      agentsMetric: translate("groupsAgentsMetric"),
      activityMetric: translate("groupsActivityMetric"),
      circlesMetric: translate("groupsCirclesMetric"),
      lastRead: translate("groupsLastRead"),
      truncated: translate("groupsTruncated"),
      noTasks: translate("groupsNoTasks"),
      noTasksHint: translate("groupsNoTasksHint"),
      taskDetails: translate("groupsTaskDetails"),
      backToBoard: translate("groupsBackToBoard"),
      pinnedOrganization: translate("groupsPinnedOrganization"),
      taskTimeline: translate("groupsTaskTimeline"),
      noTimeline: translate("groupsNoTimeline"),
      createdBy: translate("groupsCreatedBy"),
      claimedBy: translate("groupsClaimedBy"),
      risk: translate("groupsRisk"),
      stateOpen: translate("groupsStateOpen"),
      stateClaimed: translate("groupsStateClaimed"),
      stateDone: translate("groupsStateDone"),
      stateCancelled: translate("groupsStateCancelled"),
      kindFeedback: translate("groupsKindFeedback"),
      kindDispatch: translate("groupsKindDispatch"),
      riskLow: translate("groupsRiskLow"),
      riskHigh: translate("groupsRiskHigh"),
    };
  }, [locale]);
  const [groupsDirectory, setGroupsDirectory] = useState<GroupsDirectoryState>({
    phase: "idle",
  });
  const [groupsState, dispatchGroups] = useReducer(
    groupsReducer,
    undefined,
    initialGroupsState,
  );
  const groupsRequestGenerationRef = useRef(0);
  const groupsDirectoryRequestRef = useRef(0);
  const groupsActivationRequestRef = useRef(0);
  const groupsSwitchingProfileRef = useRef("");
  const [groupsSwitchingProfileId, setGroupsSwitchingProfileId] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    void invoke<string>("get_home").then(setHome).catch(() => {});
    void (async () => {
      if (!(await isPermissionGranted().catch(() => false))) await requestPermission().catch(() => {});
    })();
  }, []);
  // Automation state is local RPC data, not a model turn. Refreshing it on focus and every 30 seconds
  // keeps next-run/health/result state honest without consuming model tokens.
  useEffect(() => {
    if (phase !== "ready" || zone !== "auto") return;
    void refreshAuto();
    const intervalId = window.setInterval(() => void refreshAuto(), 30_000);
    const onFocus = () => void refreshAuto();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase, zone, refreshAuto]);
  // dock badge = manual unread count (interruption-grade only; ambient automation never badges)
  useEffect(() => {
    const n = Object.values(unread).filter(Boolean).length;
    void invoke("set_badge", { count: n > 0 ? n : null }).catch(() => {});
  }, [unread]);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const activeByZoneRef = useRef<Record<Extract<SessionPlace, "chat" | "projects">, string | null>>({
    chat: null,
    projects: null,
  });
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    pluginsRef.current = plugins;
  }, [plugins]);
  const rememberSession = (id: string, session: SessionPlaceInput) => {
    const place = sessionPlace(session);
    if (place === "chat" || place === "projects") activeByZoneRef.current[place] = id;
  };
  const rememberSessionApproval = useCallback((sessionId: string, approval?: ApprovalMode) => {
    if (!approval) return;
    const next = sessionsRef.current.map((session) =>
      session.id === sessionId ? { ...session, approval } : session);
    sessionsRef.current = next;
    setSessions(next);
  }, []);
  const activateSession = (id: string, hint?: SessionPlaceInput) => {
    const session = hint ?? sessionsRef.current.find((candidate) => candidate.id === id);
    if (session) rememberSession(id, session);
    setActive(id);
  };
  const clearActiveSession = (id: string) => {
    if (activeByZoneRef.current.chat === id) activeByZoneRef.current.chat = null;
    if (activeByZoneRef.current.projects === id) activeByZoneRef.current.projects = null;
    if (active === id) setActive(null);
  };
  const interruptedSessionsRef = useRef(new Set<string>());
  const openPetSessionRef = useRef<(sessionId: string) => Promise<void>>(async () => {});
  const petChatSubmitRef = useRef<(request: PetChatSubmit) => Promise<string | undefined>>(async () => undefined);
  const petChatApprovalRef = useRef<(request: PetChatApproval) => Promise<void>>(async () => {});
  const {
    awake: petAwake,
    setAwake: setPetAwake,
    selector: petSelector,
    setSelector: setPetSelector,
    catalog: petCatalog,
    catalogError: petCatalogError,
    refreshCatalog: refreshPets,
    note: notePet,
    acknowledge: acknowledgePet,
    clear: removePet,
    refreshChat: refreshPetChat,
  } = useDesktopCompanion({
    getActivityTitle: (sessionId) =>
      sessionsRef.current.find((session) => session.id === sessionId)?.title || "Hara task",
    onOpenActivity: (sessionId) => openPetSessionRef.current(sessionId),
    resolveChatSession: (requestedSessionId) => {
      if (requestedSessionId !== undefined) return requestedSessionId;
      return assistantZone(sessionsRef.current).current?.id;
    },
    getChatState: (sessionId, petStatus): PetChatState => {
      const target = sessionId;
      const session = target
        ? sessionsRef.current.find((candidate) => candidate.id === sessionId)
        : undefined;
      const unavailable = !!target && !session;
      const task = target ? taskStatesRef.current[target] : undefined;
      const transcript = target ? transcriptsRef.current[target] ?? [] : [];
      const pendingApproval = target && busyRef.current[target]
        ? [...transcript]
            .reverse()
            .find((item) => item.kind === "approval" && !item.answered)
        : undefined;
      const legacyState = pendingApproval
        ? "waiting"
        : petStatus === "idle"
          ? undefined
          : petStatus === "ready"
            ? "completed"
            : petStatus;
      const projectedTask: PetChatState["task"] = task
        ? {
            state: task.state,
            phase: task.phase,
            objective: task.objective,
            checkpoint: task.checkpoint,
            ...(task.approval ? { approval: task.approval } : {}),
          }
        : legacyState
          ? {
              state: legacyState,
              phase: pendingApproval ? "approval" : legacyState === "completed" ? "finished" : "legacy",
              objective: session?.title || (locale === "zh" ? "个人助理" : "Personal assistant"),
              checkpoint: { done: 0, total: 0 },
              ...(pendingApproval?.kind === "approval"
                ? { approval: { id: pendingApproval.approvalId, question: pendingApproval.question } }
                : {}),
            }
          : undefined;
      const connected = !!clientRef.current?.connected && phase === "ready";
      return {
        connected,
        canSubmit: connected && !unavailable && (!session || !isAutomated(session)),
        ...(unavailable ? { unavailable: true } : {}),
        locale,
        ...(target ? { sessionId: target } : {}),
        title: session?.title || (
          unavailable
            ? locale === "zh" ? "会话不可用" : "Conversation unavailable"
            : locale === "zh" ? "个人助理" : "Personal assistant"
        ),
        petStatus,
        ...(projectedTask ? { task: projectedTask } : {}),
        messages: recentPetMessages(transcript),
      };
    },
    onChatSubmit: (request) => petChatSubmitRef.current(request),
    onChatApproval: (request) => petChatApprovalRef.current(request),
  });
  const hydrateLegacyTaskState = useCallback((
    client: HaraClient,
    sessionId: string,
    task?: ResumedTaskSnapshot,
  ) => {
    if (!task || client.supportsEvent("event.task_state")) return;
    const event = restoredTaskLifecycle(sessionId, task);
    const nextTaskStates = { ...taskStatesRef.current, [sessionId]: event };
    taskStatesRef.current = nextTaskStates;
    setTaskStates(nextTaskStates);
    const live = taskStateIsLive(event.state);
    if (live) activeTurnsRef.current[sessionId] = event.turnId;
    else delete activeTurnsRef.current[sessionId];
    setSessionBusy(sessionId, live);
    if (event.state === "completed") removePet(sessionId);
    else notePet(sessionId, taskStatePetStatus(event.state), taskStateTitle(event));
  }, [notePet, removePet, setSessionBusy]);
  useEffect(() => {
    refreshPetChat();
  }, [active, locale, phase, refreshPetChat, sessions, taskStates, transcripts]);
  const [q, setQ] = useState("");
  const [upd, setUpd] = useState("");
  const [updateTone, setUpdateTone] = useState<"neutral" | "success" | "warning" | "error">("neutral");
  const [updating, setUpdating] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateNoticeVisible, setUpdateNoticeVisible] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);
  const [updateStorage, setUpdateStorage] = useState<DesktopUpdateStorageStatus | null>(null);
  const [updateStorageBusy, setUpdateStorageBusy] = useState(false);
  const [updateStorageNotice, setUpdateStorageNotice] = useState<{
    tone: "success" | "warning" | "error";
    title: string;
  } | null>(null);
  const [desktopVersion, setDesktopVersion] = useState("");
  const [commandLineHara, setCommandLineHara] = useState<CommandLineHaraStatus | null>(null);
  const [commandLineBusy, setCommandLineBusy] = useState(false);
  const [commandLineNotice, setCommandLineNotice] = useState("");
  const [commandLineTone, setCommandLineTone] = useState<"success" | "error">("success");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [updAvail, setUpdAvail] = useState("");
  const pendingDesktopUpdateRef = useRef<PendingDesktopUpdate | null>(null);
  const pendingRef = useRef<"assistant" | "project" | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const apiRef = useRef<{ setZone: (z: Zone) => void; openAssistant: () => void; openProject: () => void }>({ setZone: () => {}, openAssistant: () => {}, openProject: () => {} });
  // Follow-up queue: current engines atomically start-or-steer text through session.submit. Attachments
  // stay with their text as one fresh turn because an active model round cannot absorb new file context.
  const [queue, setQueue] = useState<Record<string, QueuedInput[]>>({});
  const queueRef = useRef(queue);
  const pendingInputSequenceRef = useRef(0);
  const retryingQueuedInputsRef = useRef(new Set<string>());
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.pins") ?? "[]");
    } catch {
      return [];
    }
  });
  // context watermark per session (rides on every turn_end; codex thread/tokenUsage pattern)
  const [ctxMap, setCtxMap] = useState<Record<string, CtxInfo>>({});
  // composer autocomplete — "file" while the caret sits on an @token (codex fuzzyFileSearch),
  // "skill" while the input is a bare /command (codex slash popup)
  const [ac, setAc] = useState<{ open: boolean; items: { v: string; hint?: string }[]; sel: number; mode: "file" | "skill" }>({ open: false, items: [], sel: 0, mode: "file" });
  const acTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputCompositionRef = useRef(false);
  const skillsRef = useRef<SkillInfo[] | null>(null); // lazy-loaded on the first "/" keystroke
  const togglePin = (id: string) => {
    setPins((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      localStorage.setItem("hara.pins", JSON.stringify(next));
      return next;
    });
  };

  const saveNavigationPreferences = useCallback((
    update: (current: NavigationPreferences) => NavigationPreferences,
  ) => {
    setNavigationPreferences((current) => {
      const next = update(current);
      if (next !== current) {
        localStorage.setItem(NAVIGATION_PREFERENCES_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const saveExecutionViewMode = useCallback((mode: ExecutionViewMode) => {
    setExecutionViewMode(mode);
    localStorage.setItem(EXECUTION_VIEW_PREFERENCE_KEY, mode);
  }, []);

  const refreshGroupsDirectory = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    const requestId = ++groupsDirectoryRequestRef.current;
    setGroupsDirectory((current) => ({
      ...current,
      phase: "loading",
      error: undefined,
    }));
    try {
      // Both RPCs are local private-state reads. They run in parallel and do not contact Hara Desk.
      const cwd = home ? `${home}/.hara/workspace` : undefined;
      const [organizations, desk] = await Promise.all([
        client.listOrganizationConnections(cwd),
        client.listDeskConnections(),
      ]);
      if (requestId !== groupsDirectoryRequestRef.current || clientRef.current !== client) return;
      setOrganizationRoutes(organizations);
      if (!organizations || !desk || !client.supportsFeature("collaboration.remote.v1")) {
        setGroupsDirectory({ phase: "unsupported" });
        return;
      }
      setGroupsDirectory({
        phase: "ready",
        organizations,
        desk,
      });
      dispatchGroups({
        type: "directorySynced",
        profiles: groupsDirectoryProfiles(organizations.connections, desk.connections),
        preferredProfileId: organizations.connections.find((connection) => connection.active)?.id,
      });
    } catch (error) {
      if (requestId !== groupsDirectoryRequestRef.current || clientRef.current !== client) return;
      setGroupsDirectory({
        phase: "error",
        error: String(error instanceof Error ? error.message : error).slice(0, 240),
      });
    }
  }, [home]);

  const selectGroupsOrganization = useCallback(async (profileId: string): Promise<void> => {
    const client = clientRef.current;
    const organizations = groupsDirectory.organizations;
    const selected = organizations?.connections.find((connection) => connection.id === profileId);
    if (!client || !organizations || !selected || groupsSwitchingProfileRef.current) return;
    if (selected.active) {
      dispatchGroups({ type: "selectProfile", profileId });
      return;
    }
    if (organizations.switchLocked) {
      setErr(
        locale === "zh"
          ? "当前项目或启动配置固定了组织，解除固定后才能切换。"
          : "This project or launch configuration pins the organization. Remove the pin before switching.",
      );
      return;
    }
    const requestId = ++groupsActivationRequestRef.current;
    groupsSwitchingProfileRef.current = profileId;
    setGroupsSwitchingProfileId(profileId);
    try {
      const targetCwd = home ? `${home}/.hara/workspace` : server?.cwd;
      const next = await client.useOrganizationConnection(profileId, targetCwd);
      if (
        requestId !== groupsActivationRequestRef.current
        || clientRef.current !== client
      ) return;
      setGroupsDirectory((current) => ({
        ...current,
        phase: "ready",
        organizations: next,
      }));
      setOrganizationRoutes(next);
      dispatchGroups({
        type: "directorySynced",
        profiles: groupsDirectoryProfiles(
          next.connections,
          groupsDirectory.desk?.connections ?? [],
        ),
        preferredProfileId: profileId,
      });
      const providerRoute = await client.listProviderSettings(targetCwd);
      if (
        requestId !== groupsActivationRequestRef.current
        || clientRef.current !== client
      ) return;
      if (providerRoute) {
        setProviderRoutes(providerRoute);
        setSetupRequired(!providerRoute.current.authenticated);
        setServer((current) => current
          ? {
              ...current,
              provider: providerRoute.current.provider,
              model: providerRoute.current.model,
            }
          : current);
        await refreshModelInfo(active
          ? { sessionId: active }
          : { cwd: targetCwd });
      }
    } catch (error) {
      if (
        requestId === groupsActivationRequestRef.current
        && clientRef.current === client
      ) {
        setErr(String(error instanceof Error ? error.message : error).slice(0, 240));
      }
    } finally {
      if (groupsSwitchingProfileRef.current === profileId) {
        groupsSwitchingProfileRef.current = "";
      }
      if (
        requestId === groupsActivationRequestRef.current
        && clientRef.current === client
      ) setGroupsSwitchingProfileId("");
    }
  }, [
    active,
    groupsDirectory.desk?.connections,
    groupsDirectory.organizations,
    home,
    locale,
    refreshModelInfo,
    server?.cwd,
  ]);

  const readGroupsBoard = useCallback(async (
    profileId: string,
    state: DeskTaskState,
  ): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    const generation = ++groupsRequestGenerationRef.current;
    dispatchGroups({ type: "snapshotStarted", profileId, generation });
    try {
      const data = await client.deskSnapshot(profileId, state);
      if (!data) throw new Error(
        locale === "zh"
          ? "当前 Hara 引擎不支持组织 Desk，请更新 Desktop。"
          : "This Hara engine does not support organization Desk. Update Desktop.",
      );
      dispatchGroups({ type: "snapshotSucceeded", profileId, generation, data });
    } catch (error) {
      dispatchGroups({
        type: "snapshotFailed",
        profileId,
        generation,
        error: String(error instanceof Error ? error.message : error).slice(0, 240),
      });
    }
  }, [locale]);

  const openGroupsTask = useCallback(async (
    profileId: string,
    taskId: string,
  ): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;
    dispatchGroups({ type: "openTask", profileId, taskId });
    const generation = ++groupsRequestGenerationRef.current;
    dispatchGroups({ type: "taskStarted", profileId, taskId, generation });
    try {
      const data = await client.getDeskTask(profileId, taskId);
      if (!data) throw new Error(
        locale === "zh"
          ? "当前 Hara 引擎不支持组织任务详情，请更新 Desktop。"
          : "This Hara engine does not support organization task details. Update Desktop.",
      );
      dispatchGroups({
        type: "taskSucceeded",
        profileId,
        taskId,
        generation,
        data,
      });
    } catch (error) {
      dispatchGroups({
        type: "taskFailed",
        profileId,
        taskId,
        generation,
        error: String(error instanceof Error ? error.message : error).slice(0, 240),
      });
    }
  }, [locale]);

  // Entering Groups performs only two local, redacted inventory reads. Remote Desk data is fetched
  // exclusively by the user's "Read board" or task-detail action; there is no polling or timer.
  useEffect(() => {
    if (phase !== "ready" || zone !== "groups") return;
    void refreshGroupsDirectory();
  }, [phase, zone, refreshGroupsDirectory]);

  const currentExtensionContext = (): ExtensionContext | null => {
    const currentZone = zoneRef.current;
    if (currentZone === "office") return { place: "office" };
    if (currentZone === "chat" || currentZone === "projects") {
      return { place: currentZone, sessionId: activeRef.current };
    }
    return null;
  };
  const visibleSessionWorkObject = useCallback((sessionId: string): ExtensionDockItem | null => {
    if (activeRef.current !== sessionId) return null;
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
    const place = session ? sessionPlace(session) : null;
    if ((place !== "chat" && place !== "projects") || zoneRef.current !== place) return null;
    const context: ExtensionContext = { place, sessionId };
    const contextKey = extensionContextKey(context);
    if (!contextKey || hiddenExtensionContextsRef.current.has(contextKey)) return null;
    return activeExtensionTabForContext(extensionDockStateRef.current, context);
  }, []);
  const textWithActiveWorkObject = useCallback((sessionId: string, text: string): string => {
    const item = visibleSessionWorkObject(sessionId);
    return item ? messageWithActiveWorkObject(item, text) : text;
  }, [visibleSessionWorkObject]);
  const discardCurrentExtensionDraft = (): boolean => {
    const context = currentExtensionContext();
    const current = context
      ? activeExtensionTabForContext(extensionDockStateRef.current, context)
      : null;
    if (!current?.dirty) return true;
    if (!window.confirm(locale === "zh"
      ? "当前演示文稿有未保存的更改。要放弃这些更改并离开吗？"
      : "The current presentation has unsaved changes. Discard them and leave?")) return false;
    const next = updateExtensionTab(
      extensionDockStateRef.current,
      current.id,
      (tab) => ({ ...tab, dirty: false }),
    );
    extensionDockStateRef.current = next;
    setExtensionDockState(next);
    return true;
  };
  const hasDirtyExtensionDraft = extensionDockState.tabs.some((tab) => tab.dirty === true);
  useEffect(() => {
    if (!hasDirtyExtensionDraft) return;
    const preventAccidentalClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalClose);
    return () => window.removeEventListener("beforeunload", preventAccidentalClose);
  }, [hasDirtyExtensionDraft]);

  const setZone = (z: Zone): boolean => {
    const previousZone = zoneRef.current;
    const capabilitySkillCwd = z === "settings"
      ? sessionsRef.current.find((session) => session.id === activeRef.current)?.cwd
      : undefined;
    if (z !== previousZone && !discardCurrentExtensionDraft()) return false;
    preloadPlace(z);
    if (z === "settings") preloadSettingsSection(setSec);
    if ((previousZone === "chat" || previousZone === "projects") && activeRef.current) {
      const current = sessionsRef.current.find((candidate) => candidate.id === activeRef.current);
      if (current && sessionPlace(current) === previousZone) {
        activeByZoneRef.current[previousZone] = activeRef.current;
      }
    }
    zoneRef.current = z;
    if (z === "chat" || z === "projects") {
      workbenchPlaceRef.current = z;
      localStorage.setItem("hara.workbench.place", z);
    }
    sessionOpenRequestRef.current += 1;
    setZoneRaw(z);
    setAutoReplay(null);
    localStorage.setItem("hara.zone", z);
    if (z === "chat" || z === "projects") {
      const candidateId = activeByZoneRef.current[z];
      const candidate = candidateId ? sessionsRef.current.find((session) => session.id === candidateId) : undefined;
      setActive(candidate && sessionPlace(candidate) === z ? candidate.id : null);
    } else {
      setActive(null);
    }
    if (z === "office") void refreshArtifacts();
    const settingsClient = z === "settings" ? clientRef.current : null;
    if (settingsClient) {
      const requestId = ++capabilityCatalogRequestRef.current;
      capabilitySkillsCwdRef.current = capabilitySkillCwd;
      setSkills(null);
      void Promise.all([settingsClient.listPlugins(), settingsClient.listSkills(capabilitySkillCwd)]).then(([pl, sk]) => {
        if (clientRef.current !== settingsClient || capabilityCatalogRequestRef.current !== requestId) return;
        pluginsRef.current = pl.plugins;
        setPlugins(pl.plugins);
        setSkills(sk.skills);
      }).catch(() => {});
      void refreshGroupsDirectory();
      void refreshPets();
    } else {
      capabilityCatalogRequestRef.current += 1;
    }
    if (z === "auto" && clientRef.current) {
      void refreshAuto();
      markAutoSeen();
    }
    return true;
  };

  const push = useCallback(
    (sessionId: string, mut: (items: ConversationItem[]) => ConversationItem[]) => {
      setTranscripts((tr) => {
        const next = { ...tr, [sessionId]: mut(tr[sessionId] ?? []) };
        transcriptsRef.current = next;
        return next;
      });
    },
    [],
  );

  /** Commit the latest staged composer route only when Serve accepts it between turns.
   *  One in-flight loop owns each session: if the user changes their choice while an RPC is running,
   *  the loop re-reads the newer revision before allowing the next send. */
  const flushStagedModelChange = useCallback((sessionId: string): Promise<ModelChangeFlushResult> => {
    const existing = stagedModelChangeFlushesRef.current[sessionId];
    if (existing) return existing;

    const run = async (): Promise<ModelChangeFlushResult> => {
      let applied = false;
      nextRevision: while (true) {
        const staged = stagedModelChangesRef.current[sessionId];
        if (!staged) return applied ? "applied" : "none";
        const client = clientRef.current;
        if (!client?.connected) return "deferred";

        let result: Awaited<ReturnType<HaraClient["setSessionModel"]>> | null = null;
        for (let attempt = 0; result === null; attempt += 1) {
          try {
            result = await client.setSessionModel(
              sessionId,
              staged.model,
              staged.effort || undefined,
            );
          } catch (error: any) {
            if (error?.code !== SERVER_BUSY) {
              if (stagedModelChangesRef.current[sessionId]?.revision !== staged.revision) {
                continue nextRevision;
              }
              clearStagedModelChange(sessionId, staged.revision);
              push(sessionId, (items) => [...items, {
                kind: "notice",
                text: locale === "zh"
                  ? `模型或思考模式切换失败：${error?.message ?? error}`
                  : `Model or thinking mode switch failed: ${error?.message ?? error}`,
              }]);
              return "failed";
            }
            const delay = MODEL_CHANGE_BUSY_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) {
              if (stagedModelChangesRef.current[sessionId]?.revision !== staged.revision) {
                continue nextRevision;
              }
              return "deferred";
            }
            await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
          }
        }

        if (clientRef.current !== client) return "deferred";
        setSessions((list) => {
          const next = list.map((session) => (
            session.id === sessionId ? { ...session, model: result.model } : session
          ));
          sessionsRef.current = next;
          return next;
        });
        setSessEffort((current) => ({ ...current, [sessionId]: result.effort ?? "" }));
        clearStagedModelChange(sessionId, staged.revision);
        applied = true;

        // A newer click may have replaced this revision while Serve rebuilt the provider. Keep the
        // optimistic badge stable and refresh authoritative capabilities only after the latest wins.
        if (!stagedModelChangesRef.current[sessionId] && activeRef.current === sessionId) {
          await refreshModelInfo({ sessionId }).catch(() => {});
        }
      }
    };

    const task = run().finally(() => {
      if (stagedModelChangeFlushesRef.current[sessionId] === task) {
        delete stagedModelChangeFlushesRef.current[sessionId];
      }
    });
    stagedModelChangeFlushesRef.current[sessionId] = task;
    return task;
  }, [clearStagedModelChange, locale, push, refreshModelInfo]);

  const nextPendingInputId = useCallback(
    () => `pending-${Date.now()}-${++pendingInputSequenceRef.current}`,
    [],
  );

  const resolvePendingUser = useCallback((
    sessionId: string,
    pendingId: string,
    accepted: boolean,
  ) => {
    push(sessionId, (items) => resolveOptimisticUser(items, pendingId, accepted));
  }, [push]);

  const enqueueInput = useCallback((
    sessionId: string,
    input: QueuedInput,
    position: "front" | "back" = "back",
  ) => {
    setQueue((queues) => {
      const current = queues[sessionId] ?? [];
      const next = {
        ...queues,
        [sessionId]: position === "front" ? [input, ...current] : [...current, input],
      };
      queueRef.current = next;
      return next;
    });
  }, []);

  const cancelQueuedInput = useCallback((sessionId: string, index: number) => {
    const current = queueRef.current[sessionId] ?? [];
    const removed = current[index];
    if (!removed) return;
    const next = {
      ...queueRef.current,
      [sessionId]: current.filter((_, queuedIndex) => queuedIndex !== index),
    };
    queueRef.current = next;
    setQueue(next);
    if (removed.recorded) {
      push(sessionId, (items) => [...resolveOptimisticUser(items, removed.id, false), {
        kind: "notice",
        text: locale === "zh" ? "已取消尚未执行的补充消息。" : "Canceled the queued follow-up before it ran.",
      }]);
    }
  }, [locale, push]);

  const sendText = useCallback(
    async (
      sessionId: string,
      text: string,
      attachments?: ComposerAttachment[],
      options?: {
        recordUser?: boolean;
        requeueFrontOnBusy?: boolean;
        pendingId?: string;
        wireText?: string;
      },
    ): Promise<"started" | "steered" | "queued" | "failed"> => {
      const c = clientRef.current;
      if (!c?.connected) throw new Error("Hara engine is not connected");
      if (readOnlySessionsRef.current[sessionId]) {
        throw new Error(
          locale === "zh"
            ? "当前仅查看本地历史。请选择另一条可用连接并携带上下文继续。"
            : "This is a local read-only replay. Choose another available connection and continue with copied context.",
        );
      }
      if (attachments?.length && !c.supportsFeature("composer.attachments.v1")) {
        throw new Error(
          locale === "zh"
            ? "当前 Hara 引擎版本不支持安全附件，请先更新 Hara Desktop。"
            : "This Hara engine cannot send safe attachments. Update Hara Desktop first.",
        );
      }
      const wireText = options?.wireText ?? textWithActiveWorkObject(sessionId, text);
      const atomicSubmit = c.supports("session.submit");
      // A queued or freshly submitted turn must never overtake the user's staged model choice.
      // Serve remains authoritative and revalidates the model, effort, organization, and history.
      const modelChange = await flushStagedModelChange(sessionId);
      if (modelChange === "deferred" && !atomicSubmit) {
        throw new Error(
          locale === "zh"
            ? "所选模型或思考模式尚未应用；Hara 引擎仍在结束上一轮，请稍后重试。"
            : "The selected model or thinking mode is not applied yet. The previous turn is still finishing; try again shortly.",
        );
      }
      if (modelChange === "failed") {
        throw new Error(
          locale === "zh"
            ? "所选模型或思考模式无法应用。请查看会话提示后重新选择。"
            : "The selected model or thinking mode could not be applied. Review the conversation notice and choose again.",
        );
      }
      // A staged route belongs to the next fresh turn. Core checks both strict idle admission and the
      // expected provider configuration, closing the boundary where the old turn ends between RPCs.
      let pendingModelRoute = modelChange === "deferred"
        ? stagedModelChangesRef.current[sessionId]
        : undefined;
      let atomicSubmitMode: SessionSubmitMode = pendingModelRoute ? "start_if_idle" : "start_or_steer";
      const pendingId = options?.pendingId ?? nextPendingInputId();
      if (options?.recordUser !== false) {
        push(sessionId, (items) => [...items, {
          kind: "user",
          text,
          ...(attachments?.length
            ? {
                attachments: attachments.map((attachment) => ({
                  kind: attachment.kind,
                  name: attachment.name,
                })),
              }
            : {}),
          pendingId,
        }]);
      }
      presentationSurfaceTurnsRef.current[sessionId] = {
        startedAt: Date.now(),
        surfaceOffered: false,
        baselineRevisionIds: new Set(
          artifactsRef.current && artifactsRef.current !== "old-server"
            ? artifactsRef.current.artifacts.map((artifact) => artifact.currentRevisionId)
            : [],
        ),
      };
      setSessionBusy(sessionId, true);
      notePet(sessionId, "running");
      let busyAttempt = 0;
      const clearPendingDispatch = () => {
        if (pendingSendDispatchesRef.current[sessionId]?.pendingId === pendingId) {
          delete pendingSendDispatchesRef.current[sessionId];
        }
      };
      while (true) {
        pendingSendDispatchesRef.current[sessionId] = { pendingId };
        try {
          const attachmentIntents: SessionAttachmentIntent[] | undefined = attachments?.map(
            ({ id, name: _name, byteSize: _byteSize, ...attachment }) => ({
              ...attachment,
              clientId: id,
            }),
          );
          const submission = atomicSubmit
            ? await c.submit(sessionId, wireText, attachmentIntents, {
                mode: atomicSubmitMode,
                ...(pendingModelRoute
                  ? {
                      expectedModel: pendingModelRoute.model,
                      expectedEffort: pendingModelRoute.effort,
                    }
                  : {}),
              })
            : await c.send(sessionId, wireText, attachmentIntents);
          if ("submission" in submission && submission.submission === "not_submitted") {
            if (submission.reason === "empty_input") {
              throw new Error(
                locale === "zh"
                  ? "请输入消息或添加至少一个附件。"
                : "Enter a message or add at least one attachment.",
              );
            }
            const localTurnId = activeTurnsRef.current[sessionId];
            const localTaskState = taskStatesRef.current[sessionId];
            const reportedTurnStillLive = Boolean(
              submission.activeTurnId
              && (
                localTurnId === submission.activeTurnId
                || (
                  localTaskState?.turnId === submission.activeTurnId
                  && taskStateIsLive(localTaskState.state)
                )
              ),
            );
            if (submission.reason === "configuration_mismatch" && !submission.activeTurnId) {
              const refreshedModel = await flushStagedModelChange(sessionId);
              if (refreshedModel === "failed") {
                throw new Error(
                  locale === "zh"
                    ? "所选模型或思考模式无法应用。请查看会话提示后重新选择。"
                    : "The selected model or thinking mode could not be applied. Review the conversation notice and choose again.",
                );
              }
              pendingModelRoute = refreshedModel === "deferred"
                ? stagedModelChangesRef.current[sessionId]
                : undefined;
              atomicSubmitMode = pendingModelRoute ? "start_if_idle" : "start_or_steer";
            }
            if ((!submission.activeTurnId || !reportedTurnStillLive) && busyAttempt < BUSY_SEND_RETRIES) {
              busyAttempt += 1;
              await new Promise<void>((resolve) => window.setTimeout(resolve, busyAttempt * 120));
              continue;
            }
            clearPendingDispatch();
            enqueueInput(
              sessionId,
              {
                id: pendingId,
                text,
                wireText,
                ...(attachments?.length ? { attachments } : {}),
                recorded: true,
              },
              options?.requeueFrontOnBusy ? "front" : "back",
            );
            // A turn_end can overtake the rejection response on the socket. Only wait for another
            // turn_end when Desktop still observes that exact turn; otherwise leave an explicit Retry.
            const live = reportedTurnStillLive;
            if (!live) {
              setSessionBusy(sessionId, false);
              notePet(sessionId, "paused", "Message queued — engine is still preparing");
            }
            return "queued";
          }
          clearPendingDispatch();
          resolvePendingUser(sessionId, pendingId, true);
          if ("submission" in submission && submission.submission === "steered") {
            notePet(sessionId, "running");
            return "steered";
          }
          if (interruptedSessionsRef.current.delete(sessionId)) removePet(sessionId);
          // the first turn sets the server-side derived title — refresh so the sidebar shows it now
          void c.listSessions().then((l) => setSessions(l.sessions)).catch(() => {});
          return "started";
        } catch (e: any) {
          const interrupted = interruptedSessionsRef.current.delete(sessionId);
          if (e?.code === SERVER_BUSY && !interrupted) {
            let turnId = activeTurnsRef.current[sessionId];
            let taskState = taskStatesRef.current[sessionId];
            let live = !!turnId || (taskState ? taskStateIsLive(taskState.state) : false);
            if (!live && busyAttempt < BUSY_SEND_RETRIES) {
              // Provider reconfiguration and turn-start delivery can briefly set BUSY before a lifecycle
              // identity is observable. Retry only within this hard bound; never leave the UI spinning forever.
              busyAttempt += 1;
              await new Promise<void>((resolve) => window.setTimeout(resolve, busyAttempt * 120));
              turnId = activeTurnsRef.current[sessionId];
              taskState = taskStatesRef.current[sessionId];
              live = !!turnId || (taskState ? taskStateIsLive(taskState.state) : false);
              if (!live) continue;
            }
            if (!attachments?.length && turnId && c.supports("session.steer")) {
              // The attempted session.send did not start a turn. A following turn_end belongs to the
              // existing turn and must never acknowledge this optimistic message.
              clearPendingDispatch();
              try {
                await c.steer(sessionId, wireText, turnId);
                resolvePendingUser(sessionId, pendingId, true);
                notePet(sessionId, "running");
                return "steered";
              } catch (steerError: any) {
                if (steerError?.code !== SERVER_BUSY) {
                  resolvePendingUser(sessionId, pendingId, false);
                  push(sessionId, (items) => [...items, {
                    kind: "notice",
                    text: `error: ${steerError?.message ?? steerError}`,
                  }]);
                  setSessionBusy(sessionId, false);
                  notePet(sessionId, "blocked");
                  return "failed";
                }
                const currentTurnId = activeTurnsRef.current[sessionId];
                const currentState = taskStatesRef.current[sessionId];
                live = !!currentTurnId || (
                  currentState ? taskStateIsLive(currentState.state) : false
                );
                if (!live) {
                  busyAttempt = 0;
                  continue;
                }
              }
            }
            // A real live turn will auto-dispatch on turn_end. If BUSY had no observable task after the
            // bounded retries, keep the exact input visible but release the false busy state so Retry works.
            clearPendingDispatch();
            enqueueInput(
              sessionId,
              {
                id: pendingId,
                text,
                wireText,
                ...(attachments?.length ? { attachments } : {}),
                recorded: true,
              },
              options?.requeueFrontOnBusy ? "front" : "back",
            );
            if (!live) {
              setSessionBusy(sessionId, false);
              notePet(sessionId, "paused", "Message queued — engine is still preparing");
            }
            return "queued";
          }
          const dispatch = pendingSendDispatchesRef.current[sessionId];
          const persisted = dispatch?.pendingId === pendingId && dispatch.completed === true;
          clearPendingDispatch();
          resolvePendingUser(sessionId, pendingId, persisted);
          push(sessionId, (items) => [...items, { kind: "notice", text: `error: ${e?.message ?? e}` }]);
          setSessionBusy(sessionId, false);
          if (c.supportsEvent("event.task_state")) {
            const state = taskStatesRef.current[sessionId];
            if (!state || taskStateIsLive(state.state)) {
              if (interrupted) removePet(sessionId);
              else notePet(sessionId, "blocked");
            }
          } else if (!interrupted) notePet(sessionId, "blocked");
          else removePet(sessionId);
          return persisted ? "started" : "failed";
        }
      }
    },
    [enqueueInput, flushStagedModelChange, locale, nextPendingInputId, notePet, push, removePet, resolvePendingUser, setSessionBusy, textWithActiveWorkObject],
  );

  const retryQueuedInput = useCallback(async (sessionId: string, index: number) => {
    if (busyRef.current[sessionId]) return;
    const current = queueRef.current[sessionId] ?? [];
    const retry = current[index];
    if (!retry) return;
    const retryKey = `${sessionId}:${retry.id}`;
    if (retryingQueuedInputsRef.current.has(retryKey)) return;
    retryingQueuedInputsRef.current.add(retryKey);
    const c = clientRef.current;
    try {
      if (!c) throw new Error("Hara engine is not connected");
      if (!attachedSessionsRef.current.has(sessionId)) {
        // A reconnect invalidates every live serve attachment. Keep the queue item until resume has
        // succeeded so NO_SESSION can never turn a visible retry into dropped work.
        const resumed = await c.resumeSession(sessionId, defaultApproval || undefined);
        if (clientRef.current !== c) throw new Error("Hara engine reconnected; retry the message again");
        attachedSessionsRef.current.add(sessionId);
        rememberSessionApproval(sessionId, resumed.approval);
        const currentTranscripts = transcriptsRef.current;
        const nextTranscripts = {
          ...currentTranscripts,
          [sessionId]: restoreAuthoritativeConversation(
            conversationHistory(resumed.history),
            currentTranscripts[sessionId] ?? [],
          ),
        };
        transcriptsRef.current = nextTranscripts;
        setTranscripts(nextTranscripts);
        hydrateLegacyTaskState(c, sessionId, resumed.task);
      }
      const latest = queueRef.current[sessionId] ?? [];
      const retryIndex = latest.findIndex((item) => item.id === retry.id);
      if (retryIndex < 0) return;
      const next = {
        ...queueRef.current,
        [sessionId]: latest.filter((_, queuedIndex) => queuedIndex !== retryIndex),
      };
      queueRef.current = next;
      setQueue(next);
      await sendText(
        sessionId,
        retry.text,
        retry.attachments,
        {
          recordUser: retry.recorded !== true,
          pendingId: retry.id,
          wireText: retry.wireText,
        },
      );
    } catch (error: any) {
      push(sessionId, (items) => [...items, {
        kind: "notice",
        text: `retry: ${error?.message ?? error}`,
      }]);
      notePet(sessionId, "paused");
    } finally {
      retryingQueuedInputsRef.current.delete(retryKey);
    }
  }, [defaultApproval, hydrateLegacyTaskState, notePet, push, rememberSessionApproval, sendText]);

  /** Submit against the authoritative execution plane. New engines own start-or-steer routing in one
   * ordered call; this renderer-side branch remains only for compatibility with older bundled engines. */
  const submitSessionText = useCallback(
    async (sessionId: string, text: string): Promise<"sent" | "steered" | "queued"> => {
      const c = clientRef.current;
      if (!c) throw new Error("Hara engine is not connected");
      if (
        modelInfoScope === sessionId
        && modelInfo?.currentAvailable === false
        && !stagedModelChangesRef.current[sessionId]
      ) {
        throw new Error(locale === "zh"
          ? `当前会话模型 ${modelInfo.current} 已不在此连接的授权目录中，请先切换模型。`
          : `The current model ${modelInfo.current} is no longer authorized for this connection. Choose another model before sending.`);
      }
      const wireText = textWithActiveWorkObject(sessionId, text);
      if (c.supports("session.submit")) {
        const submission = await sendText(sessionId, text, undefined, { wireText });
        if (submission === "steered") return "steered";
        if (submission === "queued" || submission === "failed") return "queued";
        return "sent";
      }
      const state = taskStatesRef.current[sessionId];
      const turnId = state?.taskStatus === "running"
        ? state.turnId
        : activeTurnsRef.current[sessionId];
      let live = busyRef.current[sessionId] || (
        state ? taskStateIsLive(state.state) : false
      );
      if (live && turnId && c.supports("session.steer")) {
        try {
          await c.steer(sessionId, wireText, turnId);
          push(sessionId, (items) => [...items, { kind: "user", text }]);
          notePet(sessionId, "running");
          return "steered";
        } catch (error: any) {
          if (error?.code !== SERVER_BUSY) throw error;
          // The turn may have ended and emitted its sole queue-drain event before this rejection arrived.
          // Re-read the synchronous execution refs: a finished turn must receive a fresh send now.
          const currentTurnId = activeTurnsRef.current[sessionId];
          const currentState = taskStatesRef.current[sessionId];
          live = !!currentTurnId || (currentState ? taskStateIsLive(currentState.state) : false);
          if (!live) {
            await sendText(sessionId, text, undefined, { wireText });
            return "sent";
          }
        }
      }
      if (live) {
        const pendingId = nextPendingInputId();
        push(sessionId, (items) => [...items, { kind: "user", text, pendingId }]);
        enqueueInput(sessionId, { id: pendingId, text, wireText, recorded: true });
        notePet(sessionId, "running");
        return "queued";
      }
      await sendText(sessionId, text, undefined, { wireText });
      return "sent";
    },
    [enqueueInput, locale, modelInfo, modelInfoScope, nextPendingInputId, notePet, push, sendText, textWithActiveWorkObject],
  );

  /** Recover only a native revision authored by this exact session/turn window. This is a typed
   * compatibility path for old engines or a lost notification; assistant prose and exported PPTX
   * paths are deliberately ignored because neither proves an editable Hara Presentation exists. */
  const recoverPresentationSurface = useCallback(async (
    sessionId: string,
    startedAt: number,
    baselineRevisionIds: ReadonlySet<string>,
  ): Promise<void> => {
    let client = clientRef.current;
    if (!client?.connected) return;
    try {
      if (!supportsNativePresentationWorkspace(client)) {
        const upgraded = await ensurePresentationWorkspaceRef.current();
        if (!upgraded) return;
        client = clientRef.current;
        if (!client?.connected || !supportsNativePresentationWorkspace(client)) return;
      }
      const recoveryClient = client;
      const listed = await recoveryClient.listArtifacts();
      if (!listed || clientRef.current !== recoveryClient) return;
      const candidates = listed.artifacts.filter((artifact) =>
        artifact.kind === "presentation"
        && artifact.extension === ".hpres"
        && artifact.mediaType === "application/vnd.nanhara.presentation+json"
        && !baselineRevisionIds.has(artifact.currentRevisionId)
      );
      const matches = (await Promise.all(candidates.map(async (artifact) => {
        try {
          const revisions = await recoveryClient.listArtifactRevisions(artifact.artifactId);
          const revision = nativePresentationRevisionFromTurn(
            artifact,
            revisions.revisions,
            sessionId,
            startedAt,
          );
          return revision ? { artifact, revision } : null;
        } catch {
          return null;
        }
      }))).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((left, right) => left.revision.createdAt.localeCompare(right.revision.createdAt));
      const latest = matches[matches.length - 1];
      if (!latest || clientRef.current !== recoveryClient) return;
      handleEventRef.current({
        method: "event.surface",
        sessionId,
        kind: "presentation",
        title: latest.artifact.title,
        resource: {
          type: "artifact",
          artifactId: latest.artifact.artifactId,
          revisionId: latest.revision.revisionId,
        },
      });
    } catch {
      // A later Office refresh remains available; never infer UI success after a failed recovery read.
    }
  }, []);

  const handleEvent = useCallback(
    (e: ServerEvent) => {
      switch (e.method) {
        case "event.turn_start":
          presentationSurfaceTurnsRef.current[e.sessionId] = {
            startedAt: presentationSurfaceTurnsRef.current[e.sessionId]?.startedAt ?? Date.now(),
            surfaceOffered: false,
            baselineRevisionIds: presentationSurfaceTurnsRef.current[e.sessionId]?.baselineRevisionIds ?? new Set(),
          };
          if (e.turnId) {
            activeTurnsRef.current[e.sessionId] = e.turnId;
            const dispatch = pendingSendDispatchesRef.current[e.sessionId];
            if (dispatch && !dispatch.turnId) dispatch.turnId = e.turnId;
          }
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          setSessionBusy(e.sessionId, true);
          break;
        case "event.task_state": {
          if (!taskLifecycleIsNewer(taskStatesRef.current[e.sessionId], e)) break;
          const nextTaskStates = { ...taskStatesRef.current, [e.sessionId]: e };
          taskStatesRef.current = nextTaskStates;
          setTaskStates(nextTaskStates);
          const live = taskStateIsLive(e.state);
          if (live) activeTurnsRef.current[e.sessionId] = e.turnId;
          else delete activeTurnsRef.current[e.sessionId];
          setSessionBusy(e.sessionId, live);
          if (!live) void flushStagedModelChange(e.sessionId);
          const title = taskStateTitle(e);
          if (e.phase === "restored" && e.state === "completed") {
            // A restored terminal snapshot hydrates state; it is not a new completion notification.
            // Clear any stale disconnect/blocked activity left by the previous transport.
            removePet(e.sessionId);
          } else if (e.state === "completed" && e.sessionId === activeRef.current && document.hasFocus()) {
            removePet(e.sessionId);
          } else {
            notePet(e.sessionId, taskStatePetStatus(e.state), title);
          }
          break;
        }
        case "event.workforce_state": {
          const bounded = boundedWorkforceState(e);
          if (!bounded || !workforceStateIsNewer(workforceStatesRef.current[e.sessionId], bounded)) break;
          const nextWorkforceStates = { ...workforceStatesRef.current, [e.sessionId]: bounded };
          workforceStatesRef.current = nextWorkforceStates;
          setWorkforceStates(nextWorkforceStates);
          break;
        }
        case "event.text":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => {
            const last = items[items.length - 1];
            if (last?.kind === "text") return [...items.slice(0, -1), { kind: "text", text: last.text + e.delta }];
            return [...items, { kind: "text", text: e.delta }];
          });
          break;
        case "event.reasoning":
          // Older Serve versions may still emit provider reasoning. Treat it only as liveness; private
          // reasoning must never enter renderer transcript state or a user-expandable execution log.
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          break;
        case "event.tool":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => [...items, { kind: "tool", name: e.name, preview: plain(e.preview) }]);
          break;
        case "event.notice":
          push(e.sessionId, (items) => [...items, { kind: "notice", text: plain(e.text) }]);
          break;
        case "event.diff":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => [...items, { kind: "diff", text: plain(e.text) }]);
          {
            const session = sessionsRef.current.find((candidate) => candidate.id === e.sessionId);
            const place = session ? sessionPlace(session) : null;
            if (session && (place === "chat" || place === "projects")) {
              const owner: SessionExtensionOwner = {
                place,
                sessionId: session.id,
                cwd: session.cwd,
              };
              const context: ExtensionContext = { place, sessionId: session.id };
              const visibleExtension = activeExtensionTabForContext(extensionDockStateRef.current, context);
              const foreground = activeRef.current === session.id
                && zoneRef.current === place
                && visibleExtension?.dirty !== true;
              const review: ReviewExtension = {
                type: "review",
                id: reviewTabId(session.id),
                title: locale === "zh" ? "代码检查" : "Review",
                surfaceKind: "review",
                owner,
                mode: "docked",
                diff: plain(e.text).slice(-300_000),
              };
              warmModule(Promise.all([loadExtensionDock(), loadWorkbenchToolSurface()]));
              offerExtensionTab(review, foreground);
            }
          }
          break;
        case "event.surface": {
          const surfaceTurn = presentationSurfaceTurnsRef.current[e.sessionId];
          if (surfaceTurn && e.kind === "presentation" && e.resource?.type === "artifact") {
            surfaceTurn.surfaceOffered = true;
          }
          const session = sessionsRef.current.find((candidate) => candidate.id === e.sessionId);
          const place = session ? sessionPlace(session) : null;
          if (!session || (place !== "chat" && place !== "projects")) break;
          const owner: SessionExtensionOwner = {
            place,
            sessionId: session.id,
            cwd: session.cwd,
          };
          const ownerContext: ExtensionContext = { place, sessionId: session.id };
          const ownerContextKey = extensionContextKey(ownerContext);
          const dockHidden = !!ownerContextKey && hiddenExtensionContextsRef.current.has(ownerContextKey);
          const visibleExtension = activeExtensionTabForContext(extensionDockStateRef.current, ownerContext);
          const sessionForeground = activeRef.current === session.id && zoneRef.current === place;
          const foreground = sessionForeground && !dockHidden && visibleExtension?.dirty !== true;
          if (e.resource?.type === "url") {
            if (e.kind !== "browser") break;
            const tab = webPreviewExtensionFor(e.resource.url, e.title, owner);
            if (!tab) {
              push(e.sessionId, (items) => [...items, {
                kind: "notice",
                text: locale === "zh"
                  ? "已拒绝不安全的网页预览地址；只允许带明确端口的 localhost HTTP 服务。"
                  : "Unsafe web preview rejected. Only localhost HTTP services with an explicit port are allowed.",
              }]);
              break;
            }
            warmModule(loadExtensionDock());
            offerExtensionTab(tab, foreground);
            if (foreground) setExtensionLoading(true);
            else if (sessionForeground) {
              push(e.sessionId, (items) => [...items, {
                kind: "notice",
                text: locale === "zh"
                  ? dockHidden
                    ? "网页预览已生成并加入右侧标签；扩展屏保持收起，显示后再加载。"
                    : "网页预览已加入右侧后台标签；请先保存或放弃当前演示文稿的更改，再打开加载。"
                  : dockHidden
                    ? "The web preview was added to a right-side tab. The Dock remains collapsed and will load it when shown."
                    : "The web preview was added to a background tab. Save or discard the current presentation changes before loading it.",
              }]);
            } else setUnread((current) => ({ ...current, [session.id]: true }));
            break;
          }
          if (
            e.resource?.type !== "artifact"
            || !isArtifactSurfaceKind(e.kind)
            || !safeSurfaceOpaqueId(e.resource.artifactId)
            || !safeSurfaceOpaqueId(e.resource.revisionId)
          ) break;
          const artifactResource = e.resource;
          const artifactOwner: ArtifactExtension["owner"] = {
            ...owner,
            artifactId: artifactResource.artifactId,
            revisionId: artifactResource.revisionId,
          };
          const offered: ArtifactExtension = {
            type: "artifact",
            id: artifactExtensionTabId(artifactResource.artifactId, artifactOwner),
            title: safeSurfaceTitle(e.title, locale === "zh" ? "交付物" : "Artifact"),
            surfaceKind: e.kind,
            owner: artifactOwner,
            mode: "docked",
          };
          if (visibleExtension?.dirty && visibleExtension.id === offered.id) {
            push(e.sessionId, (items) => [...items, {
              kind: "notice",
              text: locale === "zh"
                ? "这份演示文稿已有新的版本，但当前标签还有未保存更改。Hara 保留了你的草稿；保存时若版本冲突，请重新打开最新版后再应用更改。"
                : "A newer revision exists, but this tab has unsaved changes. Hara kept your draft; if save conflicts, reopen the latest revision and reapply the change.",
            }]);
            void refreshArtifacts();
            break;
          }
          warmModule(Promise.all([loadArtifactWorkbench(), loadPresentationWorkbench(), loadExtensionDock()]));
          offerExtensionTab(offered, foreground);
          void refreshArtifacts();
          if (!foreground) {
            if (sessionForeground) {
              push(e.sessionId, (items) => [...items, {
                kind: "notice",
                text: locale === "zh"
                  ? dockHidden
                    ? "演示文稿已创建并加入右侧标签；扩展屏保持收起，显示后再加载精确版本。"
                    : "演示文稿已创建并加入右侧后台标签；请先保存或放弃当前更改，再打开加载精确版本。"
                  : dockHidden
                    ? "The presentation was created and added to a right-side tab. The Dock remains collapsed and will load the exact revision when shown."
                    : "The presentation was created and added to a background tab. Save or discard the current changes before loading the exact revision.",
              }]);
            } else setUnread((current) => ({ ...current, [session.id]: true }));
            break;
          }
          const client = clientRef.current;
          if (!client) break;
          const requestId = ++artifactOpenRequestRef.current;
          setArtifactBusy("open");
          setErr("");
          if (e.kind === "presentation") {
            push(e.sessionId, (items) => [...items, {
              kind: "notice",
              text: locale === "zh"
                ? "演示文稿已创建，Desktop 正在加载本轮生成的精确版本…"
                : "Presentation created. Desktop is loading the exact revision from this turn…",
            }]);
          }
          void (async () => {
            try {
              const [revisionResult, list, presentationSurface, generic] = await Promise.all([
                client.listArtifactRevisions(artifactResource.artifactId),
                client.listArtifacts(),
                e.kind === "presentation"
                  ? loadPresentationSurface(
                      client,
                      artifactResource.artifactId,
                      artifactResource.revisionId,
                    )
                  : Promise.resolve(null),
                e.kind === "presentation"
                  ? Promise.resolve(null)
                  : client.getArtifact(artifactResource.artifactId),
              ]);
              const presentation = presentationSurface?.details ?? null;
              const resolved = presentation ?? generic;
              if (!resolved) throw new Error("visual surface unavailable");
              const preview = presentationSurface?.preview ?? null;
              if (
                requestId !== artifactOpenRequestRef.current
                || clientRef.current !== client
                || activeRef.current !== session.id
                || zoneRef.current !== place
              ) return;
              setArtifacts(list ?? "old-server");
              setActiveArtifact(resolved);
              setActivePresentation(presentation);
              setPresentationPreviewHtml(preview?.html ?? null);
              setArtifactRevisions(revisionResult.revisions);
              setArtifactValidationReport(null);
              setArtifactExportReceipt(null);
              offerExtensionTab(artifactExtensionFor(resolved, owner), true);
              if (presentation) {
                push(e.sessionId, (items) => [...items, {
                  kind: "notice",
                  text: presentationSurface?.recoveredLatest
                    ? makeT(locale)("presentationReloadedLatest")
                    : locale === "zh"
                      ? "Desktop 已加载精确版本，演示文稿现在已在右侧打开。"
                      : "Desktop loaded the exact revision. The presentation is now open on the right.",
                }]);
              }
            } catch (error: any) {
              if (requestId === artifactOpenRequestRef.current) {
                const message = makeT(locale)(presentationErrorKey(error));
                setErr(message);
                push(e.sessionId, (items) => [...items, {
                  kind: "notice",
                  text: e.kind === "presentation"
                    ? locale === "zh"
                      ? `演示文稿已创建，但右侧预览未能打开：${message}`
                      : `The presentation was created, but its right-side preview could not open: ${message}`
                    : locale === "zh"
                      ? `可视结果已创建，但右侧内容未能打开：${message}`
                      : `The visual result was created, but its right-side content could not open: ${message}`,
                }]);
              }
            } finally {
              if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
            }
          })();
          break;
        }
        case "event.turn_end": {
          const surfaceTurn = presentationSurfaceTurnsRef.current[e.sessionId];
          delete presentationSurfaceTurnsRef.current[e.sessionId];
          if (surfaceTurn && !surfaceTurn.surfaceOffered) {
            window.setTimeout(
              () => void recoverPresentationSurface(
                e.sessionId,
                surfaceTurn.startedAt,
                surfaceTurn.baselineRevisionIds,
              ),
              0,
            );
          }
          const dispatch = pendingSendDispatchesRef.current[e.sessionId];
          if (dispatch?.turnId && e.turnId === dispatch.turnId) {
            dispatch.completed = true;
            resolvePendingUser(e.sessionId, dispatch.pendingId, true);
          }
          delete activeTurnsRef.current[e.sessionId];
          push(e.sessionId, (items) => [
            ...items.map((item): ConversationItem =>
              item.kind === "approval" && !item.answered
                ? { ...item, answered: "expired" }
                : item,
            ),
            { kind: "end", usage: e.usage },
          ]);
          setSessionBusy(e.sessionId, false);
          // A completed agent turn may have created a Presentation through the built-in tool.
          // Refresh the local Office index so the deck appears without reconnecting.
          void refreshArtifacts();
          void flushStagedModelChange(e.sessionId);
          if (e.ctx) setCtxMap((m) => ({ ...m, [e.sessionId]: e.ctx! }));
          const interrupted = interruptedSessionsRef.current.has(e.sessionId);
          const failed = !!e.error || (!!e.status && e.status !== "completed");
          const typedTask = taskStatesRef.current[e.sessionId];
          const hasTerminalTaskState = Boolean(
            typedTask
            && e.turnId
            && typedTask.turnId === e.turnId
            && !taskStateIsLive(typedTask.state),
          );
          const taskFallback = terminalTaskLifecycleFallback(
            typedTask,
            e.turnId,
            interrupted ? "paused" : failed ? "blocked" : "completed",
            new Date().toISOString(),
          );
          if (taskFallback) {
            const nextTaskStates = { ...taskStatesRef.current, [e.sessionId]: taskFallback };
            taskStatesRef.current = nextTaskStates;
            setTaskStates(nextTaskStates);
          }
          if (interrupted) removePet(e.sessionId);
          else if (!hasTerminalTaskState && failed) notePet(e.sessionId, "blocked");
          else if (!hasTerminalTaskState && e.sessionId === activeRef.current && document.hasFocus()) removePet(e.sessionId);
          else if (!hasTerminalTaskState) notePet(e.sessionId, "ready");
          interruptedSessionsRef.current.delete(e.sessionId);
          // steer queue: auto-dispatch the next queued message for this session
          const pending = queueRef.current[e.sessionId];
          if (pending && pending.length > 0) {
            const [next, ...rest] = pending;
            // Hold the session locally across the short drain handoff. A composer submit that lands
            // in this window must queue behind `next`, never overtake it as a fresh session.send.
            setSessionBusy(e.sessionId, true);
            setQueue((queues) => {
              const updated = { ...queues, [e.sessionId]: rest };
              queueRef.current = updated;
              return updated;
            });
            setTimeout(
              () => void sendText(
                  e.sessionId,
                  next.text,
                  next.attachments,
                  {
                    recordUser: next.recorded !== true,
                    requeueFrontOnBusy: true,
                    pendingId: next.id,
                    wireText: next.wireText,
                  },
                )
                .catch((error) => {
                  enqueueInput(e.sessionId, next, "front");
                  setSessionBusy(e.sessionId, false);
                  notePet(e.sessionId, "paused");
                  push(e.sessionId, (items) => [...items, {
                    kind: "notice",
                    text: `retry: ${error instanceof Error ? error.message : String(error)}`,
                  }]);
                }),
              50,
            );
          }
          if (e.sessionId !== activeRef.current) {
            setUnread((u) => ({ ...u, [e.sessionId]: true }));
            const s = sessionsRef.current.find((x) => x.id === e.sessionId);
            if (s && !isAutomated(s)) {
              // Only a positively identified local/manual session gets a Desktop notification. A newly
              // arrived Feishu/WeChat/cron session may finish before session.list refreshes; treating that
              // unknown id as manual duplicates the channel app's own operating-system notification.
              void isPermissionGranted()
                .then((ok) => ok && sendNotification({ title: s.title || "hara", body: (e.reply || "").slice(0, 120) }))
                .catch(() => {});
            }
          }
          break;
        }
        case "approval.request":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "waiting");
          push(e.sessionId, (items) => [...items, {
            kind: "approval",
            approvalId: e.approvalId,
            question: plain(e.question),
            allowAlways: e.allowAlways === true,
          }]);
          if (e.sessionId !== activeRef.current) setUnread((u) => ({ ...u, [e.sessionId]: true }));
          break;
      }
    },
    [enqueueInput, flushStagedModelChange, locale, notePet, offerExtensionTab, push, recoverPresentationSurface, refreshArtifacts, removePet, resolvePendingUser, sendText, setSessionBusy],
  );
  handleEventRef.current = handleEvent;

  const connect = useCallback(async (expectedPid: number | null = null) => {
    const generation = ++connectGenerationRef.current;
    const stale = () => generation !== connectGenerationRef.current;
    const previous = clientRef.current;
    clientRef.current = null;
    pluginsRef.current = null;
    skillsRef.current = null;
    capabilityCatalogRequestRef.current += 1;
    capabilitySkillsCwdRef.current = undefined;
    setPlugins(null);
    setSkills(null);
    setProjPanels({});
    clearExtensionDock();
    attachedSessionsRef.current.clear();
    pendingSendDispatchesRef.current = {};
    presentationSurfaceTurnsRef.current = {};
    clearStagedModelChanges();
    previous?.close();
    artifactOpenRequestRef.current += 1;
    organizationRoutesRequestRef.current += 1;
    setOrganizationRoutes(null);
    providerRoutesRequestRef.current += 1;
    setProviderRoutes(null);
    groupsDirectoryRequestRef.current += 1;
    groupsRequestGenerationRef.current += 1;
    groupsActivationRequestRef.current += 1;
    dispatchGroups({ type: "reset" });
    setGroupsDirectory({ phase: "idle" });
    setGroupsSwitchingProfileId("");
    setActiveArtifact(null);
    setActivePresentation(null);
    setPresentationPreviewHtml(null);
    setArtifactRevisions([]);
    setArtifactValidationReport(null);
    setArtifactExportReceipt(null);
    setPhase("connecting");
    setErr("");
    let c: HaraClient | null = null;
    try {
      const raw = await invoke<string | null>("read_discovery");
      if (stale()) return;
      if (!raw) {
        setPhase("no-server");
        return;
      }
      const d: Discovery = JSON.parse(raw);
      // A start request may race a stale discovery file left by an earlier Windows process. Only
      // the child we just spawned is allowed to satisfy that startup handshake.
      if (expectedPid !== null && d.pid !== expectedPid) {
        setPhase("no-server");
        return;
      }
      c = new HaraClient();
      c.onEvent = handleEvent;
      c.onClose = () => {
        if (clientRef.current !== c) return;
        clientRef.current = null;
        if (plannedUpdateRestartRef.current) return;
        pluginsRef.current = null;
        skillsRef.current = null;
        capabilityCatalogRequestRef.current += 1;
        capabilitySkillsCwdRef.current = undefined;
        setPlugins(null);
        setSkills(null);
        setProjPanels({});
        clearExtensionDock();
        for (const [sessionId, running] of Object.entries(busyRef.current)) {
          if (running) notePet(sessionId, "blocked", "Hara engine disconnected");
        }
        activeTurnsRef.current = {};
        presentationSurfaceTurnsRef.current = {};
        attachedSessionsRef.current.clear();
        pendingSendDispatchesRef.current = {};
        clearStagedModelChanges();
        taskStatesRef.current = {};
        workforceStatesRef.current = {};
        organizationRoutesRequestRef.current += 1;
        setOrganizationRoutes(null);
        providerRoutesRequestRef.current += 1;
        setProviderRoutes(null);
        groupsDirectoryRequestRef.current += 1;
        groupsRequestGenerationRef.current += 1;
        groupsActivationRequestRef.current += 1;
        dispatchGroups({ type: "reset" });
        setGroupsDirectory({ phase: "idle" });
        setGroupsSwitchingProfileId("");
        setTaskStates({});
        setWorkforceStates({});
        busyRef.current = {};
        setBusy({});
        setPhase("lost");
      };
      await c.connect(d.host, d.port);
      const info = await c.initialize(d.token);
      const list = await c.listSessions();
      if (stale()) {
        c.close();
        return;
      }
      clientRef.current = c;
      setServer({ pid: d.pid, version: info.version, provider: info.provider, model: info.model, cwd: info.cwd });
      sessionsRef.current = list.sessions;
      setSessions(list.sessions);
      // Plugin panels may contribute default-hidden module-dock entries. This is a local inventory read;
      // panel execution remains project-bound and requires a later authoritative Serve lookup.
      void c.listPlugins().then((result) => {
        if (!stale() && clientRef.current === c) {
          pluginsRef.current = result.plugins;
          setPlugins(result.plugins);
        }
      }).catch(() => {});
      const needsCredentials = info.setupState === "needs-credentials";
      setSetupRequired(needsCredentials);
      if (needsCredentials) {
        zoneRef.current = "settings";
        sessionOpenRequestRef.current += 1;
        setZoneRaw("settings");
        setSetSec("providers");
      }
      // Cold start uses the latest persisted navigation contract. A brand-new
      // profile still resolves to Chat, while a saved core module or Settings
      // destination remains respected.
      const manual = list.sessions.filter((s) => !isAutomated(s) && !isAssistantCwd(s.cwd));
      if (info.setupState !== "needs-credentials" && manual.length === 0 && openedProjects.length === 0) {
        const preferredPlace = initialAppPlace(
          localStorage.getItem("hara.zone"),
          parseNavigationPreferences(
            localStorage.getItem(NAVIGATION_PREFERENCES_KEY),
          ),
        );
        zoneRef.current = preferredPlace;
        sessionOpenRequestRef.current += 1;
        setZoneRaw(preferredPlace);
      }
      void refreshAuto();
      void c.listArtifacts().then((a) => setArtifacts(a ?? "old-server")).catch(() => {});
      void refreshModelInfo().catch(() => {});
      void refreshOrganizationRoutes().catch(() => {});
      void refreshProviderRoutes().catch(() => {});
      setPhase("ready");
    } catch (e: any) {
      c?.close();
      if (stale()) return;
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearExtensionDock, clearStagedModelChanges, handleEvent, refreshAuto, refreshModelInfo, refreshOrganizationRoutes, refreshProviderRoutes]);

  useEffect(() => {
    if (phase !== "ready" || !active) return;
    void refreshModelInfo({ sessionId: active }).catch(() => {});
    const current = sessionsRef.current.find((session) => session.id === active);
    void refreshOrganizationRoutes(current?.cwd).catch(() => {});
    void refreshProviderRoutes(current?.cwd).catch(() => {});
    return () => {
      modelInfoRequestRef.current += 1;
      organizationRoutesRequestRef.current += 1;
      providerRoutesRequestRef.current += 1;
    };
  }, [active, phase, refreshModelInfo, refreshOrganizationRoutes, refreshProviderRoutes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "1") (e.preventDefault(), apiRef.current.setZone("chat"));
      else if (e.key === "2") (e.preventDefault(), apiRef.current.setZone("projects"));
      else if (e.key === "3") (e.preventDefault(), apiRef.current.setZone("auto"));
      else if (e.key === "4") (e.preventDefault(), apiRef.current.setZone("groups"));
      else if (e.key === "5") (e.preventDefault(), apiRef.current.setZone("office"));
      else if (e.key === ",") (e.preventDefault(), apiRef.current.setZone("settings"));
      else if (e.key === "n") (e.preventDefault(), apiRef.current.openProject());
      else if (e.key === "f") {
        e.preventDefault();
        (document.getElementById("haraSearch") as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // pending empty-state card action fires once we're connected
  useEffect(() => {
    if (phase !== "ready" || setupRequired || !pendingRef.current) return;
    const act = pendingRef.current;
    pendingRef.current = null;
    if (act === "assistant") void apiRef.current.openAssistant();
    else void apiRef.current.openProject();
  }, [phase, setupRequired]);

  // project panels for the active project (cached per cwd; empty array caches the miss)
  const activeCwd = sessions.find((s) => s.id === active)?.cwd;
  useEffect(() => {
    const c = clientRef.current;
    if (!c || zone !== "projects" || !active || !activeCwd || projPanels[activeCwd] !== undefined) return;
    void c
      .projectPanels({ sessionId: active })
      .then((r) => setProjPanels((m) => ({ ...m, [activeCwd]: r?.panels ?? [] })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, active, activeCwd]);

  // Check at launch without using a duplicate OS notification. A new version gets one in-app guide;
  // choosing "Later" snoozes that exact version for 24 hours while the settings badge stays available.
  useEffect(() => {
    void getVersion().then(setDesktopVersion).catch(() => {});
    void invoke<DesktopUpdateStorageStatus>("inspect_desktop_update_storage")
      .then(setUpdateStorage)
      .catch(() => {});
    void invoke<CommandLineHaraStatus>("synchronize_command_line_hara")
      .then(setCommandLineHara)
      .catch((error: any) => {
        setCommandLineTone("error");
        setCommandLineNotice(String(error?.message ?? error).slice(0, 220));
        void invoke<CommandLineHaraStatus>("inspect_command_line_hara")
          .then(setCommandLineHara)
          .catch(() => {});
      });
    void checkDesktopUpdate()
      .then((u) => {
        if (!u) return;
        setUpdAvail(u.version);
        if (!desktopUpdateIsSnoozed(u.version)) setUpdateNoticeVisible(true);
        void u.close().catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, active]);

  // ambient automation counter: automated sessions updated since last seen marker
  useEffect(() => {
    if (!auto || auto === "old-server") return;
    const seen = localStorage.getItem("hara.autoSeen") ?? "";
    setAutoUnread(auto.sessions.filter((s) => s.updatedAt > seen).length);
  }, [auto]);
  const markAutoSeen = () => {
    localStorage.setItem("hara.autoSeen", new Date().toISOString());
    setAutoUnread(0);
  };

  const startServer = async () => {
    setErr("");
    try {
      const pid = await invoke<number>("start_serve");
      setPhase("connecting");
      let up = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const raw = await invoke<string | null>("read_discovery");
        if (raw) {
          try {
            const discovery: Discovery = JSON.parse(raw);
            if (discovery.pid === pid) {
              up = true;
              break;
            }
          } catch {
            // Serve writes discovery atomically, but tolerate a malformed/stale local file while
            // the new child is still starting and keep polling for its authenticated endpoint.
          }
        }
      }
      if (!up) {
        const log = await invoke<string>("read_serve_log").catch(() => "");
        // Old serves exited before exposing the secure provider-settings RPC. Do not fall back to a
        // second config writer in Rust; the user explicitly gets an upgrade path instead.
        if (/not authenticated/i.test(log)) {
          setErr("This Hara Desktop includes an engine that is too old for model settings. Update Hara Desktop and restart it.");
          setPhase("no-server");
          return;
        }
        setErr(log ? `hara serve did not come up. Log tail:\n${log}` : "hara serve did not come up (no log)");
        setPhase("no-server");
        return;
      }
      await connect(pid);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
  };

  useEffect(() => {
    // React StrictMode runs effects twice in development. Consume the native one-shot marker and
    // choose the launch path once per renderer lifetime: ordinary launches only discover; an
    // updater relaunch starts the newly bundled sidecar before reconnecting.
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    void invoke<boolean>("take_update_restart_marker")
      .then((updateRestart) => (updateRestart ? startServer() : connect()))
      .catch(() => connect());
    // `startServer` intentionally participates only in this one-shot bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  useEffect(
    () => () => {
      connectGenerationRef.current += 1;
      const client = clientRef.current;
      clientRef.current = null;
      client?.close();
    },
    [],
  );

  const refreshSessions = async () => {
    const c = clientRef.current;
    if (!c) return;
    const list = await c.listSessions();
    // Keep imperative routing in sync before React commits the state update. Fork → refresh → setZone
    // happens in one async continuation and must be able to select the newly returned session.
    sessionsRef.current = list.sessions;
    setSessions(list.sessions);
  };

  const newSession = async (cwd?: string): Promise<string | null> => {
    const c = clientRef.current;
    if (!c) return null;
    if (!discardCurrentExtensionDraft()) return null;
    artifactOpenRequestRef.current += 1;
    setArtifactBusy("");
    setActiveArtifact(null);
    setActivePresentation(null);
    setPresentationPreviewHtml(null);
    setArtifactRevisions([]);
    setArtifactValidationReport(null);
    setArtifactExportReceipt(null);
    const sessionHint = { cwd: cwd ?? server?.cwd ?? "", source: "interactive" };
    const requestId = ++sessionOpenRequestRef.current;
    const r = await c.createSession({ ...(cwd ? { cwd } : {}), ...(defaultApproval ? { approval: defaultApproval } : {}) });
    attachedSessionsRef.current.add(r.sessionId);
    rememberSession(r.sessionId, sessionHint);
    if (sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, sessionHint)) {
      setActive(r.sessionId);
    }
    setTranscripts((tr) => ({ ...tr, [r.sessionId]: [] }));
    await refreshSessions();
    return r.sessionId;
  };

  const startOrganizationSession = async (
    connection: OrganizationConnection,
    model: string,
  ): Promise<void> => {
    const client = clientRef.current;
    const sourceSessionId = active;
    const sourceSession = sourceSessionId
      ? sessionsRef.current.find((candidate) => candidate.id === sourceSessionId)
      : undefined;
    if (!client || !sourceSessionId || !sourceSession) return;
    if (!client.supportsFeature(CROSS_PROFILE_FORK_FEATURE)) {
      setErr(locale === "zh"
        ? "当前 Hara 引擎不支持携带上下文切换连接，请先更新 Hara Desktop。"
        : "Update Hara Desktop before continuing a conversation on another connection.");
      return;
    }
    if (busyRef.current[sourceSessionId]) {
      push(sourceSessionId, (items) => [...items, {
        kind: "notice",
        text: locale === "zh"
          ? "当前任务仍在运行；请等待结束后再从其他连接新建对话。"
          : "The current task is still running. Wait for it to finish before starting on another connection.",
      }]);
      return;
    }
    const allowedModels = connection.availableModels?.length
      ? connection.availableModels
      : connection.model ? [connection.model] : [];
    if (!allowedModels.includes(model)) {
      setErr(locale === "zh"
        ? `企业连接“${connection.label}”没有授权模型 ${model}。请刷新连接后重试。`
        : `Organization connection “${connection.label}” does not authorize ${model}. Refresh the connection and try again.`);
      return;
    }
    const sourceDraft = composerDrafts[sourceSessionId] ?? emptyComposerDraft();
    const hasDraft = !!sourceDraft.text.trim() || sourceDraft.attachments.length > 0;
    const confirmed = window.confirm(locale === "zh"
      ? [
          `要使用“${connection.label} · ${model}”复制当前对话并继续吗？`,
          "当前对话内容、任务状态和附件引用会复制到新对话。",
          "只有你下一次发送时才会作为上下文交给该企业连接。",
          "原对话仍留在原连接且不会被修改。",
          hasDraft
            ? "当前未发送的文字和附件也会移动到新对话，但不会自动发送。"
            : "新对话会绑定该企业连接，但不会自动发送任何内容。",
        ].join("\n\n")
      : [
          `Copy this conversation and continue with “${connection.label} · ${model}”?`,
          "Conversation content, task state, and attachment references will be copied into a new conversation.",
          "The copied context reaches that organization connection only after your next Send.",
          "The original conversation stays on its original connection and is not changed.",
          hasDraft
            ? "Your unsent text and attachments also move to the new draft, but are not sent automatically."
            : "The new conversation is pinned to that organization connection and sends nothing automatically.",
        ].join("\n\n"));
    if (!confirmed) return;
    if (!discardCurrentExtensionDraft()) return;

    setModelPickerOpen(false);
    setModelSearch("");
    setErr("");
    try {
      const nextRoutes = await client.useOrganizationConnection(connection.id, sourceSession.cwd);
      setOrganizationRoutes(nextRoutes);
      const route = await client.listProviderSettings(sourceSession.cwd);
      if (route) {
        setProviderRoutes(route);
        setSetupRequired(!route.current.authenticated);
        setServer((current) => current
          ? { ...current, provider: route.current.provider, model: route.current.model }
          : current);
      }
      const forked = await client.forkSession(sourceSessionId, {
        targetProfileId: connection.id,
        targetModel: model,
        transferHistory: true,
      });
      const nextSessionId = forked.sessionId;
      attachedSessionsRef.current.add(nextSessionId);
      setSessionReadOnly(nextSessionId, null);
      setTranscripts((current) => {
        const next = {
          ...current,
          [nextSessionId]: conversationItemsFromHistory(forked.history),
        };
        transcriptsRef.current = next;
        return next;
      });
      rememberSession(nextSessionId, { cwd: sourceSession.cwd, source: "interactive" });
      setComposerDrafts((current) => {
        const draftToMove = current[sourceSessionId] ?? sourceDraft;
        const next = { ...current, [nextSessionId]: draftToMove };
        delete next[sourceSessionId];
        return next;
      });
      await refreshSessions();
      setActive(nextSessionId);
      await refreshModelInfo({ sessionId: nextSessionId });
      void refreshOrganizationRoutes(sourceSession.cwd).catch(() => {});
      void refreshProviderRoutes(sourceSession.cwd).catch(() => {});
      void refreshGroupsDirectory();
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error);
      setErr(locale === "zh"
        ? `无法复制当前对话到企业连接：${detail}`
        : `Could not copy this conversation to the organization connection: ${detail}`);
    }
  };

  const startPersonalConnectionSession = async (connection: ProviderConnection): Promise<void> => {
    const client = clientRef.current;
    const sourceSessionId = active;
    const sourceSession = sourceSessionId
      ? sessionsRef.current.find((candidate) => candidate.id === sourceSessionId)
      : undefined;
    if (!client || !sourceSessionId || !sourceSession) return;
    if (!client.supportsFeature(CROSS_PROFILE_FORK_FEATURE)) {
      setErr(locale === "zh"
        ? "当前 Hara 引擎不支持携带上下文切换连接，请先更新 Hara Desktop。"
        : "Update Hara Desktop before continuing a conversation on another connection.");
      return;
    }
    if (busyRef.current[sourceSessionId]) {
      push(sourceSessionId, (items) => [...items, {
        kind: "notice",
        text: locale === "zh"
          ? "当前任务仍在运行；请等待结束后再从其他连接新建对话。"
          : "The current task is still running. Wait for it to finish before starting on another connection.",
      }]);
      return;
    }
    if (providerRoutes?.switchLocked || providerRoutes?.current.environmentOverride) {
      setErr(locale === "zh"
        ? "当前项目或启动配置固定了模型连接；请先在“模型与连接”中解除固定。"
        : "This project or launch configuration pins the model connection. Remove the pin in Models & connections first.");
      return;
    }
    if (!connection.authenticated) {
      setErr(locale === "zh"
        ? `个人连接“${connection.label}”尚未通过认证，请先到“模型与连接”检查。`
        : `Personal connection “${connection.label}” is not authenticated. Check it in Models & connections first.`);
      return;
    }
    const sourceDraft = composerDrafts[sourceSessionId] ?? emptyComposerDraft();
    const hasDraft = !!sourceDraft.text.trim() || sourceDraft.attachments.length > 0;
    const confirmed = window.confirm(locale === "zh"
      ? [
          `要使用“${connection.label} · ${connection.model}”复制当前对话并继续吗？`,
          "当前对话内容、任务状态和附件引用会复制到新的个人对话。",
          "只有你下一次发送时才会作为上下文交给这条个人连接。",
          "原对话仍留在原连接且不会被修改。",
          hasDraft
            ? "当前未发送的文字和附件也会移动到新对话，但不会自动发送。"
            : "新对话会绑定这条个人连接，但不会自动发送任何内容。",
        ].join("\n\n")
      : [
          `Copy this conversation and continue with “${connection.label} · ${connection.model}”?`,
          "Conversation content, task state, and attachment references will be copied into a new personal conversation.",
          "The copied context reaches that personal connection only after your next Send.",
          "The original conversation stays on its original connection and is not changed.",
          hasDraft
            ? "Your unsent text and attachments also move to the new draft, but are not sent automatically."
            : "The new conversation is pinned to that personal connection and sends nothing automatically.",
        ].join("\n\n"));
    if (!confirmed) return;
    if (!discardCurrentExtensionDraft()) return;

    setModelPickerOpen(false);
    setModelSearch("");
    setErr("");
    try {
      const nextRoute = await client.useProviderConnection(connection.id, sourceSession.cwd);
      setProviderRoutes(nextRoute);
      setSetupRequired(!nextRoute.current.authenticated);
      setServer((current) => current
        ? { ...current, provider: nextRoute.current.provider, model: nextRoute.current.model }
        : current);
      setOrganizationRoutes((current) => current
        ? {
            ...current,
            activeId: connection.id,
            connections: current.connections.map((candidate) => ({ ...candidate, active: false })),
          }
        : current);
      const forked = await client.forkSession(sourceSessionId, {
        targetProfileId: connection.id,
        targetModel: connection.model,
        transferHistory: true,
      });
      const nextSessionId = forked.sessionId;
      attachedSessionsRef.current.add(nextSessionId);
      setSessionReadOnly(nextSessionId, null);
      setTranscripts((current) => {
        const next = {
          ...current,
          [nextSessionId]: conversationItemsFromHistory(forked.history),
        };
        transcriptsRef.current = next;
        return next;
      });
      rememberSession(nextSessionId, { cwd: sourceSession.cwd, source: "interactive" });
      setComposerDrafts((current) => {
        const draftToMove = current[sourceSessionId] ?? sourceDraft;
        const next = { ...current, [nextSessionId]: draftToMove };
        delete next[sourceSessionId];
        return next;
      });
      await refreshSessions();
      setActive(nextSessionId);
      await refreshModelInfo({ sessionId: nextSessionId });
      void refreshProviderRoutes(sourceSession.cwd).catch(() => {});
      void refreshOrganizationRoutes(sourceSession.cwd).catch(() => {});
      void refreshGroupsDirectory();
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error);
      setErr(locale === "zh"
        ? `无法复制当前对话到个人连接：${detail}`
        : `Could not copy this conversation to the personal connection: ${detail}`);
    }
  };

  const openSession = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    if (id !== activeRef.current && !discardCurrentExtensionDraft()) return;
    artifactOpenRequestRef.current += 1;
    setArtifactBusy("");
    setActiveArtifact(null);
    setActivePresentation(null);
    setPresentationPreviewHtml(null);
    setArtifactRevisions([]);
    setArtifactValidationReport(null);
    setArtifactExportReceipt(null);
    const session = sessionsRef.current.find((candidate) => candidate.id === id);
    const expected = session ?? {
      cwd: zoneRef.current === "chat" && home ? `${home}/.hara/workspace` : server?.cwd ?? "",
      source: "interactive",
    };
    const requestId = ++sessionOpenRequestRef.current;
    const mayActivate = () =>
      sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, expected);
    setUnread((u) => ({ ...u, [id]: false }));
    acknowledgePet(id);
    if (transcriptsRef.current[id] && attachedSessionsRef.current.has(id)) {
      if (mayActivate()) activateSession(id, expected);
      return;
    }
    try {
      const r = await c.resumeSession(id, defaultApproval || undefined);
      attachedSessionsRef.current.add(id);
      rememberSessionApproval(id, r.approval);
      setSessionReadOnly(id, null);
      setErr("");
      hydrateLegacyTaskState(c, id, r.task);
      setTranscripts((tr) => {
        const next = { ...tr, [id]: conversationItemsFromHistory(r.history) };
        transcriptsRef.current = next;
        return next;
      });
      if (mayActivate()) {
        activateSession(id, expected);
        acknowledgePet(id);
      }
    } catch (resumeError: any) {
      const reason = String(resumeError?.message ?? resumeError);
      if (
        !c.supports("session.history")
        && !c.supportsFeature(READONLY_HISTORY_FEATURE)
      ) {
        setErr(reason);
        return;
      }
      try {
        const replay = await c.readSession(id);
        attachedSessionsRef.current.delete(id);
        setSessionReadOnly(id, { reason });
        setErr("");
        setTranscripts((tr) => {
          const next = { ...tr, [id]: conversationItemsFromHistory(replay.history) };
          transcriptsRef.current = next;
          return next;
        });
        if (mayActivate()) {
          activateSession(id, expected);
          acknowledgePet(id);
        }
      } catch (historyError: any) {
        setErr(`${reason}\n${String(historyError?.message ?? historyError)}`);
      }
    }
  };

  /** Open an automated run as a READ-ONLY replay in the automation place. */
  const openReplay = useCallback(async (session: {
    id: string;
    title: string;
    sourceName?: string;
    cwd: string;
  }) => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const result = await c.resumeSession(session.id);
      attachedSessionsRef.current.add(session.id);
      setAutoReplay({
        id: session.id,
        title: session.title,
        sourceName: session.sourceName,
        cwd: session.cwd,
        items: result.history.map((message) => ({
          ...message,
          text: message.role === "user"
            ? displayHistoryText(message.text)
            : message.text,
        })),
      });
    } catch (error: any) {
      setErr(String(error?.message ?? error));
    }
  }, []);
  const addAutomationDraft = useCallback(async (draft: AutomationDraft): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    const input = automationDraftInput(draft, home ? `${home}/.hara/workspace` : undefined);
    await client.validateAutomationSchedule(input.schedule, input.tz);
    await client.addAutomationDraft(input);
    await refreshAuto();
  }, [home, locale, refreshAuto]);
  const updateAutomationDraft = useCallback(async (jobId: string, draft: AutomationDraft): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    const input = automationDraftInput(draft, home ? `${home}/.hara/workspace` : undefined);
    await client.validateAutomationSchedule(input.schedule, input.tz, jobId);
    await client.updateAutomation(jobId, input);
    await refreshAuto();
  }, [home, locale, refreshAuto]);
  const runAutomationNow = useCallback(async (jobId: string): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    await client.runAutomation(jobId);
    await refreshAuto();
  }, [locale, refreshAuto]);
  const toggleAutomation = useCallback(async (jobId: string, enabled: boolean): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    await client.toggleAutomation(jobId, enabled);
    await refreshAuto();
  }, [locale, refreshAuto]);
  const deleteAutomation = useCallback(async (jobId: string): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    await client.deleteAutomation(jobId);
    await refreshAuto();
  }, [locale, refreshAuto]);
  const installAutomationScheduler = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "Hara engine is not connected.");
    await client.installAutomationScheduler();
    await refreshAuto();
  }, [locale, refreshAuto]);
  const openAutomationReplay = useCallback(async (run: AutomationRun): Promise<void> => {
    if (!auto || auto === "old-server") return;
    const session = auto.sessions.find((candidate) => candidate.id === run.id);
    if (session) await openReplay(session);
  }, [auto, openReplay]);

  openPetSessionRef.current = async (sessionId: string) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
    if (session) {
      const place = sessionPlace(session);
      if (place === "auto") {
        if (!setZone("auto")) return;
        acknowledgePet(sessionId);
        await openReplay(session);
        return;
      }
      if (!setZone(place)) return;
    }
    await openSession(sessionId);
  };

  const rememberProject = (dir: string, remove = false) => {
    setProjectListState((current) => {
      const next = setProjectVisible(current, dir, !remove);
      localStorage.setItem(OPENED_PROJECTS_STORAGE_KEY, JSON.stringify(next.opened));
      localStorage.setItem(HIDDEN_PROJECTS_STORAGE_KEY, JSON.stringify(next.hidden));
      return next;
    });
  };

  const removeProjectFromList = (dir: string) => {
    if (!window.confirm([
      `${t("removeProjectConfirm")} “${basename(dir)}”?`,
      "",
      t("removeProjectKeepsData"),
      t("removeProjectRestore"),
    ].join("\n"))) return;

    const current = sessionsRef.current.find((session) => session.id === activeRef.current);
    if (zoneRef.current === "projects" && current?.cwd === dir && !setZone("chat")) return;

    const rememberedProjectId = activeByZoneRef.current.projects;
    if (rememberedProjectId && sessionsRef.current.find((session) => (
      session.id === rememberedProjectId && session.cwd === dir
    ))) activeByZoneRef.current.projects = null;
    rememberProject(dir, true);
  };

  const openProject = async () => {
    const dir = await openDialog({ directory: true, title: t("openProject") });
    if (typeof dir !== "string" || !dir) return;
    if (!setZone("projects")) return;
    const sessionId = await newSession(dir);
    if (sessionId) rememberProject(dir);
  };

  const importArtifactFile = async (kind?: ArtifactKind) => {
    const client = clientRef.current;
    if (!client) return;
    if (!client.supports("artifact.import") && !client.supports("presentation.import")) {
      setArtifacts("old-server");
      setErr(t("artifactNeedsUpdate"));
      return;
    }
    const extensions: Record<ArtifactKind, string[]> = {
      presentation: ["hpres", "json", "md", "markdown", "pptx", "ppt", "odp"],
      spreadsheet: ["xlsx", "xls", "csv", "ods"],
      document: ["docx", "doc", "odt", "rtf", "md", "txt"],
    };
    const selected = await openDialog({
      title: t("importFile"),
      multiple: false,
      filters: [{
        name: kind === "presentation"
          ? t("artifactTypePresentation")
          : kind === "spreadsheet"
            ? t("artifactTypeSpreadsheet")
            : kind === "document"
              ? t("artifactTypeDocument")
              : t("deliverables"),
        extensions: kind ? extensions[kind] : Object.values(extensions).flat(),
      }],
    });
    if (typeof selected !== "string" || !selected) return;
    const requestId = ++artifactOpenRequestRef.current;
    let nativePresentationImport = false;
    setArtifactBusy("import");
    setErr("");
    try {
      const extension = fileExtension(selected);
      nativePresentationImport = (
        kind === "presentation" && NATIVE_PRESENTATION_IMPORT_EXTENSIONS.has(extension)
      ) || (
        kind === undefined
        && extension !== ".md"
        && NATIVE_PRESENTATION_IMPORT_EXTENSIONS.has(extension)
      );
      if (nativePresentationImport && !client.supports("presentation.import")) {
        throw new Error(t("artifactNeedsUpdate"));
      }
      const imported = nativePresentationImport
        ? await client.importPresentation(selected)
        : await client.importArtifact(selected, kind ? { kind } : undefined);
      const [revisionResult, list, presentationSurface] = await Promise.all([
        client.listArtifactRevisions(imported.artifact.artifactId),
        client.listArtifacts(),
        nativePresentationImport
          ? loadPresentationSurface(
              client,
              imported.artifact.artifactId,
              imported.currentRevision.revisionId,
            )
          : Promise.resolve(null),
      ]);
      const presentation = presentationSurface?.details ?? null;
      const preview = presentationSurface?.preview ?? null;
      const verified = presentation ?? await client.getArtifact(imported.artifact.artifactId);
      if (requestId !== artifactOpenRequestRef.current) return;
      setArtifacts(list ?? "old-server");
      setActiveArtifact(verified);
      setActivePresentation(presentation);
      setPresentationPreviewHtml(preview?.html ?? null);
      setArtifactRevisions(revisionResult.revisions);
      setArtifactValidationReport(null);
      setArtifactExportReceipt(null);
      setActive(null);
      setAutoReplay(null);
      setZone("office");
      setExtensionDock(artifactExtensionFor(verified));
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(nativePresentationImport
          ? makeT(locale)(presentationErrorKey(error))
          : makeT(locale)("artifactImportFailed"));
      }
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };

  const openArtifact = async (artifactId: string) => {
    const client = clientRef.current;
    if (!client) return;
    const requestId = ++artifactOpenRequestRef.current;
    let nativePresentationOpen = false;
    setArtifactBusy("open");
    setErr("");
    try {
      const [details, revisionResult] = await Promise.all([
        client.getArtifact(artifactId),
        client.listArtifactRevisions(artifactId),
      ]);
      if (requestId !== artifactOpenRequestRef.current) return;
      let presentation: PresentationArtifactDetails | null = null;
      let previewHtml: string | null = null;
      if (isNativePresentation(details)) {
        nativePresentationOpen = true;
        if (!client.supports("presentation.get") || !client.supports("presentation.preview")) {
          throw new Error(t("artifactNeedsUpdate"));
        }
        const loaded = await loadPresentationSurface(
          client,
          artifactId,
          details.currentRevision.revisionId,
        );
        if (requestId !== artifactOpenRequestRef.current) return;
        presentation = loaded.details;
        previewHtml = loaded.preview.html;
      }
      setActiveArtifact(presentation ?? details);
      setActivePresentation(presentation);
      setPresentationPreviewHtml(previewHtml);
      setArtifactRevisions(revisionResult.revisions);
      setArtifactValidationReport(null);
      setArtifactExportReceipt(null);
      setActive(null);
      setAutoReplay(null);
      setExtensionDock(artifactExtensionFor(presentation ?? details));
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(makeT(locale)(nativePresentationOpen
          ? presentationErrorKey(error)
          : "artifactOpenFailed"));
      }
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };

  const verifyActiveArtifact = async () => {
    const client = clientRef.current;
    const details = activeArtifact;
    if (!client || !details) return;
    const nativePresentation = activePresentation?.artifact.artifactId === details.artifact.artifactId
      ? activePresentation
      : null;
    const validationMethod = nativePresentation ? "presentation.validate" : "artifact.validate";
    if (!client.supports(validationMethod)) {
      setErr(t("artifactNeedsUpdate"));
      return;
    }
    const artifactId = details.artifact.artifactId;
    const revisionId = details.currentRevision.revisionId;
    const requestId = ++artifactOpenRequestRef.current;
    setArtifactBusy("verify");
    setErr("");
    try {
      const { report } = nativePresentation
        ? await client.validatePresentation(artifactId, revisionId)
        : await client.validateArtifact(artifactId, revisionId);
      if (requestId === artifactOpenRequestRef.current) {
        setArtifactValidationReport(report);
      }
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(nativePresentation
          ? makeT(locale)(presentationErrorKey(error, "presentationVerifyFailed"))
          : t("artifactOpenFailed"));
      }
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };

  const exportActiveArtifact = async (presentationFormat?: PresentationExportFormat) => {
    const client = clientRef.current;
    const details = activeArtifact;
    if (!client || !details) return;
    const nativePresentation = activePresentation?.artifact.artifactId === details.artifact.artifactId
      ? activePresentation
      : null;
    const validationMethod = nativePresentation ? "presentation.validate" : "artifact.validate";
    const exportMethod = nativePresentation ? "presentation.export" : "artifact.export";
    if (!client.supports(validationMethod) || !client.supports(exportMethod)) {
      setErr(t("artifactNeedsUpdate"));
      return;
    }
    const artifactId = details.artifact.artifactId;
    const revisionId = details.currentRevision.revisionId;
    const requestId = ++artifactOpenRequestRef.current;
    setArtifactBusy("export");
    setErr("");
    try {
      let report = artifactValidationReport;
      if (report?.revisionId !== revisionId || report.snapshotDigest !== details.content.sha256 || report.status !== "pass") {
        const result = nativePresentation
          ? await client.validatePresentation(artifactId, revisionId)
          : await client.validateArtifact(artifactId, revisionId);
        report = result.report;
        if (requestId !== artifactOpenRequestRef.current) return;
        setArtifactValidationReport(report);
      }
      // Advisory authoring findings still permit a receipt-backed JSON source copy. Delivery formats
      // remain fail-closed so an unfinished deck cannot be mistaken for an accepted PDF/HTML/PPTX.
      if (report.status !== "pass" && (!nativePresentation || presentationFormat !== "json" || report.status !== "revise")) return;
      const safeTitle = details.artifact.title
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160) || "Hara export";
      const format = nativePresentation ? presentationFormat ?? "pptx" : null;
      const extension = format ?? details.content.extension.slice(1);
      const formatLabels: Record<PresentationExportFormat, string> = {
        json: t("presentationExportJson"),
        html: t("presentationExportHtml"),
        pdf: t("presentationExportPdf"),
        pptx: t("presentationExportPptx"),
      };
      const destinationPath = await saveDialog({
        title: nativePresentation ? formatLabels[format!] : t("artifactExport"),
        defaultPath: `${safeTitle}.${extension}`,
        filters: [{
          name: nativePresentation
            ? formatLabels[format!]
            : `${extension.toUpperCase()} · ${t("artifactRoundtrip")}`,
          extensions: [extension],
        }],
      });
      if (!destinationPath || requestId !== artifactOpenRequestRef.current) return;
      const { receipt } = nativePresentation
        ? await client.exportPresentation({
            artifactId,
            revisionId,
            validationReportId: report.reportId,
            destinationPath,
            format: format!,
          })
        : await client.exportArtifact({
            artifactId,
            revisionId,
            validationReportId: report.reportId,
            destinationPath,
          });
      if (requestId === artifactOpenRequestRef.current) setArtifactExportReceipt(receipt);
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(nativePresentation
          ? makeT(locale)(presentationErrorKey(error, "presentationExportFailed"))
          : t("artifactOpenFailed"));
      }
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };

  const openPresentationInBrowser = () => {
    const details = activePresentation;
    if (!details || !presentationPreviewHtml) return;
    const artifactId = details.artifact.artifactId;
    const revisionId = details.currentRevision.revisionId;
    const currentContext = currentExtensionContext();
    const currentTab = currentContext
      ? activeExtensionTabForContext(extensionDockStateRef.current, currentContext)
      : null;
    if (
      !currentTab
      || currentTab.type !== "artifact"
      || currentTab.owner.artifactId !== artifactId
    ) return;
    const browser: PresentationBrowserExtension = {
      type: "presentation-browser",
      id: presentationBrowserTabId(artifactId, revisionId, currentTab.owner),
      title: safeSurfaceTitle(
        `${details.artifact.title} · ${t("extensionBrowser")}`,
        t("extensionBrowser"),
      ),
      surfaceKind: "browser",
      owner: currentTab.owner,
      mode: "docked",
    };
    warmModule(Promise.all([loadEmbeddedBrowserSurface(), loadExtensionDock()]));
    offerExtensionTab(browser);
  };

  const renderActivePresentationDraft = async (project: PresentationProject): Promise<string> => {
    const client = clientRef.current;
    if (!client || !client.supports("presentation.render")) {
      throw new Error(t("artifactNeedsUpdate"));
    }
    const rendered = await client.renderPresentation(project);
    return rendered.html;
  };

  const choosePresentationImage = async (): Promise<string | null> => {
    try {
      const selected = await openDialog({
        title: t("presentationChooseImage"),
        multiple: false,
        directory: false,
        filters: [{
          name: t("presentationChooseImage"),
          extensions: ["png", "jpg", "jpeg", "webp", "gif"],
        }],
      });
      if (typeof selected !== "string" || !selected) return null;
      return await invoke<string>("read_presentation_image", { path: selected });
    } catch {
      setErr(t("presentationImageFailed"));
      return null;
    }
  };

  const saveActivePresentation = async (project: PresentationProject): Promise<boolean> => {
    const client = clientRef.current;
    const details = activePresentation;
    if (!client || !details) return false;
    if (!client.supports("presentation.update") || !client.supports("presentation.preview")) {
      setErr(t("artifactNeedsUpdate"));
      return false;
    }
    const artifactId = details.artifact.artifactId;
    const baseRevisionId = details.currentRevision.revisionId;
    const savingTabId = contextExtensionDock?.type === "artifact"
      && contextExtensionDock.owner.artifactId === artifactId
      ? contextExtensionDock.id
      : null;
    const requestId = ++artifactOpenRequestRef.current;
    setArtifactBusy("save");
    setErr("");
    try {
      const updated = await client.updatePresentation({ artifactId, baseRevisionId, project });
      const [revisionResult, list, loaded] = await Promise.all([
        client.listArtifactRevisions(artifactId),
        client.listArtifacts(),
        loadPresentationSurface(client, artifactId, updated.currentRevision.revisionId),
      ]);
      if (requestId !== artifactOpenRequestRef.current || clientRef.current !== client) return false;
      const resolved = loaded.details;
      setArtifacts(list ?? "old-server");
      setActiveArtifact(resolved);
      setActivePresentation(resolved);
      setPresentationPreviewHtml(loaded.preview.html);
      setArtifactRevisions(revisionResult.revisions);
      setArtifactValidationReport(null);
      setArtifactExportReceipt(null);
      setExtensionDockState((state) => savingTabId ? updateExtensionTab(state, savingTabId, (current) => {
        const owner = current.type === "artifact" && current.owner.place !== "office"
          ? { place: current.owner.place, sessionId: current.owner.sessionId, cwd: current.owner.cwd }
          : undefined;
        return {
          ...artifactExtensionFor(resolved, owner),
          mode: current.mode,
          dirty: false,
        };
      }) : state);
      return true;
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(makeT(locale)(presentationErrorKey(error, "presentationSaveFailed")));
      }
      return false;
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };

  const assistantCreationRef = useRef(false);
  const startNewAssistantConversation = async (): Promise<string | null> => {
    if (!setZone("chat")) return null;
    if (!home || assistantCreationRef.current) return null;
    assistantCreationRef.current = true;
    setAssistantCreating(true);
    try {
      return await newSession(`${home}/.hara/workspace`);
    } catch (error: any) {
      setErr(String(error?.message ?? error));
      return null;
    } finally {
      assistantCreationRef.current = false;
      setAssistantCreating(false);
    }
  };

  /** Start a fresh guided conversation that previews a custom skill before any file is written. */
  const startSkillCreation = async () => {
    const sessionId = await startNewAssistantConversation();
    if (!sessionId) return;
    updateComposerDraft(sessionId, (draft) => ({
      ...draft,
      text: t("skillCreationPrompt"),
    }));
  };

  /** Office creates through the same conversational Workbench; the right Dock is the result surface. */
  const startPresentationWorkbench = async (template?: PresentationTemplate) => {
    if (!supportsNativePresentationWorkspace(clientRef.current)) {
      const ready = await ensurePresentationWorkspaceRef.current();
      if (!ready) return;
    }
    const sessionId = await startNewAssistantConversation();
    if (!sessionId) return;
    const templateInstructionKeys: Record<PresentationTemplate, Key> = {
          pitch: "presentationTemplatePitchInstruction",
          report: "presentationTemplateReportInstruction",
          technical: "presentationTemplateTechnicalInstruction",
          visual: "presentationTemplateVisualInstruction",
        };
    const templateInstruction = template
      ? t(templateInstructionKeys[template])
      : "";
    updateComposerDraft(sessionId, (draft) => ({
      ...draft,
      text: templateInstruction
        ? `${t("presentationWorkbenchPrompt")}\n\n${templateInstruction}`
        : t("presentationWorkbenchPrompt"),
    }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** Resume the current assistant conversation; create one only when none exists yet. */
  const openAssistant = async (): Promise<string | null> => {
    if (!setZone("chat")) return null;
    const cur = assistantZone(sessionsRef.current).current;
    if (cur) {
      await openSession(cur.id);
      return cur.id;
    }
    return startNewAssistantConversation();
  };

  const toggleGroup = (cwd: string) => {
    setCollapsed((c) => {
      const next = { ...c, [cwd]: !c[cwd] };
      localStorage.setItem("hara.collapsed", JSON.stringify(next));
      return next;
    });
  };

  const attachmentSequenceRef = useRef(0);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const composerDropBusyRef = useRef(false);
  const classifyDroppedComposerAttachmentsRef = useRef<
    (paths: string[]) => Promise<ComposerAttachment[]>
  >(async () => []);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const nextAttachmentId = () =>
    `attachment-${Date.now()}-${++attachmentSequenceRef.current}`;
  const attachmentFeatureReady = clientRef.current?.supportsFeature(ATTACHMENT_FEATURE) ?? false;
  const activeReadOnlySession = active ? readOnlySessions[active] : undefined;
  const activeModelInfo = active && modelInfoScope === active ? modelInfo : null;
  const activeStagedModelChange = active ? stagedModelChanges[active] : undefined;
  const activeModelUnavailable = activeModelInfo?.currentAvailable === false
    && !activeStagedModelChange;
  const activeStagedModelEntry = activeStagedModelChange
    ? activeModelInfo?.entries?.find((entry) => entry.id === activeStagedModelChange.model)
    : undefined;
  const activeComposerAttachmentCapabilities = activeStagedModelChange
    ? activeStagedModelEntry?.attachmentCapabilities
      ?? (activeStagedModelChange.model === activeModelInfo?.current
        ? activeModelInfo?.attachmentCapabilities
        : undefined)
    : activeModelInfo?.attachmentCapabilities;
  const activeComposerEffortLevels = activeStagedModelChange
    ? activeStagedModelEntry?.effortLevels
      ?? (activeStagedModelChange.model === activeModelInfo?.current
        ? activeModelInfo?.effortLevels
        : [])
    : activeModelInfo?.effortLevels ?? [];
  const activeAttachmentIssue = composerAttachmentIssue(
    pendingAttachments,
    activeComposerAttachmentCapabilities,
    attachmentFeatureReady,
  );
  const activeDraftCanSend = !activeReadOnlySession
    && !activeModelUnavailable
    && composerCanSend(activeDraft, activeAttachmentIssue);
  const requireAttachmentFeature = (): boolean => {
    if (clientRef.current?.supportsFeature(ATTACHMENT_FEATURE)) return true;
    setErr(attachmentIssueText(locale, "engine-update-required"));
    return false;
  };
  const addComposerAttachments = useCallback((
    sessionId: string,
    additions: ComposerAttachment[],
  ) => {
    updateComposerDraft(sessionId, (draft) => ({
      ...draft,
      attachments: appendComposerAttachments(draft.attachments, additions),
    }));
  }, [updateComposerDraft]);
  const pickComposerFiles = async (
    kind: "image" | "file",
  ): Promise<ComposerAttachment[]> => {
    if (!requireAttachmentFeature()) return [];
    try {
      const selected = await openDialog({
        title: kind === "image"
          ? (locale === "zh" ? "选择图片" : "Choose images")
          : (locale === "zh" ? "选择文件" : "Choose files"),
        multiple: true,
        ...(kind === "image"
          ? {
              filters: [{
                name: locale === "zh" ? "图片" : "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp"],
              }],
            }
          : {}),
      });
      const paths = typeof selected === "string"
        ? [selected]
        : Array.isArray(selected) ? selected : [];
      if (!paths.length) return [];
      const classified = await invoke<ClassifiedAttachmentPath[]>(
        "classify_attachment_paths",
        { paths },
      );
      return classified
        .filter((entry) => entry.kind === "file")
        .map((entry) => composerAttachment(
          entry.path,
          kind,
          nextAttachmentId(),
          undefined,
          entry.byteSize,
        ));
    } catch (error: any) {
      setErr(String(error?.message ?? error));
      return [];
    }
  };
  const pickComposerDirectory = async (): Promise<ComposerAttachment[]> => {
    if (!requireAttachmentFeature()) return [];
    try {
      const selected = await openDialog({
        title: locale === "zh" ? "添加目录作为本轮参考" : "Add a folder as reference material",
        directory: true,
        multiple: false,
      });
      return typeof selected === "string" && selected
        ? [composerAttachment(selected, "directory", nextAttachmentId())]
        : [];
    } catch (error: any) {
      setErr(String(error?.message ?? error));
      return [];
    }
  };
  const persistPastedImages = async (
    e: React.ClipboardEvent,
  ): Promise<ComposerAttachment[]> => {
    const files = [...(e.clipboardData?.items ?? [])].filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!files.length) return [];
    e.preventDefault();
    if (!requireAttachmentFeature()) return [];
    const additions: ComposerAttachment[] = [];
    const maxBytes = maxImageAttachmentBytes(activeModelInfo?.attachmentCapabilities);
    for (const it of files) {
      const f = it.getAsFile();
      if (!f) continue;
      if (f.size > maxBytes) {
        setErr(attachmentIssueText(locale, "image-too-large"));
        continue;
      }
      try {
        const b64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] ?? "");
          r.onerror = rej;
          r.readAsDataURL(f);
        });
        const path = await invoke<string>("write_temp_image", { dataBase64: b64 });
        additions.push(composerAttachment(path, "image", nextAttachmentId(), f.type, f.size));
      } catch (err: any) {
        setErr(String(err?.message ?? err));
      }
    }
    return additions;
  };
  const classifyDroppedComposerAttachments = async (
    paths: string[],
  ): Promise<ComposerAttachment[]> => {
    if (!paths.length || !requireAttachmentFeature()) return [];
    try {
      const classified = await invoke<ClassifiedAttachmentPath[]>(
        "classify_attachment_paths",
        { paths },
      );
      return classified
        .filter((entry) => entry.kind === "file" || entry.kind === "directory")
        .map((entry) => composerAttachment(
          entry.path,
          entry.kind,
          nextAttachmentId(),
          undefined,
          entry.byteSize,
        ));
    } catch (error: any) {
      setErr(String(error?.message ?? error));
      return [];
    }
  };
  classifyDroppedComposerAttachmentsRef.current = classifyDroppedComposerAttachments;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const sessionId = activeRef.current;
        const canAttach = !!sessionId && !readOnlySessionsRef.current[sessionId];
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setComposerDragActive(canAttach);
          return;
        }

        setComposerDragActive(false);
        if (
          event.payload.type !== "drop"
          || !event.payload.paths.length
          || !sessionId
          || !canAttach
          || composerDropBusyRef.current
        ) return;

        const targetSessionId = sessionId;
        const paths = event.payload.paths;
        composerDropBusyRef.current = true;
        void classifyDroppedComposerAttachmentsRef.current(paths)
          .then((additions) => {
            // Classification crosses the native boundary. Never let a late result land in a different
            // conversation or bypass a session that became replay-only while the drop was in flight.
            if (
              !additions.length
              || activeRef.current !== targetSessionId
              || readOnlySessionsRef.current[targetSessionId]
            ) return;
            addComposerAttachments(targetSessionId, additions);
          })
          .finally(() => {
            composerDropBusyRef.current = false;
          });
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Browser preview does not expose native filesystem drops. Picker and paste remain available.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addComposerAttachments]);

  useEffect(() => {
    if (!active || activeReadOnlySession) setComposerDragActive(false);
  }, [active, activeReadOnlySession]);

  const attachPickedFiles = async (kind: "image" | "file") => {
    const sessionId = activeRef.current;
    if (!sessionId) return;
    setAttachmentMenuOpen(false);
    const additions = await pickComposerFiles(kind);
    if (additions.length) addComposerAttachments(sessionId, additions);
  };
  const attachPickedDirectory = async () => {
    const sessionId = activeRef.current;
    if (!sessionId) return;
    setAttachmentMenuOpen(false);
    const additions = await pickComposerDirectory();
    if (additions.length) addComposerAttachments(sessionId, additions);
  };
  const pasteImages = async (e: React.ClipboardEvent) => {
    const sessionId = activeRef.current;
    if (!sessionId) return;
    const additions = await persistPastedImages(e);
    if (additions.length) addComposerAttachments(sessionId, additions);
  };

  /** Replace a session's transcript from a serve-returned history (compact / rewind). */
  const loadHistory = (sessionId: string, history: ClientHistoryMessage[], tailNotice?: string) => {
    setTranscripts((tr) => {
      const next = {
        ...tr,
        [sessionId]: [
        ...history.map((m): ConversationItem =>
          m.role === "user"
            ? {
                kind: "user",
                text: displayHistoryText(m.text),
                ...(m.attachments?.length ? { attachments: m.attachments } : {}),
              }
            : { kind: "text", text: m.text },
        ),
        ...(tailNotice
          ? [{ kind: "notice", text: tailNotice } as ConversationItem]
          : []),
        ],
      };
      transcriptsRef.current = next;
      return next;
    });
  };

  const compactNow = async () => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    setSessionBusy(active, true);
    try {
      const r = await c.compactSession(active);
      loadHistory(active, r.history, t("compacted"));
      setCtxMap((m) => ({ ...m, [active]: r.ctx }));
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `compact: ${e?.message ?? e}` }]);
    } finally {
      setSessionBusy(active, false);
    }
  };

  /** Rewind to before the user message at transcript index i (codex thread/rollback). */
  const rewindHere = async (i: number) => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    if (!window.confirm(t("rewindConfirm"))) return;
    const items = transcripts[active] ?? [];
    const n = persistedUserTurnsFrom(items, i); // n-th-most-recent server-persisted user turn
    try {
      const r = await c.rewindSession(active, n);
      loadHistory(active, r.history);
    } catch (e: any) {
      push(active, (list) => [...list, { kind: "notice", text: `rewind: ${e?.message ?? e}` }]);
    }
  };

  /** Composer autocomplete tracking: a bare leading /command opens the skill popup; an @token under
   *  the caret opens the fuzzy file popup; anything else closes whatever is open. */
  const trackComposer = (val: string, caret: number) => {
    const slash = /^\/([\w-]{0,40})$/.exec(val);
    if (slash && active) {
      const token = slash[1].toLowerCase();
      const show = (skills: SkillInfo[]) => {
        const items = skills
          .filter((s) => s.id.toLowerCase().startsWith(token))
          .slice(0, 8)
          .map((s) => ({ v: s.id, hint: s.description }));
        setAc({ open: items.length > 0, items, sel: 0, mode: "skill" });
      };
      if (skillsRef.current) show(skillsRef.current);
      else
        void clientRef.current
          ?.listSkills(sessionsRef.current.find((s) => s.id === active)?.cwd)
          .then((r) => {
            skillsRef.current = r.skills;
            show(r.skills);
          })
          .catch(() => {});
      return;
    }
    const m = /(^|[\s(])@([\w./-]{0,60})$/.exec(val.slice(0, caret));
    if (!m || !active) {
      if (ac.open) setAc((a) => ({ ...a, open: false }));
      return;
    }
    const token = m[2];
    if (acTimer.current) window.clearTimeout(acTimer.current);
    acTimer.current = window.setTimeout(() => {
      void clientRef.current
        ?.filesSearch(token, { sessionId: active, limit: 8 })
        .then((r) => r && setAc({ open: r.files.length > 0, items: r.files.map((f) => ({ v: f })), sel: 0, mode: "file" }))
        .catch(() => {});
    }, 120);
  };

  /** Insert the picked item: file mode replaces the @token before the caret; skill mode replaces the
   *  whole input with "/skill-id ". */
  const pickMention = (v: string) => {
    const el = inputRef.current;
    let head: string;
    let next: string;
    if (ac.mode === "skill") {
      head = `/${v} `;
      next = head;
    } else {
      const caret = el?.selectionStart ?? input.length;
      head = input.slice(0, caret).replace(/@[\w./-]{0,60}$/, `@${v} `);
      next = head + input.slice(caret);
    }
    setInput(next);
    setAc((a) => ({ ...a, open: false }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  };

  const sendMsg = async () => {
    const text = input.trim();
    if (!active || (!text && pendingAttachments.length === 0)) return;
    if (activeAttachmentIssue) {
      setErr(attachmentIssueText(locale, activeAttachmentIssue));
      return;
    }
    const sessionId = active;
    const attachments = pendingAttachments;
    updateComposerDraft(sessionId, () => emptyComposerDraft());
    setAc((a) => ({ ...a, open: false }));
    setAttachmentMenuOpen(false);
    setModelPickerOpen(false);
    if (
      busy[sessionId]
      && attachments.length > 0
      && !clientRef.current?.supports("session.submit")
    ) {
      enqueueInput(sessionId, {
        id: nextPendingInputId(),
        text,
        wireText: textWithActiveWorkObject(sessionId, text),
        attachments,
      });
      return;
    }
    try {
      if (attachments.length) {
        const submission = await sendText(sessionId, text, attachments);
        if (submission === "failed") {
          updateComposerDraft(sessionId, (draft) => ({
            text: text
              ? (draft.text ? `${text}\n${draft.text}` : text)
              : draft.text,
            attachments: appendComposerAttachments(attachments, draft.attachments),
          }));
        }
      } else {
        await submitSessionText(sessionId, text);
      }
    } catch (error: any) {
      updateComposerDraft(sessionId, (draft) => ({
        text: text
          ? (draft.text ? `${text}\n${draft.text}` : text)
          : draft.text,
        attachments: appendComposerAttachments(attachments, draft.attachments),
      }));
      setErr(String(error?.message ?? error));
    }
  };

  const startFromWorkbench = async ({
    prompt,
    draftText,
    attachments,
  }: WorkStarterSubmission) => {
    if (starterBusy) return;
    setStarterBusy(true);
    setErr("");
    let sessionId: string | null = null;
    const restoreDraft = () => {
      if (!sessionId) return;
      updateComposerDraft(sessionId, (draft) => ({
        text: draftText
          ? (draft.text ? `${draftText}\n${draft.text}` : draftText)
          : draft.text,
        attachments: appendComposerAttachments(attachments, draft.attachments),
      }));
    };
    try {
      sessionId = await openAssistant();
      if (!sessionId) throw new Error(locale === "zh" ? "工作助理尚未准备好，请稍后重试。" : "The work assistant is not ready yet. Please try again.");
      if (attachments.length) {
        const structuredAttachmentsSupported = clientRef.current?.supportsFeature(ATTACHMENT_FEATURE) ?? false;
        const nextModelInfo = attachments.some((attachment) => attachment.kind === "image")
          ? await refreshModelInfo({ sessionId })
          : undefined;
        const issue = composerAttachmentIssue(
          attachments,
          nextModelInfo?.attachmentCapabilities,
          structuredAttachmentsSupported,
        );
        if (issue) throw new Error(attachmentIssueText(locale, issue));
      }
      const submission = await sendText(sessionId, prompt, attachments);
      if (submission === "failed") restoreDraft();
    } catch (error: any) {
      restoreDraft();
      setErr(String(error?.message ?? error));
    } finally {
      setStarterBusy(false);
    }
  };

  const answer = async (
    sessionId: string,
    approvalId: string,
    verdict: ApprovalVerdict,
  ) => {
    const c = clientRef.current;
    if (!c?.connected) {
      throw new Error(
        locale === "zh"
          ? "Hara 引擎已断开，审批未提交。重新连接后请重新确认。"
          : "The Hara engine disconnected, so the approval was not submitted. Reconnect and review it again.",
      );
    }
    await c.approvalReply(approvalId, verdict !== "deny", verdict === "always");
    if (!c.supportsEvent("event.task_state")) notePet(sessionId, "running");
    push(sessionId, (items) => items.map((it) => (it.kind === "approval" && it.approvalId === approvalId ? { ...it, answered: verdict } : it)));
  };

  petChatSubmitRef.current = async (request: PetChatSubmit): Promise<string | undefined> => {
    const text = request.text.trim();
    if (!text) return request.sessionId;
    const c = clientRef.current;
    if (!c) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "The Hara engine is not connected.");
    let sessionId = request.sessionId;
    const requestedSession = sessionId
      ? sessionsRef.current.find((session) => session.id === sessionId)
      : undefined;
    if (sessionId && !requestedSession) {
      throw new Error(locale === "zh" ? "原会话已不可用，请关闭聊天后重新打开。" : "The original conversation is unavailable. Close and reopen the chat.");
    }
    if (requestedSession && isAutomated(requestedSession)) {
      throw new Error(locale === "zh" ? "自动任务记录是只读的，请在主窗口创建分支后继续。" : "Automated runs are read-only. Fork one in the main window to continue.");
    }
    if (!sessionId) sessionId = await openAssistant() || undefined;
    if (!sessionId) throw new Error(locale === "zh" ? "个人助理尚未准备好。" : "The personal assistant is not ready yet.");

    const task = taskStatesRef.current[sessionId];
    const live = busyRef.current[sessionId] || (
      task ? taskStateIsLive(task.state) : false
    );
    if (!live && !attachedSessionsRef.current.has(sessionId)) {
      // session.list contains persisted metadata, not a live serve attachment. Resume before the
      // companion dispatches so a cold Desktop start cannot acknowledge a doomed NO_SESSION send.
      const resumed = await c.resumeSession(sessionId, defaultApproval || undefined);
      attachedSessionsRef.current.add(sessionId);
      rememberSessionApproval(sessionId, resumed.approval);
      hydrateLegacyTaskState(c, sessionId, resumed.task);
      loadHistory(sessionId, resumed.history);
    }
    if (live) {
      await submitSessionText(sessionId, text);
    } else {
      // Starting a normal turn can take minutes. The companion acknowledges local dispatch immediately;
      // transcript/task events stream the real progress and any later failure back into the same window.
      void submitSessionText(sessionId, text).catch((error) => setErr(String(error)));
    }
    return sessionId;
  };

  petChatApprovalRef.current = async (request: PetChatApproval): Promise<void> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === request.sessionId);
    if (!session || isAutomated(session)) {
      throw new Error(locale === "zh" ? "该会话不能从桌面伙伴确认。" : "This conversation cannot be approved from the companion.");
    }
    const typedApproval = taskStatesRef.current[request.sessionId]?.approval?.id;
    const legacyApproval = [...(transcriptsRef.current[request.sessionId] ?? [])]
      .reverse()
      .find((item) => item.kind === "approval" && !item.answered);
    const expectedApprovalId = typedApproval || (
      legacyApproval?.kind === "approval" ? legacyApproval.approvalId : undefined
    );
    if (!expectedApprovalId || expectedApprovalId !== request.approvalId) {
      throw new Error(locale === "zh" ? "这条确认已过期，请刷新状态。" : "This approval is stale. Refresh the conversation state.");
    }
    await answer(request.sessionId, request.approvalId, request.allow ? "allow" : "deny");
  };

  const stopTurn = async (sessionId: string) => {
    const c = clientRef.current;
    if (!c) return;
    interruptedSessionsRef.current.add(sessionId);
    try {
      await c.interrupt(sessionId);
    } catch (error) {
      interruptedSessionsRef.current.delete(sessionId);
      setErr(String(error));
    }
  };

  const changeModel = async (model?: string, effort?: string) => {
    if (!clientRef.current?.connected || !active) return;
    const sessionId = active;
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    const staged = stagedModelChangesRef.current[sessionId];
    const nextModel = model || staged?.model || session.model;
    // Choosing a model resets effort to automatic, matching Serve's established picker contract.
    // Choosing only effort preserves a previously staged model for the same next turn.
    const nextEffort = model !== undefined
      ? (effort ?? "")
      : (effort ?? staged?.effort ?? sessEffort[sessionId] ?? "");
    const unchanged = !staged
      && nextModel === session.model
      && nextEffort === (sessEffort[sessionId] ?? "");
    setModelPickerOpen(false);
    setModelSearch("");
    if (unchanged) return;

    stageModelChange(sessionId, nextModel, nextEffort);
    if (!busyRef.current[sessionId]) {
      try {
        await flushStagedModelChange(sessionId);
      } catch (error: any) {
        push(sessionId, (items) => [...items, {
          kind: "notice",
          text: locale === "zh"
            ? `模型切换发生意外错误：${error?.message ?? error}`
            : `Unexpected model switch error: ${error?.message ?? error}`,
        }]);
      }
    }
  };

  const changeApproval = async (approval: ApprovalMode) => {
    const client = clientRef.current;
    const sessionId = activeRef.current;
    if (!client || !sessionId) return;
    if (!client.supports("session.set-approval")) {
      setErr(locale === "zh"
        ? "当前 Hara 引擎不支持会话权限切换，请先更新 Desktop。"
        : "This Hara engine does not support per-conversation permission switching. Update Desktop first.");
      return;
    }
    if (busyRef.current[sessionId]) {
      setErr(locale === "zh"
        ? "当前任务仍在执行，请在本轮结束后切换权限模式。"
        : "The current task is still running. Change permission mode after this turn finishes.");
      return;
    }
    try {
      const result = await client.setSessionApproval(sessionId, approval);
      rememberSessionApproval(sessionId, result.approval);
      setErr("");
    } catch (error: any) {
      setErr(locale === "zh"
        ? `权限模式切换失败：${error?.message ?? error}`
        : `Permission mode switch failed: ${error?.message ?? error}`);
    }
  };

  /** A capability panel is project work. Settings may launch it only when a real project owner exists. */
  const openPanel = async (pluginName: string, spec: PanelSpec) => {
    if (pluginsRef.current?.find((plugin) => plugin.name === pluginName)?.enabled !== true) {
      setErr(locale === "zh" ? "该能力已停用，不能启动它的工作面板。" : "This capability is disabled, so its work panel cannot be started.");
      return;
    }
    const projectSessionId = activeByZoneRef.current.projects;
    const projectSession = projectSessionId
      ? sessionsRef.current.find((session) => session.id === projectSessionId)
      : undefined;
    if (!projectSession || sessionPlace(projectSession) !== "projects") {
      setErr(locale === "zh"
        ? "先打开一个项目，再从能力中心启动工作面板。面板不会在没有项目归属时运行。"
        : "Open a project before starting this work panel. A panel never runs without a project owner.");
      setZone("projects");
      return;
    }
    if (!discardCurrentExtensionDraft()) return;
    const projectClient = clientRef.current;
    if (!projectClient) {
      setErr(locale === "zh" ? "Hara 引擎尚未连接。" : "The Hara engine is not connected.");
      return;
    }
    const launchZone = zoneRef.current;
    const assertPanelLaunchContext = () => {
      const currentProjectId = activeByZoneRef.current.projects;
      const currentProject = currentProjectId
        ? sessionsRef.current.find((session) => session.id === currentProjectId)
        : undefined;
      if (
        clientRef.current !== projectClient
        || zoneRef.current !== launchZone
        || !currentProject
        || currentProject.id !== projectSession.id
        || sessionPlace(currentProject) !== "projects"
        || currentProject.cwd !== projectSession.cwd
      ) {
        throw new Error(locale === "zh"
          ? "项目上下文已变化，请在当前项目中重新启动该面板。"
          : "The project context changed. Start the panel again from the current project.");
      }
      if (pluginsRef.current?.find((plugin) => plugin.name === pluginName)?.enabled !== true) {
        throw new Error(locale === "zh"
          ? "该能力已停用，不能启动它的工作面板。"
          : "This capability is disabled, so its work panel cannot be started.");
      }
    };
    warmModule(loadExtensionDock());
    setPanelBusy(panelOperationKey(pluginName, spec.id));
    try {
      // The Settings catalog is descriptive, not an execution authority. Ask Serve which panels
      // actually match this exact project and execute only the authoritative returned descriptor.
      const detected = await projectClient.projectPanels({ sessionId: projectSession.id });
      assertPanelLaunchContext();
      const applicable = detected?.cwd === projectSession.cwd
        ? detected.panels.find((panel) => panel.plugin === pluginName && panel.id === spec.id)
        : undefined;
      if (!applicable) {
        throw new Error(locale === "zh"
          ? "该面板不适用于当前项目；请打开包含其识别文件的项目后重试。"
          : "This panel does not apply to the current project. Open a project with its detection markers and try again.");
      }
      const url = await invoke<string>("start_panel", {
        command: applicable.command,
        args: applicable.args ?? [],
        cwd: projectSession.cwd,
        portHint: applicable.port ?? null,
      });
      // start_panel may take up to 20 seconds. Never revive stale work after navigation, disconnect,
      // project replacement, or capability disablement during that wait.
      assertPanelLaunchContext();
      zoneRef.current = "projects";
      sessionOpenRequestRef.current += 1;
      setZoneRaw("projects");
      setActive(projectSession.id);
      localStorage.setItem("hara.zone", "projects");
      setExtensionLoading(true);
      setExtensionDock(panelExtensionFor(
        applicable,
        url,
        { place: "projects", sessionId: projectSession.id, cwd: projectSession.cwd },
      ));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPanelBusy("");
    }
  };

  /** Toggle the project-owned extension screen; it can never migrate to another session implicitly. */
  const toggleExtensionPanel = async (spec: ProjectPanel, cwd: string) => {
    if (!active) return;
    const ownerSessionId = active;
    const openTab = extensionDockState.tabs.find((tab) =>
      tab.type === "legacy-panel"
      && tab.plugin === spec.plugin
      && tab.owner.sessionId === ownerSessionId
      && tab.id === `panel:${ownerSessionId}:${spec.plugin}:${spec.id}`);
    if (openTab) {
      setExtensionDockState((state) => closeExtensionTab(state, openTab.id));
      return;
    }
    const plugin = pluginsRef.current?.find((candidate) => candidate.name === spec.plugin);
    if (plugin && !plugin.enabled) {
      setErr(locale === "zh" ? "该能力已停用，不能启动它的工作面板。" : "This capability is disabled, so its work panel cannot be started.");
      return;
    }
    if (!discardCurrentExtensionDraft()) return;
    const launchGeneration = sessionOpenRequestRef.current;
    const assertDirectPanelLaunchContext = () => {
      const currentProjectId = activeByZoneRef.current.projects;
      const currentProject = currentProjectId
        ? sessionsRef.current.find((session) => session.id === currentProjectId)
        : undefined;
      if (
        sessionOpenRequestRef.current !== launchGeneration
        || zoneRef.current !== "projects"
        || !currentProject
        || currentProject.id !== ownerSessionId
        || sessionPlace(currentProject) !== "projects"
        || currentProject.cwd !== cwd
      ) {
        throw new Error(locale === "zh"
          ? "项目上下文已变化，请在当前项目中重新启动该面板。"
          : "The project context changed. Start the panel again from the current project.");
      }
      if (pluginsRef.current?.find((candidate) => candidate.name === spec.plugin)?.enabled === false) {
        throw new Error(locale === "zh"
          ? "该能力已停用，不能启动它的工作面板。"
          : "This capability is disabled, so its work panel cannot be started.");
      }
    };
    warmModule(loadExtensionDock());
    setPanelBusy(panelOperationKey(spec.plugin, spec.id));
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [], cwd, portHint: spec.port ?? null });
      assertDirectPanelLaunchContext();
      setExtensionLoading(true);
      setExtensionDock(panelExtensionFor(
        spec,
        url,
        { place: "projects", sessionId: ownerSessionId, cwd },
      ));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPanelBusy("");
    }
  };

  const togglePlugin = async (name: string, enabled: boolean) => {
    const c = clientRef.current;
    if (!c) return;
    const previous = pluginsRef.current;
    const optimistic = previous?.map((plugin) =>
      plugin.name === name ? { ...plugin, enabled } : plugin,
    ) ?? null;
    pluginsRef.current = optimistic;
    setPlugins(optimistic);
    if (!enabled) {
      setExtensionDockState((state) => state.tabs
        .filter((tab) => tab.type === "legacy-panel" && tab.plugin === name)
        .reduce((next, tab) => closeExtensionTab(next, tab.id), state));
    }
    if (!enabled) {
      setProjPanels((current) =>
        Object.fromEntries(
          Object.entries(current).map(([cwd, panels]) => [
            cwd,
            panels.filter((panel) => panel.plugin !== name),
          ]),
        ),
      );
    } else {
      // Enabling a capability can add a project panel; discard cached misses so the server is asked again.
      setProjPanels({});
    }
    try {
      await c.setPlugin(name, enabled);
      const [pl, sk] = await Promise.all([
        c.listPlugins(),
        c.listSkills(capabilitySkillsCwdRef.current).catch(() => null),
      ]);
      pluginsRef.current = pl.plugins;
      setPlugins(pl.plugins);
      skillsRef.current = null;
      if (sk) setSkills(sk.skills);
      if (!enabled) {
        setProjPanels((current) =>
          Object.fromEntries(
            Object.entries(current).map(([cwd, panels]) => [
              cwd,
              panels.filter((panel) => panel.plugin !== name),
            ]),
          ),
        );
      }
    } catch (error: any) {
      pluginsRef.current = previous;
      setPlugins(previous);
      setProjPanels({});
      setErr(String(error?.message ?? error));
    }
  };

  const waitForDiscoveryRetirement = async () => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (!(await invoke<string | null>("read_discovery"))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(t("restartShutdownTimeout"));
  };

  const restartBundledEngine = async () => {
    if (engineRestarting || !server) return;
    if (Object.values(busy).some(Boolean)) {
      setErr(t("engineRestartBusy"));
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setErr(t("engineRestartReconnect"));
      return;
    }

    setErr("");
    setEngineRestarting(true);
    plannedUpdateRestartRef.current = true;
    try {
      if (client.supports("server.shutdown")) {
        await client.shutdownServer();
      } else {
        // Engines before 0.126 cannot shut themselves down through RPC. Close the authenticated renderer
        // transport first, then let native code independently re-open the private discovery record, match
        // the pid and Hara executable path, and send the one-time legacy termination.
        clientRef.current = null;
        client.close();
        await invoke("terminate_legacy_serve", { expectedPid: server.pid });
      }
      await waitForDiscoveryRetirement();
      await startServer();
    } catch (error: any) {
      setErr(String(error?.message ?? error).slice(0, 220));
    } finally {
      plannedUpdateRestartRef.current = false;
      setEngineRestarting(false);
    }
  };

  ensurePresentationWorkspaceRef.current = async () => {
    if (supportsNativePresentationWorkspace(clientRef.current)) return true;
    if (Object.values(busyRef.current).some(Boolean)) {
      setErr(locale === "zh"
        ? "当前任务仍在运行，不能安全更换 Hara 引擎。任务结束后再次新建演示文稿，Desktop 会自动启用安装包内置的新引擎。"
        : "A task is still running, so Hara cannot safely replace the engine. Try creating the presentation again after it finishes; Desktop will enable the bundled engine automatically.");
      return false;
    }
    setErr(locale === "zh"
      ? `正在把 Hara 引擎升级到安装包内置版本 ${BUNDLED_ENGINE_VERSION}，随后继续新建演示文稿…`
      : `Switching to bundled Hara engine ${BUNDLED_ENGINE_VERSION}, then presentation creation will continue…`);
    await restartBundledEngine();
    const ready = supportsNativePresentationWorkspace(clientRef.current);
    if (!ready) {
      setErr(locale === "zh"
        ? `演示工作台需要 Hara 引擎 ${BUNDLED_ENGINE_VERSION} 的原生右侧 Surface 与编辑能力。请在设置中重启内置引擎后重试。`
        : `Presentation Workbench needs the native surface and editing capabilities in bundled engine ${BUNDLED_ENGINE_VERSION}. Restart the bundled engine in Settings and try again.`);
    } else {
      setErr("");
    }
    return ready;
  };

  const downloadDesktopUpdate = async () => {
    if (updating || updateReady) return;
    setUpdating(true);
    setUpdateNoticeVisible(true);
    setUpdateProgress(null);
    setUpd("");
    setUpdateTone("neutral");
    let candidate: Update | null = null;
    try {
      candidate = await checkDesktopUpdate();
      if (!candidate) {
        setUpdAvail("");
        setUpdateNoticeVisible(false);
        setUpd(t("upToDate"));
        setUpdateTone("success");
        return;
      }
      setUpdAvail(candidate.version);
      setUpd(`${t("downloadingUpdate")} ${candidate.version}`);
      // Keep the live task engine available during the network transfer. Installation is deliberately
      // deferred to restartForUpdate, after authenticated shutdown has retired the discovery record. On
      // Windows this ordering is mandatory: a running adjacent hara.exe cannot be replaced reliably.
      let downloaded = 0;
      let total: number | undefined;
      await candidate.download((event) => {
        if (event.event === "Started") {
          downloaded = 0;
          total = event.data.contentLength;
          setUpdateProgress({ downloaded, ...(total ? { total } : {}) });
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateProgress({ downloaded, ...(total ? { total } : {}) });
          return;
        }
        if (event.event === "Finished") {
          setUpdateProgress({ downloaded: total ?? downloaded, ...(total ? { total } : {}) });
        }
      });
      pendingDesktopUpdateRef.current = {
        update: candidate,
        version: candidate.version,
        phase: "downloaded",
      };
      candidate = null;
      setUpdAvail("");
      setUpdateReady(true);
      setUpdateProgress(null);
      setUpd(t("restartToApply"));
      setUpdateTone("success");
    } catch (error: any) {
      if (candidate) void candidate.close().catch(() => {});
      setUpdateNoticeVisible(true);
      setUpdateProgress(null);
      setUpd(desktopUpdaterErrorText(locale, error));
      setUpdateTone("error");
    } finally {
      setUpdating(false);
    }
  };

  const cleanDesktopUpdateStorage = async () => {
    if (updateStorageBusy) return;
    setUpdateStorageBusy(true);
    setUpdateStorageNotice(null);
    try {
      const status = await invoke<DesktopUpdateStorageStatus>("clean_desktop_update_storage");
      setUpdateStorage(status);
      if (!status.scanComplete || status.failedEntries > 0) {
        setUpdateStorageNotice({ tone: "warning", title: t("updateStorageCleanIncomplete") });
      } else {
        setUpdateStorageNotice({
          tone: "success",
          title: `${t("updateStorageCleaned")} · ${formatStorageBytes(status.reclaimedBytes, locale)}`,
        });
      }
    } catch {
      setUpdateStorageNotice({ tone: "error", title: t("updateStorageCleanFailed") });
    } finally {
      setUpdateStorageBusy(false);
    }
  };

  const installCommandLineHara = async () => {
    if (commandLineBusy || (commandLineHara?.current && commandLineHara.managed) || commandLineHara?.blocked || commandLineHara?.available === false) return;
    setCommandLineBusy(true);
    setCommandLineNotice("");
    try {
      const status = await invoke<CommandLineHaraStatus>("install_command_line_hara");
      setCommandLineHara(status);
      setCommandLineTone("success");
      setCommandLineNotice(`${t("cliInstallSuccess")} ${status.bundledVersion}`);
    } catch (error: any) {
      setCommandLineTone("error");
      setCommandLineNotice(String(error?.message ?? error).slice(0, 220));
    } finally {
      setCommandLineBusy(false);
    }
  };

  const restartForUpdate = async () => {
    if (Object.values(busy).some(Boolean)) {
      setUpdateNoticeVisible(true);
      setUpd(t("restartBusy"));
      setUpdateTone("warning");
      return;
    }
    const pendingUpdate = pendingDesktopUpdateRef.current;
    if (!pendingUpdate) {
      setUpdateNoticeVisible(true);
      setUpdateReady(false);
      setUpd(t("updateStateLost"));
      setUpdateTone("error");
      return;
    }
    setUpdating(true);
    setUpd(t("restarting"));
    setUpdateTone("neutral");
    plannedUpdateRestartRef.current = true;
    let engineRetired = false;
    try {
      await applyDesktopUpdateHandoff(pendingUpdate, {
        retireEngine: async () => {
          const client = clientRef.current;
          if (client) {
            if (client.supports("server.shutdown")) {
              await client.shutdownServer();
            } else {
              if (!server) throw new Error(t("engineRestartReconnect"));
              clientRef.current = null;
              client.close();
              await invoke("terminate_legacy_serve", { expectedPid: server.pid });
            }
          } else if (await invoke<string | null>("read_discovery")) {
            throw new Error(t("engineRestartReconnect"));
          }
          await waitForDiscoveryRetirement();
          engineRetired = true;
        },
        install: () => pendingUpdate.update.install(),
        restart: () => invoke("restart_after_update"),
      });
    } catch (error: any) {
      plannedUpdateRestartRef.current = false;
      const serverBusy = error?.code === SERVER_BUSY;
      const message = serverBusy
        ? t("restartServerBusy")
        : String(error?.message ?? error).slice(0, 160);
      setUpd(message);
      setUpdateNoticeVisible(true);
      setUpdateTone(serverBusy ? "warning" : "error");
      setUpdating(false);
      // If installation or native relaunch failed after the engine was safely retired, restore task
      // availability. A retry will retire it again but never re-install an already installed package.
      if (engineRetired) {
        await startServer().catch(() => {
          setErr(message);
          setPhase("no-server");
        });
      }
    }
  };

  const openDesktopUpdateSettings = () => {
    setSetSec("engine");
    setZone("settings");
  };

  const deferDesktopUpdate = () => {
    const version = pendingDesktopUpdateRef.current?.version || updAvail;
    if (version) snoozeDesktopUpdate(version);
    setUpdateNoticeVisible(false);
  };

  const flipLocale = () => {
    const next: Locale = locale === "en" ? "zh" : "en";
    saveLocale(next);
    setLocale(next);
  };

  // keep latest handlers reachable from the once-registered shortcut listener + pending-card effect
  apiRef.current = { setZone, openAssistant, openProject };

  // ── boot / error screen ────────────────────────────────────────────────────
  if (phase !== "ready") {
    return (
      <div className="center">
        <HaraLogo size={72} className="bootmark" />
        <div className="brand big">
          <span className="wordmark">Hara</span>
        </div>
        <div className="herotag dim">{t("heroTag")}</div>
        {phase === "boot" || phase === "connecting" ? (
          <div className="dim">{phase === "connecting" ? t("starting") : t("connecting")}</div>
        ) : (
          <>
            <div className="cards">
              <div className="card">
                <div className="card-t">{t("cardChatTitle")}</div>
                <div className="card-b dim">{t("cardChatBody")}</div>
                <button
                  onClick={() => {
                    pendingRef.current = "assistant";
                    void startServer();
                  }}
                >
                  {t("cardChatBtn")}
                </button>
              </div>
              <div className="card">
                <div className="card-t">{t("cardProjTitle")}</div>
                <div className="card-b dim">{t("cardProjBody")}</div>
                <button
                  className="ghost"
                  onClick={() => {
                    pendingRef.current = "project";
                    void startServer();
                  }}
                >
                  {t("cardProjBtn")}
                </button>
              </div>
            </div>
            {err && (
              <details className="errbox">
                <summary className="dim">{t("showDetails")}</summary>
                <div className="err">{err}</div>
              </details>
            )}
            <button className="linky" onClick={() => void connect()}>
              {t("retry")}
            </button>
          </>
        )}
      </div>
    );
  }

  const manualUnreadIn = (list: SessionInfo[]): boolean => list.some((s) => unread[s.id]);
  const hit = (text: string): boolean => !q || text.toLowerCase().includes(q.toLowerCase());
  const az = assistantZone(sessions);
  const azBots = az.bots.filter((s) => hit(s.title) || hit(s.sourceName ?? ""));
  const azAll = [...(az.current ? [az.current] : []), ...az.bots, ...az.history];
  const engineVersionState = classifyEngineVersion(server?.version ?? "", BUNDLED_ENGINE_VERSION);
  const engineVersionNeedsAttention =
    engineVersionState === "older" || engineVersionState === "incompatible";
  const groups = projectGroups(sessions, projectListState)
    .map(([cwd, list]): [string, SessionInfo[]] => [cwd, hit(basename(cwd)) ? list : list.filter((s) => hit(s.title))])
    .filter(([cwd, list]) => hit(basename(cwd)) || list.length > 0);
  const searchBox = (
    <input id="haraSearch" className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} spellCheck={false} />
  );
  const activeSession = sessions.find((s) => s.id === active);
  const activeApproval: ApprovalMode = (activeSession?.approval ?? defaultApproval) || "auto-edit";
  const activeComposerWorkObject = active ? visibleSessionWorkObject(active) : null;
  const items = active ? (transcripts[active] ?? []) : [];
  const modelEntries = [...new Set([
    ...(activeSession && activeModelInfo?.currentAvailable !== false ? [activeSession.model] : []),
    ...(activeStagedModelChange ? [activeStagedModelChange.model] : []),
    ...(activeModelInfo?.models ?? []),
  ])].map((modelId): ModelCatalogEntry => {
    const entry = activeModelInfo?.entries?.find((candidate) => candidate.id === modelId);
    if (entry) return entry;
    return {
      id: modelId,
      providerId: server?.provider ?? "",
      effortLevels: modelId === activeModelInfo?.current ? activeModelInfo.effortLevels : [],
      ...(modelId === activeModelInfo?.current && activeModelInfo.attachmentCapabilities
        ? { attachmentCapabilities: activeModelInfo.attachmentCapabilities }
        : {}),
    };
  });
  const displayedModel = activeStagedModelChange?.model ?? activeSession?.model ?? "";
  const displayedEffort = activeStagedModelChange?.effort ?? (active ? sessEffort[active] ?? "" : "");
  const visibleModelEntries = activeReadOnlySession
    ? []
    : modelEntries.filter((entry) =>
        !modelSearch.trim()
        || `${entry.id} ${entry.providerId}`.toLowerCase().includes(modelSearch.trim().toLowerCase()),
      );
  const currentSessionProfileId = activeModelInfo?.profileId ?? activeSession?.profileId;
  const currentPersonalConnection = providerRoutes?.connections?.find(
    (connection) => connection.id === currentSessionProfileId,
  );
  const currentOrganizationConnection = organizationRoutes?.connections.find(
    (connection) => connection.id === currentSessionProfileId,
  );
  const currentRouteIsPersonal = currentSessionProfileId === "personal" || !!currentPersonalConnection;
  const currentRouteLabel = currentPersonalConnection?.label
    ?? currentOrganizationConnection?.label
    ?? (currentSessionProfileId === "personal"
      ? (locale === "zh" ? "个人" : "Personal")
      : currentSessionProfileId ?? (locale === "zh" ? "当前连接" : "Current route"));
  const newSessionOrganizationRoute = organizationRoutes?.connections.find(
    (connection) => connection.active && connection.id !== currentSessionProfileId,
  );
  const newSessionPersonalRoute = providerRoutes?.connections?.find(
    (connection) => connection.active && connection.id !== currentSessionProfileId,
  );
  const newSessionDefaultRoute = newSessionOrganizationRoute
    ? { kind: "organization" as const, label: newSessionOrganizationRoute.label }
    : newSessionPersonalRoute
      ? { kind: "personal" as const, label: newSessionPersonalRoute.label }
      : null;
  const modelRouteQuery = modelSearch.trim().toLowerCase();
  const visiblePersonalConnectionRoutes = (providerRoutes?.connections ?? [])
    .filter((connection) => (
      activeReadOnlySession || connection.id !== currentSessionProfileId
    ) && connection.authenticated)
    .filter((connection) => !modelRouteQuery
      || [connection.label, connection.id, connection.provider, connection.model, connection.baseURL ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(modelRouteQuery));
  const visibleOrganizationModelRoutes = (organizationRoutes?.connections ?? [])
    .filter((connection) => activeReadOnlySession || connection.id !== currentSessionProfileId)
    .filter((connection) => ["valid", "permanent", "expiring", "legacy"].includes(connection.accessState))
    .map((connection) => {
      const allModels = [...new Set(
        connection.availableModels?.length
          ? connection.availableModels
          : connection.model ? [connection.model] : [],
      )];
      const connectionMatches = !modelRouteQuery
        || `${connection.label} ${connection.id} ${connection.gatewayHost}`.toLowerCase().includes(modelRouteQuery);
      const models = connectionMatches
        ? allModels
        : allModels.filter((model) => model.toLowerCase().includes(modelRouteQuery));
      return { connection, models };
    })
    .filter((route) => route.models.length > 0);

  const sortPinned = (l: SessionInfo[]): SessionInfo[] => [...l].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  const commitRename = async () => {
    const c = clientRef.current;
    if (editingId && c && editTitle.trim()) {
      await c.renameSession(editingId, editTitle.trim()).catch(() => {});
      await refreshSessions();
    }
    setEditingId(null);
  };
  const archiveIt = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    await c.archiveSession(id, true).catch(() => {});
    clearActiveSession(id);
    removePet(id);
    delete activeTurnsRef.current[id];
    clearStagedModelChange(id);
    setTaskStates((states) => {
      const { [id]: _gone, ...rest } = states;
      taskStatesRef.current = rest;
      return rest;
    });
    setWorkforceStates((states) => {
      const { [id]: _gone, ...rest } = states;
      workforceStatesRef.current = rest;
      return rest;
    });
    await refreshSessions();
  };
  const deleteIt = async (id: string) => {
    const c = clientRef.current;
    if (!c || !window.confirm(t("deleteConfirm"))) return;
    try {
      await c.deleteSession(id);
      attachedSessionsRef.current.delete(id);
      clearActiveSession(id);
      removePet(id);
      delete activeTurnsRef.current[id];
      clearStagedModelChange(id);
      setSessionReadOnly(id, null);
      setTaskStates((states) => {
        const { [id]: _goneTask, ...rest } = states;
        taskStatesRef.current = rest;
        return rest;
      });
      setWorkforceStates((states) => {
        const { [id]: _goneWorkforce, ...rest } = states;
        workforceStatesRef.current = rest;
        return rest;
      });
      setTranscripts(({ [id]: _gone, ...rest }) => rest);
      await refreshSessions();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  /** The replay's escape hatch: fork the automated run into an interactive session and jump there. */
  const continueManually = async () => {
    const c = clientRef.current;
    if (!c || !autoReplay) return;
    const home = isAssistantCwd(autoReplay.cwd);
    const requestId = ++sessionOpenRequestRef.current;
    try {
      const r = await c.forkSession(autoReplay.id);
      attachedSessionsRef.current.add(r.sessionId);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
      }));
      rememberSession(r.sessionId, { cwd: autoReplay.cwd, source: "interactive" });
      await refreshSessions();
      if (requestId === sessionOpenRequestRef.current && zoneRef.current === "auto") {
        setZone(home ? "chat" : "projects");
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const forkIt = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    const source = sessionsRef.current.find((session) => session.id === id);
    const sourcePlace = source ? sessionPlace(source) : null;
    if (sourcePlace === "chat" || sourcePlace === "projects") {
      const switchingContext = sourcePlace !== zoneRef.current;
      if (switchingContext) {
        if (!setZone(sourcePlace)) return;
      } else if (!discardCurrentExtensionDraft()) return;
    } else if (!discardCurrentExtensionDraft()) return;
    const sessionHint = { cwd: source?.cwd ?? server?.cwd ?? "", source: "interactive" };
    const requestId = ++sessionOpenRequestRef.current;
    try {
      const r = await c.forkSession(id);
      attachedSessionsRef.current.add(r.sessionId);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
      }));
      rememberSession(r.sessionId, sessionHint);
      if (sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, sessionHint)) {
        setActive(r.sessionId);
      }
      await refreshSessions();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  const openWorkbenchSession = async (session: SessionInfo) => {
    const place = sessionPlace(session);
    if (place !== "chat" && place !== "projects") return;
    if (zoneRef.current !== place && !setZone(place)) return;
    await openSession(session.id);
  };
  const sessRow = (s: SessionInfo) => (
    <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openWorkbenchSession(s)}>
      <div className="title">
        {busy[s.id] && <span className="live">●</span>}
        {unread[s.id] && <span className="dot" />}
        {editingId === s.id ? (
          <input
            className="renamein"
            autoFocus
            value={editTitle}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <span className="ttext">{s.title || t("untitled")}</span>
        )}
        <span
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            setEditingId(s.id);
            setEditTitle(s.title);
          }}
        >
          <IconEdit />
        </span>
        <span
          className={`act pin ${pins.includes(s.id) ? "pinned" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(s.id);
          }}
        >
          <IconStar filled={pins.includes(s.id)} />
        </span>
        <span
          className="act"
          title={t("forkSess")}
          onClick={(e) => {
            e.stopPropagation();
            void forkIt(s.id);
          }}
        >
          <IconFork />
        </span>
        <span
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            void archiveIt(s.id);
          }}
        >
          <IconArchive />
        </span>
        <span
          className="act danger"
          title={t("deleteSess")}
          onClick={(e) => {
            e.stopPropagation();
            void deleteIt(s.id);
          }}
        >
          <IconTrash />
        </span>
      </div>
      <div className="meta">
        {s.model} · {s.updatedAt ? fmtTime(s.updatedAt) : t("newLabel")}
      </div>
    </div>
  );

  const conversation = (temperament: "im" | "ide") => (
    <main className={`chat ${temperament}`}>
      {/* the permanent target anchor — you always know where this message lands */}
      <div className="anchor">
        {temperament === "im" ? (
          <span>{t("anchorAssistant")}</span>
        ) : (
          <span>
            {t("anchorRepo")}
            <b>{activeSession ? basename(activeSession.cwd) : "—"}</b> <span className="dim">{activeSession?.cwd}</span>
          </span>
        )}
        <div className="anchor-actions">
          {temperament === "ide" &&
            activeSession &&
            (projPanels[activeSession.cwd] ?? [])
              .filter((sp) => plugins?.find((plugin) => plugin.name === sp.plugin)?.enabled !== false)
              .map((sp) => (
                <button
                  key={sp.id}
                  className={`paneltab ${
                    extensionDockState.tabs.some((tab) =>
                      tab.type === "legacy-panel"
                      && tab.id === `panel:${activeSession.id}:${sp.plugin}:${sp.id}`)
                      ? "on"
                      : ""
                  }`}
                  disabled={panelBusy === panelOperationKey(sp.plugin, sp.id)}
                  onMouseEnter={() => warmModule(loadExtensionDock())}
                  onFocus={() => warmModule(loadExtensionDock())}
                  onClick={() => void toggleExtensionPanel(sp, activeSession.cwd)}
                >
                  {panelBusy === panelOperationKey(sp.plugin, sp.id) ? "…" : `◧ ${sp.title}`}
                </button>
              ))}
          {activeSession && contextExtensionTabs.length === 0 ? (
            <Suspense
              fallback={(
                <button type="button" className="paneltab extension-view-launcher-fallback" disabled>
                  + {t("extensionAdd")}
                </button>
              )}
            >
              <ExtensionViewLauncher
                items={extensionAddItems}
                label={t("extensionAdd")}
                variant="anchor"
                onSelect={openExtensionItem}
              />
            </Suspense>
          ) : (
            <button
              type="button"
              className={`paneltab extension-screen-toggle${contextExtensionScreenVisible ? " on" : ""}`}
              aria-pressed={contextExtensionScreenVisible}
              disabled={!activeSession}
              title={contextExtensionTabs.length === 0
                ? t("extensionEmpty")
                : contextExtensionScreenVisible ? t("extensionHide") : t("extensionShow")}
              onClick={toggleCurrentExtensionScreen}
            >
              ◫ {t("extensionScreen")}
              <span className="extension-screen-count">{contextExtensionTabs.length}</span>
            </button>
          )}
        </div>
      </div>
      {!active ? (
        temperament === "im" ? (
          <div className="workstarter-scroll">
            <WorkStarter
              locale={locale}
              busy={starterBusy}
              apps={([
                {
                  id: "core.office",
                  title: t("zoneOffice"),
                  description: t("moduleOfficeDescription"),
                  icon: "office",
                  source: "Hara",
                },
                {
                  id: AGENT_OFFICE_CAPABILITY.id,
                  title: t("capabilityAgentOfficeTitle"),
                  description: t("capabilityAgentOfficeDescription"),
                  icon: "office",
                  source: "Hara",
                },
                {
                  id: "core.projects",
                  title: t("zoneProjects"),
                  description: t("moduleProjectsDescription"),
                  icon: "project",
                  source: "Hara",
                },
                ...pluginNavigation.slice(0, 6).map((contribution): WorkbenchApp => ({
                  id: contribution.id,
                  title: contribution.title,
                  description: contribution.description || contribution.plugin,
                  icon: workbenchAppIconForPanel(contribution),
                  source: contribution.plugin,
                  disabled: !sessions.some((session) => sessionPlace(session) === "projects"),
                })),
              ] satisfies WorkbenchApp[])}
              onOpenApp={(appId) => {
                if (appId === AGENT_OFFICE_CAPABILITY.id) {
                  void openAgentOffice();
                  return;
                }
                if (appId === "core.office") {
                  setZone("office");
                  return;
                }
                if (appId === "core.projects") {
                  void openProject();
                  return;
                }
                const contribution = pluginNavigationById.get(appId);
                const plugin = contribution
                  ? pluginsRef.current?.find((candidate) => candidate.name === contribution.plugin)
                  : undefined;
                const panel = contribution
                  ? plugin?.panels?.find((candidate) => candidate.id === contribution.panelId)
                  : undefined;
                if (contribution && panel) void openPanel(contribution.plugin, panel);
              }}
              onStart={startFromWorkbench}
              onPickFiles={pickComposerFiles}
              onPickDirectory={pickComposerDirectory}
              onPasteImages={persistPastedImages}
              onDropPaths={classifyDroppedComposerAttachments}
              onOpenProject={() => void openProject()}
            />
          </div>
        ) : (
          <div className="center dim">{t("pickSession")}</div>
        )
      ) : (
        <>
          <ConversationTimeline
            items={items}
            busy={!!busy[active]}
            taskState={taskStates[active]}
            displayMode={executionViewMode}
            bottomRef={bottomRef}
            t={t}
            onRewind={(index) => void rewindHere(index)}
            onApproval={(approvalId, verdict) =>
              void answer(active, approvalId, verdict).catch((error) =>
                setErr(String(error?.message ?? error)),
              )
            }
          />
          {(queue[active!] ?? []).length > 0 && (
            <div className="steerq">
              {(queue[active!] ?? []).map((queued, i) => (
                <div key={i} className="steer-item">
                  <span className="steer-txt">
                    {queued.text || (locale === "zh" ? "附件消息" : "Attachment message")}
                    {!!queued.attachments?.length && `  · ${queued.attachments.length} ${locale === "zh" ? "个上下文" : "items"}`}
                  </span>
                  {!busy[active!] && (
                    <button
                      className="linky"
                      aria-label={locale === "zh" ? "重试这条排队消息" : "Retry this queued message"}
                      title={locale === "zh" ? "重试" : "Retry"}
                      onClick={() => retryQueuedInput(active!, i)}
                    >
                      ↻
                    </button>
                  )}
                  <button
                    className="linky"
                    aria-label={locale === "zh" ? "取消这条排队消息" : "Cancel this queued message"}
                    title={locale === "zh" ? "取消排队" : "Cancel queued input"}
                    onClick={() => cancelQueuedInput(active!, i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="inputbar">
            {ac.open && (
              <div className="fileac">
                {ac.items.map((it, i) => (
                  <div key={it.v} className={`fitem ${i === ac.sel ? "on" : ""}`} onMouseDown={(e) => (e.preventDefault(), pickMention(it.v))}>
                    {ac.mode === "skill" ? `/${it.v}` : it.v}
                    {it.hint && <span className="fhint"> — {it.hint}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className={`composer-shell ${composerDragActive ? "drop-active" : ""}`}>
              {composerDragActive ? (
                <div className="workstarter-drop-note composer-drop-note" role="status">
                  <span aria-hidden="true">▱</span>
                  <strong>
                    {locale === "zh"
                      ? "松开后加入本轮上下文"
                      : "Drop to add these files to this turn"}
                  </strong>
                </div>
              ) : null}
              <div className="composer-context-row">
                {activeSession && (
                  <span
                    className="composer-workspace"
                    title={activeSession.cwd}
                  >
                    <span aria-hidden="true">▱</span>
                    {basename(activeSession.cwd)}
                    <span className="composer-workspace-label">
                      {locale === "zh" ? "工作区" : "workspace"}
                    </span>
                  </span>
                )}
                {activeComposerWorkObject && (
                  <span
                    className="composer-active-work-object"
                    data-kind={activeComposerWorkObject.surfaceKind}
                    title={activeComposerWorkObject.title}
                    aria-label={`${locale === "zh" ? "作用于" : "Targets"}: ${activeComposerWorkObject.title}`}
                  >
                    <span aria-hidden>↗</span>
                    <span className="composer-active-work-object-label">
                      {locale === "zh" ? "作用于" : "targets"}
                    </span>
                    <span className="composer-active-work-object-name">
                      {activeComposerWorkObject.title}
                    </span>
                  </span>
                )}
                {pendingAttachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className={`composer-attachment-chip ${attachment.kind}`}
                    title={attachment.path}
                  >
                    <span aria-hidden="true">
                      {attachment.kind === "image" ? "▧" : attachment.kind === "directory" ? "▱" : "▤"}
                    </span>
                    <span className="composer-attachment-name">{attachment.name}</span>
                    <button
                      className="composer-chip-remove"
                      aria-label={`${locale === "zh" ? "移除" : "Remove"} ${attachment.name}`}
                      onClick={() => updateComposerDraft(active, (draft) => ({
                        ...draft,
                        attachments: draft.attachments.filter((item) => item.id !== attachment.id),
                      }))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {activeReadOnlySession && (
                <div className="composer-readonly-warning" role="status">
                  <span>
                    <strong>{locale === "zh" ? "当前仅查看本地历史" : "Viewing local history only"}</strong>
                    <small>
                      {locale === "zh"
                        ? "原连接或模型当前不可用；历史仍保留在本机，尚未发送给其他连接。"
                        : "The original connection or model is unavailable. History remains local and has not been sent elsewhere."}
                    </small>
                  </span>
                  <button
                    className="linky"
                    onClick={() => {
                      setAttachmentMenuOpen(false);
                      setModelPickerOpen(true);
                    }}
                  >
                    {locale === "zh" ? "选择连接并携带上下文继续" : "Choose a connection and continue with context"}
                  </button>
                </div>
              )}
              {activeAttachmentIssue && (
                <div className="composer-capability-warning" role="status">
                  <span>{attachmentIssueText(locale, activeAttachmentIssue)}</span>
                  {(activeAttachmentIssue === "image-unsupported" || activeAttachmentIssue === "image-unknown") && (
                    <button
                      className="linky"
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        setModelPickerOpen(true);
                      }}
                    >
                      {locale === "zh" ? "选择模型" : "Choose model"}
                    </button>
                  )}
                </div>
              )}
              {activeModelUnavailable && activeModelInfo && (
                <div className="composer-capability-warning composer-model-warning" role="alert">
                  <span>
                    {locale === "zh"
                      ? `模型 ${activeModelInfo.current} 已不在当前连接的授权目录中，发送已暂停。`
                      : `Model ${activeModelInfo.current} is no longer in this connection's authorized catalog. Sending is paused.`}
                  </span>
                  <button
                    className="linky"
                    onClick={() => {
                      if (activeModelInfo.recommendedModel) {
                        void changeModel(activeModelInfo.recommendedModel, undefined);
                      } else {
                        setAttachmentMenuOpen(false);
                        setModelPickerOpen(true);
                      }
                    }}
                  >
                    {activeModelInfo.recommendedModel
                      ? (locale === "zh"
                          ? `切换到 ${activeModelInfo.recommendedModel}`
                          : `Switch to ${activeModelInfo.recommendedModel}`)
                      : (locale === "zh" ? "选择可用模型" : "Choose an available model")}
                  </button>
                </div>
              )}
              {pendingAttachments.some((attachment) => attachment.kind === "image")
                && activeModelInfo?.attachmentCapabilities?.image.mode === "vision-sidecar" && (
                  <div className="composer-capability-note">
                    {locale === "zh"
                      ? "当前模型不直接读取图片；Hara 会先生成文字说明后继续。若要最高保真，请改用原生支持图片的模型。"
                      : "The selected model does not read images directly. Hara will create a text description first; choose a model with native image input for maximum fidelity."}
                  </div>
                )}
              <div className="composer-input-row">
                <textarea
                  ref={inputRef}
                  value={input}
                  disabled={!!activeReadOnlySession}
                  placeholder={activeReadOnlySession
                    ? (locale === "zh"
                        ? "这是只读历史；请选择连接并复制上下文后继续"
                        : "Read-only history; choose a connection and copy context to continue")
                    : locale === "zh"
                      ? "描述要做什么；可粘贴图片，或用 + / @ 添加上下文…"
                      : "Describe the task; paste an image, or use + / @ to add context…"}
                  onPaste={(e) => void pasteImages(e)}
                  onCompositionStart={() => {
                    inputCompositionRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    inputCompositionRef.current = false;
                  }}
                  onChange={(e) => {
                    setInput(e.target.value);
                    trackComposer(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  }}
                  onKeyDown={(e) => {
                    // Enter commits an active CJK IME composition. Treating that key as a composer
                    // command either sends an unfinished message or selects an autocomplete result.
                    if (inputCompositionRef.current || isImeCompositionKey(e.nativeEvent)) return;
                    if (ac.open && ac.items.length > 0) {
                      if (e.key === "ArrowDown") return (e.preventDefault(), setAc((a) => ({ ...a, sel: (a.sel + 1) % a.items.length })));
                      if (e.key === "ArrowUp") return (e.preventDefault(), setAc((a) => ({ ...a, sel: (a.sel - 1 + a.items.length) % a.items.length })));
                      if (e.key === "Tab" || e.key === "Enter") return (e.preventDefault(), pickMention(ac.items[ac.sel].v));
                      if (e.key === "Escape") return (e.preventDefault(), setAc((a) => ({ ...a, open: false })));
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMsg();
                    }
                  }}
                />
                {active && busy[active] ? (
                  <button className="composer-send stop" onClick={() => void stopTurn(active)}>
                    {t("stop")}
                  </button>
                ) : (
                  <button
                    className="composer-send"
                    onClick={() => void sendMsg()}
                    disabled={!activeDraftCanSend}
                  >
                    {t("send")} <span aria-hidden="true">↑</span>
                  </button>
                )}
              </div>
              <div className="composer-toolbar">
                <div className="composer-popover-anchor">
                  <button
                    className="composer-tool-button"
                    disabled={!!activeReadOnlySession}
                    aria-expanded={attachmentMenuOpen}
                    onClick={() => {
                      setModelPickerOpen(false);
                      setAttachmentMenuOpen((open) => !open);
                    }}
                  >
                    <span aria-hidden="true">＋</span>
                    {locale === "zh" ? "添加上下文" : "Add context"}
                  </button>
                  {attachmentMenuOpen && (
                    <div className="composer-menu attachment-menu">
                      <button onClick={() => void attachPickedFiles("image")}>
                        <span aria-hidden="true">▧</span>
                        <span>
                          <strong>{locale === "zh" ? "选择图片" : "Choose images"}</strong>
                          <small>{locale === "zh" ? "支持 PNG、JPEG、GIF、WebP" : "PNG, JPEG, GIF, or WebP"}</small>
                        </span>
                      </button>
                      <button onClick={() => void attachPickedFiles("file")}>
                        <span aria-hidden="true">▤</span>
                        <span>
                          <strong>{locale === "zh" ? "选择文件" : "Choose files"}</strong>
                          <small>{locale === "zh" ? "文本直接读取；其他格式交给本地工具" : "Text is read locally; other formats use tools"}</small>
                        </span>
                      </button>
                      <button onClick={() => void attachPickedDirectory()}>
                        <span aria-hidden="true">▱</span>
                        <span>
                          <strong>{locale === "zh" ? "添加目录到本轮" : "Add folder to this turn"}</strong>
                          <small>{locale === "zh" ? "只建立有界清单，不整目录注入模型" : "Bounded inventory; never injects the whole folder"}</small>
                        </span>
                      </button>
                      <button onClick={() => {
                        setAttachmentMenuOpen(false);
                        void openProject();
                      }}>
                        <span aria-hidden="true">↗</span>
                        <span>
                          <strong>{locale === "zh" ? "打开为新项目" : "Open as a new project"}</strong>
                          <small>{locale === "zh" ? "切换持续工作区，而不是一次性附件" : "Switch the persistent workspace"}</small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                {activeSession && (
                  <div className="composer-popover-anchor model-anchor">
                    <button
                      className={`model-pill ${activeStagedModelChange ? "staged" : ""} ${activeModelUnavailable ? "unavailable" : ""}`}
                      aria-expanded={modelPickerOpen}
                      aria-label={locale === "zh" ? "选择模型" : "Choose a model"}
                      title={busy[active]
                        ? (locale === "zh" ? "当前轮保持不变；选择会用于下一轮" : "The current turn stays unchanged; selections apply to the next turn")
                        : undefined}
                      onClick={() => {
                        setAttachmentMenuOpen(false);
                        setModelPickerOpen((open) => !open);
                      }}
                    >
                      <span className="model-pill-main">{displayedModel}</span>
                      <span className={`model-route ${currentRouteIsPersonal ? "personal" : "managed"}`}>
                        {currentRouteLabel}
                      </span>
                      {activeStagedModelChange && (
                        <span className="model-next-turn">
                          {locale === "zh" ? "下一轮" : "Next turn"}
                        </span>
                      )}
                      <span aria-hidden="true">⌄</span>
                    </button>
                    {modelPickerOpen && (
                      <div className="composer-menu model-menu">
                        <div className="model-menu-head">
                          <strong>{locale === "zh" ? "选择模型" : "Choose a model"}</strong>
                          {(busy[active] || activeStagedModelChange) && (
                            <p className="model-menu-status" role="status">
                              {busy[active]
                                ? (locale === "zh"
                                    ? `本轮继续使用 ${activeSession.model}；这里的选择从下一轮生效。`
                                    : `This turn continues with ${activeSession.model}; choices here apply to the next turn.`)
                                : (locale === "zh"
                                    ? `正在应用 ${displayedModel}，发送前会再次确认。`
                                    : `Applying ${displayedModel}; Hara will confirm it again before sending.`)}
                            </p>
                          )}
                          {newSessionDefaultRoute && (
                            <p className="model-menu-route-notice" role="status">
                              {locale === "zh"
                                ? `当前会话仍绑定“${currentRouteLabel}”；新会话默认使用“${newSessionDefaultRoute.label}”。选择下方${newSessionDefaultRoute.kind === "organization" ? "企业" : "个人"}连接后，Hara 会先确认，再复制当前上下文继续。`
                                : `This conversation stays on “${currentRouteLabel}”; new conversations default to “${newSessionDefaultRoute.label}”. Choose a ${newSessionDefaultRoute.kind === "organization" ? "managed" : "personal"} connection below; Hara confirms before copying context to continue.`}
                            </p>
                          )}
                          <input
                            autoFocus
                            value={modelSearch}
                            onChange={(event) => setModelSearch(event.target.value)}
                            placeholder={locale === "zh" ? "搜索模型或供应商" : "Search models or providers"}
                          />
                        </div>
                        <div className="model-menu-list">
                          {visibleModelEntries.map((entry) => (
                            <button
                              key={entry.id}
                              className={entry.id === displayedModel ? "selected" : ""}
                              aria-current={entry.id === displayedModel ? "true" : undefined}
                              onClick={() => void changeModel(entry.id, undefined)}
                            >
                              <span className="model-row-copy">
                                <strong>{entry.id}</strong>
                                <small>
                                  {entry.providerId || (locale === "zh" ? "当前供应商" : "Current provider")}
                                  {" · "}
                                  {imageCapabilityText(locale, entry.attachmentCapabilities)}
                                </small>
                              </span>
                              <span className="model-row-state">
                                {entry.id === activeSession.model && (
                                  <small>{locale === "zh" ? "当前" : "Current"}</small>
                                )}
                                {entry.id === activeStagedModelChange?.model && (
                                  <strong>{locale === "zh" ? "下一轮" : "Next"}</strong>
                                )}
                                {!activeStagedModelChange && entry.id === activeSession.model && (
                                  <span aria-hidden="true">✓</span>
                                )}
                              </span>
                            </button>
                          ))}
                          {visiblePersonalConnectionRoutes.map((connection) => (
                            <section
                              className="model-route-group personal"
                              data-profile-id={connection.id}
                              key={connection.id}
                            >
                              <div className="model-route-heading">
                                <span>
                                  {locale === "zh" ? "个人连接" : "Personal"} · {connection.label}
                                </span>
                                <small>
                                  {connection.active
                                    ? (locale === "zh" ? "新会话默认" : "New-chat default")
                                    : connection.provider}
                                </small>
                              </div>
                              <button
                                type="button"
                                className="model-route-option"
                                onClick={() => void startPersonalConnectionSession(connection)}
                              >
                                <span className="model-row-copy">
                                  <strong>{connection.model}</strong>
                                  <small>
                                    {connection.label} · {locale === "zh" ? "个人直连" : "Direct"}
                                  </small>
                                </span>
                                <span className="model-row-state">
                                  <strong>{locale === "zh" ? "复制并继续" : "Copy & continue"}</strong>
                                </span>
                              </button>
                            </section>
                          ))}
                          {visibleOrganizationModelRoutes.map(({ connection, models }) => (
                            <section
                              className="model-route-group"
                              data-profile-id={connection.id}
                              key={connection.id}
                            >
                              <div className="model-route-heading">
                                <span>
                                  {locale === "zh" ? "企业连接" : "Organization"} · {connection.label}
                                </span>
                                <small>
                                  {connection.active
                                    ? (locale === "zh" ? "新会话默认" : "New-chat default")
                                    : connection.gatewayHost}
                                </small>
                              </div>
                              {models.map((model) => (
                                <button
                                  type="button"
                                  className="model-route-option"
                                  key={`${connection.id}:${model}`}
                                  onClick={() => void startOrganizationSession(connection, model)}
                                >
                                  <span className="model-row-copy">
                                    <strong>{model}</strong>
                                    <small>
                                      {connection.label} · {locale === "zh" ? "企业托管" : "Managed"}
                                    </small>
                                  </span>
                                  <span className="model-row-state">
                                    <strong>{locale === "zh" ? "复制并继续" : "Copy & continue"}</strong>
                                  </span>
                                </button>
                              ))}
                            </section>
                          ))}
                          {visibleModelEntries.length === 0
                            && visiblePersonalConnectionRoutes.length === 0
                            && visibleOrganizationModelRoutes.length === 0 && (
                            <div className="model-empty">
                              {locale === "zh" ? "没有匹配的模型" : "No matching models"}
                            </div>
                          )}
                        </div>
                        <button
                          className="model-manage"
                          onClick={() => {
                            setModelPickerOpen(false);
                            setSetSec("providers");
                            setZone("settings");
                          }}
                        >
                          {locale === "zh" ? "管理模型与连接…" : "Manage models and connections…"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {activeSession
                  && !isAutomated(activeSession)
                  && clientRef.current?.supports("session.set-approval") && (
                  <select
                    className={`approval-select${activeApproval === "full-auto" ? " is-full-auto" : ""}`}
                    aria-label={locale === "zh" ? "当前会话权限模式" : "Current conversation permission mode"}
                    title={locale === "zh"
                      ? "只影响当前会话；完全自动仍保留受保护路径、屏幕控制和外部扩展的安全授权。"
                      : "Affects this conversation only. Full auto keeps protected-path, screen-control, and external-extension security grants."}
                    value={activeApproval}
                    disabled={!!activeReadOnlySession || !!busy[activeSession.id]}
                    onChange={(event) => void changeApproval(event.target.value as ApprovalMode)}
                  >
                    <option value="suggest">{locale === "zh" ? "权限 · 逐次确认" : "Permissions · Ask"}</option>
                    <option value="auto-edit">{locale === "zh" ? "权限 · 自动编辑" : "Permissions · Auto edit"}</option>
                    <option value="full-auto">{locale === "zh" ? "权限 · 完全自动" : "Permissions · Full auto"}</option>
                  </select>
                )}
                {active && activeModelInfo && activeComposerEffortLevels.length > 0 && (
                  <select
                    className={`effort-select ${activeStagedModelChange ? "staged" : ""}`}
                    aria-label={locale === "zh" ? "思考强度" : "Reasoning effort"}
                    title={busy[active]
                      ? (locale === "zh" ? "当前轮保持不变；选择会用于下一轮" : "The current turn stays unchanged; selections apply to the next turn")
                      : undefined}
                    value={displayedEffort}
                    onChange={(e) => void changeModel(undefined, e.target.value)}
                  >
                    <option value="">{locale === "zh" ? "思考 · 自动" : "Thinking · Auto"}</option>
                    {activeComposerEffortLevels.map((level) => (
                      <option key={level} value={level}>
                        {locale === "zh" ? "思考" : "Thinking"} · {thinkingLabel(locale, level)}
                      </option>
                    ))}
                  </select>
                )}
                {activeStagedModelChange ? (
                  <span className="model-change-status" role="status">
                    {locale === "zh" ? "下一轮" : "Next"} · {activeStagedModelChange.model}
                    {" · "}
                    {locale === "zh" ? "思考" : "Thinking"} · {activeStagedModelChange.effort
                      ? thinkingLabel(locale, activeStagedModelChange.effort)
                      : (locale === "zh" ? "自动" : "Auto")}
                  </span>
                ) : active && busy[active] ? (
                  <span className="model-change-status quiet">
                    {locale === "zh" ? "运行中 · 可预选下一轮" : "Running · choose for next turn"}
                  </span>
                ) : null}
                {(() => {
                  const cx = active ? ctxMap[active] : undefined;
                  if (!cx || cx.pct <= 0) return null;
                  const heat = cx.pct >= 80 ? "hot" : cx.pct >= 60 ? "warm" : "";
                  return (
                    <span className={`ctxm ${heat}`} title={`${t("ctxTip")} — ${cx.lastInput.toLocaleString()} / ${cx.window.toLocaleString()} tokens`}>
                      <span className="ctxbar">
                        <span style={{ width: `${Math.min(cx.pct, 100)}%` }} />
                      </span>
                      {cx.pct}%
                      {cx.pct >= 50 && (
                        <button className="linky" disabled={!!busy[active]} onClick={() => void compactNow()}>
                          {t("compact")}
                        </button>
                      )}
                    </span>
                  );
                })()}
                <span className="composer-capability-summary">
                  {imageCapabilityText(locale, activeComposerAttachmentCapabilities)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );

  // The module dock is preference-driven. Core modules and enabled plugin work panels contribute stable
  // IDs; panel clicks still pass through project detection and the isolated local launcher. Notification
  // invariant: interruption (needs a human) → red dot; ambient (ran, left a trace) → count chip.
  const railLabelsById: Record<string, string> = {
    "core.chat": t("zoneWorkbench"),
    "core.tasks": t("zoneAuto"),
    "core.groups": t("zoneGroups"),
    "core.office": t("zoneOffice"),
  };
  const projectSessions = sessions.filter(
    (session) =>
      !isAssistantCwd(session.cwd)
      && !isAutomated(session)
      && !isJunkProjectDirectory(session.cwd),
  );
  const activeOrganizationConnection =
    groupsDirectory.organizations?.connections.find((connection) => connection.active);
  const activeOrganizationDesk = activeOrganizationConnection
    ? groupsDirectory.desk?.connections.find(
        (connection) => connection.profileId === activeOrganizationConnection.id,
      )
    : undefined;
  const pluginRailLabels = Object.fromEntries(
    pluginNavigation.map((contribution) => [contribution.id, contribution.title]),
  );
  const railItems: AppRailItem[] = visibleNavigation(
    navigationContributions,
    navigationPreferences,
  ).map((contribution) => {
    const pluginContribution = pluginNavigationById.get(contribution.id);
    let badge: AppRailItem["badge"];
    if (
      contribution.id === "core.chat"
      && (manualUnreadIn(azAll) || manualUnreadIn(projectSessions))
    ) {
      badge = { kind: "dot" };
    } else if (contribution.target === "auto" && autoUnread > 0) {
      badge = { kind: "count", count: autoUnread };
    }
    return {
      id: contribution.id,
      label: railLabelsById[contribution.id] ?? pluginRailLabels[contribution.id] ?? contribution.id,
      icon: contribution.icon,
      shortcut: "shortcut" in contribution
        ? contribution.shortcut
        : undefined,
      active: pluginContribution
        ? zone === "projects"
          && extensionDockState.tabs.some((tab) =>
            tab.type === "legacy-panel"
            && tab.plugin === pluginContribution.plugin
            && tab.panelId === pluginContribution.panelId
            && tab.owner.sessionId === active)
        : contribution.id === "core.chat"
          ? zone === "chat" || zone === "projects"
          : zone === contribution.target,
      badge,
    };
  });
  const rail = (
    <AppRail
      activePlace={zone}
      items={railItems}
      labels={{
        mainNavigation: t("mainNavigation"),
        settings: t("zoneSettings"),
        updateAvailable: t("updateAvail"),
      }}
      updateAvailable={updAvail}
      onSelect={(id) => {
        const contribution = CORE_NAVIGATION_CONTRIBUTIONS.find(
          (item) => item.id === id,
        );
        if (contribution) {
          setZone(contribution.id === "core.chat"
            ? (zoneRef.current === "chat" || zoneRef.current === "projects"
                ? zoneRef.current
                : workbenchPlaceRef.current)
            : contribution.target);
          return;
        }
        const pluginContribution = pluginNavigationById.get(id);
        const plugin = pluginsRef.current?.find(
          (candidate) => candidate.enabled && candidate.name === pluginContribution?.plugin,
        );
        const panel = plugin?.panels?.find(
          (candidate) => candidate.id === pluginContribution?.panelId,
        );
        if (plugin && panel) {
          const existing = extensionDockState.tabs.find((tab) =>
            tab.type === "legacy-panel"
            && tab.plugin === plugin.name
            && tab.panelId === panel.id
            && tab.owner.sessionId === activeByZoneRef.current.projects);
          if (existing) {
            if (!discardCurrentExtensionDraft()) return;
            setExtensionDockState((state) => activateExtensionTab(state, existing.id));
            if (!setZone("projects")) return;
          } else {
            void openPanel(plugin.name, panel);
          }
        }
      }}
      onIntent={(id) => {
        const contribution = CORE_NAVIGATION_CONTRIBUTIONS.find(
          (item) => item.id === id,
        );
        if (contribution) preloadPlace(contribution.id === "core.chat"
          ? workbenchPlaceRef.current
          : contribution.target);
        else if (pluginNavigationById.has(id)) warmModule(loadExtensionDock());
      }}
      onSelectSettings={() => setZone("settings")}
      onIntentSettings={() => preloadSettingsSection(setSec)}
    />
  );
  const footBar = (
    <div className="foot">
      <span className="dim" title={`${t("engineVersion")} ${server?.version ?? "—"}`}>
        {t("engineShort")} {server?.version ?? "—"}
      </span>
      <span className="dim foot-route" title={`${server?.provider ?? ""}:${server?.model ?? ""}`}>
        {server?.provider}:{server?.model}
      </span>
    </div>
  );
  const brandBar = (
    <div className="brand">
      <HaraLogo size={20} /> <span className="wordmark">Hara</span>{" "}
      <span className="ver" title={t("desktopVersion")}>
        {desktopVersion || "…"}
      </span>
    </div>
  );
  const clearArtifactSurface = () => {
    artifactOpenRequestRef.current += 1;
    setArtifactBusy("");
    setActiveArtifact(null);
    setActivePresentation(null);
    setPresentationPreviewHtml(null);
    setArtifactRevisions([]);
    setArtifactValidationReport(null);
    setArtifactExportReceipt(null);
  };
  const loadArtifactExtension = async (tab: ArtifactExtension | PresentationBrowserExtension) => {
    const client = clientRef.current;
    if (!client) return;
    const requestId = ++artifactOpenRequestRef.current;
    const owner = tab.owner;
    const ownerStillVisible = () => owner.place === "office"
      ? zoneRef.current === "office"
      : zoneRef.current === owner.place && activeRef.current === owner.sessionId;
    let nativePresentation = tab.type === "presentation-browser";
    setArtifactBusy("open");
    setErr("");
    try {
      const base = await client.getArtifact(owner.artifactId);
      nativePresentation = nativePresentation || isNativePresentation(base);
      const presentationRevisionId = owner.revisionId;
      const [revisionResult, list, presentationSurface] = await Promise.all([
        client.listArtifactRevisions(owner.artifactId),
        client.listArtifacts(),
        nativePresentation
          ? loadPresentationSurface(client, owner.artifactId, presentationRevisionId)
          : Promise.resolve(null),
      ]);
      if (
        requestId !== artifactOpenRequestRef.current
        || clientRef.current !== client
        || !ownerStillVisible()
      ) return;
      const presentation = presentationSurface?.details ?? null;
      const preview = presentationSurface?.preview ?? null;
      const resolved = presentation ?? base;
      setArtifacts(list ?? "old-server");
      setActiveArtifact(resolved);
      setActivePresentation(presentation);
      setPresentationPreviewHtml(preview?.html ?? null);
      setArtifactRevisions(revisionResult.revisions);
      setArtifactValidationReport(null);
      setArtifactExportReceipt(null);
      setExtensionDockState((state) => updateExtensionTab(state, tab.id, (current) => {
        if (current.type === "presentation-browser") {
          return {
            ...current,
            title: safeSurfaceTitle(
              `${resolved.artifact.title} · ${makeT(locale)("extensionBrowser")}`,
              makeT(locale)("extensionBrowser"),
            ),
            owner: {
              ...current.owner,
              revisionId: resolved.currentRevision.revisionId,
            },
          };
        }
        const sessionOwner = owner.place === "office"
          ? undefined
          : { place: owner.place, sessionId: owner.sessionId, cwd: owner.cwd };
        return {
          ...artifactExtensionFor(resolved, sessionOwner),
          mode: current.mode,
          ...(current.dirty ? { dirty: true } : {}),
        };
      }));
      if (presentation && owner.place !== "office") {
        push(owner.sessionId, (items) => [...items, {
          kind: "notice",
          text: presentationSurface?.recoveredLatest
            ? makeT(locale)("presentationReloadedLatest")
            : locale === "zh"
              ? "Desktop 已加载精确版本，演示文稿现在已在右侧打开。"
              : "Desktop loaded the exact revision. The presentation is now open on the right.",
        }]);
      }
    } catch (error: any) {
      if (requestId === artifactOpenRequestRef.current) {
        setErr(makeT(locale)(nativePresentation
          ? presentationErrorKey(error)
          : "artifactOpenFailed"));
      }
    } finally {
      if (requestId === artifactOpenRequestRef.current) setArtifactBusy("");
    }
  };
  const selectExtensionTab = (tabId: string) => {
    const tab = extensionDockState.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    if (
      contextExtensionDock
      && contextExtensionDock.id !== tabId
      && contextExtensionDock.dirty
      && !window.confirm(locale === "zh"
        ? "当前标签有未保存的更改。要放弃这些更改并切换标签吗？"
        : "The current tab has unsaved changes. Discard them and switch tabs?")
    ) return;
    setExtensionDockState((state) => {
      const clean = contextExtensionDock?.dirty
        ? updateExtensionTab(state, contextExtensionDock.id, (current) => ({ ...current, dirty: false }))
        : state;
      return activateExtensionTab(clean, tabId);
    });
    revealExtensionItem(tab);
    if (tab.type === "artifact" || tab.type === "presentation-browser") {
      void loadArtifactExtension(tab);
      return;
    }
    clearArtifactSurface();
    setExtensionLoading(tab.type === "legacy-panel" || tab.type === "web-preview");
  };
  const closeDockTab = (tabId: string) => {
    const tab = extensionDockState.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    if (tab.dirty && !window.confirm(locale === "zh" ? "此标签有未保存的更改，仍要关闭吗？" : "This tab has unsaved changes. Close it anyway?")) {
      return;
    }
    let next = closeExtensionTab(extensionDockState, tabId);
    let nextVisible: ExtensionDockItem | null = null;
    if (contextExtensionDock?.id === tabId && extensionContext) {
      const remaining = extensionTabsForContext(next, extensionContext);
      nextVisible = remaining[remaining.length - 1] ?? null;
      next = { ...next, activeId: nextVisible?.id ?? null };
    }
    setExtensionDockState(next);
    const closedContextKey = extensionItemContextKey(tab);
    if (!next.tabs.some((candidate) => extensionItemContextKey(candidate) === closedContextKey)) {
      setHiddenExtensionContexts((current) => {
        if (!current.has(closedContextKey)) return current;
        const cleaned = new Set(current);
        cleaned.delete(closedContextKey);
        return cleaned;
      });
    }
    if (nextVisible?.type === "artifact" || nextVisible?.type === "presentation-browser") {
      void loadArtifactExtension(nextVisible);
    } else if (
      (tab.type === "artifact" || tab.type === "presentation-browser")
      && contextExtensionDock?.id === tabId
    ) clearArtifactSurface();
  };
  const popOutVisualExtension = (item: LegacyPanelExtension | WebPreviewExtension) => {
    try {
      new WebviewWindow(`panel-${item.id}-${Date.now() % 100000}`, {
        url: item.url,
        title: `Hara — ${item.title}`,
        width: 1100,
        height: 780,
      });
      closeDockTab(item.id);
    } catch (error: any) {
      setErr(String(error?.message ?? error));
    }
  };
  const openWorkbenchTool = (tool: WorkbenchToolKind) => {
    const session = active ? sessions.find((candidate) => candidate.id === active) : null;
    const place = session ? sessionPlace(session) : null;
    if (!session || (place !== "chat" && place !== "projects") || zone !== place) return;
    const labels: Record<WorkbenchToolKind, string> = {
      terminal: t("extensionTerminal"),
      browser: t("extensionBrowser"),
      files: t("extensionFiles"),
    };
    const item: WorkbenchToolExtension = {
      type: "workbench-tool",
      tool,
      id: workbenchToolTabId(session.id, tool),
      title: labels[tool],
      surfaceKind: tool,
      owner: { place, sessionId: session.id, cwd: session.cwd },
      mode: "docked",
    };
    warmModule(Promise.all([loadExtensionDock(), loadWorkbenchToolSurface()]));
    setExtensionLoading(false);
    offerExtensionTab(item);
  };
  const offerWorkforceForSession = (session: SessionInfo) => {
    const place = sessionPlace(session);
    if (place !== "chat" && place !== "projects") return;
    const item: WorkforceExtension = {
      type: "workforce",
      id: workforceTabId(session.id),
      title: t("extensionWorkforce"),
      surfaceKind: "workforce",
      owner: { place, sessionId: session.id, cwd: session.cwd },
      mode: "docked",
    };
    warmModule(Promise.all([loadExtensionDock(), loadWorkforceSurface()]));
    setExtensionLoading(false);
    offerExtensionTab(item);
  };
  const openWorkforce = () => {
    const session = active ? sessions.find((candidate) => candidate.id === active) : null;
    const place = session ? sessionPlace(session) : null;
    if (!session || (place !== "chat" && place !== "projects") || zone !== place) return;
    offerWorkforceForSession(session);
  };
  const openAgentOffice = async () => {
    let session = activeRef.current
      ? sessionsRef.current.find((candidate) => candidate.id === activeRef.current)
      : undefined;
    const currentPlace = session ? sessionPlace(session) : null;
    if (session && (currentPlace === "chat" || currentPlace === "projects")) {
      if (!setZone(currentPlace)) return;
      await openSession(session.id);
    } else {
      const sessionId = await openAssistant();
      session = sessionId
        ? sessionsRef.current.find((candidate) => candidate.id === sessionId)
        : undefined;
    }
    if (session) offerWorkforceForSession(session);
  };
  const openExtensionItem = (item: ExtensionDockAddKind) => {
    if (item === "workforce") openWorkforce();
    else openWorkbenchTool(item);
  };
  const extensionContext: ExtensionContext | null = zone === "office"
    ? { place: "office" }
    : (zone === "chat" || zone === "projects")
      ? { place: zone, sessionId: active }
      : null;
  const contextExtensionTabs = extensionContext
    ? extensionTabsForContext(extensionDockState, extensionContext)
    : [];
  const contextExtensionDock = extensionContext
    ? activeExtensionTabForContext(extensionDockState, extensionContext)
    : null;
  const activeExtensionContextKey = extensionContext
    ? extensionContextKey(extensionContext)
    : null;
  const contextExtensionScreenVisible = Boolean(
    contextExtensionDock
    && activeExtensionContextKey
    && !hiddenExtensionContexts.has(activeExtensionContextKey),
  );
  const setCurrentExtensionScreenVisible = (visible: boolean) => {
    if (!activeExtensionContextKey) return;
    setHiddenExtensionContexts((current) => {
      const hidden = current.has(activeExtensionContextKey);
      if (hidden === !visible) return current;
      const next = new Set(current);
      if (visible) next.delete(activeExtensionContextKey);
      else next.add(activeExtensionContextKey);
      return next;
    });
  };
  const toggleCurrentExtensionScreen = () => {
    if (!contextExtensionDock) return;
    setCurrentExtensionScreenVisible(!contextExtensionScreenVisible);
  };
  const panelExtension = contextExtensionDock?.type === "legacy-panel"
    ? contextExtensionDock
    : null;
  const webPreviewExtension = contextExtensionDock?.type === "web-preview"
    ? contextExtensionDock
    : null;
  const artifactExtension = contextExtensionDock?.type === "artifact"
    && activeArtifact?.artifact.artifactId === contextExtensionDock.owner.artifactId
      ? contextExtensionDock
      : null;
  const sessionArtifactExtension = contextExtensionDock?.type === "artifact"
    && contextExtensionDock.owner.place !== "office"
      ? contextExtensionDock
      : null;
  const presentationBrowserExtension = contextExtensionDock?.type === "presentation-browser"
    ? contextExtensionDock
    : null;
  const workbenchToolExtension = contextExtensionDock?.type === "workbench-tool"
    ? contextExtensionDock
    : null;
  const reviewExtension = contextExtensionDock?.type === "review"
    ? contextExtensionDock
    : null;
  const workforceExtension = contextExtensionDock?.type === "workforce"
    ? contextExtensionDock
    : null;
  const dockTabs = contextExtensionTabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    kind: tab.surfaceKind,
    dirty: tab.dirty,
  }));
  const extensionKindLabel = (kind: ExtensionSurfaceKind): string => {
    if (kind === "presentation") return t("artifactTypePresentation");
    if (kind === "spreadsheet") return t("artifactTypeSpreadsheet");
    if (kind === "document") return t("artifactTypeDocument");
    if (kind === "design") return t("extensionDesign");
    if (kind === "browser") return t("extensionBrowser");
    if (kind === "terminal") return t("extensionTerminal");
    if (kind === "files") return t("extensionFiles");
    if (kind === "review") return t("extensionReview");
    if (kind === "workforce") return t("extensionWorkforce");
    return t("extensionCapability");
  };
  const extensionCopy = {
    extension: t("extensionScreen"),
    resize: t("extensionResize"),
    maximize: t("extensionMaximize"),
    restore: t("extensionRestore"),
    popOut: t("openInWindow"),
    hide: t("extensionHide"),
    close: t("extensionTabClose"),
    add: t("extensionAdd"),
  };
  const extensionAddItems = activeSession
    && (zone === "chat" || zone === "projects")
    && sessionPlace(activeSession) === zone
      ? [
        { id: "workforce" as const, label: t("extensionWorkforce") },
        { id: "terminal" as const, label: t("extensionTerminal") },
        { id: "browser" as const, label: t("extensionBrowser") },
        { id: "files" as const, label: t("extensionFiles") },
      ]
    : [];
  const workforceTaskState = workforceExtension
    ? taskStates[workforceExtension.owner.sessionId]
    : undefined;
  const exactWorkforceState = workforceExtension
    ? workforceStates[workforceExtension.owner.sessionId]
    : undefined;
  const workforceSnapshot = workforceExtension
    ? (exactWorkforceState
      && (!workforceTaskState || exactWorkforceState.turnId === workforceTaskState.turnId)
      && !(workforceTaskState && !taskStateIsLive(workforceTaskState.state) && workforceHasLiveActors(exactWorkforceState))
      ? exactWorkforceState
      : workforceFromTask(workforceExtension.owner.sessionId, workforceTaskState))
    : undefined;
  const workforceCopy = {
    title: t("workforceTitle"),
    subtitle: t("workforceSubtitle"),
    live: t("workforceLive"),
    compatibility: t("workforceCompatibility"),
    three: t("workforceThree"),
    threeHint: t("workforceThreeHint"),
    threeUnavailable: t("workforceThreeUnavailable"),
    scene: t("workforceScene"),
    list: t("workforceList"),
    overview: t("workforceOverview"),
    focus: t("workforceFocus"),
    noTask: t("workforceNoTask"),
    noTaskHint: t("workforceNoTaskHint"),
    returnToChat: t("workforceReturnToChat"),
    root: t("workforceRoot"),
    specialist: t("workforceSpecialist"),
    status: t("workforceStatus"),
    capability: t("workforceCapability"),
    updated: t("workforceUpdated"),
    privacy: t("workforcePrivacy"),
    loading: t("loading"),
    states: {
      queued: t("workforceStateQueued"),
      working: t("workforceStateWorking"),
      waiting: t("workforceStateWaiting"),
      paused: t("workforceStatePaused"),
      blocked: t("workforceStateBlocked"),
      completed: t("workforceStateCompleted"),
      failed: t("workforceStateFailed"),
      cancelled: t("workforceStateCancelled"),
    },
    capabilities: {
      orchestration: t("workforceCapabilityOrchestration"),
      files: t("workforceCapabilityFiles"),
      code: t("workforceCapabilityCode"),
      browser: t("workforceCapabilityBrowser"),
      research: t("workforceCapabilityResearch"),
      design: t("workforceCapabilityDesign"),
      office: t("workforceCapabilityOffice"),
      communication: t("workforceCapabilityCommunication"),
      other: t("workforceCapabilityOther"),
    },
  };
  const openBrowserFromTool = (item: WorkbenchToolExtension, address: string): string | null => {
    const preview = webPreviewExtensionFor(address, t("extensionBrowser"), item.owner);
    if (!preview) return t("extensionBrowserInvalid");
    setExtensionDockState((state) => upsertExtensionTab(closeExtensionTab(state, item.id), preview));
    revealExtensionItem(preview);
    setExtensionLoading(true);
    return null;
  };
  const composeFromExtension = (text: string) => {
    if (!active) return;
    setInput((current) => current.trim() ? `${current.trim()}\n${text}` : text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const runCommandFromExtension = (command: string) => {
    if (!active) return;
    const prompt = locale === "zh"
      ? `请在当前项目终端运行下面的命令，遵循现有审批规则，并返回实际输出：\n\n\`\`\`sh\n${command}\n\`\`\``
      : `Run the following command in the current project terminal, following the existing approval policy, and return the actual output:\n\n\`\`\`sh\n${command}\n\`\`\``;
    void sendText(active, prompt).catch((error) => setErr(String(error?.message ?? error)));
  };
  const setExtensionMode = (itemId: string, mode: ExtensionDockMode) => {
    setExtensionDockState((state) => updateExtensionTab(
      state,
      itemId,
      (current) => ({ ...current, mode }),
    ));
  };
  const officeHomeSurface = (
    <Suspense
      fallback={(
        <main className="office-home" aria-busy="true">
          <p className="dim" role="status">{t("loading")}</p>
        </main>
      )}
    >
      <OfficeHome
        importing={artifactBusy === "import"}
        creating={assistantCreating}
        extensionCount={contextExtensionTabs.length}
        extensionVisible={contextExtensionScreenVisible}
        onImport={(kind) => void importArtifactFile(kind)}
        onCreatePresentation={(template) => void startPresentationWorkbench(template)}
        onToggleExtension={toggleCurrentExtensionScreen}
        copy={{
          eyebrow: t("officeEyebrow"),
          title: t("officeTitle"),
          description: t("officeDescription"),
          included: t("officeIncluded"),
          localFirst: t("officeLocalFirst"),
          importFile: t("importFile"),
          newPresentation: t("presentationNew"),
          creatingPresentation: t("presentationCreating"),
          importType: t("officeImportType"),
          importing: t("artifactImporting"),
          templatesTitle: t("presentationTemplatesTitle"),
          templatesHint: t("presentationTemplatesHint"),
          templatePitch: t("presentationTemplatePitch"),
          templatePitchHint: t("presentationTemplatePitchHint"),
          templateReport: t("presentationTemplateReport"),
          templateReportHint: t("presentationTemplateReportHint"),
          templateTechnical: t("presentationTemplateTechnical"),
          templateTechnicalHint: t("presentationTemplateTechnicalHint"),
          templateVisual: t("presentationTemplateVisual"),
          templateVisualHint: t("presentationTemplateVisualHint"),
          presentation: t("artifactTypePresentation"),
          presentationHint: t("officePresentationHint"),
          presentationFormats: t("officePresentationFormats"),
          spreadsheet: t("artifactTypeSpreadsheet"),
          spreadsheetHint: t("officeSpreadsheetHint"),
          spreadsheetFormats: t("officeSpreadsheetFormats"),
          document: t("artifactTypeDocument"),
          documentHint: t("officeDocumentHint"),
          documentFormats: t("officeDocumentFormats"),
          safetyTitle: t("officeSafetyTitle"),
          safetyHint: t("officeSafetyHint"),
          extensionScreen: t("extensionScreen"),
          extensionShow: t("extensionShow"),
          extensionHide: t("extensionHide"),
        }}
      />
    </Suspense>
  );
  const presentationEditorTabId = activePresentation
    && contextExtensionDock?.type === "artifact"
    && contextExtensionDock.owner.artifactId === activePresentation.artifact.artifactId
      ? contextExtensionDock.id
      : null;
  const artifactWorkbenchSurface = activePresentation ? (
    <Suspense
      fallback={(
        <main className="presentation-workbench" aria-busy="true">
          <p className="dim" role="status">{t("loading")}</p>
        </main>
      )}
    >
      <PresentationWorkbench
        details={activePresentation}
        previewHtml={presentationPreviewHtml}
        loading={artifactBusy === "open" || presentationPreviewHtml === null}
        saving={artifactBusy === "save"}
        verifying={artifactBusy === "verify"}
        exporting={artifactBusy === "export"}
        validationReport={artifactValidationReport}
        exportReceipt={artifactExportReceipt}
        onRenderDraft={renderActivePresentationDraft}
        onSave={saveActivePresentation}
        onDirtyChange={(dirty) => {
          if (!presentationEditorTabId) return;
          setExtensionDockState((state) => updateExtensionTab(
            state,
            presentationEditorTabId,
            (current) => current.dirty === dirty ? current : { ...current, dirty },
          ));
        }}
        onVerify={() => void verifyActiveArtifact()}
        onExport={(format) => void exportActiveArtifact(format)}
        onOpenBrowser={() => void openPresentationInBrowser()}
        onImportAnother={() => void importArtifactFile("presentation")}
        onChooseImage={choosePresentationImage}
        copy={{
          presenter: t("presentationPresenter"),
          exactPreview: t("presentationExactPreview"),
          loading: t("presentationPreviewLoading"),
          openBrowser: t("presentationOpenBrowser"),
          verify: t("artifactVerify"),
          verifying: t("artifactVerifying"),
          verified: t("artifactVerified"),
          exportPptx: t("presentationExportPptx"),
          exportHtml: t("presentationExportHtml"),
          exportJson: t("presentationExportJson"),
          exportPdf: t("presentationExportPdf"),
          exporting: t("artifactExporting"),
          importAnother: t("artifactImportAnother"),
          slides: t("presentationSlides"),
          local: t("artifactLocal"),
          browserPrint: t("presentationBrowserPrint"),
          noOverwrite: t("artifactNoOverwrite"),
          receipt: t("artifactExportReceipt"),
          edit: t("presentationEdit"),
          present: t("presentationPresent"),
          save: t("presentationSave"),
          saving: t("presentationSaving"),
          saved: t("presentationSaved"),
          unsaved: t("presentationUnsaved"),
          addSlide: t("presentationAddSlide"),
          duplicateSlide: t("presentationDuplicateSlide"),
          deleteSlide: t("presentationDeleteSlide"),
          moveUp: t("presentationMoveUp"),
          moveDown: t("presentationMoveDown"),
          deckTitle: t("presentationDeckTitle"),
          theme: t("presentationTheme"),
          themeEditorial: t("presentationThemeEditorial"),
          themeMidnight: t("presentationThemeMidnight"),
          themeSignal: t("presentationThemeSignal"),
          themeCalm: t("presentationThemeCalm"),
          template: t("presentationTemplate"),
          templatePitch: t("presentationTemplatePitch"),
          templateReport: t("presentationTemplateReport"),
          templateTechnical: t("presentationTemplateTechnical"),
          templateVisual: t("presentationTemplateVisual"),
          takeaway: t("presentationTakeaway"),
          claim: t("presentationClaim"),
          notes: t("presentationNotes"),
          inspector: t("presentationInspector"),
          inspectorShow: t("presentationInspectorShow"),
          inspectorHide: t("presentationInspectorHide"),
          blocks: t("presentationBlocks"),
          addBlock: t("presentationAddBlock"),
          deleteBlock: t("presentationDeleteBlock"),
          blockType: t("presentationBlockType"),
          content: t("presentationContent"),
          chooseImage: t("presentationChooseImage"),
          imageAlt: t("presentationImageAlt"),
          chartType: t("presentationChartType"),
          chartTitle: t("presentationChartTitle"),
          chartCategories: t("presentationChartCategories"),
          chartSeries: t("presentationChartSeries"),
          chartValues: t("presentationChartValues"),
          addSeries: t("presentationChartAddSeries"),
          removeSeries: t("presentationChartRemoveSeries"),
          applyJson: t("presentationApplyJson"),
          invalidJson: t("presentationInvalidJson"),
          previewError: t("presentationPreviewError"),
          previewFrameLabel: t("presentationPreviewFrameLabel"),
          layoutIssueCount: t("presentationLayoutIssueCount"),
          layoutIssueImpact: t("presentationLayoutIssueImpact"),
          layoutIssuePage: t("presentationLayoutIssuePage"),
          layoutIssueLocate: t("presentationLayoutIssueLocate"),
          layoutIssueTechnicalDetails: t("presentationLayoutIssueTechnicalDetails"),
          layoutIssueUnknown: t("presentationLayoutIssueUnknown"),
          layoutIssueContentOverflow: t("presentationLayoutIssueContentOverflow"),
          layoutIssueTitleOverlap: t("presentationLayoutIssueTitleOverlap"),
          layoutIssueFooterOverlap: t("presentationLayoutIssueFooterOverlap"),
          layoutIssueSafeArea: t("presentationLayoutIssueSafeArea"),
          layoutIssueBlockOverlap: t("presentationLayoutIssueBlockOverlap"),
          layoutIssueStructureMissing: t("presentationLayoutIssueStructureMissing"),
          qualityIssueCount: t("presentationQualityIssueCount"),
          qualityIssueImpact: t("presentationQualityIssueImpact"),
          qualityIssueDuplicateMessage: t("presentationQualityIssueDuplicateMessage"),
          qualityIssueRepeatedTitle: t("presentationQualityIssueRepeatedTitle"),
          qualityIssueGenericHeading: t("presentationQualityIssueGenericHeading"),
          qualityIssueRedundantHeading: t("presentationQualityIssueRedundantHeading"),
          qualityIssueDuplicateBody: t("presentationQualityIssueDuplicateBody"),
          qualityIssueRepetitiveComposition: t("presentationQualityIssueRepetitiveComposition"),
          qualityIssueVisualMonotony: t("presentationQualityIssueVisualMonotony"),
          qualityFixDuplicateMessage: t("presentationQualityFixDuplicateMessage"),
          qualityFixRepeatedTitle: t("presentationQualityFixRepeatedTitle"),
          qualityFixGenericHeading: t("presentationQualityFixGenericHeading"),
          qualityFixRedundantHeading: t("presentationQualityFixRedundantHeading"),
          qualityFixDuplicateBody: t("presentationQualityFixDuplicateBody"),
          qualityFixRepetitiveComposition: t("presentationQualityFixRepetitiveComposition"),
          qualityFixVisualMonotony: t("presentationQualityFixVisualMonotony"),
        }}
      />
    </Suspense>
  ) : activeArtifact ? (
    <Suspense
      fallback={(
        <main className={`artifact-workbench${artifactExtension?.mode === "docked" ? " is-embedded" : ""}`} aria-busy="true">
          <p className="dim" role="status">{t("loading")}</p>
        </main>
      )}
    >
      <ArtifactWorkbench
        embedded={artifactExtension?.mode === "docked"}
        details={activeArtifact}
        revisions={artifactRevisions}
        verifying={artifactBusy === "verify"}
        exporting={artifactBusy === "export"}
        validationReport={artifactValidationReport}
        exportReceipt={artifactExportReceipt}
        onVerify={() => void verifyActiveArtifact()}
        onExport={() => void exportActiveArtifact()}
        onImportAnother={() => void importArtifactFile()}
        copy={{
          workbench: t("artifactWorkbench"),
          local: t("artifactLocal"),
          safeImport: t("artifactSafeImport"),
          safeImportHint: t("artifactSafeImportHint"),
          previewPending: t("artifactPreviewPending"),
          verify: t("artifactVerify"),
          verifying: t("artifactVerifying"),
          verified: t("artifactVerified"),
          unverified: t("artifactUnverified"),
          validationReport: t("artifactValidationReport"),
          export: t("artifactExport"),
          exporting: t("artifactExporting"),
          exported: t("artifactExported"),
          exportReceipt: t("artifactExportReceipt"),
          roundtrip: t("artifactRoundtrip"),
          noOverwrite: t("artifactNoOverwrite"),
          importAnother: t("artifactImportAnother"),
          currentVersion: t("artifactCurrentVersion"),
          fileType: t("artifactFileType"),
          size: t("artifactSize"),
          integrity: t("artifactIntegrity"),
          history: t("artifactHistory"),
          nextStage: t("artifactNextStage"),
          nextStageHint: t("artifactNextStageHint"),
          typePresentation: t("artifactTypePresentation"),
          typeSpreadsheet: t("artifactTypeSpreadsheet"),
          typeDocument: t("artifactTypeDocument"),
        }}
      />
    </Suspense>
  ) : null;
  const presentationBrowserSurface = presentationBrowserExtension
    && activePresentation?.artifact.artifactId === presentationBrowserExtension.owner.artifactId
    && activePresentation.currentRevision.revisionId === presentationBrowserExtension.owner.revisionId
    && presentationPreviewHtml
      ? (
        <Suspense fallback={<div className="center dim" role="status">{t("loading")}</div>}>
          <EmbeddedBrowserSurface
            title={activePresentation.artifact.title}
            artifactId={presentationBrowserExtension.owner.artifactId}
            revisionId={presentationBrowserExtension.owner.revisionId}
            html={presentationPreviewHtml}
            copy={{
              browser: t("extensionBrowser"),
              local: t("artifactLocal"),
              reload: t("extensionBrowserReload"),
            }}
          />
        </Suspense>
      )
      : null;
  const officeExtension = contextExtensionDock?.owner.place === "office"
    ? contextExtensionDock
    : null;
  const officeExtensionSurface = officeExtension?.type === "artifact"
    ? artifactWorkbenchSurface
    : officeExtension?.type === "presentation-browser"
      ? presentationBrowserSurface
      : null;
  const updateNoticeVersion = pendingDesktopUpdateRef.current?.version || updAvail;
  const updatePercent = updateProgress?.total
    ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
    : null;
  const showUpdateNotice =
    updateNoticeVisible &&
    (Boolean(updateNoticeVersion) || updating || updateReady || updateTone === "error") &&
    !(zone === "settings" && setSec === "engine");

  return (
    <div className="app">
      {rail}
      {err && (
        <div className="ready-error" role="alert">
          <span>{err}</span>
          <button
            className="ghost"
            aria-label={locale === "zh" ? "关闭错误提示" : "Dismiss error"}
            onClick={() => setErr("")}
          >
            ×
          </button>
        </div>
      )}
      {showUpdateNotice && (
        <section
          className={`desktop-update-notice ${updateTone === "error" ? "is-error" : updateReady ? "is-ready" : ""}`}
          aria-labelledby="desktop-update-notice-title"
          aria-live="polite"
        >
          <div className="desktop-update-seal" aria-hidden="true">
            ↑
          </div>
          <div className="desktop-update-copy">
            <div className="desktop-update-meta">
              <span>{t("desktopUpdateLabel")}</span>
              {updateNoticeVersion && <b>v{updateNoticeVersion}</b>}
            </div>
            <strong id="desktop-update-notice-title">
              {updateReady
                ? t("updateReadyTitle")
                : updating
                  ? t("updateDownloadingTitle")
                  : updateTone === "error"
                    ? t("updateFailedTitle")
                    : t("updateNoticeTitle")}
            </strong>
            <p>
              {updateReady
                ? t("updateNoticeReadyBody")
                : updating
                  ? t("updateDownloadingBody")
                  : updateTone === "error"
                    ? `${t("updateFailureHint")}${upd ? ` ${upd}` : ""}`
                    : t("updateNoticeBody")}
            </p>
            {updating && (
              <div
                className={`desktop-update-progress ${updatePercent === null ? "indeterminate" : ""}`}
                role="progressbar"
                aria-label={t("updateProgressLabel")}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(updatePercent === null ? {} : { "aria-valuenow": updatePercent })}
              >
                <span style={{ width: updatePercent === null ? "32%" : `${updatePercent}%` }} />
              </div>
            )}
            {upd && (updateReady || updateTone === "warning") && (
              <small className="desktop-update-status">{upd}</small>
            )}
            <div className="desktop-update-actions">
              {updateReady ? (
                <button type="button" disabled={updating} onClick={() => void restartForUpdate()}>
                  {t("restartNow")}
                </button>
              ) : updateTone === "error" ? (
                <button type="button" disabled={updating} onClick={() => void downloadDesktopUpdate()}>
                  {t("updateRetry")}
                </button>
              ) : !updating ? (
                <button type="button" onClick={() => void downloadDesktopUpdate()}>
                  {t("updateNow")}
                </button>
              ) : null}
              {!updating && (
                <button type="button" className="ghost" onClick={deferDesktopUpdate}>
                  {t("updateLater")}
                </button>
              )}
              <button type="button" className="linky" onClick={openDesktopUpdateSettings}>
                {t("updateDetails")}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── context list (switches with the rail) ── */}
      {(zone === "chat" || zone === "projects") && (
        <aside className="sidebar workbench-sidebar">
          {brandBar}
          <div className="workbench-sidebar-actions">
            <button
              className="new withicon"
              disabled={assistantCreating}
              onClick={() => void startNewAssistantConversation()}
            >
              <span className="new-conversation-plus" aria-hidden>＋</span>
              {assistantCreating ? t("startingConversation") : t("newConversation")}
            </button>
            <button className="new ghost" onClick={() => void openProject()}>
              {t("openProject")}
            </button>
          </div>
          {searchBox}
          <div className="sessions" key="workbench">
            <div className="group-h artifact-shelf-head workbench-context-head">
              {t("workbenchPersonal")}
              <span className="count">{azAll.length}</span>
            </div>
            {/* Personal and project sessions share one index, but selecting a row first enters the
                row's isolated execution context. They never share active-session authority. */}
            {az.current && sessRow({ ...az.current, title: t("assistant") })}
            {azBots.length > 0 && <div className="chandiv">{t("extChannels")}</div>}
            {azBots.map((s) => (
              <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openWorkbenchSession(s)}>
                <div className="title">
                  {busy[s.id] && <span className="live">●</span>}
                  {unread[s.id] && <span className="dot" />}
                  <span className="botlab">{s.sourceName || "bot"}</span> {botTitle(s) || t("untitled")}
                </div>
                <div className="meta">{s.updatedAt ? fmtTime(s.updatedAt) : t("newLabel")}</div>
              </div>
            ))}
            {az.history.length > 0 && (
              <>
                <div className="group-h" onClick={() => toggleGroup("__history")}>
                  <span className="caret">{collapsed["__history"] === false ? "▾" : "▸"}</span> {t("history")}
                  <span className="count">{az.history.length}</span>
                </div>
                {collapsed["__history"] === false && az.history.filter((s) => hit(s.title)).map(sessRow)}
              </>
            )}

            <div className="group-h artifact-shelf-head workbench-context-head">
              {t("zoneProjects")}
              <span className="count">{groups.length}</span>
            </div>
            {groups.map(([cwd, list]) => (
              <div key={cwd}>
                <div className="group-h" title={cwd} onClick={() => toggleGroup(cwd)}>
                  <span className="caret">{collapsed[cwd] ? "▸" : "▾"}</span> {basename(cwd)}
                  <span className="count">{list.length}</span>
                  {collapsed[cwd] && manualUnreadIn(list) && <span className="dot" />}
                  <button
                    type="button"
                    className="project-remove"
                    title={t("removeProject")}
                    aria-label={`${t("removeProject")}：${basename(cwd)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeProjectFromList(cwd);
                    }}
                  >
                    <span aria-hidden>×</span>
                  </button>
                </div>
                {!collapsed[cwd] && (
                  <>
                    {sortPinned(list).map(sessRow)}
                    <div
                      className="newhere"
                      onClick={() => {
                        if (!setZone("projects")) return;
                        void newSession(cwd);
                      }}
                    >
                      {t("newHere")}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {footBar}
        </aside>
      )}

      {zone === "office" && (
        <aside className="sidebar office-sidebar">
          {brandBar}
          <div className="artifact-sidebar-actions">
            <button
              className="new"
              onClick={() => void importArtifactFile()}
              disabled={Boolean(artifactBusy)}
            >
              {artifactBusy === "import" ? t("artifactImporting") : t("importFile")}
            </button>
          </div>
          <div className="sessions" key={zone}>
            <div className="group-h artifact-shelf-head">
              {t("deliverables")}
              <span className="count">
                {artifacts && artifacts !== "old-server" ? artifacts.artifacts.length : 0}
              </span>
            </div>
            {artifacts === "old-server" ? (
              <div className="artifact-sidebar-empty">{t("artifactNeedsUpdate")}</div>
            ) : artifacts?.artifacts.length ? (
              artifacts.artifacts.map((artifact) => (
                <button
                  type="button"
                  className={`artifact-sidebar-card ${activeArtifact?.artifact.artifactId === artifact.artifactId ? "on" : ""}`}
                  key={artifact.artifactId}
                  onClick={() => void openArtifact(artifact.artifactId)}
                  title={artifact.title}
                >
                  <span className={`artifact-sidebar-mark ${artifact.kind}`} />
                  <span className="artifact-sidebar-copy">
                    <strong>{artifact.title}</strong>
                    <small>
                      {artifact.kind === "presentation"
                        ? t("artifactTypePresentation")
                        : artifact.kind === "spreadsheet"
                          ? t("artifactTypeSpreadsheet")
                          : t("artifactTypeDocument")}
                      {" · "}
                      {artifact.extension.toUpperCase().slice(1)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <div className="artifact-sidebar-empty">
                {artifacts ? t("noDeliverables") : t("loading")}
              </div>
            )}
            {artifacts !== "old-server" && artifacts && artifacts.invalid > 0 && (
              <div className="artifact-sidebar-empty" role="alert">
                {t("artifactNeedsRepair")}
              </div>
            )}
          </div>
          {footBar}
        </aside>
      )}

      {zone === "auto" && (
        <div className="sidebar automation-sidebar-shell">
          {brandBar}
          {auto === "old-server" ? (
            <div className="autohint dim">{t("autoNeedsUpdate")}</div>
          ) : (
            <Suspense
              fallback={(
                <div className="autohint dim" role="status">{t("loading")}</div>
              )}
            >
              <AutomationSidebar
                copy={locale === "en" ? AUTOMATION_COPY_EN : undefined}
                jobs={auto?.jobs ?? null}
                sessions={auto?.sessions ?? null}
                scheduler={auto?.scheduler}
                view={autoView}
                onViewChange={(next) => {
                  setAutoView(next);
                  setAutoReplay(null);
                  markAutoSeen();
                }}
              />
            </Suspense>
          )}
          {footBar}
        </div>
      )}

      {zone === "groups" ? (
        <Suspense
          fallback={(
            <aside className="sidebar groups-sidebar">
              {brandBar}
              <div className="groups-sidebar-status">
                <span className="groups-status-light" aria-hidden />
                <span>{t("loading")}</span>
              </div>
              <div className="groups-sidebar-space" />
              {footBar}
            </aside>
          )}
        >
          <GroupsContextSidebar
            brand={brandBar}
            footer={footBar}
            copy={groupsCopy}
            directory={groupsDirectory}
            state={groupsState}
            switchingProfileId={groupsSwitchingProfileId || undefined}
            onSelectOrganization={selectGroupsOrganization}
            onRetryDirectory={() => void refreshGroupsDirectory()}
            onManageOrganizations={() => {
              setZone("settings");
              setSetSec("providers");
            }}
          />
        </Suspense>
      ) : null}

      {zone === "settings" && (
        <aside className="sidebar">
          {brandBar}
          <nav className="sessions setlist" key={zone} aria-label={t("settingsNavigation")}>
            {(
              [
                {
                  label: t("settingsGroupGeneral"),
                  items: [
                    ["providers", t("setProviders")],
                    ["engine", t("setServer")],
                    ["security", t("setSecurity")],
                    ["lang", t("setLang")],
                  ],
                },
                {
                  label: t("settingsGroupCapabilities"),
                  items: [
                    ["modules", t("setModules")],
                    ["pets", t("setPets")],
                    ["capabilities", t("setCapabilities")],
                  ],
                },
              ] as const
            ).map((group, groupIndex) => (
              <div
                className="setnav-group"
                role="group"
                aria-labelledby={`settings-nav-group-${groupIndex}`}
                key={group.label}
              >
                <div className="setnav-label" id={`settings-nav-group-${groupIndex}`}>
                  {group.label}
                </div>
                {group.items.map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    className={`setnav ${setSec === k ? "on" : ""}`}
                    aria-current={setSec === k ? "page" : undefined}
                    onMouseEnter={() => preloadSettingsSection(k)}
                    onFocus={() => preloadSettingsSection(k)}
                    onClick={() => setSetSec(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {footBar}
        </aside>
      )}

      {/* ── main area ── */}
      {zone === "settings" ? (
        // ⚙ configure place — context column picked a group, the stage renders its forms
        <div className="chat board automation-board">
          <div className="scroll boardpad setstage">
            {setSec === "providers" && (
              <SettingsPage
                id="settings-provider-title"
                eyebrow={t("settingsSystem")}
                title={t("setProviders")}
                description={t("providerSettingsDescription")}
              >
                <Suspense
                  fallback={(
                    <div className="settings-empty" role="status">
                      {t("loading")}
                    </div>
                  )}
                >
                  <ProviderSettings
                    embedded
                    client={clientRef.current}
                    cwd={activeSession?.cwd ?? server?.cwd}
                    scope={activeSession ? "workspace" : "global"}
                    locale={locale}
                    engineNeedsRestart={engineVersionNeedsAttention}
                    engineRestarting={engineRestarting}
                    onRestartEngine={() => void restartBundledEngine()}
                    onSaved={(next: ProviderSettingsState) => {
                      setProviderRoutes(next);
                      setSetupRequired(!next.current.authenticated);
                      setServer((current) => current
                        ? { ...current, provider: next.current.provider, model: next.current.model }
                        : current);
                      void refreshGroupsDirectory();
                      void refreshOrganizationRoutes(activeSession?.cwd ?? server?.cwd).catch(() => {});
                      void refreshModelInfo(active
                        ? { sessionId: active }
                        : { cwd: server?.cwd }).catch(() => {});
                    }}
                  />
                  <GatewaySettings client={clientRef.current} locale={locale} />
                </Suspense>
              </SettingsPage>
            )}
            {setSec === "engine" && (
              <SettingsPage
                id="settings-engine-title"
                eyebrow={t("settingsSystem")}
                title={t("setServer")}
                description={t("engineDescription")}
              >
                <SettingsCard
                  title={t("versionTitle")}
                  description={t("versionDescription")}
                >
                  <SettingsItem
                    title={t("desktopVersion")}
                    description={t("desktopVersionHint")}
                  >
                    <SettingsBadge>{desktopVersion || "…"}</SettingsBadge>
                  </SettingsItem>
                  <SettingsItem
                    title={t("engineVersion")}
                    description={t("engineVersionHint")}
                  >
                    <SettingsBadge
                      tone={
                        engineVersionState === "matching"
                          ? "success"
                          : engineVersionNeedsAttention
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {server?.version || "…"}
                    </SettingsBadge>
                  </SettingsItem>
                  <SettingsItem title={t("activeModel")} description={t("activeModelHint")}>
                    <span className="settings-mono">{server?.provider}:{server?.model}</span>
                  </SettingsItem>
                  {server?.version && engineVersionNeedsAttention && (
                    <SettingsNotice
                      tone="warning"
                      title={t("engineMismatchTitle")}
                      actions={
                        <button
                          type="button"
                          className="compact"
                          disabled={engineRestarting || Object.values(busy).some(Boolean)}
                          onClick={() => void restartBundledEngine()}
                        >
                          {engineRestarting ? t("engineRestarting") : t("engineRestartNow")}
                        </button>
                      }
                    >
                      {t("engineMismatchHint")} {BUNDLED_ENGINE_VERSION}
                    </SettingsNotice>
                  )}
                  {server?.version && engineVersionState === "newer" && (
                    <SettingsNotice tone="neutral" title={t("engineNewerTitle")}>
                      {t("engineNewerHint")} {BUNDLED_ENGINE_VERSION}
                    </SettingsNotice>
                  )}
                </SettingsCard>

                <SettingsCard
                  title={t("cliTitle")}
                  description={t("cliDescription")}
                  aside={
                    commandLineHara ? (
                      <SettingsBadge
                        tone={
                          commandLineHara.current && commandLineHara.managed
                            ? "success"
                            : commandLineHara.installed || commandLineHara.blocked
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {commandLineHara.blocked
                          ? t("cliBlocked")
                          : !commandLineHara.available
                            ? t("cliUnavailable")
                            : commandLineHara.current && commandLineHara.managed
                              ? t("cliCurrent")
                              : commandLineHara.current
                                ? t("cliManual")
                              : commandLineHara.installed
                                ? t("cliNeedsUpdate")
                                : t("cliNotInstalled")}
                      </SettingsBadge>
                    ) : undefined
                  }
                >
                  <SettingsItem title={t("cliBundledVersion")} description={t("cliBundledVersionHint")}>
                    <div className="settings-choice">
                      <SettingsBadge>{commandLineHara?.bundledVersion || BUNDLED_ENGINE_VERSION}</SettingsBadge>
                      <button
                        type="button"
                        className="ghost"
                        disabled={
                          commandLineBusy ||
                          !commandLineHara ||
                          (commandLineHara.current && commandLineHara.managed) ||
                          commandLineHara.blocked ||
                          !commandLineHara.available
                        }
                        onClick={() => void installCommandLineHara()}
                      >
                        {commandLineBusy
                          ? t("cliInstalling")
                          : commandLineHara?.current && commandLineHara.managed
                            ? t("cliCurrent")
                            : commandLineHara?.current
                              ? t("cliManage")
                            : commandLineHara?.installed
                              ? t("cliUpdate")
                              : t("cliInstall")}
                      </button>
                    </div>
                  </SettingsItem>
                  <SettingsItem title={t("cliInstallPath")} description={t("cliInstallPathHint")}>
                    <span className="settings-mono">{commandLineHara?.path || "~/.hara/bin/hara"}</span>
                  </SettingsItem>
                  {commandLineHara?.blocked && (
                    <SettingsNotice tone="error" title={t("cliBlockedTitle")}>
                      {t("cliBlockedHint")}
                    </SettingsNotice>
                  )}
                  {commandLineHara?.available === false && !commandLineHara.blocked && (
                    <SettingsNotice tone="error" title={t("cliUnavailableTitle")}>
                      {t("cliUnavailableHint")}
                    </SettingsNotice>
                  )}
                  {commandLineNotice ? (
                    <SettingsNotice tone={commandLineTone} title={commandLineNotice}>
                      {commandLineTone === "success" ? t("cliPathReminder") : undefined}
                    </SettingsNotice>
                  ) : commandLineHara?.current && commandLineHara.managed ? (
                    <SettingsNotice tone="success" title={t("cliReadyTitle")}>
                      {t("cliPathReminder")}
                    </SettingsNotice>
                  ) : commandLineHara?.current ? (
                    <SettingsNotice tone="neutral" title={t("cliManualTitle")}>
                      {t("cliManualHint")}
                    </SettingsNotice>
                  ) : null}
                </SettingsCard>

                <SettingsCard
                  title={t("updatesTitle")}
                  description={t("updatesDescription")}
                  aside={
                    updAvail
                      ? <SettingsBadge tone="warning">{t("updateAvail")} · {updAvail}</SettingsBadge>
                      : undefined
                  }
                >
                  <SettingsItem title={t("automaticCheck")} description={t("automaticCheckHint")}>
                    <button
                      type="button"
                      className="ghost"
                      disabled={updating || updateReady}
                      onClick={() => void downloadDesktopUpdate()}
                    >
                      {updating ? t("workingUpdate") : t("checkUpdate")}
                    </button>
                  </SettingsItem>
                  {updateStorage?.supported && (
                    <>
                      <SettingsItem title={t("updateStorageTitle")} description={t("updateStorageHint")}>
                        <div className="settings-update-storage-control">
                          <SettingsBadge tone={updateStorage.managedEntries > 0 ? "warning" : "success"}>
                            {updateStorage.managedEntries > 0
                              ? `${updateStorage.managedEntries} · ${formatStorageBytes(updateStorage.managedBytes, locale)}`
                              : t("updateStorageEmpty")}
                          </SettingsBadge>
                          <button
                            type="button"
                            className="ghost"
                            disabled={updateStorageBusy || updateStorage.managedEntries === 0}
                            onClick={() => void cleanDesktopUpdateStorage()}
                          >
                            {updateStorageBusy ? t("updateStorageCleaning") : t("updateStorageClean")}
                          </button>
                        </div>
                      </SettingsItem>
                      <SettingsItem title={t("updateStoragePath")} description={t("updateStoragePathHint")}>
                        <span
                          className="settings-mono settings-update-storage-path"
                          title={updateStorage.directory}
                        >
                          {updateStorage.directory}
                        </span>
                      </SettingsItem>
                      {updateStorageNotice && (
                        <SettingsNotice tone={updateStorageNotice.tone} title={updateStorageNotice.title} />
                      )}
                      {(!updateStorage.scanComplete || updateStorage.protectedEntries > 0) && (
                        <SettingsNotice tone="warning" title={t("updateStorageProtectedTitle")}>
                          {t("updateStorageProtectedHint")}
                        </SettingsNotice>
                      )}
                    </>
                  )}
                  {updateReady ? (
                    <SettingsNotice
                      tone={updateTone}
                      title={
                        updateTone === "warning" || updateTone === "error"
                          ? t("restartBlockedTitle")
                          : t("updateReadyTitle")
                      }
                      actions={
                        <button type="button" disabled={updating} onClick={() => void restartForUpdate()}>
                          {t("restartNow")}
                        </button>
                      }
                    >
                      {upd || t("restartToApply")}
                    </SettingsNotice>
                  ) : upd ? (
                    <SettingsNotice tone={updateTone} title={upd} />
                  ) : null}
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "security" && (
              <SettingsPage
                id="settings-security-title"
                eyebrow={t("settingsSystem")}
                title={t("setSecurity")}
                description={t("securityDescription")}
              >
                <SettingsCard title={t("approvalTitleSetting")} description={t("approvalDescription")}>
                  <SettingsItem
                    title={t("defaultApprovalTitle")}
                    description={t("apprHint")}
                    htmlFor="hara-default-approval"
                  >
                  <select
                    id="hara-default-approval"
                    value={defaultApproval}
                    onChange={(e) => {
                      const approval = parseApprovalMode(e.target.value);
                      setDefaultApproval(approval);
                      localStorage.setItem("hara.approval", approval);
                    }}
                  >
                    <option value="">{t("approvalDefault")}</option>
                    <option value="suggest">{t("approvalSuggest")}</option>
                    <option value="auto-edit">{t("approvalAutoEdit")}</option>
                    <option value="full-auto">{t("approvalFullAuto")}</option>
                  </select>
                  </SettingsItem>
                  <SettingsNotice
                    tone={defaultApproval === "full-auto" ? "warning" : "neutral"}
                    title={defaultApproval === "full-auto" ? t("fullAutoWarning") : t("boundaryTitle")}
                  >
                    {defaultApproval === "full-auto" ? t("fullAutoWarningHint") : t("boundaryHint")}
                  </SettingsNotice>
                </SettingsCard>
                <SettingsCard
                  title={t("executionDisplayTitle")}
                  description={t("executionDisplayDescription")}
                >
                  <SettingsItem
                    title={t("executionDisplayTitle")}
                    description={
                      executionViewMode === "debug"
                        ? t("executionModeDebugHint")
                        : executionViewMode === "standard"
                          ? t("executionModeStandardHint")
                          : t("executionModeConciseHint")
                    }
                  >
                    <div
                      className="settings-choice"
                      role="radiogroup"
                      aria-label={t("executionDisplayTitle")}
                    >
                      {EXECUTION_VIEW_MODES.map((mode) => (
                        <button
                          type="button"
                          role="radio"
                          key={mode}
                          className={executionViewMode === mode ? "" : "ghost"}
                          aria-checked={executionViewMode === mode}
                          onClick={() => saveExecutionViewMode(mode)}
                        >
                          {mode === "debug"
                            ? t("executionModeDebug")
                            : mode === "standard"
                              ? t("executionModeStandard")
                              : t("executionModeConcise")}
                        </button>
                      ))}
                    </div>
                  </SettingsItem>
                  <SettingsNotice tone="neutral" title={t("executionPrivacyTitle")}>
                    {t("executionPrivacyHint")}
                  </SettingsNotice>
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "lang" && (
              <SettingsPage
                id="settings-language-title"
                eyebrow={t("settingsSystem")}
                title={t("setLang")}
                description={t("languageDescription")}
              >
                <SettingsCard title={t("displayLanguage")} description={t("displayLanguageHint")}>
                  <SettingsItem title={t("languageChoice")}>
                    <div className="settings-choice">
                      <button className={locale === "zh" ? "" : "ghost"} aria-pressed={locale === "zh"} onClick={() => locale !== "zh" && flipLocale()}>
                        中文
                      </button>
                      <button className={locale === "en" ? "" : "ghost"} aria-pressed={locale === "en"} onClick={() => locale !== "en" && flipLocale()}>
                        English
                      </button>
                    </div>
                  </SettingsItem>
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "modules" && (
              <ModuleDockSettings
                contributions={navigationContributions}
                preferences={navigationPreferences}
                labels={{
                  "core.chat": {
                    title: t("zoneWorkbench"),
                    description: t("moduleChatDescription"),
                  },
                  "core.tasks": {
                    title: t("zoneAuto"),
                    description: t("moduleTasksDescription"),
                  },
                  "core.groups": {
                    title: t("zoneGroups"),
                    description: t("moduleGroupsDescription"),
                  },
                  "core.office": {
                    title: t("zoneOffice"),
                    description: t("moduleOfficeDescription"),
                  },
                  ...Object.fromEntries(pluginNavigation.map((contribution) => [
                    contribution.id,
                    {
                      title: contribution.title,
                      description: [contribution.plugin, contribution.description]
                        .filter(Boolean)
                        .join(" · "),
                    },
                  ])),
                }}
                copy={{
                  eyebrow: t("settingsPersonalize"),
                  title: t("setModules"),
                  description: t("moduleDockDescription"),
                  cardTitle: t("moduleDockCardTitle"),
                  cardDescription: t("moduleDockCardDescription"),
                  core: t("moduleSourceCore"),
                  plugin: t("moduleSourcePlugin"),
                  visible: t("moduleVisible"),
                  hidden: t("moduleHidden"),
                  show: t("showModule"),
                  hide: t("hideModule"),
                  moveUp: t("moveModuleUp"),
                  moveDown: t("moveModuleDown"),
                  fixedTitle: t("moduleSettingsFixed"),
                  fixedDescription: t("moduleSettingsFixedHint"),
                }}
                onVisibilityChange={(id, visible) => {
                  saveNavigationPreferences((current) =>
                    withNavigationVisibility(
                      navigationContributions,
                      current,
                      id,
                      visible,
                    ));
                }}
                onMove={(id, direction) => {
                  saveNavigationPreferences((current) =>
                    moveNavigation(
                      navigationContributions,
                      current,
                      id,
                      direction,
                    ));
                }}
              />
            )}
            {setSec === "pets" && (
              <Suspense
                fallback={(
                  <div className="settings-empty" role="status">
                    {t("loading")}
                  </div>
                )}
              >
                <DesktopCompanionSettings
                  t={t}
                  awake={petAwake}
                  selector={petSelector}
                  catalog={petCatalog}
                  error={petCatalogError}
                  onToggleAwake={() => setPetAwake((awake) => !awake)}
                  onRefresh={() => void refreshPets()}
                  onSelect={setPetSelector}
                />
              </Suspense>
            )}
            {setSec === "capabilities" && (
              <Suspense
                fallback={(
                  <div className="settings-empty" role="status">
                    {t("loading")}
                  </div>
                )}
              >
                <CapabilityDirectory
                  plugins={plugins}
                  skills={skills}
                  isSkillCreating={assistantCreating}
                  isPanelBusy={(pluginName, panelId) =>
                    panelBusy === panelOperationKey(pluginName, panelId)}
                  core={[
                    { id: "core.chat", title: t("zoneWorkbench"), description: t("moduleChatDescription") },
                    { id: "core.tasks", title: t("zoneAuto"), description: t("moduleTasksDescription") },
                    { id: "core.groups", title: t("zoneGroups"), description: t("moduleGroupsDescription") },
                    { id: "core.office", title: t("zoneOffice"), description: t("moduleOfficeDescription") },
                    {
                      id: AGENT_OFFICE_CAPABILITY.id,
                      title: t("capabilityAgentOfficeTitle"),
                      description: t("capabilityAgentOfficeDescription"),
                    },
                  ]}
                  organization={activeOrganizationConnection ? {
                    label: activeOrganizationConnection.label,
                    model: activeOrganizationConnection.model,
                    deskConnected: activeOrganizationDesk?.configured === true,
                    deskHost: activeOrganizationDesk?.host,
                  } : undefined}
                  copy={{
                    eyebrow: t("settingsCapabilities"),
                    title: t("setCapabilities"),
                    description: t("capabilitiesDescription"),
                    search: t("capabilityDirectorySearch"),
                    hara: t("capabilitySourceHara"),
                    organization: t("capabilitySourceOrganization"),
                    market: t("capabilitySourceMarket"),
                    installed: t("capabilitySourceInstalled"),
                    mySkills: t("capabilitySourceSkills"),
                    included: t("capabilityIncluded"),
                    openCore: t("capabilityOpenCore"),
                    open: t("capabilityOpen"),
                    currentOrganization: t("capabilityCurrentOrganization"),
                    noOrganization: t("capabilityNoOrganization"),
                    noOrganizationHint: t("capabilityNoOrganizationHint"),
                    modelRoute: t("capabilityModelRoute"),
                    organizationDesk: t("capabilityOrganizationDesk"),
                    connected: t("capabilityConnected"),
                    notProvided: t("capabilityNotProvided"),
                    organizationCatalogHint: t("capabilityOrgCatalogHint"),
                    marketTitle: t("capabilityMarketTitle"),
                    marketHint: t("capabilityMarketHint"),
                    marketGateTitle: t("capabilityMarketGateTitle"),
                    marketGateHint: t("capabilityMarketGateHint"),
                    installedTitle: t("installedCapabilities"),
                    installedHint: t("installedCapabilitiesHint"),
                    loading: t("loading"),
                    empty: t("noCapabilities"),
                    installHint: t("capabilityInstallHint"),
                    recipes: t("capabilityRecipes"),
                    specialists: t("capabilitySpecialists"),
                    connections: t("capabilityConnections"),
                    enable: t("enableCapability"),
                    disable: t("disableCapability"),
                    enabled: t("enabled"),
                    disabled: t("disabled"),
                    showPanelInSidebar: t("showPanelInSidebar"),
                    hidePanelFromSidebar: t("hidePanelFromSidebar"),
                    noResults: t("capabilityNoResults"),
                    createSkill: t("createSkill"),
                    skillConversationStarting: t("skillConversationStarting"),
                    skillBuilderTitle: t("skillBuilderTitle"),
                    skillBuilderDescription: t("skillBuilderDescription"),
                    skillBuilderSafetyTitle: t("skillBuilderSafetyTitle"),
                    skillBuilderSafetyDescription: t("skillBuilderSafetyDescription"),
                    availableSkills: t("availableSkills"),
                    availableSkillsHint: t("availableSkillsHint"),
                    noSkills: t("noSkills"),
                    skillSourceProject: t("skillSourceProject"),
                    skillSourcePersonal: t("skillSourcePersonal"),
                    skillSourceCapability: t("skillSourceCapability"),
                  }}
                  onCreateSkill={() => void startSkillCreation()}
                  onOpenCore={(id) => {
                    if (id === AGENT_OFFICE_CAPABILITY.id) {
                      void openAgentOffice();
                    } else if (id === "core.chat") {
                      void openAssistant();
                    } else if (id === "core.tasks") {
                      setZone("auto");
                    } else if (id === "core.groups") {
                      setZone("groups");
                    } else if (id === "core.office") {
                      setZone("office");
                    }
                  }}
                  onTogglePlugin={(name, enabled) => void togglePlugin(name, enabled)}
                  onOpenPanel={(pluginName, panel) => void openPanel(pluginName, panel)}
                  panelInDock={(pluginName, panelId) => {
                    const id = pluginNavigationContributionId(pluginName, panelId);
                    const contribution = id ? pluginNavigationById.get(id) : undefined;
                    return Boolean(contribution && navigationIsVisible(contribution, navigationPreferences));
                  }}
                  onTogglePanelInDock={(pluginName, panelId, visible) => {
                    const id = pluginNavigationContributionId(pluginName, panelId);
                    if (!id || !pluginNavigationById.has(id)) return;
                    saveNavigationPreferences((current) =>
                      withNavigationVisibility(navigationContributions, current, id, visible));
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>
      ) : zone === "groups" ? (
        <Suspense
          fallback={(
            <main className="groups-stage">
              <div className="groups-stage-shell">
                <span className="groups-eyebrow">
                  {t("groupsEyebrow")}
                </span>
                <p className="dim">{t("loading")}</p>
              </div>
            </main>
          )}
        >
          <GroupsStage
            copy={groupsCopy}
            directory={groupsDirectory}
            state={groupsState}
            switchingProfileId={groupsSwitchingProfileId || undefined}
            onSelectOrganization={selectGroupsOrganization}
            onRetryDirectory={() => void refreshGroupsDirectory()}
            onManageOrganizations={() => {
              setZone("settings");
              setSetSec("providers");
            }}
            onReadBoard={(profileId, taskState) => void readGroupsBoard(profileId, taskState)}
            onOpenTask={(profileId, taskId) => void openGroupsTask(profileId, taskId)}
            onCloseTask={() => dispatchGroups({ type: "closeTask" })}
            onManageModules={() => {
              setZone("settings");
              setSetSec("modules");
            }}
            onHide={() => {
              saveNavigationPreferences((current) =>
                withNavigationVisibility(
                  navigationContributions,
                  current,
                  "core.groups",
                  false,
                ));
              setZone("settings");
              setSetSec("modules");
            }}
          />
        </Suspense>
      ) : zone === "auto" ? (
        // 🤖 the orchestration place — console density: job table on top, run timeline below;
        // a run opens as a READ-ONLY replay (fork is the only way to continue — automated
        // sessions never become live conversations here)
        <main className="chat board">
          {autoReplay ? (
            <>
              <div className="anchor">
                <button className="linky" onClick={() => setAutoReplay(null)}>
                  {t("backToBoard")}
                </button>
                <span className="botlab">{autoReplay.sourceName || "auto"}</span>
                <b className="rotitle">{autoReplay.title}</b>
                <span className="robadge">{t("readonlyAuto")}</span>
                <button className="paneltab" onClick={() => void continueManually()}>
                  ⑂ {t("forkFromHere")}
                </button>
              </div>
              <div className="scroll">
                {autoReplay.items.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="msg user ro">
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="msg assistant">
                      <Md text={m.text} />
                    </div>
                  ),
                )}
              </div>
            </>
          ) : auto === "old-server" ? (
            <div className="scroll boardpad">
              <div className="autohint dim">{t("autoNeedsUpdate")}</div>
            </div>
          ) : (
            <Suspense
              fallback={(
                <div className="scroll boardpad">
                  <div className="autohint dim" role="status">{t("loading")}</div>
                </div>
              )}
            >
              <AutomationsPage
                copy={locale === "en" ? AUTOMATION_COPY_EN : undefined}
                jobs={auto?.jobs ?? null}
                sessions={auto?.sessions ?? null}
                scheduler={auto?.scheduler}
                view={autoView}
                add={addAutomationDraft}
                update={updateAutomationDraft}
                run={runAutomationNow}
                toggle={toggleAutomation}
                delete={deleteAutomation}
                install={installAutomationScheduler}
                openReplay={openAutomationReplay}
              />
            </Suspense>
          )}
        </main>
      ) : zone === "office" ? (
        <div className={`extension-work office-extension-work${contextExtensionScreenVisible ? " has-visible-extension" : ""}${contextExtensionScreenVisible && contextExtensionDock?.mode === "maximized" ? " is-extension-maximized" : ""}`}>
          {!contextExtensionScreenVisible && (
            <div className="extension-primary">{officeHomeSurface}</div>
          )}
          {officeExtension && (
            <Suspense fallback={<aside className="extension-dock is-stage" aria-busy="true" />}>
              <ExtensionDock
                kind={officeExtension.surfaceKind}
                kindLabel={extensionKindLabel(officeExtension.surfaceKind)}
                title={officeExtension.title}
                source={t("extensionLocalCapability")}
                context={(officeExtension.type === "artifact" || officeExtension.type === "presentation-browser")
                  ? officeExtension.owner.revisionId.slice(-8).toUpperCase()
                  : "Office"}
                detail={activeArtifact?.artifact.dataResidency ?? "local"}
                mode={officeExtension.mode}
                placement="stage"
                loading={artifactBusy === "open" || (officeExtension.type === "presentation-browser"
                  ? !presentationBrowserSurface
                  : Boolean(activePresentation && !presentationPreviewHtml))}
                tabs={dockTabs}
                activeTabId={officeExtension.id}
                collapsed={!contextExtensionScreenVisible}
                copy={extensionCopy}
                onTabSelect={selectExtensionTab}
                onTabClose={closeDockTab}
                onModeChange={(mode) => setExtensionMode(officeExtension.id, mode)}
                onClose={() => setCurrentExtensionScreenVisible(false)}
              >
                {officeExtensionSurface}
              </ExtensionDock>
            </Suspense>
          )}
        </div>
      ) : (zone === "chat" || zone === "projects") && contextExtensionDock ? (
        <div className={`extension-work${contextExtensionScreenVisible ? " has-visible-extension" : ""}${contextExtensionScreenVisible && contextExtensionDock.mode === "maximized" ? " is-extension-maximized" : ""}`}>
          <div className="extension-primary">{conversation(zone === "chat" ? "im" : "ide")}</div>
          <Suspense fallback={<aside className="extension-dock is-docked" aria-busy="true" />}>
            <ExtensionDock
              kind={contextExtensionDock.surfaceKind}
              kindLabel={extensionKindLabel(contextExtensionDock.surfaceKind)}
              title={contextExtensionDock.title}
              source={panelExtension?.plugin ?? (webPreviewExtension ? "Node · localhost" : t("extensionLocalCapability"))}
              context={contextExtensionDock.owner.place === "office" ? "Office" : basename(contextExtensionDock.owner.cwd)}
              detail={panelExtension || webPreviewExtension
                ? publicPanelOrigin((panelExtension ?? webPreviewExtension)!.url) ?? t("extensionLocalCapability")
                : (sessionArtifactExtension ?? presentationBrowserExtension)?.owner.revisionId.slice(-8).toUpperCase()}
              mode={contextExtensionDock.mode}
              loading={contextExtensionDock.type === "artifact" || contextExtensionDock.type === "presentation-browser"
                ? artifactBusy === "open" || activeArtifact?.artifact.artifactId !== contextExtensionDock.owner.artifactId
                  || (contextExtensionDock.type === "presentation-browser" && !presentationBrowserSurface)
                : contextExtensionDock.type === "legacy-panel" || contextExtensionDock.type === "web-preview"
                  ? extensionLoading
                  : false}
              tabs={dockTabs}
              activeTabId={contextExtensionDock.id}
              collapsed={!contextExtensionScreenVisible}
              addItems={extensionAddItems}
              copy={extensionCopy}
              onTabSelect={selectExtensionTab}
              onTabClose={closeDockTab}
              onAddItem={openExtensionItem}
              onModeChange={(mode) => setExtensionMode(contextExtensionDock.id, mode)}
              onPopOut={panelExtension || webPreviewExtension
                ? () => popOutVisualExtension((panelExtension ?? webPreviewExtension)!)
                : undefined}
              onClose={() => setCurrentExtensionScreenVisible(false)}
            >
              {panelExtension && (
                <iframe
                  src={panelExtension.url}
                  title={panelExtension.title}
                  referrerPolicy="no-referrer"
                  onLoad={() => setExtensionLoading(false)}
                />
              )}
              {webPreviewExtension && (
                <iframe
                  src={webPreviewExtension.url}
                  title={webPreviewExtension.title}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
                  allow="clipboard-read; clipboard-write; fullscreen"
                  referrerPolicy="no-referrer"
                  onLoad={() => setExtensionLoading(false)}
                />
              )}
              {sessionArtifactExtension
                && activeArtifact?.artifact.artifactId === sessionArtifactExtension.owner.artifactId
                && artifactWorkbenchSurface}
              {presentationBrowserExtension && presentationBrowserSurface}
              {workforceExtension && (
                <WorkforceSurface
                  snapshot={workforceSnapshot}
                  locale={locale}
                  live={Boolean(clientRef.current?.supportsEvent("event.workforce_state"))}
                  copy={workforceCopy}
                  onReturnToChat={() => setCurrentExtensionScreenVisible(false)}
                />
              )}
              {(workbenchToolExtension || reviewExtension) && (
                <WorkbenchToolSurface
                  item={(workbenchToolExtension ?? reviewExtension)!}
                  client={clientRef.current}
                  items={transcripts[(workbenchToolExtension ?? reviewExtension)!.owner.sessionId] ?? []}
                  taskState={taskStates[(workbenchToolExtension ?? reviewExtension)!.owner.sessionId]}
                  onOpenBrowser={openBrowserFromTool}
                  onCompose={composeFromExtension}
                  onRunCommand={runCommandFromExtension}
                  copy={{
                    terminal: t("extensionTerminal"),
                    terminalHint: t("extensionTerminalHint"),
                    terminalEmpty: t("extensionTerminalEmpty"),
                    terminalCommand: t("extensionTerminalCommand"),
                    terminalSend: t("extensionTerminalSend"),
                    browser: t("extensionBrowser"),
                    browserHint: t("extensionBrowserHint"),
                    browserAddress: t("extensionBrowserAddress"),
                    browserOpen: t("extensionBrowserOpen"),
                    browserInvalid: t("extensionBrowserInvalid"),
                    files: t("extensionFiles"),
                    filesHint: t("extensionFilesHint"),
                    filesSearch: t("extensionFilesSearch"),
                    filesEmpty: t("extensionFilesEmpty"),
                    filesUse: t("extensionFilesUse"),
                    review: t("extensionReview"),
                    reviewHint: t("extensionReviewHint"),
                    reviewEmpty: t("extensionReviewEmpty"),
                    running: t("extensionRunning"),
                    ready: t("extensionReady"),
                  }}
                />
              )}
            </ExtensionDock>
          </Suspense>
        </div>
      ) : (
        conversation(zone === "chat" ? "im" : "ide")
      )}

    </div>
  );
}
