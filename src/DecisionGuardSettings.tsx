import { useEffect, useMemo, useState } from "react";

import type {
  DecisionEngineId,
  DecisionMode,
  DecisionSettingsState,
  HaraClient,
} from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const copy = {
  en: {
    title: "Jev Action Guard",
    description: "One global structured judgment layer for consequential Computer Use, browser, connector, and external-message actions. It never grants permissions and never replaces Hara's deterministic rules.",
    enabled: "Enabled",
    disabled: "Off",
    engine: "Decision engine",
    engineHint: "Off keeps Hara's built-in guard only. TypeSafe uses one bounded System One judgment when an action is consequential.",
    off: "Built-in only",
    typesafe: "TypeSafe · Jev",
    mode: "Operating mode",
    modeHint: "Start with shadow, compare receipts, then promote deliberately.",
    shadow: "Shadow · observe only",
    advisory: "Advisory · ask on doubt",
    enforce: "Enforce · block or review",
    model: "Jev model",
    endpoint: "TypeSafe endpoint",
    credential: "TypeSafe API Key",
    credentialHint: "Write-only. A blank field preserves the current credential; Hara never returns it to Desktop.",
    stored: "Stored by Hara",
    environment: "Managed by environment",
    missing: "Missing",
    keyPlaceholder: "Paste a new TypeSafe API key",
    save: "Save",
    saving: "Saving…",
    test: "Test connection",
    testing: "Testing…",
    remove: "Remove stored key",
    removeConfirm: "Remove the TypeSafe credential stored by Hara? Jev will be unavailable until another credential is configured.",
    saved: "Action Guard settings saved",
    tested: "Connection verified",
    restartTitle: "Restart Hara Engine to apply this policy",
    restartHint: "Existing turns keep their original trust boundary. Restarting applies the new Action Guard to future actions.",
    restart: "Restart Engine",
    restarting: "Restarting…",
    managed: "Some fields are controlled by the Engine launch environment",
    safety: "Only bounded, redacted action context is sent. Screenshots, chat bodies, recipient IDs, credentials, and project files are excluded from the Jev judgment.",
  },
  zh: {
    title: "Jev 动作防护",
    description: "为 Computer Use、浏览器、连接器和外发消息提供一套全局结构化判断。它不会扩大权限，也不会替代 Hara 的确定性安全规则。",
    enabled: "已启用",
    disabled: "未启用",
    engine: "判断引擎",
    engineHint: "关闭时只使用 Hara 内置防护；TypeSafe 会在高影响动作前执行一次有边界的 System One 判断。",
    off: "仅内置防护",
    typesafe: "TypeSafe · Jev",
    mode: "运行模式",
    modeHint: "建议先用影子模式观察结果，再明确升级。",
    shadow: "影子 · 只观察",
    advisory: "建议 · 有疑问就确认",
    enforce: "强制 · 拦截或复核",
    model: "Jev 模型",
    endpoint: "TypeSafe 接口",
    credential: "TypeSafe API Key",
    credentialHint: "只写不读。留空会保留当前凭据；Hara 不会把密钥返回给 Desktop。",
    stored: "Hara 已保存",
    environment: "由启动环境管理",
    missing: "尚未配置",
    keyPlaceholder: "粘贴新的 TypeSafe API Key",
    save: "保存",
    saving: "正在保存…",
    test: "测试连接",
    testing: "正在测试…",
    remove: "移除已存密钥",
    removeConfirm: "确定移除 Hara 保存的 TypeSafe 凭据吗？配置其他凭据前 Jev 将不可用。",
    saved: "动作防护设置已保存",
    tested: "连接验证成功",
    restartTitle: "重启 Hara Engine 后生效",
    restartHint: "正在运行的回合保留原安全边界；重启后，未来动作才会使用新配置。",
    restart: "重启引擎",
    restarting: "正在重启…",
    managed: "部分字段由 Engine 启动环境管理",
    safety: "Jev 只接收有边界且已脱敏的动作上下文；截图、聊天正文、收件人 ID、凭据和项目文件均不会进入判断请求。",
  },
} as const;

export function DecisionGuardSettings({
  client,
  cwd,
  locale,
  restarting,
  onRestartEngine,
}: {
  client: HaraClient | null;
  cwd?: string;
  locale: Locale;
  restarting: boolean;
  onRestartEngine: () => void;
}) {
  const words = copy[locale];
  const [state, setState] = useState<DecisionSettingsState | null>(null);
  const [engine, setEngine] = useState<DecisionEngineId>("off");
  const [mode, setMode] = useState<DecisionMode>("shadow");
  const [model, setModel] = useState("jev-latest");
  const [baseURL, setBaseURL] = useState("https://api.typesafe.ai");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; title: string; body?: string } | null>(null);

  const apply = (next: DecisionSettingsState) => {
    setState(next);
    setEngine(next.engine);
    setMode(next.mode);
    setModel(next.model);
    setBaseURL(next.baseURL);
    setApiKey("");
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    if (!client) {
      setState(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    void client.getDecisionSettings(cwd).then((next) => {
      if (!cancelled && next) apply(next);
    }).catch((error: unknown) => {
      if (!cancelled) setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client, cwd]);

  const dirty = useMemo(() => Boolean(state && (
    engine !== state.engine
    || mode !== state.mode
    || model.trim() !== state.model
    || baseURL.trim().replace(/\/+$/u, "") !== state.baseURL.replace(/\/+$/u, "")
    || apiKey.trim()
  )), [apiKey, baseURL, engine, mode, model, state]);

  const save = async (clearApiKey = false) => {
    if (!client || !state || saving) return;
    if (clearApiKey && !window.confirm(words.removeConfirm)) return;
    setSaving(true);
    setNotice(null);
    try {
      const next = await client.saveDecisionSettings({
        engine,
        mode,
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
      }, cwd);
      apply(next);
      setRestartRequired(true);
      setNotice({ tone: "success", title: words.saved });
    } catch (error: unknown) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!client || testing) return;
    setTesting(true);
    setNotice(null);
    try {
      const result = await client.testDecisionSettings({
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }, cwd);
      setNotice(result.ok
        ? {
            tone: "success",
            title: words.tested,
            body: `${result.model ?? model} · ${result.decision ?? "review"} · ${Math.round((result.confidence ?? 0) * 100)}%${result.elapsedMs !== undefined ? ` · ${result.elapsedMs} ms` : ""}`,
          }
        : { tone: "error", title: result.error || "TypeSafe connection failed" });
    } catch (error: unknown) {
      setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const managed = state && (!state.engineEditable || !state.modeEditable || !state.modelEditable || !state.baseURLEditable || !state.credentialEditable);
  return (
    <section id="settings-action-guard" className="decision-guard-settings" aria-label={words.title}>
      <SettingsCard
        title={words.title}
        description={words.description}
        aside={state ? (
          <SettingsBadge tone={state.engine === "typesafe" ? "success" : "warning"}>
            {state.engine === "typesafe" ? words.enabled : words.disabled}
          </SettingsBadge>
        ) : undefined}
      >
        {loading ? <div className="computer-use-loading" role="status">…</div> : !state ? (
          <SettingsNotice tone="warning" title="Update the bundled Hara Engine to configure Jev." />
        ) : (
          <>
            <SettingsItem title={words.engine} description={words.engineHint}>
              <select value={engine} disabled={!state.engineEditable || saving} onChange={(event) => setEngine(event.target.value as DecisionEngineId)}>
                <option value="off">{words.off}</option>
                <option value="typesafe">{words.typesafe}</option>
              </select>
            </SettingsItem>
            <SettingsItem title={words.mode} description={words.modeHint}>
              <select value={mode} disabled={!state.modeEditable || saving} onChange={(event) => setMode(event.target.value as DecisionMode)}>
                <option value="shadow">{words.shadow}</option>
                <option value="advisory">{words.advisory}</option>
                <option value="enforce">{words.enforce}</option>
              </select>
            </SettingsItem>
            <SettingsItem title={words.model}>
              <input value={model} disabled={!state.modelEditable || saving} onChange={(event) => setModel(event.target.value)} />
            </SettingsItem>
            <SettingsItem title={words.endpoint}>
              <input value={baseURL} disabled={!state.baseURLEditable || saving} onChange={(event) => setBaseURL(event.target.value)} />
            </SettingsItem>
            <SettingsItem title={words.credential} description={words.credentialHint} htmlFor="settings-jev-api-key">
              <div className="decision-credential-control">
                <SettingsBadge tone={state.credential === "missing" ? "warning" : "success"}>
                  {state.credential === "stored" ? words.stored : state.credential === "environment" ? words.environment : words.missing}
                </SettingsBadge>
                <input
                  id="settings-jev-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  placeholder={words.keyPlaceholder}
                  disabled={!state.credentialEditable || saving}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>
            </SettingsItem>
            {managed && <SettingsNotice tone="warning" title={words.managed} />}
            <div className="decision-guard-actions">
              {state.credential === "stored" && state.credentialEditable && (
                <button type="button" className="ghost" disabled={saving || testing} onClick={() => void save(true)}>{words.remove}</button>
              )}
              <button type="button" className="ghost" disabled={saving || testing || (!apiKey.trim() && state.credential === "missing")} onClick={() => void test()}>
                {testing ? words.testing : words.test}
              </button>
              <button type="button" disabled={!dirty || saving || testing} onClick={() => void save()}>
                {saving ? words.saving : words.save}
              </button>
            </div>
            {notice && <SettingsNotice tone={notice.tone} title={notice.title}>{notice.body}</SettingsNotice>}
            {restartRequired && (
              <SettingsNotice
                tone="warning"
                title={words.restartTitle}
                actions={<button type="button" disabled={restarting} onClick={onRestartEngine}>{restarting ? words.restarting : words.restart}</button>}
              >
                {words.restartHint}
              </SettingsNotice>
            )}
            <SettingsNotice tone="neutral" title={words.safety} />
          </>
        )}
      </SettingsCard>
    </section>
  );
}
