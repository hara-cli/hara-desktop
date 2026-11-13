/// <reference lib="es2022.object" />
// Shared C5 / onboarding public data. Parsing and draft construction do not issue authority.
export { parseAgentDutyPublicProfile, createAgentDutyDraft, parseAgentDutyDraft, agentDutyDraftProposal,
  type AgentDutyPublicProfile, type AgentDutyDraft } from "./contracts/agent-duty-draft-v1.ts";
