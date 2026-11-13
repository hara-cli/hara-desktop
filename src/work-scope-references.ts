// Durable non-secret references only. No proposal, credential or command body is persisted here.
import { AgentBoundaryContractError } from "./agent-boundary-contract.ts";
import type { WorkScopeIdentity } from "./workspace-work-scope.ts";
export interface WorkScopeReference {
  readonly schemaVersion: 1 | 2; readonly issuedAt?: string; readonly notAfter?: string; readonly workspaceId: string; readonly generation: string; readonly scopeKey: string; readonly agentId: string;
  readonly contextDigest: string; readonly commandId: string; readonly rootRequestId: string; readonly intentDigest: string;
  readonly proposalDigest: string; readonly action: "duty.update" | "boundary.update";
}
export interface WorkScopeReferenceStore {
  list(namespace: string): readonly WorkScopeReference[];
  put(namespace: string, reference: WorkScopeReference): void;
  remove(namespace: string, reference: WorkScopeReference): void;
}
export type WorkScopeStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const fail = (): never => { throw new AgentBoundaryContractError("CONTROL_HELD", "workScope.reference"); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const keys = ["schemaVersion", "workspaceId", "generation", "scopeKey", "agentId", "contextDigest", "commandId", "rootRequestId", "intentDigest", "proposalDigest", "action"];
export function parseWorkScopeReference(raw: unknown): WorkScopeReference {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw), names = Reflect.ownKeys(descriptors);
  const version = descriptors.schemaVersion;
  if (!version || !Object.prototype.hasOwnProperty.call(version, "value") || ![1, 2].includes(version.value)) return fail();
  const expected = version.value === 2 ? [...keys, "issuedAt", "notAfter"] : keys;
  if (names.length !== expected.length || names.some(key => typeof key !== "string" || !expected.includes(key) || !descriptors[key]!.enumerable
    || !Object.prototype.hasOwnProperty.call(descriptors[key], "value"))) return fail();
  const row = Object.fromEntries(expected.map(key => [key, descriptors[key]!.value]));
  if (![1, 2].includes(row.schemaVersion as number) || ![row.workspaceId, row.generation, row.agentId, row.commandId, row.rootRequestId].every(id)
    || ![row.scopeKey, row.contextDigest, row.intentDigest, row.proposalDigest].every(digest) || !["duty.update", "boundary.update"].includes(row.action as string)) return fail();
  if (row.schemaVersion === 2) {
    const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
    if (!iso(row.issuedAt) || !iso(row.notAfter) || Date.parse(row.notAfter) <= Date.parse(row.issuedAt) || Date.parse(row.notAfter) - Date.parse(row.issuedAt) > 30000) return fail();
  }
  return Object.freeze(row) as unknown as WorkScopeReference;
}
export function workScopeReferenceNamespace(identity: WorkScopeIdentity): string {
  const { context, target } = identity;
  return "hara.work-scope.pending.v1:" + [context.resourceBinding.scopeKey, context.resourceBinding.generation, context.scope.workspaceId,
    target.agentId, context.humanSubjectId, context.nodeId, context.deviceId ?? ""].map(encodeURIComponent).join(":") + ":";
}
function namespace(value: string) {
  if (typeof value !== "string" || !value.startsWith("hara.work-scope.pending.v1:") || value.length > 4096 || !value.endsWith(":")) return fail();
  return value;
}
const serialized = (reference: WorkScopeReference) => JSON.stringify(parseWorkScopeReference(reference));
/** One key per command: concurrent windows cannot overwrite each other's possibly submitted reference. */
export function createWorkScopeReferenceStore(storage: WorkScopeStorage): WorkScopeReferenceStore {
  const read = (key: string): WorkScopeReference | null => {
    const value = storage.getItem(key); if (value === null) return null;
    if (value.length > 4096) return fail();
    try { return parseWorkScopeReference(JSON.parse(value)); } catch { return fail(); }
  };
  return Object.freeze({
    list(prefix: string) {
      namespace(prefix); const result: WorkScopeReference[] = [];
      const matchingKeys = () => {
        const length = storage.length; if (!Number.isSafeInteger(length) || length < 0 || length > 30000) return fail();
        const found: string[] = [];
        for (let index = 0; index < length; index++) { const key = storage.key(index); if (key?.startsWith(prefix)) found.push(key); }
        return found.sort();
      };
      const before = matchingKeys();
      for (const key of before) {
        const row = read(key); if (row === null) return fail();
        if (key !== prefix + encodeURIComponent(row.commandId) || result.some(value => value.commandId === row.commandId)) return fail();
        result.push(row); if (result.length > 32) return fail(); // Hold, never evict an unresolved reference by age/count.
      }
      if (JSON.stringify(before) !== JSON.stringify(matchingKeys())) return fail(); // A concurrent change is not an empty queue.
      return Object.freeze(result);
    },
    put(prefix: string, raw: WorkScopeReference) {
      namespace(prefix); const reference = parseWorkScopeReference(raw), key = prefix + encodeURIComponent(reference.commandId), prior = read(key);
      if (prior && serialized(prior) !== serialized(reference)) return fail();
      // Quota/storage failures propagate BEFORE the caller can attempt a submission.
      storage.setItem(key, serialized(reference));
      if (storage.getItem(key) !== serialized(reference)) return fail();
    },
    remove(prefix: string, raw: WorkScopeReference) {
      namespace(prefix); const reference = parseWorkScopeReference(raw), key = prefix + encodeURIComponent(reference.commandId), prior = read(key);
      if (prior && serialized(prior) !== serialized(reference)) return fail();
      if (prior) storage.removeItem(key); // No prefix/all-record deletion; only a verified terminal command may call this.
    },
  });
}
