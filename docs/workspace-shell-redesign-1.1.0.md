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

The frontend version and sidecar locks remain the main baseline (`0.1.188` and
`0.187.1@d54f1b930ba58176b511bdecaaba5903d74521c9`). This is an implementation target,
not a prepared or published 1.1.0 release. Integrate the intervening approved releases
before making a release candidate.

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
  recovery controls. Schedules and skills now open from Settings.
- Sidebar expansion flags are the only new persisted workspace UI data, under
  `hara.sidebar.sections.<workspaceId>`. Message previews, activity and local unread
  observations stay in memory. Locale uses the existing `hara.locale` key.

## Baseline limitations

The locked Core has no full task-history endpoint and does not project message
timestamps, historical ordering, unread receipts or a colleague quota. The UI shows
current tasks only, omits unknown times, uses newly observed activity for ordering,
and counts new assistant messages observed locally. It does not label old messages
as unread. Unknown quota displays only the colleague count. The old Core's
`pastTaskCount` remains available in Settings; it is not expanded into invented rows.

Message grouping requires actual timestamps less than or equal to five minutes
apart. Untimed history stays ungrouped. Future snapshots may provide the optional
timestamp, unread and limit fields; they are presentation data, never authority.

Main also lacks the later Workspace browser implementation. The shell exposes an
optional `onOpenBrowser` callback and hides that button until an implementation is
provided. Synthetic screenshot fixtures inject a callback for design review;
browser functionality is not accepted by this branch. Merge and recheck the
intervening 1.0.2 work before enabling it. Existing connection/Runtime/skills/schedule
detail panels retain their baseline copy; new shell, boot and appearance/language
controls have all three locales. Native rollback leaves explicitly retain their
original bilingual `LegacyLocale` contract.

## Verification

Use the repository's exact Node version before invoking any script:

```bash
export PATH=/Users/zhujianbo/.nvm/versions/node/v22.23.1/bin:$PATH
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
export PATH=/Users/zhujianbo/.nvm/versions/node/v22.23.1/bin:$PATH
./node_modules/.bin/vite --host 127.0.0.1 --port 54991 --strictPort
```

In another terminal:

```bash
export PATH=/Users/zhujianbo/.nvm/versions/node/v22.23.1/bin:$PATH
node scripts/workspace-shell-smoke.mjs http://127.0.0.1:54991/ /private/tmp/hara-shell-review-evidence
```

Stop that Vite instance after review. The browser gate owns and removes its own
temporary Chrome profile. It checks light/dark rendering, real text contrast,
700/900/1100/1280 widths, three locales, local language changes, independent
workspace expansion state, inert/keyboard behavior, reduced motion, approval
reachability and confirmation, drafts, IME, unread activity, source names, and
enabled/hover/pressed/disabled composer colors. These are component checks;
native Tauri, real Core integration and tester acceptance remain separate gates.
