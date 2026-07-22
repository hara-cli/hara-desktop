import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type HaraClient,
  type OrganizationConnection,
  type OrganizationConnectionCheck,
  type OrganizationConnectionsState,
  type ProviderCatalogEntry,
  type ProviderSettingsInput,
  type ProviderSettingsState,
} from "./client";
import type { Locale } from "./i18n";

interface Draft {
  provider: string;
  model: string;
  baseURL: string;
}

interface OrganizationDraft {
  id: string;
  label: string;
  gatewayUrl: string;
}

type ConnectionView =
  | { kind: "provider"; id: string }
  | { kind: "organization"; id: string }
  | { kind: "enroll"; id?: string };

interface ProviderSettingsProps {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  onSaved: (state: ProviderSettingsState) => void;
  embedded?: boolean;
}

const words = {
  en: {
    title: "Models & connections",
    subtitle: "Cloud models are ready-made options. Enterprise connections belong to you: add every Hara Control your teams provide and switch when your work changes.",
    current: "Current route",
    configured: "ready",
    needsAuth: "needs attention",
    cloud: "Cloud models",
    local: "On this computer",
    managed: "Enterprise managed",
    preset: "Preset",
    personal: "Personal",
    model: "Model",
    endpoint: "Endpoint",
    key: "API key",
    keyKeep: "Configured — leave blank to keep it",
    keyNeed: "Enter a provider API key",
    noKey: "No API key is required. Hara only connects to this loopback endpoint.",
    oauth: "This connection uses browser sign-in. Run `hara login qwen` once, then test again.",
    test: "Test connection",
    save: "Save for new sessions",
    switchSave: "Save & switch to Personal",
    testing: "Testing…",
    saving: "Saving…",
    connected: "Connection and model responded successfully.",
    discovered: "Models found",
    unavailable: "This Desktop build includes an engine that is too old for provider settings. Update Hara Desktop and restart it.",
    environment: "HARA_* environment variables currently override these fields. Remove them before editing here.",
    pinned: "A command flag, environment variable, or project pin currently locks the active connection. Remove that override before switching.",
    profile: "Profile",
    dataLocal: "Data path: model requests stay on this computer.",
    dataCloud: "Data path: task context is sent to the selected provider endpoint.",
    nextSession: "Saved. New sessions use this connection; running sessions keep their current runtime.",
    switched: "Connection switched. New sessions will use this enterprise route.",
    refresh: "Refresh",
    choose: "Choose a model connection",
    keySafety: "The key is masked, never stored in localStorage, and cleared from this form after save.",
    ownedConnections: "Your Hara Control connections",
    organizationCount: "{count} added",
    addOrganization: "Add enterprise",
    addFirstOrganization: "Add your first enterprise connection",
    organizationEmpty: "No enterprise is preconfigured",
    organizationEmptyHint: "Add the Control URL and one-time code supplied by an administrator.",
    organizationUnavailable: "Update the bundled Hara engine to add enterprise connections.",
    active: "In use",
    available: "Available",
    valid: "Access valid",
    expiring: "Expires soon",
    expired: "Expired",
    legacy: "Expiry not reported",
    invalid: "Re-enroll required",
    expires: "Access expiry",
    never: "Not reported",
    controlAddress: "Hara Control",
    organizationModel: "Managed model",
    managedData: "Your administrator controls the model, quota, and policy. The scoped device credential stays in Hara's protected local state and never enters this window.",
    useOrganization: "Switch for new sessions",
    usingOrganization: "Switching…",
    currentOrganization: "Current connection",
    checkOrganization: "Check connection",
    checkingOrganization: "Checking…",
    reachable: "Control confirmed this device",
    unreachable: "Control could not confirm this device",
    reenroll: "Re-enroll",
    remove: "Remove locally",
    removing: "Removing…",
    removeConfirm: "Remove this connection from this device? This does not revoke its server-side token; ask the administrator to revoke it when needed.",
    removed: "Connection removed from this device.",
    addTitle: "Add an enterprise connection",
    reenrollTitle: "Re-enroll enterprise access",
    addDescription: "Each Hara Control deployment becomes its own named connection. Add as many as your work requires.",
    reenrollDescription: "Exchange a new one-time code while keeping this connection's local identity.",
    organizationName: "Connection name",
    organizationNamePlaceholder: "Example: Acme production",
    organizationId: "Local connection ID",
    organizationIdHint: "Advanced local identifier. It is generated from the name and never sent as a credential.",
    organizationUrl: "Hara Control URL",
    organizationUrlHint: "HTTPS is required except for localhost. Enter the server root without an API path.",
    registrationCode: "One-time registration code",
    registrationCodeHint: "Sent once for enrollment, cleared before the request starts, and never saved in the window.",
    enrollmentSafety: "Only the Control URL and one-time code are sent. No existing API key or device token is exposed.",
    enrollAndUse: "Add & switch",
    enrollOnly: "Save connection",
    reenrollSave: "Update access",
    enrolling: "Enrolling…",
    enrolled: "Enterprise connection added and selected.",
    enrolledLocked: "Enterprise connection added. The current project lock kept the existing route active.",
    reenrolled: "Enterprise access updated without changing the active connection.",
    cancel: "Cancel",
    advanced: "Advanced identity",
    loadFailed: "Could not load model connections",
  },
  zh: {
    title: "模型与连接",
    subtitle: "云端模型是 Hara 预置选项；企业连接属于用户自己。可以把不同团队提供的 Hara Control 都加进来，并按工作需要随时切换。",
    current: "当前路由",
    configured: "可用",
    needsAuth: "需要处理",
    cloud: "云端模型",
    local: "本机模型",
    managed: "企业托管",
    preset: "预置",
    personal: "个人连接",
    model: "模型",
    endpoint: "接口地址",
    key: "API 密钥",
    keyKeep: "已经配置；留空继续使用",
    keyNeed: "输入该供应商的 API 密钥",
    noKey: "不需要 API 密钥，Hara 只连接这个本机回环地址。",
    oauth: "此连接使用浏览器登录。先运行一次 `hara login qwen`，再回来测试。",
    test: "测试连接",
    save: "保存，供新会话使用",
    switchSave: "保存并切换到个人连接",
    testing: "正在测试…",
    saving: "正在保存…",
    connected: "连接与模型响应正常。",
    discovered: "发现的模型",
    unavailable: "当前 Desktop 内置引擎还不支持供应商设置；请升级 Hara Desktop 后重新启动。",
    environment: "当前有 HARA_* 环境变量覆盖这些字段，请先移除环境覆盖再在这里修改。",
    pinned: "启动参数、环境变量或项目固定配置正在锁定当前连接；移除覆盖后才能切换。",
    profile: "身份",
    dataLocal: "数据路径：模型请求只在这台电脑上处理。",
    dataCloud: "数据路径：任务上下文会发送到所选供应商地址。",
    nextSession: "已保存。新会话使用此连接；正在运行的会话保持原运行环境。",
    switched: "连接已切换，新会话将使用这个企业路由。",
    refresh: "刷新",
    choose: "选择模型连接",
    keySafety: "密钥只在密码框中短暂停留，不写入 localStorage，保存后立即从表单清空。",
    ownedConnections: "你添加的 Hara Control",
    organizationCount: "已添加 {count} 个",
    addOrganization: "新增企业",
    addFirstOrganization: "添加第一个企业连接",
    organizationEmpty: "没有预置任何企业",
    organizationEmptyHint: "请添加管理员提供的 Control 地址与一次性注册码。",
    organizationUnavailable: "请先升级 Desktop 内置 Hara 引擎，再新增企业连接。",
    active: "使用中",
    available: "可切换",
    valid: "授权有效",
    expiring: "即将到期",
    expired: "已过期",
    legacy: "未提供有效期",
    invalid: "需要重新注册",
    expires: "授权到期",
    never: "未提供",
    controlAddress: "Hara Control",
    organizationModel: "托管模型",
    managedData: "模型、额度与策略由企业管理员管理；设备凭据只留在 Hara 的本机受保护状态中，不会进入这个窗口。",
    useOrganization: "切换，供新会话使用",
    usingOrganization: "正在切换…",
    currentOrganization: "当前连接",
    checkOrganization: "检查连接",
    checkingOrganization: "检查中…",
    reachable: "Control 已确认这台设备",
    unreachable: "Control 未能确认这台设备",
    reenroll: "重新注册",
    remove: "从本机移除",
    removing: "正在移除…",
    removeConfirm: "只从本机移除这个连接吗？此操作不会撤销服务端令牌；如需彻底失效，请同时让管理员撤销。",
    removed: "已从本机移除这个连接。",
    addTitle: "新增企业连接",
    reenrollTitle: "重新注册企业授权",
    addDescription: "每套 Hara Control 都会成为一个独立命名连接；工作中需要多少套，就可以添加多少套。",
    reenrollDescription: "使用新的一次性注册码轮换授权，同时保留这个连接在本机的身份。",
    organizationName: "连接名称",
    organizationNamePlaceholder: "例如：南荒内部",
    organizationId: "本机连接标识",
    organizationIdHint: "高级本机标识，由名称自动生成，不会作为凭据发送。",
    organizationUrl: "Hara Control 地址",
    organizationUrlHint: "除 localhost 外必须使用 HTTPS；只填写服务根地址，不要带 API 路径。",
    registrationCode: "一次性注册码",
    registrationCodeHint: "只用于本次注册，请求发出前即从表单清空，不会保存在窗口中。",
    enrollmentSafety: "这里只会发送 Control 地址与一次性注册码，不会暴露已有 API Key 或设备凭据。",
    enrollAndUse: "添加并切换",
    enrollOnly: "仅保存连接",
    reenrollSave: "更新授权",
    enrolling: "正在注册…",
    enrolled: "企业连接已添加并选中。",
    enrolledLocked: "企业连接已添加；当前项目锁定仍保持原路由。",
    reenrolled: "企业授权已更新，当前使用的连接没有改变。",
    cancel: "取消",
    advanced: "高级标识",
    loadFailed: "无法读取模型连接",
  },
} as const;

const draftFromState = (state: ProviderSettingsState): Draft => ({
  provider: state.current.provider,
  model: state.current.model,
  baseURL: state.current.baseURL ?? "",
});

const endpointIdentity = (value: string | undefined): string => {
  const raw = value?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  } catch {
    return `invalid:${raw}`;
  }
};

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

const uniqueOrganizationId = (
  preferred: string,
  connections: OrganizationConnection[],
  editingId?: string,
): string => {
  const base = idFromLabel(preferred) || "enterprise";
  const occupied = new Set(connections.filter((item) => item.id !== editingId).map((item) => item.id));
  if (!occupied.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${base.slice(0, 54)}-${Date.now().toString(36)}`;
};

const statusFor = (connection: OrganizationConnection, locale: Locale) => {
  const copy = words[locale];
  switch (connection.accessState) {
    case "valid": return { text: copy.valid, tone: "valid" };
    case "legacy": return { text: copy.legacy, tone: "legacy" };
    case "expiring": return { text: copy.expiring, tone: "expiring" };
    case "expired": return { text: copy.expired, tone: "expired" };
    default: return { text: copy.invalid, tone: "invalid" };
  }
};

const managedExpiryWarning = (
  state: ProviderSettingsState,
  locale: Locale,
  now = Date.now(),
): string | null => {
  if (state.current.profileKind !== "gateway" || !state.current.tokenExpiresAt) return null;
  const expiry = Date.parse(state.current.tokenExpiresAt);
  if (!Number.isFinite(expiry) || state.current.tokenExpired || expiry <= now) return words[locale].expired;
  if (expiry - now > 24 * 60 * 60_000) return null;
  return words[locale].expiring;
};

export function ProviderSettings({ client, cwd, locale, onSaved, embedded = false }: ProviderSettingsProps) {
  const copy = words[locale];
  const [state, setState] = useState<ProviderSettingsState | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationConnectionsState | null>(null);
  const [organizationsUnsupported, setOrganizationsUnsupported] = useState(false);
  const [draft, setDraft] = useState<Draft>({ provider: "", model: "", baseURL: "" });
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [view, setView] = useState<ConnectionView>({ kind: "provider", id: "" });
  const [organizationDraft, setOrganizationDraft] = useState<OrganizationDraft>({ id: "", label: "", gatewayUrl: "" });
  const [registrationCode, setRegistrationCode] = useState("");
  const [organizationIdEdited, setOrganizationIdEdited] = useState(false);
  const [checks, setChecks] = useState<Record<string, OrganizationConnectionCheck>>({});
  const [phase, setPhase] = useState<"loading" | "idle" | "testing" | "saving">("loading");
  const [organizationBusy, setOrganizationBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const requestId = ++request.current;
    setPhase("loading");
    setApiKey("");
    setRegistrationCode("");
    setMessage("");
    setError("");
    const [providerResult, organizationResult] = await Promise.allSettled([
      client.listProviderSettings(cwd),
      client.listOrganizationConnections(cwd),
    ]);
    if (requestId !== request.current) return;
    try {
      if (providerResult.status === "rejected") throw providerResult.reason;
      if (!providerResult.value) {
        setUnsupported(true);
        return;
      }
      const next = providerResult.value;
      setUnsupported(false);
      setState(next);
      setDraft(draftFromState(next));
      setModels([]);

      if (organizationResult.status === "fulfilled") {
        setOrganizationsUnsupported(organizationResult.value === null);
        setOrganizations(organizationResult.value);
        const activeOrganization = organizationResult.value?.connections.find(
          (connection) => connection.active || connection.id === next.current.profileId,
        );
        setView(activeOrganization
          ? { kind: "organization", id: activeOrganization.id }
          : { kind: "provider", id: next.current.provider });
      } else {
        setOrganizations(null);
        setOrganizationsUnsupported(false);
        setView({ kind: "provider", id: next.current.provider });
        setError(String(organizationResult.reason instanceof Error ? organizationResult.reason.message : organizationResult.reason));
      }
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      if (requestId === request.current) setPhase("idle");
    }
  }, [client, cwd]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const personalProviders = useMemo(
    () => state?.providers.filter((provider) => provider.location !== "managed") ?? [],
    [state?.providers],
  );
  const selected = useMemo(
    () => view.kind === "provider" ? personalProviders.find((provider) => provider.id === view.id) : undefined,
    [personalProviders, view],
  );
  const selectedOrganization = useMemo(
    () => view.kind === "organization"
      ? organizations?.connections.find((connection) => connection.id === view.id)
      : undefined,
    [organizations?.connections, view],
  );
  const editingOrganization = view.kind === "enroll" && !!view.id;
  const activeOrganization = organizations?.connections.find(
    (connection) => connection.active || connection.id === state?.current.profileId,
  );
  const currentProvider = state?.providers.find((provider) => provider.id === state.current.provider);
  const sameProvider = state?.current.provider === draft.provider;
  const sameEndpoint = endpointIdentity(draft.baseURL || selected?.defaultBaseURL) === endpointIdentity(state?.current.baseURL);
  const canReuseKey = !!(
    state?.current.profileId === "personal" &&
    sameProvider &&
    sameEndpoint &&
    state.current.keyConfigured
  );
  const keyMissing = selected?.auth === "api-key" && !apiKey.trim() && !canReuseKey;
  const lockedProfile = !!state && ["flag", "env", "pin"].includes(state.current.profileSource);
  const blocked = !!state?.current.environmentOverride || lockedProfile;
  const valid = view.kind === "provider" && !!selected && !!draft.model.trim() && !keyMissing && !blocked;
  const organizationValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(organizationDraft.id.trim())
    && organizationDraft.id.trim() !== "personal"
    && !!organizationDraft.label.trim()
    && !!organizationDraft.gatewayUrl.trim()
    && !!registrationCode.trim();
  const expiryWarning = state ? managedExpiryWarning(state, locale) : null;

  const clearFeedback = () => {
    setMessage("");
    setError("");
  };

  const chooseProvider = (provider: ProviderCatalogEntry) => {
    setView({ kind: "provider", id: provider.id });
    setDraft({
      provider: provider.id,
      model: provider.id === state?.current.provider ? state.current.model : provider.defaultModel,
      baseURL: provider.id === state?.current.provider
        ? state.current.baseURL ?? provider.defaultBaseURL ?? ""
        : provider.defaultBaseURL ?? "",
    });
    setApiKey("");
    setRegistrationCode("");
    setModels([]);
    clearFeedback();
  };

  const chooseOrganization = (connection: OrganizationConnection) => {
    setView({ kind: "organization", id: connection.id });
    setApiKey("");
    setRegistrationCode("");
    clearFeedback();
  };

  const beginEnrollment = (connection?: OrganizationConnection) => {
    setView({ kind: "enroll", ...(connection ? { id: connection.id } : {}) });
    setOrganizationDraft(connection
      ? { id: connection.id, label: connection.label, gatewayUrl: connection.gatewayUrl }
      : { id: "", label: "", gatewayUrl: "" });
    setOrganizationIdEdited(!!connection);
    setRegistrationCode("");
    setApiKey("");
    clearFeedback();
  };

  const cancelEnrollment = () => {
    setRegistrationCode("");
    setOrganizationDraft({ id: "", label: "", gatewayUrl: "" });
    if (activeOrganization) setView({ kind: "organization", id: activeOrganization.id });
    else if (state) setView({ kind: "provider", id: state.current.provider });
    clearFeedback();
  };

  const providerInput = (): ProviderSettingsInput => ({
    provider: draft.provider,
    model: draft.model.trim(),
    ...(draft.baseURL.trim() ? { baseURL: draft.baseURL.trim() } : {}),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(state?.current.profileId !== "personal" ? { activatePersonal: true } : {}),
  });

  const testConnection = async () => {
    if (!client || !valid) return;
    setPhase("testing");
    clearFeedback();
    try {
      const result = await client.testProviderSettings(providerInput(), cwd);
      setModels(result.models);
      if (
        result.models.length > 0 &&
        selected?.location === "local" &&
        !result.models.includes(draft.model) &&
        (draft.model === "local-model" || draft.model === "qwen3")
      ) {
        setDraft((current) => ({ ...current, model: result.models[0] }));
      }
      if (result.ok) setMessage(copy.connected);
      else setError(result.error || "Connection failed");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPhase("idle");
    }
  };

  const saveProvider = async () => {
    if (!client || !valid) return;
    setPhase("saving");
    clearFeedback();
    try {
      const next = await client.saveProviderSettings(providerInput(), cwd);
      setState(next);
      setDraft(draftFromState(next));
      setApiKey("");
      setView({ kind: "provider", id: next.current.provider });
      setMessage(copy.nextSession);
      onSaved(next);
      if (organizations) {
        setOrganizations({
          ...organizations,
          activeId: next.current.profileId,
          connections: organizations.connections.map((connection) => ({ ...connection, active: false })),
        });
      }
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPhase("idle");
    }
  };

  const refreshProviderRoute = async (): Promise<ProviderSettingsState | null> => {
    if (!client) return null;
    const next = await client.listProviderSettings(cwd);
    if (!next) return null;
    setState(next);
    onSaved(next);
    return next;
  };

  const useOrganization = async (connection: OrganizationConnection) => {
    if (!client || organizationBusy || organizations?.switchLocked) return;
    setOrganizationBusy(`use:${connection.id}`);
    clearFeedback();
    try {
      const nextOrganizations = await client.useOrganizationConnection(connection.id, cwd);
      setOrganizations(nextOrganizations);
      await refreshProviderRoute();
      setView({ kind: "organization", id: connection.id });
      setMessage(copy.switched);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOrganizationBusy("");
    }
  };

  const checkOrganization = async (connection: OrganizationConnection) => {
    if (!client || organizationBusy) return;
    setOrganizationBusy(`check:${connection.id}`);
    clearFeedback();
    try {
      const result = await client.checkOrganizationConnection(connection.id, cwd);
      setChecks((current) => ({ ...current, [connection.id]: result }));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOrganizationBusy("");
    }
  };

  const removeOrganization = async (connection: OrganizationConnection) => {
    if (!client || organizationBusy || !window.confirm(copy.removeConfirm)) return;
    setOrganizationBusy(`remove:${connection.id}`);
    clearFeedback();
    try {
      const nextOrganizations = await client.removeOrganizationConnection(connection.id, cwd);
      setOrganizations(nextOrganizations);
      setChecks((current) => {
        const { [connection.id]: _removed, ...rest } = current;
        return rest;
      });
      const nextProvider = await refreshProviderRoute();
      const nextActive = nextOrganizations.connections.find((item) => item.active);
      if (nextActive) setView({ kind: "organization", id: nextActive.id });
      else if (nextProvider) {
        setDraft(draftFromState(nextProvider));
        setView({ kind: "provider", id: nextProvider.current.provider });
      }
      setMessage(copy.removed);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOrganizationBusy("");
    }
  };

  const enrollOrganization = async () => {
    if (!client || !organizationValid || organizationBusy) return;
    const transientCode = registrationCode.trim();
    setRegistrationCode("");
    setOrganizationBusy("enroll");
    clearFeedback();
    try {
      const id = organizationDraft.id.trim();
      const existing = organizations?.connections.find((connection) => connection.id === id);
      const activate = !organizations?.switchLocked && (existing ? existing.active : true);
      const nextOrganizations = await client.enrollOrganizationConnection({
        id,
        label: organizationDraft.label.trim(),
        gatewayUrl: organizationDraft.gatewayUrl.trim(),
        code: transientCode,
        activate,
      }, cwd);
      setOrganizations(nextOrganizations);
      await refreshProviderRoute();
      setOrganizationDraft({ id: "", label: "", gatewayUrl: "" });
      setView({ kind: "organization", id });
      setMessage(existing ? copy.reenrolled : activate ? copy.enrolled : copy.enrolledLocked);
    } catch (reason) {
      const raw = String(reason instanceof Error ? reason.message : reason);
      setError(transientCode ? raw.split(transientCode).join("[redacted]") : raw);
    } finally {
      setOrganizationBusy("");
    }
  };

  if (unsupported) return <div className="provider-unsupported">{copy.unavailable}</div>;
  if (!state || phase === "loading") return <div className="setrow dim">{error || "…"}</div>;

  const currentLabel = activeOrganization?.label || currentProvider?.label || state.current.provider;
  const currentMeta = activeOrganization
    ? `${activeOrganization.gatewayHost} · ${copy.managed}`
    : `${copy.personal} · ${state.current.profileSource}`;
  const providerGroups: ProviderCatalogEntry["location"][] = ["cloud", "local"];

  return (
    <section
      className={`provider-console ${embedded ? "embedded" : ""}`}
      aria-labelledby={embedded ? undefined : "provider-settings-title"}
      aria-label={embedded ? copy.title : undefined}
    >
      {embedded ? (
        <div className="provider-embedded-toolbar">
          <span>{copy.choose}</span>
          <button type="button" className="ghost compact" disabled={phase !== "idle" || !!organizationBusy} onClick={() => void load()}>
            {copy.refresh}
          </button>
        </div>
      ) : (
        <header className="provider-heading">
          <div>
            <h2 id="provider-settings-title">{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <button type="button" className="ghost compact" disabled={phase !== "idle" || !!organizationBusy} onClick={() => void load()}>
            {copy.refresh}
          </button>
        </header>
      )}

      <div className={`provider-route ${state.current.authenticated ? "configured" : "missing"}`}>
        <span className="provider-status-dot" aria-hidden="true" />
        <div>
          <span>{copy.current} · {state.current.authenticated ? copy.configured : copy.needsAuth}</span>
          <strong>{currentLabel} · {state.current.model}</strong>
        </div>
        <div className="provider-route-meta">{currentMeta}</div>
      </div>

      {state.current.environmentOverride && <div className="provider-warning">{copy.environment}</div>}
      {lockedProfile && <div className="provider-warning">{copy.pinned}</div>}
      {expiryWarning && <div className="provider-warning" role="alert">{expiryWarning}</div>}

      <div className="provider-workbench">
        <nav className="provider-presets" aria-label={copy.choose}>
          {providerGroups.map((location) => {
            const entries = personalProviders.filter((provider) => provider.location === location);
            if (entries.length === 0) return null;
            return (
              <div className="provider-group" key={location}>
                <div className="provider-group-head">
                  <span className="provider-group-label">{copy[location]}</span>
                  <span className="provider-group-chip">{copy.preset}</span>
                </div>
                {entries.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    className={`provider-preset ${view.kind === "provider" && view.id === provider.id ? "on" : ""}`}
                    aria-pressed={view.kind === "provider" && view.id === provider.id}
                    disabled={phase !== "idle" || !!organizationBusy}
                    onClick={() => chooseProvider(provider)}
                  >
                    <span className={`provider-mini-dot ${provider.location}`} />
                    <span>
                      <strong>{provider.label}</strong>
                      <small>{provider.auth === "none" ? "no key" : provider.auth}</small>
                    </span>
                  </button>
                ))}
              </div>
            );
          })}

          <div className="provider-group provider-enterprise-group">
            <div className="provider-group-head">
              <span className="provider-group-label">{copy.managed}</span>
              <button
                type="button"
                className="provider-add-mini"
                data-preview-action="add-organization"
                aria-label={copy.addOrganization}
                title={copy.addOrganization}
                disabled={organizationsUnsupported || !!organizationBusy}
                onClick={() => beginEnrollment()}
              >
                +
              </button>
            </div>
            <p className="provider-group-caption">
              {organizationsUnsupported
                ? copy.organizationUnavailable
                : organizations?.connections.length
                  ? copy.organizationCount.replace("{count}", String(organizations.connections.length))
                  : copy.ownedConnections}
            </p>
            {!organizationsUnsupported && organizations?.connections.map((connection) => {
              const connectionStatus = statusFor(connection, locale);
              return (
                <button
                  type="button"
                  key={connection.id}
                  className={`provider-preset enterprise ${view.kind === "organization" && view.id === connection.id ? "on" : ""}`}
                  data-connection-id={connection.id}
                  aria-pressed={view.kind === "organization" && view.id === connection.id}
                  disabled={!!organizationBusy}
                  onClick={() => chooseOrganization(connection)}
                >
                  <span className={`provider-mini-dot managed ${connectionStatus.tone}`} />
                  <span>
                    <strong>{connection.label}</strong>
                    <small>{connection.gatewayHost}</small>
                  </span>
                  {connection.active && <em>{copy.active}</em>}
                </button>
              );
            })}
            {!organizationsUnsupported && organizations?.connections.length === 0 && (
              <button type="button" className="provider-enterprise-empty" onClick={() => beginEnrollment()}>
                <span>+</span>
                <strong>{copy.addFirstOrganization}</strong>
                <small>{copy.organizationEmptyHint}</small>
              </button>
            )}
          </div>
        </nav>

        <div className="provider-detail">
          {view.kind === "provider" && selected && (
            <div className="provider-form">
              <header className="provider-detail-heading">
                <div>
                  <span>{selected.location === "local" ? copy.local : copy.cloud} · {copy.preset}</span>
                  <h3>{selected.label}</h3>
                </div>
                <span className={`provider-kind-badge ${selected.location}`}>{copy.personal}</span>
              </header>
              <label>
                <span>{copy.model}</span>
                <input
                  value={draft.model}
                  list="hara-provider-models"
                  onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={phase !== "idle"}
                />
                <datalist id="hara-provider-models">
                  {models.map((model) => <option key={model} value={model} />)}
                </datalist>
              </label>

              {selected.customBaseURL && (
                <label>
                  <span>{copy.endpoint}</span>
                  <input
                    value={draft.baseURL}
                    onChange={(event) => setDraft((current) => ({ ...current, baseURL: event.target.value }))}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={phase !== "idle"}
                  />
                </label>
              )}

              {selected.auth === "api-key" && (
                <label>
                  <span>{copy.key}</span>
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={canReuseKey ? copy.keyKeep : copy.keyNeed}
                    onChange={(event) => setApiKey(event.target.value)}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    disabled={phase !== "idle"}
                  />
                  <small>{copy.keySafety}</small>
                </label>
              )}

              {selected.auth === "none" && <div className="provider-note local">{copy.noKey}</div>}
              {selected.auth === "oauth" && <div className="provider-note">{copy.oauth}</div>}
              <div className={`provider-data-path ${selected.location}`}>
                {selected.location === "local" ? copy.dataLocal : copy.dataCloud}
              </div>

              {models.length > 0 && (
                <div className="provider-models">
                  <span>{copy.discovered}</span>
                  <div>
                    {models.slice(0, 24).map((model) => (
                      <button
                        type="button"
                        className={draft.model === model ? "on" : ""}
                        key={model}
                        aria-pressed={draft.model === model}
                        disabled={phase !== "idle"}
                        onClick={() => setDraft((current) => ({ ...current, model }))}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="provider-actions">
                <button type="button" className="ghost" disabled={!valid || phase !== "idle"} onClick={() => void testConnection()}>
                  {phase === "testing" ? copy.testing : copy.test}
                </button>
                <button type="button" disabled={!valid || phase !== "idle"} onClick={() => void saveProvider()}>
                  {phase === "saving" ? copy.saving : state.current.profileId === "personal" ? copy.save : copy.switchSave}
                </button>
              </div>
            </div>
          )}

          {view.kind === "organization" && selectedOrganization && (() => {
            const access = statusFor(selectedOrganization, locale);
            const checked = checks[selectedOrganization.id];
            const expiry = selectedOrganization.expiresAt && Number.isFinite(Date.parse(selectedOrganization.expiresAt))
              ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(selectedOrganization.expiresAt))
              : copy.never;
            const canSwitch = !organizations?.switchLocked && !["expired", "invalid"].includes(selectedOrganization.accessState);
            return (
              <div className="provider-organization-detail">
                <header className="provider-detail-heading enterprise">
                  <div>
                    <span>{copy.managed} · {selectedOrganization.gatewayHost}</span>
                    <h3>{selectedOrganization.label}</h3>
                  </div>
                  <span className={`organization-status ${access.tone}`}>{access.text}</span>
                </header>

                <div className="organization-facts">
                  <div><span>{copy.organizationModel}</span><strong>{selectedOrganization.model || "—"}</strong></div>
                  <div><span>{copy.controlAddress}</span><strong>{selectedOrganization.gatewayHost}</strong></div>
                  <div><span>{copy.expires}</span><strong>{expiry}</strong></div>
                </div>

                <div className="provider-managed-note">{copy.managedData}</div>
                {organizations?.switchLocked && <div className="provider-warning inline">{copy.pinned}</div>}
                {checked && (
                  <div className={`organization-check-result ${checked.ok ? "ok" : "error"}`} role="status">
                    <span aria-hidden="true">{checked.ok ? "✓" : "!"}</span>
                    {checked.ok ? copy.reachable : copy.unreachable}
                  </div>
                )}

                <div className="organization-management-actions">
                  <button type="button" className="ghost" disabled={!!organizationBusy} onClick={() => void checkOrganization(selectedOrganization)}>
                    {organizationBusy === `check:${selectedOrganization.id}` ? copy.checkingOrganization : copy.checkOrganization}
                  </button>
                  <button type="button" className="ghost" disabled={!!organizationBusy} onClick={() => beginEnrollment(selectedOrganization)}>
                    {copy.reenroll}
                  </button>
                  <button type="button" className="ghost danger" disabled={!!organizationBusy} onClick={() => void removeOrganization(selectedOrganization)}>
                    {organizationBusy === `remove:${selectedOrganization.id}` ? copy.removing : copy.remove}
                  </button>
                </div>
                <div className="provider-actions organization-switch-action">
                  <button
                    type="button"
                    data-preview-action="use-organization"
                    disabled={selectedOrganization.active || !canSwitch || !!organizationBusy}
                    onClick={() => void useOrganization(selectedOrganization)}
                  >
                    {organizationBusy === `use:${selectedOrganization.id}`
                      ? copy.usingOrganization
                      : selectedOrganization.active
                        ? copy.currentOrganization
                        : copy.useOrganization}
                  </button>
                </div>
              </div>
            );
          })()}

          {view.kind === "enroll" && (
            <form className="provider-enrollment-form" onSubmit={(event) => { event.preventDefault(); void enrollOrganization(); }}>
              <header className="provider-detail-heading enterprise">
                <div>
                  <span>{copy.managed} · {editingOrganization ? copy.reenroll : copy.addOrganization}</span>
                  <h3>{editingOrganization ? copy.reenrollTitle : copy.addTitle}</h3>
                  <p>{editingOrganization ? copy.reenrollDescription : copy.addDescription}</p>
                </div>
              </header>

              <label>
                <span>{copy.organizationName}</span>
                <input
                  value={organizationDraft.label}
                  placeholder={copy.organizationNamePlaceholder}
                  maxLength={80}
                  autoComplete="organization"
                  disabled={!!organizationBusy}
                  onChange={(event) => {
                    const label = event.target.value;
                    setOrganizationDraft((current) => ({
                      ...current,
                      label,
                      ...(!organizationIdEdited
                        ? { id: uniqueOrganizationId(label || idFromUrl(current.gatewayUrl), organizations?.connections ?? [], view.id) }
                        : {}),
                    }));
                  }}
                />
              </label>
              <label>
                <span>{copy.organizationUrl}</span>
                <input
                  type="url"
                  value={organizationDraft.gatewayUrl}
                  placeholder="https://control.example.com"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="url"
                  disabled={!!organizationBusy}
                  onChange={(event) => {
                    const gatewayUrl = event.target.value;
                    setOrganizationDraft((current) => ({
                      ...current,
                      gatewayUrl,
                      ...(!organizationIdEdited && !idFromLabel(current.label)
                        ? { id: uniqueOrganizationId(idFromUrl(gatewayUrl), organizations?.connections ?? [], view.id) }
                        : {}),
                    }));
                  }}
                />
                <small>{copy.organizationUrlHint}</small>
              </label>
              <label>
                <span>{copy.registrationCode}</span>
                <input
                  type="password"
                  value={registrationCode}
                  maxLength={256}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  disabled={!!organizationBusy}
                  onChange={(event) => setRegistrationCode(event.target.value)}
                />
                <small>{copy.registrationCodeHint}</small>
              </label>

              {!editingOrganization && (
                <details className="organization-advanced">
                  <summary>{copy.advanced}</summary>
                  <label>
                    <span>{copy.organizationId}</span>
                    <input
                      value={organizationDraft.id}
                      maxLength={64}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoComplete="off"
                      disabled={!!organizationBusy}
                      onChange={(event) => {
                        setOrganizationIdEdited(true);
                        setOrganizationDraft((current) => ({ ...current, id: event.target.value }));
                      }}
                    />
                    <small>{copy.organizationIdHint}</small>
                  </label>
                </details>
              )}

              <div className="provider-enrollment-safety">
                <span aria-hidden="true">◇</span>
                {copy.enrollmentSafety}
              </div>
              <div className="provider-actions">
                <button type="button" className="ghost" disabled={!!organizationBusy} onClick={cancelEnrollment}>{copy.cancel}</button>
                <button type="submit" disabled={!organizationValid || !!organizationBusy}>
                  {organizationBusy === "enroll"
                    ? copy.enrolling
                    : editingOrganization
                      ? copy.reenrollSave
                      : organizations?.switchLocked
                        ? copy.enrollOnly
                        : copy.enrollAndUse}
                </button>
              </div>
            </form>
          )}

          {!selected && !selectedOrganization && view.kind !== "enroll" && (
            <div className="provider-detail-empty">
              <strong>{copy.organizationEmpty}</strong>
              <span>{copy.organizationEmptyHint}</span>
              {!organizationsUnsupported && <button type="button" onClick={() => beginEnrollment()}>{copy.addOrganization}</button>}
            </div>
          )}

          {(phase === "testing" || phase === "saving") && (
            <div className="provider-result pending" role="status" aria-live="polite">
              {phase === "testing" ? copy.testing : copy.saving}
            </div>
          )}
          {message && <div className="provider-result ok" role="status" aria-live="polite">{message}</div>}
          {error && <div className="provider-result error" role="alert" aria-live="assertive"><strong>{copy.loadFailed}</strong>{error}</div>}
        </div>
      </div>
    </section>
  );
}
