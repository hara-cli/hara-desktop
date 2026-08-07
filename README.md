# Hara Desktop

A native desktop shell for [hara](https://hara.run) — the coding agent CLI that runs like an
engineering org. Tauri (Rust thin host) + React, driving a local **`hara serve`** over
WebSocket JSON-RPC (protocol v1).

## Naming

| Layer | Name | Rationale |
|---|---|---|
| Product (site/docs) | **Hara Desktop** | the CLI's desktop companion — Docker Desktop / GitHub Desktop convention |
| App (Dock/Finder) | **Hara** | short bundle name, Docker.app-style |
| CLI / command | `hara` (always lowercase) | command-line + npm convention |
| In-app wordmark | `hara` lowercase | matches the hara.run wordmark |
| Bundle id | `com.nanhara.hara` | fixed — registered with Apple |

```
┌───────────────────────┐        ws://127.0.0.1:8790 (JSON-RPC v1)
│   hara desktop (this) │ ◄────────────────────────────────────────►  hara serve
│   sessions · chat     │   session.create/resume/send/interrupt      (hara-cli, agent core
│   approvals · diffs   │   event.text/tool/diff/notice/task_state    in-process: plugins,
└───────────────────────┘   approval.request ⇄ approval.reply         skills, memory)
```

The desktop owns **zero agent logic**: every turn, tool call, and permission decision happens in
`hara serve`; this app renders the event stream and answers approval requests. Sessions are the
same `~/.hara/sessions` store the CLI uses — start a chat here, continue it with `hara resume`,
or vice versa.

## Run (dev)

```bash
# 1. a running server (or let the app start it for you)
hara serve

# 2. the shell
npm install
npm run tauri dev
```

The app discovers the server via `~/.hara/serve.json` (written by `hara serve`, removed on exit).
No file → the app offers to start one.

## Build

```bash
npm run tauri build   # bundles hara.app / dmg
```

## Status — public beta (all platforms)

Shipped: configurable module-dock IA (fresh assistant conversations + folded history + per-origin bot
threads + task console) · open-folder-as-project · bundled hara sidecar
(zero-dependency) · first-run key onboarding · per-session model & thinking-effort switch · inline
approvals · steer queue · notifications + dock badge · search / pin / rename / archive · `@file`
mentions · optional non-focusable task-status pet with local Codex v1/v2 package compatibility ·
i18n (en/zh) · a dedicated, default-visible Office surface for safe import, integrity checks, and
revision history ·
plain-language specialist work starters · signed auto-updates from GitHub Releases · notarized Developer ID macOS
builds · a unified model switchboard with preset personal providers plus any number of user-added,
directly switchable Hara Control connections · redacted WeChat/Feishu connection health · safe automatic installation/update of Desktop's exact bundled CLI at `~/.hara/bin/hara` · 4-platform CI with
package-smoke gate. See `WORKFLOW.md` for the two-repo release train.

The current development branch adds the first real Office slice: native Hara presentations can be
created or imported, edited in the Desktop workbench, rendered with the canonical HTML renderer,
saved as optimistic-concurrency revisions, verified, opened as a presentation page, and exported as
HTML, JSON, or bounded editable PPTX. Spreadsheet and document imports remain honest generic Artifact
views until their native editor slices land.

Next: Windows Authenticode signing · richer cron policy UI · attachments · richer Presentation
templates plus native Spreadsheet and Document render/edit/export slices · signed capability center. See
[`docs/NOVICE_WORKBENCH_ARCHITECTURE.md`](./docs/NOVICE_WORKBENCH_ARCHITECTURE.md),
[`docs/OFFICE_OPEN_CORE_EXECUTION_PLAN.md`](./docs/OFFICE_OPEN_CORE_EXECUTION_PLAN.md), and
[`docs/OFFICE_TEMPLATE_COMPONENT_SYSTEM.md`](./docs/OFFICE_TEMPLATE_COMPONENT_SYSTEM.md).
The presentation path, including the audited `ppt-master` source-import and native PPTX candidate,
is documented in
[`docs/PRESENTATION_CAPABILITY_ARCHITECTURE.md`](./docs/PRESENTATION_CAPABILITY_ARCHITECTURE.md) and
[`docs/PPT_MASTER_INTEGRATION_AUDIT.md`](./docs/PPT_MASTER_INTEGRATION_AUDIT.md).

## Design invariants (模块坞 + 核心场所模型)

Five open-core work modules are visible in the icon dock by default — chat, projects, tasks, groups,
and Office. Projects owns local-folder conversations and preview splits; Office owns presentations,
spreadsheets, documents, and their local Artifact revisions. People may hide or reorder these
entries. Settings stays fixed at the lower left so hidden modules always remain recoverable. Runtime
places still preserve separate session ownership and density. Invariants:

- **Notification rule**: interruption-grade (a human must respond) → red dot + dock badge;
  ambient-grade (an automation ran and left a trace) → count chip, NEVER a dock badge.
- Automated sessions never mix into manual session lists, and never open as live conversations —
  replay is read-only; `session.fork` is the only continuation path.
- Conversation presentation defaults to **Concise**: task progress, blockers, approvals, notices, and
  results stay visible while tool/diff evidence and token counts stay out of the chat stream. Standard
  adds collapsed execution logs; Debug expands those local logs and token usage. Provider reasoning is
  discarded at the protocol/renderer boundary and never reappears in Debug.
- A plugin panel is a WORK stage, not a settings artifact: an enabled panel may be explicitly pinned
  as a default-hidden dock shortcut, but opening it still moves to Projects, asks Serve to re-check
  applicability, and binds the Extension Dock to one concrete project session. It receives no
  independent state, credential channel, auto-start, or badge semantics. A true primary plugin module
  still waits for the isolated Panel v2 contract.
- Office Artifacts use that same owner-bound, multi-tab Extension Dock. A project agent may also show
  an already-running Node/Vite/Next preview there, but only through a typed surface event and only for
  credential-free `http://localhost`, `127.0.0.1`, or `[::1]` URLs with an explicit port. Arbitrary or
  authenticated web pages stay in the system browser until the isolated Panel v2 contract exists.
- One active desktop assistant conversation plus folded, switchable history; one thread per external
  origin (WeChat etc.), separated by the "external channels" divider.

The module contribution and future plugin-surface boundary are documented in
[`docs/MODULE_DOCK_ARCHITECTURE.md`](./docs/MODULE_DOCK_ARCHITECTURE.md).
Windows updater payloads carry Hara's cryptographically verified Tauri/minisign signatures, but the
MSI/NSIS executables are not yet Authenticode-signed. Windows may therefore show a SmartScreen
warning until the planned signing service is integrated; the release notes must not claim otherwise.
