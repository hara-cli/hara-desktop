import type { HaraClient, SessionInfo } from "./client";
import type { ComposerDraft } from "./composer-state";
import { latestAgentSession } from "./agent-session";

export const GUIDED_AGENT_CREATION_FEATURE = "agent.creation.v1";
export function supportsGuidedAgentCreation(
  client: Pick<HaraClient, "supports" | "supportsFeature"> | null,
): boolean {
  return Boolean(client?.supports("agents.create") && client.supportsFeature(GUIDED_AGENT_CREATION_FEATURE));
}

/** The caller supplies only sessions already scoped to the active Workspace. Never reuse a project,
 * gateway/automation run, or another colleague's chat as the main assistant's creation conversation. */
export function reusableAgentCreationConversation(
  sessions: readonly SessionInfo[],
  cwd: string,
  unavailable: (sessionId: string) => boolean,
  drafts: Readonly<Record<string, ComposerDraft>>,
): SessionInfo | undefined {
  const latest = latestAgentSession([...sessions], cwd, "main");
  const draft = latest ? drafts[latest.id] : undefined;
  return latest && !unavailable(latest.id) && (!draft || !draft.text && !draft.attachments.length)
    ? latest
    : undefined;
}

/** Preserve text and attachments typed while a conversation was being opened. */
export function agentCreationDraft(draft: ComposerDraft, prompt: string): ComposerDraft {
  return draft.text || draft.attachments.length ? draft : { ...draft, text: prompt };
}

export interface AgentCreationContext {
  engine: object | null;
  spaceId: string;
  spaceRevision: number;
  canCreate: boolean;
  switching: boolean;
}

/** Navigation + an editable draft only. No send, create-agent, approval or model invocation API is
 * exposed here. Runtime and creation consent remain with the trusted Host. */
export async function openGuidedAgentCreation(options: {
  context: () => AgentCreationContext;
  openMainConversation: () => Promise<string | null>;
  selected: (sessionId: string) => boolean;
  stageDraft: (sessionId: string, stillCurrent: () => boolean) => void;
  focusComposer: (stillCurrent: () => boolean) => void;
}): Promise<boolean> {
  const origin = Object.freeze({ ...options.context() });
  // Do not turn new product terminology into a grant while server-side Workspace isolation is
  // pending: legacy personal-only creation remains gated, including after asynchronous navigation.
  const eligible = (context: AgentCreationContext) => context.engine !== null
    && context.spaceId === "personal" && context.canCreate && !context.switching;
  if (!eligible(origin)) return false;
  const sameContext = () => {
    const current = options.context();
    return eligible(current) && current.engine === origin.engine
      && current.spaceId === origin.spaceId && current.spaceRevision === origin.spaceRevision;
  };
  const sessionId = await options.openMainConversation();
  if (!sessionId) return false;
  const stillCurrent = () => sameContext() && options.selected(sessionId);
  if (!stillCurrent()) return false;
  options.stageDraft(sessionId, stillCurrent);
  options.focusComposer(stillCurrent);
  return true;
}
