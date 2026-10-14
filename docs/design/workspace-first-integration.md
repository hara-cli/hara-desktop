# Workspace-first: first production-source integration

2026-10-14. Jeff selected UIUX's `workspace` / Hara Daylight direction and authorized continued Hara
implementation. This is not approval of browser/keyboard QA, data migration, signing or publication.
The selected source snapshot remains `workspace-first-review-2026-10-14` in UIUX's Hara records.

## Implemented here

The actual `SpaceSwitcher` now presents peer Workspaces without separate Personal/Company product
sections or model-package names as workspace names. Even a solo Workspace retains its context entry.
The existing Hara warm paper/ink/accent tokens are reused, with 14px names, 13px supporting copy,
52px trigger and 60px choices. The menu is bounded by the viewport and scrolls for long directories.
There is no new font, runtime, network, animation dependency or browser persistence.

The selector uses an accessible menu of radio choices, arrow/Home/End navigation, disabled unavailable
routes, Escape return focus, outside-focus dismissal and document-listener cleanup. A missing active
directory entry never falls into the first entry. Route/lock/membership changes or an in-flight switch
immediately invalidate an old open menu. Selecting a choice calls only the existing `switchSpace`
workflow; renderer code does not choose credentials or authorize execution.

The root Hara remains pinned above colleague search results using its stable root role, not nickname.
Only the caller's already Space-filtered roster participates. No foreign coordinator is fetched or
synthesized. Existing portraits, public identity, history/details, drafts, approvals, interruption,
folded execution output and user-visible text filtering remain intact.

## Backend pairing

The companion CLI source restores each legacy Space's explicitly selected connection atomically.
It changes neither existing Session bindings nor Control policy. These Desktop changes remain
protocol-v1 compatible: there is no new RPC or false `workspace.v2` advertisement, and no native-host
or sidecar lock change in this candidate.

The UI does not expose New Workspace, synthetic membership, synthetic channels or copied keys.
The opt-in registry still requires authenticated membership and full storage/audience partitioning
before it can safely drive new execution Workspaces. Unified workspace-owned connection settings,
human/AI channels, Desk tasks/tickets and actual Runtime bindings remain follow-up work.

## Verification boundaries

`test/space-switcher-actions.test.mjs` executes the real component's handlers with synthetic hooks
and DOM nodes: exact selection, stale menu invalidation, lock/expiry, navigation, focus return and
cleanup. `test/conversation-workspace.test.mjs` bundles and SSR-renders actual components; it checks
the solo selector, absent-authority refusal, original root logo and normal chat actions.
`test/workbench-inbox.test.mjs` checks pinned root search without a global fallback. Existing
permission and place-isolation assertions remain required. Source build and the full Desktop suite
must pass; exact receipts are recorded in the workspace inbox.

These are not real browser/native focus-order, clipping, scroll or pixel tests. Actual visual and
keyboard QA at 390/860/1280/1440 remains unverified; the previously denied private-browser boundary
is preserved. No installed app, user credential/history, running task or release asset was replaced.

## Retiring the standalone runtime entry

Jeff clarified that "delete the old one" means closing the old entry, not deleting worktrees, Agent
identities, memory, native sessions or history. The Settings entry into the standalone coding center is
removed. The remaining exact-execution inspector defaults standalone creation off and the production
caller explicitly keeps it off, even when an older engine advertises creation. Its create handler also
refuses while disabled. Existing Agent execution links, transcript/resume and question/approval paths
remain available; opening or retiring an entry does not stop or delete a running session.

Verification: the new entry/handler regression first failed against the old source; the focused set
then passed 45/45, the complete Desktop suite passed 552/552, and the production build plus all 36 asset
checks passed. These are source/automated receipts, not installed-app, browser or release acceptance.

Each Agent binding one explicit Runtime, with the main Hara defaulting to built-in Pi, remains the
next backend slice. Current Agent profile execution metadata contains model/effort, not that binding;
the Pi coding worker is not the main governance loop. Do not add a selector that silently continues
on Hara, move old sessions, or change the global coding preference and claim the migration is done.
