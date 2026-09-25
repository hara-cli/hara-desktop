# Hara Desktop Feature Requests

## [FEAT-20260921-CHAT-IM] conversation-first-desktop-and-persistent-agent-groups

**Logged**: 2026-09-21T12:00:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Requested Capability

Make Hara Desktop feel like a fluent chat product: one persistent contact per Agent, long-lived user/Agent
group chats, a stable streaming timeline, a compact composer, and a single `+ New` menu for starting a chat,
creating a group, or creating an Agent. Move Session, workspace, model routing, permissions, reasoning effort,
tool output, and terminal detail behind the conversation rather than exposing them as primary navigation.

Agents should also be able to search and compare Talent Market candidates and, within explicit personal or
organization policy, propose or perform Agent creation/hiring with budget, authority, provenance, workspace,
and model-route audit records.

### User Context

The current Desktop exposes a global `New task` button whose actual behavior is a new Session segment, a large
single-Personal-Space switcher, and model/provider/permission/reasoning controls below every conversation.
Streaming transcript changes also repeatedly trigger smooth auto-scroll, making the interface feel jumpy.

On 2026-09-24 the user clarified the expected Agent history model: selecting an Agent should feel like opening
one durable chat with complete, pageable history. Expert review confirmed that this must be one visible
Conversation rather than one permanent runtime Session; task runs, workspace changes, model changes,
compaction, recovery, and parallel work remain separate hidden Session segments projected into that timeline.
Legacy Sessions should first appear as explicit historical execution segments so forked or transferred
history is not silently duplicated.

### Complexity Estimate

complex

### Suggested Implementation

First fix follow-scroll so it tracks only the active conversation, follows only while the reader is near the
bottom, batches streaming deltas, and offers a new-message jump control after manual scrolling. Then introduce
a stable Message/Event projection with sender, timestamps, status, mentions, reply links, and TaskRun binding.
Use global model connection and policy as defaults; expose per-conversation overrides only on demand and apply
route changes by creating a new execution segment. Keep the existing Session-scoped Agent Room as `TaskRoom`,
and add a Space-scoped Conversation/Participant/ReadCursor store for durable private and group chats.

### Metadata

- Frequency: recurring
- Last-Seen: 2026-09-24
- Related Features: Agent inbox, ConversationTimeline, Talent Market, Agent Room, model connections
- Source: direct user feedback

---

## [FEAT-20260901-001] live-external-coding-session-bridge

**Logged**: 2026-09-01T00:30:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: backend

### Requested Capability

Let a user select a locally active Codex or Claude Code session inside Hara, send it a message or task,
observe streamed execution, answer approvals, and receive the result without presenting the workflow as a
session takeover. The same routing surface should later accept authenticated WeChat or Feishu messages.

### User Context

Hara should be a unified collaboration switchboard for coding agents: the original provider client remains
usable while Hara supplies discovery, messaging, task delegation, progress, and safe channel routing.

### Complexity Estimate

complex

### Suggested Implementation

Extend the provider-neutral external-session protocol with runtime status, active-turn steering, ordered
events, and a single-writer control lease. Codex should use App Server `thread/list`, `thread/loaded/list`,
`turn/start`, and `turn/steer`; Claude support must capability-detect what its official SDK can safely resume
or control. Degrade unavailable live attachment to read-only or explicit safe continuation.

### Metadata

- Frequency: recurring
- Related Features: external.sessions.interaction.v1, external session center, gateway routing

---

## [FEAT-20260905-EXTERNAL-TERMINAL-ADAPTERS] provider-neutral-external-terminal-launch

**Logged**: 2026-09-05T10:13:35+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Requested Capability

Open the same Hara Live PTY in the operating-system terminal or a supported installed terminal such as Warp,
iTerm2, WezTerm, or Ghostty without making any single third-party application mandatory.

### User Context

A vendor-named action is confusing when the app is not installed. Users should always be able to use the
built-in Hara Terminal, and an external option should appear only when Hara can launch it safely and explain
which adapter will be used.

### Complexity Estimate

complex

### Suggested Implementation

Introduce a versioned external-terminal capability list and an opaque Engine-side launch method. Prefer an
automatic/system adapter, expose an explicit selector only when multiple tested adapters are available, retain
one Herdr PTY and one control lease, and remove or hide the external action on unsupported platforms. Do not
accept executable paths or shell command strings from the renderer.

### Metadata

- Frequency: recurring
- Related Features: Hara Terminal, terminal-stream.v2, external terminal handoff

---

## [FEAT-20260905-PHYSICAL-TERMINAL-KEYBOARD] direct-physical-keyboard-input

**Logged**: 2026-09-05T10:13:35+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Requested Capability

When Hara Terminal shows local control, clicking anywhere in the terminal should focus its input surface and
physical keyboard typing, IME, paste, navigation keys, Enter, and Ctrl+C should reach the existing PTY.

### User Context

The shortcut strip is an auxiliary control surface, not the primary input method. A desktop terminal that only
responds to on-screen shortcut buttons appears broken and is unusable for normal coding work.

### Complexity Estimate

medium

### Suggested Implementation

Make the terminal canvas an explicit focus target, restore xterm's hidden textarea focus after attach, layout
changes, canvas pointer interaction, and soft-key clicks, add a visible focus state, and lock the behavior with
a browser-level keyboard regression in addition to source assertions.

### Metadata

- Frequency: first_time
- Related Features: Hara Terminal, xterm.js, terminal raw input

---

## [FEAT-20260904-001] dockable-hara-live-terminal

**Logged**: 2026-09-04T09:34:00+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Requested Capability

Move the Hara Live provider-native terminal out of the bottom of the main page into an expandable,
collapsible work screen that can use the right side of the Desktop window.

### User Context

An interactive coding terminal is a persistent working surface. Embedding it below session content creates
nested vertical scrolling and leaves too little room for long commands, approvals, and output.

### Complexity Estimate

medium

### Suggested Implementation

Reuse the existing `ExtensionDock` shell for width dragging, collapse, focus/fullscreen, and keyboard resize,
but keep a dedicated external-session owner and `ExternalNativeTerminalSurface` data model. Use a right-side
split above 1120px, an overlay/fixed split at intermediate widths, and a full-stage terminal below 760px.
Auto-open once for a newly waiting prompt without overriding a user's later manual collapse.

### Metadata

- Frequency: first_time
- Related Features: Hara Live terminal mirror, ExtensionDock, external session center

---

## [FEAT-20260911-001068] session-scoped-signed-in-browser

**Logged**: 2026-09-11T05:22:17+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Requested Capability

Let a direct Hara Desktop session operate an already signed-in Chrome context without asking the person to
copy browser storage or session credentials into chat. Connection must require an explicit human grant for
the named task and target origins, remain unable to inspect unrelated tabs/origins, and disconnect at the
session boundary with a credential-free action audit.

### User Context

HARA-FB-001068 reports that authenticated SaaS work repeatedly paused when Desktop 0.1.144 / Engine 0.165.3
had no browser context and tried to transfer a browser token through chat. Desktop 0.1.159 / Engine 0.172.0
now provide governed native screen control and an isolated structured browser, while the expert
`bundled:chrome` route still explicitly lacks hard per-origin isolation and a per-session connection lease.

### Complexity Estimate

complex

### Suggested Implementation

Design a Serve-owned browser lease keyed to the exact interactive session and approved origin set. Enforce the
origin boundary before and after every browser action, filter page/network discovery so unrelated tabs and
credentials never enter model or transcript state, persist only redacted origin/action receipts, reject
gateway/cron use, and tear down the MCP/browser connection when the lease or owning session ends. Expose a
Desktop consent surface only after these engine invariants are covered end to end; do not relabel the current
global `bundled:chrome` plugin as equivalent.

### Metadata

- Frequency: recurring
- Related Features: Computer Use, structured browser, `bundled:chrome`, MCP connection lifecycle
- Source: Feishu HARA-FB-001068

---

## [FEAT-20260911-001114] brokered-feishu-credential-settings

**Logged**: 2026-09-11T06:30:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: backend

### Requested Capability

Let a person enter or replace Feishu App credentials through a masked Hara Desktop Settings surface. The
authenticated local Engine must save them in owner-only private state, return only configured/not-configured
metadata, and automatically use the stored credential for Feishu gateway and scheduled-result delivery
without putting the value in chat, shell history, process arguments, project files, or model context.

### User Context

HARA-FB-001114 reported that an automation could generate its script and schedule but then instructed the
person to create an env file with a credential-bearing `echo` command. CLI 0.168.1 / Desktop 0.1.153 block
that disclosure pattern, retain headless questions, and require verified completion, but the current
Desktop 0.1.159 UI still says to configure Feishu credentials in the gateway launch environment. The requested
Settings-to-private-store-to-broker path has therefore not been delivered by the historical safety fix.

### Complexity Estimate

complex

### Suggested Implementation

Add a versioned Engine-owned connector-credential store with no-follow, hard-link, compare-and-swap, owner-only
file protections and environment credentials as an explicit whole-record override. Add capability-negotiated
Serve methods for Feishu save/replace/remove that never return a secret, clear renderer input immediately after
each request, and make gateway/cron/channel-message resolve the stored record inside the Engine. Keep arbitrary
scripts and the model unable to read or inject raw credentials; use brokered Feishu delivery rather than a
general-purpose secret-extraction tool. A later platform Keychain/Credential Manager migration can replace the
storage backend without changing the secretRef-style protocol.

### Metadata

- Frequency: recurring
- Related Features: Chat bot settings, Feishu gateway, Automation delivery, private Hara state
- Source: Feishu HARA-FB-001114

---
