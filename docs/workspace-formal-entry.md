# Workspace entry candidate — local verification, not a release

The default Desktop entry is now Workspace. It does not check `DEV` or
`VITE_HARA_WORKSPACE_DEV`. Main Hara and approved colleagues run the built-in Pi SDK. Start with
one Workspace, configure its own model connection in the settings drawer, chat with Hara, approve
one colleague card, complete a task and reopen the same Workspace to see retained history.

The native host attaches to or starts its bundled Core with `hara workspace serve --root ROOT`.
It accepts only the private, typed `workspace.v1` discovery under
`ROOT/home/.hara/workspace-runtime/serve-v2.json`. Lab discovery and prior bounded real-key
acceptance are separate protocols/roots, never fallback providers. An unknown startup retains the
same owned child; retry observes it instead of starting a second Core. Window closure does not
cancel an accepted background task. Reopening is read-only until an explicit new send/resume.

Operator-only `HARA_DESKTOP_WORKSPACE_ROOT` can select a canonical, owned, private root. It must be
empty on first open or carry its formal identity marker. The renderer cannot supply a path. Default
roots live under the app's Hara data directory in `workspaces-v1`. Unmarked/unsafe old directories
fail closed; this slice does not chmod, migrate, delete or import existing memories/connections.

For an explicit UI rollback set `HARA_DESKTOP_LEGACY_ENTRY=1` before launching the application;
unset it (or set `0`) to return. Rollback changes the entry only, not Workspace storage or frozen
run bindings. The old SDK-backed Claude adapter is unavailable without its removed SDK; no native
or account fallback is silently substituted. Keep prior production artifacts for a binary rollback.
Lab (`com.nanhara.hara.workspace-lab`) remains an explicit, separate acceptance application.

## Runtime distribution

Pi is the only preinstalled Agent runtime. Desktop external binaries are Core (including Pi) and
the existing non-Agent Herdr relay helper. No `hara-code-runtime`, OpenCode native optional package,
Claude Agent SDK or embedded standalone OpenCode is shipped. Packaging, DMG/updater inventory and
sidecar manifest gates reject their return; native Pi execution is checked separately.

In the Workspace settings drawer choose an optional tool. The host reads official stable version
metadata, then shows the exact version, origin, target, size cap and SHA256 in an approval card.
Only approval permits binary download. Downloads are bounded/cancellable; unsafe redirects,
checksum/architecture mismatch, links and unsafe archives cannot register. Files are published
without overwriting existing paths, then registered under the exact Workspace resource generation.
Each resolve rechecks owner/mode/native header and executable hash. Credentials are not used for
downloads. No shell installer/postinstall runs; global `~/.claude` and `~/.codex` are untouched.

Registration is not Agent execution permission, vendor authentication, code-signing verification,
or proof of live vendor compatibility. The three optional general-Agent drivers are not opened in
this slice; installation does not silently rebind a colleague. Tests use inert native headers and
local fixture archives. Public vendor releases, ABI/dependency availability and actual native CLI
login remain separate validation; missing vendor checksums fail closed rather than bypass checks.

## Signing/notarization checklist (not executed)

1. Authorize a new release version/tag; Core tag, full source SHA and Desktop sidecar lock must agree.
   A local candidate SHA is not an existing published tag; do not weaken the tag/origin gates.
2. Run native platform, npm artifact, Pi-only absence, Pi SDK execution and packaged UI smoke gates.
   A local unsigned macOS ARM64 candidate is not Windows/Linux/Intel or public-channel acceptance.
3. In the authorized signing job only, provide Developer ID/updater signing material through the
   existing private secret mechanism. Sign the shell, Core and Herdr once; removed optional binaries
   are neither required nor signed. Do not export credentials to the renderer or evidence pack.
4. Verify nested strict signatures, expected authority/timestamps, updater signature, bundle source,
   DMG and updater inventory. Submit notarization, confirm success, staple and assess Gatekeeper.
5. Only after independent approval: release upload/promotion, platform/download verification, ASO
   records and linked Feishu closure. None of these are authorized or performed by this slice.
