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

## Runtime profile setting foundation (2026-10-14)

The companion CLI candidate now provides trusted per-Agent Runtime configuration, frozen task binding
and exact host-driver dispatch. Desktop consumes that explicit projection rather than treating model
selection or coding-worker detection as a Runtime binding. Agent profile editing contains a folded
Runtime section using the existing warm-paper tokens; model/reasoning controls have their own label.
Runtime saves are separate from unsaved persona drafts and do not launch, stop, delete or migrate work.
The save handler checks both revisions, actual availability, duplicate clicks and late replies after
Agent/catalog changes. Older engines remain read-only for this setting; unavailable engines cannot be
selected, and organization bindings cannot be changed by Personal configuration.

Production still registers only the Hara compatibility driver. Pi is NOT yet the main/general Agent
runtime; Pi/OpenCode/Codex/Claude's existing coding-worker support is not advertised as that capability.
The creation flow and real Pi adapter remain unfinished. The server refuses unavailable selections,
so this UI is not a fake Pi dropdown that executes Hara. No sidecar lock, dependency, installer, updater
or version metadata was changed. Candidate build passed all 36 asset checks (existing large-chunk
warning remains); all 558 tests passed, including real-component SSR and executable callback checks.
Native/browser visual QA, packaged-app testing and publication are not claimed.

## Built-in Pi creation and isolated local dev increment (2026-10-14)

This supersedes the Hara-only candidate state above, not its historical receipts. The companion CLI
now registers a real Pi SDK bounded model-step Driver under the shared task/tool/approval/question,
cancellation/budget/history governor. Hiring uses the trusted Runtime catalog, recommends available
Pi, disables unavailable Drivers and rechecks before submission. Old engines receive no invented
field. Existing main/Agent preferences are not silently migrated, and coding-worker support does
not make Codex/Claude/OpenCode general-Agent Drivers. Main history stays Hara-authoritative.

Debug-only `HARA_DESKTOP_DEV_HOME` accepts an explicit private owned canonical home, rejects invalid
or real installed homes, clears the isolated Engine environment and is ignored by release builds.
`scripts/local-runtime-dev.mjs` launches a candidate Engine/native dev with a synthetic loopback model,
no copied real keys/history and explicitly Pi-bound main. This is not an installer/sidecar-lock update.
Native tests passed 53 with one existing ignored case. Cargo reported startup, but Computer Use did
not expose a separately selectable development identity. Native visual/focus QA remains unverified;
no installed app or private browser was used as a substitute.

## First redundancy-removal implementation (2026-10-14)

Jeff authorized implementation after the source audit. The directory opens Skills and exposes only
Skills/Extensions. Empty Market, duplicate organization/model/Desk status, duplicate Computer Use
shortcut and their renderer props/branches are removed. Computer Use remains in Safety settings
with its engine-owned policy and cancellation-safe navigation. Skills, plugin controls/work panels,
shortcut preferences and guided skill creation retain their contracts.

`SettingsNavigation` separates Work settings from App/device, preserving every route exactly once,
unread scoping, intent preloading and recovery. It does not claim new Workspace authority: membership,
storage partitioning and unified Workspace model connections remain open. The coding-worker preference
starts folded, explicitly differs from an Agent Runtime, and mounts its controller only on expansion;
closing disposes it, without resetting the preference.

New colleague creation opens the guarded custom form rather than requiring a talent-catalog visit.
Catalog suggestions remain optional/capability-gated. Browsing suspends the mounted custom form,
preserving its draft; hidden/inert onboarding cannot hire, dismiss or consume Escape. Blueprint
selection still requires explicit onboarding and grants no tools. Automatic model-ranked suggestions
and fully chat-first recruitment are not claimed by this increment.

The real-directory red tests failed 2/2 against the old source. Focused tests passed 27/27; the complete
Desktop suite passed **569/569**, zero fail/skip/cancel, after the authorized loopback gate. Source
production build and all **36** asset checks passed. Private logs:
`/private/tmp/hara-simplification-implementation.0xxAcE/{red,focused,build-complete,full-approved}.log`.
The first restricted full run retained 21 listen-EPERM failures and five moved-source contract checks;
tests now follow actual components without weakening policy/recovery assertions. No version, dependency,
user data, installed binary or release asset changed. Frontend skills guided existing-token reuse,
accessible grouping and conditional mounting without adding libraries.

## Main-assistant guided colleague creation (2026-10-15)

This supersedes the manual-first entry above, not its historical test receipts. New → Create a
colleague opens the main Hara conversation with an editable, unsent creation brief. An idle main chat
with no draft is reused; a running/read-only chat or existing text/attachments gets a fresh segment.
No model call, Agent creation or permission grant occurs on the navigation click. The prompt asks
for only missing requirements, previews the persona, requires the existing single-use approval card,
and respects the Host default Runtime. The persona-only `agent_create` schema is not extended by a
prompt; non-default Runtime selection remains in manual setup/profile editing.

The Host now advertises `agent.creation.v1` separately from manual `agents.create`. Older engines
show only the preserved manual setup action; they are not sent an unsupported guided workflow.
Late drafts/focus are invalidated after engine replacement, Workspace changes including A→B→A,
capability loss or navigation away. Functional draft updates preserve text and attachments typed
while opening. The existing personal audience gate stays closed for unverified new Workspaces.

Tests execute the actual menu actions and guidance controller with synthetic contexts, alongside
existing creation approval and Runtime dialog regressions. Focused **28/28**, complete Desktop
**581/581**, zero fail/skip/cancel; TypeScript/Vite production source build and **36** asset checks
passed. Private receipts: `/private/tmp/hara-chat-first-creation.TF4zcm/{focused-feature,full-committable,build-committable}.log`.
An initial fixture bundle omitted CSS/SVG loaders and was corrected to use the existing harness;
its failed log is retained separately. These are source/component checks, not native pixel/focus or
real-model recruitment acceptance. No dependencies, version, sidecar lock, installed app or private
user data changed. Frontend skills informed the compact existing-token menu and guarded event flow.

The user also authorized an existing research window to work in parallel. It owns the Account-only
Workspace membership contract in a separate worktree; this Desktop increment does not claim that
server slice, full shared channels or end-to-end Workspace isolation is already wired.
