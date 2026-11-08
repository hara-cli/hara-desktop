// DEV-only settings fixture. All runtime and proxy operations stay in memory.
import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsContent, SettingsOverlay } from "../../src/WorkspaceSettings";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "../../src/workspace-dev-state";
import "../../src/workspace-entry.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/violet-tokens.css";
import "../../src/violet-workspace.css";
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw new Error("Synthetic localhost fixture only");
const params = new URLSearchParams(location.search), locale = params.get("locale") ?? "en";
localStorage.setItem("hara.locale", locale);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const listeners = new Set<() => void>(), registrations: unknown[][] = [], approvals: unknown[][] = [];
let settleRegistration: (() => void) | undefined;
const options = [["codex", "Codex"], ["claude", "Claude Code"], ["gemini", "Gemini CLI"], ["kimi", "Kimi Code"],
  ["copilot", "GitHub Copilot"], ["cursor", "Cursor"], ["grok", "Grok Build"], ["agy", "Antigravity"]].map(([runtimeId, label]) => ({
    runtimeId, label, state: "detected", registered: false, version: "1.2.3", fingerprint: `fixture-${runtimeId}`,
    path: `/fixture/bin/${runtimeId}`, generalAgentDriverAvailable: true,
  }));
if (params.get("scenario") === "install") Object.assign(options[0], { state: "not_installed", path: undefined });
let workspace = { workspaceId: "fixture", resourceGeneration: "generation-1", label: "Synthetic workspace", selectedAgentId: "main",
  agents: [], approvals: [], connections: { revision: 1, connections: [] }, runtimes: { options, operations: [] }, conversation: { state: "completed", history: [] },
} as unknown as WorkspaceDevSnapshot;
let view = { workspaceId: workspace.workspaceId, workspace, error: "", directory: { workspaces: [
  { workspaceId: workspace.workspaceId, label: workspace.label, kind: "personal", role: "owner", active: true }], revision: 1 } };
const notify = () => { view = { ...view, workspace }; for (const listener of listeners) listener(); };
const model = { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => view,
  async detectRuntimes() {}, async refresh() {},
  async runtimeProxy(workspaceId: string, resourceGeneration: string) { return { workspaceId, resourceGeneration, revision: 1, proxyUrl: null }; },
  async registerLocalRuntime(...args: unknown[]) {
    registrations.push(args);
    if (params.get("scenario") === "pending") await new Promise<void>(resolve => { settleRegistration = resolve; });
    if (params.get("result") === "unknown") throw new Error("Synthetic registration outcome unknown");
    workspace = { ...workspace, runtimes: { ...workspace.runtimes!, options: workspace.runtimes!.options.map(row => row.runtimeId === args[0]
      ? { ...row, registered: true, state: "local_registered", loginSource: args[4] as "host" | "isolated" } : row) } };
    notify();
  },
  async proposeRuntime(runtimeId: string) { return { id: "fixture-card", runtimeId, label: "Codex", version: "1.2.3", origin: "https://fixture.invalid",
    sha256: "a".repeat(64), maxBytes: 1024, expiresAt: "2099-01-01T00:00:00.000Z", target: { platform: "darwin", arch: "arm64" },
    workspaceId: "fixture", resourceGeneration: "generation-1", viewEpoch: 1 }; },
  async approveRuntime(...args: unknown[]) { approvals.push(args); },
} as unknown as WorkspaceDevModel;
const updaterState = { state: "idle", available: false }, updater = { subscribe: () => () => {}, getSnapshot: () => updaterState };
let closeCount = 0;
(window as any).runtimeRegisterFixture = { registrations, approvals, get closeCount() { return closeCount; }, finishRegistration() { settleRegistration?.(); },
  changeScope() { workspace = { ...workspace, resourceGeneration: "generation-2" }; notify(); } };
createRoot(document.getElementById("root")!).render(<SettingsOverlay ready onClose={() => { closeCount++; }}>
  <SettingsContent mainModel={model} model={model} initialPage="runtimes" root="/fixture" production={true}
    theme={{} as any} updater={updater as any} versionInfo={null} onClose={() => { closeCount++; }} onCreateSkill={() => {}} />
</SettingsOverlay>);
