// Local synthetic recovery UI only; no Hara service, credentials, model calls or task execution.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceTaskRecovery } from "../../src/WorkspaceTaskRecovery";
import { makeT, type Locale } from "../../src/i18n";
import { RUNTIME_FAILURE_KINDS, RUNTIME_FAILURE_MARKER, type RuntimeFailureDiagnostic, type RuntimeFailureKind } from "../../src/runtime-failure";
import type { WorkspaceDevSnapshot } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-tokens.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || !["localhost", "127.0.0.1"].includes(location.hostname)) throw Error("Synthetic localhost fixture only");
const params = new URLSearchParams(location.search);
function Preview() {
  const [locale, setLocale] = useState<Locale>(params.get("locale") === "en" ? "en" : params.get("locale") === "zh-Hant" ? "zh-Hant" : "zh-Hans"), [runtime, setRuntime] = useState<RuntimeFailureDiagnostic["runtime"]>("codex");
  const [kind, setKind] = useState<RuntimeFailureKind>("runtime_auth_rejected"), [source, setSource] = useState<RuntimeFailureDiagnostic["loginSource"]>("host");
  const [retryAtMs, setRetryAt] = useState(0), [events, setEvents] = useState<string[]>([]);
  const diagnostic: RuntimeFailureDiagnostic = { runtime, kind, version: "0.163.0", loginSource: source, homeMatchesAccount: false, elapsedMs: 812, consecutiveFailures: 2, retryAtMs };
  const conversation = { state: "blocked", taskState: "blocked", sessionId: `original-session-${runtime}`, taskId: `original-task-${runtime}`, runId: `original-run-${runtime}`, history: [{ role: "user", content: "合成原任务" }], resumeAdmission: { allowed: true }, blockReason: `[${runtime} error] ${RUNTIME_FAILURE_MARKER}${JSON.stringify(diagnostic)} — PRIVATE_BODY_SHOULD_NEVER_RENDER` } as WorkspaceDevSnapshot["conversation"];
  const record = (event: string) => setEvents(previous => [...previous, event]);
  return <div className="hs wsd-app" data-theme="dark" style={{ padding: 24, overflow: "auto", display: "block" }}><main style={{ maxWidth: 760, margin: "0 auto" }}>
    <h1>Hara 同事 · 合成故障诊断</h1><p>此页面只记录按钮操作，不执行真实任务。</p>
    <label>语言 <select aria-label="语言" value={locale} onChange={event => setLocale(event.target.value as Locale)}>{["en", "zh-Hans", "zh-Hant"].map(value => <option key={value}>{value}</option>)}</select></label>{" "}
    <label>引擎 <select aria-label="引擎" value={runtime} onChange={event => { setRuntime(event.target.value as typeof runtime); setRetryAt(0); }}>{["codex", "claude", "opencode"].map(value => <option key={value}>{value}</option>)}</select></label>{" "}
    <label>分类 <select aria-label="分类" value={kind} onChange={event => setKind(event.target.value as RuntimeFailureKind)}>{RUNTIME_FAILURE_KINDS.map(value => <option key={value}>{value}</option>)}</select></label>{" "}
    <label>登录来源 <select aria-label="登录来源" value={source} onChange={event => setSource(event.target.value as typeof source)}>{["host", "isolated", "unknown"].map(value => <option key={value}>{value}</option>)}</select></label>{" "}
    <button type="button" className="hs-btn sec" onClick={() => setRetryAt(Date.now() + 3000)}>模拟 3 秒冷却</button>
    <WorkspaceTaskRecovery conversation={conversation} runtimeId={runtime} t={makeT(locale)} disabled={false}
      onContinue={() => record(`workspace.session.resume · original-task-${runtime} · ${runtime}`)} onRepair={() => record("repair")}
      onRuntimeSettings={() => record("runtime settings")} onLogin={() => record("private login guidance")} onRescan={() => record("rescan")} />
    <output aria-label="操作记录" style={{ whiteSpace: "pre-wrap" }}>{events.join("\n")}</output>
  </main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
