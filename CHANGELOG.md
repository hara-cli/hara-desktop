# Changelog

## 0.1.35 — managed connections and resilient Desktop workflows

- Recover Desktop startup when `127.0.0.1:8790` is already occupied. A healthy authenticated Hara
  remains reusable through its private discovery record; an explicitly retried stale Hara is stopped
  only after its PID and executable path are revalidated; dead records are removed without signalling;
  and unrelated applications are left untouched while Desktop starts its managed engine on a
  loopback-only fallback port advertised through authenticated discovery.
- Restore both visible eye apertures in the static Desktop cat mark instead of filling them with the
  website animation's detached blink-overlay circles.
- Keep `write_file`, edit, and patch difference cards from shrinking their body to an empty strip inside
  the flex transcript. Difference text now has a stable minimum height, preserves unified alignment, and
  scrolls within a bounded responsive card for long lines, high display scaling, and narrow windows.
- Replace the model picker's fixed Enterprise Gateway preset and detached organization card with one
  connection switchboard: cloud/local options remain presets, while every enterprise row is a named,
  user-enrolled Hara Control deployment. Users can add multiple deployments, inspect authorization and
  endpoint state, heartbeat-check, re-enroll, remove locally, and explicitly switch the route used by new
  sessions. One-time codes are cleared before enrollment and device credentials never enter the renderer.
- Launch plugin panels from their verified installed entry instead of a login shell. Node-based panels now
  skip obsolete runtimes such as Node 11, prefer Node 22 from PATH or common version managers, preserve a
  bounded actionable failure when no supported runtime exists, and execute arguments without shell parsing.
  Native regressions cover repeated launch and rejection of command links outside the plugin store.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.34 — visible window recovery and Hara 0.133.0

- Recover the main window after display disconnection, rearrangement, or resolution changes whenever
  its restored rectangle no longer overlaps any current display work area. The window keeps its saved
  size when possible, is constrained to the primary work area when necessary, and is centered where
  its title bar and controls are reachable again.
- Add native geometry regressions for negative monitor coordinates, disconnected displays, exact edge
  contact, oversized saved windows, and missing-primary fallback, and run the Rust host suite in CI.
- Bundle the exact verified Hara CLI `0.133.0` release so Desktop-managed CLI installs and updates stay
  on the current public CLI version.

## 0.1.33 — Hara 0.132.4 managed CLI and connection settings

- Add a user-owned Enterprise connections card: users enter their own Hara Control URL and one-time
  registration code, then can switch, re-enroll, explicitly check, or locally remove the connection. No
  enterprise URL is prefilled; one-time codes leave renderer state before the request, and device tokens never
  cross into the renderer. Local removal warns that administrator-side revocation remains separate.
- Show redacted WeChat and Feishu runtime health from the local Hara engine, with actual connection/activity
  timestamps and focused recovery steps. The status refreshes every two minutes and never calls a model or
  spends model tokens.
- Automatically install command-line Hara from Desktop's exact verified sidecar when the managed
  path is missing, then keep only Desktop-owned, unmodified copies synchronized after later Desktop
  updates. Each install is staged, content-verified, atomically replaced, and bound to a private
  SHA-256 ownership receipt at `~/.hara/desktop-cli.json`.
- Show whether the CLI is missing, stale, current, manually managed, blocked, or unavailable, plus
  the bundled version, destination path, and PATH guidance. Existing npm/source/manual installs are
  never silently overwritten; users can explicitly opt the managed path into automatic updates.
- Bundle the exact verified Hara CLI `0.132.4` release, including observable chat-gateway status, scoped Web
  proxy support, complete configuration redaction, immediate prompt-key routing, and reliable non-Git
  `@path` completion on slow machines.
- Update DOMPurify to `3.4.12`, closing the newly disclosed custom-element hook bypass before release.

## 0.1.32 — hara 0.130.1 Windows serve and updater handoff

- Bundle Hara CLI `0.130.1`, which omits inapplicable POSIX descriptor-mode operations on Windows
  while retaining private discovery type, identity, atomic replacement, and authentication checks.
  The official Windows sidecar can start `hara serve` without the reported `fchmod` `EPERM`.
- Split Desktop update download from installation. Hara now keeps the task engine available during
  download, waits for active work to finish, performs authenticated engine shutdown, confirms
  `serve.json` retirement, and only then installs and restarts.
- NSIS setup and uninstall now use Tauri's current-user-aware process gate for the detached
  `hara.exe`. Interactive upgrades ask before closing it; silent updates close it or abort rather
  than claiming success while retaining a locked old sidecar.
- Make the update handoff retry-safe: an already installed package is not installed twice, and a
  failed installer/relaunch restores the task engine when possible. This prevents Windows in-place
  upgrades from leaving the adjacent `hara.exe` at an older version because it was still locked.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.31 — hara 0.130.0 ordered task-state delivery

- Bundle Hara CLI `0.130.0` from its exact public tag and commit. Typed task lifecycle events now
  carry one server-stream identity and a monotonically increasing sequence across sessions,
  steering, approvals, checkpoints, resume, and completion.
- Reject duplicated or stale lifecycle events from the same engine stream before they can overwrite
  the current Desktop busy state, active turn, approval, checkpoint, completion notification, or
  companion status. A restarted server begins a new accepted stream.
- Keep the protocol-v1 compatibility boundary additive: Desktop still connects to older supported
  engines that do not send ordering metadata, while new engines provide deterministic ordering
  without mixing task execution into conversation text.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.30 — hara 0.129.0 workspace recovery and resilient release transfers

- Carry the complete local Deliverables workbench, Hara CLI `0.129.0` workspace recovery, Apple
  timestamp retry, and recoverable notarization changes prepared in the withheld `0.1.27` through
  `0.1.29` drafts.
- Download every hidden or public GitHub Release asset set into a new private staging directory and
  replace the verification directory only after a complete transfer. A failed attempt is discarded,
  so a partial installer or updater can never be reused on the next attempt.
- Retry release uploads and downloads at most three times only when a bounded private log proves a
  GitHub transport transient such as the connection reset that blocked `0.1.29`. Authentication,
  authorization, missing releases, digest/signature mismatches, and exhausted retries remain
  terminal; uploads retry the entire canonical clobber set while the release is still hidden.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.29 — WITHHELD (never published; hara 0.129.0 workspace recovery and resilient signing)

- Ship the local Deliverables workbench originally prepared in the withheld `0.1.27`/`0.1.28`
  drafts, now backed by the exact Hara CLI `0.129.0` sidecar. The engine adds immutable Artifact
  commit/revert transactions and conflict protection; the current Desktop workbench remains an
  explicitly non-editing foundation until reviewed Office capabilities are connected.
- Carry Hara CLI workspace recovery into Desktop: a Home-root interactive engine can offer a
  confirmed recent-project switch, cross-tool Home-boundary failures share one bounded root-cause
  breaker, private Plugin Git failures are actionable without leaking remote diagnostics, and
  Feishu WebSocket reconnect health is observable.
- Retry a signed Tauri bundle at most three times only when its private build log proves an Apple
  timestamp network/service transient. Every attempt discards partial bundle assets; identity,
  keychain, malformed-signature, and persistent timestamp failures still fail closed, and the
  release never falls back to a Developer ID signature without a trusted timestamp.
- Preserve the recoverable DMG notarization flow from `0.1.28`: a validated submission ID survives
  a crashed status child, while bounded native status queries still reject invalid or missing
  notarization facts.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.28 — WITHHELD (never published; hara 0.128.0 recoverable notarization)

- Ship the local Deliverables workbench originally prepared in the withheld `0.1.27` draft: safe
  presentation/spreadsheet/document import, file facts, integrity verification, and immutable
  revision history through the authenticated Hara CLI `0.128.0` sidecar.
- Separate DMG submission from status waiting on the protected macOS release host. A validated
  submission ID now survives a crashed `notarytool` status child, while bounded native status
  queries retry only explicit process/network failures and still fail closed on invalid responses,
  rejected artifacts, or a one-hour processing deadline.
- Keep all four native package gates, Developer ID signing, app and DMG notarization, stapling,
  Gatekeeper checks, exact updater verification, and hidden-draft promotion unchanged.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.27 — WITHHELD (never published; hara 0.128.0 local deliverable workbench)

- Bundle Hara CLI `0.128.0` from its exact public tag and commit, including the authenticated
  `artifact/1` import, list, integrity-check, and revision-history runtime plus quiet cron delivery
  policies from `0.127.2`.
- Add a plain-language Deliverables shelf to Projects. People can choose a presentation, spreadsheet,
  or document and Hara imports an immutable owner-only snapshot without changing the original file or
  retaining its absolute source path.
- Add a responsive, keyboard-accessible local workbench with file facts, digest verification, and
  revision history. The decorative format card is explicitly labeled as a placeholder: this release
  does not claim to show the real layout or provide editing/export before a reviewed Office capability
  is installed.
- Negotiate Artifact methods with the connected engine and show a focused upgrade message for an older
  sidecar instead of maintaining an indefinite compatibility branch. Corrupt local entries stay hidden
  while healthy deliverables remain usable.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.26 — hara 0.127.1 managed access lifecycle

- Bundle Hara CLI `0.127.1` from its exact public tag and commit.
- Show an accessible warning when organization-managed access is corrupt, expired, or within its
  final 24 hours, with a focused instruction to request a new enrollment code.
- Treat expired managed profiles as unauthenticated instead of letting a new task fail later at the
  model gateway. Personal/local providers and legacy control planes remain unchanged.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.25 — hara 0.127.0 task-aware companion chat and typed execution state

- Bundle Hara CLI `0.127.0` from its exact public tag and commit. Prompt context now has stable
  system/session and dynamic turn/digest sections, while Desktop consumes the versioned typed task
  lifecycle instead of inferring execution state from conversation text.
- Separate conversation input from execution control. Live text refinements use expected-turn
  steering; attachments remain one queued next turn; stable local identities keep optimistic messages,
  retries, cancellation, and rewind aligned with what Hara Serve actually persisted.
- Add a focusable companion chat beside the non-focusable desktop pet. It pins one session when opened,
  can submit work or answer the current one-time approval, restores failed drafts, resumes cold sessions
  before sending, and never redirects a draft when another task becomes active.
- Keep the companion least-privilege: its dedicated webview has only event/window permissions and a
  production deny-by-default CSP with no browser network channel. Agent execution, files, credentials,
  model access, Native commands, and approval validation remain owned by the trusted main window and
  authenticated Hara Serve.
- Harden failure and reconnect boundaries: accepted failed turns remain in durable history, partial
  disconnected output is replaced by authoritative resumed history, late BUSY steering retries cannot
  strand input, simultaneous main/companion sends share one synchronous execution lock, and disconnected
  approvals fail visibly instead of being shown as accepted.
- Ambient always-on-top status uses fixed state/phase labels only; command previews, paths, task text,
  checkpoints, and tool output remain inside an explicitly opened conversation.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.24 — hara 0.126.1 verified Plugin package and ownership boundary

- Bundle Hara CLI `0.126.1` from its exact public tag and commit so Desktop's built-in engine receives
  the same Plugin manifest, path-containment, private staging, atomic activation, ownership-receipt,
  update rollback, and safe-uninstall boundary as the standalone CLI.
- Bind Plugin MCP relative executables and conventional runtime entry scripts to the installed package
  root and use that root as the process working directory. Desktop no longer falls back to the user's
  project when its built-in engine resolves a reviewed Plugin entry.
- Keep the `0.1.23` place/session isolation and disabled-Panel protections unchanged. Third-party
  executable Panel v2 remains closed until its CSP/origin/token/capability/process boundary is complete;
  this sidecar refresh does not claim that open-market boundary.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.23 — hara 0.126.0 novice workbench, provider settings, and safe engine replacement

- Reframe the four-place shell as a plain-language personal workbench: specialist cards start
  guided PPT, spreadsheet, document, video, research, and data-analysis tasks without making users
  understand agents or skills first. Keep place/session ownership explicit so project and chat
  contexts cannot silently cross-wire.
- Redesign Settings around model providers, engine lifecycle, security, language, companions,
  capabilities, and skills. Shared setting rows, notices, status chips, and accessible navigation
  improve hierarchy, keyboard behavior, contrast, and version visibility.
- Manage cloud, OpenAI-compatible, Qwen OAuth, enterprise, Ollama, and LM Studio connections only
  through authenticated Hara Serve RPC. Candidate endpoints are validated, tests are bounded and
  redacted, credentials are write-only, environment-managed settings remain read-only, and changes
  apply only to new sessions.
- Display Desktop, bundled-engine, and connected-engine versions separately. When an older engine
  survives an app relaunch, offer an explicit “Use bundled engine” action instead of reconnecting
  forever: modern engines use authenticated `server.shutdown`; the one-time legacy bridge reopens
  the owner-only discovery record, verifies the exact PID and Hara executable, and terminates it
  with a five-second bound before starting the bundled sidecar.
- Add the optional companion shell and lifecycle surfaces while keeping it non-focusable and
  separate from the task runtime. Record the novice Office architecture and the reusable Hara
  Slides, Sheets, and Docs repository boundaries without claiming unsupported editable-PPTX
  fidelity.
- Bundle Hara CLI `0.126.0`, including bounded human-input waits, stronger session leases and tool
  execution, provider-control RPC, and the WeCom-compatible WebSocket transport. The sidecar remains
  pinned to the exact public CLI tag and commit.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show
  a SmartScreen warning until the planned signing service is integrated.

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
