// Synthetic localhost fixture: no Tauri, Hara process, credentials, storage or paid calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import WorkspaceRuntimeAccess from "../../src/WorkspaceRuntimeAccess";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceRuntimeModels } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Synthetic localhost fixture only");
const locale = new URLSearchParams(location.search).get("locale") === "en" ? "en" : "zh-Hans";
function Preview() {
  const [agent, setAgent] = useState<WorkspaceDevAgent>({ agentId: "dora", kind: "colleague", state: "active", configRevision: 1,
    agentEpoch: 1, identity: { displayName: "Dora", title: "Hara 同事" }, runtime: { id: "pi", label: "Pi", available: true } });
  const [registered, setRegistered] = useState(false), [detected, setDetected] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [modelId, setModelId] = useState("fixture-one");
  const record = (text: string) => setEvents(old => [...old, text]);
  const workspace = { workspaceId: "synthetic", resourceGeneration: "fixture-1", selectedAgentId: agent.agentId, agents: [agent],
    runtimeOptions: [{ id: "pi", label: "Pi", available: true }, { id: "codex", label: "Codex", available: registered, reason: registered ? undefined : detected ? "not_registered" : "not_installed" }],
    runtimes: { options: [{ runtimeId: "codex", label: "Codex", state: detected ? registered ? "local_registered" : "detected" : "not_installed",
      registered, fingerprint: "synthetic-fingerprint", path: detected ? "/fixture/codex" : undefined }] },
    conversation: { state: "completed", history: [] },
  } as WorkspaceDevSnapshot;
  const listModels = React.useCallback(async (runtimeId: string): Promise<WorkspaceRuntimeModels> => {
    record("listModels(" + runtimeId + ")");
    return { runtimeId, revision: 1, selectedModelId: modelId, models: [
      { id: "fixture-one", label: runtimeId + " · Model One" }, { id: "fixture-two", label: runtimeId + " · Model Two" },
    ] };
  }, [modelId]);
  return <div className="hs wsd-app" data-theme="dark" style={{ padding: 36, boxSizing: "border-box", overflow: "auto" }}>
    <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 280px", gap: 32 }}>
      <main><h1>Dora · 管理</h1><WorkspaceRuntimeAccess agent={agent} workspace={workspace} locale={locale} listModels={listModels}
        onApplyRuntime={async (id, restart) => { record("setRuntime(" + id + ", " + restart + ")");
          setAgent(old => ({ ...old, configRevision: old.configRevision! + 1, runtime: { id, label: id === "codex" ? "Codex" : "Pi", available: true } })); }}
        onApplyModel={async (id, model) => { record("selectModel(" + id + ", " + model + ")"); setModelId(model); }}
        onRescan={async () => { record("detect()"); setDetected(true); }}
        onRegisterRuntime={async id => { record("registerLocal(" + id + ")"); setRegistered(true); }}
        onRuntimeDirectory={() => record("Settings catalog (synthetic only)")} /></main>
      <aside><p>仅供 fixture 验证</p><pre style={{ whiteSpace: "pre-wrap" }}>{events.join("\n")}</pre></aside>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
