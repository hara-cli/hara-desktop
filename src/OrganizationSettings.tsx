import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type HaraClient,
  type OrganizationConnection,
  type OrganizationConnectionCheck,
  type OrganizationConnectionsState,
} from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const copy = {
  en: {
    title: "Organization connections",
    subtitle: "Add a Control URL issued by your own administrator. Hara stores the scoped device credential locally; the one-time code is discarded after enrollment.",
    add: "Add connection",
    close: "Close form",
    empty: "No organization connection added",
    emptyHint: "Nothing is preconfigured. Add the URL and one-time registration code supplied by your administrator.",
    unavailable: "Update the bundled Hara engine to add and manage organization connections here.",
    loadFailed: "Could not load organization connections",
    locked: "Switching is controlled elsewhere",
    lockedHint: "A command flag, environment variable, or project pin selects the active profile. Remove that override before switching here.",
    active: "Active",
    available: "Available",
    valid: "Access valid",
    expiring: "Expires soon",
    expired: "Expired",
    legacy: "No expiry reported",
    invalid: "Needs re-enrollment",
    model: "model",
    expires: "expires",
    never: "not reported",
    use: "Use",
    using: "Switching…",
    check: "Check",
    checking: "Checking…",
    reachable: "Connection confirmed",
    unreachable: "Connection check failed",
    reenroll: "Re-enroll",
    remove: "Remove",
    removing: "Removing…",
    removeConfirm: "Remove this connection from this device? This does not revoke its server-side token; ask the administrator to revoke it when needed.",
    removed: "Connection removed locally.",
    name: "Organization name",
    namePlaceholder: "Example team",
    id: "Local connection ID",
    idHint: "Letters, numbers, dots, underscores, and dashes only. Reusing an existing ID rotates that connection.",
    url: "Hara Control URL",
    urlHint: "HTTPS is required except for localhost. Enter the server root, without a path.",
    code: "One-time registration code",
    codeHint: "Sent only for this enrollment and cleared from the form immediately.",
    save: "Enroll & use",
    saving: "Enrolling…",
    saved: "Organization connection saved and activated.",
    cancel: "Cancel",
  },
  zh: {
    title: "企业连接",
    subtitle: "由用户填写自己管理员提供的 Hara Control 地址。设备凭据只保存在本机受保护状态中，一次性注册码注册后立即丢弃。",
    add: "新增连接",
    close: "收起表单",
    empty: "尚未新增企业连接",
    emptyHint: "这里不会预置任何企业地址；请填写管理员提供的地址和一次性注册码。",
    unavailable: "请更新 Desktop 内置的 Hara 引擎，之后可在这里新增和管理企业连接。",
    loadFailed: "无法读取企业连接",
    locked: "当前连接由其他设置锁定",
    lockedHint: "命令参数、环境变量或项目固定配置正在选择身份；移除该覆盖后才能在这里切换。",
    active: "使用中",
    available: "可用",
    valid: "授权有效",
    expiring: "即将到期",
    expired: "已过期",
    legacy: "服务端未提供有效期",
    invalid: "需要重新注册",
    model: "模型",
    expires: "到期",
    never: "未提供",
    use: "切换使用",
    using: "切换中…",
    check: "检查连接",
    checking: "检查中…",
    reachable: "连接已确认",
    unreachable: "连接检查失败",
    reenroll: "重新注册",
    remove: "移除",
    removing: "移除中…",
    removeConfirm: "只从本机移除这个连接吗？此操作不会撤销服务端令牌；如需彻底失效，请同时让管理员撤销。",
    removed: "已从本机移除连接。",
    name: "企业名称",
    namePlaceholder: "例如：南荒内部",
    id: "本机连接标识",
    idHint: "仅使用字母、数字、点、下划线和短横线；复用已有标识会轮换该连接的凭据。",
    url: "Hara Control 地址",
    urlHint: "除 localhost 外必须使用 HTTPS；只填写服务根地址，不要带路径。",
    code: "一次性注册码",
    codeHint: "只用于本次注册，提交时会立即从表单清空。",
    save: "注册并使用",
    saving: "注册中…",
    saved: "企业连接已保存并切换为使用中。",
    cancel: "取消",
  },
} as const;

const idFromLabel = (label: string): string => label
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^[._-]+|[._-]+$/g, "")
  .slice(0, 64);

const idFromUrl = (value: string): string => {
  try {
    return idFromLabel(new URL(value).hostname);
  } catch {
    return "";
  }
};

const statusFor = (connection: OrganizationConnection, locale: Locale) => {
  const words = copy[locale];
  switch (connection.accessState) {
    case "valid": return { text: words.valid, tone: "success" as const };
    case "legacy": return { text: words.legacy, tone: "neutral" as const };
    case "expiring": return { text: words.expiring, tone: "warning" as const };
    case "expired": return { text: words.expired, tone: "warning" as const };
    default: return { text: words.invalid, tone: "warning" as const };
  }
};

export function OrganizationSettings({
  client,
  cwd,
  locale,
  onChanged,
}: {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  onChanged: (state: OrganizationConnectionsState) => void;
}) {
  const words = copy[locale];
  const [state, setState] = useState<OrganizationConnectionsState | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ id: "", label: "", gatewayUrl: "" });
  const [code, setCode] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checks, setChecks] = useState<Record<string, OrganizationConnectionCheck>>({});
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const requestId = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await client.listOrganizationConnections(cwd);
      if (requestId !== request.current) return;
      if (!next) {
        setUnsupported(true);
        setState(null);
        return;
      }
      setUnsupported(false);
      setState(next);
    } catch (reason) {
      if (requestId === request.current) setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (requestId === request.current) setLoading(false);
    }
  }, [client, cwd]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const resetForm = () => {
    setDraft({ id: "", label: "", gatewayUrl: "" });
    setCode("");
    setIdEdited(false);
    setFormOpen(false);
  };

  const updateState = (next: OrganizationConnectionsState) => {
    setState(next);
    onChanged(next);
  };

  const valid = useMemo(
    () => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(draft.id.trim())
      && draft.id.trim() !== "personal"
      && !!draft.label.trim()
      && !!draft.gatewayUrl.trim()
      && !!code.trim(),
    [code, draft],
  );

  const enroll = async () => {
    if (!client || !valid || busy) return;
    const transientCode = code.trim();
    setCode("");
    setBusy("enroll");
    setError("");
    setMessage("");
    try {
      const next = await client.enrollOrganizationConnection({
        id: draft.id.trim(),
        label: draft.label.trim(),
        gatewayUrl: draft.gatewayUrl.trim(),
        code: transientCode,
        activate: true,
      }, cwd);
      updateState(next);
      resetForm();
      setMessage(words.saved);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy("");
    }
  };

  const useConnection = async (id: string) => {
    if (!client || busy) return;
    setBusy(`use:${id}`);
    setError("");
    setMessage("");
    try {
      updateState(await client.useOrganizationConnection(id, cwd));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy("");
    }
  };

  const checkConnection = async (id: string) => {
    if (!client || busy) return;
    setBusy(`check:${id}`);
    setError("");
    try {
      const result = await client.checkOrganizationConnection(id, cwd);
      setChecks((current) => ({ ...current, [id]: result }));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy("");
    }
  };

  const removeConnection = async (id: string) => {
    if (!client || busy || !window.confirm(words.removeConfirm)) return;
    setBusy(`remove:${id}`);
    setError("");
    setMessage("");
    try {
      updateState(await client.removeOrganizationConnection(id, cwd));
      setChecks((current) => {
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
      setMessage(words.removed);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy("");
    }
  };

  const editConnection = (connection: OrganizationConnection) => {
    setDraft({ id: connection.id, label: connection.label, gatewayUrl: connection.gatewayUrl });
    setCode("");
    setIdEdited(true);
    setFormOpen(true);
    setError("");
    setMessage("");
  };

  return (
    <SettingsCard
      title={words.title}
      description={words.subtitle}
      aside={
        <button
          type="button"
          className="ghost"
          disabled={!client || loading || busy !== "" || unsupported}
          onClick={() => {
            if (formOpen) resetForm();
            else {
              setFormOpen(true);
              setMessage("");
              setError("");
            }
          }}
        >
          {formOpen ? words.close : words.add}
        </button>
      }
    >
      {unsupported ? (
        <SettingsNotice title={words.unavailable} />
      ) : state?.switchLocked ? (
        <SettingsNotice tone="warning" title={words.locked}>{words.lockedHint}</SettingsNotice>
      ) : null}

      {!unsupported && state && state.connections.length === 0 && !formOpen && (
        <div className="settings-empty">
          <strong>{words.empty}</strong>
          <small>{words.emptyHint}</small>
        </div>
      )}

      {!unsupported && state?.connections.map((connection) => {
        const access = statusFor(connection, locale);
        const checked = checks[connection.id];
        const expiry = connection.expiresAt && Number.isFinite(Date.parse(connection.expiresAt))
          ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(connection.expiresAt))
          : words.never;
        return (
          <div className="organization-connection" key={connection.id}>
            <SettingsItem
              title={connection.label}
              description={`${connection.gatewayHost} · ${words.model}: ${connection.model || "—"} · ${words.expires}: ${expiry}`}
            >
              <div className="settings-choice">
                <SettingsBadge tone={access.tone}>{access.text}</SettingsBadge>
                <SettingsBadge tone={connection.active ? "success" : "neutral"}>
                  {connection.active ? words.active : words.available}
                </SettingsBadge>
              </div>
            </SettingsItem>
            <div className="organization-actions">
              {checked && (
                <span className={`organization-check ${checked.ok ? "ok" : "error"}`} role="status">
                  {checked.ok ? words.reachable : words.unreachable}
                </span>
              )}
              <button type="button" className="ghost compact" disabled={!!busy} onClick={() => void checkConnection(connection.id)}>
                {busy === `check:${connection.id}` ? words.checking : words.check}
              </button>
              {!connection.active && (
                <button type="button" className="ghost compact" disabled={!!busy || !!state.switchLocked} onClick={() => void useConnection(connection.id)}>
                  {busy === `use:${connection.id}` ? words.using : words.use}
                </button>
              )}
              <button type="button" className="ghost compact" disabled={!!busy} onClick={() => editConnection(connection)}>{words.reenroll}</button>
              <button type="button" className="ghost compact organization-remove" disabled={!!busy} onClick={() => void removeConnection(connection.id)}>
                {busy === `remove:${connection.id}` ? words.removing : words.remove}
              </button>
            </div>
          </div>
        );
      })}

      {formOpen && !unsupported && (
        <div className="organization-form">
          <div className="organization-form-grid">
            <label>
              <span>{words.name}</span>
              <input
                value={draft.label}
                placeholder={words.namePlaceholder}
                maxLength={80}
                autoComplete="organization"
                disabled={!!busy}
                onChange={(event) => {
                  const label = event.target.value;
                  setDraft((current) => ({ ...current, label, ...(!idEdited ? { id: idFromLabel(label) } : {}) }));
                }}
              />
            </label>
            <label>
              <span>{words.id}</span>
              <input
                value={draft.id}
                maxLength={64}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                disabled={!!busy}
                onChange={(event) => {
                  setIdEdited(true);
                  setDraft((current) => ({ ...current, id: event.target.value }));
                }}
              />
              <small>{words.idHint}</small>
            </label>
          </div>
          <label>
            <span>{words.url}</span>
            <input
              type="url"
              value={draft.gatewayUrl}
              placeholder="https://control.example.com"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="url"
              disabled={!!busy}
              onChange={(event) => {
                const gatewayUrl = event.target.value;
                setDraft((current) => ({
                  ...current,
                  gatewayUrl,
                  ...(!idEdited && !idFromLabel(current.label) ? { id: idFromUrl(gatewayUrl) } : {}),
                }));
              }}
            />
            <small>{words.urlHint}</small>
          </label>
          <label>
            <span>{words.code}</span>
            <input
              type="password"
              value={code}
              maxLength={256}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="new-password"
              disabled={!!busy}
              onChange={(event) => setCode(event.target.value)}
            />
            <small>{words.codeHint}</small>
          </label>
          <div className="organization-form-actions">
            <button type="button" className="ghost" disabled={!!busy} onClick={resetForm}>{words.cancel}</button>
            <button type="button" disabled={!valid || !!busy || !!state?.switchLocked} onClick={() => void enroll()}>
              {busy === "enroll" ? words.saving : words.save}
            </button>
          </div>
        </div>
      )}

      {loading && !state && !unsupported && <div className="settings-empty">…</div>}
      {message && <SettingsNotice tone="success" title={message} />}
      {error && <SettingsNotice tone="error" title={words.loadFailed}>{error.slice(0, 220)}</SettingsNotice>}
    </SettingsCard>
  );
}
