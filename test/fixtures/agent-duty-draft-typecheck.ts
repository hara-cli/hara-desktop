import { createAgentDutyDraft, agentDutyDraftProposal, type AgentDutyDraft, type AgentDutyPublicProfile } from "../../src/agent-duty-draft.ts";
import type { AgentBoundaryContext } from "../../src/agent-boundary-contract.ts";
const profile: AgentDutyPublicProfile = { title: "Finance", description: "Review invoices", owns: ["invoice"], rejects: ["publish"] };
const draft: AgentDutyDraft = createAgentDutyDraft(profile);
// @ts-expect-error draft status is not authority or mutable state.
draft.status = "confirmed";
// @ts-expect-error public duty items are immutable.
draft.publicProfile.owns.push("all");
// @ts-expect-error no grant is part of the draft contract.
const grant: AgentDutyDraft = { ...draft, grant: { issued: true } };
// @ts-expect-error no tools/resources/rights are public duty fields.
const rights: AgentDutyPublicProfile = { ...profile, rights: { manage: true } };
declare const context: AgentBoundaryContext;
agentDutyDraftProposal(draft, context, "fixture-agent", 2);
// @ts-expect-error a syntactic proposal requires an explicit real context/agent/revision.
agentDutyDraftProposal(draft);
void grant; void rights;
