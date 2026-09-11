import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GatewayLoginSnapshot,
  type GatewayStatus,
  type HaraClient,
} from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const REFRESH_MS = 120_000;
const LOGIN_POLL_MS = 1_000;
const FEISHU_APP_ID_PATTERN = /^cli_[A-Za-z0-9_-]{4,123}$/u;
const FEISHU_APP_SECRET_PATTERN = /^[^\s\u0000-\u001f\u007f]{8,512}$/u;
const TERMINAL_LOGIN_PHASES = new Set<GatewayLoginSnapshot["phase"]>([
  "confirmed",
  "cancelled",
  "timed-out",
  "failed",
]);

const words = {
  en: {
    title: "Chat bots",
    subtitle: "Live, redacted status from the local Hara engine. It refreshes every two minutes without calling a model or consuming tokens.",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    connected: "Connected",
    starting: "Starting",
    degraded: "Needs attention",
    stopped: "Stopped",
    notConfigured: "Not configured",
    ready: "Credentials ready",
    processOnly: "Credentials held by the gateway process",
    missing: "Credentials missing",
    incomplete: "Credentials incomplete",
    unreadable: "State unreadable",
    lastSignal: "Last verified activity",
    never: "No verified activity yet",
    pid: "Local process",
    unavailable: "Update the bundled Hara engine to see bot connection status here.",
    loadFailed: "Bot status could not be read",
    weixinLogin: "Run `hara gateway --platform weixin --login`, then start the WeChat gateway.",
    weixinDesktopLogin: "Use Log in here to link WeChat without opening a terminal.",
    feishuConfigure: "Add the Feishu app credential below. Hara stores it privately and uses it without exposing it to chats or scripts.",
    feishuConfigureLegacy: "Update the bundled Hara engine to add Feishu credentials here, or configure the trusted gateway launch environment.",
    feishuCredentialTitle: "Feishu private connection",
    feishuCredentialEyebrow: "ENGINE-OWNED PRIVATE STATE",
    feishuAppId: "App ID",
    feishuAppSecret: "App Secret",
    feishuRegion: "Service region",
    feishuChina: "Feishu · China",
    feishuGlobal: "Lark · Global",
    feishuSave: "Save privately",
    feishuReplace: "Replace credential",
    feishuRemove: "Remove stored credential",
    feishuStored: "Stored by Hara ✓",
    feishuEnvironment: "Managed by launch environment",
    feishuProcessOnly: "Held by the running gateway",
    feishuSafety: "Write-only: values are cleared from this screen after submission and never returned by the Engine. Automations use the brokered Feishu channel, not raw credentials.",
    feishuEnvironmentHint: "Desktop will not overwrite a launch-environment or running-process credential. Stop that gateway and remove the environment override before switching to Hara-managed storage.",
    feishuSaved: "Feishu credential saved. New scheduled deliveries use it immediately; restart an already-running gateway to switch its connection.",
    feishuRemoved: "The Hara-stored Feishu credential was removed. Stop a running gateway to drop its in-memory connection; revoke the app secret in Feishu if access must end immediately.",
    feishuSaveFailed: "The credential could not be saved securely. Check the local Hara state permissions and try again.",
    feishuRemoveFailed: "The stored credential could not be removed securely.",
    feishuRemoveConfirm: "Remove the Feishu credential stored by Hara? Scheduled Feishu delivery will pause until another trusted credential is configured.",
    feishuCredentialUnavailable: "Update the bundled Hara engine to manage Feishu credentials from Desktop.",
    repairState: "Repair the private connector state, then authenticate again.",
    start: "Start this connector with `hara gateway --platform {platform}`.",
    inspect: "Inspect the redacted gateway log; re-authenticate or restart if the error persists.",
    logIn: "Log in",
    logInAgain: "Log in again",
    cancel: "Cancel",
    retry: "Try again",
    loginUnavailable: "Update the bundled Hara engine to log in from Desktop.",
    loginFailed: "WeChat login could not be started",
    qrFailed: "The QR code could not be rendered locally.",
    linkEyebrow: "WECHAT / DEVICE LINK",
    waitingTitle: "Scan with WeChat",
    waitingBody: "Open WeChat on your phone, scan this code, then confirm the login on the phone.",
    scannedTitle: "Scanned — confirm on your phone",
    scannedBody: "Keep this window open while WeChat finishes linking this device.",
    confirmedTitle: "WeChat linked",
    confirmedBody: "Credentials were saved by the local Hara engine. The QR and private credential never leave this computer.",
    cancelledTitle: "Login cancelled",
    cancelledBody: "No background login process was left running.",
    timedOutTitle: "QR code timed out",
    timedOutBody: "Start again to create a fresh code.",
    failedTitle: "WeChat could not be linked",
    failedBody: "The platform rejected the login or returned an invalid response. Try again.",
    networkHint: "The WeChat service is temporarily unreachable. Hara will keep retrying while this code is active.",
    expiredHint: "The QR code expired repeatedly. Start again for a fresh session.",
    localStateHint: "Hara could not save the private credential. Check the permissions of your local Hara state directory, then try again.",
    qrAlt: "WeChat login QR code",
    qrLoading: "Preparing QR code…",
    expires: "Session ends",
    localOnly: "Generated locally · not uploaded",
  },
  zh: {
    title: "聊天机器人",
    subtitle: "读取本机 Hara 引擎的脱敏实时状态；每两分钟刷新一次，不调用模型，也不消耗 Token。",
    refresh: "刷新",
    refreshing: "正在刷新…",
    connected: "已连接",
    starting: "正在连接",
    degraded: "需要处理",
    stopped: "未运行",
    notConfigured: "未配置",
    ready: "凭据可用",
    processOnly: "凭据由网关进程持有",
    missing: "缺少凭据",
    incomplete: "凭据不完整",
    unreadable: "状态不可读",
    lastSignal: "最近确认活动",
    never: "尚无已确认活动",
    pid: "本机进程",
    unavailable: "请更新 Desktop 内置的 Hara 引擎，之后可在这里查看机器人连接状态。",
    loadFailed: "无法读取机器人状态",
    weixinLogin: "运行 `hara gateway --platform weixin --login`，然后启动微信网关。",
    weixinDesktopLogin: "点击“登录微信”即可在 Desktop 内完成绑定，无需打开终端。",
    feishuConfigure: "请在下方添加飞书应用凭据；Hara 会在本机私有保存并直接使用，不向对话或脚本暴露。",
    feishuConfigureLegacy: "请更新 Desktop 内置的 Hara 引擎后在此添加飞书凭据，或在受信任的网关启动环境中配置。",
    feishuCredentialTitle: "飞书私有连接",
    feishuCredentialEyebrow: "由本机引擎私有保存",
    feishuAppId: "App ID",
    feishuAppSecret: "App Secret",
    feishuRegion: "服务区域",
    feishuChina: "飞书 · 中国",
    feishuGlobal: "Lark · 全球",
    feishuSave: "私密保存",
    feishuReplace: "替换凭据",
    feishuRemove: "移除已存凭据",
    feishuStored: "Hara 已保存 ✓",
    feishuEnvironment: "由启动环境管理",
    feishuProcessOnly: "由运行中的网关持有",
    feishuSafety: "只写不读：提交后立即清空本页输入，引擎绝不回传凭据。自动化只调用受控飞书通道，不向 Agent 或脚本提供明文。",
    feishuEnvironmentHint: "Desktop 不会覆盖启动环境或运行进程持有的凭据。若要改由 Hara 保存，请先停止对应网关并移除环境覆盖。",
    feishuSaved: "飞书凭据已保存。新的定时投递会立即使用；已运行的网关需重启后切换连接。",
    feishuRemoved: "Hara 私有保存的飞书凭据已移除。若网关仍在运行，请停止它以断开内存中的现有连接；如需立即撤销访问，请同时在飞书开放平台重置 App Secret。",
    feishuSaveFailed: "无法安全保存凭据，请检查本机 Hara 私有状态权限后重试。",
    feishuRemoveFailed: "无法安全移除已存凭据。",
    feishuRemoveConfirm: "移除 Hara 私有保存的飞书凭据？配置新的受信任凭据前，飞书定时投递将保持暂停。",
    feishuCredentialUnavailable: "请更新 Desktop 内置的 Hara 引擎后再在此管理飞书凭据。",
    repairState: "请先修复本机私有连接状态，再重新认证。",
    start: "运行 `hara gateway --platform {platform}` 启动这个连接。",
    inspect: "请检查脱敏网关日志；错误持续时重新认证或重启网关。",
    logIn: "登录微信",
    logInAgain: "重新登录",
    cancel: "取消",
    retry: "重新生成",
    loginUnavailable: "请更新 Desktop 内置 Hara 引擎，之后可直接在这里登录微信。",
    loginFailed: "无法启动微信登录",
    qrFailed: "无法在本机生成二维码。",
    linkEyebrow: "WECHAT / DEVICE LINK",
    waitingTitle: "请用微信扫码",
    waitingBody: "打开手机微信扫描二维码，然后在手机上确认登录。",
    scannedTitle: "已扫码，请在手机确认",
    scannedBody: "请保持本窗口打开，Hara 正在等待微信完成设备绑定。",
    confirmedTitle: "微信已绑定",
    confirmedBody: "凭据已由本机 Hara 引擎写入私有存储；二维码和登录凭据都不会离开这台电脑。",
    cancelledTitle: "已取消登录",
    cancelledBody: "受控登录会话已经结束，没有遗留后台进程。",
    timedOutTitle: "二维码已超时",
    timedOutBody: "请重新生成二维码后再扫码。",
    failedTitle: "微信绑定失败",
    failedBody: "微信拒绝了本次登录，或返回了无效数据；请重新尝试。",
    networkHint: "暂时无法连接微信服务；二维码有效期间 Hara 会继续重试。",
    expiredHint: "二维码已多次过期，请重新开启一次登录会话。",
    localStateHint: "Hara 无法写入本机私有凭据；请检查本机 Hara 状态目录权限后重试。",
    qrAlt: "微信登录二维码",
    qrLoading: "正在生成二维码…",
    expires: "会话截止",
    localOnly: "仅在本机生成 · 不上传",
  },
} as const;

const latestActivity = (status: GatewayStatus): number | undefined => {
  const values = [status.lastConnectedAt, status.lastPollAt, status.lastMessageAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : undefined;
};

const recommendation = (
  status: GatewayStatus,
  locale: Locale,
  desktopLogin: boolean,
  credentialSettings: boolean,
): string => {
  const copy = words[locale];
  const unresolvedError = status.lastErrorAt !== undefined
    && status.runtimeState !== "connected"
    && (status.lastConnectedAt === undefined || status.lastErrorAt >= status.lastConnectedAt);
  if (unresolvedError && status.lastErrorCode === "session-expired" && status.platform === "weixin") {
    return desktopLogin ? copy.weixinDesktopLogin : copy.weixinLogin;
  }
  if (["degraded", "failed", "unreadable"].includes(status.runtimeState)) return copy.inspect;
  if (status.running) return "";
  if (status.configuration === "unreadable") return copy.repairState;
  if (status.configuration !== "ready") {
    if (status.platform === "weixin") return desktopLogin ? copy.weixinDesktopLogin : copy.weixinLogin;
    return credentialSettings ? copy.feishuConfigure : copy.feishuConfigureLegacy;
  }
  return copy.start.replace("{platform}", status.platform);
};

const badge = (status: GatewayStatus, locale: Locale) => {
  const copy = words[locale];
  if (status.running && status.runtimeState === "connected") return { label: copy.connected, tone: "success" as const };
  if (status.running && status.runtimeState === "starting") return { label: copy.starting, tone: "warning" as const };
  if (status.running || ["degraded", "failed", "unreadable"].includes(status.runtimeState)) {
    return { label: copy.degraded, tone: "warning" as const };
  }
  if (status.configured) return { label: copy.stopped, tone: "warning" as const };
  return { label: copy.notConfigured, tone: "neutral" as const };
};

const configurationLabel = (status: GatewayStatus, locale: Locale): string => {
  const copy = words[locale];
  return status.configuration === "ready"
    ? copy.ready
    : status.configuration === "process-only"
      ? copy.processOnly
      : status.configuration === "missing"
        ? copy.missing
        : status.configuration === "incomplete"
          ? copy.incomplete
          : copy.unreadable;
};

const loginCopy = (login: GatewayLoginSnapshot, locale: Locale) => {
  const copy = words[locale];
  if (login.phase === "waiting") return { title: copy.waitingTitle, body: copy.waitingBody, tone: "waiting" };
  if (login.phase === "scanned") return { title: copy.scannedTitle, body: copy.scannedBody, tone: "scanned" };
  if (login.phase === "confirmed") return { title: copy.confirmedTitle, body: copy.confirmedBody, tone: "confirmed" };
  if (login.phase === "cancelled") return { title: copy.cancelledTitle, body: copy.cancelledBody, tone: "cancelled" };
  if (login.phase === "timed-out") return { title: copy.timedOutTitle, body: copy.timedOutBody, tone: "timed-out" };
  return { title: copy.failedTitle, body: copy.failedBody, tone: "failed" };
};

export function GatewaySettings({ client, locale }: { client: HaraClient | null; locale: Locale }) {
  const copy = words[locale];
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState<GatewayLoginSnapshot | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginUnsupported, setLoginUnsupported] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [feishuAppId, setFeishuAppId] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuDomain, setFeishuDomain] = useState<"feishu" | "lark">("feishu");
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState("");
  const [credentialError, setCredentialError] = useState("");
  const request = useRef(0);
  const latestLogin = useRef<GatewayLoginSnapshot | null>(null);
  const mounted = useRef(true);

  const desktopLogin = Boolean(client?.supports("settings.gateways.login.start"));
  const credentialSettings = Boolean(client?.supports("settings.gateways.credentials.save"));
  const credentialRemoval = Boolean(client?.supports("settings.gateways.credentials.remove"));

  const load = useCallback(async (visible = true) => {
    if (!client) return;
    const requestId = ++request.current;
    if (visible) setLoading(true);
    setError("");
    try {
      const next = await client.listGatewayStatuses();
      if (requestId !== request.current) return;
      if (!next) {
        setUnsupported(true);
        setGateways([]);
        return;
      }
      setUnsupported(false);
      setGateways(next);
    } catch (reason) {
      if (requestId === request.current) {
        setError(String(reason instanceof Error ? reason.message : reason));
      }
    } finally {
      if (visible && requestId === request.current) setLoading(false);
    }
  }, [client]);

  const rememberLogin = useCallback((next: GatewayLoginSnapshot) => {
    latestLogin.current = next;
    setLogin(next);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), REFRESH_MS);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    latestLogin.current = login;
  }, [login]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = latestLogin.current;
      if (client && active && !TERMINAL_LOGIN_PHASES.has(active.phase)) {
        void client.cancelGatewayLogin("weixin", active.id).catch(() => {});
      }
    };
  }, [client]);

  useEffect(() => {
    const payload = login?.qrPayload;
    if (!payload) {
      setQrDataUrl("");
      return;
    }
    let disposed = false;
    setQrDataUrl("");
    void import("qrcode")
      .then(({ toDataURL }) => toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 260,
        color: { dark: "#111114", light: "#f5f1ea" },
      }))
      .then((url) => {
        if (!disposed) setQrDataUrl(url);
      })
      .catch(() => {
        if (!disposed) setLoginError(copy.qrFailed);
      });
    return () => {
      disposed = true;
    };
  }, [copy.qrFailed, login?.qrPayload, login?.qrRevision]);

  useEffect(() => {
    if (!client || !login || TERMINAL_LOGIN_PHASES.has(login.phase)) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await client.gatewayLoginStatus("weixin", login.id);
        if (disposed) return;
        setLoginError("");
        rememberLogin(next);
        if (TERMINAL_LOGIN_PHASES.has(next.phase)) {
          if (next.phase === "confirmed") void load(false);
          return;
        }
      } catch (reason) {
        if (disposed) return;
        setLoginError(String(reason instanceof Error ? reason.message : reason));
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), LOGIN_POLL_MS);
    };
    timer = window.setTimeout(() => void poll(), LOGIN_POLL_MS);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, load, login?.id, rememberLogin]);

  const beginLogin = useCallback(async () => {
    if (!client || loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    setLoginUnsupported(false);
    try {
      const next = await client.startGatewayLogin("weixin");
      if (!next) {
        if (mounted.current) setLoginUnsupported(true);
        return;
      }
      if (!mounted.current) {
        if (!TERMINAL_LOGIN_PHASES.has(next.phase)) {
          void client.cancelGatewayLogin("weixin", next.id).catch(() => {});
        }
        return;
      }
      rememberLogin(next);
      if (next.phase === "confirmed") void load(false);
    } catch (reason) {
      if (mounted.current) setLoginError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (mounted.current) setLoginBusy(false);
    }
  }, [client, load, loginBusy, rememberLogin]);

  const cancelLogin = useCallback(async () => {
    if (!client || !login || loginBusy || TERMINAL_LOGIN_PHASES.has(login.phase)) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const next = await client.cancelGatewayLogin("weixin", login.id);
      if (mounted.current) rememberLogin(next);
    } catch (reason) {
      if (mounted.current) setLoginError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (mounted.current) setLoginBusy(false);
    }
  }, [client, login, loginBusy, rememberLogin]);

  const applyGatewayStatus = useCallback((next: GatewayStatus) => {
    setGateways((current) => {
      const found = current.some((gateway) => gateway.platform === next.platform);
      return found
        ? current.map((gateway) => gateway.platform === next.platform ? next : gateway)
        : [...current, next];
    });
  }, []);

  const saveFeishuCredentials = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || credentialBusy || !credentialSettings) return;
    const appId = feishuAppId.trim();
    const appSecret = feishuAppSecret;
    if (!appId || appSecret.length < 8) return;

    setCredentialBusy(true);
    setCredentialMessage("");
    setCredentialError("");
    // Clear renderer state as soon as the authenticated Engine call owns the one-shot request. A failed save
    // requires re-entry rather than retaining a credential in the component after an uncertain boundary.
    setFeishuAppId("");
    setFeishuAppSecret("");
    try {
      const next = await client.saveFeishuGatewayCredentials({ appId, appSecret, domain: feishuDomain });
      if (!mounted.current) return;
      if (!next) {
        setCredentialError(copy.feishuCredentialUnavailable);
        return;
      }
      applyGatewayStatus(next);
      setCredentialMessage(copy.feishuSaved);
    } catch {
      if (mounted.current) setCredentialError(copy.feishuSaveFailed);
    } finally {
      if (mounted.current) setCredentialBusy(false);
    }
  }, [
    applyGatewayStatus,
    client,
    copy.feishuCredentialUnavailable,
    copy.feishuSaveFailed,
    copy.feishuSaved,
    credentialBusy,
    credentialSettings,
    feishuAppId,
    feishuAppSecret,
    feishuDomain,
  ]);

  const removeFeishuCredentials = useCallback(async () => {
    if (!client || credentialBusy || !credentialRemoval) return;
    if (!window.confirm(copy.feishuRemoveConfirm)) return;
    setCredentialBusy(true);
    setCredentialMessage("");
    setCredentialError("");
    setFeishuAppId("");
    setFeishuAppSecret("");
    try {
      const next = await client.removeStoredFeishuGatewayCredentials();
      if (!mounted.current) return;
      if (!next) {
        setCredentialError(copy.feishuCredentialUnavailable);
        return;
      }
      applyGatewayStatus(next);
      setCredentialMessage(copy.feishuRemoved);
    } catch {
      if (mounted.current) setCredentialError(copy.feishuRemoveFailed);
    } finally {
      if (mounted.current) setCredentialBusy(false);
    }
  }, [
    applyGatewayStatus,
    client,
    copy.feishuCredentialUnavailable,
    copy.feishuRemoveConfirm,
    copy.feishuRemoveFailed,
    copy.feishuRemoved,
    credentialBusy,
    credentialRemoval,
  ]);

  const connected = useMemo(
    () => gateways.filter((gateway) => gateway.running && gateway.runtimeState === "connected").length,
    [gateways],
  );
  const activeLogin = Boolean(login && !TERMINAL_LOGIN_PHASES.has(login.phase));
  const loginState = login ? loginCopy(login, locale) : null;
  const feishuDraftReady = FEISHU_APP_ID_PATTERN.test(feishuAppId.trim())
    && FEISHU_APP_SECRET_PATTERN.test(feishuAppSecret);

  return (
    <SettingsCard
      title={copy.title}
      description={copy.subtitle}
      aside={
        <div className="settings-choice">
          {connected > 0 && <SettingsBadge tone="success">{connected} {copy.connected}</SettingsBadge>}
          <button type="button" className="ghost" disabled={!client || loading} onClick={() => void load()}>
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </div>
      }
    >
      {unsupported ? (
        <SettingsNotice title={copy.unavailable} />
      ) : error ? (
        <SettingsNotice tone="error" title={copy.loadFailed}>{error.slice(0, 220)}</SettingsNotice>
      ) : (
        gateways.map((status) => {
          const state = badge(status, locale);
          const activity = latestActivity(status);
          const action = recommendation(status, locale, desktopLogin, credentialSettings);
          const weixin = status.platform === "weixin";
          const feishu = status.platform === "feishu";
          const externallyManaged = status.credentialSource === "environment"
            || status.credentialSource === "process-only";
          const credentialLabel = status.credentialSource === "stored"
            ? copy.feishuStored
            : status.credentialSource === "environment"
              ? copy.feishuEnvironment
              : status.credentialSource === "process-only"
                ? copy.feishuProcessOnly
                : "";
          return (
            <div className="gateway-settings-block" key={status.platform}>
              <SettingsItem
                title={status.label}
                description={`${configurationLabel(status, locale)} · ${copy.lastSignal}: ${activity ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(activity) : copy.never}`}
              >
                <div className="settings-choice">
                  {status.pid && <span className="settings-mono">{copy.pid} {status.pid}</span>}
                  <SettingsBadge tone={state.tone}>{state.label}</SettingsBadge>
                  {weixin && (
                    <button
                      type="button"
                      disabled={!client || loginBusy || activeLogin || !desktopLogin}
                      onClick={() => void beginLogin()}
                    >
                      {loginBusy ? copy.refreshing : status.configured ? copy.logInAgain : copy.logIn}
                    </button>
                  )}
                </div>
              </SettingsItem>

              {feishu && credentialSettings && (
                <section
                  className={`gateway-credential-panel ${status.credentialSource ?? "missing"}`}
                  aria-label={copy.feishuCredentialTitle}
                >
                  <header>
                    <div>
                      <span>{copy.feishuCredentialEyebrow}</span>
                      <h3>{copy.feishuCredentialTitle}</h3>
                    </div>
                    {credentialLabel && (
                      <SettingsBadge tone={status.credentialSource === "stored" ? "success" : "warning"}>
                        {credentialLabel}
                      </SettingsBadge>
                    )}
                  </header>

                  {externallyManaged ? (
                    <p className="gateway-credential-managed">{copy.feishuEnvironmentHint}</p>
                  ) : (
                    <form onSubmit={(event) => void saveFeishuCredentials(event)}>
                      <div className="gateway-credential-fields">
                        <label>
                          <span>{copy.feishuAppId}</span>
                          <input
                            type="password"
                            value={feishuAppId}
                            placeholder="cli_••••••••"
                            autoComplete="new-password"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={127}
                            required
                            disabled={credentialBusy}
                            onChange={(event) => {
                              setFeishuAppId(event.target.value);
                              setCredentialMessage("");
                              setCredentialError("");
                            }}
                          />
                        </label>
                        <label>
                          <span>{copy.feishuAppSecret}</span>
                          <input
                            type="password"
                            value={feishuAppSecret}
                            placeholder="••••••••••••••••"
                            autoComplete="new-password"
                            autoCapitalize="none"
                            spellCheck={false}
                            minLength={8}
                            maxLength={512}
                            required
                            disabled={credentialBusy}
                            onChange={(event) => {
                              setFeishuAppSecret(event.target.value);
                              setCredentialMessage("");
                              setCredentialError("");
                            }}
                          />
                        </label>
                        <label>
                          <span>{copy.feishuRegion}</span>
                          <select
                            value={feishuDomain}
                            disabled={credentialBusy}
                            onChange={(event) => setFeishuDomain(event.target.value === "lark" ? "lark" : "feishu")}
                          >
                            <option value="feishu">{copy.feishuChina}</option>
                            <option value="lark">{copy.feishuGlobal}</option>
                          </select>
                        </label>
                      </div>
                      <footer>
                        <small>{copy.feishuSafety}</small>
                        <div className="gateway-credential-actions">
                          {status.credentialSource === "stored" && credentialRemoval && (
                            <button
                              type="button"
                              className="ghost"
                              disabled={credentialBusy}
                              onClick={() => void removeFeishuCredentials()}
                            >
                              {copy.feishuRemove}
                            </button>
                          )}
                          <button type="submit" disabled={credentialBusy || !feishuDraftReady}>
                            {credentialBusy
                              ? copy.refreshing
                              : status.credentialSource === "stored"
                                ? copy.feishuReplace
                                : copy.feishuSave}
                          </button>
                        </div>
                      </footer>
                    </form>
                  )}

                  {credentialMessage && <p className="gateway-credential-feedback success" role="status">{credentialMessage}</p>}
                  {credentialError && <p className="gateway-credential-feedback error" role="alert">{credentialError}</p>}
                </section>
              )}

              {weixin && login && loginState && (
                <section
                  className={`gateway-login-panel ${loginState.tone}`}
                  aria-live={login.phase === "failed" ? "assertive" : "polite"}
                  aria-label={loginState.title}
                >
                  <div className="gateway-login-visual">
                    {login.qrPayload ? (
                      qrDataUrl ? (
                        <img src={qrDataUrl} alt={copy.qrAlt} width="260" height="260" />
                      ) : (
                        <div className="gateway-qr-placeholder" role="status">{copy.qrLoading}</div>
                      )
                    ) : (
                      <div className="gateway-login-glyph" aria-hidden>
                        <span />
                        <span />
                      </div>
                    )}
                    {login.qrPayload && <small>{copy.localOnly}</small>}
                  </div>
                  <div className="gateway-login-copy">
                    <span className="gateway-login-eyebrow">{copy.linkEyebrow}</span>
                    <h3>{loginState.title}</h3>
                    <p>{loginState.body}</p>
                    {login.errorCode === "network" && <p className="gateway-login-hint">{copy.networkHint}</p>}
                    {login.errorCode === "qr-expired" && <p className="gateway-login-hint">{copy.expiredHint}</p>}
                    {login.errorCode === "local-state" && <p className="gateway-login-hint">{copy.localStateHint}</p>}
                    {loginError && <p className="gateway-login-error" role="alert">{loginError.slice(0, 220)}</p>}
                    <div className="gateway-login-meta">
                      <span>{copy.expires}</span>
                      <strong>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" }).format(login.deadlineAt)}</strong>
                    </div>
                    <div className="gateway-login-actions">
                      {activeLogin ? (
                        <button type="button" className="ghost" disabled={loginBusy} onClick={() => void cancelLogin()}>
                          {copy.cancel}
                        </button>
                      ) : login.phase !== "confirmed" ? (
                        <button type="button" disabled={loginBusy || !desktopLogin} onClick={() => void beginLogin()}>
                          {copy.retry}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>
              )}

              {weixin && loginUnsupported && (
                <SettingsNotice tone="warning" title={copy.loginUnavailable} />
              )}
              {weixin && loginError && !login && (
                <SettingsNotice tone="error" title={copy.loginFailed}>{loginError.slice(0, 220)}</SettingsNotice>
              )}
              {action && !(feishu && credentialSettings && !status.configured) && (
                <SettingsNotice
                  tone={status.running || status.configured ? "warning" : "neutral"}
                  title={`${status.label} · ${state.label}`}
                >
                  {action}
                </SettingsNotice>
              )}
            </div>
          );
        })
      )}
    </SettingsCard>
  );
}
