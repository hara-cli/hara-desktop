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

## Status

P1 MVP: connect/discover · session list + new/resume · streaming chat (text / thinking /
tool / notice / diff) · approval dialogs (allow / always / deny) · interrupt.
Next (P2): plugin manager panel, bundled sidecar, auto-update, multi-workspace.
