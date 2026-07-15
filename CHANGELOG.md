# Changelog

## 0.1.14 — hara 0.122.5 standalone boundary and release gates

- Bundle hara CLI `0.122.5`, retaining the gateway delivery/lifecycle fixes from `0.122.4` while
  disabling Bun's ambient `.env` and `bunfig.toml` loaders before the Desktop sidecar starts. The
  release gate now launches every packaged sidecar from a hostile working directory and rejects
  any project preload execution or environment injection.
- Pin Node.js `22.23.1`, Bun, and Rust `1.97.0` for reproducible release builds with actionable
  upgrade guidance; verify the target architecture before signing or packaging.
- Keep tag builds in a hidden GitHub draft until every native platform has built and executed the
  packaged sidecar both normally and with `SharedArrayBuffer` disabled; a single writer constructs
  `latest.json`, then the same tag workflow automatically enters protected signing under the same
  server-side concurrency lock and waits for signed/notarized arm64 and Intel macOS replacements.
- Run sidecar smoke before signing, after Developer ID signing, and again from the packaged app so a
  startup or architecture regression cannot reach the automatic updater channel.
- Compile every x64 sidecar with Bun's baseline target so Intel hosts and Rosetta validation do not
  inherit the modern/AVX assumption from an unqualified x64 build.
- Recognize sibling CLI repositories through Git itself so sidecar refreshes also work when
  `hara-cli` is checked out as a linked worktree whose `.git` entry is a file.
- Retry Bun standalone target downloads at most three times, so a truncated compiler-runtime
  transfer fails with a finite, actionable result instead of making a clean release require a new
  runner immediately.
- Install and SHA-256-verify Bun's pinned Windows baseline executable as the Windows build runtime. This avoids Bun
  1.3.9's consistently failing internal extraction path for the otherwise valid baseline target
  package while retaining the old-CPU compatibility boundary.
- Extract RPM payloads directly with libarchive instead of buffering `rpm2cpio` output; this covers
  current RPM payload variants while keeping package extraction time and memory bounded.
- Cryptographically verify every updater artifact, extract and execute the actual macOS/deb/rpm/
  MSI/NSIS payloads, pin every native build to the committed Desktop/CLI commits and toolchains, and
  publish source provenance alongside SHA-256-bound matrix receipts. Stable release jobs reject
  prerelease or moved tags and verify GitHub's immutable-release attestation. The promotion gate
  accepts exactly one pinned user bypass for stable tags and carries its protected-job identity into
  every Rosetta-based Intel verification.

## 0.1.13 — WITHHELD (never published)

> The tag candidate remained a hidden draft: Bun 1.3.9's Windows standalone compiler repeatedly
> failed to extract its baseline target runtime even though the upstream package was present and
> valid. The bounded retries failed closed and no `0.1.13` installer or updater was exposed. Upgrade
> directly from `0.1.10` or earlier to `0.1.14`.

## 0.1.12 — WITHHELD (never published)

> The tag candidate remained a hidden draft: its Windows lane received an incomplete Bun target
> download and Ubuntu's `rpm2cpio` rejected the generated RPM. No `0.1.12` installer or updater was
> exposed. Upgrade directly from `0.1.10` or earlier to `0.1.14`.

## 0.1.11 — WITHDRAWN (hara 0.122.2)

> Withdrawn from automatic updates on 2026-07-14. The bundled Bun standalone could fail at startup
> when `SharedArrayBuffer` was unavailable. Keep using `0.1.10` or upgrade directly to `0.1.14`.

- Bundle the released hara CLI `0.122.2`, with explicit trust boundaries for project configuration,
  permissions, profiles, sensitive files, Git history, subprocess environments, and external agents.
- Make coding, search, checkpoint, semantic-index, cron, process-tree, and gateway file handling more
  robust against concurrent replacement, stale state, unbounded work, and unsafe attachment paths.
- Keep Chinese/Japanese/Korean IME composition inside the composer: pressing Enter to accept an active
  composition no longer selects an autocomplete item or sends the message prematurely.
- Require Node.js `22.12.0` or newer only for PATH-based CLI fallback, with an actionable upgrade
  message on older runtimes; the bundled desktop sidecar remains self-contained.

## 0.1.10 — hara 0.122.0 lifecycle and file-safety hardening

- Bundle the released hara CLI `0.122.0` with cancellable agent/tool-round lifecycles and reliable
  failure propagation for headless, plan, review, and organization runs.
- Harden `hara serve` shutdown, discovery, compaction, approval cancellation, and concurrent session
  locking while keeping persisted session secrets redacted.
- Make coding and file operations safer around symlinks, inode replacement, FIFOs/devices, rollback,
  undo, large snapshots, searches, and concurrent external edits.
- Bound gateway subprocesses, queues, media downloads, rate-limit state, and daemon shutdown so a
  stuck provider or child process cannot pin the desktop service.

## 0.1.9 — hara 0.121.0 sidecar and connection hardening

- Bundle the released hara CLI `0.121.0`, including `hara desk`, crash-safe coding/file edits,
  bounded large-file/tool output, composer history, and cold-start improvements.
- Cancel superseded WebSocket connection attempts so a stale socket cannot replace the active
  session after reconnecting or switching servers.
- Pin CI sidecar builds to the exact `v<SIDECAR_VERSION>` CLI tag and fail release builds when the
  desktop, Cargo, Tauri, lockfile, Git tag, or bundled CLI versions drift.
