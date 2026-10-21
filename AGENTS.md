# Repository Guidelines

## Scope & Structure

Hara Desktop is a Tauri shell around the Hara CLI server; agent logic and permission decisions remain in `hara serve`. React/TypeScript UI code is in `src/`, Rust host code and Tauri metadata in `src-tauri/`, release/build helpers in `scripts/`, and tests in `test/`. Read `WORKFLOW.md` before changing sidecar, updater, signing, or release behavior.

Preserve protocol-v1 session, approval, interruption, and capability negotiation semantics. Keep the
open-core work-place isolation and notification rules documented in `README.md`; Chat, Projects,
Tasks, Groups, and Office must not reuse one another's active session or data authority. Automated
runs remain read-only replays unless explicitly forked, and Settings remains the fixed recovery path.

## Development & Tests

- Use the exact Node, Bun, and Rust versions pinned by `.node-version`, `.bun-version`, and `.rust-version`.
- On this workstation, unqualified `cargo`/`rustc` may resolve the legacy Homebrew 1.84.1
  toolchain even when rustup reports the pinned version. Put the exact pinned rustup toolchain
  `bin` directory first on `PATH` and verify both Cargo and rustc before every Rust gate.
- `npm ci` installs the locked frontend/tooling dependencies.
- `npm test` runs release, protocol, packaging, and UI regression tests.
- `npm run check:release` validates Desktop, Tauri, Cargo, sidecar, and toolchain metadata.
- `npm run build` runs TypeScript and the Vite production build.
- `cargo check --manifest-path src-tauri/Cargo.toml` checks the native host.
- `npm run tauri dev` runs the desktop app for an interactive smoke test.

When an exact-tag verification includes tests that inspect Git attributes or clean-tree state, use an
isolated local clone rather than `git archive`; archive exports do not contain the required `.git` metadata.
When editing repeated metadata in `.learnings/`, anchor every patch hunk to the exact entry heading or stable
pattern key, then read back the target and any plausible first-match entry before continuing.

Add focused tests for renderer state and release scripts. For native changes, validate both Rust and frontend behavior; for `hara serve` integration, exercise disconnect/reconnect, approvals, and interruption paths.

Resolve file paths within the actual repository before cross-repository searches; do not pass unexpanded
zsh globs or a sibling's source paths. For contract checks against large source files, assert a boolean
match result rather than dumping the full file on failure. Keep complete test logs in a task-private
temporary directory and return bounded summaries without losing the process completion handle.

## Generated Output & Release Boundary

Before creating or pushing any release tag, require a successful full candidate for the **exact
final Desktop/Core source**: native Intel/ARM64 and supported platforms, real sidecars, formal
installers including an actual Intel-runner DMG, Developer ID/updater signing, App/DMG notarization,
staple, Gatekeeper, package smoke and upgrade verification. Unit/native checks with dummy sidecars,
Rosetta or an older local candidate cannot substitute. Fail closed while this gate is unavailable.
Candidate mode must share formal build/verification logic and disable publication only; it cannot
fake tag/CI context, weaken source/signature/notary/integrity checks or use production write credentials.
Check original updater-file access and Pi-only formal hydration before expensive builds.
A redacted ruleset response is not proof that its bypass list is safe. Keep candidate Actions
permissions read-only; plan A requires a local administrator's independently signed observation
bound to the exact run/source and live policy version, plus the designated reviewer's protected-environment
approval. Follow `docs/CANDIDATE_GATE_A.md`; missing/expired proof fails before credential access.
A release tag may only promote the same verified, digest/provenance-bound artifacts; changing a
source/lock/toolchain/policy input invalidates their receipt. Do not rebuild different bytes after tag.

Never hand-edit `dist/`, `src-tauri/target/`, packaged apps/installers, updater metadata, or ignored sidecar binaries. `scripts/refresh-sidecar.sh` is the development path for refreshing sidecars; commit the intended `SIDECAR_VERSION` and full `SIDECAR_COMMIT` locks, not ad-hoc binaries. Keep versions synchronized across `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

A protected stable `vX.Y.Z` tag is a production release authorization. The tag workflow pins the exact tagged CLI sidecar, builds native packages, creates a hidden draft, and only the protected signing/notarization lane may promote it. Do not manually publish, replace signed assets, move/delete a release tag, or bypass the production environment. Verify the public release, updater metadata, signatures, and packaged sidecar before announcing it.

## Security & Hara Feedback

Never commit updater private keys, Apple credentials, certificates, tokens, `.env` files, session data, or user project content. Do not weaken localhost origin/auth checks or move tool permissions into the renderer.

Use the project's privately configured feedback channel for intake and status. Pull the newest messages and relevant attachments before issue work. Report discovered bugs with Desktop and bundled CLI versions, reproduction/evidence, and expected versus actual behavior, always redacted. After a verified release, reply to each original fixed report with the fixed version and focused checks, then post the group-level version, concise changes, upgrade instructions, and verification request; mention any named tester. Keep channel identifiers and internal operator assignments outside the public repository.
The shared Feishu helper accepts `messages --preview-limit` values from 1 through 100; keep previews within
that bound and use `--output` when a complete redacted export is required.
Before projecting any helper JSON with `jq`, inspect its top-level keys and value types; Feishu
`messages --output` stores the message array under `.messages`, not at the top level.
