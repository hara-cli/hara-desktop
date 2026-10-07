import { useEffect, useMemo, useRef, useState } from "react";

import type {
  DecisionEngineId,
  DecisionMode,
  DecisionSettingsState,
  HaraClient,
  LayaRuntimeState,
} from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const copy = {
  en: {
    title: "Action Guard",
    description: "One global structured judgment layer for consequential Computer Use, browser, connector, and external-message actions. It never grants permissions and never replaces Hara's deterministic rules.",
    enabled: "Enabled",
    disabled: "Off",
    engine: "Decision engine",
    engineHint: "One global choice for all Agents. Keep the built-in guard, add cloud Jev, or observe local Laya judgments.",
    off: "Built-in only",
    typesafe: "TypeSafe · Jev",
    laya: "Local · Laya-MLX (experimental)",
    localTitle: "Local decisions, no API key",
    localHint: "Multilingual · 322M · Apple Silicon / macOS 14+. This judgment stays on your computer; the main chat model keeps its own connection. Not an OCR, screen-reading or coding engine.",
    localBoundary: "Observation only. A 1,024-token budget includes the question, options and action. Overflow is rejected, never truncated. No automatic cloud fallback or permission changes.",
    localMode: "Laya is limited to shadow mode until Hara-specific safety evaluations are complete.",
    localPrepare: "Prepare local engine",
    localPreparing: "Preparing…",
    localReady: "Ready for local testing",
    localMissing: "Not downloaded",
    localUnsupported: "Requires Apple Silicon / macOS 14+",
    localFailed: "Preparation failed; retry",
    localConfirm: "Download Laya-MLX 0.2.0, its dependencies and a multilingual checkpoint (about 620 MiB of weights, plus runtime files) into Hara's private local runtime? Uses PyPI and Hugging Face; uv may also download Python. Requires uv or Python 3.11+. No chat data is uploaded. This does not enable the engine or change permissions.",
    localStarted: "Local preparation started",
    localStartedHint: "You can leave Settings and return to check progress. Test after preparation, then save to opt in.",
    localTested: "Local test passed · observation only",
    localTest: "Test local engine",
    localTestFailed: "Local engine test failed",
    localScope: "All Agents share one resident worker; it unloads after a minute of inactivity.",
    upgrade: "Update the bundled Hara Engine to configure Action Guard.",
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
    title: "动作防护",
    description: "为 Computer Use、浏览器、连接器和外发消息提供一套全局结构化判断。它不会扩大权限，也不会替代 Hara 的确定性安全规则。",
    enabled: "已启用",
    disabled: "未启用",
    engine: "判断引擎",
    engineHint: "所有 Agent 共用一套全局配置：仅内置防护、云端 Jev，或观察本地 Laya 的判断。",
    off: "仅内置防护",
    typesafe: "TypeSafe · Jev",
    laya: "本地 · Laya-MLX（实验）",
    localTitle: "本地判断，无需 API Key",
    localHint: "多语言 · 322M · Apple 芯片 / macOS 14+。这部分判断不离开电脑；主聊天模型仍使用自己的连接。它不负责 OCR、看屏幕或写代码。",
    localBoundary: "只观察，不决定授权。1,024 token 包含问题、选项和动作；超限会拒绝判断，不会截断，也不会自动回退到云端。",
    localMode: "完成 Hara 专项安全评测前，Laya 仅支持影子模式。",
    localPrepare: "准备本地引擎",
    localPreparing: "正在准备…",
    localReady: "已准备，可测试",
    localMissing: "尚未下载",
    localUnsupported: "需要 Apple 芯片 / macOS 14+",
    localFailed: "准备失败，可重试",
    localConfirm: "下载 Laya-MLX 0.2.0、依赖和多语言模型到 Hara 私有运行目录吗？权重约 620 MiB，另需运行环境空间。会访问 PyPI 和 Hugging Face；uv 可能还会下载 Python。需要本机有 uv 或 Python 3.11+。不会上传聊天内容，不会自动启用引擎或改变权限。",
    localStarted: "已开始准备本地引擎",
    localStartedHint: "可先离开设置，回来查看进度。准备完成后先测试，再保存启用。",
    localTested: "本地测试通过 · 仅观察",
    localTest: "测试本地引擎",
    localTestFailed: "本地引擎测试失败",
    localScope: "所有 Agent 共用一个常驻服务；空闲一分钟后释放。",
    upgrade: "更新内置 Hara Engine 后可配置动作防护。",
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

export function layaErrorMessage(error: string, locale: Locale): string {
  if (locale !== "zh") return error;
  if (/1024-token|token budget|context_budget_exceeded|question_budget_exceeded/.test(error)) return "输入超过 Laya 的 1,024 token 预算，已拒绝判断；不会截断内容后继续执行。";
  if (/verification failed|could not be verified/.test(error)) return "本地运行环境或模型校验失败，请重新准备本地引擎。";
  if (/preparation failed/.test(error)) return "准备失败，请检查本机 Python 3.11+ 或 uv，以及 PyPI、Hugging Face 的网络连接，然后重试。";
  if (/Prepare the local Laya/.test(error)) return "请先准备本地引擎，完成后再测试。";
  if (/cancelled|timed out/.test(error)) return "本地判断已取消或超时，未使用此次结果。";
  return error;
}

/** Shared by the live settings form and rendering tests; never receives keys or task data. */
export function LayaDecisionPanel({ runtime, locale }: { runtime: LayaRuntimeState; locale: Locale }) {
  const words = copy[locale];
  const label = ({ unsupported: words.localUnsupported, missing: words.localMissing, preparing: words.localPreparing, ready: words.localReady, error: words.localFailed })[runtime.status];
  return (
    <div className="laya-decision-panel" data-runtime-status={runtime.status}>
      <div className="laya-decision-heading">
        <strong>{words.localTitle}</strong>
        <SettingsBadge tone={runtime.status === "ready" ? "success" : "warning"}>{label}</SettingsBadge>
      </div>
      <p>{words.localHint}</p>
      <code>{runtime.model}</code>
      <small>{words.localScope}</small>
      <SettingsNotice tone="warning" title={words.localBoundary} />
      {runtime.error && <SettingsNotice tone="error" title={words.localFailed}>{layaErrorMessage(runtime.error, locale)}</SettingsNotice>}
    </div>
  );
}

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
  const [preparing, setPreparing] = useState(false);
  const operationLock = useRef(false);
  const generation = useRef(0);
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
    generation.current++;
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
    return () => { cancelled = true; generation.current++; };
  }, [client, cwd]);

  // Background preparation survives a settings navigation. Poll only while it is active, without
  // overwriting the user's unsaved engine selection or exposing the cloud credential.
  useEffect(() => {
    if (!client || state?.laya?.status !== "preparing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await client.getDecisionSettings(cwd);
        if (!cancelled && next) setState((current) => current ? { ...current, laya: next.laya } : next);
      } catch {
        // Keep the observable preparing state; reconnecting can fetch it again.
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 2_000);
    };
    timer = setTimeout(() => void refresh(), 2_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, cwd, state?.laya?.status]);

  const local = engine === "laya-mlx";
  const busy = saving || testing || preparing;

  const dirty = useMemo(() => Boolean(state && (
    engine !== state.engine
    || mode !== state.mode
    || model.trim() !== state.model
    || baseURL.trim().replace(/\/+$/u, "") !== state.baseURL.replace(/\/+$/u, "")
    || (!local && apiKey.trim())
  )), [apiKey, baseURL, engine, mode, model, state]);

  const save = async (clearApiKey = false) => {
    if (!client || !state || operationLock.current) return;
    if (clearApiKey && !window.confirm(words.removeConfirm)) return;
    operationLock.current = true;
    const ticket = generation.current;
    setSaving(true);
    setNotice(null);
    try {
      const next = await client.saveDecisionSettings({
        engine,
        mode,
        model: model.trim(),
        baseURL: baseURL.trim(),
        ...(!local && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
      }, cwd);
      if (ticket !== generation.current) return;
      apply(next);
      setRestartRequired(true);
      setNotice({ tone: "success", title: words.saved });
    } catch (error: unknown) {
      if (ticket === generation.current) setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      operationLock.current = false;
      setSaving(false);
    }
  };

  const test = async () => {
    if (!client || operationLock.current) return;
    operationLock.current = true;
    const ticket = generation.current;
    setTesting(true);
    setNotice(null);
    try {
      const result = await client.testDecisionSettings({
        engine,
        ...(!local ? { model: model.trim(), baseURL: baseURL.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } : {}),
      }, cwd);
      if (ticket !== generation.current) return;
      if (local && !result.ok) {
        // Verification can mark a previously ready runtime as broken. Refresh its status so the
        // repair button is available immediately, without replacing any unsaved form values.
        const next = await client.getDecisionSettings(cwd).catch(() => null);
        if (ticket !== generation.current) return;
        if (next) setState((current) => current ? { ...current, laya: next.laya } : current);
      }
      setNotice(result.ok
        ? {
            tone: "success",
            title: local ? words.localTested : words.tested,
            body: `${result.model ?? model} · ${result.decision ?? "review"} · ${Math.round((result.confidence ?? 0) * 100)}%${result.elapsedMs !== undefined ? ` · ${result.elapsedMs} ms` : ""}`,
          }
        : { tone: "error", title: local ? words.localTestFailed : words.test,
            body: local ? layaErrorMessage(result.error || words.localTestFailed, locale) : result.error || "TypeSafe connection failed" });
    } catch (error: unknown) {
      if (ticket === generation.current) setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      operationLock.current = false;
      setTesting(false);
    }
  };

  const prepare = async () => {
    if (!client || operationLock.current || !window.confirm(words.localConfirm)) return;
    operationLock.current = true;
    const ticket = generation.current;
    setPreparing(true);
    setNotice(null);
    try {
      const runtime = await client.prepareLayaRuntime(true);
      if (ticket !== generation.current) return;
      setState((current) => current ? { ...current, laya: runtime } : current);
      setNotice({ tone: "success", title: words.localStarted, body: words.localStartedHint });
    } catch (error: unknown) {
      if (ticket === generation.current) setNotice({ tone: "error", title: error instanceof Error ? error.message : String(error) });
    } finally {
      operationLock.current = false;
      setPreparing(false);
    }
  };

  const managed = state && (!state.engineEditable || (!local && (!state.modeEditable || !state.modelEditable || !state.baseURLEditable || !state.credentialEditable)));
  return (
    <section id="settings-action-guard" className="decision-guard-settings" aria-label={words.title}>
      <SettingsCard
        title={words.title}
        description={words.description}
        aside={state ? (
          <SettingsBadge tone={state.engine !== "off" ? "success" : "warning"}>
            {state.engine !== "off" ? words.enabled : words.disabled}
          </SettingsBadge>
        ) : undefined}
      >
        {loading ? <div className="computer-use-loading" role="status">…</div> : !state ? (
          <SettingsNotice tone="warning" title={words.upgrade} />
        ) : (
          <>
            <SettingsItem title={words.engine} description={words.engineHint}>
              <select value={engine} disabled={!state.engineEditable || busy} onChange={(event) => {
                const next = event.target.value as DecisionEngineId;
                setEngine(next);
                if (next === "laya-mlx") setMode("shadow");
                setNotice(null);
              }}>
                <option value="off">{words.off}</option>
                <option value="typesafe">{words.typesafe}</option>
                {state.laya && <option value="laya-mlx" disabled={!state.laya.supported}>{words.laya}</option>}
              </select>
            </SettingsItem>
            <SettingsItem title={words.mode} description={local ? words.localMode : words.modeHint}>
              <select value={mode} disabled={local || !state.modeEditable || busy} onChange={(event) => setMode(event.target.value as DecisionMode)}>
                <option value="shadow">{words.shadow}</option>
                <option value="advisory">{words.advisory}</option>
                <option value="enforce">{words.enforce}</option>
              </select>
            </SettingsItem>
            {local && state.laya ? <LayaDecisionPanel runtime={state.laya} locale={locale} /> : <>
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
            </>}
            {managed && <SettingsNotice tone="warning" title={words.managed} />}
            <div className="decision-guard-actions">
              {local && state.laya?.supported && <button type="button" className="ghost" disabled={busy || state.laya.status === "preparing" || state.laya.status === "ready"} onClick={() => void prepare()}>
                {state.laya.status === "preparing" || preparing ? words.localPreparing : words.localPrepare}
              </button>}
              {!local && state.credential === "stored" && state.credentialEditable && (
                <button type="button" className="ghost" disabled={saving || testing} onClick={() => void save(true)}>{words.remove}</button>
              )}
              <button type="button" className="ghost" disabled={busy || (local ? state.laya?.status !== "ready" : !apiKey.trim() && state.credential === "missing")} onClick={() => void test()}>
                {testing ? words.testing : local ? words.localTest : words.test}
              </button>
              <button type="button" disabled={!dirty || busy || (local && state.laya?.status !== "ready")} onClick={() => void save()}>
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
            {!local && <SettingsNotice tone="neutral" title={words.safety} />}
          </>
        )}
      </SettingsCard>
    </section>
  );
}
