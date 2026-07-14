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
│   approvals · diffs   │   event.text/reasoning/tool/diff/notice     in-process: plugins,
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

Shipped: segmented assistant/projects IA (one persistent assistant conversation + per-origin bot
threads + collapsed automations timeline) · open-folder-as-project · bundled hara sidecar
(zero-dependency) · first-run key onboarding · per-session model & thinking-effort switch · inline
approvals · steer queue · notifications + dock badge · search / pin / rename / archive · `@file`
mentions · i18n (en/zh) · signed auto-updates from GitHub Releases · notarized Developer ID macOS
builds · 4-platform CI with
package-smoke gate. See `WORKFLOW.md` for the two-repo release train.

Next: Windows Authenticode signing · cron management UI · attachments.

## Design invariants (四场所模型, 顾雅 2026-07-11)

Four places on the icon rail — 💬 chat (IM density) · 📁 projects (IDE density, chat↔preview split)
· 🤖 automations (console density: job table + run timeline, runs open as READ-ONLY replays; fork to
continue) · ⚙ settings (context anchors + stage forms). Invariants:

- **Notification rule**: interruption-grade (a human must respond) → red dot + dock badge;
  ambient-grade (an automation ran and left a trace) → count chip, NEVER a dock badge.
- Automated sessions never mix into manual session lists, and never open as live conversations —
  replay is read-only; `session.fork` is the only continuation path.
- A plugin panel is a WORK stage, not a settings artifact: launching one goes to the projects
  place (split view); settings only manages enable/disable.
- One persistent desktop assistant; one thread per external origin (WeChat etc.), separated by the
  "external channels" divider.
Windows updater payloads carry Hara's cryptographically verified Tauri/minisign signatures, but the
MSI/NSIS executables are not yet Authenticode-signed. Windows may therefore show a SmartScreen
warning until the planned signing service is integrated; the release notes must not claim otherwise.
