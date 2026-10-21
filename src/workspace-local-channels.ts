import type { WorkspaceDevApproval, WorkspaceDevMessage, WorkspaceDevModel } from "./workspace-dev-state";
import { createLocalChannelPreferencesStore, emptyChannelPreferences, type LocalChannelCreation, type LocalChannelPreferences, type LocalChannelPreferencesStore } from "./workspace-local-channel-preferences.ts";
export interface LocalChannel { id: string; name: string; memberIds: string[]; createdAt: string }
export interface LocalChannelCatalog { workspaceId: string; resourceGeneration: string; revision: number; channels: LocalChannel[] }
export interface LocalChannelSnapshot { workspaceId: string; resourceGeneration: string; channel: LocalChannel; revision: number; state: string;
  messages: { id: string; turnId: string; agentId: string | null; displayName: string; createdAt: string; message: WorkspaceDevMessage }[];
  turns: { id: string; state: string; replies: { agentId: string; displayName: string; state: string }[] }[]; approvals: WorkspaceDevApproval[] }
interface Pending { body: string; requestId: string; recipientIds: string[]; state: "sending" | "unknown" }
type Creation = LocalChannelCreation;
export interface LocalChannelsView { scope: string; supported: boolean; catalog: LocalChannelCatalog | null; channelId: string | null; channel: LocalChannelSnapshot | null;
  loading: boolean; saving: boolean; draft: string; recipientIds: string[]; pending: Pending | null; error: string; creationUnknown: boolean; historyAnchor: string | null }
const empty: LocalChannelsView = { scope: "", supported: false, catalog: null, channelId: null, channel: null, loading: false, saving: false, draft: "", recipientIds: [], pending: null, error: "", creationUnknown: false, historyAnchor: null };
const explicitRefusal = (error: unknown) => !!error && typeof error === "object" && "code" in error && typeof error.code === "number";
const sameMembers = (left: string[], right: string[]) => {
  const ids = new Set(right);
  return left.length === right.length && ids.size === right.length && new Set(left).size === left.length && left.every(id => ids.has(id));
};
const matchesCreation = (row: LocalChannel, item: Creation) => row.id === item.id && row.name === item.name && sameMembers(row.memberIds, item.memberIds);

/** The renderer selects intent; Core owns membership, sessions, persistence and execution. */
export class WorkspaceLocalChannelsModel {
  private view = empty;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private selection = 0;
  private workspaceId = "";
  private generation = "";
  private drafts = new Map<string, string>();
  private historyAnchors = new Map<string, string>();
  private recipients = new Map<string, string[]>();
  private allRecipients = new Set<string>();
  private pending = new Map<string, Pending>();
  private creation = new Map<string, Creation>();
  private approvals = new Set<string>();
  private refreshing: { promise: Promise<void>; dirty: boolean } | null = null;
  private saved = new Map<string, LocalChannelPreferences>();
  private readonly model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels">;
  private readonly nonce: () => string;
  private readonly preferences: LocalChannelPreferencesStore | null;
  constructor(model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels">, nonce = () => crypto.randomUUID(),
    preferences: LocalChannelPreferencesStore | null = createLocalChannelPreferencesStore()) { this.model = model; this.nonce = nonce; this.preferences = preferences; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<LocalChannelsView>) { this.view = { ...this.view, ...value }; for (const listener of this.listeners) listener(); }
  private key(channelId = this.view.channelId) { return JSON.stringify([this.workspaceId, this.generation, channelId]); }
  preferredChannelId() { return this.saved.get(this.view.scope)?.selectedChannelId ?? null; }
  private remember(scope: string, patch: Partial<LocalChannelPreferences>) {
    const saved = this.saved.get(scope); if (!saved) return;
    Object.assign(saved, patch);
    const [workspaceId, generation] = JSON.parse(scope) as [string, string];
    try { this.preferences?.save(workspaceId, generation, saved); } catch { /* Keep current-session state when persistence is unavailable. */ }
  }
  private rememberPending(key: string, pending: Pending | null) {
    const [workspaceId, generation, channelId] = JSON.parse(key) as [string, string, string];
    const scope = JSON.stringify([workspaceId, generation]), saved = this.saved.get(scope); if (!saved) return;
    if (pending) saved.pending[channelId] = { requestId: pending.requestId, recipientIds: [...pending.recipientIds] }; else delete saved.pending[channelId];
    this.remember(scope, {});
  }
  private rememberRecipients(channelId: string, selected: string[]) {
    const saved = this.saved.get(this.view.scope); if (!saved) return;
    const next = this.allRecipients.has(this.key(channelId)) ? null : selected, previous = saved.recipients[channelId];
    if (previous === next || (previous && next && previous.length === next.length && previous.every((value, index) => value === next[index]))) return;
    saved.recipients[channelId] = next === null ? null : [...next]; this.remember(this.view.scope, {});
  }
  private request<T>(method: string, extra: Record<string, unknown> = {}) {
    return this.model.localChannelRequest<T>(method, { ...extra, workspaceId: this.workspaceId, expectedGeneration: this.generation });
  }
  private valid(value: { workspaceId: string; resourceGeneration: string }) {
    if (value?.workspaceId !== this.workspaceId || value.resourceGeneration !== this.generation) throw new Error("Channel response belongs to another Workspace");
  }
  private applyCatalog(value: LocalChannelCatalog) {
    this.valid(value);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.channels)) throw new Error("Invalid channel catalog");
    // A list request may have started before a successful create or member edit.
    if (this.view.catalog && value.revision < this.view.catalog.revision) return;
    this.update({ catalog: value, error: this.view.error === "ws.channels.loadFailed" ? "" : this.view.error });
  }
  async bind(workspaceId: string, generation: string) {
    const scope = JSON.stringify([workspaceId, generation]); if (scope === this.view.scope) return;
    const epoch = ++this.epoch; ++this.selection; this.refreshing = null; this.workspaceId = workspaceId; this.generation = generation;
    const supported = this.model.supportsLocalChannels();
    if (workspaceId && generation && supported && !this.saved.has(scope)) {
      let saved = emptyChannelPreferences(); try { saved = this.preferences?.load(workspaceId, generation) ?? saved; } catch { /* Optional local UI preferences. */ }
      this.saved.set(scope, saved);
      for (const [id, selected] of Object.entries(saved.recipients)) {
        this.recipients.set(this.key(id), selected ?? []); if (selected === null) this.allRecipients.add(this.key(id));
      }
      for (const [id, pending] of Object.entries(saved.pending)) if (!this.pending.has(this.key(id))) this.pending.set(this.key(id), { ...pending, body: "", state: "unknown" });
      if (saved.creation && !this.creation.has(scope)) this.creation.set(scope, saved.creation);
    }
    this.update({ ...empty, scope, supported, creationUnknown: this.creation.has(scope) });
    if (!workspaceId || !generation || !supported) return;
    await this.loadCatalog(epoch);
  }
  private async loadCatalog(epoch = this.epoch) {
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.list"); if (epoch !== this.epoch) return;
      this.applyCatalog(value);
    } catch { if (epoch === this.epoch) this.update({ error: "ws.channels.loadFailed" }); }
  }
  clearSelection() { ++this.selection; this.refreshing = null; this.remember(this.view.scope, { selectedChannelId: null }); this.update({ channelId: null, channel: null, loading: false, draft: "", recipientIds: [], pending: null, error: "", historyAnchor: null }); }
  setHistoryAnchor(anchor: string | null) {
    if (!this.view.channelId || this.view.historyAnchor === anchor) return;
    if (anchor === null) this.historyAnchors.delete(this.key()); else this.historyAnchors.set(this.key(), anchor);
    this.update({ historyAnchor: anchor });
  }
  async select(channelId: string) {
    if (!this.view.catalog?.channels.some(row => row.id === channelId)) return;
    const epoch = this.epoch, selection = ++this.selection, key = this.key(channelId);
    this.refreshing = null;
    this.update({ channelId, channel: null, loading: true, draft: this.drafts.get(key) ?? "", recipientIds: this.recipients.get(key) ?? [], pending: this.pending.get(key) ?? null, error: "", historyAnchor: this.historyAnchors.get(key) ?? null });
    try {
      const value = await this.request<LocalChannelSnapshot>("workspace.channels.select", { channelId });
      if (epoch !== this.epoch || selection !== this.selection) return;
      this.apply(value, channelId); this.remember(this.view.scope, { selectedChannelId: channelId });
      if (this.pending.get(key)?.state === "unknown") await this.verifyPending();
    } catch { if (epoch === this.epoch && selection === this.selection) this.update({ loading: false, error: "ws.channels.loadFailed" }); }
  }
  private apply(value: LocalChannelSnapshot, channelId: string) {
    this.valid(value);
    if (value.channel?.id !== channelId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.messages) || !Array.isArray(value.approvals) || !Array.isArray(value.turns)
      || value.approvals.some(card => card.workspaceId !== this.workspaceId || card.resourceGeneration !== this.generation || card.channelId !== channelId)) throw new Error("Invalid channel conversation");
    if (this.view.channel?.channel.id === channelId && value.revision < this.view.channel.revision) return;
    const pending = this.pending.get(this.key(channelId)) ?? null;
    const key = this.key(channelId), recipients = this.recipients.get(key), members = new Set(value.channel.memberIds);
    if (!recipients) this.allRecipients.add(key);
    const recipientIds = this.allRecipients.has(key) ? [...members] : (recipients ?? []).filter(id => members.has(id));
    this.recipients.set(this.key(channelId), recipientIds);
    this.rememberRecipients(channelId, recipientIds);
    this.update({ channel: value, loading: false, error: pending?.state === "unknown" ? "ws.channels.sendUnknown" : this.view.error === "ws.channels.loadFailed" ? "" : this.view.error,
      draft: this.drafts.get(this.key(channelId)) ?? "", recipientIds, pending });
  }
  async refresh() {
    if (!this.view.supported || !this.workspaceId) return;
    if (this.refreshing) { this.refreshing.dirty = true; return this.refreshing.promise; }
    const epoch = this.epoch, selection = this.selection, channelId = this.view.channelId;
    const work = { dirty: false, promise: Promise.resolve() }; this.refreshing = work;
    work.promise = (async () => {
      do {
        work.dirty = false;
        await this.loadCatalog(epoch); if (epoch !== this.epoch || selection !== this.selection) return;
        if (channelId) try { const value = await this.request<LocalChannelSnapshot>("workspace.channels.snapshot", { channelId });
          if (epoch === this.epoch && selection === this.selection) this.apply(value, channelId);
        } catch { if (epoch === this.epoch && selection === this.selection) this.update({ error: "ws.channels.loadFailed" }); }
      } while (work.dirty && epoch === this.epoch && selection === this.selection);
    })();
    try { await work.promise; } finally { if (this.refreshing === work) this.refreshing = null; }
  }
  setDraft(draft: string) { if (!this.view.channelId) return; this.drafts.set(this.key(), draft); this.update({ draft }); }
  setRecipients(recipientIds: string[]) {
    const members = this.view.channel?.channel.memberIds; if (!members || this.view.pending || ["running", "draining"].includes(this.view.channel?.state ?? "")) return;
    const memberIds = new Set(members), next = [...new Set(recipientIds)].filter(id => memberIds.has(id));
    if (next.length > 0 && next.length === members.length) this.allRecipients.add(this.key()); else this.allRecipients.delete(this.key());
    this.recipients.set(this.key(), next); this.rememberRecipients(this.view.channelId!, next); this.update({ recipientIds: next });
  }
  async create(name: string, memberIds: string[]): Promise<string | null> {
    if (!this.view.catalog || this.view.saving || this.creation.has(this.view.scope) || !name.trim()) return null;
    const epoch = this.epoch, selection = this.selection, scope = this.view.scope, workspaceId = this.workspaceId, generation = this.generation;
    const item = { id: this.nonce(), name: name.trim(), memberIds: [...memberIds], expectedRevision: this.view.catalog.revision };
    this.creation.set(scope, item); this.remember(scope, { creation: item }); this.update({ saving: true, error: "" });
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.create", { channelId: item.id, name: item.name, memberIds: item.memberIds, expectedRevision: item.expectedRevision });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation) throw new Error("Invalid creation scope");
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !value.channels.some(row => matchesCreation(row, item))) throw new Error("Invalid creation receipt");
      if (this.creation.get(scope) !== item) return null;
      this.creation.delete(scope); this.remember(scope, { creation: null }); if (scope !== this.view.scope) return null;
      this.applyCatalog(value);
      this.update({ creationUnknown: false, ...(epoch === this.epoch ? { saving: false, error: "" } : {}) });
      if (epoch !== this.epoch || selection !== this.selection) return null;
      const selecting = this.select(item.id), selected = this.selection; await selecting;
      return epoch === this.epoch && selected === this.selection && this.view.channelId === item.id ? item.id : null;
    } catch (error) {
      if (this.creation.get(scope) !== item) return null;
      if (explicitRefusal(error)) { this.creation.delete(scope); this.remember(scope, { creation: null }); }
      if (scope === this.view.scope) this.update({ creationUnknown: this.creation.has(scope), ...(epoch === this.epoch
        ? { saving: false, error: explicitRefusal(error) ? "ws.channels.saveFailed" : "ws.channels.createUnknown" } : {}) });
      return null;
    }
  }
  async verifyCreation(): Promise<string | null> {
    const item = this.creation.get(this.view.scope); if (!item) return null;
    const epoch = this.epoch, selection = this.selection, scope = this.view.scope;
    await this.loadCatalog(epoch); if (epoch !== this.epoch || this.creation.get(scope) !== item) return null;
    const found = this.view.catalog?.channels.find(row => row.id === item.id);
    if (!found || !matchesCreation(found, item)) { this.update({ error: "ws.channels.createUnknown" }); return null; }
    this.creation.delete(scope); this.remember(scope, { creation: null }); this.update({ creationUnknown: false, error: "" });
    if (selection !== this.selection) return null;
    const selecting = this.select(item.id), selected = this.selection; await selecting;
    return epoch === this.epoch && selected === this.selection && this.view.channelId === item.id ? item.id : null;
  }
  async updateMembers(name: string, memberIds: string[]): Promise<boolean> {
    const { catalog, channelId } = this.view; if (!catalog || !channelId || this.view.saving || !name.trim()) return false;
    const epoch = this.epoch, selection = this.selection; this.update({ saving: true, error: "" });
    try {
      const value = await this.request<LocalChannelCatalog>("workspace.channels.update", { channelId, name: name.trim(), memberIds, expectedRevision: catalog.revision });
      if (epoch !== this.epoch) return false; this.applyCatalog(value);
      if (selection !== this.selection) return false;
      // Invalidate older snapshots before reading the saved membership back.
      const savedSelection = ++this.selection; this.refreshing = null; await this.refresh();
      return epoch === this.epoch && savedSelection === this.selection && this.view.channelId === channelId;
    } catch { if (epoch === this.epoch && selection === this.selection) { this.update({ saving: false, error: "ws.channels.saveFailed" }); await this.refresh(); } return false; }
    finally { if (epoch === this.epoch) this.update({ saving: false }); }
  }
  async send(recipientIds: string[]) {
    const { channelId, channel } = this.view, body = this.view.draft.trim();
    if (!channelId || !channel || !body || this.pending.has(this.key()) || ["running", "draining"].includes(channel.state)) return;
    const key = this.key(), workspaceId = this.workspaceId, generation = this.generation;
    const item: Pending = { body, requestId: this.nonce(), recipientIds: [...recipientIds], state: "sending" };
    this.historyAnchors.delete(key);
    this.pending.set(key, item); this.rememberPending(key, item); this.update({ pending: item, error: "", historyAnchor: null });
    try {
      const value = await this.request<{ workspaceId: string; resourceGeneration: string; channelId: string; requestId: string; accepted: boolean }>("workspace.channels.send", {
        channelId, message: body, requestId: item.requestId, recipientIds: item.recipientIds });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation || value.channelId !== channelId || value.requestId !== item.requestId || value.accepted !== true) throw new Error("Invalid channel acceptance");
      this.settle(key, item); if (this.key() === key) await this.refresh();
    } catch (error) {
      if (explicitRefusal(error)) { this.pending.delete(key); this.rememberPending(key, null); } else this.pending.set(key, { ...item, state: "unknown" });
      if (this.key() === key) this.update({ pending: this.pending.get(key) ?? null, error: explicitRefusal(error) ? "ws.channels.sendFailed" : "ws.channels.sendUnknown" });
    }
  }
  private settle(key: string, item: Pending) {
    this.pending.delete(key); this.rememberPending(key, null); if (this.drafts.get(key)?.trim() === item.body) this.drafts.set(key, "");
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
