import { useEffect, useMemo } from "react";
import {
  type HaraClient,
  type OrganizationConnectionsState,
  type OrganizationEnrollmentInput,
  type ProviderConnectionCreateInput,
  type ProviderSettingsInput,
  type ProviderSettingsState,
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
    { id: "deepseek", label: "DeepSeek", location: "cloud", auth: "api-key", defaultModel: "deepseek-chat", defaultBaseURL: "https://api.deepseek.com", customBaseURL: false },
    { id: "openrouter", label: "OpenRouter", location: "cloud", auth: "api-key", defaultModel: "openai/gpt-4o-mini", customBaseURL: true },
    { id: "ollama", label: "Ollama", location: "local", auth: "none", defaultModel: "qwen3", defaultBaseURL: "http://127.0.0.1:11434/v1", customBaseURL: true },
    { id: "hara-gateway", label: "Hara Enterprise Gateway", location: "managed", auth: "managed", defaultModel: "managed-model", customBaseURL: false },
  ],
  connections: [
    {
      id: "personal",
      label: "Personal",
      provider: "deepseek",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      location: "cloud",
      auth: "api-key",
      keyConfigured: true,
      authenticated: true,
      active: false,
      legacyPersonal: true,
      removable: false,
      keyHint: "••••4821",
    },
    {
      id: "qwen-coding",
      label: "Qwen Coding",
      provider: "openrouter",
      model: "qwen/qwen3-coder",
      baseURL: "https://openrouter.ai/api/v1",
      location: "cloud",
      auth: "api-key",
      keyConfigured: true,
      authenticated: true,
      active: false,
      legacyPersonal: false,
      removable: true,
      keyHint: "••••1907",
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
      supports: (method: string) => method.startsWith("settings.providers.connections.") || method.startsWith("settings.organizations."),
      listProviderSettings: async () => providerState,
      listOrganizationConnections: async () => organizationState,
      testProviderSettings: async () => ({ ok: true, models: ["deepseek-chat", "deepseek-reasoner"] }),
      saveProviderSettings: async (input: ProviderSettingsInput) => {
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
                active: true,
              }
            : { ...connection, active: false }),
          current: {
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
          },
        };
        organizationState = {
          ...organizationState,
          activeId: "personal",
          connections: organizationState.connections.map((connection) => ({ ...connection, active: false })),
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
        const removedActive = providerState.connections?.some((connection) => connection.id === id && connection.active);
        providerState = {
          ...providerState,
          connections: providerState.connections?.filter((connection) => connection.id !== id).map((connection) => ({
            ...connection,
            active: removedActive ? connection.id === "personal" : connection.active,
          })),
          ...(removedActive ? {
            current: {
              ...providerState.current,
              provider: "deepseek",
              model: "deepseek-chat",
              baseURL: "https://api.deepseek.com",
              location: "cloud" as const,
              auth: "api-key" as const,
              profileId: "personal",
              profileKind: "byok" as const,
              editable: true,
            },
          } : {}),
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
    const timer = window.setTimeout(() => {
      const selector = scenario === "add"
        ? "[data-preview-action='add-organization']"
        : scenario === "alternate" || scenario === "switch"
          ? "[data-connection-id='acme-client']"
          : "";
      if (selector) document.querySelector<HTMLButtonElement>(selector)?.click();
    }, 120);
    return () => {
      window.clearTimeout(timer);
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
