import { WorkspaceDevConnectionClient, type WorkspaceDevConnection } from "./workspace-dev-rpc.ts";
import { WorkspaceDevModel } from "./workspace-dev-state.ts";

export type WorkspaceStartupPhase = "connecting" | "handshake" | "loading" | "ready" | "failed" | "disconnected";
export interface WorkspaceStartupView { phase: WorkspaceStartupPhase; attempt: number; diagnostic: string | null; model: WorkspaceDevModel | null; root: string }
const nativeFailures = new Map([
  ["The exact Hara Core sidecar is unavailable", "CORE_SIDECAR_UNAVAILABLE"],
  ["Cannot start Workspace Core", "CORE_START_FAILED"],
  ["Workspace Core startup failed; original data preserved", "CORE_EXITED"],
  ["Workspace startup is not yet confirmed; attachment may be retried without restarting or resending tasks", "CORE_START_PENDING"],
  ["Existing Workspace discovery is unsafe; data preserved", "CORE_DISCOVERY_REFUSED"],
  ["Existing Workspace engine cannot be safely attached", "CORE_ATTACHMENT_REFUSED"],
  ["Another owned Workspace startup is still pending; no new engine was launched", "CORE_START_PENDING"],
  ["Workspace startup worker unavailable", "CORE_WORKER_UNAVAILABLE"],
]);
/** Only fixed codes reach the view. Native strings, tokens, paths and RPC bodies are never reflected. */
export function workspaceStartupDiagnostic(error: unknown, phase: WorkspaceStartupPhase): string {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return nativeFailures.get(message) ?? (phase === "handshake" ? "CORE_HANDSHAKE_FAILED" : phase === "loading" ? "WORKSPACE_LOAD_FAILED" : "CORE_CONNECT_FAILED");
}
type Client = Pick<WorkspaceDevConnectionClient, "initialize" | "close" | "setChangedListener" | "request" | "supportsCapability">;
interface StartupDependencies {
  client?(info: WorkspaceDevConnection, disconnected: () => void): Client;
  model?(client: Client, info: WorkspaceDevConnection, settingsOnly?: boolean): WorkspaceDevModel;
}
/** One explicit attachment attempt at a time. Never resumes tasks or launches a retry timer. */
export class WorkspaceStartupModel {
  private view: WorkspaceStartupView = { phase: "connecting", attempt: 0, diagnostic: null, model: null, root: "" };
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private client: Client | null = null;
  private pending: Promise<void> | null = null;
  private readonly connect: () => Promise<WorkspaceDevConnection>;
  private readonly dependencies: StartupDependencies;
  constructor(connect: () => Promise<WorkspaceDevConnection>, dependencies: StartupDependencies = {}) { this.connect = connect;this.dependencies = dependencies; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<WorkspaceStartupView>) { this.view = { ...this.view, ...patch };for (const listener of this.listeners) listener(); }
  private makeClient(info: WorkspaceDevConnection, disconnected: () => void): Client { return this.dependencies.client?.(info, disconnected) ?? new WorkspaceDevConnectionClient(info, disconnected); }
  private makeModel(client: Client, info: WorkspaceDevConnection, settingsOnly = false): WorkspaceDevModel {
    return this.dependencies.model?.(client, info, settingsOnly) ?? new WorkspaceDevModel(client, undefined, info.syntheticOnly, info.executionMode, settingsOnly);
  }
  start = (): Promise<void> => {
    if (this.pending) return this.pending;
    const epoch = ++this.epoch;this.client?.close();this.client = null;
    this.update({ phase: "connecting", attempt: this.view.attempt + 1, diagnostic: null, model: null, root: "" });
    const request = this.open(epoch);this.pending = request;
    void request.finally(() => { if (this.pending === request) this.pending = null; });
    return request;
  };
  private async open(epoch: number): Promise<void> {
    let client: Client | undefined, phase: WorkspaceStartupPhase = "connecting";
    try {
      const info = await this.connect();if (epoch !== this.epoch) return;
      client = this.makeClient(info, () => {
        if (epoch !== this.epoch) return;
        if (this.view.model) this.update({ phase: "disconnected", diagnostic: "CORE_CONNECTION_CLOSED" });
        else {
          ++this.epoch;this.client = null;this.pending = null;
          this.update({ phase: "failed", diagnostic: phase === "loading" ? "WORKSPACE_LOAD_FAILED" : "CORE_HANDSHAKE_FAILED", model: null, root: "" });
        }
      });
      if (epoch !== this.epoch) { client.close();return; }
      this.client = client;phase = "handshake";this.update({ phase });
      await client.initialize(info.token);if (epoch !== this.epoch) { client.close();return; }
      const next = this.makeModel(client, info);
      client.setChangedListener((id, agentId) => { if (epoch === this.epoch) next.workspaceChanged(id, agentId); });
      next.setSettingsFactory(async () => {
        let live = true;const settingsClient = this.makeClient(info, () => {});
        try {
          await settingsClient.initialize(info.token);const settingsModel = this.makeModel(settingsClient, info, true);
          settingsClient.setChangedListener((id, agentId) => { if (live) settingsModel.workspaceChanged(id, agentId); });
          return { model: settingsModel, close() { live = false;settingsClient.close(); } };
        } catch { settingsClient.close();throw new Error("Settings connection unavailable"); }
      });
      phase = "loading";this.update({ phase });await next.loadDirectory();if (epoch !== this.epoch) { client.close();return; }
      const directory = next.getSnapshot().directory;if (!directory) throw new Error("Workspace directory unavailable");
      if (directory.activeWorkspaceId && directory.workspaces.some(row => row.workspaceId === directory.activeWorkspaceId && row.active)) {
        await next.selectWorkspace(directory.activeWorkspaceId);if (epoch !== this.epoch) { client.close();return; }
        if (!next.getSnapshot().workspace) throw new Error("Workspace snapshot unavailable");
      }
      this.update({ phase: "ready", model: next, root: info.root });
    } catch (error) {
      if (epoch !== this.epoch) return;
      const diagnostic = workspaceStartupDiagnostic(error, phase);++this.epoch;
      client?.close();this.client = null;this.update({ phase: "failed", diagnostic, model: null, root: "" });
    }
  }
  stop = () => { ++this.epoch;this.client?.close();this.client = null;this.pending = null; };
}
