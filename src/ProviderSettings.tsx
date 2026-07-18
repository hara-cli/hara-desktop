import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type HaraClient,
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

interface ProviderSettingsProps {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  onSaved: (state: ProviderSettingsState) => void;
}

const words = {
  en: {
    title: "Models & providers",
    subtitle: "Choose where Hara thinks. Credentials stay in Hara's private local state and are never returned to this window.",
    current: "Current route",
    configured: "configured",
    needsAuth: "credentials needed",
    cloud: "Cloud",
    local: "On this computer",
    managed: "Managed",
    model: "Model",
    endpoint: "Endpoint",
    key: "API key",
    keyKeep: "Configured — leave blank to keep it",
    keyNeed: "Enter a provider API key",
    noKey: "No API key is required. Hara only connects to this loopback endpoint.",
    oauth: "This connection uses browser sign-in. Run `hara login qwen` once, then test again.",
    managedHint: "This connection is controlled by your organization.",
    test: "Test connection",
    save: "Save for new sessions",
    switchSave: "Save & switch to Personal",
    testing: "Testing…",
    saving: "Saving…",
    connected: "Connection and model responded successfully.",
    discovered: "Models found",
    unavailable: "This Desktop build includes an engine that is too old for provider settings. Update Hara Desktop and restart it.",
    environment: "HARA_* environment variables currently override these fields. Remove them before editing here.",
    pinned: "This project selects a profile by flag, environment, or .hara-profile. Switch or unpin it before changing Personal settings.",
    profile: "Profile",
    dataLocal: "Data path: model requests stay on this computer.",
    dataCloud: "Data path: task context is sent to the selected provider endpoint.",
    nextSession: "Saved. New sessions use this connection; running sessions keep their current runtime.",
    refresh: "Refresh",
    choose: "Choose a connection",
    keySafety: "The key is masked, never stored in localStorage, and cleared from this form after save.",
  },
  zh: {
    title: "模型与供应商",
    subtitle: "选择 Hara 在哪里思考。密钥只进入 Hara 的本机私有状态，设置接口不会把它返回到窗口。",
    current: "当前连接",
    configured: "已配置",
    needsAuth: "需要认证",
    cloud: "云端模型",
    local: "本机模型",
    managed: "企业托管",
    model: "模型",
    endpoint: "接口地址",
    key: "API 密钥",
    keyKeep: "已经配置；留空继续使用",
    keyNeed: "输入该供应商的 API 密钥",
    noKey: "不需要 API 密钥，Hara 只连接这个本机回环地址。",
    oauth: "此连接使用浏览器登录。先运行一次 `hara login qwen`，再回来测试。",
    managedHint: "此连接由所在企业统一管理。",
    test: "测试连接",
    save: "保存，供新会话使用",
    switchSave: "保存并切换到个人连接",
    testing: "正在测试…",
    saving: "正在保存…",
    connected: "连接与模型响应正常。",
    discovered: "发现的模型",
    unavailable: "当前 Desktop 内置引擎还不支持供应商设置；请升级 Hara Desktop 后重新启动。",
    environment: "当前有 HARA_* 环境变量覆盖这些字段，请先移除环境覆盖再在这里修改。",
    pinned: "此项目由启动参数、环境变量或 .hara-profile 固定了身份；请先切换或取消固定。",
    profile: "身份",
    dataLocal: "数据路径：模型请求只在这台电脑上处理。",
    dataCloud: "数据路径：任务上下文会发送到所选供应商地址。",
    nextSession: "已保存。新会话使用此连接；正在运行的会话保持原运行环境。",
    refresh: "刷新",
    choose: "选择连接",
    keySafety: "密钥只在密码框中短暂停留，不写入 localStorage，保存后立即从表单清空。",
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
    // An invalid endpoint is rejected by Serve. Treat it as a new credential boundary here so the UI
    // never promises to reuse a stored key for a value the control plane has not validated.
    return `invalid:${raw}`;
  }
};

const groupLabel = (
  location: ProviderCatalogEntry["location"],
  copy: (typeof words)[Locale],
): string => copy[location];

export function ProviderSettings({ client, cwd, locale, onSaved }: ProviderSettingsProps) {
  const copy = words[locale];
  const [state, setState] = useState<ProviderSettingsState | null>(null);
  const [draft, setDraft] = useState<Draft>({ provider: "", model: "", baseURL: "" });
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [phase, setPhase] = useState<"loading" | "idle" | "testing" | "saving">("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    setPhase("loading");
    // A transient credential belongs to the exact draft visible when it was entered. Refresh replaces that
    // draft, so clear the secret before awaiting any response — including failure/unsupported responses.
    setApiKey("");
    setMessage("");
    setError("");
    try {
      const next = await client.listProviderSettings(cwd);
      if (!next) {
        setUnsupported(true);
        return;
      }
      setUnsupported(false);
      setState(next);
      setDraft(draftFromState(next));
      setModels([]);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPhase("idle");
    }
  }, [client, cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => state?.providers.find((provider) => provider.id === draft.provider),
    [draft.provider, state?.providers],
  );
  const sameProvider = state?.current.provider === draft.provider;
  const sameEndpoint =
    endpointIdentity(draft.baseURL || selected?.defaultBaseURL) ===
    endpointIdentity(state?.current.baseURL);
  const canReuseKey = !!(
    state?.current.profileId === "personal" &&
    sameProvider &&
    sameEndpoint &&
    state.current.keyConfigured
  );
  const keyMissing = selected?.auth === "api-key" && !apiKey.trim() && !canReuseKey;
  const lockedProfile =
    !!state &&
    state.current.profileId !== "personal" &&
    ["flag", "env", "pin"].includes(state.current.profileSource);
  const blocked = !!state?.current.environmentOverride || lockedProfile || selected?.location === "managed";
  const valid = !!selected && !!draft.model.trim() && !keyMissing && !blocked;

  const chooseProvider = (provider: ProviderCatalogEntry) => {
    if (provider.location === "managed") return;
    setDraft({
      provider: provider.id,
      model: provider.id === state?.current.provider ? state.current.model : provider.defaultModel,
      baseURL:
        provider.id === state?.current.provider
          ? state.current.baseURL ?? provider.defaultBaseURL ?? ""
          : provider.defaultBaseURL ?? "",
    });
    setApiKey("");
    setModels([]);
    setMessage("");
    setError("");
  };

  const input = (): ProviderSettingsInput => ({
    provider: draft.provider,
    model: draft.model.trim(),
    ...(draft.baseURL.trim() ? { baseURL: draft.baseURL.trim() } : {}),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(state?.current.profileId !== "personal" ? { activatePersonal: true } : {}),
  });

  const testConnection = async () => {
    if (!client || !valid) return;
    setPhase("testing");
    setMessage("");
    setError("");
    try {
      const result = await client.testProviderSettings(input(), cwd);
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

  const save = async () => {
    if (!client || !valid) return;
    setPhase("saving");
    setMessage("");
    setError("");
    try {
      const next = await client.saveProviderSettings(input(), cwd);
      setState(next);
      setDraft(draftFromState(next));
      setApiKey("");
      setMessage(copy.nextSession);
      onSaved(next);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setPhase("idle");
    }
  };

  if (unsupported) {
    return <div className="provider-unsupported">{copy.unavailable}</div>;
  }
  if (!state || phase === "loading") {
    return <div className="setrow dim">{error || "…"}</div>;
  }

  const locations: ProviderCatalogEntry["location"][] = ["cloud", "local", "managed"];
  return (
    <section className="provider-console" aria-labelledby="provider-settings-title">
      <header className="provider-heading">
        <div>
          <h2 id="provider-settings-title">{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <button type="button" className="ghost compact" disabled={phase !== "idle"} onClick={() => void load()}>
          {copy.refresh}
        </button>
      </header>

      <div className={`provider-route ${state.current.authenticated ? "configured" : "missing"}`}>
        <span className="provider-status-dot" aria-hidden="true" />
        <div>
          <span>
            {copy.current} · {state.current.authenticated ? copy.configured : copy.needsAuth}
          </span>
          <strong>
            {state.current.provider} · {state.current.model}
          </strong>
        </div>
        <div className="provider-route-meta">
          {copy.profile}: {state.current.profileId} · {state.current.profileSource}
        </div>
      </div>

      {state.current.environmentOverride && <div className="provider-warning">{copy.environment}</div>}
      {lockedProfile && <div className="provider-warning">{copy.pinned}</div>}

      <div className="provider-workbench">
        <nav className="provider-presets" aria-label={copy.choose}>
          {locations.map((location) => {
            const entries = state.providers.filter((provider) => provider.location === location);
            if (entries.length === 0) return null;
            return (
              <div className="provider-group" key={location}>
                <div className="provider-group-label">{groupLabel(location, copy)}</div>
                {entries.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    className={`provider-preset ${draft.provider === provider.id ? "on" : ""}`}
                    disabled={
                      phase !== "idle" ||
                      (provider.location === "managed" && state.current.provider !== provider.id)
                    }
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
        </nav>

        <div className="provider-form">
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

          {selected?.customBaseURL && (
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

          {selected?.auth === "api-key" && (
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

          {selected?.auth === "none" && <div className="provider-note local">{copy.noKey}</div>}
          {selected?.auth === "oauth" && <div className="provider-note">{copy.oauth}</div>}
          {selected?.auth === "managed" && <div className="provider-note">{copy.managedHint}</div>}
          {selected && (
            <div className={`provider-data-path ${selected.location}`}>
              {selected.location === "local" ? copy.dataLocal : copy.dataCloud}
            </div>
          )}

          {models.length > 0 && (
            <div className="provider-models">
              <span>{copy.discovered}</span>
              <div>
                {models.slice(0, 24).map((model) => (
                  <button type="button" className={draft.model === model ? "on" : ""} key={model} disabled={phase !== "idle"} onClick={() => setDraft((current) => ({ ...current, model }))}>
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
            <button type="button" disabled={!valid || phase !== "idle"} onClick={() => void save()}>
              {phase === "saving"
                ? copy.saving
                : state.current.profileId === "personal"
                  ? copy.save
                  : copy.switchSave}
            </button>
          </div>
          {message && <div className="provider-result ok">{message}</div>}
          {error && <div className="provider-result error">{error}</div>}
        </div>
      </div>
    </section>
  );
}
