# Hara Desktop module dock

## Product decision

The far-left rail is a configurable **module dock**, not a fixed list of pages and not a list of
every skill inside every plugin.

- Chat, Projects, and Tasks are open-core modules.
- Settings, update recovery, and future safe-mode recovery stay fixed at the lower left.
- A plugin may contribute at most one primary dock entry. Its secondary views belong in that
  module's context sidebar or stage.
- Hiding a module removes only its dock entry. It does not delete sessions, tasks, files, or plugin
  data, and keyboard routes may still reach the module.
- Ordering and visibility are local user preferences, not organization policy.

This keeps the rail small enough to remain navigational when Hara later adds Groups, a public work
hall, calendars, and third-party capabilities.

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
  "order": ["core.chat", "core.projects", "core.tasks"],
  "hidden": []
}
```

IDs are stable and owner-scoped. Removed or unknown plugin IDs are ignored, and newly introduced
contributions are appended in default order. If every work module is hidden, startup falls back to
Settings.

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

## Planned first closed-source module

The future Groups / Work Network experience can be a first-party closed plugin while Desktop and its
core modules remain open. It should contribute one primary **Groups** entry, then own:

- public communities and channels;
- organization-private channels under the active organization;
- task assignment and agent/human handoff inside a channel;
- a distinct public task hall for claimable work.

Rooms, membership, messages, tasks, and task claims must be first-class server domains. They should
not be encoded as special chat messages. The hosted NestJS/PostgreSQL/Redis service may remain private;
the client-facing protocol, permission semantics, export rules, and compatibility contract should be
documented publicly enough for the open Desktop client to interoperate safely.
