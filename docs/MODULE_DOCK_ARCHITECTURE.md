# Hara Desktop module dock

## Product decision

The far-left rail is a configurable **module dock**, not a fixed list of pages and not a list of
every skill inside every plugin.

- Chat, Projects, Tasks, and the Groups client are open-core modules.
- Groups is default-hidden. Showing its dock entry is not the same action as enabling remote
  collaboration.
- Settings, update recovery, and future safe-mode recovery stay fixed at the lower left.
- A plugin may contribute at most one primary dock entry. Its secondary views belong in that
  module's context sidebar or stage.
- Hiding a module removes only its dock entry. It does not delete sessions, tasks, files, or plugin
  data, and keyboard routes may still reach the module.
- Ordering and visibility are local user preferences, not organization policy.

This keeps the rail small enough to remain navigational when Hara later connects hosted Groups,
calendars, and third-party capabilities. A public work hall remains a later governed marketplace
phase rather than a navigation placeholder.

## Phase 1: open-core dock

Implemented in:

- `src/navigation.ts`: contribution IDs, defaults, preference parsing, ordering, visibility, and
  safe startup fallback.
- `src/AppRail.tsx`: presentational dock plus the fixed Settings entry.
- `src/ModuleDockSettings.tsx`: user-facing show/hide/order controls.
- `src/App.tsx`: routing, unread badges, and preference persistence.

Preferences use `hara.navigation.v1` in local storage:

```json
{
  "version": 1,
  "order": ["core.chat", "core.projects", "core.tasks", "core.groups"],
  "hidden": [],
  "shown": []
}
```

IDs are stable and owner-scoped. Removed or unknown plugin IDs are ignored, and newly introduced
contributions are appended in default order. If every work module is hidden, startup falls back to
Settings. `shown` is deliberately separate from `order`: reordering an existing module must never
make a newly installed default-hidden module appear.

`core.groups` contributes:

```json
{
  "id": "core.groups",
  "target": "groups",
  "source": "core",
  "icon": "groups",
  "defaultOrder": 40,
  "defaultVisible": false,
  "canHide": true
}
```

Older engines render a local-only architecture preview. Engines advertising
`collaboration.remote.v1` render the native, read-only organization Desk described below. Merely
showing the module, starting Desktop, or entering Groups performs no remote Desk request, starts no
polling or worker, and creates no collaboration state directory.

## Phase 1.5: native organization Desk

The first connected Groups slice is intentionally smaller than a general Discord/Matrix client:

- one existing organization profile may have one local Desk binding;
- the context sidebar lists all existing organization profiles and whether each has a Desk binding;
- selecting an organization in the sidebar changes only the Groups browsing context; it never changes
  the engine's active profile;
- **Use for new work** is the separate, explicit action that changes the default organization route;
- clicking **Read board** performs a bounded, explicit read for that exact profile;
- task detail stays pinned to `{profileId, taskId}` even if the user later changes the default
  organization;
- changing the default organization affects only new work. Existing conversations retain their
  persisted profile route;
- this phase is read-only. Posting, claiming, acknowledging, completing, cancelling, enrollment-key
  administration, token rotation, and owner actions remain in the managed web/CLI surface.

The renderer consumes three typed Serve methods:

```text
desk.connections.list {}
desk.snapshot { profileId, state? }
desk.task.get { profileId, taskId }
```

`desk.connections.list` is a redacted local inventory read. Only the latter two methods contact an
organization Desk, and both capture the caller-supplied `profileId` before starting any network work.
There is no active-profile lookup in flight.

Desk credentials are separate from Hara Control device tokens. They stay in the Serve process inside
the private `~/.hara/desk-connections.json` file and never enter renderer props, RPC responses, local
storage, logs, URLs, or error text. Each binding includes a fingerprint of the gateway enrollment
identity, so removing and re-enrolling a different company under the same profile ID cannot revive
the previous company's Desk token. Every registration also rotates a random, non-secret binding
revision exposed only in the redacted local inventory. Profile removal deletes the local binding. The
CLI sensitive-file policy blocks both stores from file reads and broad searches. The legacy MCP retains
its separate flat `~/.hara/desk.json`; it remains visible only as `legacyUnbound` until the user
explicitly registers a native profile connection, and neither writer can overwrite the other.

The transport accepts HTTPS origins only, except loopback HTTP for local development. It rejects URL
credentials, paths, query strings, fragments, cross-origin redirects, invalid task IDs, oversized
responses, and raw upstream error bodies. Returned arrays and strings are bounded before they cross
the authenticated loopback protocol. Unknown state, risk, role, and authorization enum values fail
closed instead of being downgraded. Board snapshots include only a short task excerpt; full task
content crosses the protocol only after an explicit task-detail read. In-memory board and task caches
are partitioned by organization enrollment identity plus the opaque Desk binding revision, ignore
stale async generations, and are removed when the corresponding organization disappears or an old
profile ID is reused for a new enrollment/binding.

The managed web surface remains necessary for account/OIDC login, enrollment, token administration,
write operations, audit recovery, and emergency access. Desktop does not iframe or WebView the
legacy Desk page because that page owns browser storage and streaming behavior that do not satisfy the
native renderer credential boundary.

## Phase 2: reviewed plugin surfaces

The current plugin manifest exposes skills, agents, MCP servers, hooks, binaries, command-launched
panels, and project panels. Those panels are not yet safe primary navigation surfaces.

Before a plugin can add a dock entry, Panel v2 must define and enforce:

1. a stable contribution ID such as `plugin.<plugin-id>.<surface-id>`;
2. one declared icon from a reviewed icon set;
3. an isolated origin and strict CSP;
4. short-lived scoped tokens rather than renderer access to Hara credentials;
5. explicit capabilities for files, network, notifications, clipboard, and task dispatch;
6. lifecycle rules for start, suspend, update, disable, uninstall, and crash recovery;
7. unread/badge semantics that follow Hara's interruption-versus-ambient notification rule;
8. a fallback route when a plugin is disabled, missing, incompatible, or removed.

Until that contract exists, command panels continue opening inside Projects and Settings only manages
their enabled state. The UI must not imply that arbitrary installed plugins already have trusted
first-class navigation.

## Planned hosted Groups provider

The open Desktop owns the stable Groups navigation and disabled-state shell. A future first-party
hosted provider may remain private while implementing the connected data and policy layer behind
that public client contract. It should fill the existing **Groups** entry rather than adding a
second competing dock icon, then own:

- public communities and channels;
- organization-private channels under the active organization;
- task assignment and agent/human handoff inside a channel;

Rooms, membership, messages, and internal tasks must be first-class server domains. They should
not be encoded as special chat messages. The hosted NestJS/PostgreSQL/Redis service may remain private;
the client-facing protocol, permission semantics, export rules, and compatibility contract should be
documented publicly enough for the open Desktop client to interoperate safely.

A public task hall is deferred until identity, reputation, moderation, task lifecycle, settlement,
disputes, prompt-injection boundaries, and local OS capability approvals have dedicated contracts.
