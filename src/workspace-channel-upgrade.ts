import type { LocalChannelsView } from "./workspace-local-channels";

declare const organizationBrand: unique symbol;
declare const workspaceBrand: unique symbol;
declare const realmBrand: unique symbol;
export type OrganizationId = string & { readonly [organizationBrand]: true };
export type CloudWorkspaceId = string & { readonly [workspaceBrand]: true };
export type RealmId = string & { readonly [realmBrand]: true };
export type AccountRegion = "CN" | "GLOBAL";
export type ChannelUpgradeCode = "AUTH_REQUIRED" | "AUTH_CANCELLED" | "AUTH_EXPIRED" | "UNAVAILABLE" | "SOURCE_CHANGED"
  | "LOCAL_CHANNEL_BUSY" | "OUTCOME_UNKNOWN" | "SCOPE_CHANGED" | "REGION_MISMATCH" | "REALM_MISMATCH" | "MEMBERSHIP_STALE" | "RATE_LIMITED";
export type ChannelUpgradeResult<T> = { ok: true; value: T } | { ok: false; error: { code: ChannelUpgradeCode } };
export interface ChannelUpgradeSource {
  localWorkspaceId: string; resourceGeneration: string; localChannelId: string; catalogRevision: number; historyRevision: number;
}
export interface ChannelUpgradePreview { source: ChannelUpgradeSource; name: string; messageCount: number; colleagueCount: number; blocked: ChannelUpgradeCode | null }
export interface UpgradeAccount { accountScope: string; region: AccountRegion }
/** Only a trusted Core adapter may resolve these distinct IDs and verify the membership proof. */
export interface CloudChannelScope extends UpgradeAccount {
  organizationId: OrganizationId; workspaceId: CloudWorkspaceId; realmId: RealmId;
  membership: { state: "ACTIVE" | "REMOVED"; checkedAt: number; expiresAt: number };
}
export const CHANNEL_MEMBERSHIP_MAX_AGE_MS = 60_000;
export function channelScopeRefusal(expected: CloudChannelScope, received: CloudChannelScope, now: number): ChannelUpgradeCode | null {
  if (!["CN", "GLOBAL"].includes(expected.region) || received.region !== expected.region) return "REGION_MISMATCH";
  if (!expected.accountScope || received.accountScope !== expected.accountScope) return "SCOPE_CHANGED";
  if (![expected.organizationId, expected.workspaceId, expected.realmId].every(id => typeof id === "string" && id.length > 0)
    || received.organizationId !== expected.organizationId || received.workspaceId !== expected.workspaceId || received.realmId !== expected.realmId) return "REALM_MISMATCH";
  for (const proof of [expected.membership, received.membership]) {
    if (proof?.state !== "ACTIVE" || !Number.isFinite(now) || !Number.isFinite(proof.checkedAt) || !Number.isFinite(proof.expiresAt)
      || proof.checkedAt > now || now - proof.checkedAt >= CHANNEL_MEMBERSHIP_MAX_AGE_MS || proof.expiresAt <= now
      || proof.expiresAt > proof.checkedAt + CHANNEL_MEMBERSHIP_MAX_AGE_MS) return "MEMBERSHIP_STALE";
  }
  return null;
}
export interface ChannelUpgradeInput {
  source: ChannelUpgradeSource; account: UpgradeAccount; mode: "future_only"; target: "new_shared_workspace";
}
/** No message body, colleague command, credential, URL, invitation code or history import crosses this port. */
export interface ChannelUpgradeBridge {
  account(signal: AbortSignal): Promise<ChannelUpgradeResult<UpgradeAccount>>;
  signIn(signal: AbortSignal): Promise<ChannelUpgradeResult<UpgradeAccount>>;
  /** Read-only local preflight. Never route this to the Core prepare/commit RPCs. */
  checkUpgrade(input: ChannelUpgradeInput, signal: AbortSignal): Promise<ChannelUpgradeResult<never>>;
}
const refused = (code: ChannelUpgradeCode): ChannelUpgradeResult<never> => ({ ok: false, error: { code } });
const safeCode = (code: unknown): ChannelUpgradeCode => typeof code === "string" && ["AUTH_REQUIRED", "AUTH_CANCELLED", "AUTH_EXPIRED", "UNAVAILABLE", "SOURCE_CHANGED",
  "LOCAL_CHANNEL_BUSY", "OUTCOME_UNKNOWN", "SCOPE_CHANGED", "REGION_MISMATCH", "REALM_MISMATCH", "MEMBERSHIP_STALE", "RATE_LIMITED"].includes(code) ? code as ChannelUpgradeCode : "UNAVAILABLE";
/** A local handoff only. It never discovers stored accounts, starts login, or calls Account/Collab. */
export function createChannelUpgradeStub(): ChannelUpgradeBridge {
  return {
    async account() { return refused("UNAVAILABLE"); },
    async signIn() { return refused("UNAVAILABLE"); },
    async checkUpgrade() { return refused("UNAVAILABLE"); },
  };
}
export function previewChannelUpgrade(view: LocalChannelsView): ChannelUpgradePreview | null {
  const { channel, catalog } = view;
  if (!view.supported || !channel || !catalog || channel.channel.id !== view.channelId
    || channel.workspaceId !== catalog.workspaceId || channel.resourceGeneration !== catalog.resourceGeneration
    || !catalog.channels.some(row => row.id === channel.channel.id)
    || !Number.isSafeInteger(catalog.revision) || catalog.revision < 0 || !Number.isSafeInteger(channel.revision) || channel.revision < 0) return null;
  return { source: { localWorkspaceId: channel.workspaceId, resourceGeneration: channel.resourceGeneration, localChannelId: channel.channel.id,
    catalogRevision: catalog.revision, historyRevision: channel.revision }, name: channel.channel.name,
    messageCount: channel.messages.length, colleagueCount: channel.channel.memberIds.length,
    blocked: view.pending?.state === "unknown" || view.creationUnknown ? "OUTCOME_UNKNOWN"
      : view.saving || view.loading || view.pending || ["running", "draining"].includes(channel.state) ? "LOCAL_CHANNEL_BUSY" : null };
}
export interface ChannelUpgradeView {
  phase: "preview" | "checking" | "sign-in" | "signing-in" | "confirm" | "preparing" | "blocked";
  preview: ChannelUpgradePreview | null; account: UpgradeAccount | null; notice: ChannelUpgradeCode | null;
}
/** Ephemeral UI intent; this is never a durable upgrade job, source fence or execution authority. */
export class ChannelUpgradeModel {
  private view: ChannelUpgradeView;
  private readonly bridge: ChannelUpgradeBridge;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private controller: AbortController | null = null;
  constructor(local: LocalChannelsView, bridge: ChannelUpgradeBridge = createChannelUpgradeStub()) {
    this.bridge = bridge; this.view = { phase: "preview", preview: previewChannelUpgrade(local), account: null, notice: null };
  }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<ChannelUpgradeView>) { this.view = { ...this.view, ...value }; for (const listener of this.listeners) listener(); }
  sync(local: LocalChannelsView) {
    const preview = previewChannelUpgrade(local);
    if (JSON.stringify(preview) === JSON.stringify(this.view.preview)) return;
    this.stop(); this.update({ preview, phase: "preview", account: null, notice: "SOURCE_CHANGED" });
  }
  private stop() { ++this.epoch; this.controller?.abort(); this.controller = null; }
  cancel = () => { this.stop(); this.update({ phase: "preview", account: null, notice: null }); };
  private begin(phase: "checking" | "signing-in" | "preparing") {
    if (!this.view.preview || this.view.preview.blocked || ["checking", "signing-in", "preparing"].includes(this.view.phase)) return null;
    this.stop(); const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    this.update({ phase, notice: null }); return { epoch, signal: controller.signal };
  }
  private applyAccount(result: ChannelUpgradeResult<UpgradeAccount>) {
    if (!result.ok) { this.update({ phase: "sign-in", account: null, notice: safeCode(result.error?.code) }); return; }
    const { accountScope, region } = result.value;
    if (typeof accountScope !== "string" || !accountScope || !["CN", "GLOBAL"].includes(region)) {
      this.update({ phase: "sign-in", account: null, notice: "UNAVAILABLE" }); return;
    }
    this.update({ phase: "confirm", account: { accountScope, region }, notice: null });
  }
  async continue() {
    const request = this.begin("checking"); if (!request) return;
    try { const result = await this.bridge.account(request.signal); if (request.epoch === this.epoch) this.applyAccount(result); }
    catch { if (request.epoch === this.epoch) this.applyAccount(refused("UNAVAILABLE")); }
  }
  async signIn() {
    if (this.view.phase !== "sign-in") return;
    const request = this.begin("signing-in"); if (!request) return;
    try { const result = await this.bridge.signIn(request.signal); if (request.epoch === this.epoch) this.applyAccount(result); }
    catch { if (request.epoch === this.epoch) this.applyAccount(refused("UNAVAILABLE")); }
  }
  async prepare(confirmed: boolean) {
    const { account, preview } = this.view;
    if (!confirmed || this.view.phase !== "confirm" || !account || !preview) return;
    const request = this.begin("preparing"); if (!request) return;
    try {
      const current = await this.bridge.account(request.signal); if (request.epoch !== this.epoch) return;
      if (!current.ok) { this.applyAccount(current); return; }
      if (current.value.accountScope !== account.accountScope || current.value.region !== account.region) {
        this.applyAccount(refused(current.value.region !== account.region ? "REGION_MISMATCH" : "SCOPE_CHANGED")); return;
      }
      const result = await this.bridge.checkUpgrade({ source: { ...preview.source }, account: { ...account }, mode: "future_only", target: "new_shared_workspace" }, request.signal);
      if (request.epoch === this.epoch) this.update({ phase: "blocked", account: null, notice: result.ok ? "UNAVAILABLE" : safeCode(result.error?.code) });
    } catch { if (request.epoch === this.epoch) this.update({ phase: "blocked", account: null, notice: "OUTCOME_UNKNOWN" }); }
  }
}
