// Synthetic localhost fixture: no Tauri, Hara process, credentials, storage or paid calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import WorkspaceColleagueInspector from "../../src/WorkspaceColleagueInspector";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceRuntimeModels } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-tokens.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Synthetic localhost fixture only");
const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en" ? "en" : "zh-Hans";
const scenario = params.get("scenario") ?? "bound";
const main = params.get("agent") === "main";
const runtimeLabels: Record<string,string> = { gemini:"Gemini CLI", kimi:"Kimi CLI", copilot:"GitHub Copilot", cursor:"Cursor", grok:"Grok Build" };
const requestedRuntime = params.get("runtime") ?? "";
const expanded = scenario === "expanded" && Object.hasOwn(runtimeLabels, requestedRuntime);
const initialRuntime = expanded ? requestedRuntime : "codex";
function Preview() {
  const [agent, setAgent] = useState<WorkspaceDevAgent>({ agentId: main ? "main" : "dora", kind: main ? "main" : "colleague", state: "active", configRevision: 1,
    agentEpoch: 1, identity: { displayName: main ? "Hara" : "Dora", title: "Hara 同事" }, runtime: { id: initialRuntime, label: runtimeLabels[initialRuntime] ?? "Codex", available: scenario !== "missing" && scenario !== "integrity" } });
  const [registered, setRegistered] = useState(scenario !== "missing"), [detected, setDetected] = useState(false);
  const [inventoryFailed, setInventoryFailed] = useState(scenario === "inventory");
  const [integrityFailed, setIntegrityFailed] = useState(scenario === "integrity");
  const [events, setEvents] = useState<string[]>([]);
  const [modelId, setModelId] = useState("fixture-one");
  const record = (text: string) => setEvents(old => [...old, text]);
  const workspace = { workspaceId: "synthetic", resourceGeneration: "fixture-1", selectedAgentId: agent.agentId, agents: [agent],
    runtimeOptions: [{ id: "pi", label: "Pi", available: true }, { id: "codex", label: "Codex", available: registered && !integrityFailed,
      reason: integrityFailed ? "integrity_failed" : registered ? undefined : detected ? "not_registered" : "not_installed" },
      { id: "agy", label: "Antigravity", available: false, reason: "not_installed" },
      ...Object.entries(runtimeLabels).map(([id,label])=>({id,label,available:expanded}))],
    runtimes: { options: [{ runtimeId: "codex", label: "Codex", state: detected ? registered ? "local_registered" : "detected" : "not_installed",
      registered, loginSource: "host", fingerprint: "synthetic-fingerprint", path: detected ? "/fixture/codex" : undefined },
      ...Object.entries(runtimeLabels).map(([runtimeId,label])=>({runtimeId,label,state:expanded?"local_registered":"not_installed",registered:expanded,loginSource:"host" as const,generalAgentDriverAvailable:expanded,version:"1.2.3"}))] },
    conversation: { state: "completed", history: [] },
  } as WorkspaceDevSnapshot;
  const listModels = React.useCallback(async (runtimeId: string): Promise<WorkspaceRuntimeModels> => {
    record("listModels(" + runtimeId + ")");
    if (inventoryFailed) throw new Error("Synthetic model inventory failed");
    return { runtimeId, ...(expanded ? {source:runtimeId === "cursor" ? "live" as const : "documented" as const} : {}), revision: 1, selectedModelId: modelId, models: [
      { id: "fixture-one", label: runtimeId + " · Model One" }, { id: "fixture-two", label: runtimeId + " · Model Two" },
    ] };
  }, [modelId, inventoryFailed]);
  return <div className="hs wsd-app" data-theme="dark" style={{ padding: 24, boxSizing: "border-box", overflow: "auto" }}>
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 24px 340px" }}>
      <main><h1>Soft Dark · {scenario}</h1><p>仅供合成 fixture 验证；无真实引擎、凭据或任务。</p><pre style={{ whiteSpace: "pre-wrap" }}>{events.join("\n")}</pre></main>
      <WorkspaceColleagueInspector agent={agent} workspace={workspace} locale={locale} listModels={listModels}
        features={null} error="" inert={false} supported={false} onClose={() => record("close inspector")}
        onRefresh={() => record("refresh inspector")} onToggle={async () => {}} onSave={async () => {}} onDelete={async () => {}} onSaveProfile={async () => {}}
        onApplyRuntime={async (id, restart) => { record("setRuntime(" + id + ", " + restart + ")");
          setAgent(old => ({ ...old, configRevision: old.configRevision! + 1, runtime: { id, label: runtimeLabels[id] ?? (id === "codex" ? "Codex" : "Pi"), available: true } })); }}
        onApplyModel={async (id, model) => { record("selectModel(" + id + ", " + model + ")"); setModelId(model); }}
        onRescan={async () => { record("detect()"); setDetected(true); setInventoryFailed(false); setIntegrityFailed(false); }}
        onRegisterRuntime={async id => { record("registerLocal(" + id + ")"); setRegistered(true); setAgent(old => ({ ...old, runtime: { ...old.runtime, available: true } })); }}
        onRuntimeDirectory={() => record("Settings catalog (synthetic only)")} />
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
