import type { WorkspaceConnectionModels, WorkspaceDevSnapshot } from "./workspace-dev-state";

export type ConnectionCatalogReason = "ready" | "new" | "upgrade" | "unavailable" | "keyRequired" | "sourceChanged" | "busy";
export interface ConnectionCatalogScope {
  key: string; reason: ConnectionCatalogReason; connectionId: string; agentId: string; revision: number;
}
export interface ConnectionCatalogDraft { provider: "openai" | "anthropic"; baseURL: string; keyEdited: boolean }

/** A catalog belongs to a saved source, never to an unsaved key or endpoint. No secrets enter the key. */
export function connectionCatalogScope(workspace: WorkspaceDevSnapshot | null, connectionId: string | undefined,
  draft: ConnectionCatalogDraft, supported: boolean, busy: boolean): ConnectionCatalogScope {
  const row = workspace?.connections.connections.find(value => value.id === connectionId);
  const agent = workspace?.agents.find(value => value.kind === "main" && value.state === "active");
  const revision = workspace?.connections.revision ?? -1;
  const store = workspace?.connections;
  const reason: ConnectionCatalogReason = !connectionId ? "new" : !supported ? "upgrade"
    : !workspace || !agent || row?.status !== "active" || store?.readOnly || store?.migrationPending || store?.unavailable ? "unavailable"
    : draft.keyEdited || draft.provider !== (row.provider ?? "openai") || draft.baseURL !== (row.baseURL ?? "") ? "sourceChanged"
    : row.credentialRequired || row.keyState === "invalid" || row.keySaved === false ? "keyRequired"
    : busy ? "busy" : "ready";
  return { key: JSON.stringify([workspace?.workspaceId, workspace?.resourceGeneration, revision,
    agent?.agentId, agent?.configRevision, agent?.agentEpoch, agent?.runtime.id, connectionId,
    row?.status, row?.provider, row?.baseURL, row?.defaultModel, row?.defaultReasoning, row?.keySaved, row?.keyState,
    row?.credentialRequired, row?.cleanupPending, reason, draft.provider, draft.baseURL, draft.keyEdited, busy]),
    reason, connectionId: connectionId ?? "", agentId: agent?.agentId ?? "", revision };
}

export interface ConnectionCatalogState {
  scope: string; phase: "idle" | "loading" | "ready" | "failed" | "stale"; catalog?: WorkspaceConnectionModels;
}

/** An explicit read. Late replies cannot cross a source change, invalidation, or workspace generation. */
export class SettingsConnectionCatalog {
  private serial = 0;
  private state: ConnectionCatalogState = { scope: "", phase: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly current: () => ConnectionCatalogScope;
  private readonly read: (agentId: string, connectionId: string) => Promise<WorkspaceConnectionModels>;
  constructor(current: () => ConnectionCatalogScope, read: (agentId: string, connectionId: string) => Promise<WorkspaceConnectionModels>) {
    this.current = current; this.read = read;
  }
  getSnapshot = (): ConnectionCatalogState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: ConnectionCatalogState): void { this.state = state; for (const listener of this.listeners) listener(); }
  invalidate = (): void => { this.serial++; this.update({ scope: "", phase: "idle" }); };
  async request(expectedScope?: string): Promise<void> {
    const source = this.current();
    if (expectedScope !== undefined && source.key !== expectedScope || source.reason !== "ready" || this.state.scope === source.key && this.state.phase === "loading") return;
    const serial = ++this.serial;
    this.update({ scope: source.key, phase: "loading" });
    try {
      const catalog = await this.read(source.agentId, source.connectionId);
      if (serial !== this.serial || this.current().key !== source.key) return;
      if (catalog.connectionId !== source.connectionId || catalog.revision !== source.revision) {
        this.update({ scope: source.key, phase: "stale" }); return;
      }
      if (!["live", "documented"].includes(catalog.source) || !Array.isArray(catalog.models)
        || catalog.models.some(row => typeof row.id !== "string" || !row.id.trim() || typeof row.label !== "string")) throw new Error("Invalid model catalog");
      this.update({ scope: source.key, phase: "ready", catalog });
    } catch {
      // A provider/transport error may contain URLs or credentials. Only a local, generic result is exposed.
      if (serial === this.serial && this.current().key === source.key) this.update({ scope: source.key, phase: "failed" });
    }
  }
}
