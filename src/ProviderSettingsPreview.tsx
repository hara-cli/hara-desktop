import { useEffect, useMemo } from "react";
import {
  type HaraClient,
  type OrganizationConnectionsState,
  type OrganizationEnrollmentInput,
  type ProviderConnectionCreateInput,
  type ProviderSettingsInput,
  type ProviderSettingsState,
  type VisionSettingsInput,
} from "./client";
import type { Locale } from "./i18n";
import { ProviderSettings } from "./ProviderSettings";

const initialProviders = (): ProviderSettingsState => ({
  current: {
    provider: "hara-gateway",
    model: "deepseek-chat",
    baseURL: "https://control.nanhara.example/v1",
    location: "managed",
    auth: "managed",
    keyConfigured: true,
    authenticated: true,
    profileId: "nanhara-internal",
    profileKind: "gateway",
    profileSource: "default",
    editable: false,
    tokenExpiresAt: "2026-08-22T12:00:00.000Z",
  },
  providers: [
    { id: "anthropic", label: "Anthropic", location: "cloud", auth: "api-key", defaultModel: "claude-opus-4-8", customBaseURL: false },
    {
      id: "token-plan",
      label: "Alibaba Cloud Model Studio Token Plan",
      location: "cloud",
      auth: "api-key",
      defaultModel: "qwen3.8-max",
      defaultBaseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      customBaseURL: false,
      knownModels: [
        "qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus", "qwen3.7-max", "qwen3.6-flash",
        "deepseek-v4-pro-0813", "deepseek-v4-pro", "deepseek-v4-flash-0731", "glm-5.2",
      ],
    },
    {
      id: "minimax-token-plan",
      label: "MiniMax Token Plan",
      location: "cloud",
      auth: "api-key",
      defaultModel: "MiniMax-M3",
      defaultBaseURL: "https://api.minimaxi.com/v1",
      customBaseURL: false,
      knownModels: ["MiniMax-M3"],
    },
    {
      id: "volcengine-agent-plan",
      label: "Volcengine Ark Agent Plan",
      location: "cloud",
      auth: "api-key",
      defaultModel: "auto",
      defaultBaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
      customBaseURL: false,
      knownModels: [
        "auto", "doubao-seed-evolving", "doubao-seed-2.1-turbo", "doubao-seed-2.0-lite",
        "doubao-seed-2.0-mini", "glm-5.3-flash", "glm-5.3", "deepseek-v4-pro",
        "deepseek-v4-flash", "minimax-m3", "kimi-k2.7-code", "kimi-k3", "ark-code-latest", "glm-latest",
      ],
      knownVisionModels: ["doubao-seed-2.1-turbo", "glm-5.3-flash", "minimax-m3", "kimi-k2.7-code", "kimi-k3"],
    },
    { id: "qwen", label: "Qwen (legacy DashScope)", location: "cloud", auth: "api-key", defaultModel: "qwen-plus", customBaseURL: true, legacy: true },
    { id: "qwen-oauth", label: "Qwen Code OAuth (legacy, not Token Plan)", location: "cloud", auth: "oauth", defaultModel: "coder-model", customBaseURL: false, legacy: true },
    { id: "deepseek", label: "DeepSeek", location: "cloud", auth: "api-key", defaultModel: "deepseek-chat", defaultBaseURL: "https://api.deepseek.com", customBaseURL: false },
    { id: "openrouter", label: "OpenRouter", location: "cloud", auth: "api-key", defaultModel: "openai/gpt-4o-mini", customBaseURL: true },
    { id: "ollama", label: "Ollama", location: "local", auth: "none", defaultModel: "qwen3", defaultBaseURL: "http://127.0.0.1:11434/v1", customBaseURL: true },
    { id: "hara-gateway", label: "Hara Enterprise Gateway", location: "managed", auth: "managed", defaultModel: "managed-model", customBaseURL: false },
  ],
  vision: {
    enabled: true,
    source: "current",
    provider: "hara-gateway",
    model: "deepseek-v4-flash-vision-exp",
    apiKeyConfigured: false,
    usesManagedCredential: true,
    editable: true,
    authorized: true,
    availableModels: ["deepseek-v4-flash-vision-exp"],
    authorizedModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
  },
  connections: [
    {
      id: "personal",
      label: "DeepSeek",
      provider: "deepseek",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      location: "cloud",
      auth: "api-key",
      keyConfigured: true,
      authenticated: true,
      active: false,
      legacyPersonal: true,
      removable: true,
      keyHint: "••••4821",
    },
  ],
  switchLocked: false,
});

const initialOrganizations = (): OrganizationConnectionsState => ({
  activeId: "nanhara-internal",
  activeSource: "default",
  switchLocked: false,
  connections: [
    {
      id: "nanhara-internal",
      label: "南荒内部",
      active: true,
      gatewayUrl: "https://control.nanhara.example",
      gatewayHost: "control.nanhara.example",
      model: "deepseek-chat",
      expiresAt: "2026-08-22T12:00:00.000Z",
      accessState: "valid",
      services: [
        {
          service: "MODEL_CONTROL",
          mode: "HARA_HOSTED",
          accountRegion: "CN",
          host: "control.nanhara.example",
          status: "ACTIVE",
          capabilitiesVersion: 1,
          configVersion: 3,
        },
        {
          service: "DESK_TASKS",
          mode: "CUSTOMER_HOSTED",
          accountRegion: "CN",
          host: "desk.nanhara.example",
          status: "ACTIVE",
          capabilitiesVersion: 2,
          configVersion: 4,
        },
        {
          service: "COLLAB",
          mode: "HARA_HOSTED",
          accountRegion: "GLOBAL",
          host: "groups.nanhara.example",
          status: "ACTIVE",
          capabilitiesVersion: 1,
          configVersion: 1,
        },
      ],
    },
    {
      id: "acme-client",
      label: "Acme 客户环境",
      active: false,
      gatewayUrl: "https://hara-control.acme.example",
      gatewayHost: "hara-control.acme.example",
      model: "glm-5",
      expiresAt: "2026-07-23T10:00:00.000Z",
      accessState: "expiring",
    },
  ],
});

export function ProviderSettingsPreview({ locale, scenario }: { locale: Locale; scenario?: string | null }) {
  const client = useMemo(() => {
    let providerState = initialProviders();
    let organizationState = initialOrganizations();
    if (scenario === "pin") {
      providerState = {
        ...providerState,
        current: { ...providerState.current, profileSource: "pin" },
      };
      organizationState = { ...organizationState, activeSource: "pin", switchLocked: true };
    }
    const syncProvider = () => {
      const active = organizationState.connections.find((connection) => connection.active);
      if (active) {
        providerState = {
          ...providerState,
          connections: providerState.connections?.map((connection) => ({ ...connection, active: false })),
          current: {
            ...providerState.current,
            provider: "hara-gateway",
            model: active.model,
            baseURL: `${active.gatewayUrl}/v1`,
            location: "managed",
            auth: "managed",
            authenticated: !["expired", "invalid"].includes(active.accessState),
            profileId: active.id,
            profileKind: "gateway",
            editable: false,
            tokenExpiresAt: active.expiresAt,
          },
        };
      }
    };
    return {
      supports: (method: string) => method === "settings.vision.save" || method === "settings.vision.test" || method.startsWith("settings.providers.connections.") || method.startsWith("settings.organizations."),
      listProviderSettings: async () => providerState,
      listOrganizationConnections: async () => organizationState,
      testProviderSettings: async () => ({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"] }),
      testVisionSettings: async (input: Omit<VisionSettingsInput, "enabled"> & { source: "current" | "custom" }) => {
        const models = input.source === "current"
          ? providerState.vision?.availableModels ?? []
          : providerState.providers.find((provider) => provider.id === input.provider)?.knownVisionModels ?? [];
        return { ok: models.length > 0, models };
      },
      saveProviderSettings: async (input: ProviderSettingsInput) => {
        const activatePersonal = input.activatePersonal === true || providerState.current.profileId === "personal";
        providerState = {
          ...providerState,
          connections: providerState.connections?.map((connection) => connection.id === "personal"
            ? {
                ...connection,
                provider: input.provider,
                model: input.model,
                baseURL: input.baseURL,
                location: input.provider === "ollama" ? "local" : "cloud",
                auth: input.provider === "ollama" ? "none" : "api-key",
                keyConfigured: true,
                authenticated: true,
                active: activatePersonal,
              }
            : { ...connection, active: false }),
          current: activatePersonal
            ? {
                ...providerState.current,
                provider: input.provider,
                model: input.model,
                baseURL: input.baseURL,
                location: input.provider === "ollama" ? "local" : "cloud",
                auth: input.provider === "ollama" ? "none" : "api-key",
                keyConfigured: true,
                authenticated: true,
                profileId: "personal",
                profileKind: "byok",
                profileSource: "default",
                editable: true,
                tokenExpiresAt: undefined,
              }
            : providerState.current,
        };
        if (activatePersonal) {
          organizationState = {
            ...organizationState,
            activeId: "personal",
            connections: organizationState.connections.map((connection) => ({ ...connection, active: false })),
          };
        }
        return providerState;
      },
      saveVisionSettings: async (input: VisionSettingsInput) => {
        providerState = {
          ...providerState,
          vision: input.enabled
            ? {
                enabled: true,
                source: providerState.current.profileKind === "gateway" ? "current" : input.source ?? "current",
                provider: providerState.current.profileKind === "gateway"
                  ? "hara-gateway"
                  : input.provider ?? providerState.current.provider,
                model: input.model,
                baseURL: input.baseURL,
                apiKeyConfigured: Boolean(input.apiKey || (providerState.vision?.apiKeyConfigured && !input.clearApiKey)),
                usesManagedCredential: providerState.current.profileKind === "gateway",
                editable: true,
                authorized: true,
                availableModels: input.model ? [input.model] : [],
                authorizedModels: providerState.vision?.authorizedModels,
              }
            : {
                enabled: false,
                source: "current",
                provider: providerState.current.provider,
                apiKeyConfigured: false,
                usesManagedCredential: providerState.current.profileKind === "gateway",
                editable: true,
                authorized: true,
                availableModels: providerState.vision?.availableModels ?? [],
                authorizedModels: providerState.vision?.authorizedModels,
              },
        };
        return providerState;
      },
      createProviderConnection: async (input: ProviderConnectionCreateInput) => {
        const provider = providerState.providers.find((candidate) => candidate.id === input.provider)!;
        const connection = {
          id: input.id,
          label: input.label,
          provider: input.provider,
          model: input.model,
          baseURL: input.baseURL,
          location: provider.location as "cloud" | "local",
          auth: provider.auth as "api-key" | "oauth" | "none",
          keyConfigured: provider.auth === "none" || !!input.apiKey,
          authenticated: true,
          active: input.activate === true,
          legacyPersonal: false,
          removable: true,
          keyHint: input.apiKey ? `••••${input.apiKey.slice(-4)}` : undefined,
        };
        providerState = {
          ...providerState,
          connections: [
            ...(providerState.connections ?? []).map((candidate) => ({ ...candidate, active: connection.active ? false : candidate.active })),
            connection,
          ],
          ...(connection.active ? {
            current: {
              ...providerState.current,
              provider: connection.provider,
              model: connection.model,
              baseURL: connection.baseURL,
              location: connection.location,
              auth: connection.auth,
              keyConfigured: connection.keyConfigured,
              authenticated: true,
              profileId: connection.id,
              profileKind: "byok" as const,
              editable: false,
              tokenExpiresAt: undefined,
            },
          } : {}),
        };
        if (connection.active) {
          organizationState = {
            ...organizationState,
            activeId: connection.id,
            connections: organizationState.connections.map((candidate) => ({ ...candidate, active: false })),
          };
        }
        return providerState;
      },
      testProviderConnection: async (id: string) => ({ ok: true, models: [providerState.connections?.find((connection) => connection.id === id)?.model ?? "model"] }),
      useProviderConnection: async (id: string) => {
        const connection = providerState.connections?.find((candidate) => candidate.id === id)!;
        providerState = {
          ...providerState,
          connections: providerState.connections?.map((candidate) => ({ ...candidate, active: candidate.id === id })),
          current: {
            ...providerState.current,
            provider: connection.provider,
            model: connection.model,
            baseURL: connection.baseURL,
            location: connection.location,
            auth: connection.auth,
            keyConfigured: connection.keyConfigured,
            authenticated: connection.auth === "none" || connection.keyConfigured,
            profileId: connection.id,
            profileKind: "byok",
            editable: connection.legacyPersonal,
            tokenExpiresAt: undefined,
          },
        };
        organizationState = {
          ...organizationState,
          activeId: id,
          connections: organizationState.connections.map((candidate) => ({ ...candidate, active: false })),
        };
        return providerState;
      },
      removeProviderConnection: async (id: string) => {
        const removed = providerState.connections?.find((connection) => connection.id === id);
        if (!removed) return providerState;
        providerState = {
          ...providerState,
          connections: providerState.connections?.filter((connection) => connection.id !== id),
          current: providerState.current.profileId === id
            ? {
                ...providerState.current,
                provider: "anthropic",
                model: "claude-opus-4-8",
                baseURL: undefined,
                location: "cloud",
                auth: "api-key",
                keyConfigured: false,
                authenticated: false,
                profileId: "personal",
                profileKind: "byok",
                editable: true,
              }
            : providerState.current,
        };
        return providerState;
      },
      unpinProjectProfile: async () => {
        providerState = {
          ...providerState,
          current: { ...providerState.current, profileSource: "default" },
        };
        organizationState = { ...organizationState, activeSource: "default", switchLocked: false };
        return { removed: true, providers: providerState, organizations: organizationState };
      },
      useOrganizationConnection: async (id: string) => {
        organizationState = {
          ...organizationState,
          activeId: id,
          connections: organizationState.connections.map((connection) => ({ ...connection, active: connection.id === id })),
        };
        syncProvider();
        return organizationState;
      },
      removeOrganizationConnection: async (id: string) => {
        const removedActive = organizationState.connections.some((connection) => connection.id === id && connection.active);
        organizationState = {
          ...organizationState,
          activeId: removedActive ? "personal" : organizationState.activeId,
          connections: organizationState.connections.filter((connection) => connection.id !== id),
        };
        if (removedActive) providerState = initialProviders();
        return organizationState;
      },
      checkOrganizationConnection: async (id: string) => ({ id, ok: true, checkedAt: Date.now() }),
      enrollOrganizationConnection: async (input: OrganizationEnrollmentInput) => {
        const url = new URL(input.gatewayUrl);
        const connection = {
          id: input.id,
          label: input.label || input.id,
          active: input.activate !== false,
          gatewayUrl: url.origin,
          gatewayHost: url.host,
          model: "managed-model",
          expiresAt: "2026-09-22T12:00:00.000Z",
          accessState: "valid" as const,
        };
        organizationState = {
          ...organizationState,
          activeId: connection.active ? connection.id : organizationState.activeId,
          connections: [
            ...organizationState.connections.filter((item) => item.id !== connection.id).map((item) => ({ ...item, active: connection.active ? false : item.active })),
            connection,
          ],
        };
        if (connection.active) syncProvider();
        return organizationState;
      },
    } as unknown as HaraClient;
  }, [scenario]);

  useEffect(() => {
    if (!scenario) return;
    let followup: number | undefined;
    const timer = window.setTimeout(() => {
      if (scenario === "token-plan") {
        document.querySelector<HTMLButtonElement>("[data-preview-action='add-personal']")?.click();
        followup = window.setTimeout(() => {
          const providerSelect = document.querySelector<HTMLSelectElement>(".provider-personal-form select");
          if (!providerSelect) return;
          providerSelect.value = "token-plan";
          providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }, 0);
        return;
      }
      const selector = scenario === "add"
        ? "[data-preview-action='add-organization']"
        : scenario === "alternate" || scenario === "switch"
          ? "[data-connection-id='acme-client']"
          : "";
      if (selector) document.querySelector<HTMLButtonElement>(selector)?.click();
    }, 120);
    return () => {
      window.clearTimeout(timer);
      if (followup !== undefined) window.clearTimeout(followup);
    };
  }, [scenario]);

  return (
    <main className="provider-preview-shell">
      <div className="provider-preview-head">
        <span>Hara Desktop · visual QA</span>
        <h1>{locale === "zh" ? "模型与连接" : "Models & connections"}</h1>
      </div>
      <ProviderSettings client={client} locale={locale} embedded scope={scenario === "pin" ? "workspace" : "global"} onSaved={() => {}} />
    </main>
  );
}
