import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentInfo,
  ComputerSettingsState,
  DecisionSettingsState,
  GatewayStatus,
  HaraClient,
  WeChatGroupDraft,
  WeChatGroupManagedTrigger,
  WeChatGroupMode,
  WeChatGroupPreview,
  WeChatGroupSceneStatus,
} from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const copy = {
  en: {
    groupTitle: "WeChat group Agent",
    groupDescription: "Attach one Hara Agent to the group currently visible in the local WeChat app. Assist mode prepares a reviewable draft; explicitly armed Managed mode may reply automatically inside that one bound group.",
    groupReady: "Ready to bind",
    groupActive: "Group attached",
    groupNeedsSetup: "Needs setup",
    helper: "Local recognition engine",
    helperHint: "Jev's audited WeChat perception core is built into Hara. Prepare its small private OCR runtime once; no separate Jev app or source checkout is required.",
    agent: "Agent for this group",
    agentHint: "The selected Agent handles text replies only. Group content cannot grant tools, approvals, or Computer Use access.",
    mode: "Reply mode",
    modeHint: "Assist is the safe default. Managed mode is armed only after binding and a second confirmation; the Agent cannot enable it itself.",
    assistMode: "Assist · review before sending",
    managedMode: "Managed · automatic sending",
    trigger: "Managed trigger",
    triggerHint: "A named @ mention is recommended. Replying to every message can be noisy and remains locally rate-limited.",
    mentionTrigger: "Only a named @ mention",
    allTrigger: "Every new incoming message",
    wakeName: "Group wake name",
    wakeNameHint: "Enter the name people will actually @ inside this group—not the WeChat group title. Leave it empty to use Hara and the selected Agent name.",
    wakeNamePlaceholder: "For example: Nanhara",
    managedUnavailable: "Update the bundled Hara Engine before enabling Managed mode.",
    confirmManaged: "Managed mode can automatically send model-generated text into this one visible group. Hara will ignore the message already on screen, rate-limit future sends, keep a redacted local audit, and pause on any uncertainty. Continue?",
    managedArmedMention: "Managed mode is armed. It will respond only to new messages containing the configured @ wake name",
    managedArmedAll: "Managed mode is armed. Every new incoming message in this bound group may trigger a reply.",
    managedPaused: "Managed mode paused",
    managedIgnoredMention: "The newest incoming message was observed but not sent because it did not contain the configured wake mention",
    managedProcessing: "A new message matched the trigger. The Agent is preparing the managed reply.",
    managedSent: "The latest managed reply was sent once and verified.",
    resumeManaged: "Confirm and resume Managed mode",
    resumingManaged: "Reattaching…",
    selectAgent: "Select an Agent",
    runtimeReady: "Runtime ready",
    runtimeMissing: "Runtime not prepared",
    permissions: "Local permissions",
    permissionsHint: "Screen Recording reads the visible conversation. Accessibility fills drafts and, only while Managed mode is explicitly armed, presses the verified Send button.",
    capture: "Screen recording",
    accessibility: "Accessibility",
    granted: "Granted",
    required: "Required",
    unknown: "Not checked",
    wechatRunning: "WeChat open",
    wechatClosed: "WeChat not found",
    wechatUnknown: "WeChat not checked",
    saveGroup: "Save group setup",
    savingGroup: "Saving…",
    prepare: "Prepare local runtime",
    preparing: "Preparing…",
    requestPermissions: "Request macOS permissions",
    requestingPermissions: "Waiting for macOS…",
    startGroup: "Attach current group",
    startingGroup: "Reading current group…",
    confirmGroup: "Confirm that the conversation currently open in WeChat is the group you want this Agent to assist. Hara will bind only that visible conversation.",
    saveAgentBeforeAttach: "Save the selected Agent before attaching the group.",
    stopGroup: "Detach",
    scan: "Read now",
    scanning: "Reading…",
    draft: "Ask Agent to draft",
    drafting: "Agent is drafting…",
    fill: "Fill into WeChat",
    filling: "Filling…",
    currentGroup: "Attached group",
    latestIncoming: "Newest incoming message",
    noPreview: "Open the target group in WeChat, keep a recent incoming text message visible, then click Attach current group.",
    draftTitle: "Agent draft",
    filled: "Draft filled into WeChat. It was not sent; review it in WeChat and send manually.",
    fillNeedsReview: "Input was attempted, but visual readback was uncertain. Check the WeChat draft before continuing; Hara has disabled repeat filling to prevent duplicate text.",
    saved: "Group scene settings saved.",
    prepared: "Local WeChat recognition runtime is ready.",
    attached: "The visible conversation is now attached. Switching to another chat invalidates the draft.",
    safetyTitle: "Local group boundary",
    safety: "This scene observes only the currently visible WeChat conversation. Screenshots are never returned to Desktop or retained; an off-Space window may require an owner-only temporary capture that is deleted before recognition returns. Assist mode never auto-sends. Managed mode works only for the confirmed bound group, uses trigger/rate/deduplication checks, records no message text in its audit, and pauses on uncertainty.",
    unavailable: "Update the bundled Hara Engine to use the local WeChat group Agent scene.",
    noAgents: "Create or hire a Hara Agent first.",
    remoteTitle: "WeChat owner remote control",
    remoteDescription: "Use Hara's official WeChat connector for the QR-linked owner's private chat. It is separate from the local group Agent scene.",
    ready: "Ready",
    needsSetup: "Needs setup",
    loading: "Loading…",
    channel: "Official WeChat connection",
    channelHint: "This path is the QR-linked owner's private chat. It is not the local WeChat group observer.",
    online: "Online",
    starting: "Starting…",
    stopped: "Stopped",
    missing: "Not linked",
    external: "Managed outside Desktop",
    computer: "Computer Use boundary",
    computerHint: "Remote owner messages can inspect or operate only the level and apps you explicitly allow.",
    guard: "Jev Action Guard",
    guardHint: "The same global guard evaluates consequential actions regardless of whether work starts in Desktop, CLI, Mobile, or WeChat.",
    builtIn: "Built-in guard",
    start: "Start owner remote control",
    stop: "Stop",
    stopping: "Stopping…",
    test: "Test owner connection",
    testing: "Sending…",
    refresh: "Refresh",
    bind: "Bind WeChat",
    openComputer: "Configure Computer Use",
    openGuard: "Configure Jev & API Key",
    testSent: "The fixed diagnostic message was delivered to the QR-linked owner chat.",
    testHint: "The test uses only Hara's fixed text. Send Hara a fresh message from the QR-linked owner chat first so the official connector has a current reply context.",
    remoteSafety: "Owner private-chat tasks enter the normal Hara task engine. Starting this path does not widen Computer Use permissions and does not enable automatic posting into WeChat groups.",
    lifecycleUnavailable: "Update the bundled Hara Engine to start and test owner remote control from Desktop.",
  },
  zh: {
    groupTitle: "微信群 Agent",
    groupDescription: "把一个 Hara Agent 接入本机微信当前打开的群聊。辅助模式先给你检查草稿；只有明确开启并确认托管模式后，才会在绑定的这一个群里自动回复。",
    groupReady: "可以绑定",
    groupActive: "群聊已接入",
    groupNeedsSetup: "需要配置",
    helper: "本机识别内核",
    helperHint: "Hara 已内置审计过的 Jev 微信识别内核；首次只需准备一套精简的私有 OCR 运行环境，无需另装 Jev 或选择源码目录。",
    agent: "接入这个群的 Agent",
    agentHint: "所选 Agent 只负责文字回复。群消息不能授予工具、审批或 Computer Use 权限。",
    mode: "回复模式",
    modeHint: "默认使用辅助模式。托管模式必须在绑定群聊时再次确认，Agent 自己不能开启。",
    assistMode: "辅助模式 · 检查后再发送",
    managedMode: "托管模式 · 自动发送",
    trigger: "托管触发条件",
    triggerHint: "建议只响应明确的 @ 唤醒名称；响应所有新消息容易打扰群聊，且仍受本机限流保护。",
    mentionTrigger: "只响应指定的 @ 唤醒名称",
    allTrigger: "响应每一条新收到的消息",
    wakeName: "群内唤醒名称",
    wakeNameHint: "填写群成员实际会 @ 的名称（不是微信群名）；留空时使用 Hara 和所选 Agent 的名称。",
    wakeNamePlaceholder: "例如：小南",
    managedUnavailable: "请先更新内置 Hara Engine，再开启托管模式。",
    confirmManaged: "托管模式会把模型生成的文字自动发送到当前这一个群。Hara 会忽略绑定时屏幕上已有的消息，限制发送频率、保留不含正文的本机审计，并在任何不确定情况自动暂停。确定继续吗？",
    managedArmedMention: "托管已启用；当前只响应之后新出现且包含指定 @ 唤醒名称的消息",
    managedArmedAll: "托管已启用；当前群之后收到的每一条新消息都可能触发回复。",
    managedPaused: "托管模式已暂停",
    managedIgnoredMention: "已识别到最新群消息，但没有发送：消息中没有配置的唤醒名称",
    managedProcessing: "新消息已匹配触发条件，Agent 正在生成托管回复。",
    managedSent: "最近一次托管回复已单次发送并完成验证。",
    resumeManaged: "重新确认并恢复托管",
    resumingManaged: "正在重新接入…",
    selectAgent: "选择一个 Agent",
    runtimeReady: "运行环境已就绪",
    runtimeMissing: "运行环境未准备",
    permissions: "本机权限",
    permissionsHint: "屏幕录制用于读取当前可见会话；辅助功能用于填入草稿，并且只在你明确启用托管模式期间点击已验证的“发送”按钮。",
    capture: "屏幕录制",
    accessibility: "辅助功能",
    granted: "已允许",
    required: "需要允许",
    unknown: "尚未检查",
    wechatRunning: "微信已打开",
    wechatClosed: "未找到微信",
    wechatUnknown: "尚未检查微信",
    saveGroup: "保存群聊配置",
    savingGroup: "正在保存…",
    prepare: "准备本机运行环境",
    preparing: "正在准备…",
    requestPermissions: "请求 macOS 权限",
    requestingPermissions: "等待 macOS 授权…",
    startGroup: "接入当前群聊",
    startingGroup: "正在读取当前群…",
    confirmGroup: "请确认微信当前打开的确实是你要接入 Agent 的群聊。Hara 只会绑定这个当前可见会话。",
    saveAgentBeforeAttach: "请先保存所选 Agent，再接入当前群聊。",
    stopGroup: "断开群聊",
    scan: "立即读取",
    scanning: "正在读取…",
    draft: "让 Agent 拟回复",
    drafting: "Agent 正在拟回复…",
    fill: "填入微信",
    filling: "正在填入…",
    currentGroup: "已接入群聊",
    latestIncoming: "最新收到的消息",
    noPreview: "先在微信里打开目标群，并让最近一条收到的文字消息保持可见，再点“接入当前群聊”。",
    draftTitle: "Agent 回复草稿",
    filled: "草稿已填入微信，但没有发送；请在微信里检查后手动发送。",
    fillNeedsReview: "已经尝试写入，但画面回读不确定。请直接检查微信输入框；Hara 已禁用重复填入，避免文字被写入两次。",
    saved: "微信群场景配置已保存。",
    prepared: "本机微信识别运行环境已就绪。",
    attached: "当前可见会话已接入；切换到其他聊天会立即让旧草稿失效。",
    safetyTitle: "本机群聊边界",
    safety: "该场景只观察微信当前可见的会话；截图不会返回 Desktop 或被留存，后台窗口必要时会使用一次性私有临时截图并在识别返回前删除。辅助模式绝不自动发送；托管模式只作用于再次确认的绑定群，并带触发条件、限流、去重和不含消息正文的本机审计，任何不确定都会自动暂停。",
    unavailable: "请更新内置 Hara Engine，之后才能使用微信群 Agent 场景。",
    noAgents: "请先创建或聘用一个 Hara Agent。",
    remoteTitle: "微信所有者私聊远程控制",
    remoteDescription: "Hara 官方微信连接仅用于扫码绑定者的私聊远程工作，与本机微信群 Agent 是两条独立通道。",
    ready: "可以使用",
    needsSetup: "需要配置",
    loading: "正在读取…",
    channel: "官方微信连接",
    channelHint: "这条通道是扫码绑定者的私聊，不是本机微信群观察器。",
    online: "已在线",
    starting: "正在启动…",
    stopped: "未启动",
    missing: "尚未绑定",
    external: "由 Desktop 外部管理",
    computer: "Computer Use 边界",
    computerHint: "所有者私聊发来的任务，只能查看或操作你明确允许的级别与应用。",
    guard: "Jev 动作防护",
    guardHint: "无论任务来自 Desktop、CLI、Mobile 还是微信，高影响动作都使用同一套全局判断。",
    builtIn: "Hara 内置防护",
    start: "启动私聊远程控制",
    stop: "停止",
    stopping: "正在停止…",
    test: "测试所有者连接",
    testing: "正在发送…",
    refresh: "刷新",
    bind: "绑定微信",
    openComputer: "配置 Computer Use 权限",
    openGuard: "配置 Jev 与 API Key",
    testSent: "固定诊断消息已送达扫码绑定者的私聊。",
    testHint: "测试只使用 Hara 固定文字。请先从扫码绑定者私聊给 Hara 发一条新消息，让官方连接取得最新回复上下文。",
    remoteSafety: "所有者私聊任务进入正常 Hara 任务引擎。启动这条通道不会扩大 Computer Use 权限，也不会开启微信群自动发言。",
    lifecycleUnavailable: "请更新 Desktop 内置 Hara Engine，之后可直接启动并测试私聊远程控制。",
  },
} as const;

function normalizeWakeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/^@\s*/u, "").replace(/\s+/gu, " ");
}

function groupErrorMessage(error: unknown, locale: Locale): string {
  const message = error instanceof Error ? error.message : String(error);
  if (locale !== "zh") return message;
  if (message.includes("a verified WeChat Send button was not available")) {
    return "当前微信在输入框为空时会禁用“发送”按钮；新版 Hara 会先验证输入区，待草稿填入、按钮启用后再核验发送，请重新接入。";
  }
  if (message.includes("a verified WeChat Send control was not available after filling")) {
    return "草稿已安全填入，但没有识别到可信的“发送”控件；托管已暂停，请检查微信草稿，Hara 不会重复发送。";
  }
  if (message.includes("managed send could not verify the WeChat input area")) {
    return "无法验证当前微信输入区，托管没有启用。请保持目标群与输入区完整可见后重试。";
  }
  if (message.includes("the WeChat input already contains a user draft")) {
    return "微信输入框里已有草稿；为避免覆盖或误发，托管已停止。请先处理现有草稿。";
  }
  if (message.includes("the visible WeChat conversation changed")) {
    return "当前可见的微信会话已经变化；托管已停止，请重新打开并接入目标群。";
  }
  if (message.includes("no readable incoming group message is visible yet")) {
    return "当前画面还没有可识别的群内来信；请让最近一条收到的文字消息保持可见后重试。";
  }
  if (message.includes("grant Hara Screen Recording permission")) {
    return "请先允许 Hara 使用屏幕录制权限，然后重试。";
  }
  return message;
}

type BusyAction =
  | "remote-start" | "remote-stop" | "remote-test"
  | "group-save" | "group-prepare" | "group-permissions" | "group-start" | "group-stop"
  | "group-scan" | "group-draft" | "group-fill";

export function WeChatSceneSettings({
  client,
  cwd,
  locale,
  onOpenConnections,
  onOpenComputerUse,
  onOpenActionGuard,
}: {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  onOpenConnections: () => void;
  onOpenComputerUse: () => void;
  onOpenActionGuard: () => void;
}) {
  const words = copy[locale];
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [computer, setComputer] = useState<ComputerSettingsState | null>(null);
  const [guard, setGuard] = useState<DecisionSettingsState | null>(null);
  const [group, setGroup] = useState<WeChatGroupSceneStatus | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groupAgentRef, setGroupAgentRef] = useState("");
  const [groupMode, setGroupMode] = useState<WeChatGroupMode>("assist");
  const [managedTrigger, setManagedTrigger] = useState<WeChatGroupManagedTrigger>("mention");
  const [managedMentionName, setManagedMentionName] = useState("");
  const [preview, setPreview] = useState<WeChatGroupPreview | null>(null);
  const [draft, setDraft] = useState<WeChatGroupDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<{ tone: "success" | "error"; title: string } | null>(null);
  const [groupNotice, setGroupNotice] = useState<{ tone: "success" | "warning" | "error"; title: string } | null>(null);
  const polling = useRef(false);
  const draftRef = useRef<WeChatGroupDraft | null>(null);
  const groupSettingsDirty = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const load = useCallback(async (quiet = false) => {
    if (!client) {
      setGateway(null);
      setComputer(null);
      setGuard(null);
      setGroup(null);
      setAgents([]);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [gateways, computerSettings, decisionSettings, groupStatus, catalog] = await Promise.all([
        client.listGatewayStatuses(),
        client.getComputerSettings(cwd),
        client.getDecisionSettings(cwd),
        client.getWechatGroupScene(),
        client.listAgents({ cwd }),
      ]);
      setGateway(gateways?.find((item) => item.platform === "weixin") ?? null);
      setComputer(computerSettings);
      setGuard(decisionSettings);
      setGroup(groupStatus);
      const available = (catalog?.agents ?? []).filter((agent) => agent.allowedActions.includes("chat"));
      setAgents(available);
      setGroupAgentRef((current) => current || groupStatus?.agentRef || available[0]?.ref || "");
      if (!groupSettingsDirty.current) {
        setGroupMode(groupStatus?.mode ?? "assist");
        setManagedTrigger(groupStatus?.managedTrigger ?? "mention");
        setManagedMentionName(groupStatus?.managedMentionName ?? "");
      }
    } catch (error: unknown) {
      if (!quiet) setRemoteNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [client, cwd]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    // Managed mode is polled by the Engine so it keeps working outside this Settings surface. Avoid a
    // competing renderer scan loop against the same local WeChat window.
    if (!client || !group?.active || group.mode === "managed") return;
    let cancelled = false;
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const next = await client.scanWechatGroupScene(cwd);
        if (cancelled) return;
        setPreview((current) => (!current || next.changed || !draftRef.current ? next : current));
        if (next.changed) setDraft(null);
      } catch (error: unknown) {
        if (cancelled) return;
        setGroupNotice((current) => current?.tone === "error"
          ? current
          : { tone: "error", title: error instanceof Error ? error.message : String(error) });
      } finally {
        polling.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, cwd, group?.active, group?.mode]);

  const controlRemote = async (action: "start" | "stop") => {
    if (!client || busy) return;
    setBusy(action === "start" ? "remote-start" : "remote-stop");
    setRemoteNotice(null);
    try {
      const next = action === "start" ? await client.startGateway("weixin") : await client.stopGateway("weixin");
      if (next) setGateway(next);
      await load(true);
    } catch (error: unknown) {
      setRemoteNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const testRemote = async () => {
    if (!client || busy) return;
    setBusy("remote-test");
    setRemoteNotice(null);
    try {
      const result = await client.testGateway("weixin");
      if (!result?.delivered) throw new Error(words.lifecycleUnavailable);
      setRemoteNotice({ tone: "success", title: words.testSent });
    } catch (error: unknown) {
      setRemoteNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const saveGroup = async () => {
    if (!client || busy || !groupAgentRef) return;
    setBusy("group-save");
    setGroupNotice(null);
    try {
      const next = await client.saveWechatGroupScene(
        groupAgentRef,
        groupMode,
        managedTrigger,
        managedMentionName,
      );
      groupSettingsDirty.current = false;
      setGroup(next);
      setManagedMentionName(next.managedMentionName ?? normalizeWakeName(managedMentionName));
      setPreview(null);
      setDraft(null);
      setGroupNotice({ tone: "success", title: words.saved });
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const prepareGroup = async () => {
    if (!client || busy) return;
    setBusy("group-prepare");
    setGroupNotice(null);
    try {
      const next = await client.prepareWechatGroupScene();
      setGroup(next);
      setGroupNotice({ tone: "success", title: words.prepared });
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const requestGroupPermissions = async () => {
    if (!client || busy) return;
    setBusy("group-permissions");
    setGroupNotice(null);
    try {
      setGroup(await client.requestWechatGroupPermissions());
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const startGroup = async () => {
    if (!client || busy) return;
    if (!window.confirm(words.confirmGroup)) return;
    if (groupMode === "managed" && !window.confirm(words.confirmManaged)) return;
    setBusy("group-start");
    setGroupNotice(null);
    try {
      const result = await client.startWechatGroupScene(true, groupMode === "managed", cwd);
      setGroup(result.status);
      setPreview(result.preview);
      setDraft(null);
      setGroupNotice({ tone: "success", title: words.attached });
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const stopGroup = async () => {
    if (!client || busy) return;
    setBusy("group-stop");
    setGroupNotice(null);
    try {
      setGroup(await client.stopWechatGroupScene());
      setPreview(null);
      setDraft(null);
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const scanGroup = async () => {
    if (!client || busy) return;
    setBusy("group-scan");
    setGroupNotice(null);
    try {
      const next = await client.scanWechatGroupScene(cwd);
      setPreview(next);
      if (next.changed) setDraft(null);
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const draftReply = async () => {
    if (!client || busy || !preview) return;
    setBusy("group-draft");
    setGroupNotice(null);
    try {
      setDraft(await client.draftWechatGroupReply(preview.scanId));
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const fillDraft = async () => {
    if (!client || busy || !draft) return;
    setBusy("group-fill");
    setGroupNotice(null);
    try {
      const result = await client.fillWechatGroupDraft(draft.draftId);
      setDraft(null);
      setGroupNotice(result.reviewRequired
        ? { tone: "warning", title: words.fillNeedsReview }
        : { tone: "success", title: words.filled });
    } catch (error: unknown) {
      setGroupNotice({ tone: "error", title: groupErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  };

  const lifecycle = Boolean(client?.supports("settings.gateways.start") && client.supports("settings.gateways.stop"));
  const canTest = Boolean(client?.supports("settings.gateways.test"));
  const groupSupported = Boolean(client?.supports("settings.wechat-group.get"));
  const managedSupported = Boolean(client?.supportsFeature("wechat-group.managed-send.v1"));
  const canRequestGroupPermissions = Boolean(client?.supports("settings.wechat-group.permissions.request"));
  const connected = gateway?.running && gateway.runtimeState === "connected";
  const ready = connected && gateway?.directMessageAccess !== "blocked";
  const channelLabel = !gateway?.configured
    ? words.missing
    : connected ? words.online : gateway.running ? words.starting : words.stopped;
  const computerLabel = computer
    ? `${computer.mode} · ${computer.apps.length ? computer.apps.join(", ") : "no apps"}`
    : "—";
  const guardLabel = guard?.engine === "typesafe"
    ? `TypeSafe · ${guard.mode} · ${guard.credential === "missing" ? words.missing : guard.model}`
    : words.builtIn;
  const badgeTone = useMemo(() => ready ? "success" as const : "warning" as const, [ready]);
  const groupBadgeTone = group?.active || group?.helper === "ready" ? "success" as const : "warning" as const;
  const groupSettingsSaved = Boolean(
    group?.configured
    && groupAgentRef
    && group?.agentRef === groupAgentRef
    && (group.mode ?? "assist") === groupMode
    && (group.managedTrigger ?? "mention") === managedTrigger
    && (group.managedMentionName ?? "") === normalizeWakeName(managedMentionName),
  );
  const managedOutcomeNotice = group?.lastManagedEvent === "ignored" && group.lastManagedDetail === "mention_required"
    ? {
        tone: "warning" as const,
        title: `${words.managedIgnoredMention}${group.managedMentionName ? ` @${group.managedMentionName}` : ""}${locale === "zh" ? "。" : "."}`,
      }
    : group?.lastManagedEvent === "processing"
      ? { tone: "neutral" as const, title: words.managedProcessing }
      : group?.lastManagedEvent === "sent"
        ? { tone: "success" as const, title: words.managedSent }
        : null;
  const managedArmedTitle = group?.managedTrigger === "mention"
    ? `${words.managedArmedMention}${group.managedMentionName ? ` @${group.managedMentionName}` : ""}${locale === "zh" ? "。" : "."}`
    : words.managedArmedAll;
  const permissionLabel = (value: "granted" | "required" | "unknown" | undefined) => (
    value === "granted" ? words.granted : value === "required" ? words.required : words.unknown
  );
  const helperLabel = group?.helper === "ready"
    ? words.runtimeReady
    : group?.helper === "runtime-missing" ? words.runtimeMissing
      : group?.helperLabel || words.groupNeedsSetup;

  return (
    <>
      <SettingsCard
        title={words.groupTitle}
        description={words.groupDescription}
        aside={<SettingsBadge tone={groupBadgeTone}>{group?.active ? words.groupActive : group?.helper === "ready" ? words.groupReady : words.groupNeedsSetup}</SettingsBadge>}
      >
        {loading ? <div className="wechat-scene-loading" role="status">{words.loading}</div> : (
          <>
            <SettingsItem title={words.helper} description={words.helperHint}>
              <div className="settings-choice">
                <SettingsBadge tone={group?.helper === "ready" ? "success" : "warning"}>{helperLabel}</SettingsBadge>
                {group?.helperLabel && <span className="settings-inline-detail">{group.helperLabel}</span>}
              </div>
            </SettingsItem>
            <SettingsItem title={words.agent} description={words.agentHint}>
              <select value={groupAgentRef} onChange={(event) => {
                groupSettingsDirty.current = true;
                setGroupAgentRef(event.currentTarget.value);
              }} aria-label={words.agent}>
                <option value="">{agents.length ? words.selectAgent : words.noAgents}</option>
                {agents.map((agent) => <option key={agent.ref} value={agent.ref}>{agent.name} · {agent.description}</option>)}
              </select>
            </SettingsItem>
            <SettingsItem title={words.mode} description={words.modeHint}>
              <div className="wechat-mode-switch" role="group" aria-label={words.mode}>
                <button
                  type="button"
                  className={groupMode === "assist" ? "selected" : ""}
                  aria-pressed={groupMode === "assist"}
                  onClick={() => {
                    groupSettingsDirty.current = true;
                    setGroupMode("assist");
                  }}
                >
                  {words.assistMode}
                </button>
                <button
                  type="button"
                  className={groupMode === "managed" ? "selected managed" : "managed"}
                  aria-pressed={groupMode === "managed"}
                  disabled={!managedSupported}
                  onClick={() => {
                    groupSettingsDirty.current = true;
                    setGroupMode("managed");
                  }}
                >
                  {words.managedMode}
                </button>
              </div>
            </SettingsItem>
            {groupMode === "managed" && (
              <SettingsItem title={words.trigger} description={words.triggerHint}>
                <select value={managedTrigger} onChange={(event) => {
                  groupSettingsDirty.current = true;
                  setManagedTrigger(event.currentTarget.value as WeChatGroupManagedTrigger);
                }} aria-label={words.trigger}>
                  <option value="mention">{words.mentionTrigger}</option>
                  <option value="all">{words.allTrigger}</option>
                </select>
              </SettingsItem>
            )}
            {groupMode === "managed" && managedTrigger === "mention" && (
              <SettingsItem title={words.wakeName} description={words.wakeNameHint}>
                <div className="wechat-wake-name">
                  <span aria-hidden="true">@</span>
                  <input
                    value={managedMentionName}
                    maxLength={32}
                    placeholder={words.wakeNamePlaceholder}
                    aria-label={words.wakeName}
                    onChange={(event) => {
                      groupSettingsDirty.current = true;
                      setManagedMentionName(event.currentTarget.value.replace(/^[@＠]\s*/u, ""));
                    }}
                  />
                </div>
              </SettingsItem>
            )}
            <SettingsItem title={words.permissions} description={words.permissionsHint}>
              <div className="settings-choice">
                <SettingsBadge tone={group?.screenCapture === "granted" ? "success" : "warning"}>{words.capture}: {permissionLabel(group?.screenCapture)}</SettingsBadge>
                <SettingsBadge tone={group?.accessibility === "granted" ? "success" : "warning"}>{words.accessibility}: {permissionLabel(group?.accessibility)}</SettingsBadge>
                <SettingsBadge tone={group?.wechat === "running" ? "success" : "warning"}>
                  {group?.wechat === "running" ? words.wechatRunning : group?.wechat === "not-running" ? words.wechatClosed : words.wechatUnknown}
                </SettingsBadge>
              </div>
            </SettingsItem>
            <div className="wechat-scene-actions">
              <button type="button" className="ghost" disabled={!groupSupported || busy !== null || !groupAgentRef || (groupMode === "managed" && !managedSupported)} onClick={() => void saveGroup()}>
                {busy === "group-save" ? words.savingGroup : words.saveGroup}
              </button>
              {group?.helper === "runtime-missing" && (
                <button type="button" className="ghost" disabled={busy !== null} onClick={() => void prepareGroup()}>
                  {busy === "group-prepare" ? words.preparing : words.prepare}
                </button>
              )}
              {canRequestGroupPermissions && group?.helper === "ready" && (group.screenCapture !== "granted" || group.accessibility !== "granted") && (
                <button type="button" className="ghost" disabled={busy !== null} onClick={() => void requestGroupPermissions()}>
                  {busy === "group-permissions" ? words.requestingPermissions : words.requestPermissions}
                </button>
              )}
              {!group?.active ? (
                <button type="button" disabled={!groupSupported || group?.helper !== "ready" || group?.screenCapture !== "granted" || !groupSettingsSaved || busy !== null} onClick={() => void startGroup()}>
                  {busy === "group-start" ? words.startingGroup : words.startGroup}
                </button>
              ) : (
                <>
                  {group.mode === "managed" && !group.managedArmed && (
                    <button type="button" disabled={!groupSettingsSaved || group.helper !== "ready" || group.screenCapture !== "granted" || busy !== null} onClick={() => void startGroup()}>
                      {busy === "group-start" ? words.resumingManaged : words.resumeManaged}
                    </button>
                  )}
                  <button type="button" className="ghost" disabled={busy !== null} onClick={() => void scanGroup()}>{busy === "group-scan" ? words.scanning : words.scan}</button>
                  <button type="button" className="ghost" disabled={busy !== null} onClick={() => void stopGroup()}>{words.stopGroup}</button>
                </>
              )}
            </div>
            {!group?.active && groupAgentRef && !groupSettingsSaved && (
              <SettingsNotice tone="neutral" title={words.saveAgentBeforeAttach} />
            )}
            {groupMode === "managed" && !managedSupported && (
              <SettingsNotice tone="warning" title={words.managedUnavailable} />
            )}
            {group?.mode === "managed" && group.active && group.managedArmed && (
              <SettingsNotice tone="success" title={managedArmedTitle} />
            )}
            {group?.mode === "managed" && group.active && managedOutcomeNotice && (
              <SettingsNotice tone={managedOutcomeNotice.tone} title={managedOutcomeNotice.title} />
            )}
            {group?.mode === "managed" && group.managedPausedReason && (
              <SettingsNotice tone="warning" title={`${words.managedPaused}: ${group.managedPausedReason}`} />
            )}
            <div className="wechat-group-workbench">
              {preview ? (
                <>
                  <div className="wechat-group-observation">
                    <span>{words.currentGroup}</span>
                    <strong>{preview.conversation}</strong>
                    <span>{words.latestIncoming}</span>
                    <p>{preview.latestIncoming?.sender ? `${preview.latestIncoming.sender}: ` : ""}{preview.latestIncoming?.text ?? "—"}</p>
                  </div>
                  {group?.mode !== "managed" && (
                    <button type="button" disabled={busy !== null} onClick={() => void draftReply()}>{busy === "group-draft" ? words.drafting : words.draft}</button>
                  )}
                </>
              ) : <p className="wechat-group-empty">{words.noPreview}</p>}
              {draft && (
                <div className="wechat-group-draft">
                  <label htmlFor="wechat-group-draft">{words.draftTitle}</label>
                  <textarea id="wechat-group-draft" readOnly value={draft.text} />
                  <button type="button" disabled={busy !== null} onClick={() => void fillDraft()}>{busy === "group-fill" ? words.filling : words.fill}</button>
                </div>
              )}
            </div>
            {groupNotice && <SettingsNotice tone={groupNotice.tone} title={groupNotice.title} />}
            {!groupSupported && <SettingsNotice tone="warning" title={words.unavailable} />}
            <SettingsNotice tone="neutral" title={words.safetyTitle}>{words.safety}</SettingsNotice>
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title={words.remoteTitle}
        description={words.remoteDescription}
        aside={<SettingsBadge tone={badgeTone}>{ready ? words.ready : words.needsSetup}</SettingsBadge>}
      >
        {loading ? <div className="wechat-scene-loading" role="status">{words.loading}</div> : (
          <>
            <SettingsItem title={words.channel} description={words.channelHint}>
              <div className="settings-choice">
                {gateway?.running && gateway.managedByServe === false && <SettingsBadge>{words.external}</SettingsBadge>}
                <SettingsBadge tone={connected ? "success" : "warning"}>{channelLabel}</SettingsBadge>
                {!gateway?.configured ? (
                  <button type="button" onClick={onOpenConnections}>{words.bind}</button>
                ) : !gateway.running ? (
                  <button type="button" disabled={!lifecycle || busy !== null} onClick={() => void controlRemote("start")}>
                    {busy === "remote-start" ? words.starting : words.start}
                  </button>
                ) : gateway.managedByServe ? (
                  <button type="button" className="ghost" disabled={!lifecycle || busy !== null} onClick={() => void controlRemote("stop")}>
                    {busy === "remote-stop" ? words.stopping : words.stop}
                  </button>
                ) : null}
              </div>
            </SettingsItem>
            <SettingsItem title={words.computer} description={words.computerHint}>
              <div className="settings-choice">
                <SettingsBadge tone={computer?.mode === "off" ? "warning" : "success"}>{computerLabel}</SettingsBadge>
                <button type="button" className="ghost" onClick={onOpenComputerUse}>{words.openComputer}</button>
              </div>
            </SettingsItem>
            <SettingsItem title={words.guard} description={words.guardHint}>
              <div className="settings-choice">
                <SettingsBadge tone={guard?.engine === "typesafe" && guard.credential !== "missing" ? "success" : "warning"}>{guardLabel}</SettingsBadge>
                <button type="button" className="ghost" onClick={onOpenActionGuard}>{words.openGuard}</button>
              </div>
            </SettingsItem>
            <div className="wechat-scene-actions">
              <button type="button" className="ghost" disabled={busy !== null} onClick={() => void load()}>{words.refresh}</button>
              <button type="button" disabled={!canTest || !gateway?.configured || busy !== null} onClick={() => void testRemote()}>
                {busy === "remote-test" ? words.testing : words.test}
              </button>
            </div>
            {remoteNotice && <SettingsNotice tone={remoteNotice.tone} title={remoteNotice.title} />}
            {!lifecycle && <SettingsNotice tone="warning" title={words.lifecycleUnavailable} />}
            <SettingsNotice tone="neutral" title={words.testHint}>{words.remoteSafety}</SettingsNotice>
          </>
        )}
      </SettingsCard>
    </>
  );
}
