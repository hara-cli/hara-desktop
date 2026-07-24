import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { IconBot, IconEdit, IconFork, IconTrash } from "./icons";
import {
  buildAutomationSchedule,
  type AutomationScheduleDraft,
  type AutomationWeekday,
} from "./automation-schedule.js";
import "./Automations.css";

export type AutomationViewId = "tasks" | "attention" | "paused" | "runs";

export interface AutomationSchedule {
  kind?: "once" | "interval" | "daily" | "weekly" | "custom" | string;
  label?: string;
  expression?: string;
  cron?: string;
  everyMs?: number;
  runAt?: number | string;
  time?: string;
  weekdays?: number[];
}

export interface AutomationJob {
  id: string;
  name: string;
  description?: string;
  task?: string;
  taskPreview?: string;
  mode?: "print" | "org" | "command" | string;
  cwd?: string;
  workspaceLabel?: string;
  enabled?: boolean;
  schedule?: string | AutomationSchedule;
  /** Machine-readable value used by newer engines while `schedule` stays presentation text. */
  scheduleSpec?: string;
  scheduleLabel?: string;
  timezone?: string;
  tz?: string;
  nextRunAt?: number | string | null;
  nextRuns?: Array<number | string>;
  lastRunAt?: number | string | null;
  runningSince?: number | string | null;
  lastStatus?: "ok" | "error" | "running" | "timed_out" | string;
  lastDurationMs?: number;
  lastError?: string;
  consecutiveErrors?: number;
  deliver?: unknown;
  /** Redacted delivery summary returned by newer engines. */
  delivery?: {
    kind?: "none" | "feishu" | "weixin" | "telegram" | "webhook" | "other" | string;
    label?: string;
    mode?: "always" | "on-output" | "on-error" | string;
  };
  deliverMode?: "off" | "always" | "error" | "on-output" | "on-error" | string;
  alertAfter?: number;
  createdAt?: number | string;
}

export interface AutomationRun {
  id: string;
  jobId?: string;
  jobName?: string;
  sourceName?: string;
  title?: string;
  summary?: string;
  status?: "ok" | "error" | "running" | "timed_out" | string;
  startedAt?: number | string;
  updatedAt?: number | string;
  finishedAt?: number | string;
  durationMs?: number;
  unread?: boolean;
  needsAttention?: boolean;
  error?: string;
}

export interface AutomationScheduler {
  installed?: boolean;
  supported?: boolean;
  healthy?: boolean;
  status?: "ready" | "offline" | "degraded" | "installing" | string;
  issue?: string;
  detail?: string;
  lastTickAt?: number | string;
  platform?: string;
}

export interface AutomationDraft {
  name: string;
  task: string;
  description?: string;
  cwd?: string;
  mode: "print" | "org" | "command" | string;
  schedule: string;
  scheduleKind: "once" | "interval" | "daily" | "weekly" | "custom";
  timezone?: string;
  tz?: string;
  runAt?: string;
  interval?: {
    value: number;
    unit: "m" | "h" | "d";
  };
  time?: string;
  weekdays?: number[];
  deliver?: string;
  deliverMode?: "always" | "on-output" | "on-error";
  alertAfter?: number;
}

export interface AutomationCopy {
  title: string;
  subtitle: string;
  navLabel: string;
  allTasks: string;
  attention: string;
  paused: string;
  runs: string;
  newTask: string;
  searchPlaceholder: string;
  clearSearch: string;
  taskCount: string;
  attentionCount: string;
  upcoming: string;
  task: string;
  schedule: string;
  lastRun: string;
  nextRun: string;
  neverRun: string;
  noNextRun: string;
  workspace: string;
  delivery: string;
  timezone: string;
  runNow: string;
  edit: string;
  pause: string;
  resume: string;
  duplicate: string;
  delete: string;
  moreActions: string;
  openDetails: string;
  backToTasks: string;
  taskDetails: string;
  taskInstructions: string;
  recentRuns: string;
  openReplay: string;
  noRuns: string;
  noTasksTitle: string;
  noTasksBody: string;
  noFilteredTasksTitle: string;
  noFilteredTasksBody: string;
  schedulerReady: string;
  schedulerReadyBody: string;
  schedulerUnknown: string;
  schedulerUnknownBody: string;
  schedulerOffline: string;
  schedulerOfflineBody: string;
  schedulerMissing: string;
  schedulerMissingBody: string;
  installScheduler: string;
  lastChecked: string;
  statusScheduled: string;
  statusActive: string;
  statusRunning: string;
  statusPaused: string;
  statusAttention: string;
  statusCompleted: string;
  statusOffline: string;
  statusScheduledHelp: string;
  statusActiveHelp: string;
  statusRunningHelp: string;
  statusPausedHelp: string;
  statusAttentionHelp: string;
  statusCompletedHelp: string;
  statusOfflineHelp: string;
  resultOk: string;
  resultError: string;
  resultRunning: string;
  resultTimedOut: string;
  resultUnknown: string;
  createdDescriptionPrint: string;
  createdDescriptionOrg: string;
  createdDescriptionCommand: string;
  deliveryLocal: string;
  deliveryWebhook: string;
  deliveryExternal: string;
  errorLabel: string;
  close: string;
  cancel: string;
  back: string;
  continue: string;
  save: string;
  create: string;
  saving: string;
  createTitle: string;
  editTitle: string;
  duplicateTitle: string;
  createIntro: string;
  stepTask: string;
  stepSchedule: string;
  stepReview: string;
  taskName: string;
  taskNamePlaceholder: string;
  whatShouldRun: string;
  taskPromptPlaceholder: string;
  workingDirectory: string;
  workingDirectoryPlaceholder: string;
  executionMode: string;
  modePrint: string;
  modePrintHelp: string;
  modeOrg: string;
  modeOrgHelp: string;
  modeCommand: string;
  modeCommandHelp: string;
  whenShouldRun: string;
  cadenceOnce: string;
  cadenceInterval: string;
  cadenceDaily: string;
  cadenceWeekly: string;
  cadenceCustom: string;
  dateAndTime: string;
  every: string;
  minutes: string;
  hours: string;
  days: string;
  atTime: string;
  chooseDays: string;
  customSchedule: string;
  customScheduleHelp: string;
  timezoneHelp: string;
  advancedOptions: string;
  deliveryMode: string;
  deliveryTarget: string;
  deliveryTargetPlaceholder: string;
  deliveryTargetHelp: string;
  deliveryOff: string;
  deliveryAlways: string;
  deliveryOnOutput: string;
  deliveryOnError: string;
  alertAfter: string;
  alertAfterHelp: string;
  reviewTitle: string;
  reviewHelp: string;
  schedulePreview: string;
  taskRequired: string;
  nameRequired: string;
  scheduleRequired: string;
  deleteTitle: string;
  deleteBody: string;
  deleteWarning: string;
  deleteConfirm: string;
  deleting: string;
  operationFailed: string;
  runningAction: string;
  loading: string;
  unknown: string;
  today: string;
  tomorrow: string;
}

const DEFAULT_COPY: AutomationCopy = {
  title: "自动任务",
  subtitle: "让 Hara 在合适的时间替你运行工作，并把结果留在这里。",
  navLabel: "自动任务视图",
  allTasks: "全部任务",
  attention: "需要处理",
  paused: "已暂停",
  runs: "运行记录",
  newTask: "添加自动任务",
  searchPlaceholder: "搜索任务、说明或工作目录",
  clearSearch: "清除搜索",
  taskCount: "任务总数",
  attentionCount: "需要处理",
  upcoming: "即将运行",
  task: "任务",
  schedule: "计划",
  lastRun: "上次运行",
  nextRun: "下次运行",
  neverRun: "尚未运行",
  noNextRun: "暂无计划",
  workspace: "工作目录",
  delivery: "结果发送到",
  timezone: "时区",
  runNow: "立即运行",
  edit: "编辑",
  pause: "暂停",
  resume: "恢复",
  duplicate: "创建副本",
  delete: "删除",
  moreActions: "更多管理操作",
  openDetails: "查看任务详情",
  backToTasks: "返回任务列表",
  taskDetails: "任务详情",
  taskInstructions: "运行内容",
  recentRuns: "最近运行",
  openReplay: "查看运行",
  noRuns: "还没有运行记录。任务运行后，结果会出现在这里。",
  noTasksTitle: "还没有自动任务",
  noTasksBody: "告诉 Hara 要做什么、什么时候做，其余设置可以稍后调整。",
  noFilteredTasksTitle: "没有符合条件的任务",
  noFilteredTasksBody: "试试清除搜索，或者切换左侧筛选。",
  schedulerReady: "定时服务运行正常",
  schedulerReadyBody: "Hara 会按计划在本机触发任务。",
  schedulerUnknown: "正在确认定时服务",
  schedulerUnknownBody: "任务已经保存；连接服务后会显示最新运行状态。",
  schedulerOffline: "定时服务需要检查",
  schedulerOfflineBody: "任务不会按时触发，请检查本机服务后再试。",
  schedulerMissing: "需要安装定时服务",
  schedulerMissingBody: "安装一次后，即使 Desktop 没有打开，任务也能按计划运行。",
  installScheduler: "安装定时服务",
  lastChecked: "最近检查",
  statusScheduled: "等待首次运行",
  statusActive: "按计划运行",
  statusRunning: "正在运行",
  statusPaused: "已暂停",
  statusAttention: "需要处理",
  statusCompleted: "已完成",
  statusOffline: "服务离线",
  statusScheduledHelp: "任务已经准备好，会在下一个计划时间首次运行。",
  statusActiveHelp: "任务已启用，最近一次运行正常。",
  statusRunningHelp: "Hara 正在执行这个任务，完成后会更新结果。",
  statusPausedHelp: "任务保留在列表中，但不会自动运行。",
  statusAttentionHelp: "最近一次运行失败或超时，请查看错误并决定是否重试。",
  statusCompletedHelp: "这是一次性任务，计划的运行已经完成。",
  statusOfflineHelp: "任务已启用，但本机定时服务当前不可用。",
  resultOk: "成功",
  resultError: "失败",
  resultRunning: "运行中",
  resultTimedOut: "超时",
  resultUnknown: "无结果",
  createdDescriptionPrint: "定时向 Hara 发出指令，并把回答保存到运行记录。",
  createdDescriptionOrg: "定时处理 Org 工作流，并保留每次执行结果。",
  createdDescriptionCommand: "在指定工作目录运行命令，并记录输出和异常。",
  deliveryLocal: "仅保存在 Hara",
  deliveryWebhook: "Webhook（地址已隐藏）",
  deliveryExternal: "外部通知",
  errorLabel: "错误",
  close: "关闭",
  cancel: "取消",
  back: "上一步",
  continue: "继续",
  save: "保存更改",
  create: "创建任务",
  saving: "正在保存…",
  createTitle: "添加自动任务",
  editTitle: "编辑自动任务",
  duplicateTitle: "创建任务副本",
  createIntro: "先用一句话说清工作内容，再选择时间。高级设置并不是必填项。",
  stepTask: "工作内容",
  stepSchedule: "运行计划",
  stepReview: "确认",
  taskName: "任务名称",
  taskNamePlaceholder: "例如：每天整理项目进展",
  whatShouldRun: "希望 Hara 做什么？",
  taskPromptPlaceholder: "例如：读取这个项目今天的提交，整理成一份简短日报。",
  workingDirectory: "在哪个目录工作？",
  workingDirectoryPlaceholder: "可选，例如 /Users/me/project",
  executionMode: "如何执行",
  modePrint: "Hara 指令",
  modePrintHelp: "把内容交给 Hara 处理，适合总结、检查和信息整理。",
  modeOrg: "Org 工作流",
  modeOrgHelp: "处理 Org 文件中的任务或固定工作流。",
  modeCommand: "本地命令",
  modeCommandHelp: "直接运行命令，适合已有脚本；请确认命令来源可信。",
  whenShouldRun: "什么时候运行？",
  cadenceOnce: "仅一次",
  cadenceInterval: "每隔一段时间",
  cadenceDaily: "每天",
  cadenceWeekly: "每周",
  cadenceCustom: "自定义",
  dateAndTime: "日期和时间",
  every: "每隔",
  minutes: "分钟",
  hours: "小时",
  days: "天",
  atTime: "运行时间",
  chooseDays: "选择星期",
  customSchedule: "Cron 表达式",
  customScheduleHelp: "高级选项。示例：0 9 * * 1-5 表示工作日 09:00。",
  timezoneHelp: "所有时间都按这个时区计算。",
  advancedOptions: "高级选项",
  deliveryMode: "通知方式",
  deliveryTarget: "通知目标",
  deliveryTargetPlaceholder: "例如 feishu:群聊 ID 或 webhook:https://…",
  deliveryTargetHelp: "通知目标只在本机保存；保存后界面不会再次显示完整地址。",
  deliveryOff: "仅保存结果",
  deliveryAlways: "每次运行后通知",
  deliveryOnOutput: "有输出时通知",
  deliveryOnError: "仅失败时通知",
  alertAfter: "连续失败提醒阈值",
  alertAfterHelp: "连续失败达到这个次数后标记为需要处理。",
  reviewTitle: "确认任务设置",
  reviewHelp: "保存后仍可随时编辑、暂停、立即运行或复制。",
  schedulePreview: "计划说明",
  taskRequired: "请写下希望 Hara 执行的工作。",
  nameRequired: "请给任务起一个容易识别的名称。",
  scheduleRequired: "请填写有效的运行时间。",
  deleteTitle: "删除这个自动任务？",
  deleteBody: "任务将从列表中移除，并且不会再次自动运行。",
  deleteWarning: "已有运行记录可能仍会保留。这个操作无法撤销。",
  deleteConfirm: "确认删除",
  deleting: "正在删除…",
  operationFailed: "操作失败，请稍后重试。",
  runningAction: "正在处理…",
  loading: "正在读取自动任务…",
  unknown: "未知",
  today: "今天",
  tomorrow: "明天",
};

type AutomationState =
  | "scheduled"
  | "active"
  | "running"
  | "paused"
  | "attention"
  | "completed"
  | "offline";

type EditorKind = "create" | "edit" | "duplicate";
type EditorStep = 0 | 1 | 2;
type MenuAction = "run" | "edit" | "toggle" | "duplicate" | "delete";

interface ActionCallbacks {
  add?: (draft: AutomationDraft) => void | Promise<unknown>;
  update?: (id: string, draft: AutomationDraft) => void | Promise<unknown>;
  run?: (id: string) => void | Promise<unknown>;
  toggle?: (id: string, enabled: boolean) => void | Promise<unknown>;
  delete?: (id: string) => void | Promise<unknown>;
  install?: () => void | Promise<unknown>;
  openReplay?: (run: AutomationRun) => void | Promise<unknown>;
}

interface AutomationDataProps extends ActionCallbacks {
  copy?: Partial<AutomationCopy>;
  jobs?: readonly AutomationJob[] | null;
  sessions?: readonly AutomationRun[] | null;
  scheduler?: AutomationScheduler | null;
}

export interface AutomationSidebarProps {
  copy?: Partial<AutomationCopy>;
  jobs?: readonly AutomationJob[] | null;
  sessions?: readonly AutomationRun[] | null;
  scheduler?: AutomationScheduler | null;
  view: AutomationViewId;
  onViewChange: (view: AutomationViewId) => void;
}

export interface AutomationsPageProps extends AutomationDataProps {
  view?: AutomationViewId;
}

export interface AutomationViewProps extends AutomationDataProps {
  view?: AutomationViewId;
  defaultView?: AutomationViewId;
  onViewChange?: (view: AutomationViewId) => void;
}

interface MenuState {
  jobId: string;
  x: number;
  y: number;
}

interface EditorState {
  kind: EditorKind;
  job?: AutomationJob;
}

interface EditorValues {
  name: string;
  task: string;
  cwd: string;
  mode: "print" | "org" | "command";
  cadence: "once" | "interval" | "daily" | "weekly" | "custom";
  runAt: string;
  intervalValue: string;
  intervalUnit: "m" | "h" | "d";
  time: string;
  weekdays: number[];
  customSchedule: string;
  timezone: string;
  deliveryTarget: string;
  deliverMode: "off" | "always" | "on-output" | "on-error";
  alertAfter: string;
}

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
] as const;

function getCopy(copy?: Partial<AutomationCopy>): AutomationCopy {
  return { ...DEFAULT_COPY, ...copy };
}

function toMillis(value?: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatInstant(value: number | string | null | undefined, copy: AutomationCopy): string {
  const millis = toMillis(value);
  if (millis === null) {
    return typeof value === "string" && value.trim() ? value : copy.unknown;
  }
  const date = new Date(millis);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (sameDay(date, now)) return `${copy.today} ${time}`;
  if (sameDay(date, tomorrow)) return `${copy.tomorrow} ${time}`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(value: number | string | null | undefined): string | null {
  const millis = toMillis(value);
  if (millis === null) return null;
  const difference = millis - Date.now();
  const absolute = Math.abs(difference);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60_000) return formatter.format(Math.round(difference / 1_000), "second");
  if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), "hour");
  return formatter.format(Math.round(difference / 86_400_000), "day");
}

function formatDuration(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function scheduleExpression(job: AutomationJob): string {
  if (job.scheduleSpec) return job.scheduleSpec;
  if (typeof job.schedule === "string") return job.schedule;
  if (job.schedule?.expression) return job.schedule.expression;
  if (job.schedule?.cron) return job.schedule.cron;
  if (job.schedule?.runAt) return String(job.schedule.runAt);
  if (job.schedule?.everyMs) {
    const minutes = job.schedule.everyMs / 60_000;
    if (Number.isInteger(minutes / 1_440)) return `every ${minutes / 1_440}d`;
    if (Number.isInteger(minutes / 60)) return `every ${minutes / 60}h`;
    return `every ${Math.max(1, Math.round(minutes))}m`;
  }
  return "";
}

function getScheduleLabel(job: AutomationJob, copy: AutomationCopy): string {
  if (job.scheduleLabel) return job.scheduleLabel;
  if (typeof job.schedule === "object" && job.schedule?.label) return job.schedule.label;
  if (typeof job.schedule === "string" && job.scheduleSpec) return job.schedule;
  const expression = scheduleExpression(job).trim();
  if (!expression) return copy.noNextRun;
  const interval = expression.match(/^every\s+(\d+)\s*([mhd])$/i);
  if (interval) {
    const unit =
      interval[2].toLowerCase() === "m"
        ? copy.minutes
        : interval[2].toLowerCase() === "h"
          ? copy.hours
          : copy.days;
    return `${copy.every} ${interval[1]} ${unit}`;
  }
  const cron = expression.replace(/^cron\s*:?\s*/i, "").replace(/^`|`$/g, "");
  const fields = cron.split(/\s+/);
  if (fields.length === 5) {
    const [minute, hour, , , weekday] = fields;
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
      const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
      if (weekday === "*") return `${copy.cadenceDaily} ${time}`;
      return `${copy.cadenceWeekly} ${time}`;
    }
  }
  const instant = toMillis(expression);
  if (instant !== null) return `${copy.cadenceOnce} · ${formatInstant(instant, copy)}`;
  return expression;
}

function getJobDescription(job: AutomationJob, copy: AutomationCopy): string {
  const explicit = job.description?.trim() || job.taskPreview?.trim() || job.task?.trim();
  if (explicit) return explicit.length > 150 ? `${explicit.slice(0, 147)}…` : explicit;
  if (job.mode === "org") return copy.createdDescriptionOrg;
  if (job.mode === "command") return copy.createdDescriptionCommand;
  return copy.createdDescriptionPrint;
}

function getNextRun(job: AutomationJob): number | string | null | undefined {
  return job.nextRunAt ?? job.nextRuns?.[0];
}

function isOneShot(job: AutomationJob): boolean {
  if (typeof job.schedule === "object" && job.schedule?.kind === "once") return true;
  const expression = scheduleExpression(job);
  return Boolean(expression && toMillis(expression) !== null);
}

function getAutomationState(
  job: AutomationJob,
  scheduler?: AutomationScheduler | null,
): AutomationState {
  if (job.lastStatus === "running" || job.runningSince) return "running";
  if (job.enabled === false) return "paused";
  if (scheduler?.installed === false || scheduler?.healthy === false || scheduler?.status === "offline") {
    return "offline";
  }
  if (
    job.lastStatus === "error" ||
    job.lastStatus === "timed_out" ||
    (job.consecutiveErrors ?? 0) > 0
  ) {
    return "attention";
  }
  if (isOneShot(job) && job.lastRunAt && !getNextRun(job)) return "completed";
  if (!job.lastRunAt) return "scheduled";
  return "active";
}

function stateLabel(state: AutomationState, copy: AutomationCopy): string {
  const labels: Record<AutomationState, string> = {
    scheduled: copy.statusScheduled,
    active: copy.statusActive,
    running: copy.statusRunning,
    paused: copy.statusPaused,
    attention: copy.statusAttention,
    completed: copy.statusCompleted,
    offline: copy.statusOffline,
  };
  return labels[state];
}

function stateHelp(state: AutomationState, copy: AutomationCopy): string {
  const descriptions: Record<AutomationState, string> = {
    scheduled: copy.statusScheduledHelp,
    active: copy.statusActiveHelp,
    running: copy.statusRunningHelp,
    paused: copy.statusPausedHelp,
    attention: copy.statusAttentionHelp,
    completed: copy.statusCompletedHelp,
    offline: copy.statusOfflineHelp,
  };
  return descriptions[state];
}

function resultLabel(status: string | undefined, copy: AutomationCopy): string {
  if (status === "ok") return copy.resultOk;
  if (status === "error") return copy.resultError;
  if (status === "running") return copy.resultRunning;
  if (status === "timed_out") return copy.resultTimedOut;
  return copy.resultUnknown;
}

function safeDeliveryLabel(job: AutomationJob, copy: AutomationCopy): string {
  if (job.delivery) {
    if (!job.delivery.kind || job.delivery.kind === "none") return copy.deliveryLocal;
    if (job.delivery.kind === "webhook") return copy.deliveryWebhook;
    return job.delivery.label?.trim() || copy.deliveryExternal;
  }
  if (!job.deliver || job.deliverMode === "off") return copy.deliveryLocal;
  if (typeof job.deliver === "string") {
    if (/^https?:\/\//i.test(job.deliver)) return copy.deliveryWebhook;
    return copy.deliveryExternal;
  }
  if (typeof job.deliver === "object") {
    const candidate = job.deliver as { type?: unknown; kind?: unknown };
    const kind = String(candidate.type ?? candidate.kind ?? "").toLowerCase();
    if (kind.includes("webhook")) return copy.deliveryWebhook;
  }
  return copy.deliveryExternal;
}

function nextUpcoming(jobs: readonly AutomationJob[]): AutomationJob | undefined {
  return [...jobs]
    .filter((job) => job.enabled !== false && toMillis(getNextRun(job)) !== null)
    .sort(
      (left, right) =>
        (toMillis(getNextRun(left)) ?? Number.MAX_SAFE_INTEGER) -
        (toMillis(getNextRun(right)) ?? Number.MAX_SAFE_INTEGER),
    )[0];
}

function Icon({
  name,
  size = 18,
}: {
  name:
    | "tasks"
    | "attention"
    | "paused"
    | "runs"
    | "plus"
    | "search"
    | "close"
    | "back"
    | "play"
    | "calendar"
    | "clock"
    | "folder"
    | "bell"
    | "check"
    | "chevron"
    | "more";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "tasks")
    return (
      <svg {...common}>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
      </svg>
    );
  if (name === "attention")
    return (
      <svg {...common}>
        <path d="M10.3 3.8 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4m0 3.5v.1" />
      </svg>
    );
  if (name === "paused")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 8.5v7m5-7v7" />
      </svg>
    );
  if (name === "runs")
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5m4-1v5l3 2" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  if (name === "search")
    return (
      <svg {...common}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
    );
  if (name === "close")
    return (
      <svg {...common}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    );
  if (name === "back")
    return (
      <svg {...common}>
        <path d="m15 18-6-6 6-6" />
      </svg>
    );
  if (name === "play")
    return (
      <svg {...common}>
        <path d="m8 5 11 7-11 7V5Z" />
      </svg>
    );
  if (name === "calendar")
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4m8-4v4M3 10h18" />
      </svg>
    );
  if (name === "clock")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  if (name === "folder")
    return (
      <svg {...common}>
        <path d="M3 6h7l2 2h9v11H3V6Z" />
      </svg>
    );
  if (name === "bell")
    return (
      <svg {...common}>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  if (name === "chevron")
    return (
      <svg {...common}>
        <path d="m9 18 6-6-6-6" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StatusBadge({
  state,
  copy,
  compact = false,
}: {
  state: AutomationState;
  copy: AutomationCopy;
  compact?: boolean;
}) {
  return (
    <span
      className={`hara-automation-status is-${state}${compact ? " is-compact" : ""}`}
      title={stateHelp(state, copy)}
    >
      <span className="hara-automation-status-dot" aria-hidden />
      {stateLabel(state, copy)}
    </span>
  );
}

function countViews(
  jobs: readonly AutomationJob[],
  sessions: readonly AutomationRun[],
  scheduler?: AutomationScheduler | null,
) {
  return {
    tasks: jobs.length,
    attention: jobs.filter((job) => {
      const state = getAutomationState(job, scheduler);
      return state === "attention" || state === "offline";
    }).length,
    paused: jobs.filter((job) => getAutomationState(job, scheduler) === "paused").length,
    runs: sessions.length,
  } satisfies Record<AutomationViewId, number>;
}

export function AutomationSidebar({
  copy: copyOverrides,
  jobs = [],
  sessions = [],
  scheduler,
  view,
  onViewChange,
}: AutomationSidebarProps) {
  const copy = useMemo(() => getCopy(copyOverrides), [copyOverrides]);
  const safeJobs = jobs ?? [];
  const safeSessions = sessions ?? [];
  const counts = useMemo(
    () => countViews(safeJobs, safeSessions, scheduler),
    [safeJobs, safeSessions, scheduler],
  );
  const items: Array<{ id: AutomationViewId; label: string; icon: Parameters<typeof Icon>[0]["name"] }> =
    [
      { id: "tasks", label: copy.allTasks, icon: "tasks" },
      { id: "attention", label: copy.attention, icon: "attention" },
      { id: "paused", label: copy.paused, icon: "paused" },
      { id: "runs", label: copy.runs, icon: "runs" },
    ];

  return (
    <aside className="hara-automation-sidebar">
      <div className="hara-automation-sidebar-heading">
        <span className="hara-automation-seal" aria-hidden>
          <IconBot size={16} />
        </span>
        <div>
          <strong>{copy.title}</strong>
          <span>{safeJobs.length ? `${safeJobs.length} ${copy.task}` : copy.noTasksTitle}</span>
        </div>
      </div>
      <nav className="hara-automation-nav" aria-label={copy.navLabel}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? "is-active" : undefined}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => onViewChange(item.id)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
            <span className="hara-automation-nav-count">{counts[item.id]}</span>
          </button>
        ))}
      </nav>
      <div className="hara-automation-sidebar-note">
        <Icon name="clock" size={15} />
        <p>
          {!scheduler
            ? copy.schedulerUnknownBody
            : scheduler.supported === false
            ? scheduler.detail || copy.schedulerOfflineBody
            : scheduler.installed === false
            ? copy.schedulerMissingBody
            : scheduler.healthy === false
              ? copy.schedulerOfflineBody
              : copy.schedulerReadyBody}
        </p>
      </div>
    </aside>
  );
}

function SchedulerBanner({
  scheduler,
  copy,
  onInstall,
  busy,
}: {
  scheduler?: AutomationScheduler | null;
  copy: AutomationCopy;
  onInstall?: () => void;
  busy: boolean;
}) {
  let tone: "ok" | "warning" | "error" | "neutral" = "neutral";
  let title = copy.schedulerUnknown;
  let body = copy.schedulerUnknownBody;
  if (scheduler?.supported === false) {
    tone = "error";
    title = copy.schedulerOffline;
    body = scheduler.detail || scheduler.issue || copy.schedulerOfflineBody;
  } else if (scheduler?.installed === false) {
    tone = "warning";
    title = copy.schedulerMissing;
    body = scheduler.detail || scheduler.issue || copy.schedulerMissingBody;
  } else if (
    scheduler?.healthy === false ||
    scheduler?.status === "offline" ||
    scheduler?.status === "degraded"
  ) {
    tone = "error";
    title = copy.schedulerOffline;
    body = scheduler.detail || scheduler.issue || copy.schedulerOfflineBody;
  } else if (scheduler?.healthy === true || scheduler?.status === "ready") {
    tone = "ok";
    title = copy.schedulerReady;
    body = scheduler.detail || copy.schedulerReadyBody;
  } else if (scheduler?.installed === true) {
    tone = "ok";
    title = copy.schedulerReady;
    body = scheduler.detail || copy.schedulerReadyBody;
  }
  const checked = scheduler?.lastTickAt ? formatInstant(scheduler.lastTickAt, copy) : null;
  return (
    <section className={`hara-automation-scheduler is-${tone}`} aria-label={title}>
      <span className="hara-automation-scheduler-mark" aria-hidden>
        {tone === "ok" ? <Icon name="check" /> : <Icon name="clock" />}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {checked ? (
          <span>
            {copy.lastChecked} · {checked}
          </span>
        ) : null}
      </div>
      {scheduler?.installed === false && scheduler.supported !== false && onInstall ? (
        <button type="button" onClick={onInstall} disabled={busy}>
          {busy ? copy.runningAction : copy.installScheduler}
        </button>
      ) : null}
    </section>
  );
}

function PageMetrics({
  jobs,
  scheduler,
  copy,
}: {
  jobs: readonly AutomationJob[];
  scheduler?: AutomationScheduler | null;
  copy: AutomationCopy;
}) {
  const attention = jobs.filter((job) => getAutomationState(job, scheduler) === "attention").length;
  const upcoming = nextUpcoming(jobs);
  return (
    <div className="hara-automation-metrics" aria-label="任务概览">
      <div>
        <span>{copy.taskCount}</span>
        <strong>{jobs.length}</strong>
      </div>
      <div className={attention ? "is-alert" : undefined}>
        <span>{copy.attentionCount}</span>
        <strong>{attention}</strong>
      </div>
      <div className="is-upcoming">
        <span>{copy.upcoming}</span>
        <strong>{upcoming ? formatInstant(getNextRun(upcoming), copy) : "—"}</strong>
        {upcoming ? <small>{upcoming.name}</small> : null}
      </div>
    </div>
  );
}

function JobMenu({
  menu,
  job,
  copy,
  callbacks,
  pending,
  menuRef,
  onAction,
}: {
  menu: MenuState;
  job: AutomationJob;
  copy: AutomationCopy;
  callbacks: ActionCallbacks;
  pending: string | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onAction: (action: MenuAction, job: AutomationJob) => void;
}) {
  const isPending = pending?.startsWith(`${job.id}:`) ?? false;
  const items: Array<{
    id: MenuAction;
    label: string;
    icon: ReactNode;
    disabled: boolean;
    danger?: boolean;
  }> = [
    {
      id: "run",
      label: copy.runNow,
      icon: <Icon name="play" size={15} />,
      disabled: !callbacks.run || isPending,
    },
    {
      id: "edit",
      label: copy.edit,
      icon: <IconEdit size={15} />,
      disabled: !callbacks.update || isPending,
    },
    {
      id: "toggle",
      label: job.enabled === false ? copy.resume : copy.pause,
      icon: <Icon name="paused" size={15} />,
      disabled: !callbacks.toggle || isPending,
    },
    {
      id: "duplicate",
      label: copy.duplicate,
      icon: <IconFork size={15} />,
      disabled: !callbacks.add || isPending,
    },
    {
      id: "delete",
      label: copy.delete,
      icon: <IconTrash size={15} />,
      disabled: !callbacks.delete || isPending,
      danger: true,
    },
  ];
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  return (
    <div
      ref={menuRef}
      className="hara-automation-menu"
      role="menu"
      aria-label={`${job.name} · ${copy.moreActions}`}
      style={{ left: menu.x, top: menu.y }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={item.danger ? "is-danger" : undefined}
          disabled={item.disabled}
          autoFocus={index === firstEnabledIndex}
          onClick={() => onAction(item.id, job)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function TaskRow({
  job,
  scheduler,
  copy,
  onOpen,
  onOpenMenu,
}: {
  job: AutomationJob;
  scheduler?: AutomationScheduler | null;
  copy: AutomationCopy;
  onOpen: (job: AutomationJob) => void;
  onOpenMenu: (event: ReactMouseEvent, job: AutomationJob, contextMenu?: boolean) => void;
}) {
  const state = getAutomationState(job, scheduler);
  const next = getNextRun(job);
  const lastRelative = formatRelative(job.lastRunAt);
  const duration = formatDuration(job.lastDurationMs);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(job);
    }
    if (event.key === "F10" && event.shiftKey) {
      event.preventDefault();
      const rectangle = event.currentTarget.getBoundingClientRect();
      onOpenMenu(
        {
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
          currentTarget: event.currentTarget,
          clientX: rectangle.right,
          clientY: rectangle.top + 24,
        } as unknown as ReactMouseEvent,
        job,
        true,
      );
    }
  };
  return (
    <article
      className={`hara-automation-task-row is-${state}`}
      role="listitem"
      tabIndex={0}
      aria-label={`${job.name}，${stateLabel(state, copy)}`}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) onOpen(job);
      }}
      onContextMenu={(event) => onOpenMenu(event, job, true)}
    >
      <div className="hara-automation-task-main">
        <StatusBadge state={state} copy={copy} compact />
        <button type="button" className="hara-automation-task-title" onClick={() => onOpen(job)}>
          {job.name}
        </button>
        <p>{getJobDescription(job, copy)}</p>
        <span className="hara-automation-task-workspace">
          <Icon name="folder" size={13} />
          {job.workspaceLabel || job.cwd || copy.workspace}
        </span>
      </div>
      <div className="hara-automation-task-time">
        <span className="hara-automation-column-label">{copy.schedule}</span>
        <strong>{getScheduleLabel(job, copy)}</strong>
        <small>
          {next ? `${copy.nextRun} · ${formatInstant(next, copy)}` : copy.noNextRun}
        </small>
      </div>
      <div className="hara-automation-task-result">
        <span className="hara-automation-column-label">{copy.lastRun}</span>
        <strong className={`is-${job.lastStatus ?? "unknown"}`}>
          {job.lastRunAt ? resultLabel(job.lastStatus, copy) : copy.neverRun}
        </strong>
        <small>
          {job.lastRunAt
            ? [lastRelative, duration].filter(Boolean).join(" · ")
            : stateHelp(state, copy)}
        </small>
      </div>
      <button
        type="button"
        className="hara-automation-more-button"
        aria-label={`${job.name} · ${copy.moreActions}`}
        aria-haspopup="menu"
        onClick={(event) => onOpenMenu(event, job)}
      >
        <Icon name="more" size={19} />
      </button>
    </article>
  );
}

function EmptyState({
  copy,
  filtered,
  canAdd,
  onAdd,
}: {
  copy: AutomationCopy;
  filtered: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="hara-automation-empty">
      <span aria-hidden>
        <IconBot size={24} />
      </span>
      <h2>{filtered ? copy.noFilteredTasksTitle : copy.noTasksTitle}</h2>
      <p>{filtered ? copy.noFilteredTasksBody : copy.noTasksBody}</p>
      {!filtered && canAdd ? (
        <button type="button" onClick={onAdd}>
          <Icon name="plus" size={16} />
          {copy.newTask}
        </button>
      ) : null}
    </div>
  );
}

function RunList({
  sessions,
  jobs,
  copy,
  onOpenReplay,
  pending,
}: {
  sessions: readonly AutomationRun[];
  jobs: readonly AutomationJob[];
  copy: AutomationCopy;
  onOpenReplay?: (run: AutomationRun) => void;
  pending: string | null;
}) {
  const jobNames = useMemo(
    () => new Map(jobs.map((job) => [job.id, job.name] as const)),
    [jobs],
  );
  const ordered = useMemo(
    () =>
      [...sessions].sort(
        (left, right) =>
          (toMillis(right.startedAt ?? right.updatedAt) ?? 0) -
          (toMillis(left.startedAt ?? left.updatedAt) ?? 0),
      ),
    [sessions],
  );
  if (!ordered.length) {
    return (
      <div className="hara-automation-empty is-compact">
        <span aria-hidden>
          <Icon name="runs" size={24} />
        </span>
        <h2>{copy.noRuns}</h2>
      </div>
    );
  }
  return (
    <div className="hara-automation-run-list" role="list">
      {ordered.map((run) => {
        const timestamp = run.startedAt ?? run.updatedAt ?? run.finishedAt;
        const title =
          run.jobName ||
          run.sourceName ||
          (run.jobId ? jobNames.get(run.jobId) : undefined) ||
          run.title ||
          copy.task;
        const needsAttention =
          run.needsAttention || run.status === "error" || run.status === "timed_out";
        return (
          <article
            key={run.id}
            className={`hara-automation-run${run.unread ? " is-unread" : ""}${
              needsAttention ? " is-attention" : ""
            }`}
            role="listitem"
          >
            <span
              className={`hara-automation-run-mark is-${run.status ?? "unknown"}`}
              aria-hidden
            />
            <div className="hara-automation-run-main">
              <div>
                <strong>{title}</strong>
                {run.unread ? <span className="hara-automation-new-mark">NEW</span> : null}
              </div>
              <p>{run.summary || run.error || resultLabel(run.status, copy)}</p>
            </div>
            <div className="hara-automation-run-meta">
              <strong>{resultLabel(run.status, copy)}</strong>
              <span>
                {timestamp ? formatInstant(timestamp, copy) : copy.unknown}
                {run.durationMs ? ` · ${formatDuration(run.durationMs)}` : ""}
              </span>
            </div>
            {onOpenReplay ? (
              <button
                type="button"
                className="hara-automation-secondary-button"
                onClick={() => onOpenReplay(run)}
                disabled={pending === `run:${run.id}`}
              >
                {copy.openReplay}
                <Icon name="chevron" size={14} />
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function DetailField({
  icon,
  label,
  children,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="hara-automation-detail-field">
      <span aria-hidden>
        <Icon name={icon} size={17} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{children}</strong>
      </div>
    </div>
  );
}

function TaskDetail({
  job,
  jobs,
  sessions,
  scheduler,
  copy,
  callbacks,
  pending,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onRun,
  onToggle,
  onOpenReplay,
}: {
  job: AutomationJob;
  jobs: readonly AutomationJob[];
  sessions: readonly AutomationRun[];
  scheduler?: AutomationScheduler | null;
  copy: AutomationCopy;
  callbacks: ActionCallbacks;
  pending: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRun: () => void;
  onToggle: () => void;
  onOpenReplay?: (run: AutomationRun) => void;
}) {
  const state = getAutomationState(job, scheduler);
  const relatedRuns = sessions.filter((run) => run.jobId === job.id);
  const busy = pending?.startsWith(`${job.id}:`) ?? false;
  return (
    <section className="hara-automation-detail" aria-labelledby="automation-detail-title">
      <button type="button" className="hara-automation-back-button" onClick={onBack}>
        <Icon name="back" size={16} />
        {copy.backToTasks}
      </button>
      <header className="hara-automation-detail-header">
        <div>
          <span className="hara-automation-eyebrow">{copy.taskDetails}</span>
          <h1 id="automation-detail-title">{job.name}</h1>
          <p>{getJobDescription(job, copy)}</p>
          <StatusBadge state={state} copy={copy} />
        </div>
        <div className="hara-automation-detail-actions">
          {callbacks.run ? (
            <button type="button" onClick={onRun} disabled={busy}>
              <Icon name="play" size={15} />
              {copy.runNow}
            </button>
          ) : null}
          {callbacks.update ? (
            <button type="button" className="hara-automation-secondary-button" onClick={onEdit}>
              <IconEdit size={15} />
              {copy.edit}
            </button>
          ) : null}
          {callbacks.toggle ? (
            <button
              type="button"
              className="hara-automation-secondary-button"
              onClick={onToggle}
              disabled={busy}
            >
              <Icon name="paused" size={15} />
              {job.enabled === false ? copy.resume : copy.pause}
            </button>
          ) : null}
        </div>
      </header>
      <p className={`hara-automation-state-explainer is-${state}`}>
        <span aria-hidden />
        {stateHelp(state, copy)}
      </p>
      <div className="hara-automation-detail-grid">
        <DetailField icon="calendar" label={copy.schedule}>
          {getScheduleLabel(job, copy)}
        </DetailField>
        <DetailField icon="clock" label={copy.nextRun}>
          {getNextRun(job) ? formatInstant(getNextRun(job), copy) : copy.noNextRun}
        </DetailField>
        <DetailField icon="folder" label={copy.workspace}>
          {job.workspaceLabel || job.cwd || "—"}
        </DetailField>
        <DetailField icon="bell" label={copy.delivery}>
          {safeDeliveryLabel(job, copy)}
        </DetailField>
        <DetailField icon="clock" label={copy.timezone}>
          {job.timezone || job.tz || Intl.DateTimeFormat().resolvedOptions().timeZone}
        </DetailField>
        <DetailField icon="runs" label={copy.lastRun}>
          {job.lastRunAt
            ? `${resultLabel(job.lastStatus, copy)} · ${formatInstant(job.lastRunAt, copy)}`
            : copy.neverRun}
        </DetailField>
      </div>
      {job.lastError ? (
        <div className="hara-automation-error-panel" role="alert">
          <strong>{copy.errorLabel}</strong>
          <pre>{job.lastError}</pre>
        </div>
      ) : null}
      {job.task ? (
        <section className="hara-automation-instructions">
          <h2>{copy.taskInstructions}</h2>
          <pre>{job.task}</pre>
        </section>
      ) : null}
      <section className="hara-automation-detail-runs">
        <div className="hara-automation-section-heading">
          <div>
            <span>{copy.recentRuns}</span>
            <strong>{relatedRuns.length}</strong>
          </div>
          <div className="hara-automation-inline-actions">
            {callbacks.add ? (
              <button
                type="button"
                className="hara-automation-text-button"
                onClick={onDuplicate}
              >
                <IconFork size={14} />
                {copy.duplicate}
              </button>
            ) : null}
            {callbacks.delete ? (
              <button
                type="button"
                className="hara-automation-text-button is-danger"
                onClick={onDelete}
              >
                <IconTrash size={14} />
                {copy.delete}
              </button>
            ) : null}
          </div>
        </div>
        <RunList
          sessions={relatedRuns}
          jobs={jobs}
          copy={copy}
          onOpenReplay={onOpenReplay}
          pending={pending}
        />
      </section>
    </section>
  );
}

function DialogShell({
  title,
  description,
  closeLabel,
  onClose,
  children,
  size = "large",
}: {
  title: string;
  description?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  size?: "small" | "large";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])",
    );
    first?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className="hara-automation-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`hara-automation-dialog is-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="hara-automation-dialog-titlebar">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            type="button"
            className="hara-automation-icon-button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function defaultRunAt(): string {
  const date = new Date(Date.now() + 60 * 60 * 1_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseEditorValues(
  kind: EditorKind,
  job: AutomationJob | undefined,
  copy: AutomationCopy,
): EditorValues {
  const expression = job ? scheduleExpression(job).trim() : "";
  let cadence: EditorValues["cadence"] = "daily";
  let runAt = defaultRunAt();
  let intervalValue = "1";
  let intervalUnit: EditorValues["intervalUnit"] = "d";
  let time = "09:00";
  let weekdays = [1, 2, 3, 4, 5];
  let customSchedule = "";
  const scheduleObject = typeof job?.schedule === "object" ? job.schedule : undefined;
  if (scheduleObject?.kind === "once") {
    cadence = "once";
    const date = toMillis(scheduleObject.runAt);
    if (date !== null) {
      const local = new Date(date - new Date(date).getTimezoneOffset() * 60_000);
      runAt = local.toISOString().slice(0, 16);
    }
  } else if (scheduleObject?.kind === "interval" && scheduleObject.everyMs) {
    cadence = "interval";
    const minutes = scheduleObject.everyMs / 60_000;
    if (Number.isInteger(minutes / 1_440)) {
      intervalValue = String(minutes / 1_440);
      intervalUnit = "d";
    } else if (Number.isInteger(minutes / 60)) {
      intervalValue = String(minutes / 60);
      intervalUnit = "h";
    } else {
      intervalValue = String(Math.max(1, Math.round(minutes)));
      intervalUnit = "m";
    }
  } else if (scheduleObject?.kind === "daily") {
    cadence = "daily";
    time = scheduleObject.time || time;
  } else if (scheduleObject?.kind === "weekly") {
    cadence = "weekly";
    time = scheduleObject.time || time;
    weekdays = scheduleObject.weekdays?.length ? scheduleObject.weekdays : weekdays;
  } else if (expression) {
    const interval = expression.match(/^every\s+(\d+)\s*([mhd])$/i);
    const instant = toMillis(expression);
    const cron = expression.replace(/^cron\s*:?\s*/i, "").replace(/^`|`$/g, "");
    const fields = cron.split(/\s+/);
    if (interval) {
      cadence = "interval";
      intervalValue = interval[1];
      intervalUnit = interval[2].toLowerCase() as EditorValues["intervalUnit"];
    } else if (instant !== null) {
      cadence = "once";
      const date = new Date(instant);
      runAt = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    } else if (
      fields.length === 5 &&
      /^\d+$/.test(fields[0]) &&
      /^\d+$/.test(fields[1]) &&
      fields[2] === "*" &&
      fields[3] === "*"
    ) {
      time = `${fields[1].padStart(2, "0")}:${fields[0].padStart(2, "0")}`;
      if (fields[4] === "*") {
        cadence = "daily";
      } else {
        cadence = "weekly";
        const parsedDays = fields[4]
          .split(",")
          .map(Number)
          .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
        if (parsedDays.length) weekdays = parsedDays;
      }
    } else {
      cadence = "custom";
      customSchedule = cron;
    }
  }
  const duplicateSuffix = kind === "duplicate" ? ` · ${copy.duplicate}` : "";
  return {
    name: `${job?.name ?? ""}${duplicateSuffix}`,
    task: job?.task ?? job?.description ?? job?.taskPreview ?? "",
    cwd: job?.cwd ?? "",
    mode:
      job?.mode === "org" || job?.mode === "command" || job?.mode === "print"
        ? job.mode
        : "print",
    cadence,
    runAt,
    intervalValue,
    intervalUnit,
    time,
    weekdays,
    customSchedule,
    timezone:
      job?.timezone || job?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    deliveryTarget: "",
    deliverMode:
      job?.deliverMode === "always" ||
      job?.deliverMode === "on-output" ||
      job?.deliverMode === "on-error"
        ? job.deliverMode
        : "off",
    alertAfter: String(job?.alertAfter ?? 1),
  };
}

function scheduleDraft(values: EditorValues): AutomationScheduleDraft {
  if (values.cadence === "once") {
    const [date = "", time = ""] = values.runAt.split("T");
    return { mode: "once", date, time };
  }
  if (values.cadence === "interval") {
    const units = {
      m: "minutes",
      h: "hours",
      d: "days",
    } as const;
    return {
      mode: "interval",
      every: values.intervalValue,
      unit: units[values.intervalUnit],
    };
  }
  if (values.cadence === "daily") return { mode: "daily", time: values.time };
  if (values.cadence === "weekly") {
    const keys: Record<number, AutomationWeekday> = {
      0: "sun",
      1: "mon",
      2: "tue",
      3: "wed",
      4: "thu",
      5: "fri",
      6: "sat",
    };
    return {
      mode: "weekly",
      time: values.time,
      weekdays: values.weekdays.map((day) => keys[day]).filter(Boolean),
    };
  }
  return { mode: "advanced", cron: values.customSchedule };
}

function buildSchedule(values: EditorValues): string {
  return buildAutomationSchedule(scheduleDraft(values)).spec;
}

function valuesToDraft(values: EditorValues): AutomationDraft {
  const draft: AutomationDraft = {
    name: values.name.trim(),
    task: values.task.trim(),
    description: values.task.trim(),
    cwd: values.cwd.trim() || undefined,
    mode: values.mode,
    schedule: buildSchedule(values),
    scheduleKind: values.cadence,
    timezone: values.timezone.trim() || undefined,
    tz: values.timezone.trim() || undefined,
    alertAfter: Math.max(1, Number(values.alertAfter) || 1),
  };
  if (values.deliverMode !== "off" && values.deliveryTarget.trim()) {
    draft.deliver = values.deliveryTarget.trim();
    draft.deliverMode = values.deliverMode;
  }
  if (values.cadence === "once") draft.runAt = values.runAt;
  if (values.cadence === "interval") {
    draft.interval = {
      value: Math.max(1, Number(values.intervalValue) || 1),
      unit: values.intervalUnit,
    };
  }
  if (values.cadence === "daily" || values.cadence === "weekly") draft.time = values.time;
  if (values.cadence === "weekly") draft.weekdays = values.weekdays;
  return draft;
}

function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`hara-automation-form-field${error ? " has-error" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <small className="hara-automation-field-error">{error}</small> : null}
    </label>
  );
}

function AutomationEditor({
  state,
  copy,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  state: EditorState;
  copy: AutomationCopy;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: AutomationDraft) => void;
}) {
  const [step, setStep] = useState<EditorStep>(0);
  const [values, setValues] = useState<EditorValues>(() =>
    parseEditorValues(state.kind, state.job, copy),
  );
  const [advanced, setAdvanced] = useState(false);
  const [validation, setValidation] = useState<Partial<Record<"name" | "task" | "schedule", string>>>(
    {},
  );
  const title =
    state.kind === "create"
      ? copy.createTitle
      : state.kind === "edit"
        ? copy.editTitle
        : copy.duplicateTitle;
  const steps = [copy.stepTask, copy.stepSchedule, copy.stepReview];
  const setValue = <Key extends keyof EditorValues>(key: Key, value: EditorValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setValidation((current) => ({ ...current, [key]: undefined, schedule: undefined }));
  };
  const validateStep = (target: EditorStep) => {
    const errors: typeof validation = {};
    if (target >= 0) {
      if (!values.name.trim()) errors.name = copy.nameRequired;
      if (!values.task.trim()) errors.task = copy.taskRequired;
    }
    if (target >= 1) {
      try {
        if (!buildSchedule(values)) errors.schedule = copy.scheduleRequired;
      } catch {
        errors.schedule = copy.scheduleRequired;
      }
    }
    setValidation(errors);
    return !Object.keys(errors).length;
  };
  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(2, current + 1) as EditorStep);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step < 2) {
      goNext();
      return;
    }
    if (validateStep(2)) onSubmit(valuesToDraft(values));
  };
  let scheduleSpec = "";
  try {
    scheduleSpec = buildSchedule(values);
  } catch {
    // The field-level validator owns the message. Keep the preview stable while the user edits.
  }
  const scheduleLabel = getScheduleLabel(
    {
      id: "preview",
      name: values.name,
      schedule: scheduleSpec,
      timezone: values.timezone,
    },
    copy,
  );
  return (
    <DialogShell
      title={title}
      description={copy.createIntro}
      closeLabel={copy.close}
      onClose={onClose}
    >
      <form className="hara-automation-editor" onSubmit={submit}>
        <ol className="hara-automation-editor-steps" aria-label={title}>
          {steps.map((label, index) => (
            <li
              key={label}
              className={`${index === step ? "is-current" : ""}${
                index < step ? " is-complete" : ""
              }`}
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="hara-automation-editor-panel">
          {step === 0 ? (
            <div className="hara-automation-form-section">
              <div className="hara-automation-form-intro">
                <span>01</span>
                <div>
                  <h3>{copy.stepTask}</h3>
                  <p>{copy.whatShouldRun}</p>
                </div>
              </div>
              <FormField label={copy.taskName} error={validation.name}>
                <input
                  data-autofocus
                  value={values.name}
                  onChange={(event) => setValue("name", event.target.value)}
                  placeholder={copy.taskNamePlaceholder}
                />
              </FormField>
              <FormField label={copy.whatShouldRun} error={validation.task}>
                <textarea
                  rows={5}
                  value={values.task}
                  onChange={(event) => setValue("task", event.target.value)}
                  placeholder={copy.taskPromptPlaceholder}
                />
              </FormField>
              <FormField label={copy.workingDirectory}>
                <div className="hara-automation-input-with-icon">
                  <Icon name="folder" size={16} />
                  <input
                    value={values.cwd}
                    onChange={(event) => setValue("cwd", event.target.value)}
                    placeholder={copy.workingDirectoryPlaceholder}
                  />
                </div>
              </FormField>
              <fieldset className="hara-automation-choice-field">
                <legend>{copy.executionMode}</legend>
                {(["print", "org", "command"] as const).map((mode) => {
                  const modeCopy = {
                    print: [copy.modePrint, copy.modePrintHelp],
                    org: [copy.modeOrg, copy.modeOrgHelp],
                    command: [copy.modeCommand, copy.modeCommandHelp],
                  }[mode];
                  return (
                    <label key={mode} className={values.mode === mode ? "is-selected" : undefined}>
                      <input
                        type="radio"
                        name="automation-mode"
                        value={mode}
                        checked={values.mode === mode}
                        onChange={() => setValue("mode", mode)}
                      />
                      <span>
                        <strong>{modeCopy[0]}</strong>
                        <small>{modeCopy[1]}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="hara-automation-form-section">
              <div className="hara-automation-form-intro">
                <span>02</span>
                <div>
                  <h3>{copy.stepSchedule}</h3>
                  <p>{copy.whenShouldRun}</p>
                </div>
              </div>
              <div className="hara-automation-cadence" role="radiogroup" aria-label={copy.whenShouldRun}>
                {(
                  [
                    ["once", copy.cadenceOnce],
                    ["interval", copy.cadenceInterval],
                    ["daily", copy.cadenceDaily],
                    ["weekly", copy.cadenceWeekly],
                    ["custom", copy.cadenceCustom],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className={values.cadence === value ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="automation-cadence"
                      value={value}
                      checked={values.cadence === value}
                      onChange={() => setValue("cadence", value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {values.cadence === "once" ? (
                <FormField label={copy.dateAndTime} error={validation.schedule}>
                  <input
                    type="datetime-local"
                    value={values.runAt}
                    onChange={(event) => setValue("runAt", event.target.value)}
                  />
                </FormField>
              ) : null}
              {values.cadence === "interval" ? (
                <FormField label={copy.every} error={validation.schedule}>
                  <div className="hara-automation-inline-inputs">
                    <input
                      type="number"
                      min="1"
                      value={values.intervalValue}
                      onChange={(event) => setValue("intervalValue", event.target.value)}
                    />
                    <select
                      value={values.intervalUnit}
                      onChange={(event) =>
                        setValue("intervalUnit", event.target.value as EditorValues["intervalUnit"])
                      }
                    >
                      <option value="m">{copy.minutes}</option>
                      <option value="h">{copy.hours}</option>
                      <option value="d">{copy.days}</option>
                    </select>
                  </div>
                </FormField>
              ) : null}
              {values.cadence === "daily" || values.cadence === "weekly" ? (
                <FormField label={copy.atTime} error={validation.schedule}>
                  <input
                    type="time"
                    value={values.time}
                    onChange={(event) => setValue("time", event.target.value)}
                  />
                </FormField>
              ) : null}
              {values.cadence === "weekly" ? (
                <fieldset className="hara-automation-weekdays">
                  <legend>{copy.chooseDays}</legend>
                  <div>
                    {WEEKDAYS.map((day) => {
                      const selected = values.weekdays.includes(day.value);
                      return (
                        <label key={day.value} className={selected ? "is-selected" : undefined}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              setValue(
                                "weekdays",
                                selected
                                  ? values.weekdays.filter((value) => value !== day.value)
                                  : [...values.weekdays, day.value],
                              )
                            }
                          />
                          {day.label}
                        </label>
                      );
                    })}
                  </div>
                  {validation.schedule ? (
                    <small className="hara-automation-field-error">{validation.schedule}</small>
                  ) : null}
                </fieldset>
              ) : null}
              {values.cadence === "custom" ? (
                <FormField
                  label={copy.customSchedule}
                  hint={copy.customScheduleHelp}
                  error={validation.schedule}
                >
                  <input
                    value={values.customSchedule}
                    onChange={(event) => setValue("customSchedule", event.target.value)}
                    placeholder="0 9 * * 1-5"
                    className="is-monospace"
                  />
                </FormField>
              ) : null}
              <FormField label={copy.timezone} hint={copy.timezoneHelp}>
                <input
                  value={values.timezone}
                  onChange={(event) => setValue("timezone", event.target.value)}
                  placeholder="Asia/Shanghai"
                />
              </FormField>
              <div className="hara-automation-schedule-preview">
                <Icon name="calendar" size={18} />
                <div>
                  <small>{copy.schedulePreview}</small>
                  <strong>{scheduleLabel}</strong>
                  <code>{buildSchedule(values) || "—"}</code>
                </div>
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="hara-automation-form-section">
              <div className="hara-automation-form-intro">
                <span>03</span>
                <div>
                  <h3>{copy.reviewTitle}</h3>
                  <p>{copy.reviewHelp}</p>
                </div>
              </div>
              <dl className="hara-automation-review">
                <div>
                  <dt>{copy.taskName}</dt>
                  <dd>{values.name}</dd>
                </div>
                <div>
                  <dt>{copy.whatShouldRun}</dt>
                  <dd>{values.task}</dd>
                </div>
                <div>
                  <dt>{copy.schedule}</dt>
                  <dd>
                    {scheduleLabel}
                    <small>{values.timezone}</small>
                  </dd>
                </div>
                <div>
                  <dt>{copy.workingDirectory}</dt>
                  <dd>{values.cwd || "—"}</dd>
                </div>
                <div>
                  <dt>{copy.executionMode}</dt>
                  <dd>
                    {values.mode === "command"
                      ? copy.modeCommand
                      : values.mode === "org"
                        ? copy.modeOrg
                        : copy.modePrint}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="hara-automation-advanced-toggle"
                aria-expanded={advanced}
                onClick={() => setAdvanced((current) => !current)}
              >
                <Icon name="chevron" size={15} />
                {copy.advancedOptions}
              </button>
              {advanced ? (
                <div className="hara-automation-advanced-panel">
                  <FormField label={copy.deliveryMode}>
                    <select
                      value={values.deliverMode}
                      onChange={(event) =>
                        setValue(
                          "deliverMode",
                          event.target.value as EditorValues["deliverMode"],
                        )
                      }
                    >
                      <option value="off">{copy.deliveryOff}</option>
                      <option value="always">{copy.deliveryAlways}</option>
                      <option value="on-output">{copy.deliveryOnOutput}</option>
                      <option value="on-error">{copy.deliveryOnError}</option>
                    </select>
                  </FormField>
                  {values.deliverMode !== "off" ? (
                    <FormField
                      label={copy.deliveryTarget}
                      hint={copy.deliveryTargetHelp}
                    >
                      <input
                        value={values.deliveryTarget}
                        onChange={(event) => setValue("deliveryTarget", event.target.value)}
                        placeholder={copy.deliveryTargetPlaceholder}
                      />
                    </FormField>
                  ) : null}
                  <FormField label={copy.alertAfter} hint={copy.alertAfterHelp}>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={values.alertAfter}
                      onChange={(event) => setValue("alertAfter", event.target.value)}
                    />
                  </FormField>
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <div className="hara-automation-form-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <footer className="hara-automation-dialog-footer">
          <button type="button" className="hara-automation-secondary-button" onClick={onClose}>
            {copy.cancel}
          </button>
          <span />
          {step > 0 ? (
            <button
              type="button"
              className="hara-automation-secondary-button"
              onClick={() => setStep((current) => Math.max(0, current - 1) as EditorStep)}
            >
              {copy.back}
            </button>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending
              ? copy.saving
              : step < 2
                ? copy.continue
                : state.kind === "edit"
                  ? copy.save
                  : copy.create}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

function DeleteDialog({
  job,
  copy,
  pending,
  onClose,
  onConfirm,
}: {
  job: AutomationJob;
  copy: AutomationCopy;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell
      title={copy.deleteTitle}
      description={`${copy.deleteBody} “${job.name}”`}
      closeLabel={copy.close}
      onClose={onClose}
      size="small"
    >
      <div className="hara-automation-delete-body">
        <span aria-hidden>
          <IconTrash size={22} />
        </span>
        <p>{copy.deleteWarning}</p>
      </div>
      <footer className="hara-automation-dialog-footer">
        <span />
        <button type="button" className="hara-automation-secondary-button" onClick={onClose}>
          {copy.cancel}
        </button>
        <button
          type="button"
          className="hara-automation-danger-button"
          data-autofocus
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? copy.deleting : copy.deleteConfirm}
        </button>
      </footer>
    </DialogShell>
  );
}

export function AutomationsPage({
  copy: copyOverrides,
  jobs,
  sessions,
  scheduler,
  view = "tasks",
  add,
  update,
  run,
  toggle,
  delete: deleteAutomation,
  install,
  openReplay,
}: AutomationsPageProps) {
  const copy = useMemo(() => getCopy(copyOverrides), [copyOverrides]);
  const safeJobs = jobs ?? [];
  const safeSessions = sessions ?? [];
  const callbacks = useMemo<ActionCallbacks>(
    () => ({
      add,
      update,
      run,
      toggle,
      delete: deleteAutomation,
      install,
      openReplay,
    }),
    [add, update, run, toggle, deleteAutomation, install, openReplay],
  );
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteJob, setDeleteJob] = useState<AutomationJob | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedJob = safeJobs.find((job) => job.id === selectedJobId);
  useEffect(() => {
    if (selectedJobId && !selectedJob) setSelectedJobId(null);
  }, [selectedJobId, selectedJob]);
  useEffect(() => {
    if (!menu) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnKey);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnKey);
    };
  }, [menu]);

  const filteredJobs = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return safeJobs
      .filter((job) => {
        const state = getAutomationState(job, scheduler);
        if (view === "attention" && state !== "attention" && state !== "offline") return false;
        if (view === "paused" && state !== "paused") return false;
        if (view === "runs") return false;
        if (!normalizedSearch) return true;
        return [job.name, getJobDescription(job, copy), job.cwd, job.workspaceLabel]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => {
        const priority: Record<AutomationState, number> = {
          attention: 0,
          offline: 1,
          running: 2,
          scheduled: 3,
          active: 4,
          paused: 5,
          completed: 6,
        };
        const stateDifference =
          priority[getAutomationState(left, scheduler)] -
          priority[getAutomationState(right, scheduler)];
        if (stateDifference) return stateDifference;
        return (
          (toMillis(getNextRun(left)) ?? Number.MAX_SAFE_INTEGER) -
          (toMillis(getNextRun(right)) ?? Number.MAX_SAFE_INTEGER)
        );
      });
  }, [safeJobs, scheduler, view, search, copy]);

  const perform = useCallback(
    async (key: string, operation: (() => void | Promise<unknown>) | undefined) => {
      if (!operation || pending) return false;
      setPending(key);
      setOperationError(null);
      try {
        await operation();
        return true;
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : copy.operationFailed);
        return false;
      } finally {
        setPending(null);
      }
    },
    [copy.operationFailed, pending],
  );

  const openMenu = useCallback(
    (event: ReactMouseEvent, job: AutomationJob, contextMenu = false) => {
      event.preventDefault();
      event.stopPropagation();
      const rectangle = event.currentTarget.getBoundingClientRect();
      const desiredX = contextMenu ? event.clientX : rectangle.right - 224;
      const desiredY = contextMenu ? event.clientY : rectangle.bottom + 6;
      const viewportWidth = typeof window === "undefined" ? 1_200 : window.innerWidth;
      const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
      setMenu({
        jobId: job.id,
        x: Math.max(8, Math.min(desiredX, viewportWidth - 232)),
        y: Math.max(8, Math.min(desiredY, viewportHeight - 244)),
      });
    },
    [],
  );

  const handleMenuAction = useCallback(
    (action: MenuAction, job: AutomationJob) => {
      setMenu(null);
      if (action === "edit") {
        setEditor({ kind: "edit", job });
        return;
      }
      if (action === "duplicate") {
        setEditor({ kind: "duplicate", job });
        return;
      }
      if (action === "delete") {
        setDeleteJob(job);
        return;
      }
      if (action === "run") {
        void perform(`${job.id}:run`, run ? () => run(job.id) : undefined);
        return;
      }
      void perform(
        `${job.id}:toggle`,
        toggle ? () => toggle(job.id, job.enabled === false) : undefined,
      );
    },
    [perform, run, toggle],
  );

  const submitEditor = useCallback(
    async (draft: AutomationDraft) => {
      if (!editor) return;
      const succeeded =
        editor.kind === "edit" && editor.job
          ? await perform(
              `${editor.job.id}:update`,
              update ? () => update(editor.job!.id, draft) : undefined,
            )
          : await perform("new:add", add ? () => add(draft) : undefined);
      if (succeeded) setEditor(null);
    },
    [editor, perform, update, add],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteJob) return;
    const succeeded = await perform(
      `${deleteJob.id}:delete`,
      deleteAutomation ? () => deleteAutomation(deleteJob.id) : undefined,
    );
    if (succeeded) {
      if (selectedJobId === deleteJob.id) setSelectedJobId(null);
      setDeleteJob(null);
    }
  }, [deleteJob, perform, deleteAutomation, selectedJobId]);

  const installScheduler = useCallback(() => {
    void perform("scheduler:install", install);
  }, [perform, install]);

  const replayRun = useCallback(
    (automationRun: AutomationRun) => {
      void perform(
        `run:${automationRun.id}`,
        openReplay ? () => openReplay(automationRun) : undefined,
      );
    },
    [perform, openReplay],
  );

  const menuJob = menu ? safeJobs.find((job) => job.id === menu.jobId) : undefined;
  const heading =
    view === "attention"
      ? copy.attention
      : view === "paused"
        ? copy.paused
        : view === "runs"
          ? copy.runs
          : copy.allTasks;

  if (selectedJob) {
    return (
      <main className="hara-automations-page">
        <TaskDetail
          job={selectedJob}
          jobs={safeJobs}
          sessions={safeSessions}
          scheduler={scheduler}
          copy={copy}
          callbacks={callbacks}
          pending={pending}
          onBack={() => setSelectedJobId(null)}
          onEdit={() => setEditor({ kind: "edit", job: selectedJob })}
          onDuplicate={() => setEditor({ kind: "duplicate", job: selectedJob })}
          onDelete={() => setDeleteJob(selectedJob)}
          onRun={() =>
            void perform(
              `${selectedJob.id}:run`,
              run ? () => run(selectedJob.id) : undefined,
            )
          }
          onToggle={() =>
            void perform(
              `${selectedJob.id}:toggle`,
              toggle
                ? () => toggle(selectedJob.id, selectedJob.enabled === false)
                : undefined,
            )
          }
          onOpenReplay={openReplay ? replayRun : undefined}
        />
        {operationError ? (
          <div className="hara-automation-toast" role="alert">
            {operationError}
            <button type="button" aria-label={copy.close} onClick={() => setOperationError(null)}>
              <Icon name="close" size={15} />
            </button>
          </div>
        ) : null}
        {editor ? (
          <AutomationEditor
            state={editor}
            copy={copy}
            pending={pending !== null}
            error={operationError}
            onClose={() => setEditor(null)}
            onSubmit={(draft) => void submitEditor(draft)}
          />
        ) : null}
        {deleteJob ? (
          <DeleteDialog
            job={deleteJob}
            copy={copy}
            pending={pending === `${deleteJob.id}:delete`}
            onClose={() => setDeleteJob(null)}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="hara-automations-page">
      <header className="hara-automation-page-header">
        <div>
          <span className="hara-automation-eyebrow">{copy.title}</span>
          <h1>{heading}</h1>
          <p>{copy.subtitle}</p>
        </div>
        {add ? (
          <button type="button" onClick={() => setEditor({ kind: "create" })}>
            <Icon name="plus" size={16} />
            {copy.newTask}
          </button>
        ) : null}
      </header>
      <SchedulerBanner
        scheduler={scheduler}
        copy={copy}
        onInstall={install ? installScheduler : undefined}
        busy={pending === "scheduler:install"}
      />
      <PageMetrics jobs={safeJobs} scheduler={scheduler} copy={copy} />
      {view === "runs" ? (
        <RunList
          sessions={safeSessions}
          jobs={safeJobs}
          copy={copy}
          onOpenReplay={openReplay ? replayRun : undefined}
          pending={pending}
        />
      ) : (
        <section className="hara-automation-list-section" aria-labelledby="automation-list-title">
          <div className="hara-automation-list-toolbar">
            <div>
              <h2 id="automation-list-title">{heading}</h2>
              <span>{filteredJobs.length}</span>
            </div>
            <label className="hara-automation-search">
              <span className="sr-only">{copy.searchPlaceholder}</span>
              <Icon name="search" size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
              />
              {search ? (
                <button
                  type="button"
                  aria-label={copy.clearSearch}
                  onClick={() => setSearch("")}
                >
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </label>
          </div>
          {jobs === null || jobs === undefined ? (
            <div className="hara-automation-loading" aria-live="polite">
              <span aria-hidden />
              {copy.loading}
            </div>
          ) : filteredJobs.length ? (
            <>
              <div className="hara-automation-list-labels" aria-hidden>
                <span>{copy.task}</span>
                <span>{copy.schedule}</span>
                <span>{copy.lastRun}</span>
                <span />
              </div>
              <div className="hara-automation-task-list" role="list">
                {filteredJobs.map((job) => (
                  <TaskRow
                    key={job.id}
                    job={job}
                    scheduler={scheduler}
                    copy={copy}
                    onOpen={(selected) => setSelectedJobId(selected.id)}
                    onOpenMenu={openMenu}
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              copy={copy}
              filtered={Boolean(search) || view !== "tasks"}
              canAdd={Boolean(add)}
              onAdd={() => setEditor({ kind: "create" })}
            />
          )}
        </section>
      )}
      {menu && menuJob ? (
        <JobMenu
          menu={menu}
          job={menuJob}
          copy={copy}
          callbacks={callbacks}
          pending={pending}
          menuRef={menuRef}
          onAction={handleMenuAction}
        />
      ) : null}
      {operationError && !editor ? (
        <div className="hara-automation-toast" role="alert">
          {operationError}
          <button type="button" aria-label={copy.close} onClick={() => setOperationError(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
      {editor ? (
        <AutomationEditor
          state={editor}
          copy={copy}
          pending={pending !== null}
          error={operationError}
          onClose={() => setEditor(null)}
          onSubmit={(draft) => void submitEditor(draft)}
        />
      ) : null}
      {deleteJob ? (
        <DeleteDialog
          job={deleteJob}
          copy={copy}
          pending={pending === `${deleteJob.id}:delete`}
          onClose={() => setDeleteJob(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </main>
  );
}

export function AutomationView({
  view: controlledView,
  defaultView = "tasks",
  onViewChange,
  ...props
}: AutomationViewProps) {
  const [internalView, setInternalView] = useState<AutomationViewId>(defaultView);
  const view = controlledView ?? internalView;
  const changeView = useCallback(
    (nextView: AutomationViewId) => {
      if (controlledView === undefined) setInternalView(nextView);
      onViewChange?.(nextView);
    },
    [controlledView, onViewChange],
  );
  return (
    <div className="hara-automation-view">
      <AutomationSidebar
        copy={props.copy}
        jobs={props.jobs}
        sessions={props.sessions}
        scheduler={props.scheduler}
        view={view}
        onViewChange={changeView}
      />
      <AutomationsPage {...props} view={view} />
    </div>
  );
}

export default AutomationView;
