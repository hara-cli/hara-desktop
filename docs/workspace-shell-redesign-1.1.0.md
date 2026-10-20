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

## Packaged native acceptance

`scripts/workspace-native-smoke.mjs` launches the exact candidate executable with
private HOME/Workspace/source roots. It checks parent PID, bundled Core hash, real
protocol, approval, delegation, file verification and cold recovery using a loopback
fake model. A throwaway Keychain belongs only to that private HOME; real default/search
metadata must remain unchanged. It never uses the signing/updater Keychain. Its exact
owned App/Core/Vault cleanup and optional UI-hold mode are separate from signing.
Compile the two adjacent `workspace-native-*.swift` helpers into the task evidence
parent directory. Native UI screenshots and interaction receipts remain distinct from
headless component screenshots and the Model/RPC six-step driver. Intel runs on this
Mini are recorded as Rosetta, never as physical Intel acceptance. Read the current
phase report in the workspace inbox before running a retained candidate.
