# Changelog

## 0.1.9 — hara 0.121.0 sidecar and connection hardening

- Bundle the released hara CLI `0.121.0`, including `hara desk`, crash-safe coding/file edits,
  bounded large-file/tool output, composer history, and cold-start improvements.
- Cancel superseded WebSocket connection attempts so a stale socket cannot replace the active
  session after reconnecting or switching servers.
- Pin CI sidecar builds to the exact `v<SIDECAR_VERSION>` CLI tag and fail release builds when the
  desktop, Cargo, Tauri, lockfile, Git tag, or bundled CLI versions drift.
