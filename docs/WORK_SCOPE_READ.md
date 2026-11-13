# Work scope: read-only Desktop consumer

The Resources tab can show four sections from the current Core C1 policy: duties, exclusions, tools/directories and operations requiring approval. Duties reuse `agent-duty-draft.ts` / C0 `AgentDutyProfile.publicProfile`. Saving or displaying these fields grants no permission. This slice issues no command and adds no editor, native bootstrap or production binding.

## Trusted composition port

`createWorkspaceWorkScopeSource(bridge)` validates read responses and returns a branded consumer; **it does not authenticate its caller**. Only the platform composition root may bind a source to its `WorkspaceDevModel`. There is deliberately no application call site for `bindWorkspaceWorkScopeSource` yet. C12 must separately review and supply a bridge authenticated by the real Host, including a synchronous observed connection fence and change notifications. Never bind from a request body, advertised capability alone, JSON approval, an unconditional callback or model-generated data.

The current generic Desktop RPC initialization does not carry the separate owner credential. A Core C1 capability advertisement alone therefore cannot enable the card. Ordinary transport tokens cannot read the policy. The browser smoke holds a synthetic owner credential only in its private Node fixture and tests the actual Core WS authentication; this fixture is not a production bootstrap.

Before any read the source captures workspace, generation, Agent/version, principal/node/local grant, provenance, physical connection and observed epoch. The Host must invalidate it synchronously on every known disconnect, revocation or identity change, before notifying consumers. Missing capability or trusted binding yields no card DOM and no boundary requests. The hook cancels pending transport work and excludes every late answer from the previous capture; the source also rechecks its fence after each await. Opaque browser capture objects are not command or execution credentials.

## Displayed data

The C1 policy and both embedded C0 documents must match the captured scope and Agent versions. `runtimeEnforced:false` remains false: the card says only that settings are saved; every action still needs independent current checks. A stale policy displays an unconfirmed state with no retained private profile. Malformed verified data displays a generic error without raw payloads or errors.

Directory IDs are opaque. Optional labels/paths must come from the same Host registry and exact current resource ID/revision; absent labels are described as unavailable, never inferred from an ID. Resource IDs and limits live in a collapsed Advanced section. No confirmation person/time is invented. Profile and label text is escaped by React. No data is cached in localStorage or a global snapshot.

The read source is independent from manage/invoke/privateRead/nodeUse. PR2 must gate and submit real C3 commands; it cannot reuse this read capture as an approval or grant. Missing write authority cannot hide otherwise authorized read-only metadata, and metadata visibility never implies an execution permit.

## Validation

`node --test test/work-scope-read.test.mjs` covers parsing, scope/connection fences, opaque captures, missing capabilities and late replies. Run `scripts/work-scope-browser-smoke.mjs --help` for the private browser / actual Core Host matrix. Standard `npm test` and `npm run build` remain required. All fixture workspace data, browser profile and evidence destinations must be explicitly task-owned; the script never opens a real user workspace or installs an application.
