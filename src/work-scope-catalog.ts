// Current Host registry projection for the C5 form; data only, never a filesystem/transport grant.
import { AgentBoundaryContractError, parseAgentBoundaryDocument, assertAgentBoundaryContext, type AgentExecutionBoundary } from "./agent-boundary-contract.ts";
import type { WorkScopePolicySnapshot } from "./workspace-work-scope.ts";
import { workScopeEqual, type WorkScopeProposal } from "./work-scope-proposal.ts";
export interface WorkScopeEditCatalog {
  readonly resources: readonly Readonly<{ resourceId: string; revision: number; label: string; path: string | null; access: readonly ("read" | "write")[] }>[];
  readonly tools: readonly Readonly<{ ref: AgentExecutionBoundary["tools"]["allow"][number]; label: string }>[];
  readonly limits: Readonly<{ budgetRef: string; maxModelCalls: number; maxToolEffects: number;
    requiredApprovals: AgentExecutionBoundary["approvalRequired"]; requiredChecks: AgentExecutionBoundary["runtimeRequirements"] }>;
}
const fail = (): never => { throw new AgentBoundaryContractError("AUTHORITY_UNVERIFIED", "workScope.catalog"); };
function object(raw: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key) || !descriptors[key]!.enumerable || !Object.prototype.hasOwnProperty.call(descriptors[key], "value"))) return fail();
  return Object.fromEntries(expected.map(key => [key, descriptors[key]!.value]));
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || raw.length > 128 || Object.getPrototypeOf(raw) !== Array.prototype) return fail();
  const own = Object.getOwnPropertyDescriptors(raw); if (Reflect.ownKeys(own).length !== raw.length + 1) return fail();
  return Array.from({ length: raw.length }, (_, i) => { const row = own[String(i)]; if (!row?.enumerable || !Object.prototype.hasOwnProperty.call(row, "value")) return fail(); return row.value; });
}
const label = (value: unknown, max = 160): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const key = (ref: AgentExecutionBoundary["tools"]["allow"][number]) => JSON.stringify([ref.toolId, ref.connectorId, ref.catalogRevision]);
// C2's currently supported local controlled surface. Native, connectors, exec and delegation stay closed.
const controlledTools = new Set(["workspace_read", "workspace_write", "workspace_verify", "task_intake", "task_checkpoint", "todo_write", "ask_user"]);
export function parseWorkScopeEditCatalog(raw: unknown, policy: WorkScopePolicySnapshot): WorkScopeEditCatalog {
  const row = object(raw, ["context", "target", "resources", "tools", "limits"]), target = object(row.target, ["workspaceId", "generation", "agentId", "agentEpoch", "configRevision"]);
  if (!workScopeEqual(target, policy.target)) return fail();
  const syntax = parseAgentBoundaryDocument({ ...policy.duty, context: row.context }); assertAgentBoundaryContext(syntax, policy.context);
  const resources = array(row.resources).map(raw => {
    const item = object(raw, ["resourceId", "revision", "label", "path", "access"]), access = array(item.access);
    if (!label(item.resourceId) || !positive(item.revision) || !label(item.label) || item.path !== null && !label(item.path, 4096)
      || access.some(value => value !== "read" && value !== "write") || new Set(access).size !== access.length) return fail();
    const existing = policy.resources.find(ref => ref.resourceId === item.resourceId);
    if (existing && existing.revision !== item.revision) return fail();
    return Object.freeze({ resourceId: item.resourceId as string, revision: item.revision, label: item.label, path: item.path as string | null,
      access: Object.freeze(access) as readonly ("read" | "write")[] });
  });
  const tools = array(row.tools).map(raw => {
    const item = object(raw, ["ref", "label"]); if (!label(item.label)) return fail();
    const parsed = parseAgentBoundaryDocument({ ...policy.boundary, resources: [], tools: { allow: [item.ref], deny: [], readOnly: true } });
    if (parsed.kind !== "execution-boundary") return fail(); const ref = parsed.tools.allow[0]!;
    if (ref.connectorId !== null || !controlledTools.has(ref.toolId)) throw new AgentBoundaryContractError("RUNTIME_UNSUPPORTED", "workScope.catalogTool");
    return Object.freeze({ ref, label: item.label });
  });
  if (new Set(resources.map(value => value.resourceId)).size !== resources.length || new Set(tools.map(value => key(value.ref))).size !== tools.length) return fail();
  const limits = object(row.limits, ["budgetRef", "maxModelCalls", "maxToolEffects", "requiredApprovals", "requiredChecks"]);
  const parsed = parseAgentBoundaryDocument({ ...policy.boundary, resources: resources.map(value => ({ resourceId: value.resourceId, access: value.access })),
    tools: { allow: tools.map(value => value.ref), deny: [], readOnly: true }, budget: { budgetRef: limits.budgetRef, maxModelCalls: limits.maxModelCalls, maxToolEffects: limits.maxToolEffects },
    approvalRequired: limits.requiredApprovals, runtimeRequirements: limits.requiredChecks });
  if (parsed.kind !== "execution-boundary" || parsed.budget.budgetRef !== policy.boundary.budget.budgetRef) return fail();
  return Object.freeze({ resources: Object.freeze(resources), tools: Object.freeze(tools), limits: Object.freeze({ ...parsed.budget,
    requiredApprovals: parsed.approvalRequired, requiredChecks: parsed.runtimeRequirements }) });
}
export function assertWorkScopeCatalog(proposal: WorkScopeProposal, catalog: WorkScopeEditCatalog): void {
  const value = proposal.boundary, limits = catalog.limits;
  if (value.budget.budgetRef !== limits.budgetRef || value.budget.maxModelCalls > limits.maxModelCalls || value.budget.maxToolEffects > limits.maxToolEffects
    || limits.requiredApprovals.some(item => !value.approvalRequired.includes(item)) || limits.requiredChecks.some(item => !value.runtimeRequirements.includes(item)))
    throw new AgentBoundaryContractError("AUTHORIZATION_DENIED", "workScope.catalogLimit");
  for (const ref of value.resources) {
    const resource = catalog.resources.find(row => row.resourceId === ref.resourceId);
    if (!resource || ref.access.some(access => !resource.access.includes(access as "read" | "write"))) throw new AgentBoundaryContractError("AUTHORIZATION_DENIED", "workScope.catalogResource");
  }
  for (const ref of [...value.tools.allow, ...value.tools.deny]) if (!catalog.tools.some(row => key(row.ref) === key(ref)))
    throw new AgentBoundaryContractError("AUTHORIZATION_DENIED", "workScope.catalogTool");
}
