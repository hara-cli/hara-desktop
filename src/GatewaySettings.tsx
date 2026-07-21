import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GatewayStatus, type HaraClient } from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const REFRESH_MS = 120_000;

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
    feishuConfigure: "Set the Feishu app credentials in the environment that launches the gateway.",
    repairState: "Repair the private connector state, then authenticate again.",
    start: "Start this connector with `hara gateway --platform {platform}`.",
    inspect: "Inspect the redacted gateway log; re-authenticate or restart if the error persists.",
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
    feishuConfigure: "请在启动网关的环境中配置飞书应用凭据。",
    repairState: "请先修复本机私有连接状态，再重新认证。",
    start: "运行 `hara gateway --platform {platform}` 启动这个连接。",
    inspect: "请检查脱敏网关日志；错误持续时重新认证或重启网关。",
  },
} as const;

const latestActivity = (status: GatewayStatus): number | undefined => {
  const values = [status.lastConnectedAt, status.lastPollAt, status.lastMessageAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : undefined;
};

const recommendation = (status: GatewayStatus, locale: Locale): string => {
  const copy = words[locale];
  const unresolvedError = status.lastErrorAt !== undefined
    && status.runtimeState !== "connected"
    && (status.lastConnectedAt === undefined || status.lastErrorAt >= status.lastConnectedAt);
  if (unresolvedError && status.lastErrorCode === "session-expired" && status.platform === "weixin") return copy.weixinLogin;
  if (["degraded", "failed", "unreadable"].includes(status.runtimeState)) return copy.inspect;
  if (status.running) return "";
  if (status.configuration === "unreadable") return copy.repairState;
  if (status.configuration !== "ready") {
    return status.platform === "weixin" ? copy.weixinLogin : copy.feishuConfigure;
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

export function GatewaySettings({ client, locale }: { client: HaraClient | null; locale: Locale }) {
  const copy = words[locale];
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

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

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), REFRESH_MS);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  const connected = useMemo(
    () => gateways.filter((gateway) => gateway.running && gateway.runtimeState === "connected").length,
    [gateways],
  );

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
          const action = recommendation(status, locale);
          return (
            <div key={status.platform}>
              <SettingsItem
                title={status.label}
                description={`${configurationLabel(status, locale)} · ${copy.lastSignal}: ${activity ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(activity) : copy.never}`}
              >
                <div className="settings-choice">
                  {status.pid && <span className="settings-mono">{copy.pid} {status.pid}</span>}
                  <SettingsBadge tone={state.tone}>{state.label}</SettingsBadge>
                </div>
              </SettingsItem>
              {action && (
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
