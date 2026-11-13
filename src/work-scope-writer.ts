// Trusted Host composition seam, default unbound. Every actual admission remains in C1/C3.
import { AgentBoundaryContractError, parseAgentBoundaryDocument, assertAgentBoundaryContext,
  type AgentBoundaryCommand, type AgentBoundaryReceipt, type AgentBoundaryErrorCode } from "./agent-boundary-contract.ts";
import { isWorkspaceWorkScopeSource, workScopeSource, type WorkspaceWorkScopeSource, type WorkScopeCapture,
  type WorkScopeIdentity, type WorkScopePolicySnapshot, type WorkScopeTarget } from "./workspace-work-scope.ts";
import { dutyWorkScopeProposal, boundaryWorkScopeProposal, parseWorkScopeProposal, workScopeProposalDigest,
  workScopeSha256, workScopeCommandDigest, workScopeEqual, workScopeChanges, type WorkScopeProposal, type WorkScopeChange } from "./work-scope-proposal.ts";
import { canonical } from "./contracts/agent-policy-canonical-v1.ts";
import { parseWorkScopeEditCatalog, assertWorkScopeCatalog, type WorkScopeEditCatalog } from "./work-scope-catalog.ts";
import { parseWorkScopeReference, workScopeReferenceNamespace, type WorkScopeReference, type WorkScopeReferenceStore } from "./work-scope-references.ts";
import type { WorkspaceDevModel } from "./workspace-dev-state";
/** Supplied by a privileged bootstrap on the SAME observed owner connection as readSource.
 * assertCurrent is a synchronous connection fence. JSON/capability flags are not authentication. */
export interface WorkScopeCommandPort {
  assertCurrent(identity: WorkScopeIdentity): unknown;
  inspect(target: WorkScopeTarget, signal?: AbortSignal): Promise<unknown>;
  draft(target: WorkScopeTarget, input: { commandId: string; rootRequestId: string; operation: AgentBoundaryCommand["operation"]; lifetimeMs: number }, signal?: AbortSignal): Promise<unknown>;
  submit(target: WorkScopeTarget, command: AgentBoundaryCommand, proposal: WorkScopeProposal): Promise<unknown>;
  receipt(target: WorkScopeTarget, commandId: string, signal?: AbortSignal): Promise<unknown>;
  catalog?(target: WorkScopeTarget, policy: WorkScopePolicySnapshot, signal?: AbortSignal): Promise<unknown>;
}
declare const captureBrand: unique symbol;
export interface WorkScopeWriteCapture { readonly [captureBrand]: true; readonly key: string }
declare const sessionBrand: unique symbol;
export interface WorkScopeEditSession {
  readonly [sessionBrand]: true; readonly key: string; readonly policy: WorkScopePolicySnapshot;
  readonly catalog: WorkScopeEditCatalog | null; readonly pending: readonly WorkScopeOutcome[];
}
declare const previewBrand: unique symbol;
export interface WorkScopePreview {
  readonly [previewBrand]: true; readonly key: string; readonly action: "duty.update" | "boundary.update";
  readonly proposal: WorkScopeProposal; readonly changes: readonly WorkScopeChange[];
  readonly commandId: string; readonly expiresAt: string;
}
/** Transport uncertainty is a local UI observation, never a fabricated C0 receipt. */
export interface WorkScopeOutcome {
  readonly reference: WorkScopeReference; readonly receipt: AgentBoundaryReceipt | null;
  readonly state: "pending" | "applied" | "superseded" | "rejected" | "unknown";
}
export interface WorkspaceWorkScopeWriter {
  capture(target: WorkScopeTarget): WorkScopeWriteCapture | null;
  current(capture: WorkScopeWriteCapture): boolean;
  load(capture: WorkScopeWriteCapture, signal?: AbortSignal): Promise<WorkScopeEditSession | null>;
  preview(session: WorkScopeEditSession, input: { action: "duty.update"; draft: unknown } | { action: "boundary.update"; boundary: unknown }, signal?: AbortSignal): Promise<WorkScopePreview>;
  submit(preview: WorkScopePreview): Promise<WorkScopeOutcome>;
  cancel(preview: WorkScopePreview): void;
  refresh(capture: WorkScopeWriteCapture, reference: WorkScopeReference, signal?: AbortSignal): Promise<WorkScopeOutcome>;
  subscribe(listener: () => void): () => void;
}
const fail = (code: AgentBoundaryErrorCode = "AUTHORITY_UNVERIFIED", field = "workScope.write"): never => { throw new AgentBoundaryContractError(code, field); };
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
  const own = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(own);
  if (required.some(key => !Object.prototype.hasOwnProperty.call(own, key)) || keys.some(key => typeof key !== "string"
    || ![...required, ...optional].includes(key) || !own[key]!.enumerable || !Object.prototype.hasOwnProperty.call(own[key], "value"))) return fail();
  return Object.fromEntries(keys.map(key => [key, own[key as string]!.value]));
}
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function control(raw: unknown, target: WorkScopeTarget): Readonly<{ epoch: number; dismissed: boolean }> {
  const row = fields(raw, ["sourceAvailableHere", "pendingDrainObservations", "agent", "runs"], ["lifecycle"]);
  if (row.sourceAvailableHere !== true || !counter(row.pendingDrainObservations) || !Array.isArray(row.runs)) return fail("CONTROL_HELD");
  const agent = fields(row.agent, ["agentId", "epoch", "hold", "dismissed"]);
  if (agent.agentId !== target.agentId || !counter(agent.epoch) || typeof agent.dismissed !== "boolean") return fail();
  if (agent.hold !== null) {
    const hold = fields(agent.hold, ["holdId", "reason", "sequence"]);
    if (typeof hold.holdId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(hold.holdId)
      || !["task_stop", "agent_pause", "dismissed", "recovery"].includes(hold.reason as string) || !counter(hold.sequence)) return fail();
  }
  return Object.freeze({ epoch: agent.epoch, dismissed: agent.dismissed });
}
const writers = new WeakMap<object, WorkspaceWorkScopeSource>();
/** No default clock, transport or persistence authority can be obtained from a model's RPC method. */
export function createWorkspaceWorkScopeWriter(readSource: WorkspaceWorkScopeSource, port: WorkScopeCommandPort, references: WorkScopeReferenceStore): WorkspaceWorkScopeWriter {
  if (!isWorkspaceWorkScopeSource(readSource)) return fail();
  const methods = fields(port, ["assertCurrent", "inspect", "draft", "submit", "receipt"], ["catalog"]);
  if (Object.values(methods).some(value => typeof value !== "function")) return fail();
  const refMethods = fields(references, ["list", "put", "remove"]);
  if (Object.values(refMethods).some(value => typeof value !== "function")) return fail();
  type Capture = { read: WorkScopeCapture; identity: WorkScopeIdentity; namespace: string };
  type Session = { capture: WorkScopeWriteCapture; before: WorkScopePolicySnapshot; epoch: number; consumed: boolean; catalog: WorkScopeEditCatalog | null };
  type Ticket = { session: Session; command: AgentBoundaryCommand; proposal: WorkScopeProposal; reference: WorkScopeReference; promise?: Promise<WorkScopeOutcome>; cancelled: boolean };
  const captures = new WeakMap<object, Capture>(), sessions = new WeakMap<object, Session>(), tickets = new WeakMap<object, Ticket>();
  const active = new Map<string, WorkScopePreview>();
  function check(capture: WorkScopeWriteCapture, signal?: AbortSignal): Capture {
    if (signal?.aborted) return fail();
    const saved = captures.get(capture); if (!saved || !readSource.current(saved.read)) return fail();
    const identity = readSource.identity(saved.read);
    if (!identity.capabilities.includes("workspace.agent-command-control.v1")
      || !workScopeEqual({ ...identity, capabilities: [] }, { ...saved.identity, capabilities: [] })) return fail();
    const fenced = port.assertCurrent(identity);
    if (fenced instanceof Promise) void fenced.catch(() => {});
    if (fenced !== undefined) return fail();
    return saved;
  }
  async function policy(capture: WorkScopeWriteCapture, signal?: AbortSignal): Promise<WorkScopePolicySnapshot> {
    const saved = check(capture, signal), value = await readSource.policy(saved.read, signal); check(capture, signal);
    if (value.state !== "saved") return fail("BOUNDARY_CONFIRMATION_REQUIRED");
    return value;
  }
  const currentProposal = (value: WorkScopePolicySnapshot) => parseWorkScopeProposal({ duty: value.duty, boundary: value.boundary, rights: value.rights });
  async function referenceCheck(capture: WorkScopeWriteCapture, raw: WorkScopeReference, signal?: AbortSignal) {
    const saved = check(capture, signal), reference = parseWorkScopeReference(raw), contextDigest = await workScopeSha256(canonical(saved.identity.context)); check(capture, signal);
    if (reference.workspaceId !== saved.identity.target.workspaceId || reference.generation !== saved.identity.target.generation
      || reference.agentId !== saved.identity.target.agentId || reference.scopeKey !== saved.identity.context.resourceBinding.scopeKey
      || reference.contextDigest !== contextDigest) return fail("CONTEXT_MISMATCH");
    return { saved, reference };
  }
  async function outcome(capture: WorkScopeWriteCapture, reference: WorkScopeReference, raw: unknown, signal?: AbortSignal): Promise<WorkScopeOutcome> {
    const { saved } = await referenceCheck(capture, reference, signal), receipt = parseAgentBoundaryDocument(raw);
    if (receipt.kind !== "command-receipt") return fail();
    assertAgentBoundaryContext(receipt, saved.identity.context);
    if (receipt.commandId !== reference.commandId || receipt.rootRequestId !== reference.rootRequestId || receipt.agentId !== reference.agentId
      || receipt.intentDigest !== reference.intentDigest) return fail("COMMAND_ID_CONFLICT");
    let state: WorkScopeOutcome["state"] = receipt.status === "unknown" ? "unknown" : receipt.status === "rejected" ? "rejected" : "pending";
    if (receipt.status === "applied") {
      const fresh = await policy(capture, signal), digest = await workScopeProposalDigest(currentProposal(fresh)); check(capture, signal);
      state = digest === reference.proposalDigest ? "applied" : "superseded";
    }
    check(capture, signal);
    if (["applied", "superseded", "rejected"].includes(state)) references.remove(saved.namespace, reference);
    return Object.freeze({ reference, receipt, state });
  }
  async function query(capture: WorkScopeWriteCapture, reference: WorkScopeReference, signal?: AbortSignal): Promise<WorkScopeOutcome> {
    const { saved } = await referenceCheck(capture, reference, signal);
    try {
      const raw = await port.receipt(saved.identity.target, reference.commandId, signal); check(capture, signal);
      return await outcome(capture, reference, raw, signal);
    } catch {
      check(capture, signal); // Revocation and a late response must never expose the old reference.
      return Object.freeze({ reference, receipt: null, state: "unknown" });
    }
  }
  async function unchanged(session: Session, signal?: AbortSignal, requireCatalog = false) {
    const saved = check(session.capture, signal), fresh = await policy(session.capture, signal);
    if (!fresh.rights.manage || !workScopeEqual(fresh, session.before)) return fail("STALE_REVISION");
    const raw = await port.inspect(saved.identity.target, signal); check(session.capture, signal);
    const state = control(raw, saved.identity.target);
    if (state.dismissed || state.epoch !== session.epoch) return fail("STALE_REVISION");
    if (requireCatalog) {
      if (!session.catalog || !port.catalog) return fail("RUNTIME_UNSUPPORTED");
      const freshCatalog = parseWorkScopeEditCatalog(await port.catalog(saved.identity.target, fresh, signal), fresh); check(session.capture, signal);
      if (!workScopeEqual(freshCatalog, session.catalog)) return fail("STALE_REVISION");
    }
    return saved;
  }
  const writer: WorkspaceWorkScopeWriter = {
    capture(target) {
      try {
        const read = readSource.capture(target); if (!read) return null;
        const identity = readSource.identity(read); if (!identity.capabilities.includes("workspace.agent-command-control.v1")) return null;
        const result = Object.freeze({ key: read.key }) as WorkScopeWriteCapture;
        captures.set(result, { read, identity, namespace: workScopeReferenceNamespace(identity) }); check(result); return result;
      } catch { return null; }
    },
    current(capture) { try { check(capture); return true; } catch { return false; } },
    subscribe(listener) { return readSource.subscribe(listener); },
    async load(capture, signal) {
      const saved = check(capture, signal), fresh = await policy(capture, signal);
      // Reader rights are independent of management. Never enumerate pending references for an unauthorized reader.
      if (!fresh.rights.manage && !fresh.rights.invoke) return null;
      const pending: WorkScopeOutcome[] = [];
      for (const reference of references.list(saved.namespace)) pending.push(await query(capture, reference, signal));
      check(capture, signal);
      if (!fresh.rights.manage) return pending.length ? Object.freeze({ key: capture.key, policy: fresh, catalog: null, pending: Object.freeze(pending) }) as WorkScopeEditSession : null;
      const raw = await port.inspect(saved.identity.target, signal); check(capture, signal);
      const state = control(raw, saved.identity.target); if (state.dismissed) return null;
      // A proposal or another window may have changed the policy while original receipts were read.
      const after = await policy(capture, signal); if (!workScopeEqual(fresh, after)) return fail("STALE_REVISION");
      const catalog = port.catalog ? parseWorkScopeEditCatalog(await port.catalog(saved.identity.target, fresh, signal), fresh) : null; check(capture, signal);
      const view = Object.freeze({ key: capture.key, policy: fresh, catalog, pending: Object.freeze(pending) }) as WorkScopeEditSession;
      sessions.set(view, { capture, before: fresh, epoch: state.epoch, consumed: false, catalog }); return view;
    },
    async preview(view, input, signal) {
      const session = sessions.get(view); if (!session || session.consumed) return fail();
      const rawInput = fields(input, ["action"], ["draft", "boundary"]);
      if (rawInput.action === "duty.update") fields(input, ["action", "draft"]);
      else if (rawInput.action === "boundary.update") fields(input, ["action", "boundary"]);
      else return fail("INVALID_DOCUMENT");
      const saved = await unchanged(session, signal);
      if (references.list(saved.namespace).length || active.has(saved.namespace)) return fail("CONTROL_HELD");
      const proposal = input.action === "duty.update" ? dutyWorkScopeProposal(session.before, input.draft)
        : boundaryWorkScopeProposal(session.before, input.boundary);
      if (input.action === "boundary.update") {
        if (!session.catalog) return fail("RUNTIME_UNSUPPORTED"); assertWorkScopeCatalog(proposal, session.catalog);
      }
      const changes = workScopeChanges(currentProposal(session.before), proposal); if (!changes.length) return fail("INVALID_DOCUMENT", "workScope.noChange");
      const digest = await workScopeProposalDigest(proposal); check(session.capture, signal);
      if (!globalThis.crypto?.randomUUID) return fail("RUNTIME_UNSUPPORTED");
      const commandId = `c5_${crypto.randomUUID()}`, rootRequestId = `c5_${crypto.randomUUID()}`;
      const operation = input.action === "duty.update" ? { action: "duty.update" as const, proposedDutyDigest: digest }
        : { action: "boundary.update" as const, proposedBoundaryDigest: digest };
      const raw = await port.draft(saved.identity.target, { commandId, rootRequestId, operation, lifetimeMs: 30000 }, signal); check(session.capture, signal);
      const command = parseAgentBoundaryDocument(raw);
      if (command.kind !== "command") return fail(); assertAgentBoundaryContext(command, saved.identity.context);
      if (command.commandId !== commandId || command.rootRequestId !== rootRequestId || command.agentId !== saved.identity.target.agentId
        || !workScopeEqual(command.provenance, saved.identity.provenance) || !workScopeEqual(command.operation, operation)
        || !workScopeEqual(command.expected, { dutyRevision: session.before.duty.dutyRevision, boundaryRevision: session.before.boundary.boundaryRevision, controlEpoch: session.epoch })
        || command.intentDigest !== await workScopeCommandDigest(command)) return fail();
      const issued = Date.parse(command.issuedAt), expires = Date.parse(command.notAfter), now = Date.now();
      if (issued > now + 1000 || now >= expires || expires - issued > 30000) return fail("STALE_REVISION");
      await unchanged(session, signal, input.action === "boundary.update");
      if (session.consumed || references.list(saved.namespace).length || active.has(saved.namespace)) return fail("CONTROL_HELD");
      const reference = parseWorkScopeReference({ schemaVersion: 1, workspaceId: saved.identity.target.workspaceId, generation: saved.identity.target.generation,
        scopeKey: saved.identity.context.resourceBinding.scopeKey, agentId: command.agentId, contextDigest: await workScopeSha256(canonical(command.context)),
        commandId, rootRequestId, intentDigest: command.intentDigest, proposalDigest: digest, action: input.action });
      check(session.capture, signal); session.consumed = true;
      const preview = Object.freeze({ key: view.key, action: input.action, proposal, changes, commandId, expiresAt: command.notAfter }) as WorkScopePreview;
      tickets.set(preview, { session, command, proposal, reference, cancelled: false }); active.set(saved.namespace, preview); return preview;
    },
    submit(preview) {
      const ticket = tickets.get(preview); if (!ticket || ticket.cancelled) return Promise.reject(new AgentBoundaryContractError("AUTHORITY_UNVERIFIED", "workScope.preview"));
      if (ticket.promise) return ticket.promise; // Same promise before any await; double-click cannot submit twice.
      ticket.promise = (async () => {
        const saved = await unchanged(ticket.session, undefined, ticket.reference.action === "boundary.update");
        if (active.get(saved.namespace) !== preview || references.list(saved.namespace).length) return fail("CONTROL_HELD");
        if (Date.now() >= Date.parse(ticket.command.notAfter)) return fail("STALE_REVISION");
        // Persist before any possible call. Failure leaves submission count at zero.
        references.put(saved.namespace, ticket.reference);
        check(ticket.session.capture);
        active.delete(saved.namespace);
        try {
          const raw = await port.submit(saved.identity.target, ticket.command, ticket.proposal); check(ticket.session.capture);
          return await outcome(ticket.session.capture, ticket.reference, raw);
        } catch {
          check(ticket.session.capture);
          return Object.freeze({ reference: ticket.reference, receipt: null, state: "unknown" as const });
        }
      })();
      return ticket.promise;
    },
    cancel(preview) {
      const ticket = tickets.get(preview); if (!ticket || ticket.promise) return;
      ticket.cancelled = true; const saved = captures.get(ticket.session.capture);
      if (saved && active.get(saved.namespace) === preview) active.delete(saved.namespace);
    },
    refresh: query,
  };
  writers.set(writer, readSource); return Object.freeze(writer);
}
const bindings = new WeakMap<WorkspaceDevModel, { writer: WorkspaceWorkScopeWriter; dispose: () => void }>();
const versions = new WeakMap<WorkspaceDevModel, number>(), listeners = new WeakMap<WorkspaceDevModel, Set<() => void>>();
function changed(model: WorkspaceDevModel) {
  versions.set(model, (versions.get(model) ?? 0) + 1);
  for (const listener of [...(listeners.get(model) ?? [])]) { try { listener(); } catch { /* Isolate view listeners. */ } }
}
/** Privileged composition only. No production caller is enabled by C5. */
export function bindWorkspaceWorkScopeWriter(model: WorkspaceDevModel, writer: WorkspaceWorkScopeWriter): () => void {
  if (!writers.has(writer) || writers.get(writer) !== workScopeSource(model)) return fail();
  const dispose = writer.subscribe(() => changed(model)); bindings.get(model)?.dispose(); const value = { writer, dispose }; bindings.set(model, value); changed(model);
  return () => { if (bindings.get(model) === value) { dispose(); bindings.delete(model); changed(model); } };
}
export function workScopeWriter(model: WorkspaceDevModel | undefined): WorkspaceWorkScopeWriter | null {
  const value = model ? bindings.get(model)?.writer : null; return value && writers.get(value) === workScopeSource(model) ? value : null;
}
export const workScopeWriterVersion = (model: WorkspaceDevModel | undefined) => model ? versions.get(model) ?? 0 : 0;
export function subscribeWorkScopeWriter(model: WorkspaceDevModel | undefined, listener: () => void) {
  if (!model) return () => {};
  const set = listeners.get(model) ?? new Set(); set.add(listener); listeners.set(model, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(model); };
}
