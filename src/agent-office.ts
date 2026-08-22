import type {
  AgentInfo,
  AgentOfficeInfo,
  SessionInfo,
  WorkforceActor,
  WorkforceActorState,
  WorkforceCapability,
  WorkforceStateEvent,
} from "./client";

export type OfficeActorState = WorkforceActorState | "idle";
export type OfficeActorKind = WorkforceActor["kind"] | "resident";

export interface OfficeActor extends Omit<WorkforceActor, "kind" | "state"> {
  kind: OfficeActorKind;
  state: OfficeActorState;
  agentRef?: string;
  description?: string;
  identity?: AgentInfo["identity"];
  resident?: boolean;
}

export const mainAgentRef = (agentRef?: string): string => agentRef || "main";

export function latestAgentSession(
  sessions: SessionInfo[],
  cwd: string,
  agentRef: string,
): SessionInfo | undefined {
  const persistedRef = agentRef === "main" ? undefined : agentRef;
  return sessions
    .filter((session) => (
      session.source !== "gateway"
      && session.source !== "cron"
      && session.cwd === cwd
      && session.agentRef === persistedRef
      && !session.archived
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function agentCapability(agent: AgentInfo): WorkforceCapability {
  if (agent.scope === "main") return "orchestration";
  const text = `${agent.name} ${agent.description}`.toLowerCase();
  if (/\b(?:design|ui|ux|visual|brand|creative)\b|设计|视觉|品牌/.test(text)) return "design";
  if (/\b(?:research|search|analyst|insight)\b|研究|调研|分析/.test(text)) return "research";
  if (/\b(?:write|writer|editor|content|copy)\b|文案|写作|编辑/.test(text)) return "files";
  if (/\b(?:sales|support|community|communication|communicator|feishu)\b|飞书|销售|客服|沟通/.test(text)) return "communication";
  if (/\b(?:office|document|sheet|slide)\b|行政|办公|表格|演示/.test(text)) return "office";
  if (/\b(?:browser|web|seo|growth)\b|网页|浏览器|增长/.test(text)) return "browser";
  if (/\b(?:code|coder|coding|engineer|engineering|developer|development|architect|review|reviewer|test|testing)\b|开发|工程|架构|测试|审查/.test(text)) return "code";
  return "other";
}

const RESIDENT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const OFFICE_ACTOR_LIMIT = 24;
const RESIDENT_LIMIT = OFFICE_ACTOR_LIMIT;

function residentActor(office: AgentOfficeInfo, agent: AgentInfo): OfficeActor {
  return {
    actorId: `resident:${office.id}:${agent.ref}`,
    kind: "resident",
    role: agent.name,
    capability: agentCapability(agent),
    state: "idle",
    activity: "idle",
    startedAt: RESIDENT_TIMESTAMP,
    updatedAt: RESIDENT_TIMESTAMP,
    agentRef: agent.ref,
    description: agent.description,
    identity: agent.identity,
    resident: true,
  };
}

/** Merge the persistent staff roster with real runtime lifecycle events. Residents are explicitly idle;
 * only Serve-emitted actors may appear as working. This keeps the game-like office honest. */
export function officeActors(input: {
  office: AgentOfficeInfo;
  agents: AgentInfo[];
  snapshot?: WorkforceStateEvent;
  sessionCwd?: string;
  sessionAgentRef?: string;
}): OfficeActor[] {
  const byRef = new Map(input.agents.map((agent) => [agent.ref, agent]));
  const residents = input.office.agentRefs
    .map((ref) => byRef.get(ref))
    .filter((agent): agent is AgentInfo => Boolean(agent))
    .slice(0, RESIDENT_LIMIT)
    .map((agent) => residentActor(input.office, agent));
  if (input.office.cwd !== input.sessionCwd || !input.snapshot) return residents;

  const activeRef = mainAgentRef(input.sessionAgentRef);
  const runtime = input.snapshot.actors.map((actor): OfficeActor => ({ ...actor }));
  const root = runtime.find((actor) => actor.kind === "root");
  if (root) {
    const residentIndex = residents.findIndex((actor) => actor.agentRef === activeRef);
    const agent = byRef.get(activeRef);
    const activeActor: OfficeActor = {
      ...root,
      actorId: residentIndex >= 0 ? residents[residentIndex].actorId : root.actorId,
      role: agent?.name ?? root.role,
      capability: agent ? agentCapability(agent) : root.capability,
      agentRef: activeRef,
      description: agent?.description,
      identity: agent?.identity,
      resident: true,
    };
    if (residentIndex >= 0) residents.splice(residentIndex, 1);
    residents.unshift(activeActor);
  }
  const collaborators = runtime
    .filter((actor) => actor.kind !== "root")
    .slice(0, OFFICE_ACTOR_LIMIT - 1);
  const residentBudget = OFFICE_ACTOR_LIMIT - collaborators.length;
  return [...residents.slice(0, residentBudget), ...collaborators];
}
