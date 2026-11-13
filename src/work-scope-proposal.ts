// C5 proposal syntax/differences only. These objects and digests are not grants or approvals.
import { AgentBoundaryContractError, parseAgentBoundaryDocument, assertAgentBoundaryContext,
  agentBoundaryCommandSigningText, type AgentDutyProfile, type AgentExecutionBoundary, type AgentBoundaryCommand } from "./agent-boundary-contract.ts";
import { parseAgentDutyDraft, agentDutyDraftProposal } from "./agent-duty-draft.ts";
import type { WorkScopePolicySnapshot } from "./workspace-work-scope.ts";
import { canonical, AGENT_POLICY_PROPOSAL_DOMAIN } from "./contracts/agent-policy-canonical-v1.ts";
export type WorkScopeRights = WorkScopePolicySnapshot["rights"];
export interface WorkScopeProposal {
  readonly duty: AgentDutyProfile; readonly boundary: AgentExecutionBoundary; readonly rights: WorkScopeRights;
}
export type BoundaryChanges = Pick<AgentExecutionBoundary, "resources" | "tools" | "budget" | "approvalRequired" | "runtimeRequirements">;
const invalid = (): never => { throw new AgentBoundaryContractError("INVALID_DOCUMENT", "workScope.proposal"); };
function record(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key)
    || !descriptors[key]!.enumerable || !Object.prototype.hasOwnProperty.call(descriptors[key], "value"))) return invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key as string]!.value]));
}
/** Data validation only; the authenticated Host still decides admission for every C3 command. */
export function parseWorkScopeProposal(raw: unknown): WorkScopeProposal {
  const value = record(raw, ["duty", "boundary", "rights"]), duty = parseAgentBoundaryDocument(value.duty), boundary = parseAgentBoundaryDocument(value.boundary);
  if (duty.kind !== "duty-profile" || boundary.kind !== "execution-boundary" || duty.agentId !== boundary.agentId) return invalid();
  assertAgentBoundaryContext(boundary, duty.context);
  const rights = record(value.rights, ["manage", "invoke", "privateRead", "nodeUse"]);
  if (Object.values(rights).some(value => typeof value !== "boolean")) return invalid();
  return Object.freeze({ duty, boundary, rights: Object.freeze({ manage: rights.manage as boolean, invoke: rights.invoke as boolean,
    privateRead: rights.privateRead as boolean, nodeUse: rights.nodeUse as boolean }) });
}
const next = (revision: number) => { if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)
  throw new AgentBoundaryContractError("COUNTER_EXHAUSTED", "workScope.revision"); return revision + 1; };
export function dutyWorkScopeProposal(before: WorkScopePolicySnapshot, rawDraft: unknown): WorkScopeProposal {
  const current = parseWorkScopeProposal({ duty: before.duty, boundary: before.boundary, rights: before.rights });
  const draft = parseAgentDutyDraft(rawDraft), duty = agentDutyDraftProposal(draft, current.duty.context, current.duty.agentId, next(current.duty.dutyRevision));
  return Object.freeze({ ...current, duty }); // Boundary and four rights remain exactly the validated before-state.
}
export function boundaryWorkScopeProposal(before: WorkScopePolicySnapshot, rawChanges: unknown): WorkScopeProposal {
  const current = parseWorkScopeProposal({ duty: before.duty, boundary: before.boundary, rights: before.rights });
  const changes = record(rawChanges, ["resources", "tools", "budget", "approvalRequired", "runtimeRequirements"]);
  const boundary = parseAgentBoundaryDocument({ ...current.boundary, ...changes, boundaryRevision: next(current.boundary.boundaryRevision) });
  if (boundary.kind !== "execution-boundary" || boundary.budget.budgetRef !== current.boundary.budget.budgetRef) return invalid();
  const toolKeys = (values: AgentExecutionBoundary["tools"]["allow"]) => values.map(value => canonical([value.toolId, value.connectorId, value.catalogRevision]));
  const allowed = toolKeys(boundary.tools.allow), denied = toolKeys(boundary.tools.deny);
  if (new Set(boundary.resources.map(value => value.resourceId)).size !== boundary.resources.length
    || new Set(allowed).size !== allowed.length || new Set(denied).size !== denied.length || allowed.some(key => denied.includes(key))) return invalid();
  return Object.freeze({ ...current, boundary }); // Duty and four rights cannot be supplied through this form.
}
export async function workScopeSha256(text: string): Promise<string> {
  if (typeof text !== "string" || !globalThis.crypto?.subtle) throw new AgentBoundaryContractError("RUNTIME_UNSUPPORTED", "workScope.digest");
  const value = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(value), value => value.toString(16).padStart(2, "0")).join("");
}
/** Exact C3 domain + exact locked Core canonical JSON. Hashing alone authenticates nothing. */
export function workScopeProposalDigest(value: unknown): Promise<string> {
  const body = canonical(value); if (typeof body !== "string") return Promise.reject(new TypeError("Invalid JSON digest input"));
  return workScopeSha256(AGENT_POLICY_PROPOSAL_DOMAIN + body);
}
export const workScopeCommandDigest = (command: AgentBoundaryCommand) => workScopeSha256(agentBoundaryCommandSigningText(command));
export const workScopeEqual = (left: unknown, right: unknown) => canonical(left) === canonical(right);
export type WorkScopeChangeField = "title" | "description" | "owns" | "rejects" | "resource" | "allow" | "deny" | "readOnly"
  | "modelCalls" | "toolEffects" | "approval" | "requirement";
export type WorkScopeDiffValue = string | readonly string[] | number | boolean | null;
export interface WorkScopeChange {
  readonly field: WorkScopeChangeField; readonly direction: "text" | "expand" | "narrow";
  readonly before: WorkScopeDiffValue; readonly after: WorkScopeDiffValue;
  readonly resourceId?: string; readonly tool?: AgentExecutionBoundary["tools"]["allow"][number]; readonly operation?: string;
}
const toolKey = (value: AgentExecutionBoundary["tools"]["allow"][number]) => canonical([value.toolId, value.connectorId, value.catalogRevision]);
/** Every permission-relevant difference is explicit; no free-form duty text becomes a permission. */
export function workScopeChanges(before: WorkScopeProposal, proposed: WorkScopeProposal): readonly WorkScopeChange[] {
  const left = parseWorkScopeProposal(before), right = parseWorkScopeProposal(proposed);
  assertAgentBoundaryContext(right.duty, left.duty.context);
  if (left.duty.agentId !== right.duty.agentId || !workScopeEqual(left.rights, right.rights))
    throw new AgentBoundaryContractError("AUTHORIZATION_DENIED", "workScope.rights");
  const rows: WorkScopeChange[] = [];
  for (const field of ["title", "description", "owns", "rejects"] as const) if (!workScopeEqual(left.duty.publicProfile[field], right.duty.publicProfile[field]))
    rows.push({ field, direction: "text", before: left.duty.publicProfile[field], after: right.duty.publicProfile[field] });
  const oldBoundary = left.boundary, boundary = right.boundary;
  const oldResources = new Map(oldBoundary.resources.map(value => [value.resourceId, value.access])), resources = new Map(boundary.resources.map(value => [value.resourceId, value.access]));
  for (const resourceId of new Set([...oldResources.keys(), ...resources.keys()])) {
    const oldAccess = oldResources.get(resourceId) ?? [], access = resources.get(resourceId) ?? [];
    const added = access.filter(value => !oldAccess.includes(value)), removed = oldAccess.filter(value => !access.includes(value));
    if (added.length || removed.length) rows.push({ field: "resource", direction: added.length ? "expand" : "narrow", resourceId, before: oldAccess, after: access });
  }
  for (const field of ["allow", "deny"] as const) {
    const oldTools = new Map(oldBoundary.tools[field].map(value => [toolKey(value), value])), tools = new Map(boundary.tools[field].map(value => [toolKey(value), value]));
    for (const [key, tool] of tools) if (!oldTools.has(key)) rows.push({ field, tool, direction: field === "allow" ? "expand" : "narrow", before: null, after: "selected" });
    for (const [key, tool] of oldTools) if (!tools.has(key)) rows.push({ field, tool, direction: field === "allow" ? "narrow" : "expand", before: "selected", after: null });
  }
  if (oldBoundary.tools.readOnly !== boundary.tools.readOnly) rows.push({ field: "readOnly", direction: boundary.tools.readOnly ? "narrow" : "expand", before: oldBoundary.tools.readOnly, after: boundary.tools.readOnly });
  for (const [field, source] of [["modelCalls", "maxModelCalls"], ["toolEffects", "maxToolEffects"]] as const)
    if (oldBoundary.budget[source] !== boundary.budget[source]) rows.push({ field, direction: boundary.budget[source] > oldBoundary.budget[source] ? "expand" : "narrow", before: oldBoundary.budget[source], after: boundary.budget[source] });
  for (const [field, property] of [["approval", "approvalRequired"], ["requirement", "runtimeRequirements"]] as const) {
    const oldValues: readonly string[] = oldBoundary[property], values: readonly string[] = boundary[property];
    for (const operation of values) if (!oldValues.includes(operation)) rows.push({ field, operation, direction: "narrow", before: false, after: true });
    for (const operation of oldValues) if (!values.includes(operation)) rows.push({ field, operation, direction: "expand", before: true, after: false });
  }
  return Object.freeze(rows.map(row => Object.freeze(row)));
}
