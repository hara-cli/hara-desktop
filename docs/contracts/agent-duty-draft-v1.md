# Public duty draft browser mirror

`src/agent-duty-draft.ts` is the shared data entry point for C5 and onboarding. It re-exports `AgentDutyPublicProfile`, `AgentDutyDraft`, `parseAgentDutyPublicProfile`, `createAgentDutyDraft`, `parseAgentDutyDraft` and `agentDutyDraftProposal`. The field type is exactly C0 `AgentDutyProfile["publicProfile"]`: title, description, owns and rejects. Editors keep those fields; display reads the same parsed profile. There is no second DTO or persona-to-duty conversion.

The draft has exactly schemaVersion=1, kind=duty-draft, status=unconfirmed and publicProfile. It is frozen, and never includes context, a grant, runnable state or authority. `status:"confirmed"` and extra top-level keys are rejected; see the JSON fixtures. `agentDutyDraftProposal` only parses a syntactic C0 duty for an explicit context/agent/revision. Activation still requires trusted Host C1/C3 duty.update. A successful parse, draft, stored card or proposal grants nothing.

## Mechanical source and checks

The lock pins the already merged Core C6 source at d7a2b3f, its pure deepFreeze function, the unchanged C0 mirror and shared positive/negative fixtures. The source snapshots are validation inputs, never browser imports. The generator allows only the C0 import path substitution and replacement of the local-state import with that exact non-exported pure function. Every other source difference fails the check. Hashes normalize CRLF to LF for checkout portability; no content normalization is applied to public data.

```sh
node scripts/sync-agent-duty-draft.mjs --check
node scripts/sync-agent-duty-draft.mjs --check --core-repository /path/to/hara
node scripts/sync-agent-duty-draft.mjs --write
```

The optional Core check uses git show at the frozen commit, not a changing working file. `--write` restores only the locked mechanical mirror; upgrading canonical input requires an explicit reviewed lock/snapshot change. Existing C0 source, fixture and lock remain unchanged.

```ts
import { createAgentDutyDraft, parseAgentDutyDraft, type AgentDutyPublicProfile } from "./agent-duty-draft";
const fields: AgentDutyPublicProfile = { title: "Finance", description: "Review invoices", owns: ["invoice"], rejects: ["publish"] };
const draft = createAgentDutyDraft(fields);
const displayFields = parseAgentDutyDraft(draft).publicProfile;
```

This slice provides no UI entry, RPC, persistence migration, confirmation control or production bootstrap. It does not register onboarding step 3 or change ONBOARDING_STEPS_READY. Consumers use their own actual onboarding/Host gates. C5 cards, C3 writes and the three-language UI remain separate reviewed slices.
