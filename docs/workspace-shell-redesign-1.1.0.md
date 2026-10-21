# Main shell v1.4 implementation for the 1.1.0 redesign

This local branch starts at Desktop main `baceda3`. It ports Dora's approved
`main-1020/workspace-shell-114.css`, including all layout layers and palette E, and the exact canonical
`i18n-keys.mjs` entries. `workspace-theme.css` retains those layers with dark selectors
bound to the existing resolved `data-theme`. `workspace-local-dev.css` adapts the live
components, and `workspace-states.css` loads last. Neither optional `quiet-sec` nor
`ink-indicator` is enabled. Icons are `@heroicons/react` **2.2.0**, MIT licensed. No
Metronic source, assets or icons are used.

Jeff's 2026-10-20 10:48 decision makes palette E (oxblood) authoritative. The
v1.4 colour layer wins over historical values: light brand `#9b2c24`, dark brand
`#c03a33`, with their matching hover/pressed/soft/text variants. The selected
indicator is `#9b2c24` / `#f08e84`; the control/focus hairline is `#8c8579` /
`#716b62`. Neutral ramps, typography, layout, icons and i18n are unchanged.
`workspace-shell-113.css` and previous v1.3 screenshots are historical references;
114 is the current source of truth. Keyboard focus stays neutral.

The native integration stage prepares Desktop **1.1.0**, with exact Core
**1.0.2@4e507e7f1595e618527e5c95a1890ae9271615e7**. Approved native/settings/build
changes are ported from Desktop `d933cea`; release branches are not merged. This is
an unpublished local candidate, with identifier `com.nanhara.hara.redesign-candidate`.
It requires sibling private Workspace/Home roots and a marked synthetic legacy
source. Its discovery source stays private too. It cannot check/install public updates.
Developer ID signing is queued until the separate 1.0.3 release completes.

## Data and authority

- `workspace.snapshot` reads each colleague's current conversation without changing
  the selected colleague. Workspace, generation and selected-agent checks reject
  foreign responses; a partial read displays an incomplete-count notice.
- A single `buildWorkspaceShell` projection supplies the home tray, colleagues badge
  and tasks-tab badge. Pending approvals also appear in `conversationTimeline` and
  the live conversation. Expired/decided approvals and approvals on closed tasks
  are excluded. Every urgent approval precedes ordinary items and survives the
  nominal three-item limit.
- Home Approve opens the same colleague confirmation card. It does not submit a
  decision. Final confirmation uses the existing `workspace.approval.respond`
  method and original workspace/generation/card ID, with a shared in-flight fence.
  Core continues to decide authority and validity. No paid task is replayed.
- Settings retains the existing scoped connection, Runtime, skills and schedule
  recovery controls. Schedules and skills now open from Settings. Full-window Settings
  captures/restores the reading position in memory, fenced by Workspace generation,
  colleague and route. A reader already at the bottom follows new messages; a reader
  higher up stays at the same position.
- Sidebar expansion flags are the only new persisted workspace UI data, under
  `hara.sidebar.sections.<workspaceId>`. Message previews, activity and local unread
  observations stay in memory. Locale uses the existing `hara.locale` key.

## Baseline limitations

Core 1.0.2 supplies `workspace.tasks`: up to 256 recent records in the selected
Workspace. The shell combines these with current snapshots and deduplicates task IDs.
History supplies a colleague label but no agent ID, so historical rows remain read-only;
labels never become execution targets or approval authority. When the history read is
unavailable, current snapshots remain usable and the current-only note is shown.
Core still does not project message timestamps, server unread receipts or colleague
quotas. Unknown times are omitted, newly observed activity supplies local ordering,
and unknown quota displays only the colleague count.

Message grouping requires actual timestamps less than or equal to five minutes
apart. Untimed history stays ungrouped. Future snapshots may provide the optional
timestamp, unread and limit fields; they are presentation data, never authority.

The browser preview is a lazy third grid column, beside the live chat/composer.
Expansion preserves at least 340px for chat; narrow windows use a compact sidebar and
readable approval rows. Native expansion also invokes the existing bounded window-growth
command. Workspace/generation changes destroy the preview. The prior explicit loopback
HTTP(S), no-credentials and sandbox boundary is preserved. This does not implement the
future Chrome pairing/control product. Existing detailed connection/Runtime/skills/schedule
panels retain their baseline copy; new outer shell, Settings navigation and appearance/language
controls use all three locales. Legacy rollback surfaces keep their bilingual contract.

## Verification

Use the repository's exact Node version before invoking any script:

```bash
nvm use "$(cat .node-version)"
npm test
npm run build
npm run check:release
```

The browser gate mounts the real components with an in-memory synthetic RPC at a
DEV-only, loopback-only fixture. It never imports the fixture through the production
entry, invokes Tauri, connects to a model, reads `~/.hara`, or accesses Keychain.
The production-graph regression keeps it outside startup and build output.

In one terminal, from this worktree:

```bash
nvm use "$(cat .node-version)"
./node_modules/.bin/vite --host 127.0.0.1 --port 54991 --strictPort
```

In another terminal:

```bash
nvm use "$(cat .node-version)"
node scripts/workspace-shell-smoke.mjs http://127.0.0.1:54991/ "$EVIDENCE_DIR"
```

Stop that Vite instance after review. The browser gate owns and removes its own
temporary Chrome profile. It checks light/dark rendering, real text contrast,
700/900/1100/1280 widths, three locales, local language changes, independent
workspace expansion state, inert/keyboard behavior, reduced motion, approval
reachability and confirmation, drafts, IME, unread activity, source names, and
enabled/hover/pressed/disabled composer colors. These are component checks;
native Tauri, real Core integration and tester acceptance remain separate gates.

The optional `scripts/workspace-local-channels-core-smoke.mjs` takes three explicit
arguments: a built Core checkout, an empty mode-0700 subdirectory of the system
temporary directory, and the exact 40-character Core commit. This POSIX-only fixture
rejects linked, overlapping or non-private paths and verifies the checkout identity
before importing Core. No developer-specific checkout path is required.

## Packaged native acceptance

`scripts/workspace-native-smoke.mjs` is a fail-closed disabled entry. Packaged Core
1.0.2 has no synthetic credential adapter entry, so this command stops before any
filesystem changes, native launch or credential operation. Releasing a signing lane
does not enable it. Its retired workstation-specific driver and native helpers are
not distributed.

A private HOME does not isolate the macOS user Keychain search list or default.
Native test fixtures must not create, delete, configure or restore system Keychains.
The optional `workspace-synthetic-core-smoke.mjs` instead takes an explicit built
checkout of its pinned Core and an empty, owned mode-0700 temporary directory. It
uses the fixed in-memory synthetic adapter, forbids external network/tool processes,
and is an in-process host check, not packaged native acceptance.

Native screenshots and interaction receipts remain separate from component tests,
host tests and production credential acceptance. Record the exact Desktop/Core
source, isolated data roots and any failed checks. Rosetta on an ARM Mac does not
establish physical Intel acceptance.
