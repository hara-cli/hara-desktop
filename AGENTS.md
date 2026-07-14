# Repository Guidelines

## Scope & Structure

Hara Desktop is a Tauri shell around the Hara CLI server; agent logic and permission decisions remain in `hara serve`. React/TypeScript UI code is in `src/`, Rust host code and Tauri metadata in `src-tauri/`, release/build helpers in `scripts/`, and tests in `test/`. Read `WORKFLOW.md` before changing sidecar, updater, signing, or release behavior.

Preserve protocol-v1 session, approval, interruption, and capability negotiation semantics. Keep the four-place UI model and notification rules documented in `README.md`; automated runs remain read-only replays unless explicitly forked.

## Development & Tests

- Use the exact Node, Bun, and Rust versions pinned by `.node-version`, `.bun-version`, and `.rust-version`.
- `npm ci` installs the locked frontend/tooling dependencies.
- `npm test` runs release, protocol, packaging, and UI regression tests.
- `npm run check:release` validates Desktop, Tauri, Cargo, sidecar, and toolchain metadata.
- `npm run build` runs TypeScript and the Vite production build.
- `cargo check --manifest-path src-tauri/Cargo.toml` checks the native host.
- `npm run tauri dev` runs the desktop app for an interactive smoke test.

Add focused tests for renderer state and release scripts. For native changes, validate both Rust and frontend behavior; for `hara serve` integration, exercise disconnect/reconnect, approvals, and interruption paths.

## Generated Output & Release Boundary

Never hand-edit `dist/`, `src-tauri/target/`, packaged apps/installers, updater metadata, or ignored sidecar binaries. `scripts/refresh-sidecar.sh` is the development path for refreshing sidecars; commit the intended `SIDECAR_VERSION` and full `SIDECAR_COMMIT` locks, not ad-hoc binaries. Keep versions synchronized across `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

A protected stable `vX.Y.Z` tag is a production release authorization. The tag workflow pins the exact tagged CLI sidecar, builds native packages, creates a hidden draft, and only the protected signing/notarization lane may promote it. Do not manually publish, replace signed assets, move/delete a release tag, or bypass the production environment. Verify the public release, updater metadata, signatures, and packaged sidecar before announcing it.

## Security & Hara Feedback

Never commit updater private keys, Apple credentials, certificates, tokens, `.env` files, session data, or user project content. Do not weaken localhost origin/auth checks or move tool permissions into the renderer.

The canonical intake and status channel is Feishu `hara 反馈群` (`oc_17590648f393135cde6a6b9cd6f1c710`). Pull the newest messages and relevant attachments before issue work. Report discovered bugs with Desktop and bundled CLI versions, reproduction/evidence, and expected versus actual behavior, always redacted. After a verified release, reply to each original fixed report with the fixed version and focused checks, then post the group-level version, concise changes, upgrade instructions, and verification request; mention any named tester.
