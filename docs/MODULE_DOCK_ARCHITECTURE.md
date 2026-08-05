# Hara Desktop module dock

## Product decision

The far-left rail is a configurable **module dock**, not a fixed list of pages and not a list of
every skill inside every plugin.

- Chat, Projects, Tasks, Groups, and Office are open-core modules and are visible by default.
- Office owns presentations, spreadsheets, documents, and local Artifact history. Projects owns
  local-folder conversations; the two no longer compete inside one sidebar.
- Settings, update recovery, and future safe-mode recovery stay fixed at the lower left.
- Enabled legacy plugin panels may be explicitly pinned as default-hidden shortcuts. They remain
  project-owned Extension Dock views, not independent modules.
- A future Panel v2 plugin may contribute at most one true primary dock entry. Its secondary views
  belong in that module's context sidebar or stage.
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

Enabled plugin panels are also converted into bounded, collision-safe `plugin.<owner>.<panel>`
contributions. They start in `shown: []`, so installing or enabling a plugin never adds an icon by
surprise. A person must choose **Settings → Sidebar modules → Show**. Clicking that shortcut does not
trust the descriptive plugin inventory: Desktop asks Serve for the panels applicable to the active
project and launches only the matching authoritative descriptor. With no project, a disabled plugin,
or mismatched detection markers, nothing starts. The Installed tab in **Capabilities** exposes the
same show/remove choice next to each enabled panel so people do not have to discover a second settings
page first.

Preferences use `hara.navigation.v1` in local storage:

```json
{
  "version": 1,
  "order": ["core.chat", "core.projects", "core.tasks", "core.groups", "core.office"],
  "hidden": [],
  "shown": []
}
```

IDs are stable and owner-scoped. Removed or unknown plugin IDs are ignored, and newly introduced
contributions are appended in default order. If every work module is hidden, startup falls back to
Settings. `shown` is deliberately separate from `order`: reordering an existing module must never
make a newly installed default-hidden module appear.

Groups and Office contribute:

```json
{
  "id": "core.groups",
  "target": "groups",
  "source": "core",
  "icon": "groups",
  "defaultOrder": 40,
  "defaultVisible": true,
  "canHide": true
}
```

```json
{
  "id": "core.office",
  "target": "office",
  "source": "core",
  "icon": "office",
  "defaultOrder": 50,
  "defaultVisible": true,
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
- selecting an organization in the sidebar is the organization switch. There is no second
  **Use for new work** setting;
- the switch changes the active model route and organization workspace as one context;
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

### One enrollment, separated credentials

The ordinary Desktop flow accepts one Hara Control origin and one one-time enrollment code. A
compatible Control may return:

```json
{
  "device_token": "<model gateway device token>",
  "desk": {
    "url": "https://desk.example.com",
    "agent_id": "<desk agent id>",
    "owner": "<organization identity>",
    "token": "<separate desk device token>"
  }
}
```

The CLI consumes the model token into the protected profile store and the Desk token into the
profile-pinned Desk store. Neither secret crosses the renderer protocol. If Control does not
advertise Desk, Desktop says that the organization has not provided it; it does not ask an ordinary
user to configure another key. The old `hara desk register` command remains a compatibility and
operator path, not the target Desktop setup flow.

## Capability directory

Settings separates four concepts instead of presenting one flat enable/disable list:

- **Hara**: included open-core surfaces; present without installation;
- **Organization**: resources provisioned by the currently active organization, such as its managed
  model route and Desk;
- **Market**: the explicit future catalog boundary. The current client shows an honest unavailable
  state until signed packages, permission review, revocation, and isolated Panel v2 are enforced;
- **Installed**: optional local plugins that a user installed and may enable or disable.

Installation/enablement and connector authorization remain distinct security states. An enabled
plugin is not presented as connected to organization data unless its connector has separately
received authorization. This follows the same source/installed separation used by the Codex plugin
directory while preserving Hara's renderer and Serve boundaries. The Tasks automation console,
Groups, Office, Artifact details, model/bot settings, Desktop companion settings, and the capability
directory are split from the initial Assistant bundle. Dock and Settings entries preload their
matching module on pointer hover or keyboard focus, keeping startup lean without making the first
intentional navigation feel delayed.

PPT, spreadsheet, and document Artifact views do not add more primary dock entries. Design and other
enabled local panels may be pinned as user-owned shortcuts, but their current surfaces still use the
context-owned Extension Dock described in
`docs/EXTENSION_DOCK_AND_HOSTED_DESK.md`, pinned to one project session or Artifact revision. Browser
continues in the system browser and organization Desk remains a native Groups surface; both are
future candidates for the same contextual model after their isolation and realm contracts exist.

## Phase 2: reviewed plugin surfaces

The current plugin manifest exposes skills, agents, MCP servers, hooks, binaries, command-launched
panels, and project panels. Those panels are not yet safe independent primary navigation surfaces.
Desktop therefore exposes only an explicit, default-hidden shortcut to the existing Projects-owned
launch path. The shortcut has no autonomous lifecycle, unread badge, organization access, or renderer
credential. It disappears when the plugin is disabled, and the launch is re-authorized against the
current project every time.

Before a plugin can add an independent dock module, Panel v2 must define and enforce:

1. a stable contribution ID such as `plugin.<plugin-id>.<surface-id>`;
2. one declared icon from a reviewed icon set;
3. an isolated origin and strict CSP;
4. short-lived scoped tokens rather than renderer access to Hara credentials;
5. explicit capabilities for files, network, notifications, clipboard, and task dispatch;
6. lifecycle rules for start, suspend, update, disable, uninstall, and crash recovery;
7. unread/badge semantics that follow Hara's interruption-versus-ambient notification rule;
8. a fallback route when a plugin is disabled, missing, incompatible, or removed.

Until that contract exists, command panels continue opening inside Projects. Settings or a user-pinned
dock shortcut may initiate a panel only after Serve confirms that its detection markers match the
remembered project; the resulting surface still belongs to that exact Project session. The UI must not
imply that arbitrary installed plugins already have trusted first-class navigation.

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
