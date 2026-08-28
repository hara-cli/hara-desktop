# Hara External Session Runtime

Status: P0–P2 implemented for Desktop 0.1.115 with bundled Hara CLI 0.155.0; P3–P5 remain planned.

This design lets Hara discover Codex and Claude Code sessions without turning Desktop into a second
provider-owned terminal or weakening Personal/company boundaries. It also defines how Hara can later expose
the same safe surface to a phone.

## References reviewed

- Herdr, revision `7b675f42af35508eab66ac42fe1598628597a893`, Apache-2.0.
- Gas Town (`herdr/gastown`), revision `649b832b7672bc7a2dbef26f5983aba6198b819b`, MIT.
- OpenAI Codex App Server official protocol.
- Anthropic Claude Agent SDK official session APIs.

Hara does not copy either project's UI, mascot vocabulary, or storage stack. The useful architectural
principles are translated into Hara's existing Space, Session, Agent, Task, Workforce, and authenticated
Serve protocol.

## What Hara borrows

| Reference idea | Hara translation |
| --- | --- |
| Herdr: runtime/server owns shared facts | `hara serve` owns external discovery, opaque identity mapping, state, cursors, and future control leases. Renderer and mobile are projections. |
| Herdr: semantic state is separate from pane presentation | `ExternalSession.state` is provider-neutral; source logo, label, color, office location, and nickname remain presentation metadata. |
| Herdr: snapshot plus ordered event stream | Lists and transcripts are bounded snapshots; Hara-owned continuation streams typed text, tool, notice, approval, and terminal events. Reconnectable sequence/epoch transport remains a later remote-runtime phase. |
| Herdr: one lifecycle authority | Codex status comes only from App Server. Claude status will come only from the official Agent SDK. Screen scraping never competes with official state. |
| Herdr: native session references support resume | Native references stay in Core. Desktop receives an opaque Hara ID and never a provider-native ID. |
| Gas Town: persistent identity, ephemeral execution | Agent identity, provider session, and individual task/run are separate records. A named Agent can own many sessions and every session can contain many runs. |
| Gas Town: work bundle differs from worker swarm | Hara Mission/Task is the durable work package; Workforce actors are transient executors. The 2D office visualizes the latter without becoming the source of truth. |
| Gas Town: chronological activity and problem views | Structured task/workforce events can power Activity and Attention views. No LLM polling is required to decide whether work is stalled. |
| Gas Town: mail versus nudge | Durable handoff details are recorded in Task/Activity; wake-up is a separate event. A notification is never treated as the task record. |
| Gas Town: escalation acknowledgement and closure | An escalation has owner, severity, acknowledgement, resolution, and stale re-escalation. This matches Hara's feedback acknowledgement/closure convention. |
| Gas Town: provider integration tiers | Every adapter declares capabilities. Missing optional APIs degrade to metadata-only or unavailable instead of inventing behavior. |
| Gas Town: capacity, backpressure, circuit breaker | Later orchestration limits concurrent starts and pauses repeatedly failing work without an always-on token-consuming supervisor. |

## What Hara deliberately does not borrow

- tmux, terminal panes, Git worktrees, Dolt, or a merge queue as Desktop's primary data model;
- Mayor/Polecat/Convoy or other mascot terminology in the product contract;
- screen scraping when an official provider protocol exists;
- raw prompt, transcript, reasoning, tool argument, environment, or credential telemetry;
- automatic takeover of a provider session already controlled by another process;
- a background LLM patrol that consumes tokens merely to infer status;
- game animation as authoritative work state.

## Product model

```text
Persistent Agent identity
  └─ Provider session (Codex / Claude Code / Hara)
       └─ Task or Mission
            └─ Run
                 └─ Workforce actors and structured activity events
```

The game-like office is one view over this model. A user can switch office/department, select an Agent, and
open conversation history, but changing a sprite or room never mutates execution state.

## Runtime architecture

```text
Desktop / future mobile
        │ authenticated Hara protocol
        ▼
hara serve
  └─ ExternalSessionRegistry
       ├─ CodexAppServerAdapter       official App Server: list/read/fork/turn/interrupt/approval
       ├─ ClaudeAgentSdkAdapter       official Agent SDK: list/read/fork/query/interrupt/approval
       └─ HerdrSocketAdapter          optional terminal-runtime bridge, planned
```

Rules:

1. Provider APIs run only in Core. Renderer and mobile never read provider files or spawn provider CLIs.
2. Local external sessions belong to Personal by default. Selecting a company does not move or reveal them.
3. Company publication is a future explicit, revocable, audited grant per session.
4. Core emits only Hara-owned, device-stable keyed opaque IDs, directory basenames, bounded titles, semantic status, source,
   and timestamps. The key is owner-only local state and is never synchronized or returned by Serve.
5. Full paths, native IDs, provider cursors, credentials, reasoning, raw tool arguments, environment variables,
   and raw SDK objects do not cross Serve. Transcript text crosses only after an explicit read of a selected session.
6. Positive command discovery accepts only absolute existing executables from bounded system/user runtime
   locations; PATH entries cannot execute a project-local lookalike. The verified install directory is
   prepended only in the scrubbed child environment so NVM/FNM shebangs can find their paired runtime even
   when Desktop inherited a minimal GUI `PATH`.

## Provider capability tiers

| Tier | Capability | Current Hara behavior |
| --- | --- | --- |
| 0 | CLI installed only | Show source health; do not parse terminal UI or private transcript files. |
| 1 | Official metadata API | List sanitized Codex and Claude Code sessions. |
| 2 | Official read/fork/resume API | Explicit transcript read and fork-first continuation with approvals and interrupt. Implemented for both providers. |
| 3 | Hara-owned live runtime | Durable ordered event replay, one remote control lease, idempotent reconnect, and mobile publication. Not yet exposed remotely. |

Claude Code uses the official Agent SDK's session APIs and always receives the already-verified local Claude
executable path, so Hara never substitutes a bundled provider runtime. The standalone/Desktop sidecar bundles
the small SDK client layer. The npm package declares it as an optional peer so ordinary CLI installs do not
silently download the SDK's approximately 206 MB platform executable; a Node-runtime CLI without that peer
degrades to `adapter_required` instead of advertising interaction it cannot provide.

## Local protocol

- `external.sources.list`
- `external.sessions.list`
- `external.sessions.read`
- `external.sessions.fork`
- `external.sessions.submit`
- `external.sessions.interrupt`
- capability: `external.sessions.metadata.v1`
- capability: `external.sessions.interaction.v1`

The Desktop loads a bounded page and offers explicit progressive pagination. Codex transcript reads use the
official `thread/turns/list` summary view for the newest 50 turns, so large command output never forces the
entire provider thread through Hara; older history is represented by a neutral truncation notice. Provider cursors are wrapped as
short-lived, one-use Hara cursors, so neither Desktop nor a future phone receives a native handle. Original
provider sessions open read-only. An explicit fork returns a new stable opaque id whose turns stream through
`external.event.*`; provider permission requests reuse Hara's authenticated approval reply path. The method
set is additive and feature-detected so an older Desktop/engine pair degrades safely.

## Continuation safety

The local writable phase uses these rules:

- read-only observation is the default;
- fork is the default continuation action;
- Hara never continues a provider-owned original; a write request against one is safety-forked in Core;
- at most one Hara-controlled turn runs for an opaque external session in one Serve process;
- provider permission requests become bounded Hara approval prompts; unknown permission shapes fail closed;
- provider exit fails or interrupts the turn and closes the process tree; Hara does not silently restart it;
- uncertainty always degrades to read-only.

Remote continuation still requires `commandId`, device/lease epoch, replay protection, and a durable snapshot
before it can be published to mobile. Those remote semantics are deliberately not implied by the local API.

## Account and mobile identity

macOS and mobile use the same Hara account `userId`; they do **not** share one device credential. Each install
creates its own `deviceId` and hardware-backed signing/encryption key, then joins the account through an
expiring one-time pairing challenge. Revoking a phone must not log out the Mac or rotate provider credentials.

Mobile connects to Hara, never directly to Codex or Claude. Desktop/Core establishes an outbound TLS channel
to an optional broker and explicitly publishes selected Hara-owned session projections to paired devices.
Provider credentials, native session IDs, full paths, device identity keys, and external-session digest keys
remain on the computer. A remote command carries account, device, published-resource, lease-epoch, command-id,
expiry, and signature; Core rejects replays, stale epochs, and ungranted resources. High-risk approvals can
require Desktop confirmation or device biometrics. Offline mobile shows encrypted cached state and never starts
work on the user's behalf.

Company membership is a separate authorization dimension: the same account can switch organizations, but a
Personal external session is not visible to a company until the user creates an explicit, revocable, audited
publication grant. Organization policy may forbid publication or require administrator approval.

## Delivery phases

1. P0 — sanitized metadata list, source health, search, Personal boundary. Implemented.
2. P1 — explicit read through official APIs, bounded schema mapping, no raw provider objects. Implemented.
3. P2 — local fork-first continuation, one-turn ownership, approval, interrupt, provider-exit handling. Implemented.
4. P3 — durable snapshot/delta replay, remote lease epoch, idempotent reconnect.
5. P4 — explicit phone publication, pairing, encrypted remote channel, audit.
6. P5 — company policy, sharing, revocation, retention, and administrator controls.

Release gates for every phase include Personal/company isolation, no native ID/path/credential leakage,
provider-upgrade degradation, bounded memory/time/output, duplicate-command prevention, and both light/dark
visual verification.
