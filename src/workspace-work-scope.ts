// C5 read-only disclosure consumer. No default binding; JSON/capability flags cannot create a source.
import { AgentBoundaryContractError, parseAgentBoundaryDocument, assertAgentBoundaryContext,
  type AgentBoundaryContext, type AgentBoundaryCommand, type AgentExecutionBoundary } from "./agent-boundary-contract.ts";
import { createAgentDutyDraft, agentDutyDraftProposal, type AgentDutyPublicProfile } from "./agent-duty-draft.ts";
import type { WorkspaceDevModel } from "./workspace-dev-state";
export interface WorkScopeTarget { readonly workspaceId: string; readonly generation: string; readonly agentId: string; readonly agentEpoch: number; readonly configRevision: number }
export interface WorkScopeBinding {
  readonly connectionId: string; readonly connectionEpoch: number; readonly capabilities: readonly string[];
  readonly context: AgentBoundaryContext; readonly provenance: AgentBoundaryCommand["provenance"];
  /** Platform/Host-owned synchronous observed-connection fence. Never a request-body claim. */
  assertCurrent(): unknown;
}
export interface WorkScopeHostBridge {
  capture(target: WorkScopeTarget): WorkScopeBinding | null;
  read(target: WorkScopeTarget, signal?: AbortSignal): Promise<unknown>;
  subscribe(listener: () => void): () => void;
  /** Host registry labels only, bound to the SAME current resource revision; optional, never inferred. */
  describeResources?(target: WorkScopeTarget, refs: readonly { resourceId: string; revision: number }[], signal?: AbortSignal): Promise<unknown> | unknown;
}
declare const captureBrand: unique symbol;
export interface WorkScopeCapture { readonly [captureBrand]: true; readonly key: string }
export interface SavedWorkScope {
  readonly state: "saved"; readonly profile: AgentDutyPublicProfile;
  readonly tools: AgentExecutionBoundary["tools"]; readonly approvals: AgentExecutionBoundary["approvalRequired"];
  readonly resources: readonly { resourceId: string; label: string | null; path: string | null; access: AgentExecutionBoundary["resources"][number]["access"] }[];
  readonly revisions: { policy: number; duty: number; boundary: number };
  readonly limits: { modelCalls: number; toolEffects: number };
}
export type WorkScopeView = SavedWorkScope | Readonly<{ state: "unconfirmed" }>;
declare const sourceBrand: unique symbol;
export interface WorkspaceWorkScopeSource {
  readonly [sourceBrand]: true;
  capture(target: WorkScopeTarget): WorkScopeCapture | null;
  current(capture: WorkScopeCapture): boolean;
  read(capture: WorkScopeCapture, signal?: AbortSignal): Promise<WorkScopeView>;
  subscribe(listener: () => void): () => void;
}
const fail = (): never => { throw new AgentBoundaryContractError("AUTHORITY_UNVERIFIED", "workScope.read"); };
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
function fields(raw: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(descriptors);
  if (keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key)) || own.some(key => typeof key !== "string"
    || ![...keys, ...optional].includes(key) || !descriptors[key]!.enumerable || !Object.prototype.hasOwnProperty.call(descriptors[key], "value"))) return fail();
  return Object.fromEntries(own.map(key => [key, descriptors[key as string]!.value]));
}
function items(raw: unknown, max = 128): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > max) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== raw.length + 1 || Array.from({ length: raw.length }, (_, i) => String(i)).some(key => !descriptors[key]
    || !descriptors[key]!.enumerable || !Object.prototype.hasOwnProperty.call(descriptors[key], "value"))) return fail();
  return Array.from({ length: raw.length }, (_, i) => descriptors[String(i)]!.value);
}
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(value);
const contextDraft = createAgentDutyDraft({ title: "context syntax", description: "Not a duty assignment", owns: [], rejects: [] });
const sources = new WeakSet<object>();
/** Trusted composition seam only. C12 must supply the actual authenticated Host bridge; this is NOT authentication. */
export function createWorkspaceWorkScopeSource(bridge: WorkScopeHostBridge): WorkspaceWorkScopeSource {
  const funcs = fields(bridge, ["capture", "read", "subscribe"], ["describeResources"]);
  if (["capture", "read", "subscribe"].some(key => typeof funcs[key] !== "function") || funcs.describeResources !== undefined && typeof funcs.describeResources !== "function") return fail();
  const captures = new WeakMap<object, { target: WorkScopeTarget; binding: WorkScopeBinding; context: AgentBoundaryContext; key: string }>();
  const identities = new Map<string, { identity: string; uiKey: string }>(); let serial = 0;
  function observed(target: WorkScopeTarget) {
    if (!id(target.workspaceId) || !id(target.generation) || !id(target.agentId) || !positive(target.agentEpoch) || !positive(target.configRevision)) return null;
    try {
      const raw = bridge.capture(Object.freeze({ ...target }));
      if (raw instanceof Promise) { void raw.catch(() => {}); return null; }
      if (!raw) return null;
      const row = fields(raw, ["connectionId", "connectionEpoch", "capabilities", "context", "provenance", "assertCurrent"]);
      if (!id(row.connectionId) || !positive(row.connectionEpoch) || typeof row.assertCurrent !== "function"
        || !items(row.capabilities).every(value => typeof value === "string" && /^[a-z][a-z0-9.-]{0,100}$/.test(value))
        || !items(row.capabilities).includes("workspace.agent-boundaries.authority.v1")) return null;
      const live = (row.assertCurrent as () => unknown)();
      if (live instanceof Promise) void live.catch(() => {});
      if (live !== undefined) return null; // Neither a Promise nor JSON/approved is a live fence.
      const proof = fields(row.provenance, ["channel", "proofRef"]);
      if (proof.channel !== "local_human" || !id(proof.proofRef)) return null;
      // Reuse C0 validation only; this syntactic proposal grants nothing and is never submitted.
      const context = agentDutyDraftProposal(contextDraft, row.context as AgentBoundaryContext, target.agentId, 1).context;
      if (context.scope.workspaceId !== target.workspaceId || context.resourceBinding.generation !== target.generation) return null;
      const binding = { ...row, context, provenance: proof } as unknown as WorkScopeBinding;
      return { target: Object.freeze({ ...target }), binding, context, key: canonical([target, row.connectionId, row.connectionEpoch, context, proof]) };
    } catch { return null; }
  }
  function check(capture: WorkScopeCapture) {
    const saved = captures.get(capture); if (!saved) return fail();
    const current = observed(saved.target); if (!current || current.key !== saved.key) return fail();
    return saved;
  }
  const source = {
    capture(target: WorkScopeTarget) {
      const saved = observed(target); if (!saved) return null;
      const targetKey = canonical(target), existing = identities.get(targetKey);
      if (!existing || existing.identity !== saved.key) {
        if (serial >= Number.MAX_SAFE_INTEGER) return null;
        identities.set(targetKey, { identity: saved.key, uiKey: String(++serial) });
        if (identities.size > 128) identities.delete(identities.keys().next().value!);
      }
      const capture = Object.freeze({ key: identities.get(targetKey)!.uiKey }) as WorkScopeCapture; captures.set(capture, saved); return capture;
    },
    current(capture: WorkScopeCapture) { try { check(capture); return true; } catch { return false; } },
    subscribe(listener: () => void) { const cleanup = bridge.subscribe(listener); if (typeof cleanup !== "function") return fail(); return cleanup; },
    async read(capture: WorkScopeCapture, signal?: AbortSignal): Promise<WorkScopeView> {
      if (signal?.aborted) return fail();
      const saved = check(capture), raw = await bridge.read(saved.target, signal); check(capture);
      if (signal?.aborted) return fail();
      const row = fields(raw, ["context", "provenance", "revision", "agent", "configured", "current", "policy", "executors", "identityReservations", "runtimeEnforced"]);
      const agent = fields(row.agent, ["agentId", "agentEpoch", "configRevision"]), proof = fields(row.provenance, ["channel", "proofRef"]);
      if (canonical(proof) !== canonical(saved.binding.provenance) || canonical(agent) !== canonical({ agentId: saved.target.agentId, agentEpoch: saved.target.agentEpoch, configRevision: saved.target.configRevision })
        || !Number.isSafeInteger(row.revision) || Object.is(row.revision, -0) || Number(row.revision) < 0 || typeof row.configured !== "boolean" || typeof row.current !== "boolean" || row.runtimeEnforced !== false) return fail();
      const contextCheck = agentDutyDraftProposal(contextDraft, row.context as AgentBoundaryContext, saved.target.agentId, 1);
      assertAgentBoundaryContext(contextCheck, saved.context);
      if (!row.configured) { if (row.policy !== null || row.current) return fail(); return Object.freeze({ state: "unconfirmed" }); }
      if (!row.current) return Object.freeze({ state: "unconfirmed" }); // Retained stale policy never reaches the UI.
      const policy = fields(row.policy, ["agentId", "revision", "agentEpoch", "configRevision", "rights", "duty", "boundary", "resources"]);
      const rights = fields(policy.rights, ["manage", "invoke", "privateRead", "nodeUse"]);
      if (Object.values(rights).some(value => typeof value !== "boolean") || !positive(policy.revision) || Number(policy.revision) > Number(row.revision)
        || policy.agentId !== saved.target.agentId || policy.agentEpoch !== saved.target.agentEpoch || policy.configRevision !== saved.target.configRevision) return fail();
      const duty = parseAgentBoundaryDocument(policy.duty), boundary = parseAgentBoundaryDocument(policy.boundary);
      if (duty.kind !== "duty-profile" || boundary.kind !== "execution-boundary" || duty.agentId !== saved.target.agentId || boundary.agentId !== saved.target.agentId) return fail();
      assertAgentBoundaryContext(duty, saved.context); assertAgentBoundaryContext(boundary, saved.context);
      const refs = items(policy.resources).map(raw => { const ref = fields(raw, ["resourceId", "revision"]); if (!id(ref.resourceId) || !positive(ref.revision)) return fail(); return { resourceId: ref.resourceId, revision: ref.revision }; });
      if (new Set(refs.map(ref => ref.resourceId)).size !== refs.length || boundary.resources.some(ref => !refs.some(row => row.resourceId === ref.resourceId))) return fail();
      const requested = Object.freeze(refs.filter(ref => boundary.resources.some(row => row.resourceId === ref.resourceId)).map(ref => Object.freeze(ref)));
      const descriptions = bridge.describeResources ? items(await bridge.describeResources(saved.target, requested, signal)) : [];
      check(capture); if (signal?.aborted) return fail();
      const labels = new Map<string, { label: string; path: string | null }>();
      for (const raw of descriptions) {
        const item = fields(raw, ["resourceId", "revision", "label"], ["path"]);
        if (!id(item.resourceId) || !requested.some(ref => ref.resourceId === item.resourceId && ref.revision === item.revision) || labels.has(item.resourceId)
          || typeof item.label !== "string" || !item.label.trim() || item.label.length > 160 || /[\x00-\x1f]/.test(item.label)
          || item.path !== undefined && (typeof item.path !== "string" || !item.path || item.path.length > 4096 || /[\x00-\x1f]/.test(item.path))) return fail();
        labels.set(item.resourceId, { label: item.label, path: typeof item.path === "string" ? item.path : null });
      }
      return Object.freeze({ state: "saved", profile: duty.publicProfile, tools: boundary.tools, approvals: boundary.approvalRequired,
        resources: Object.freeze(boundary.resources.map(ref => Object.freeze({ resourceId: ref.resourceId, access: ref.access,
          label: labels.get(ref.resourceId)?.label ?? null, path: labels.get(ref.resourceId)?.path ?? null }))),
        revisions: Object.freeze({ policy: policy.revision as number, duty: duty.dutyRevision, boundary: boundary.boundaryRevision }),
        limits: Object.freeze({ modelCalls: boundary.budget.maxModelCalls, toolEffects: boundary.budget.maxToolEffects }) });
    },
  } as WorkspaceWorkScopeSource;
  sources.add(source); return Object.freeze(source);
}
interface Bound { source: WorkspaceWorkScopeSource; dispose: () => void }
const bindings = new WeakMap<WorkspaceDevModel, Bound>(), versions = new WeakMap<WorkspaceDevModel, number>(), listeners = new WeakMap<WorkspaceDevModel, Set<() => void>>();
function changed(model: WorkspaceDevModel) {
  versions.set(model, (versions.get(model) ?? 0) + 1);
  for (const listener of [...(listeners.get(model) ?? [])]) { try { listener(); } catch { /* One view cannot prevent another from clearing private data. */ } }
}
/** Bind only from the actual privileged bootstrap. No application call site is enabled in this slice. */
export function bindWorkspaceWorkScopeSource(model: WorkspaceDevModel, source: WorkspaceWorkScopeSource): () => void {
  if (!sources.has(source)) return fail();
  const dispose = source.subscribe(() => changed(model));
  bindings.get(model)?.dispose(); const value = { source, dispose }; bindings.set(model, value); changed(model);
  return () => { if (bindings.get(model) === value) { dispose(); bindings.delete(model); changed(model); } };
}
export const workScopeSource = (model: WorkspaceDevModel | undefined): WorkspaceWorkScopeSource | null => model ? bindings.get(model)?.source ?? null : null;
export const workScopeVersion = (model: WorkspaceDevModel | undefined): number => model ? versions.get(model) ?? 0 : 0;
export function subscribeWorkScope(model: WorkspaceDevModel | undefined, listener: () => void): () => void {
  if (!model) return () => {};
  const set = listeners.get(model) ?? new Set(); set.add(listener); listeners.set(model, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(model); };
}
