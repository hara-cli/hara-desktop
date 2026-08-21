import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type HaraClient,
  type OrganizationConnection,
  type OrganizationConnectionCheck,
  type OrganizationConnectionsState,
  type ProjectProfileUnpinResult,
  type ProviderCatalogEntry,
  type ProviderConnection,
  type ProviderConnectionCreateInput,
  type ProviderSettingsInput,
  type ProviderSettingsState,
} from "./client";
import type { Locale } from "./i18n";
import { ModelCombobox } from "./ModelCombobox";

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

interface PersonalConnectionDraft extends Draft {
  id: string;
  label: string;
}

type ConnectionView =
  | { kind: "provider"; id: string }
  | { kind: "connection"; id: string }
  | { kind: "add-personal" }
  | { kind: "organization"; id: string }
  | { kind: "enroll"; id?: string };

interface ProviderSettingsProps {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  onSaved: (state: ProviderSettingsState) => void;
  embedded?: boolean;
  scope?: "global" | "workspace";
  engineNeedsRestart?: boolean;
  engineRestarting?: boolean;
  onRestartEngine?: () => void;
}

const words = {
  en: {
    title: "Models & connections",
    subtitle: "Cloud models are ready-made options. Enterprise connections belong to you: add every Hara Control your teams provide and switch when your work changes.",
    current: "Current route",
    currentWorkspace: "New sessions in this workspace",
    configured: "ready",
    needsAuth: "needs attention",
    cloud: "Cloud models",
    local: "On this computer",
    managed: "Enterprise managed",
    preset: "Preset",
    personal: "Personal",
    personalConnections: "Your model connections",
    personalConnectionCount: "{count} saved",
    addPersonal: "Add model connection",
    addFirstPersonal: "Save another provider or API key as its own named connection.",
    personalUnavailable: "Update the bundled Hara engine to save more than one personal connection.",
    providerCatalog: "Personal default presets",
    savedConnection: "Saved connection",
    connectionName: "Connection name",
    connectionNamePlaceholder: "Example: DeepSeek personal",
    connectionId: "Local connection ID",
    connectionIdHint: "Generated from the name. It identifies this route on this device and is never a credential.",
    addPersonalTitle: "Add a personal model connection",
    addPersonalDescription: "Keep providers, endpoints, and API keys separate. Saving a new connection never overwrites an existing one.",
    saveConnectionOnly: "Save without switching",
    addAndUsePersonal: "Add & use for new sessions",
    connectionAdded: "Connection saved. The current default route did not change.",
    connectionAddedAndUsed: "Connection saved and selected for new sessions. Existing sessions keep their original route.",
    usePersonal: "Use for new sessions",
    usingPersonal: "Switching…",
    personalSwitched: "Personal connection switched. Existing sessions keep the connection they started with.",
    testSaved: "Test saved connection",
    testingSaved: "Testing saved connection…",
    keyHintLabel: "Saved key",
    noSavedKey: "No API key required",
    immutableConnection: "To rotate a key or change this route, add a replacement connection first, verify it, then remove this one. Existing sessions are never silently rewritten.",
    removePersonal: "Remove connection",
    removingPersonal: "Removing…",
    removePersonalConfirm: "Remove this saved connection from this device? Sessions created with it keep their identity but cannot reconnect after the connection is removed. Add and test a replacement first.",
    personalRemoved: "Saved connection removed from this device.",
    model: "Model",
    modelSearch: "Search or enter a model ID",
    customModel: "Use custom model ID",
    customModelBadge: "CUSTOM",
    noModelMatches: "No catalog match — keep typing to use a custom model ID.",
    customModelNeedsTest: "Custom model ID — test this exact model before saving.",
    customModelVerified: "Custom model ID verified by this connection.",
    modelNotAuthorized: "This model is not in the current API key's authorized catalog. Choose an authorized model or verify a different ID.",
    endpoint: "Endpoint",
    key: "API key",
    keyKeep: "Configured — leave blank to keep it",
    keyNeed: "Enter a provider API key",
    noKey: "No API key is required. Hara only connects to this loopback endpoint.",
    oauth: "Legacy Qwen Code browser sign-in. It is not Alibaba Token Plan; new Alibaba connections use a Token Plan API key.",
    test: "Test connection",
    save: "Save for new sessions",
    switchSave: "Save & switch to Personal",
    testing: "Testing…",
    saving: "Saving…",
    connected: "Connection and model responded successfully.",
    discovered: "Models found",
    knownModels: "Known models (verify this key before saving)",
    liveModels: "Authorized for this API key",
    tokenPlanAuth: "Token Plan uses the official fixed Beijing subscription Base URL shown above and an API key. There is no Token Plan browser login.",
    legacyAlibaba: "Legacy Alibaba connection",
    legacyAlibabaHint: "This route remains readable, but its old DashScope/Qwen identity is no longer offered for new connections. Move it to the dedicated Token Plan connection.",
    migrateAlibaba: "Move to Token Plan",
    engineRestartTitle: "The running Hara engine is older than this Desktop",
    engineRestartHint: "Restart the bundled engine to load the current Alibaba Token Plan catalog and remove legacy Qwen setup entries.",
    engineRestart: "Restart engine",
    engineRestarting: "Restarting…",
    unavailable: "This Desktop build includes an engine that is too old for provider settings. Update Hara Desktop and restart it.",
    environment: "HARA_* environment variables currently override these fields. Remove them before editing here.",
    pinned: "A command flag or environment variable currently locks the active connection. Remove that launch override before switching.",
    globalDefault: "global default",
    projectOverride: "project override",
    launchOverride: "launch override",
    projectPinnedTitle: "This workspace overrides your global connection",
    projectPinned: "A local .hara-profile selects this connection for new sessions here. Existing sessions keep the identity they started with.",
    unpinProject: "Use global default here",
    unpinningProject: "Removing override…",
    projectUnpinned: "Project override removed. New sessions here now use the global default; existing sessions were not changed.",
    projectStillPinned: "One project override was removed, but another parent-directory override still applies. Review the route above before creating a session.",
    projectUnpinFailed: "The project override is still active and could not be removed safely.",
    unpinUnavailable: "Update Hara Desktop to remove this project override from Settings, or use `hara profile unpin` in the directory reported by `hara whoami`.",
    profile: "Profile",
    dataLocal: "Data path: model requests stay on this computer.",
    dataCloud: "Data path: task context is sent to the selected provider endpoint.",
    nextSession: "Saved. New sessions use this connection; running sessions keep their current runtime.",
    switched: "Organization switched. Its model route and organization workspace now form the active context; existing sessions stay pinned to where they started.",
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
    permanent: "No fixed expiry",
    expiring: "Expires soon",
    expired: "Expired",
    legacy: "Expiry not reported",
    invalid: "Re-enroll required",
    expires: "Access expiry",
    never: "Not reported",
    controlAddress: "Hara Control",
    organizationModel: "Managed model",
    authorizedModels: "Available in chat",
    organizationServices: "Organization services",
    organizationServiceMODEL_CONTROL: "Model control",
    organizationServiceDESK_TASKS: "Desk tasks",
    organizationServiceCOLLAB: "Groups",
    organizationServiceEXTENSION_CATALOG: "Extensions",
    managedData: "Your administrator controls the model, quota, policy, and any organization Desk made available during enrollment. Their credentials remain isolated in Hara's protected local engine and never enter this window.",
    useOrganization: "Switch organization",
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
    enrollOnly: "Save without switching",
    reenrollSave: "Update access",
    enrolling: "Enrolling…",
    enrolled: "Enterprise connection added and selected.",
    enrolledOnly: "Enterprise connection saved. Your current personal or organization connection remains active.",
    enrolledLocked: "Enterprise connection added. The current project lock kept the existing route active.",
    reenrolled: "Enterprise access updated and the organization context is active.",
    reenrolledInactive: "Enterprise access updated. Your current model connection remains active.",
    cancel: "Cancel",
    advanced: "Advanced identity",
    loadFailed: "Could not load model connections",
  },
  zh: {
    title: "模型与连接",
    subtitle: "云端模型是 Hara 预置选项；企业连接属于用户自己。可以把不同团队提供的 Hara Control 都加进来，并按工作需要随时切换。",
    current: "当前路由",
    currentWorkspace: "此工作区的新会话",
    configured: "可用",
    needsAuth: "需要处理",
    cloud: "云端模型",
    local: "本机模型",
    managed: "企业托管",
    preset: "预置",
    personal: "个人连接",
    personalConnections: "你的模型连接",
    personalConnectionCount: "已保存 {count} 个",
    addPersonal: "新增模型连接",
    addFirstPersonal: "把另一家供应商或另一枚 API Key 保存为独立命名连接。",
    personalUnavailable: "请升级 Desktop 内置 Hara 引擎后，再保存多个个人连接。",
    providerCatalog: "个人默认连接预置",
    savedConnection: "已保存连接",
    connectionName: "连接名称",
    connectionNamePlaceholder: "例如：DeepSeek 个人",
    connectionId: "本机连接标识",
    connectionIdHint: "根据名称生成，只用于在本机识别这条路由，不是凭据。",
    addPersonalTitle: "新增个人模型连接",
    addPersonalDescription: "不同供应商、接口和 API Key 分开保存；新增连接不会覆盖任何现有连接。",
    saveConnectionOnly: "仅保存，不切换",
    addAndUsePersonal: "添加并用于新会话",
    connectionAdded: "连接已保存，当前默认路由保持不变。",
    connectionAddedAndUsed: "连接已保存并用于新会话；已有会话仍保留原连接。",
    usePersonal: "用于新会话",
    usingPersonal: "正在切换…",
    personalSwitched: "个人连接已切换；已有会话仍保留创建时的连接。",
    testSaved: "测试已保存连接",
    testingSaved: "正在测试已保存连接…",
    keyHintLabel: "已保存密钥",
    noSavedKey: "无需 API Key",
    immutableConnection: "如需轮换 Key 或修改路由，请先新增替代连接并验证，再移除旧连接；已有会话不会被静默改写。",
    removePersonal: "移除连接",
    removingPersonal: "正在移除…",
    removePersonalConfirm: "从本机移除这个连接吗？已用它创建的会话会保留原身份，但移除后将无法重新连接。请先新增并验证替代连接。",
    personalRemoved: "已从本机移除该连接。",
    model: "模型",
    modelSearch: "搜索或输入模型 ID",
    customModel: "使用自定义模型 ID",
    customModelBadge: "自定义",
    noModelMatches: "目录中没有匹配项，可继续输入自定义模型 ID。",
    customModelNeedsTest: "这是自定义模型 ID，保存前需测试这个精确模型。",
    customModelVerified: "这个自定义模型 ID 已通过当前连接验证。",
    modelNotAuthorized: "此模型不在当前 API Key 的授权目录中，请选择已授权模型，或验证另一个模型 ID。",
    endpoint: "接口地址",
    key: "API 密钥",
    keyKeep: "已经配置；留空继续使用",
    keyNeed: "输入该供应商的 API 密钥",
    noKey: "不需要 API 密钥，Hara 只连接这个本机回环地址。",
    oauth: "这是旧版 Qwen Code 浏览器登录，不是阿里云 Token Plan；新建阿里连接请使用 Token Plan API Key。",
    test: "测试连接",
    save: "保存，供新会话使用",
    switchSave: "保存并切换到个人连接",
    testing: "正在测试…",
    saving: "正在保存…",
    connected: "连接与模型响应正常。",
    discovered: "发现的模型",
    knownModels: "已知模型（保存前请用当前 Key 验证）",
    liveModels: "当前 API Key 已授权",
    tokenPlanAuth: "Token Plan 使用上方显示的华北 2（北京）官方固定 Base URL 和 API Key，不提供 Token Plan 浏览器登录。",
    legacyAlibaba: "旧版阿里云连接",
    legacyAlibabaHint: "此连接仍可读取，但旧 DashScope/Qwen 身份不再用于新建连接；请迁移到独立的 Token Plan 连接。",
    migrateAlibaba: "迁移到 Token Plan",
    engineRestartTitle: "当前运行的 Hara 引擎早于此 Desktop",
    engineRestartHint: "请重启内置引擎，以加载最新百炼 Token Plan 目录并移除旧千问配置入口。",
    engineRestart: "重启引擎",
    engineRestarting: "正在重启…",
    unavailable: "当前 Desktop 内置引擎还不支持供应商设置；请升级 Hara Desktop 后重新启动。",
    environment: "当前有 HARA_* 环境变量覆盖这些字段，请先移除环境覆盖再在这里修改。",
    pinned: "启动参数或环境变量正在锁定当前连接；移除启动覆盖后才能切换。",
    globalDefault: "全局默认",
    projectOverride: "项目固定",
    launchOverride: "启动覆盖",
    projectPinnedTitle: "此工作区覆盖了全局连接",
    projectPinned: "本地 `.hara-profile` 为这里的新会话固定了当前连接；已有会话仍保留创建时的身份。",
    unpinProject: "在此恢复全局默认",
    unpinningProject: "正在解除固定…",
    projectUnpinned: "项目固定已解除。此处的新会话改用全局默认；已有会话没有变化。",
    projectStillPinned: "已解除一层项目固定，但上级目录仍有另一层固定；新建会话前请再次核对上方路由。",
    projectUnpinFailed: "项目固定仍在生效，Hara 未能安全移除它。",
    unpinUnavailable: "请升级 Hara Desktop 后在设置中解除；也可以在 `hara whoami` 所示目录运行 `hara profile unpin`。",
    profile: "身份",
    dataLocal: "数据路径：模型请求只在这台电脑上处理。",
    dataCloud: "数据路径：任务上下文会发送到所选供应商地址。",
    nextSession: "已保存。新会话使用此连接；正在运行的会话保持原运行环境。",
    switched: "组织已切换；它的模型路由与组织工作区现已成为同一个当前上下文，已有会话仍保持创建时的身份。",
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
    permanent: "无固定到期",
    expiring: "即将到期",
    expired: "已过期",
    legacy: "未提供有效期",
    invalid: "需要重新注册",
    expires: "授权到期",
    never: "未提供",
    controlAddress: "Hara Control",
    organizationModel: "托管模型",
    authorizedModels: "聊天可用模型",
    organizationServices: "组织服务",
    organizationServiceMODEL_CONTROL: "模型控制",
    organizationServiceDESK_TASKS: "Desk 任务",
    organizationServiceCOLLAB: "群组",
    organizationServiceEXTENSION_CATALOG: "扩展目录",
    managedData: "模型、额度、策略以及注册时可用的组织 Desk 都由企业管理员管理；各自凭据隔离保存在 Hara 本机引擎中，不会进入这个窗口。",
    useOrganization: "切换组织",
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
    enrollOnly: "仅保存，不切换当前连接",
    reenrollSave: "更新授权",
    enrolling: "正在注册…",
    enrolled: "企业连接已添加并选中。",
    enrolledOnly: "企业连接已保存，当前个人直连或其他组织连接保持不变。",
    enrolledLocked: "企业连接已添加；当前项目锁定仍保持原路由。",
    reenrolled: "企业授权已更新，并已成为当前组织上下文。",
    reenrolledInactive: "企业授权已更新，当前模型连接保持不变。",
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

const LEGACY_PERSONAL_PROVIDER_IDS = new Set(["qwen", "qwen-oauth"]);

const isLegacyProvider = (provider: Pick<ProviderCatalogEntry, "id" | "legacy">): boolean =>
  provider.legacy === true || LEGACY_PERSONAL_PROVIDER_IDS.has(provider.id);

const isLegacyProviderId = (providerId: string): boolean =>
  LEGACY_PERSONAL_PROVIDER_IDS.has(providerId);

const viewForPersonalConnection = (
  connection: ProviderConnection | undefined,
  fallbackProvider: string,
): ConnectionView => {
  if (!connection) return { kind: "provider", id: fallbackProvider };
  return connection.legacyPersonal && !isLegacyProviderId(connection.provider)
    ? { kind: "provider", id: connection.provider }
    : { kind: "connection", id: connection.id };
};

const modelCandidateKey = (draft: Draft): string =>
  [draft.provider, endpointIdentity(draft.baseURL), draft.model.trim()].join("\u0000");

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

const uniquePersonalConnectionId = (
  preferred: string,
  personal: ProviderConnection[],
  organizations: OrganizationConnection[],
): string => {
  const base = idFromLabel(preferred) || "personal-model";
  const occupied = new Set([
    "personal",
    ...personal.map((item) => item.id),
    ...organizations.map((item) => item.id),
  ]);
  if (!occupied.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${base.slice(0, 54)}-${Date.now().toString(36)}`;
};

const personalDraftForProvider = (provider: ProviderCatalogEntry): PersonalConnectionDraft => ({
  id: "",
  label: "",
  provider: provider.id,
  model: provider.defaultModel,
  baseURL: provider.defaultBaseURL ?? "",
});

const statusFor = (connection: OrganizationConnection, locale: Locale) => {
  const copy = words[locale];
  switch (connection.accessState) {
    case "valid": return { text: copy.valid, tone: "valid" };
    case "permanent": return { text: copy.permanent, tone: "valid" };
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

export function ProviderSettings({
  client,
  cwd,
  locale,
  onSaved,
  embedded = false,
  scope = "global",
  engineNeedsRestart = false,
  engineRestarting = false,
  onRestartEngine,
}: ProviderSettingsProps) {
  const copy = words[locale];
  const [state, setState] = useState<ProviderSettingsState | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationConnectionsState | null>(null);
  const [organizationsUnsupported, setOrganizationsUnsupported] = useState(false);
  const [draft, setDraft] = useState<Draft>({ provider: "", model: "", baseURL: "" });
  const [personalDraft, setPersonalDraft] = useState<PersonalConnectionDraft>({ id: "", label: "", provider: "", model: "", baseURL: "" });
  const [personalIdEdited, setPersonalIdEdited] = useState(false);
  const [personalBusy, setPersonalBusy] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [verifiedCustomModels, setVerifiedCustomModels] = useState<string[]>([]);
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
      const firstPersonalProvider = next.providers.find((provider) => provider.location !== "managed" && !isLegacyProvider(provider));
      if (firstPersonalProvider) setPersonalDraft(personalDraftForProvider(firstPersonalProvider));
      setModels([]);
      setVerifiedCustomModels([]);
      const fallbackProvider = isLegacyProviderId(next.current.provider)
        ? firstPersonalProvider?.id ?? ""
        : next.current.provider;

      if (organizationResult.status === "fulfilled") {
        setOrganizationsUnsupported(organizationResult.value === null);
        setOrganizations(organizationResult.value);
        const activeOrganization = organizationResult.value?.connections.find(
          (connection) => connection.active || connection.id === next.current.profileId,
        );
        const activePersonal = next.connections?.find(
          (connection) => connection.active || connection.id === next.current.profileId,
        );
        setView(activeOrganization
          ? { kind: "organization", id: activeOrganization.id }
          : viewForPersonalConnection(activePersonal, fallbackProvider));
      } else {
        setOrganizations(null);
        setOrganizationsUnsupported(false);
        const activePersonal = next.connections?.find(
          (connection) => connection.active || connection.id === next.current.profileId,
        );
        setView(viewForPersonalConnection(activePersonal, fallbackProvider));
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
    () => state?.providers.filter((provider) => (
      provider.location !== "managed"
      && !isLegacyProvider(provider)
    )) ?? [],
    [state?.providers],
  );
  const newPersonalProviders = useMemo(
    () => personalProviders.filter((provider) => !provider.legacy),
    [personalProviders],
  );
  const selected = useMemo(
    () => view.kind === "provider" ? personalProviders.find((provider) => provider.id === view.id) : undefined,
    [personalProviders, view],
  );
  const selectedConnection = useMemo(
    () => view.kind === "connection"
      ? state?.connections?.find((connection) => connection.id === view.id)
      : undefined,
    [state?.connections, view],
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
  const activePersonalConnection = state?.connections?.find(
    (connection) => connection.active || connection.id === state.current.profileId,
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
  const selectedCatalog = models.length > 0 ? models : [...(selected?.knownModels ?? [])];
  const selectedCandidateKey = modelCandidateKey(draft);
  const selectedModelVerified = verifiedCustomModels.includes(selectedCandidateKey);
  const selectedModelAllowed = selectedCatalog.length === 0
    || selectedCatalog.includes(draft.model.trim())
    || (selectedModelVerified && (selected?.id !== "token-plan" || models.length === 0));
  const testValid = view.kind === "provider" && !!selected && !!draft.model.trim()
    && !keyMissing && !blocked;
  const valid = testValid && selectedModelAllowed;
  const personalProvider = personalProviders.find((provider) => provider.id === personalDraft.provider);
  const personalKeyMissing = personalProvider?.auth === "api-key" && !apiKey.trim();
  const personalCatalog = models.length > 0 ? models : [...(personalProvider?.knownModels ?? [])];
  const personalCandidateKey = modelCandidateKey(personalDraft);
  const personalModelVerified = verifiedCustomModels.includes(personalCandidateKey);
  const personalModelAllowed = personalCatalog.length === 0
    || personalCatalog.includes(personalDraft.model.trim())
    || (personalModelVerified && (personalProvider?.id !== "token-plan" || models.length === 0));
  const personalConnectionTestValid = view.kind === "add-personal"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(personalDraft.id.trim())
    && personalDraft.id.trim() !== "personal"
    && !!personalDraft.label.trim()
    && !!personalProvider
    && !!personalDraft.model.trim()
    && !personalKeyMissing;
  const personalConnectionValid = personalConnectionTestValid && personalModelAllowed;
  const personalConnectionsSupported = Array.isArray(state?.connections);
  const personalSwitchLocked = !!state?.switchLocked || !!state?.current.environmentOverride;
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
    setVerifiedCustomModels([]);
    clearFeedback();
  };

  const choosePersonalConnection = (connection: ProviderConnection) => {
    if (connection.legacyPersonal && !isLegacyProviderId(connection.provider)) {
      const provider = personalProviders.find((candidate) => candidate.id === connection.provider);
      if (provider) chooseProvider(provider);
      return;
    }
    setView({ kind: "connection", id: connection.id });
    setApiKey("");
    setRegistrationCode("");
    setModels([]);
    setVerifiedCustomModels([]);
    clearFeedback();
  };

  const beginPersonalConnection = (preferredProvider?: ProviderCatalogEntry) => {
    const provider = preferredProvider
      ?? newPersonalProviders.find((candidate) => candidate.id === state?.current.provider)
      ?? newPersonalProviders[0];
    if (!provider) return;
    const next = personalDraftForProvider(provider);
    setPersonalDraft({
      ...next,
      id: uniquePersonalConnectionId(
        provider.id,
        state?.connections ?? [],
        organizations?.connections ?? [],
      ),
    });
    setPersonalIdEdited(false);
    setView({ kind: "add-personal" });
    setApiKey("");
    setRegistrationCode("");
    setModels([]);
    setVerifiedCustomModels([]);
    clearFeedback();
  };

  const cancelPersonalConnection = () => {
    setApiKey("");
    setPersonalDraft({ id: "", label: "", provider: "", model: "", baseURL: "" });
    if (activeOrganization) setView({ kind: "organization", id: activeOrganization.id });
    else if (state) setView(viewForPersonalConnection(activePersonalConnection, state.current.provider));
    setModels([]);
    setVerifiedCustomModels([]);
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
    else if (state) setView(viewForPersonalConnection(activePersonalConnection, state.current.provider));
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
    if (!client || !testValid) return;
    setPhase("testing");
    clearFeedback();
    try {
      const result = await client.testProviderSettings(providerInput(), cwd);
      setModels(result.models);
      if (
        result.models.length > 0
        && selected?.id === "token-plan"
        && !result.models.includes(draft.model.trim())
      ) {
        setError(copy.modelNotAuthorized);
        return;
      }
      if (
        result.models.length > 0 &&
        selected?.location === "local" &&
        !result.models.includes(draft.model) &&
        (draft.model === "local-model" || draft.model === "qwen3")
      ) {
        setDraft((current) => ({ ...current, model: result.models[0] }));
      }
      if (result.ok) {
        setVerifiedCustomModels((current) => current.includes(selectedCandidateKey)
          ? current
          : [...current, selectedCandidateKey]);
        setMessage(copy.connected);
      } else setError(result.error || "Connection failed");
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
      setModels([]);
      setVerifiedCustomModels([]);
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

  const personalConnectionInput = (activate: boolean): ProviderConnectionCreateInput => ({
    id: personalDraft.id.trim(),
    label: personalDraft.label.trim(),
    provider: personalDraft.provider,
    model: personalDraft.model.trim(),
    ...(personalDraft.baseURL.trim() ? { baseURL: personalDraft.baseURL.trim() } : {}),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    activate,
  });

  const testNewPersonalConnection = async () => {
    if (!client || !personalConnectionTestValid || personalBusy) return;
    setPersonalBusy("test-new");
    clearFeedback();
    try {
      const input = personalConnectionInput(false);
      const result = await client.testProviderSettings(input, cwd);
      setModels(result.models);
      if (
        result.models.length > 0
        && personalProvider?.id === "token-plan"
        && !result.models.includes(personalDraft.model.trim())
      ) {
        setError(copy.modelNotAuthorized);
        return;
      }
      if (result.ok) {
        setVerifiedCustomModels((current) => current.includes(personalCandidateKey)
          ? current
          : [...current, personalCandidateKey]);
        setMessage(copy.connected);
      } else setError(result.error || "Connection failed");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPersonalBusy("");
    }
  };

  const createPersonalConnection = async (activate: boolean) => {
    if (!client || !personalConnectionValid || personalBusy) return;
    const input = personalConnectionInput(activate && !personalSwitchLocked);
    const transientKey = input.apiKey ?? "";
    setApiKey("");
    setPersonalBusy("create");
    clearFeedback();
    try {
      const next = await client.createProviderConnection(input, cwd);
      setState(next);
      setView({ kind: "connection", id: input.id });
      setPersonalDraft({ id: "", label: "", provider: "", model: "", baseURL: "" });
      setModels([]);
      setVerifiedCustomModels([]);
      onSaved(next);
      if (input.activate && organizations) {
        setOrganizations({
          ...organizations,
          activeId: input.id,
          connections: organizations.connections.map((connection) => ({ ...connection, active: false })),
        });
      }
      setMessage(input.activate ? copy.connectionAddedAndUsed : copy.connectionAdded);
    } catch (reason) {
      const raw = String(reason instanceof Error ? reason.message : reason);
      setError(transientKey ? raw.split(transientKey).join("[redacted]") : raw);
    } finally {
      setPersonalBusy("");
    }
  };

  const testSavedPersonalConnection = async (connection: ProviderConnection) => {
    if (!client || personalBusy) return;
    setPersonalBusy(`test:${connection.id}`);
    clearFeedback();
    try {
      const result = await client.testProviderConnection(connection.id, cwd);
      setModels(result.models);
      if (result.ok) setMessage(copy.connected);
      else setError(result.error || "Connection failed");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPersonalBusy("");
    }
  };

  const usePersonalConnection = async (connection: ProviderConnection) => {
    if (!client || personalBusy || personalSwitchLocked || connection.active) return;
    setPersonalBusy(`use:${connection.id}`);
    clearFeedback();
    try {
      const next = await client.useProviderConnection(connection.id, cwd);
      setState(next);
      setView(viewForPersonalConnection(connection, next.current.provider));
      if (organizations) {
        setOrganizations({
          ...organizations,
          activeId: connection.id,
          connections: organizations.connections.map((candidate) => ({ ...candidate, active: false })),
        });
      }
      onSaved(next);
      setMessage(copy.personalSwitched);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPersonalBusy("");
    }
  };

  const removePersonalConnection = async (connection: ProviderConnection) => {
    if (!client || personalBusy || !connection.removable || !window.confirm(copy.removePersonalConfirm)) return;
    setPersonalBusy(`remove:${connection.id}`);
    clearFeedback();
    try {
      const next = await client.removeProviderConnection(connection.id, cwd);
      setState(next);
      const nextActive = next.connections?.find(
        (candidate) => candidate.active || candidate.id === next.current.profileId,
      );
      setView(viewForPersonalConnection(nextActive, next.current.provider));
      setModels([]);
      setVerifiedCustomModels([]);
      onSaved(next);
      setMessage(copy.personalRemoved);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPersonalBusy("");
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

  const applyProjectUnpin = (result: ProjectProfileUnpinResult) => {
    const next = result.providers;
    const nextOrganization = result.organizations.connections.find(
      (connection) => connection.active || connection.id === next.current.profileId,
    );
    const nextPersonal = next.connections?.find(
      (connection) => connection.active || connection.id === next.current.profileId,
    );
    setState(next);
    setOrganizations(result.organizations);
    setDraft(draftFromState(next));
    setModels([]);
    setVerifiedCustomModels([]);
    setApiKey("");
    setRegistrationCode("");
    setView(nextOrganization
      ? { kind: "organization", id: nextOrganization.id }
      : viewForPersonalConnection(nextPersonal, next.current.provider));
    onSaved(next);
  };

  const unpinProject = async () => {
    if (!client || state?.current.profileSource !== "pin" || organizationBusy) return;
    setOrganizationBusy("unpin-project");
    clearFeedback();
    try {
      const result = await client.unpinProjectProfile(cwd);
      if (!result) throw new Error(copy.unpinUnavailable);
      if (!result.removed && result.providers.current.profileSource === "pin") {
        throw new Error(copy.projectUnpinFailed);
      }
      applyProjectUnpin(result);
      setMessage(result.providers.current.profileSource === "pin" ? copy.projectStillPinned : copy.projectUnpinned);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOrganizationBusy("");
    }
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
        const nextPersonal = nextProvider.connections?.find(
          (connection) => connection.active || connection.id === nextProvider.current.profileId,
        );
        setView(viewForPersonalConnection(nextPersonal, nextProvider.current.provider));
      }
      setMessage(copy.removed);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOrganizationBusy("");
    }
  };

  const enrollOrganization = async (activateRequested: boolean) => {
    if (!client || !organizationValid || organizationBusy) return;
    const transientCode = registrationCode.trim();
    setRegistrationCode("");
    setOrganizationBusy("enroll");
    clearFeedback();
    try {
      const id = organizationDraft.id.trim();
      const existing = organizations?.connections.find((connection) => connection.id === id);
      const activate = !organizations?.switchLocked
        && (editingOrganization ? existing?.active === true : activateRequested);
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
      const resultMessage = activate
        ? existing ? copy.reenrolled : copy.enrolled
        : existing
          ? copy.reenrolledInactive
          : organizations?.switchLocked ? copy.enrolledLocked : copy.enrolledOnly;
      setMessage(resultMessage);
    } catch (reason) {
      const raw = String(reason instanceof Error ? reason.message : reason);
      setError(transientCode ? raw.split(transientCode).join("[redacted]") : raw);
    } finally {
      setOrganizationBusy("");
    }
  };

  if (unsupported) return <div className="provider-unsupported">{copy.unavailable}</div>;
  if (!state || phase === "loading") return <div className="setrow dim">{error || "…"}</div>;

  const currentLabel = activeOrganization?.label
    || activePersonalConnection?.label
    || (isLegacyProviderId(state.current.provider) ? copy.legacyAlibaba : currentProvider?.label)
    || state.current.provider;
  const routeSource = state.current.profileSource === "pin"
    ? copy.projectOverride
    : state.current.profileSource === "flag" || state.current.profileSource === "env"
      ? copy.launchOverride
      : copy.globalDefault;
  const currentMeta = activeOrganization
    ? `${activeOrganization.gatewayHost} · ${routeSource}`
    : `${activePersonalConnection?.label || copy.personal} · ${routeSource}`;
  const projectPinned = state.current.profileSource === "pin";
  const providerGroups: ProviderCatalogEntry["location"][] = ["cloud", "local"];
  const selectedModelOptions = selectedCatalog;
  const personalModelOptions = personalCatalog;
  const selectedCustomModel = selectedModelOptions.length > 0
    && !selectedModelOptions.includes(draft.model.trim());
  const personalCustomModel = personalModelOptions.length > 0
    && !personalModelOptions.includes(personalDraft.model.trim());
  const tokenPlanProvider = newPersonalProviders.find((provider) => provider.id === "token-plan");
  const selectedConnectionIsLegacyAlibaba = !!selectedConnection
    && isLegacyProviderId(selectedConnection.provider);
  const staleAlibabaCatalog = !tokenPlanProvider
    && state.providers.some((provider) => LEGACY_PERSONAL_PROVIDER_IDS.has(provider.id));
  const showEngineRestart = engineNeedsRestart || staleAlibabaCatalog;

  return (
    <section
      className={`provider-console ${embedded ? "embedded" : ""}`}
      aria-labelledby={embedded ? undefined : "provider-settings-title"}
      aria-label={embedded ? copy.title : undefined}
    >
      {embedded ? (
        <div className="provider-embedded-toolbar">
          <span>{copy.choose}</span>
          <button type="button" className="ghost compact" disabled={phase !== "idle" || !!personalBusy || !!organizationBusy} onClick={() => void load()}>
            {copy.refresh}
          </button>
        </div>
      ) : (
        <header className="provider-heading">
          <div>
            <h2 id="provider-settings-title">{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>
          <button type="button" className="ghost compact" disabled={phase !== "idle" || !!personalBusy || !!organizationBusy} onClick={() => void load()}>
            {copy.refresh}
          </button>
        </header>
      )}

      <div className={`provider-route ${state.current.authenticated ? "configured" : "missing"}`}>
        <span className="provider-status-dot" aria-hidden="true" />
        <div>
          <span>{scope === "workspace" ? copy.currentWorkspace : copy.current} · {state.current.authenticated ? copy.configured : copy.needsAuth}</span>
          <strong>{currentLabel} · {state.current.model}</strong>
        </div>
        <div className="provider-route-meta">{currentMeta}</div>
      </div>

      {showEngineRestart && (
        <div className="provider-pin-recovery provider-engine-restart" role="alert">
          <div>
            <strong>{copy.engineRestartTitle}</strong>
            <span>{copy.engineRestartHint}</span>
          </div>
          {onRestartEngine && (
            <button
              type="button"
              className="ghost compact"
              disabled={engineRestarting || phase !== "idle" || !!personalBusy || !!organizationBusy}
              onClick={onRestartEngine}
            >
              {engineRestarting ? copy.engineRestarting : copy.engineRestart}
            </button>
          )}
        </div>
      )}

      {state.current.environmentOverride && <div className="provider-warning">{copy.environment}</div>}
      {projectPinned ? (
        <div className="provider-pin-recovery" role="alert">
          <div>
            <strong>{copy.projectPinnedTitle}</strong>
            <span>{copy.projectPinned}</span>
          </div>
          <button
            type="button"
            className="ghost compact"
            disabled={!!organizationBusy}
            onClick={() => void unpinProject()}
          >
            {organizationBusy === "unpin-project" ? copy.unpinningProject : copy.unpinProject}
          </button>
        </div>
      ) : lockedProfile ? <div className="provider-warning">{copy.pinned}</div> : null}
      {expiryWarning && <div className="provider-warning" role="alert">{expiryWarning}</div>}

      <div className="provider-workbench">
        <nav className="provider-presets" aria-label={copy.choose}>
          <div className="provider-group provider-personal-group">
            <div className="provider-group-head">
              <span className="provider-group-label">{copy.personalConnections}</span>
              <button
                type="button"
                className="provider-add-mini personal"
                data-preview-action="add-personal"
                aria-label={copy.addPersonal}
                title={copy.addPersonal}
                disabled={!personalConnectionsSupported || phase !== "idle" || !!personalBusy || !!organizationBusy}
                onClick={() => beginPersonalConnection()}
              >
                +
              </button>
            </div>
            <p className="provider-group-caption">
              {personalConnectionsSupported
                ? copy.personalConnectionCount.replace("{count}", String(state.connections?.length ?? 0))
                : copy.personalUnavailable}
            </p>
            {state.connections?.map((connection) => (
              <button
                type="button"
                key={connection.id}
                className={`provider-preset personal ${
                  (view.kind === "connection" && view.id === connection.id)
                  || (connection.legacyPersonal && view.kind === "provider") ? "on" : ""
                }`}
                data-personal-connection-id={connection.id}
                aria-pressed={
                  (view.kind === "connection" && view.id === connection.id)
                  || (connection.legacyPersonal && view.kind === "provider")
                }
                disabled={phase !== "idle" || !!personalBusy || !!organizationBusy}
                onClick={() => choosePersonalConnection(connection)}
              >
                <span className={`provider-mini-dot ${connection.location}`} />
                <span>
                  <strong>{connection.label}</strong>
                  <small>{isLegacyProviderId(connection.provider) ? copy.legacyAlibaba : connection.provider} · {connection.model}</small>
                </span>
                {connection.active && <em>{copy.active}</em>}
              </button>
            ))}
            {personalConnectionsSupported && state.connections?.length === 0 && (
              <button type="button" className="provider-enterprise-empty personal" onClick={() => beginPersonalConnection()}>
                <span>+</span>
                <strong>{copy.addPersonal}</strong>
                <small>{copy.addFirstPersonal}</small>
              </button>
            )}
          </div>

          <p className="provider-catalog-caption">{copy.providerCatalog}</p>
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
                    data-provider-id={provider.id}
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
              const canActivate = !organizations.switchLocked
                && !["expired", "invalid"].includes(connection.accessState);
              return (
                <button
                  type="button"
                  key={connection.id}
                  className={`provider-preset enterprise ${view.kind === "organization" && view.id === connection.id ? "on" : ""}`}
                  data-connection-id={connection.id}
                  aria-pressed={view.kind === "organization" && view.id === connection.id}
                  disabled={!!organizationBusy}
                  onClick={() => {
                    chooseOrganization(connection);
                    if (!connection.active && canActivate) void useOrganization(connection);
                  }}
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
              <div className="provider-field">
                <span>{copy.model}</span>
                <ModelCombobox
                  value={draft.model}
                  options={selectedModelOptions}
                  disabled={phase !== "idle"}
                  ariaLabel={copy.model}
                  searchPlaceholder={copy.modelSearch}
                  customOptionLabel={copy.customModel}
                  customBadge={copy.customModelBadge}
                  emptyLabel={copy.noModelMatches}
                  onChange={(model) => {
                    setDraft((current) => ({ ...current, model }));
                    clearFeedback();
                  }}
                />
                {selectedModelOptions.length > 0 && (
                  <small>{models.length ? copy.liveModels : copy.knownModels}</small>
                )}
                {selectedCustomModel && (
                  <small className={selectedModelVerified ? "model-verification verified" : "model-verification"}>
                    {selectedModelVerified ? copy.customModelVerified : copy.customModelNeedsTest}
                  </small>
                )}
              </div>

              {(selected.customBaseURL || !!selected.defaultBaseURL) && (
                <label>
                  <span>{copy.endpoint}</span>
                  <input
                    value={draft.baseURL}
                    readOnly={!selected.customBaseURL}
                    aria-readonly={!selected.customBaseURL}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, baseURL: event.target.value }));
                      setModels([]);
                      setVerifiedCustomModels([]);
                      clearFeedback();
                    }}
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
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setModels([]);
                      setVerifiedCustomModels([]);
                      clearFeedback();
                    }}
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
              {selected.id === "token-plan" && <div className="provider-note">{copy.tokenPlanAuth}</div>}
              <div className={`provider-data-path ${selected.location}`}>
                {selected.location === "local" ? copy.dataLocal : copy.dataCloud}
              </div>

              <div className="provider-actions">
                <button type="button" className="ghost" disabled={!testValid || phase !== "idle"} onClick={() => void testConnection()}>
                  {phase === "testing" ? copy.testing : copy.test}
                </button>
                <button type="button" disabled={!valid || phase !== "idle"} onClick={() => void saveProvider()}>
                  {phase === "saving" ? copy.saving : state.current.profileId === "personal" ? copy.save : copy.switchSave}
                </button>
              </div>
            </div>
          )}

          {view.kind === "connection" && selectedConnection && (
            <div className="provider-organization-detail provider-personal-detail">
              <header className="provider-detail-heading">
                <div>
                  <span>{copy.personal} · {copy.savedConnection}</span>
                  <h3>{selectedConnection.label}</h3>
                </div>
                <span className={`provider-kind-badge ${selectedConnection.location}`}>
                  {selectedConnection.active ? copy.active : copy.available}
                </span>
              </header>

              <div className="organization-facts personal">
                <div>
                  <span>{copy.profile}</span>
                  <strong>{selectedConnectionIsLegacyAlibaba ? copy.legacyAlibaba : selectedConnection.provider}</strong>
                </div>
                <div><span>{copy.model}</span><strong>{selectedConnection.model}</strong></div>
                <div>
                  <span>{copy.keyHintLabel}</span>
                  <strong>{selectedConnection.keyHint || copy.noSavedKey}</strong>
                </div>
              </div>
              {selectedConnection.baseURL && (
                <div className="personal-connection-endpoint">
                  <span>{copy.endpoint}</span>
                  <strong>{selectedConnection.baseURL}</strong>
                </div>
              )}
              <div className={`provider-data-path ${selectedConnection.location}`}>
                {selectedConnection.location === "local" ? copy.dataLocal : copy.dataCloud}
              </div>
              <div className="provider-managed-note personal">
                {selectedConnectionIsLegacyAlibaba ? copy.legacyAlibabaHint : copy.immutableConnection}
              </div>

              {models.length > 0 && (
                <div className="provider-models">
                  <span>{copy.discovered}</span>
                  <div>{models.slice(0, 24).map((model) => <strong className="provider-model-readonly" key={model}>{model}</strong>)}</div>
                </div>
              )}

              <div className="organization-management-actions">
                {selectedConnectionIsLegacyAlibaba && tokenPlanProvider && (
                  <button
                    type="button"
                    disabled={!!personalBusy || !!organizationBusy}
                    onClick={() => {
                      if (selectedConnection.legacyPersonal) chooseProvider(tokenPlanProvider);
                      else beginPersonalConnection(tokenPlanProvider);
                    }}
                  >
                    {copy.migrateAlibaba}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  disabled={!!personalBusy || !!organizationBusy}
                  onClick={() => void testSavedPersonalConnection(selectedConnection)}
                >
                  {personalBusy === `test:${selectedConnection.id}` ? copy.testingSaved : copy.testSaved}
                </button>
                {!selectedConnection.active && (
                  <button
                    type="button"
                    disabled={!!personalBusy || !!organizationBusy || personalSwitchLocked}
                    onClick={() => void usePersonalConnection(selectedConnection)}
                  >
                    {personalBusy === `use:${selectedConnection.id}` ? copy.usingPersonal : copy.usePersonal}
                  </button>
                )}
                {selectedConnection.removable && (
                  <button
                    type="button"
                    className="ghost danger"
                    disabled={!!personalBusy || !!organizationBusy || (selectedConnection.active && personalSwitchLocked)}
                    onClick={() => void removePersonalConnection(selectedConnection)}
                  >
                    {personalBusy === `remove:${selectedConnection.id}` ? copy.removingPersonal : copy.removePersonal}
                  </button>
                )}
              </div>
            </div>
          )}

          {view.kind === "add-personal" && personalProvider && (
            <form
              className="provider-enrollment-form provider-personal-form"
              onSubmit={(event) => { event.preventDefault(); void createPersonalConnection(false); }}
            >
              <header className="provider-detail-heading">
                <div>
                  <span>{copy.personal} · {copy.addPersonal}</span>
                  <h3>{copy.addPersonalTitle}</h3>
                  <p>{copy.addPersonalDescription}</p>
                </div>
              </header>

              <label>
                <span>{copy.connectionName}</span>
                <input
                  value={personalDraft.label}
                  placeholder={copy.connectionNamePlaceholder}
                  maxLength={80}
                  autoComplete="off"
                  disabled={!!personalBusy}
                  onChange={(event) => {
                    const label = event.target.value;
                    setPersonalDraft((current) => ({
                      ...current,
                      label,
                      ...(!personalIdEdited
                        ? {
                            id: uniquePersonalConnectionId(
                              label || current.provider,
                              state.connections ?? [],
                              organizations?.connections ?? [],
                            ),
                          }
                        : {}),
                    }));
                  }}
                />
              </label>

              <label>
                <span>{copy.profile}</span>
                <select
                  value={personalDraft.provider}
                  disabled={!!personalBusy}
                  onChange={(event) => {
                    const provider = newPersonalProviders.find((candidate) => candidate.id === event.target.value);
                    if (!provider) return;
                    setPersonalDraft((current) => ({
                      ...current,
                      provider: provider.id,
                      model: provider.defaultModel,
                      baseURL: provider.defaultBaseURL ?? "",
                      ...(!personalIdEdited && !current.label.trim()
                        ? {
                            id: uniquePersonalConnectionId(
                              provider.id,
                              state.connections ?? [],
                              organizations?.connections ?? [],
                            ),
                          }
                        : {}),
                    }));
                    setApiKey("");
                    setModels([]);
                    setVerifiedCustomModels([]);
                    clearFeedback();
                  }}
                >
                  {newPersonalProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
                </select>
              </label>

              <div className="provider-field">
                <span>{copy.model}</span>
                <ModelCombobox
                  value={personalDraft.model}
                  options={personalModelOptions}
                  disabled={!!personalBusy}
                  ariaLabel={copy.model}
                  searchPlaceholder={copy.modelSearch}
                  customOptionLabel={copy.customModel}
                  customBadge={copy.customModelBadge}
                  emptyLabel={copy.noModelMatches}
                  onChange={(model) => {
                    setPersonalDraft((current) => ({ ...current, model }));
                    clearFeedback();
                  }}
                />
                {personalModelOptions.length > 0 && (
                  <small>{models.length ? copy.liveModels : copy.knownModels}</small>
                )}
                {personalCustomModel && (
                  <small className={personalModelVerified ? "model-verification verified" : "model-verification"}>
                    {personalModelVerified ? copy.customModelVerified : copy.customModelNeedsTest}
                  </small>
                )}
              </div>

              {(personalProvider.customBaseURL || !!personalProvider.defaultBaseURL) && (
                <label>
                  <span>{copy.endpoint}</span>
                  <input
                    value={personalDraft.baseURL}
                    readOnly={!personalProvider.customBaseURL}
                    aria-readonly={!personalProvider.customBaseURL}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={!!personalBusy}
                    onChange={(event) => {
                      setPersonalDraft((current) => ({ ...current, baseURL: event.target.value }));
                      setModels([]);
                      setVerifiedCustomModels([]);
                      clearFeedback();
                    }}
                  />
                </label>
              )}

              {personalProvider.auth === "api-key" && (
                <label>
                  <span>{copy.key}</span>
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={copy.keyNeed}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="new-password"
                    disabled={!!personalBusy}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setModels([]);
                      setVerifiedCustomModels([]);
                      clearFeedback();
                    }}
                  />
                  <small>{copy.keySafety}</small>
                </label>
              )}
              {personalProvider.auth === "none" && <div className="provider-note local">{copy.noKey}</div>}
              {personalProvider.auth === "oauth" && <div className="provider-note">{copy.oauth}</div>}
              {personalProvider.id === "token-plan" && <div className="provider-note">{copy.tokenPlanAuth}</div>}

              <details className="organization-advanced">
                <summary>{copy.advanced}</summary>
                <label>
                  <span>{copy.connectionId}</span>
                  <input
                    value={personalDraft.id}
                    maxLength={64}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    disabled={!!personalBusy}
                    onChange={(event) => {
                      setPersonalIdEdited(true);
                      setPersonalDraft((current) => ({ ...current, id: event.target.value }));
                    }}
                  />
                  <small>{copy.connectionIdHint}</small>
                </label>
              </details>

              <div className="provider-enrollment-safety personal">
                <span aria-hidden="true">◇</span>
                {copy.keySafety}
              </div>
              <div className="provider-actions personal-create-actions">
                <button type="button" className="ghost" disabled={!!personalBusy} onClick={cancelPersonalConnection}>{copy.cancel}</button>
                <button
                  type="button"
                  className="ghost"
                  disabled={!personalConnectionTestValid || !!personalBusy}
                  onClick={() => void testNewPersonalConnection()}
                >
                  {personalBusy === "test-new" ? copy.testing : copy.test}
                </button>
                {!personalSwitchLocked && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={!personalConnectionValid || !!personalBusy}
                    onClick={() => void createPersonalConnection(true)}
                  >
                    {personalBusy === "create" ? copy.saving : copy.addAndUsePersonal}
                  </button>
                )}
                <button type="submit" disabled={!personalConnectionValid || !!personalBusy}>
                  {personalBusy === "create" ? copy.saving : copy.saveConnectionOnly}
                </button>
              </div>
            </form>
          )}

          {view.kind === "organization" && selectedOrganization && (() => {
            const access = statusFor(selectedOrganization, locale);
            const checked = checks[selectedOrganization.id];
            const expiry = selectedOrganization.expiresAt && Number.isFinite(Date.parse(selectedOrganization.expiresAt))
              ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(selectedOrganization.expiresAt))
              : selectedOrganization.tokenNeverExpires ? copy.permanent : copy.never;
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

                {selectedOrganization.availableModels && selectedOrganization.availableModels.length > 0 && (
                  <div className="organization-model-catalog">
                    <span>{copy.authorizedModels}</span>
                    <div>
                      {selectedOrganization.availableModels.map((model) => <strong key={model}>{model}</strong>)}
                    </div>
                  </div>
                )}

                {selectedOrganization.services && selectedOrganization.services.length > 0 && (
                  <div className="organization-service-catalog">
                    <span>{copy.organizationServices}</span>
                    <div>
                      {selectedOrganization.services.map((service) => (
                        <strong key={service.service} title={`${service.host} · v${service.configVersion}`}>
                          {copy[`organizationService${service.service}`]}
                          <small>{service.host}</small>
                        </strong>
                      ))}
                    </div>
                  </div>
                )}

                <div className="provider-managed-note">{copy.managedData}</div>
                {organizations?.switchLocked && !projectPinned && <div className="provider-warning inline">{copy.pinned}</div>}
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
              </div>
            );
          })()}

          {view.kind === "enroll" && (
            <form className="provider-enrollment-form" onSubmit={(event) => { event.preventDefault(); void enrollOrganization(false); }}>
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
                {!editingOrganization && !organizations?.switchLocked && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={!organizationValid || !!organizationBusy}
                    onClick={() => void enrollOrganization(true)}
                  >
                    {organizationBusy === "enroll" ? copy.enrolling : copy.enrollAndUse}
                  </button>
                )}
                <button type="submit" disabled={!organizationValid || !!organizationBusy}>
                  {organizationBusy === "enroll" ? copy.enrolling : editingOrganization ? copy.reenrollSave : copy.enrollOnly}
                </button>
              </div>
            </form>
          )}

          {!selected && !selectedConnection && !selectedOrganization && view.kind !== "enroll" && view.kind !== "add-personal" && (
            <div className="provider-detail-empty">
              <strong>{copy.organizationEmpty}</strong>
              <span>{copy.organizationEmptyHint}</span>
              {!organizationsUnsupported && <button type="button" onClick={() => beginEnrollment()}>{copy.addOrganization}</button>}
            </div>
          )}

          {(phase === "testing" || phase === "saving" || !!personalBusy || organizationBusy === "unpin-project") && (
            <div className="provider-result pending" role="status" aria-live="polite">
              {organizationBusy === "unpin-project"
                ? copy.unpinningProject
                : personalBusy.startsWith("test:")
                  ? copy.testingSaved
                  : personalBusy === "test-new" || phase === "testing"
                    ? copy.testing
                    : personalBusy.startsWith("use:")
                      ? copy.usingPersonal
                      : personalBusy.startsWith("remove:")
                        ? copy.removingPersonal
                        : copy.saving}
            </div>
          )}
          {message && <div className="provider-result ok" role="status" aria-live="polite">{message}</div>}
          {error && <div className="provider-result error" role="alert" aria-live="assertive"><strong>{copy.loadFailed}</strong>{error}</div>}
        </div>
      </div>
    </section>
  );
}
