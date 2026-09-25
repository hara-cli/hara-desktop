# Hara Desktop Learnings

## [LRN-20260825-AGENT-PORTRAIT-SILHOUETTES] correction

**Logged**: 2026-08-25T02:50:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Summary

Color, initials, and small accessories do not create enough identity; Hara Agents need recognizably
different faces, silhouettes, expressions, clothing, and occupational props.

### Details

The current procedural `AgentPortrait` makes market candidates feel like one template with palette
swaps. Generated character art must use one coherent Hara comic art direction while preserving strong
per-Agent identity, and the same stable character asset must appear in the market, profile, chat, and
office instead of being regenerated per surface.

### Suggested Action

Define a character art bible first, generate a reviewed portrait for every curated blueprint, store the
assets locally with immutable blueprint mapping, and keep a deterministic procedural fallback for old,
external, custom, and offline Agents. Treat photorealistic faces as an opt-in future theme, not the
default product identity.

### Progress

Finance `Ledger`, Sales `Radar`, and People `Scout` now have three reviewed, visibly distinct comic
portraits shared by the market, hire dialog, chat/profile identity, and office character head. Remaining
curated portraits should follow these masters; community portraits should be generated and persisted at
hire time rather than bundled eagerly.

### Metadata

- Source: user_feedback
- Related Files: src/AgentPortrait.tsx, src/AgentCharacter.tsx, src/talent-blueprints.ts, src/TalentMarket.tsx
- Tags: agents, identity, avatars, comic, consistency
- Pattern-Key: frontend.agent_identity_requires_distinct_stable_silhouettes
- Recurrence-Count: 1

---

## [LRN-20260905-EXTERNAL-TERMINAL-IS-AN-ADAPTER] correction

**Logged**: 2026-09-05T10:13:35+08:00
**Priority**: high
**Status**: in_progress
**Area**: frontend

### Summary

Hara Terminal is the product surface; WezTerm is at most one optional external-terminal adapter and must not
appear to be a required or bundled Hara dependency.

### Details

Desktop 0.1.148 exposed a primary “在 WezTerm 打开” action even when WezTerm was absent. That made a safe
optional handoff look like a product requirement and left most users with an installation error. Rebranding or
silently redistributing WezTerm would deepen the confusion and add an independent release and license surface.

### Suggested Action

Remove the vendor-specific public action until Hara has a provider-neutral external-terminal contract with
capability discovery. Keep the built-in renderer named Hara Terminal. A later external launcher may expose the
system terminal and explicit tested adapters, but arbitrary terminal commands must never cross the renderer
trust boundary.

### Metadata

- Source: user_feedback
- Related Files: src/ExternalNativeTerminalSurface.tsx, src/ExternalSessionCenter.tsx, docs/TERMINAL_ARCHITECTURE_WEZTERM_AUDIT.md
- Tags: terminal, product-language, adapter, wezterm, security
- Pattern-Key: terminal.external_apps_are_optional_adapters
- Recurrence-Count: 1
- First-Seen: 2026-09-05
- Last-Seen: 2026-09-05

---

## [LRN-20260825-RELEASE-PROCESS-COMMAND-LINE] best_practice

**Logged**: 2026-08-25T12:42:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary

Do not inspect full signing-process command lines while monitoring a release; Apple notarization and
similar tools may place credential-related identifiers or protected file locations in their arguments.

### Details

Actions job and step status already provide enough evidence to distinguish queued, building, signing,
notarizing, promoting, and public-edge verification states. A full `ps ... command` probe adds no
release assurance and can surface metadata that must then be redacted from every downstream update.
Executable basenames alone prove liveness but do not identify the exact substage: the same `node`, `gh`,
or `curl` names can belong to initial transfer, digest-cache reconciliation, API fallback, policy reads,
or publication. Do not turn a process-name transition into a completion claim.

### Suggested Action

Monitor the protected release through bounded GitHub Actions job/step JSON only. If local liveness is
needed, inspect PID, parent PID, elapsed time, and executable basename without the argument vector.
Describe that evidence only as liveness; never infer a narrower stage from it. Never copy
signing-process arguments into commentary, notes, Feishu, or release reports.

### Metadata

- Source: error
- Related Files: WORKFLOW.md, .github/workflows/build.yml
- Tags: release, observability, credentials, signing, redaction
- Pattern-Key: release.monitor_steps_without_process_argument_vectors
- Recurrence-Count: 1

---

## [LRN-20260825-TALENT-MARKET-INDUSTRY-BREADTH] correction

**Logged**: 2026-08-25T02:52:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

A talent market seeded mainly with engineering roles reads as an IT-only product; the complete
cross-industry catalog must remain discoverable without weakening curation honesty.

### Details

The hand-adapted roles should be the `Hara curated` shelf, not the entire market. Import the full
Agency Agents snapshot as a searchable community tier across all 17 divisions, clearly distinguish
curation/evaluation status, and progressively load results so 270 records do not crowd the UI or main
bundle. Hiring still creates a separate Hara Agent instance with explicit permissions.

### Suggested Action

The implemented catalog contains all 270 upstream roles: 31 Hara-curated blueprints and 239 clearly
marked community blueprints. Finance, Sales, and People/HR are first-class Hara departments, the market
is lazy-loaded, and only 48 candidate cards render initially. Specialist evaluation remains a versioned
promotion path from `community` to `curated`.

### Metadata

- Source: user_feedback
- Related Files: src/talent-blueprints.ts, src/TalentMarket.tsx, scripts/build-agency-talent-catalog.mjs
- Tags: talent-market, industry, catalog, curation, performance
- Pattern-Key: product.talent_market_separates_breadth_from_verified_curation
- Recurrence-Count: 1

---

## [LRN-20260901-EMPTY-SESSION-VISIBILITY] best_practice

**Logged**: 2026-09-01T17:21:30+08:00
**Priority**: critical
**Status**: pending
**Area**: tests

### Summary

Session creation is not complete until the same empty live session is visible to the client and can be
activated; source-pattern assertions and RPC-success checks cannot prove that workflow.

### Details

CLI 0.155 deliberately stopped persisting a freshly created empty session until its first user turn, so
abandoned drafts would not leave orphan transcripts. `SessionHub.listPage` continued to enumerate only the
durable store. Desktop therefore received a successful `session.create`, immediately refreshed
`session.list`, could not find the returned ID, and left both “New conversation” and “New conversation in
this directory” looking inert. Desktop 0.1.127 added a duplicate-click guard and visible handling for a
rejected create RPC, but its regression test only matched source text and missed the successful-create /
invisible-list-result branch.

### Suggested Action

Define the server contract for empty live drafts explicitly: either merge authorized live session metadata
into `session.list` or return enough authoritative metadata for Desktop to insert and activate the draft
without a list round trip. Add a behavioral Serve test and a Desktop client/UI test for the complete
`create -> list/insert -> activate -> first send -> persist` sequence, plus reconnect and abandon-draft
coverage. Every user-visible create flow must surface post-create refresh/activation failures too.

### Metadata

- Source: user_feedback
- Related Files: ../hara-cli/src/serve/sessions.ts, ../hara-cli/src/serve/server.ts, src/App.tsx, test/ui-regressions.test.mjs
- Tags: sessions, draft, visibility, activation, end-to-end, regression-testing
- Pattern-Key: sessions.creation_requires_visibility_and_activation_gate
- Recurrence-Count: 1

---

## [LRN-20260904-TERMINAL-CONTROLS] correction

**Logged**: 2026-09-04T09:42:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary

A terminal shortcut bar is incomplete unless it exposes the action that finishes the visible provider
workflow and confirms successful delivery in user language.

### Details

The Hara Live terminal showed raw `esc`, `up`, `down`, `tab`, and `ctrl+c` buttons. In the reported Claude
Code confirmation screen, Up/Down selected an option but only Enter could confirm it; Enter existed in the
protocol yet was missing from the UI. Ctrl+C was an interrupt, not a confirmation action, and successful
key delivery had no visible acknowledgment, so clicking it looked broken even when the RPC completed.

### Suggested Action

Derive terminal controls from one typed declaration, show both the stable key chord and localized semantic
action, include Enter for interactive confirmation, keep Ctrl+C explicitly labeled as interrupt, and expose
an `aria-live` delivery acknowledgment. Test the complete visible action set, not only RPC forwarding.

### Metadata

- Source: user_feedback
- Related Files: src/ExternalSessionCenter.tsx, src/ExternalSessionCenter.css, src/i18n.ts, test/ui-regressions.test.mjs
- Tags: terminal, shortcuts, localization, feedback, accessibility
- Pattern-Key: frontend.terminal_controls_cover_semantic_workflow
- Recurrence-Count: 1

### Resolution

- **Resolved**: 2026-09-04T09:42:00+08:00
- **Notes**: Added one-click Enter confirmation, localized key/action labels, explicit interrupt semantics,
  and visible screen-reader-safe send feedback for the next Desktop patch.

---

## [LRN-20260905-ONE-TERMINAL-MULTIPLE-VIEWS] best_practice

**Logged**: 2026-09-05T00:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: architecture

### Summary

An embedded terminal, full-workspace terminal, native WezTerm window, and future phone controller should be
views over one PTY and one input lease, not separate agent or shell processes.

### Details

WezTerm's transferable lessons are stable pane identity, view/process lifetime separation, ordered changed-line
sequences, output coalescing, bounded subscribers, viewport/scrollback separation, and explicit resize. Its GUI
and GPU renderer are not a WebView component, and placing `wezterm-term` behind an already emulated ANSI frame
would create a second terminal state machine. Hara therefore keeps Herdr as the authoritative PTY, xterm.js as
the embedded renderer, and WezTerm as an explicit native handoff attached to the same terminal.

### Suggested Action

Evolve the existing protocol with stream epochs, client acknowledgements, bounded replay and idempotent input
commands before remote/mobile control. Any layout switch or controller handoff must be verified against the
same process identity and must not rerun approvals or tools.

### Metadata

- Source: user_feedback
- Related Files: docs/TERMINAL_ARCHITECTURE_WEZTERM_AUDIT.md, src/ExternalNativeTerminalSurface.tsx
- Tags: terminal, wezterm, pty, mux, mobile, control-lease
- Pattern-Key: terminal.one_session_multiple_views
- Recurrence-Count: 1

### Resolution

- **Resolved**: 2026-09-05T00:00:00+08:00
- **Notes**: Recorded the architecture and implemented the full-width/split interaction without changing the
  existing single-session terminal stream.

---

## [LRN-20260911-CRASH-BUILD-PROFILE-ISOLATION] best_practice

**Logged**: 2026-09-11T07:40:29+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary

Development and installed Desktop builds that share one bundle identifier must not share crash run markers or
pending crash reports.

### Details

Successive macOS `unclean_exit` alerts used development Desktop versions while reporting an older Engine, and
a related protected review confirmed that `target/debug/hara-desktop` and `/Applications/Hara.app` shared the
same `com.nanhara.hara` app-data root. A stale development marker could therefore be consumed by the installed
app and misrepresented as a production crash. Version and PID fields alone cannot establish the build profile.

### Suggested Action

Select the crash-storage directory through one build-profile-aware helper, preserve the existing release path,
and place development markers and pending reports in a separate private directory. Keep a regression that puts
a stale marker in development storage and proves release reconciliation neither consumes it nor creates a
release pending report.

### Metadata

- Source: diagnosis
- Related Files: src-tauri/src/lib.rs
- Tags: crash-reporting, tauri, development, release, false-positive
- Pattern-Key: desktop.crash_tracking_isolates_build_profiles
- Recurrence-Count: 1

### Resolution

- **Resolved**: 2026-09-11T07:40:29+08:00
- **Notes**: Implemented the storage split and verified it with the focused regression, all 51 Rust tests,
  `cargo check`, release-profile `cargo check`, all 278 frontend tests, and a production frontend build. The
  change remains local and unreleased.

---

## [LRN-20260912-FB1309-CROSS-CLIENT-AFFORDANCE] best_practice

**Logged**: 2026-09-12T15:36:00+08:00
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary

A released client must not direct users to a named action that the current stable counterpart does not expose.

### Details

Hara Mobile told an iOS user to open “手机配对” in Hara Desktop, while the user's current stable Desktop
0.1.160 and its bundled Engine 0.173.0 had neither that settings destination nor the authenticated Serve pairing
methods. This made correct instructions look like user error. Cross-client copy must track the minimum compatible
counterpart version or be capability-gated until that counterpart is publicly available.

### Suggested Action

Release the Desktop settings destination and its exact bundled Engine capability together. For future cross-client
flows, gate the instruction on negotiated compatibility or show the minimum required counterpart version and a
truthful fallback; keep UI copy from claiming that device pairing alone enables Session Relay.

### Metadata

- Source: user_feedback
- Related Files: src/App.tsx, src/MobilePairingSettings.tsx, src/client.ts, src/i18n.ts
- Tags: mobile, desktop, pairing, version-skew, capability-negotiation, release
- Pattern-Key: product.cross_client_instructions_require_released_counterpart
- Recurrence-Count: 1

---

## [LRN-20260913-FB1337-ARTIFACT-PROVENANCE] best_practice

**Logged**: 2026-09-13T22:54:24+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary

When sibling frontend repositories have similar product names, identify the deployed source by reproducible
artifact hashes before proposing a code or deployment change.

### Details

The `admin1.yimatrix.ai` title initially suggested the older `yimatrix-admin` checkout, but its exact tracked
commit produced a monolithic bundle whose hashes and routes did not match production. The sibling
`yimatrix-platform-admin` checkout contained the reported Motimo route; a clean Node 22 build of commit
`6678d18` produced byte-identical HTML, entry JS, and lazy chunks. This established the correct repository and
also made the stale-client failure reproducible: the prior build's Motimo chunk is referenced by its prior
entry bundle but now returns HTTP 404 after the workflow's `rsync --delete` deployment.

### Suggested Action

For deployed-SPA incidents, first capture the live HTML and hashed module names, build candidate commits with
their pinned runtime in an isolated writable checkout, and compare SHA-256 values. Only then diagnose or edit
the matching repository; keep DNS failures separate from HTTP asset failures.

### Metadata

- Source: diagnosis
- Related Files: `/Users/zhujianbo/work/projects/zy/yimatrix-platform-admin/.github/workflows/deploy.yml`, `/Users/zhujianbo/work/projects/zy/yimatrix-platform-admin/src/App.jsx`
- Tags: provenance, vite, dynamic-import, deployment, sibling-repositories
- Pattern-Key: deployment.match_live_artifacts_before_selecting_repository
- Recurrence-Count: 1

---
