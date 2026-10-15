/** Hosted collaboration DTOs. Local Agent/session/model authority never enters this state. */
export type CollaborationCode = "AUTH_REQUIRED" | "SCOPE_CHANGED" | "ACCESS_CHANGED" | "PROJECTION_PENDING" | "DIRECTORY_STALE" | "HISTORY_STALE" | "INVALID_INPUT" | "UNAVAILABLE" | "OUTCOME_UNKNOWN";
export type CollaborationResult<T> = { ok: true; value: T } | { ok: false; error: { code: CollaborationCode } };
export interface CollaborationDirectory {
  schemaVersion: 1; accountScope: string; accountRegion: "CN" | "GLOBAL";
  workspaces: { workspaceId: string; membership: { role: "OWNER" | "ADMIN" | "MEMBER"; membershipVersion: number; policyVersion: number } }[];
  nextCursor: string | null;
}
export interface CollaborationChannel { id: string; slug: string; displayName: string }
export interface CollaborationBootstrap {
  workspaceId: string; displayName: string; cursor: string;
  membership: { principalId: string; role: "OWNER" | "ADMIN" | "MEMBER"; epoch: number };
  channels: CollaborationChannel[];
}
export interface CollaborationMessage { id: string; channelId: string; senderPrincipalId: string; body: string; createdAt: string; sequence?: string }
export interface CollaborationHistory { workspaceId: string; channelId: string; messages: CollaborationMessage[]; nextBefore: string | null }
export interface CollaborationSync { workspaceId: string; cursor: string; hasMore: boolean; events: { id: string; type: string; message: CollaborationMessage | null; channel?: CollaborationChannel | null }[] }
export interface CollaborationSent { workspaceId: string; messageId: string; channelId: string; senderPrincipalId: string; createdAt: string; sequence?: string }
export interface CollaborationCreated { workspaceId: string; channel: CollaborationChannel }
export interface WorkspaceCollaborationTransport {
  supportsCollaborationHistory?(): boolean;
  readCollaborationHistory?(input: { workspaceId: string; channelId: string; accountScope: string; before?: string }): Promise<CollaborationResult<CollaborationHistory>>;
  listCollaborationWorkspaces(cursor?: string): Promise<CollaborationResult<CollaborationDirectory>>;
  bootstrapCollaborationWorkspace(workspaceId: string, accountScope: string): Promise<CollaborationResult<CollaborationBootstrap>>;
  syncCollaborationWorkspace(workspaceId: string, cursor: string, accountScope: string): Promise<CollaborationResult<CollaborationSync>>;
  sendCollaborationMessage(input: { workspaceId: string; channelId: string; body: string; idempotencyKey: string; accountScope: string }): Promise<CollaborationResult<CollaborationSent>>;
  createCollaborationChannel(input: { workspaceId: string; slug: string; displayName: string; idempotencyKey: string; accountScope: string }): Promise<CollaborationResult<CollaborationCreated>>;
}
export interface PendingCollaborationMessage {
  workspaceId: string; channelId: string; body: string; idempotencyKey: string; accountScope: string;
  state: "sending" | "unknown" | "failed"; code?: CollaborationCode;
}
export interface CollaborationView {
  directory: CollaborationDirectory | null; directoryBusy: boolean;
  workspaceId: string | null; bootstrap: CollaborationBootstrap | null;
  phase: "idle" | "loading" | "ready" | "error";
  error: CollaborationCode | null; channelId: string | null; draft: string;
  messages: CollaborationMessage[]; pending: PendingCollaborationMessage | null;
  syncing: boolean; hasMore: boolean;
  workspaceNames: Record<string, string>;
  history: { phase: "unsupported" | "idle" | "loading" | "ready" | "error"; nextBefore: string | null; error: CollaborationCode | null; limited: boolean };
  creation: { slug: string; displayName: string; idempotencyKey: string; state: "sending" | "unknown" | "failed"; code?: CollaborationCode } | null;
}
const empty = (): CollaborationView => ({ directory: null, directoryBusy: false, workspaceId: null, bootstrap: null,
  phase: "idle", error: null, channelId: null, draft: "", messages: [], pending: null, syncing: false, hasMore: false, creation: null,
  workspaceNames: {}, history: { phase: "unsupported", nextBefore: null, error: null, limited: false } });
const revoked = (code: CollaborationCode) => ["AUTH_REQUIRED", "SCOPE_CHANGED", "ACCESS_CHANGED"].includes(code);
export function mergeCollaborationMessages(existing: CollaborationMessage[], incoming: CollaborationMessage[], older = false): CollaborationMessage[] {
  const merged = [...new Map((older ? [...incoming, ...existing] : [...existing, ...incoming]).map(item => [item.id, item])).values()];
  if (merged.every(item => typeof item.sequence === "string" && /^[1-9][0-9]{0,18}$/.test(item.sequence))) {
    merged.sort((a, b) => BigInt(a.sequence!) < BigInt(b.sequence!) ? -1 : BigInt(a.sequence!) > BigInt(b.sequence!) ? 1 : 0);
  }
  return merged.slice(-500);
}

/** Per mounted client, in-memory only. Epochs invalidate A→B→A requests, including delayed sends and
 * directory pagination. A failed sync never advances its cursor. No model, automatic send, or localStorage. */
export class WorkspaceCollaborationModel {
  private value = empty();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private directoryEpoch = 0;
  private syncEpoch: number | null = null;
  private channelEpoch = 0;
  private historyRequest = 0;
  private drafts = new Map<string, string>();
  private pending = new Map<string, PendingCollaborationMessage>();
  private identities = new Map<string, string>();
  private creations = new Map<string, NonNullable<CollaborationView["creation"]>>();
  private disposed = false;
  private client: WorkspaceCollaborationTransport;
  private key: () => string;
  constructor(client: WorkspaceCollaborationTransport, key: () => string = () => crypto.randomUUID()) { this.client = client; this.key = key; }
  getSnapshot = (): CollaborationView => this.value;
  hasUnresolvedMutations = (): boolean => this.pending.size > 0 || this.creations.size > 0;
  private historySupported() { return typeof this.client.readCollaborationHistory === "function" && (this.client.supportsCollaborationHistory?.() ?? true); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<CollaborationView>) {
    if (this.disposed) return;
    this.value = { ...this.value, ...next }; this.listeners.forEach(listener => listener());
  }
  private target(workspaceId = this.value.workspaceId, channelId = this.value.channelId): string { return JSON.stringify([workspaceId, channelId]); }
  private current(epoch: number, workspaceId: string) { return !this.disposed && this.epoch === epoch && this.value.workspaceId === workspaceId; }
  private failure(code: CollaborationCode) {
    if (revoked(code)) {
      ++this.epoch; ++this.directoryEpoch;
      this.drafts.clear(); this.pending.clear(); this.identities.clear(); this.creations.clear();
      this.update({ ...empty(), error: code, phase: "error" });
    } else this.update({ error: code });
  }
  dispose() { this.disposed = true; ++this.epoch; ++this.directoryEpoch; this.listeners.clear(); this.drafts.clear(); this.pending.clear(); this.identities.clear(); this.creations.clear(); this.value = empty(); }
  async loadDirectory(more = false) {
    if (this.value.directoryBusy || this.disposed) return;
    const cursor = more ? this.value.directory?.nextCursor : undefined;
    if (more && !cursor) return;
    const request = ++this.directoryEpoch;
    this.update({ directoryBusy: true, error: null });
    try {
      const result = await this.client.listCollaborationWorkspaces(cursor ?? undefined);
      if (request !== this.directoryEpoch || this.disposed) return;
      if (!result.ok) {
        if (result.error.code === "DIRECTORY_STALE" && this.value.directory) {
          this.update({ directory: { ...this.value.directory, nextCursor: null } });
        }
        this.failure(result.error.code); return;
      }
      const previous = this.value.directory;
      if (more && previous?.accountScope !== result.value.accountScope) { this.failure("SCOPE_CHANGED"); return; }
      if (previous && previous.accountScope !== result.value.accountScope) {
        ++this.epoch; this.drafts.clear(); this.pending.clear(); this.identities.clear(); this.creations.clear(); this.update(empty());
      }
      const workspaces = more && previous ? [...new Map([...previous.workspaces, ...result.value.workspaces].map(item => [item.workspaceId, item])).values()] : result.value.workspaces;
      this.update({ directory: { ...result.value, workspaces }, directoryBusy: false });
      // A directory refresh cannot leave a removed Workspace's messages visible or writable.
      if (this.value.workspaceId && !workspaces.some(item => item.workspaceId === this.value.workspaceId) && !result.value.nextCursor) this.failure("ACCESS_CHANGED");
    } catch { if (request === this.directoryEpoch) this.update({ error: "UNAVAILABLE" }); }
    finally { if (request === this.directoryEpoch) this.update({ directoryBusy: false }); }
  }
  async selectWorkspace(workspaceId: string) {
    const directory = this.value.directory;
    if (!directory?.workspaces.some(item => item.workspaceId === workspaceId) || this.disposed) return;
    const epoch = ++this.epoch;
    // Leaving a request does not cancel its remote effect. Retain the same identity as unknown; a
    // delayed response must not repaint a subsequent A visit or overwrite an explicitly retried request.
    for (const [target, item] of this.pending) if (item.state === "sending") this.pending.set(target, { ...item, state: "unknown", code: "OUTCOME_UNKNOWN" });
    for (const [target, item] of this.creations) if (item.state === "sending") this.creations.set(target, { ...item, state: "unknown", code: "OUTCOME_UNKNOWN" });
    this.syncEpoch = null;
    this.update({ workspaceId, bootstrap: null, phase: "loading", error: null, channelId: null, draft: "", messages: [], pending: null, syncing: false, hasMore: false, creation: null });
    try {
      const result = await this.client.bootstrapCollaborationWorkspace(workspaceId, directory.accountScope);
      if (!this.current(epoch, workspaceId)) return;
      if (!result.ok) { this.failure(result.error.code); if (!revoked(result.error.code)) this.update({ phase: "error" }); return; }
      if (result.value.workspaceId !== workspaceId) { this.failure("SCOPE_CHANGED"); return; }
      const identity = JSON.stringify([directory.accountScope, result.value.membership.principalId, result.value.membership.epoch]);
      if (this.identities.has(workspaceId) && this.identities.get(workspaceId) !== identity) {
        for (const target of this.drafts.keys()) if (JSON.parse(target)[0] === workspaceId) { this.drafts.delete(target); this.pending.delete(target); }
        this.creations.delete(workspaceId);
      }
      this.identities.set(workspaceId, identity);
      this.update({ bootstrap: result.value, phase: "ready", creation: this.creations.get(workspaceId) ?? null,
        workspaceNames: { ...this.value.workspaceNames, [workspaceId]: result.value.displayName } });
      const channelId = result.value.channels[0]?.id;
      if (channelId) this.selectChannel(channelId);
    } catch { if (this.current(epoch, workspaceId)) this.update({ phase: "error", error: "UNAVAILABLE" }); }
  }
  selectChannel(channelId: string) {
    if (this.value.phase !== "ready" || !this.value.bootstrap?.channels.some(item => item.id === channelId)) return;
    const target = this.target(this.value.workspaceId, channelId);
    const changed = this.value.channelId !== channelId;
    if (changed) { ++this.channelEpoch; ++this.historyRequest; }
    this.update({ channelId, draft: this.drafts.get(target) ?? "", pending: this.pending.get(target) ?? null,
      ...(changed ? { messages: this.historySupported() ? [] : this.value.messages,
        history: { phase: this.historySupported() ? "idle" : "unsupported", nextBefore: null, error: null, limited: false } } : {}) });
    if (changed && this.historySupported()) void this.loadHistory();
  }
  async loadHistory(older = false) {
    const { workspaceId, channelId, directory, history } = this.value, epoch = this.epoch, channelEpoch = this.channelEpoch;
    if (!workspaceId || !channelId || !directory || this.value.phase !== "ready" || !this.historySupported() || history.phase === "loading") return;
    if (older && (!history.nextBefore || history.limited)) return;
    if (older && this.value.messages.length >= 500) { this.update({ history: { ...history, limited: true } }); return; }
    const before = older ? history.nextBefore! : undefined, request = ++this.historyRequest;
    this.update({ history: { ...history, phase: "loading", error: null } });
    const current = () => this.current(epoch, workspaceId) && this.channelEpoch === channelEpoch && this.value.channelId === channelId && this.historyRequest === request;
    try {
      const result = await this.client.readCollaborationHistory!({ workspaceId, channelId, accountScope: directory.accountScope, ...(before ? { before } : {}) });
      if (!current()) return;
      if (!result.ok) {
        if (revoked(result.error.code)) { this.failure(result.error.code); return; }
        this.update({ history: { ...history, phase: "error", error: result.error.code, nextBefore: result.error.code === "HISTORY_STALE" ? null : history.nextBefore },
          ...(result.error.code === "HISTORY_STALE" ? { messages: [] } : {}) }); return;
      }
      if (result.value.workspaceId !== workspaceId || result.value.channelId !== channelId
        || result.value.messages.some(item => item.channelId !== channelId)) { this.failure("SCOPE_CHANGED"); return; }
      if (before && result.value.nextBefore === before) {
        this.update({ history: { ...history, phase: "error", error: "HISTORY_STALE" } }); return;
      }
      const existing = this.value.messages.filter(item => item.channelId === channelId);
      // Deduplicate and sort the complete page before applying the view cap. Live sync may have
      // already supplied the page's newest records; budgeting first can silently skip novel ones.
      const messages = mergeCollaborationMessages(existing, result.value.messages, older);
      this.update({ messages, history: { phase: "ready", error: null, nextBefore: result.value.nextBefore, limited: messages.length >= 500 } });
    } catch { if (current()) this.update({ history: { ...history, phase: "error", error: "UNAVAILABLE" } }); }
  }
  setDraft(draft: string) {
    if (!this.value.channelId || this.value.phase !== "ready" || this.value.pending?.state === "sending") return;
    this.drafts.set(this.target(), draft); this.update({ draft });
  }
  async sync() {
    const { workspaceId, bootstrap, directory } = this.value, epoch = this.epoch;
    if (!workspaceId || !bootstrap || !directory || this.value.phase !== "ready" || this.syncEpoch === epoch) return;
    this.syncEpoch = epoch; this.update({ syncing: true });
    try {
      const result = await this.client.syncCollaborationWorkspace(workspaceId, bootstrap.cursor, directory.accountScope);
      if (!this.current(epoch, workspaceId)) return;
      if (!result.ok) { this.failure(result.error.code); return; }
      if (result.value.workspaceId !== workspaceId) { this.failure("SCOPE_CHANGED"); return; }
      const messages = new Map(this.value.messages.map(item => [item.id, item]));
      const channels = new Map(this.value.bootstrap!.channels.map(item => [item.id, item]));
      for (const event of result.value.events) {
        if (event.type === "channel.created" && event.channel) channels.set(event.channel.id, event.channel);
        if (!event.message) continue;
        const item = event.message;
        if (!channels.has(item.channelId)) continue;
        if (this.historySupported() && item.channelId !== this.value.channelId) continue;
        messages.set(item.id, item);
      }
      // Bounded memory. Original server cursor remains authoritative; older history is not fabricated.
      this.update({ bootstrap: { ...this.value.bootstrap!, channels: [...channels.values()], cursor: result.value.cursor },
        messages: mergeCollaborationMessages([], [...messages.values()]), hasMore: result.value.hasMore, error: null });
      if (!this.value.channelId && channels.size) this.selectChannel(channels.keys().next().value!);
    } catch { if (this.current(epoch, workspaceId)) this.update({ error: "UNAVAILABLE" }); }
    finally { if (this.syncEpoch === epoch) this.syncEpoch = null; if (this.current(epoch, workspaceId)) this.update({ syncing: false }); }
  }
  async send(retry = false) {
    const { workspaceId, channelId, bootstrap, directory, draft } = this.value, epoch = this.epoch;
    if (!workspaceId || !channelId || !bootstrap || !directory || this.value.phase !== "ready") return;
    const target = this.target(), existing = this.pending.get(target);
    if (existing?.state === "sending" || (existing && !retry) || (retry && !existing)) return;
    if (!retry && (!draft.trim() || new TextEncoder().encode(draft).length > 8192)) return;
    const item: PendingCollaborationMessage = { ...(existing ?? { workspaceId, channelId, body: draft, idempotencyKey: this.key(), accountScope: directory.accountScope }), state: "sending" };
    this.pending.set(target, item); this.update({ pending: item, error: null });
    try {
      const { state: _state, code: _code, ...request } = item;
      const result = await this.client.sendCollaborationMessage(request);
      // Preserve outcome in its frozen scope, but never let an A response repaint B or a later A visit.
      if (this.disposed || this.pending.get(target) !== item || this.identities.get(workspaceId) !== JSON.stringify([item.accountScope, bootstrap.membership.principalId, bootstrap.membership.epoch])) return;
      if (!result.ok) {
        const failed: PendingCollaborationMessage = { ...item, state: result.error.code === "OUTCOME_UNKNOWN" ? "unknown" : "failed", code: result.error.code };
        this.pending.set(target, failed);
        if (this.current(epoch, workspaceId)) { this.failure(result.error.code); if (this.value.channelId === channelId && !revoked(result.error.code)) this.update({ pending: failed }); }
        return;
      }
      if (result.value.workspaceId !== workspaceId || result.value.channelId !== channelId || result.value.senderPrincipalId !== bootstrap.membership.principalId) {
        const unknown: PendingCollaborationMessage = { ...item, state: "unknown", code: "OUTCOME_UNKNOWN" }; this.pending.set(target, unknown);
        if (this.current(epoch, workspaceId) && this.value.channelId === channelId) this.update({ pending: unknown }); return;
      }
      this.pending.delete(target);
      // Do not erase a newer draft typed after navigation.
      if (this.drafts.get(target) === item.body) this.drafts.delete(target);
      if (!this.current(epoch, workspaceId)) return;
      const sent = { id: result.value.messageId, channelId, senderPrincipalId: result.value.senderPrincipalId, body: item.body, createdAt: result.value.createdAt,
        ...(result.value.sequence ? { sequence: result.value.sequence } : {}) };
      const messages = this.historySupported() && this.value.channelId !== channelId ? this.value.messages : mergeCollaborationMessages(this.value.messages, [sent]);
      this.update({ messages, ...(this.value.channelId === channelId ? { pending: null, draft: this.drafts.get(target) ?? "" } : {}) });
      await this.sync();
    } catch {
      if (this.disposed || this.pending.get(target) !== item) return;
      const unknown: PendingCollaborationMessage = { ...item, state: "unknown", code: "OUTCOME_UNKNOWN" };
      this.pending.set(target, unknown);
      if (this.current(epoch, workspaceId) && this.value.channelId === channelId) this.update({ pending: unknown });
    }
  }
  async createChannel(slug: string, displayName: string, retry = false) {
    const { workspaceId, bootstrap, directory, creation } = this.value, epoch = this.epoch;
    if (!workspaceId || !bootstrap || !directory || this.value.phase !== "ready" || !["OWNER", "ADMIN"].includes(bootstrap.membership.role)) return;
    if (creation?.state === "sending" || (creation && !retry) || (retry && !creation)) return;
    if (!retry && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || !displayName.trim() || displayName.length > 160)) return;
    const item = { ...(creation ?? { slug, displayName, idempotencyKey: this.key() }), state: "sending" as const };
    this.creations.set(workspaceId, item);
    this.update({ creation: item });
    try {
      const result = await this.client.createCollaborationChannel({ workspaceId, accountScope: directory.accountScope, slug: item.slug, displayName: item.displayName, idempotencyKey: item.idempotencyKey });
      if (!this.current(epoch, workspaceId) || this.creations.get(workspaceId) !== item) return;
      if (!result.ok) {
        const failed = { ...item, state: result.error.code === "OUTCOME_UNKNOWN" ? "unknown" as const : "failed" as const, code: result.error.code };
        this.creations.set(workspaceId, failed); this.failure(result.error.code);
        if (!revoked(result.error.code)) this.update({ creation: failed }); return;
      }
      if (result.value.workspaceId !== workspaceId) { this.failure("SCOPE_CHANGED"); return; }
      this.creations.delete(workspaceId);
      this.update({ bootstrap: { ...this.value.bootstrap!, channels: [...new Map([...this.value.bootstrap!.channels, result.value.channel].map(channel => [channel.id, channel])).values()] }, creation: null });
      this.selectChannel(result.value.channel.id);
    } catch {
      if (this.current(epoch, workspaceId) && this.creations.get(workspaceId) === item) {
        const unknown = { ...item, state: "unknown" as const, code: "OUTCOME_UNKNOWN" as const };
        this.creations.set(workspaceId, unknown); this.update({ creation: unknown });
      }
    }
  }
}
