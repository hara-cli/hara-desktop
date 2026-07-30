# Hara Desktop module dock

## Product decision

The far-left rail is a configurable **module dock**, not a fixed list of pages and not a list of
every skill inside every plugin.

- Chat, Projects, Tasks, and the local Groups shell are open-core modules.
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

Its current page is a local-only architecture preview. Rendering it performs no Account or Collab
request, starts no polling or worker, and creates no collaboration state directory. A future
`collab.login` / enable action must remain separate and explicit; `collab.logout` is required before
that connected capability ships.

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
