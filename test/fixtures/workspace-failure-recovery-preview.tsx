// Synthetic localhost UI only: no Tauri, Hara process, credentials, auth or paid calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceTaskRecovery } from "../../src/WorkspaceTaskRecovery";
import WorkspaceRuntimeSettings from "../../src/WorkspaceRuntimeSettings";
import { makeT } from "../../src/i18n";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-tokens.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || !["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Synthetic localhost fixture only");
const params = new URLSearchParams(location.search), locale = params.get("locale") === "en" ? "en" : params.get("locale") === "zh-Hant" ? "zh-Hant" : "zh-Hans";
const code = params.get("code") ?? "runtime_auth_required";
const loginSource = params.get("loginSource") === "host" ? "host" : "isolated";
function Preview() {
  const t = makeT(locale), [events, setEvents] = useState<string[]>([]), [settings, setSettings] = useState(false);
  const record = (event: string) => setEvents(old => [...old, event]);
  const conversation = { state: "blocked", taskState: "blocked", sessionId: "original-session", taskId: "original-task", runId: "original-run",
    history: [{ role: "user", content: "继续完成原任务" }], resumeAdmission: { allowed: true }, blockReason: `codex Runtime failed (${code}); no fallback was selected` } as WorkspaceDevSnapshot["conversation"];
  const workspace = { workspaceId: "synthetic", resourceGeneration: "fixture", runtimes: { options: [{ runtimeId: "codex", label: "Codex", registered: true, generalAgentDriverAvailable: true, state: "local_registered", loginSource, path: "/synthetic/codex", version: "fixture" }], operations: [] } } as unknown as WorkspaceDevSnapshot;
  const model = { detectRuntimes: async () => {}, codexLoginInstructions: async () => { record("login guidance read only"); return { runtimeId: "codex", shell: "posix", command: "env HOME='/synthetic/private-home' CODEX_HOME='/synthetic/private-home/.codex' '/synthetic/codex' login" }; } } as unknown as WorkspaceDevModel;
  return <div className="hs wsd-app" data-theme="dark" style={{ padding: 24, overflow: "auto", display: "block" }}>
    <main style={{ maxWidth: 700, margin: "0 auto" }}><h1>Hara · Soft Dark</h1><p>合成失败恢复验证 · Codex · 原任务保留</p>
      <WorkspaceTaskRecovery conversation={conversation} runtimeId="codex" loginSource={loginSource} t={t} disabled={false}
        onContinue={() => record("workspace.session.resume · original-task · codex")}
        onRepair={() => record("connection settings")} onLogin={() => { record("open runtime login guide"); setSettings(true); }}
        onRescan={() => record("explicit rescan")} onRuntimeSettings={() => setSettings(true)} />
      {settings ? <WorkspaceRuntimeSettings model={model} workspace={workspace} /> : null}
      <output style={{ whiteSpace: "pre-wrap" }}>{events.join("\n")}</output>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
