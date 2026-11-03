import type { WorkspaceDevApproval, WorkspaceDevMessage, WorkspaceDevModel, WorkspaceQuestionConversation } from "./workspace-dev-state";
import { createLocalChannelPreferencesStore, emptyChannelPreferences, type LocalChannelCreation, type LocalChannelPreferences, type LocalChannelPreferencesStore } from "./workspace-local-channel-preferences.ts";
export interface LocalChannelAutonomy { schemaVersion: 1; mode: "off" | "mention" | "ambient"; mutedAgentIds: string[]; pausedUntil?: string; cooldownMs: 600000 }
export interface LocalChannelAutonomyPatch { mode?: "off" | "mention"; mutedAgentIds?: string[]; pausedUntil?: string | null }
export interface LocalChannel { id: string; name: string; memberIds: string[]; createdAt: string; autonomy?: LocalChannelAutonomy }
export interface LocalChannelCatalog { workspaceId: string; resourceGeneration: string; revision: number; channels: LocalChannel[] }
export interface LocalChannelSnapshot { workspaceId: string; resourceGeneration: string; channel: LocalChannel; revision: number; state: string;
  pendingCount?: number; queueNeedsResume?: boolean;
  questions?: { agentId: string; displayName: string; conversation: WorkspaceQuestionConversation }[];
  messages: { id: string; turnId: string; agentId: string | null; displayName: string; createdAt: string; message: WorkspaceDevMessage }[];
  /** `wokenBy` is the member whose reply queued this one (`workspace.local-channels.peer.v1`). */
  turns: { id: string; state: string; origin?: "user" | "autonomy"; rootTurnId?: string; replies: { agentId: string; displayName: string; state: string; wokenBy?: string; depth?: 0 | 1; passedBy?: "prefilter"; passReason?: "role_unrelated" }[] }[]; approvals: WorkspaceDevApproval[] }
interface Pending { body: string; requestId: string; recipientIds: string[]; isAnswer?: boolean; fromDraft?: boolean; preserveDraft?: boolean; state: "sending" | "unknown" }
type Creation = LocalChannelCreation;
export interface LocalChannelsView { scope: string; supported: boolean; catalog: LocalChannelCatalog | null; channelId: string | null; channel: LocalChannelSnapshot | null;
  loading: boolean; saving: boolean; draft: string; recipientIds: string[]; pending: Pending | null; error: string; creationUnknown: boolean; historyAnchor: string | null; queuedPosition?: number | null; queueAction?: "resume" | "clear" | null; queueUnknown?: boolean; autonomySaving?: boolean; autonomyUnknown?: boolean; autonomyChecking?: boolean }
const empty: LocalChannelsView = { scope: "", supported: false, catalog: null, channelId: null, channel: null, loading: false, saving: false, draft: "", recipientIds: [], pending: null, error: "", creationUnknown: false, historyAnchor: null, queuedPosition: null, queueAction: null, queueUnknown: false, autonomySaving: false, autonomyUnknown: false, autonomyChecking: false };
const explicitRefusal = (error: unknown) => !!error && typeof error === "object" && "code" in error && typeof error.code === "number";
const sameMembers = (left: string[], right: string[]) => {
  const ids = new Set(right);
  return left.length === right.length && ids.size === right.length && new Set(left).size === left.length && left.every(id => ids.has(id));
};
const matchesCreation = (row: LocalChannel, item: Creation) => row.id === item.id && row.name === item.name && sameMembers(row.memberIds, item.memberIds);
const isoTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
function validAutonomy(value: unknown, members: string[]): value is LocalChannelAutonomy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(field => ["schemaVersion", "mode", "mutedAgentIds", "pausedUntil", "cooldownMs"].includes(field)) && row.schemaVersion === 1 && ["off", "mention", "ambient"].includes(row.mode as string) && row.cooldownMs === 600000
    && Array.isArray(row.mutedAgentIds) && row.mutedAgentIds.every(id => typeof id === "string" && members.includes(id))
    && new Set(row.mutedAgentIds).size === row.mutedAgentIds.length && (row.pausedUntil === undefined || isoTime(row.pausedUntil));
}
const sameAutonomy = (left: LocalChannelAutonomy, right: LocalChannelAutonomy) => left.schemaVersion === right.schemaVersion && left.mode === right.mode
  && left.cooldownMs === right.cooldownMs && left.pausedUntil === right.pausedUntil && sameMembers(left.mutedAgentIds, right.mutedAgentIds);
interface AutonomyWrite { value: LocalChannelAutonomy; state: "saving" | "unknown" | "checking" }

/** The `@query` being typed at the end of the draft, or null. An `@` inside a word (an e-mail address) is not a mention. */
export function channelMentionQuery(draft: string): string | null {
  const match = /(?:^|[^\p{L}\p{N}_.])@([^\s@]{0,40})$/u.exec(draft);
  return match ? match[1]!.toLocaleLowerCase() : null;
}
/** Replace the trailing `@query` with `@displayName ` so Core's mention parser sees the exact member name. */
export function insertChannelMention(draft: string, displayName: string): string {
  return channelMentionQuery(draft) === null ? draft : draft.replace(/@[^\s@]{0,40}$/u, `@${displayName} `);
}

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
  private pausing = new Set<string>();
  private creation = new Map<string, Creation>();
  private approvals = new Set<string>();
  private queueActions = new Map<string, { action: "resume" | "clear"; state: "sending" | "unknown" }>();
  private queued = new Map<string, { requestId: string; position: number }>();
  private autonomyWrites = new Map<string, AutonomyWrite>();
  private refreshing: { promise: Promise<void>; dirty: boolean } | null = null;
  private saved = new Map<string, LocalChannelPreferences>();
  private readonly model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels"> & Partial<Pick<WorkspaceDevModel, "supportsUserQuestions" | "supportsLocalChannelPeers" | "supportsLocalChannelPass" | "supportsLocalChannelQueue" | "supportsLocalChannelAutonomy">>;
  private readonly nonce: () => string;
  private readonly preferences: LocalChannelPreferencesStore | null;
  constructor(model: Pick<WorkspaceDevModel, "localChannelRequest" | "supportsLocalChannels"> & Partial<Pick<WorkspaceDevModel, "supportsUserQuestions" | "supportsLocalChannelPeers" | "supportsLocalChannelPass" | "supportsLocalChannelQueue" | "supportsLocalChannelAutonomy">>, nonce = () => crypto.randomUUID(),
    preferences: LocalChannelPreferencesStore | null = createLocalChannelPreferencesStore()) { this.model = model; this.nonce = nonce; this.preferences = preferences; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<LocalChannelsView>) {
    const previousKey = this.key(), wasPausing = this.pausing.has(previousKey);
    this.view = { ...this.view, ...value };
    const queueAction = this.queueActions.get(this.key());
    this.view.queueAction = queueAction?.state === "sending" ? queueAction.action : null;
    this.view.queueUnknown = queueAction?.state === "unknown";
    this.view.queuedPosition = this.queued.get(this.key())?.position ?? null;
    const autonomyWrite = this.autonomyWrites.get(this.key());
    this.view.autonomySaving = autonomyWrite?.state === "saving";
    this.view.autonomyUnknown = autonomyWrite?.state === "unknown" || autonomyWrite?.state === "checking";
    this.view.autonomyChecking = autonomyWrite?.state === "checking";
    if (this.pausing.has(this.key())) this.view.saving = true;
    else if (wasPausing && previousKey !== this.key() && value.saving === undefined) this.view.saving = false;
    for (const listener of this.listeners) listener();
  }
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
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.channels)
      || value.channels.some(row => row.autonomy !== undefined && !validAutonomy(row.autonomy, row.memberIds))) throw new Error("Invalid channel catalog");
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
    if (value.channel.autonomy !== undefined && !validAutonomy(value.channel.autonomy, value.channel.memberIds)) throw new Error("Invalid channel autonomy");
    if ((value.pendingCount !== undefined && (!Number.isSafeInteger(value.pendingCount) || value.pendingCount < 0 || value.pendingCount > 5))
      || (value.queueNeedsResume !== undefined && typeof value.queueNeedsResume !== "boolean")
      || value.turns.some(turn => !turn || typeof turn.id !== "string" || !Array.isArray(turn.replies)
        || turn.origin !== undefined && turn.origin !== "user" && turn.origin !== "autonomy"
        || turn.rootTurnId !== undefined && (typeof turn.rootTurnId !== "string" || !turn.rootTurnId)
        || turn.replies.some(reply => !reply
        || typeof reply.agentId !== "string" || typeof reply.displayName !== "string" || typeof reply.state !== "string"
        || reply.depth !== undefined && reply.depth !== 0 && reply.depth !== 1
        || reply.depth === 1 && (turn.origin !== "autonomy" || Boolean(reply.wokenBy))
        || (reply.state === "passed" && (reply.passedBy !== "prefilter" || reply.passReason !== "role_unrelated"))))) throw new Error("Invalid channel interjection state");
    if (this.view.channel?.channel.id === channelId && value.revision < this.view.channel.revision) return;
    const queued = this.queued.get(this.key(channelId));
    if (queued) {
      const pendingTurns = value.turns.filter(turn => turn.state === "queued"), index = pendingTurns.findIndex(turn => turn.id === queued.requestId);
      if (index < 0) this.queued.delete(this.key(channelId)); else queued.position = index + 1;
    }
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
    const members = this.view.channel?.channel.memberIds; if (!members || this.view.pending || this.view.saving || this.queueActions.has(this.key()) || (!this.canQueue(this.view.channel!) && ["running", "draining"].includes(this.view.channel?.state ?? ""))) return;
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
    const { catalog, channelId } = this.view; if (!catalog || !channelId || this.view.saving || this.autonomyWrites.has(this.key()) || ["running", "draining"].includes(this.view.channel?.state ?? "") || !name.trim()) return false;
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
  supportsAutonomy(): boolean { return this.model.supportsLocalChannelAutonomy?.() === true; }
  /** Only preferences are sent here. Runtime lineage, counters and budgets remain owned by Core. */
  async updateAutonomy(patch: LocalChannelAutonomyPatch, expected: { scope: string; channelId: string }): Promise<boolean> {
    const { catalog, channelId, channel } = this.view, key = this.key();
    if (expected.scope !== this.view.scope || expected.channelId !== channelId || !this.supportsAutonomy() || !catalog || !channelId || !channel
      || !channel.channel.autonomy || this.view.saving || this.view.pending || this.queueActions.has(key) || this.autonomyWrites.has(key)) return false;
    const current = catalog.channels.find(row => row.id === channelId), previous = current?.autonomy;
    if (!current || !previous || !validAutonomy(previous, current.memberIds) || !patch || typeof patch !== "object" || Array.isArray(patch)
      || patch.mutedAgentIds !== undefined && !Array.isArray(patch.mutedAgentIds)
      || Object.keys(patch).some(field => !["mode", "mutedAgentIds", "pausedUntil"].includes(field))
      || patch.mode !== undefined && patch.mode !== "off" && patch.mode !== "mention") return false;
    const value: LocalChannelAutonomy = { schemaVersion: 1, mode: patch.mode ?? previous.mode, mutedAgentIds: patch.mutedAgentIds ? [...patch.mutedAgentIds] : [...previous.mutedAgentIds], cooldownMs: 600000,
      ...(previous.pausedUntil ? { pausedUntil: previous.pausedUntil } : {}) };
    if (patch.pausedUntil === null) delete value.pausedUntil; else if (patch.pausedUntil !== undefined) value.pausedUntil = patch.pausedUntil;
    if (value.mode === "ambient" || !validAutonomy(value, current.memberIds)) return false;
    if (sameAutonomy(value, previous)) return true;
    const epoch = this.epoch, selection = this.selection, workspaceId = this.workspaceId, generation = this.generation;
    const item: AutonomyWrite = { value, state: "saving" }; this.autonomyWrites.set(key, item); this.update({ error: "" });
    try {
      const receipt = await this.request<LocalChannelCatalog>("workspace.channels.update", { channelId, name: current.name, memberIds: [...current.memberIds], expectedRevision: catalog.revision, autonomy: value });
      const row = receipt?.channels?.find(member => member.id === channelId);
      if (receipt?.workspaceId !== workspaceId || receipt.resourceGeneration !== generation || !Number.isSafeInteger(receipt.revision) || receipt.revision < catalog.revision
        || receipt.channels.some(member => member.autonomy !== undefined && !validAutonomy(member.autonomy, member.memberIds))
        || !row || row.name !== current.name || !sameMembers(row.memberIds, current.memberIds) || !validAutonomy(row.autonomy, row.memberIds) || !sameAutonomy(row.autonomy, value)) throw new Error("Invalid autonomy receipt");
      if (this.autonomyWrites.get(key) !== item) return false;
      this.autonomyWrites.delete(key);
      if (epoch !== this.epoch || selection !== this.selection || this.key() !== key) return false;
      this.applyCatalog(receipt); this.update({ channel: { ...this.view.channel!, channel: row }, error: "" });
      // Invalidate any read captured before the successful metadata change.
      ++this.selection; this.refreshing = null; await this.refresh();
      return true;
    } catch (error) {
      if (this.autonomyWrites.get(key) !== item) return false;
      if (explicitRefusal(error)) this.autonomyWrites.delete(key); else item.state = "unknown";
      if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({ error: explicitRefusal(error) ? "ws.channels.autonomyFailed" : "ws.channels.autonomyUnknown" });
      return false;
    } finally { if (this.key() === key) this.update({}); }
  }
  async verifyAutonomy() {
    const channelId = this.view.channelId, key = this.key(), item = this.autonomyWrites.get(key), epoch = this.epoch, selection = this.selection;
    if (!channelId || item?.state !== "unknown") return;
    item.state = "checking"; this.update({});
    try {
      const [catalog, snapshot] = await Promise.all([this.request<LocalChannelCatalog>("workspace.channels.list"), this.request<LocalChannelSnapshot>("workspace.channels.snapshot", { channelId })]);
      if (epoch !== this.epoch || selection !== this.selection || this.key() !== key || this.autonomyWrites.get(key) !== item) { item.state = "unknown"; return; }
      if (!snapshot.channel.autonomy) throw new Error("Autonomy metadata missing");
      this.applyCatalog(catalog); this.apply(snapshot, channelId); this.autonomyWrites.delete(key); this.update({ error: "" });
    } catch { item.state = "unknown"; if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({ error: "ws.channels.autonomyUnknown" }); }
    finally { if (this.key() === key) this.update({}); }
  }
  supportsUserQuestions(): boolean { return this.model.supportsUserQuestions?.() === true; }
  supportsPeers(): boolean { return this.model.supportsLocalChannelPeers?.() === true; }
  supportsPass(): boolean { return this.model.supportsLocalChannelPass?.() === true; }
  supportsQueue(): boolean { return this.model.supportsLocalChannelQueue?.() === true; }
  private canQueue(channel: LocalChannelSnapshot) {
    return this.supportsQueue() && channel.pendingCount !== undefined && typeof channel.queueNeedsResume === "boolean";
  }
  /** This is a new explicit user request. It never rewrites the skipped turn or the current draft. */
  async speakPassed(turnId: string, agentId: string, ask: string, expected: { scope: string; channelId: string; historyAnchor: string | null }) {
    const channel = this.view.channel;
    if (expected.scope !== this.view.scope || expected.channelId !== this.view.channelId || expected.historyAnchor !== this.view.historyAnchor
      || !this.supportsPass() || !channel || !/^ag_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(agentId)
      || !channel.channel.memberIds.includes(agentId) || !channel.turns.some(turn => turn.id === turnId && turn.replies.some(reply => reply.agentId === agentId
        && reply.state === "passed" && reply.passedBy === "prefilter" && reply.passReason === "role_unrelated"))) return;
    const original = channel.messages.find(row => row.turnId === turnId && row.agentId === null && row.message.role === "user");
    if (!original || original.message.role !== "user" || !ask.trim() || ask.length > 200 || /[\r\n\u0000-\u001f\u007f@]/u.test(ask)) return;
    // Stable IDs avoid a renamed colleague or an untrusted display name changing the mention target.
    // Quoted mentions must not widen Core's recipients for this explicit single-colleague request.
    const prefix = `@${agentId} ${ask}\n\n`, quote = original.message.content.replace(/@/g, "＠"), room = 4000 - prefix.length;
    const body = prefix + (quote.length > room ? `${quote.slice(0, room - 1)}…` : quote);
    await this.dispatchMessage([agentId], body, undefined, true);
  }
  private async mutateQueue(action: "resume" | "clear") {
    const channelId = this.view.channelId, channel = this.view.channel, key = this.key();
    if (!channelId || !channel || !this.canQueue(channel) || !channel.pendingCount || this.view.pending || this.view.saving || this.queueActions.has(key)
      || action === "resume" && (!channel.queueNeedsResume || ["running", "draining"].includes(channel.state))) return;
    const epoch = this.epoch, selection = this.selection, workspaceId = this.workspaceId, generation = this.generation;
    const item = { action, state: "sending" as const }; this.queueActions.set(key, item); this.update({ error: "" });
    try {
      const value = await this.request<LocalChannelSnapshot>(action === "resume" ? "workspace.channels.resumeQueue" : "workspace.channels.clearQueue", { channelId });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation || value.channel?.id !== channelId
        || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Invalid queue action receipt");
      if (epoch === this.epoch && selection === this.selection && this.key() === key) this.apply(value, channelId);
      if (this.queueActions.get(key) === item) this.queueActions.delete(key);
      if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({ error: "" });
    } catch (error) {
      if (this.queueActions.get(key) !== item) return;
      if (explicitRefusal(error)) this.queueActions.delete(key); else this.queueActions.set(key, { action, state: "unknown" });
      if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({ error: explicitRefusal(error) ? "ws.channels.queueFailed" : "ws.channels.queueUnknown" });
    } finally {
      if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({});
    }
  }
  resumeQueue() { return this.mutateQueue("resume"); }
  clearQueue() { return this.mutateQueue("clear"); }
  async verifyQueue() {
    const channelId = this.view.channelId, key = this.key(), item = this.queueActions.get(key), epoch = this.epoch, selection = this.selection;
    if (!channelId || item?.state !== "unknown") return;
    try {
      const value = await this.request<LocalChannelSnapshot>("workspace.channels.snapshot", { channelId });
      if (epoch !== this.epoch || selection !== this.selection || this.key() !== key || this.queueActions.get(key) !== item) return;
      this.apply(value, channelId); this.queueActions.delete(key); this.update({ error: "" });
    } catch { if (epoch === this.epoch && selection === this.selection && this.key() === key) this.update({ error: "ws.channels.queueUnknown" }); }
  }
  async pauseQuestion(agentId: string, questionId: string): Promise<void> {
    if (!this.supportsUserQuestions() || this.view.pending || ["running", "draining"].includes(this.view.channel?.state ?? "")) return;
    if (!this.view.channel?.questions?.some(row => row.agentId === agentId && row.conversation.pendingQuestion?.id === questionId)) return;
    const key = this.key(); if (this.pausing.has(key)) return;
    this.pausing.add(key); this.update({ saving: true });
    try { await this.request("workspace.channels.pause-question", { channelId: this.view.channelId, agentId, questionId }); }
    catch { if (this.key() === key) this.update({ error: "ws.question.pauseUnknown" }); }
    finally { this.pausing.delete(key); if (this.key() === key) this.update({ saving: false }); await this.refresh(); }
  }
  async answer(agentId: string, questionId: string, body: string): Promise<void> {
    if (!this.supportsUserQuestions()) { this.update({ error: "ws.question.unsupported" }); return; }
    const pending = this.view.channel?.questions?.find(row => row.agentId === agentId && row.conversation.pendingQuestion?.id === questionId);
    if (!pending || body.trim() === "/continue") { this.update({ error: "ws.question.stale" }); return; }
    if (pending.conversation.resumeAdmission?.allowed === false) { this.update({ error: "ws.notice.resumeBudget" }); return; }
    return this.send([agentId], { questionId, body });
  }
  /** The channel composer is the only free-text input. Its draft answers the one pending question among
   * the chosen responders; with several such colleagues it refuses, so the user picks an option on a card
   * or narrows the responders to one. Without a pending responder it is an ordinary channel message. */
  async submitDraft(recipientIds: string[]) {
    const waiting = (this.view.channel?.questions ?? []).filter(row => recipientIds.includes(row.agentId) && row.conversation.pendingQuestion);
    if (!waiting.length) return this.send(recipientIds);
    if (waiting.length > 1) { this.update({ error: "ws.question.channelPickOne" }); return; }
    const [row] = waiting, questionId = row.conversation.pendingQuestion!.id, body = this.view.draft;
    if (!this.supportsUserQuestions()) { this.update({ error: "ws.question.unsupported" }); return; }
    if (body.trim() === "/continue") { this.update({ error: "ws.question.answerRequired" }); return; }
    if (row.conversation.resumeAdmission?.allowed === false) { this.update({ error: "ws.notice.resumeBudget" }); return; }
    return this.send([row.agentId], { questionId, body, fromDraft: true });
  }
  async send(recipientIds: string[], answer?: { questionId: string; body: string; fromDraft?: boolean }) {
    return this.dispatchMessage(recipientIds, answer ? answer.body.trim() : this.view.draft.trim(), answer);
  }
  private async dispatchMessage(recipientIds: string[], body: string, answer?: { questionId: string; body: string; fromDraft?: boolean }, preserveDraft = false) {
    const { channelId, channel } = this.view, queueSupported = channel !== null && this.canQueue(channel);
    if (!channelId || !channel || !body || body.length > 4000 || this.view.saving || this.pausing.has(this.key()) || this.pending.has(this.key()) || this.queueActions.has(this.key())
      || ((!queueSupported || Boolean(answer)) && ["running", "draining"].includes(channel.state))) return;
    if (queueSupported && (channel.pendingCount ?? 0) >= 5) { this.update({ error: "ws.channels.queueFull" }); return; }
    if (!answer && channel.questions?.some(row => recipientIds.includes(row.agentId))) { this.update({ error: "ws.question.answerRequired" }); return; }
    const key = this.key(), workspaceId = this.workspaceId, generation = this.generation;
    const item: Pending = { body, requestId: this.nonce(), recipientIds: [...recipientIds], state: "sending", ...(preserveDraft ? { preserveDraft: true } : {}), ...(answer ? { isAnswer: true } : {}), ...(answer?.fromDraft ? { fromDraft: true } : {}) };
    this.historyAnchors.delete(key);
    this.pending.set(key, item); this.rememberPending(key, item); this.update({ pending: item, error: "", historyAnchor: null });
    try {
      const value = await this.request<{ workspaceId: string; resourceGeneration: string; channelId: string; requestId: string; accepted: boolean; queued?: boolean; position?: number }>(answer ? "workspace.channels.answer" : "workspace.channels.send", {
        channelId, message: body, requestId: item.requestId, ...(answer ? { agentId: recipientIds[0], questionId: answer.questionId } : { recipientIds: item.recipientIds }) });
      if (value?.workspaceId !== workspaceId || value.resourceGeneration !== generation || value.channelId !== channelId || value.requestId !== item.requestId || value.accepted !== true) throw new Error("Invalid channel acceptance");
      if ((queueSupported && !answer || value.queued !== undefined || value.position !== undefined) && (typeof value.queued !== "boolean" || !queueSupported || !Number.isSafeInteger(value.position)
        || (value.queued ? value.position! < 1 || value.position! > 5 : value.position !== 0))) throw new Error("Invalid channel queue receipt");
      if (value.queued === true) this.queued.set(key, { requestId: item.requestId, position: value.position! });
      this.settle(key, item); if (this.key() === key) await this.refresh();
    } catch (error) {
      if (explicitRefusal(error)) { this.pending.delete(key); this.rememberPending(key, null); } else this.pending.set(key, { ...item, state: "unknown" });
      if (this.key() === key) this.update({ pending: this.pending.get(key) ?? null, error: explicitRefusal(error) ? "ws.channels.sendFailed" : "ws.channels.sendUnknown" });
    }
  }
  private settle(key: string, item: Pending) {
    this.pending.delete(key); this.rememberPending(key, null); if (!item.preserveDraft && (!item.isAnswer || item.fromDraft) && this.drafts.get(key)?.trim() === item.body) this.drafts.set(key, "");
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
    const epoch = this.epoch, key = this.key(); try { await this.request("workspace.channels.cancel", { channelId }); if (epoch === this.epoch && this.key() === key) await this.refresh(); }
    catch { if (epoch === this.epoch && this.key() === key) this.update({ error: "ws.channels.cancelFailed" }); }
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
