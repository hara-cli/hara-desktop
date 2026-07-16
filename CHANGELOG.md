# Changelog

## 0.1.22 — hara 0.124.1 task pets, navigation visibility, and Windows sidecar recovery

- Keep the four left navigation icons at their intended 19 px size and raise inactive contrast. The
  global button padding had reduced a 34 px rail button to a 2 px flex content box, shrinking each
  SVG into the dot-like marks seen in the live report.
- Add an optional non-focusable desktop pet that reflects running, needs-input, ready, and blocked
  task states without changing the agent loop or taking keyboard focus. Multi-task priority and
  reduced-motion behavior match the Codex desktop model.
- Bundle a CSS-native Hara companion and discover compatible local Codex/Hara v1 and v2 sprite
  packages. Native validation confines reads to fixed catalog roots, rejects traversal and symlinks,
  bounds metadata/assets, verifies PNG/WebP geometry, and gives the pet webview validated image data
  instead of filesystem access.
- Separate built-in, Hara-local, read-only Codex-local, and future Hara-market package provenance;
  bound local catalog scans, and document the independent generation, signed public catalog, optional
  login, creator-ingestion, moderation, and entitlement architecture.
- Bundle hara CLI `0.124.1` so Desktop consumes explicit turn lifecycle and approval events while
  retaining a safe fallback for older event streams. Windows private-state staging now uses the
  portable `wx`/`CREATE_NEW` contract, and descriptor/path identity follows stable NTFS file IDs, so
  the native sidecar passes an isolated `doctor` without weakening symlink or hard-link fences.
- Make the protected release host select the exact rustup toolchain even when Homebrew appears first
  on `PATH`, and require the dedicated codesigning keychain to be automatically unlocked from its
  owner-only local password file with a real ephemeral signing probe before either notarized macOS
  build starts. Ordinary Hara startup never accesses signing material.
- Compile the Windows sidecar from the already installed and SHA-256-verified native baseline Bun
  runtime instead of asking Bun 1.3.9 to download that same target runtime a second time. Sanitize the
  macOS keychain search list so malformed stale entries cannot survive a protected signing build.
- Make the protected signer compatible with macOS Bash 3.2 when its original keychain list starts
  empty, and require an explicit verified-completion sentinel so a fatal shell error can never be
  mistaken for a successful signing step. Store atomic, per-run architecture provenance outside
  Tauri-owned bundle directories and invalidate stale markers before every attempt.
- Execute the freshly compiled Bun sidecar boundary smoke while its valid ad-hoc signature remains,
  then remove that signature and let Tauri perform the only Developer ID signing pass on the nested
  Hara.app copy. Verify the packaged sidecar's exact signing authority and trusted timestamp before
  notarization, so replacing an already signed nested binary cannot discard the timestamp.
- Retry Apple staple validation at most three times only for explicit CloudKit/network transport
  failures; missing tickets, invalid signatures, and the final failed attempt remain blocking. Use
  `/usr/sbin/spctl` explicitly for every Gatekeeper gate so the protected non-login Actions shell
  cannot lose the system security tool through its restricted `PATH`.

## 0.1.21 — WITHHELD (never published; hara 0.124.1)

> The sole nested-sidecar signing fix worked: Hara.app and its sidecar were Developer ID signed,
> Apple accepted and stapled the app, and the package/DMG/updater sidecar smokes passed. Attempt 1
> then hit one CloudKit ticket lookup timeout during staple validation. Attempt 2 passed that gate,
> Apple also accepted and stapled the DMG container, then the non-login Actions shell could not find
> bare `spctl` outside its PATH. Both attempts failed closed before Intel signing or promotion; no
> installer or updater was published. Upgrade from `0.1.10` or earlier directly to `0.1.22`.

## 0.1.20 — WITHHELD (never published; hara 0.124.1)

> Four-platform native builds, installer extraction, updater verification, hidden-draft assembly,
> protected keychain unlock, the signing probe, and the freshly compiled sidecar smoke all passed.
> The script then pre-signed the sidecar before Tauri assembled Hara.app; Tauri necessarily signed
> the nested copy again, and codesign rejected that replacement because its trusted timestamp was
> absent. The explicit completion sentinel reported the ARM64 step as a real failure, so Intel,
> promotion, installers, and updater remained hidden. Upgrade from `0.1.10` or earlier to `0.1.22`.

## 0.1.19 — WITHHELD (never published; hara 0.124.1)

> All four native lanes, installer extraction checks, updater signatures, and hidden-draft assembly
> passed. On the protected macOS runner, Bash 3.2 rejected empty-array iteration under `set -u` before
> either signed build started, then supplied a false zero status to the EXIT cleanup trap. The final
> promotion still failed closed because both signed-build provenance markers were absent. No signed
> asset, installer, or updater was published; upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.18 — WITHHELD (never published; hara 0.124.0)

> The release stayed hidden with zero public assets. Its SHA-256-verified Bun 1.3.9 Windows sidecar
> compiled successfully, then failed the isolated `doctor` smoke while opening a newly created
> `.hara-private-*.tmp` staging file. The root cause was CLI 0.124.0's non-portable numeric POSIX open
> flags and Windows descriptor/path identity assumptions. No installer or updater was exposed;
> upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.17 — WITHHELD (never published; hara 0.124.0)

> The release stayed hidden. Windows installed and SHA-256-verified the pinned baseline Bun runtime,
> but an explicit same-target compile made Bun 1.3.9 download it again and that redundant transfer
> timed out before packaging. No installer or updater was exposed. Upgrade directly from `0.1.10` or
> earlier to `0.1.22`.

## 0.1.16 — WITHHELD (never published; hara 0.122.7)

> All native build lanes, installer extraction checks, updater signatures, and hidden-draft assembly
> passed. The protected macOS worker could enumerate but not use the login-keychain private key, so
> Developer ID signing failed closed and the draft was never published. Upgrade directly from
> `0.1.10` or earlier to `0.1.22`.

- Bundle hara CLI `0.122.7`, retaining the standalone boundary that disables Bun's ambient `.env`
  and `bunfig.toml` loaders before the Desktop sidecar starts. Resumed sessions now continue their
  persisted task instead of rediscovering the workspace; when a session starts at the user's Home,
  directory inventory, recursive search, directory references, coding mutations, and shell/external
  agents are blocked while explicit single-file reads remain available. Tab input also renders at
  the same width as the cursor without changing the submitted text.
- Launch every packaged sidecar from a hostile working directory and reject project preload execution
  or environment injection before the Hara permission boundary.
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
- Force the Rust manifest to LF at checkout on every platform. Tauri rewrites `Cargo.toml` while
  injecting managed features; without this rule a Windows CRLF checkout became a false dirty-worktree
  failure after otherwise verified MSI/NSIS builds. The release still requires a completely clean
  worktree before collecting assets.
- Resolve the hidden GitHub draft through `gh release view`'s numeric database ID before replacing
  assets. GitHub's tag endpoint does not expose an unpublished draft, so using that endpoint caused
  a false 404 after all four native build lanes and asset receipts had already passed.
- Extract RPM payloads directly with libarchive instead of buffering `rpm2cpio` output; this covers
  current RPM payload variants while keeping package extraction time and memory bounded.
- Cryptographically verify every updater artifact, extract and execute the actual macOS/deb/rpm/
  MSI/NSIS payloads, pin every native build to the committed Desktop/CLI commits and toolchains, and
  publish source provenance alongside SHA-256-bound matrix receipts. Stable release jobs reject
  prerelease or moved tags and verify GitHub's immutable-release attestation. The promotion gate
  accepts exactly one pinned user bypass for stable tags and carries its protected-job identity into
  every Rosetta-based Intel verification.

## 0.1.15 — WITHHELD (never published)

> All four native build lanes, installer extraction checks, sidecar smoke tests, updater signatures,
> and the 14-asset aggregation passed. Draft assembly then used GitHub's tag endpoint to look up the
> unpublished release; that endpoint returned 404 for the otherwise visible hidden draft. The empty
> draft was deleted, no installer or updater was exposed, and the immutable tag remains at its
> original commit. Upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.14 — WITHHELD (never published)

> The tag candidate remained a hidden draft. Using the pinned baseline Bun fixed Windows standalone
> compilation, and both Windows installers passed signature, extraction, and native sidecar smoke.
> Tauri then normalized `Cargo.toml` from CRLF to LF, so the clean-worktree release gate correctly
> stopped collection. No `0.1.14` installer or updater was exposed. Upgrade directly from `0.1.10`
> or earlier to `0.1.22`.

## 0.1.13 — WITHHELD (never published)

> The tag candidate remained a hidden draft: Bun 1.3.9's Windows standalone compiler repeatedly
> failed to extract its baseline target runtime even though the upstream package was present and
> valid. The bounded retries failed closed and no `0.1.13` installer or updater was exposed. Upgrade
> directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.12 — WITHHELD (never published)

> The tag candidate remained a hidden draft: its Windows lane received an incomplete Bun target
> download and Ubuntu's `rpm2cpio` rejected the generated RPM. No `0.1.12` installer or updater was
> exposed. Upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.11 — WITHDRAWN (hara 0.122.2)

> Withdrawn from automatic updates on 2026-07-14. The bundled Bun standalone could fail at startup
> when `SharedArrayBuffer` was unavailable. Keep using `0.1.10` or upgrade directly to `0.1.22`.

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
