import type { WorkspaceDevApproval, WorkspaceDevMessage, WorkspaceDevModel } from "./workspace-dev-state";
export interface LocalChannel { id: string; name: string; memberIds: string[]; createdAt: string }
export interface LocalChannelCatalog { workspaceId: string; resourceGeneration: string; revision: number; channels: LocalChannel[] }
export interface LocalChannelSnapshot { workspaceId: string; resourceGeneration: string; channel: LocalChannel; revision: number; state: string;
  messages: { id: string; turnId: string; agentId: string | null; displayName: string; createdAt: string; message: WorkspaceDevMessage }[];
  turns: { id: string; state: string; replies: { agentId: string; displayName: string; state: string }[] }[]; approvals: WorkspaceDevApproval[] }
interface Pending { body: string; requestId: string; recipientIds: string[]; state: "sending" | "unknown" }
interface Creation { id: string; name: string; memberIds: string[]; expectedRevision: number }
export interface LocalChannelsView { scope: string; supported: boolean; catalog: LocalChannelCatalog | null; channelId: string | null; channel: LocalChannelSnapshot | null;
  loading: boolean; saving: boolean; draft: string; recipientIds: string[]; pending: Pending | null; error: string; creationUnknown: boolean }
const empty: LocalChannelsView = { scope: "", supported: false, catalog: null, channelId: null, channel: null, loading: false, saving: false, draft: "", recipientIds: [], pending: null, error: "", creationUnknown: false };
const explicitRefusal = (error: unknown) => !!error && typeof error === "object" && "code" in error && typeof error.code === "number";

/** The renderer selects intent; Core owns membership, sessions, persistence and execution. */
export class WorkspaceLocalChannelsModel {
  private view = empty;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private selection = 0;
  private workspaceId = "";
  private generation = "";
  private drafts = new Map<string, string>();
  private recipients = new Map<string, string[]>();
  private pending = new Map<string, Pending>();
  private creation = new Map<string, Creation>();
  private approvals = new Set<string>();
  private refreshing: Promise<void> | null = null;
  private readonly model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels">;
  private readonly nonce: () => string;
  constructor(model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels">, nonce = () => crypto.randomUUID()) { this.model = model; this.nonce = nonce; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<LocalChannelsView>) { this.view = { ...this.view, ...value }; for (const listener of this.listeners) listener(); }
  private key(channelId = this.view.channelId) { return JSON.stringify([this.workspaceId, this.generation, channelId]); }
  private request<T>(method: string, extra: Record<string, unknown> = {}) {
    return this.model.localChannelRequest<T>(method, { ...extra, workspaceId: this.workspaceId, expectedGeneration: this.generation });
  }
  private valid(value: { workspaceId: string; resourceGeneration: string }) {
    if (value?.workspaceId !== this.workspaceId || value.resourceGeneration !== this.generation) throw new Error("Channel response belongs to another Workspace");
  }
  async bind(workspaceId: string, generation: string) {
    const scope = JSON.stringify([workspaceId, generation]); if (scope === this.view.scope) return;
    const epoch = ++this.epoch; ++this.selection; this.refreshing = null; this.workspaceId = workspaceId; this.generation = generation;
    const supported = this.model.supportsLocalChannels();
    this.update({ ...empty, scope, supported, creationUnknown: this.creation.has(scope) });
    if (!workspaceId || !generation || !supported) return;
    await this.loadCatalog(epoch);
  }
  private async loadCatalog(epoch = this.epoch) {
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.list"); if (epoch !== this.epoch) return;
      this.valid(value); if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.channels)) throw new Error("Invalid channel catalog");
      this.update({ catalog: value, error: this.view.error === "ws.channels.loadFailed" ? "" : this.view.error });
    } catch { if (epoch === this.epoch) this.update({ error: "ws.channels.loadFailed" }); }
  }
  clearSelection() { ++this.selection; this.update({ channelId: null, channel: null, loading: false, draft: "", recipientIds: [], pending: null, error: "" }); }
  async select(channelId: string) {
    if (!this.view.catalog?.channels.some(row => row.id === channelId)) return;
    const epoch = this.epoch, selection = ++this.selection, key = this.key(channelId);
    this.update({ channelId, channel: null, loading: true, draft: this.drafts.get(key) ?? "", recipientIds: this.recipients.get(key) ?? [], pending: this.pending.get(key) ?? null, error: "" });
    try {
      const value = await this.request<LocalChannelSnapshot>("workspace.channels.select", { channelId });
      if (epoch !== this.epoch || selection !== this.selection) return;
      this.apply(value, channelId); if (this.pending.get(key)?.state === "unknown") await this.verifyPending();
    } catch { if (epoch === this.epoch && selection === this.selection) this.update({ loading: false, error: "ws.channels.loadFailed" }); }
  }
  private apply(value: LocalChannelSnapshot, channelId: string) {
    this.valid(value);
    if (value.channel?.id !== channelId || !Array.isArray(value.messages) || !Array.isArray(value.approvals) || !Array.isArray(value.turns)
      || value.approvals.some(card => card.workspaceId !== this.workspaceId || card.resourceGeneration !== this.generation || card.channelId !== channelId)) throw new Error("Invalid channel conversation");
    const pending = this.pending.get(this.key(channelId)) ?? null;
    const recipients = this.recipients.get(this.key(channelId));
    const recipientIds = recipients ? recipients.filter(id => value.channel.memberIds.includes(id)) : [...value.channel.memberIds];
    this.recipients.set(this.key(channelId), recipientIds);
    this.update({ channel: value, loading: false, error: pending?.state === "unknown" ? "ws.channels.sendUnknown" : this.view.error === "ws.channels.loadFailed" ? "" : this.view.error,
      draft: this.drafts.get(this.key(channelId)) ?? "", recipientIds, pending });
  }
  async refresh() {
    if (!this.view.supported || !this.workspaceId) return;
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch, selection = this.selection, channelId = this.view.channelId;
    const work = (async () => {
      await this.loadCatalog(epoch); if (epoch !== this.epoch || selection !== this.selection || !channelId) return;
      try { const value = await this.request<LocalChannelSnapshot>("workspace.channels.snapshot", { channelId });
        if (epoch === this.epoch && selection === this.selection) this.apply(value, channelId);
      } catch { if (epoch === this.epoch && selection === this.selection) this.update({ error: "ws.channels.loadFailed" }); }
    })();
    this.refreshing = work;
    try { await work; } finally { if (this.refreshing === work) this.refreshing = null; }
  }
  setDraft(draft: string) { if (!this.view.channelId) return; this.drafts.set(this.key(), draft); this.update({ draft }); }
  setRecipients(recipientIds: string[]) {
    const members = this.view.channel?.channel.memberIds; if (!members || this.view.pending || ["running", "draining"].includes(this.view.channel?.state ?? "")) return;
    const next = [...new Set(recipientIds)].filter(id => members.includes(id)); this.recipients.set(this.key(), next); this.update({ recipientIds: next });
  }
  async create(name: string, memberIds: string[]): Promise<string | null> {
    if (!this.view.catalog || this.view.saving || !name.trim()) return null;
    const epoch = this.epoch, scope = this.view.scope, workspaceId = this.workspaceId, generation = this.generation;
    const item = this.creation.get(scope) ?? { id: this.nonce(), name: name.trim(), memberIds: [...memberIds], expectedRevision: this.view.catalog.revision };
    this.creation.set(scope, item); this.update({ saving: true, error: "" });
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.create", { channelId: item.id, name: item.name, memberIds: item.memberIds, expectedRevision: item.expectedRevision });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation) throw new Error("Invalid creation scope");
      if (!value.channels.some(row => row.id === item.id && row.name === item.name)) throw new Error("Invalid creation receipt");
      this.creation.delete(scope); if (epoch !== this.epoch) return null;
      this.update({ catalog: value, saving: false, creationUnknown: false }); await this.select(item.id); return item.id;
    } catch (error) {
      if (explicitRefusal(error)) this.creation.delete(scope);
      if (epoch === this.epoch) this.update({ saving: false, creationUnknown: !explicitRefusal(error), error: explicitRefusal(error) ? "ws.channels.saveFailed" : "ws.channels.createUnknown" });
      return null;
    }
  }
  async verifyCreation(): Promise<string | null> {
    const item = this.creation.get(this.view.scope); if (!item) return null;
    const epoch = this.epoch; await this.loadCatalog(epoch); if (epoch !== this.epoch) return null;
    const found = this.view.catalog?.channels.find(row => row.id === item.id);
    if (!found || found.name !== item.name) { this.update({ error: "ws.channels.createUnknown" }); return null; }
    this.creation.delete(this.view.scope); this.update({ creationUnknown: false, error: "" }); await this.select(item.id); return item.id;
  }
  async updateMembers(name: string, memberIds: string[]): Promise<boolean> {
    const { catalog, channelId } = this.view; if (!catalog || !channelId || this.view.saving || !name.trim()) return false;
    const epoch = this.epoch, selection = this.selection; this.update({ saving: true, error: "" });
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.update", { channelId, name: name.trim(), memberIds, expectedRevision: catalog.revision });
      if (epoch !== this.epoch || selection !== this.selection) return false; this.valid(value); this.update({ catalog: value, saving: false }); await this.refresh(); return true;
    } catch { if (epoch === this.epoch && selection === this.selection) { this.update({ saving: false, error: "ws.channels.saveFailed" }); await this.refresh(); } return false; }
  }
  async send(recipientIds: string[]) {
    const { channelId, channel } = this.view, body = this.view.draft.trim();
    if (!channelId || !channel || !body || this.pending.has(this.key()) || ["running", "draining"].includes(channel.state)) return;
    const epoch = this.epoch, key = this.key(), workspaceId = this.workspaceId, generation = this.generation;
    const item: Pending = { body, requestId: this.nonce(), recipientIds: [...recipientIds], state: "sending" };
    this.pending.set(key, item); this.update({ pending: item, error: "" });
    try {
      const value = await this.request<{ workspaceId: string; resourceGeneration: string; channelId: string; requestId: string; accepted: boolean }>("workspace.channels.send", {
        channelId, message: body, requestId: item.requestId, recipientIds: item.recipientIds });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation || value.channelId !== channelId || value.requestId !== item.requestId || value.accepted !== true) throw new Error("Invalid channel acceptance");
      this.settle(key, item); if (this.key() === key) await this.refresh();
    } catch (error) {
      if (explicitRefusal(error)) this.pending.delete(key); else this.pending.set(key, { ...item, state: "unknown" });
      if (epoch === this.epoch && this.key() === key) this.update({ pending: this.pending.get(key) ?? null, error: explicitRefusal(error) ? "ws.channels.sendFailed" : "ws.channels.sendUnknown" });
    }
  }
  private settle(key: string, item: Pending) {
    this.pending.delete(key); if (this.drafts.get(key)?.trim() === item.body) this.drafts.set(key, "");
    if (this.key() === key) this.update({ draft: this.drafts.get(key) ?? "", pending: null, error: "" });
  }
  async verifyPending() {
    const channelId = this.view.channelId, key = this.key(), item = this.pending.get(key), epoch = this.epoch;
    if (!channelId || item?.state !== "unknown") return;
    try {
      const receipt = await this.request<{ workspaceId: string; resourceGeneration: string; channelId: string; requestId: string; state: string }>("workspace.channels.receipt", { channelId, requestId: item.requestId });
      if (epoch !== this.epoch || this.pending.get(key) !== item) return; this.valid(receipt);
      if (receipt.channelId !== channelId || receipt.requestId !== item.requestId || receipt.state !== "accepted") { if (this.key() === key) this.update({ error: "ws.channels.sendUnknown" }); return; }
      this.settle(key, item); if (this.key() === key) await this.refresh();
    } catch { if (epoch === this.epoch && this.key() === key) this.update({ error: "ws.channels.sendUnknown" }); }
  }
  async cancel() { const channelId = this.view.channelId; if (!channelId) return;
    const epoch = this.epoch; try { await this.request("workspace.channels.cancel", { channelId }); if (epoch === this.epoch) await this.refresh(); }
    catch { if (epoch === this.epoch) this.update({ error: "ws.channels.cancelFailed" }); }
  }
  async respond(card: WorkspaceDevApproval, approved: boolean) {
    if (card.channelId !== this.view.channelId || card.workspaceId !== this.workspaceId || card.resourceGeneration !== this.generation
      || !this.view.channel?.approvals.some(row => row.id === card.id) || this.approvals.has(card.id)) return;
    const epoch = this.epoch; this.approvals.add(card.id);
    try { await this.request("workspace.approval.respond", { approvalId: card.id, approved }); if (epoch === this.epoch) await this.refresh(); }
    catch { if (epoch === this.epoch) { this.update({ error: "ws.channels.approvalFailed" }); await this.refresh(); } }
    finally { this.approvals.delete(card.id); }
  }
}
