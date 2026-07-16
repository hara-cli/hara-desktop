# hara two-repo workflow — hara-cli (core) × hara-desktop (shell)

> Synthesized from codex (tag-driven multi-stage release, version-in-source, checksummed artifacts)
> and cc-haha (quality-gate lanes, packaged-app smoke, draft-release→validate→publish, release-notes
> files). Adapted for our shape: TWO repos, the desktop bundles hara-cli as a Tauri sidecar binary.

## Version coupling

- **hara-cli** versions independently (`package.json`, SemVer-ish pre-1.0: minor = feature).
- **hara-desktop** versions independently, but every desktop build **records the exact sidecar
  version and Git commit it bundles** (`SIDECAR_VERSION` + `SIDECAR_COMMIT`, written by the refresh
  script). Formal builds reject a CLI tag whose peeled commit differs from that committed lock.
- Compatibility is bounded, not indefinite: supported sidecars negotiate through `initialize` and
  `capabilities.methods`; a sidecar below the declared minimum fails fast with an upgrade command
  instead of accumulating compatibility branches. Node.js is a build/npm-install requirement only;
  users of the standalone CLI or Desktop bundle do not need a system Node runtime.
- Desktop release notes must state the bundled sidecar version.

## Daily dev

```bash
# hack on hara-cli → refresh the desktop's bundled sidecar:
cd hara-desktop && ./scripts/refresh-sidecar.sh          # builds ../hara-cli → binaries/ + version stamp

# desktop UI work:
npm run tauri dev                                        # uses PATH hara OR bundled sidecar
```

Gates before ANY push (either repo):
- hara-cli: `npx tsc && node --test test/*.test.mjs` — all green, no exceptions.
  ⚠️ if another session's WIP is in the tree, gate with `git stash push -- <wip files>` (targeted),
  never a bare `git stash` (it hides your own work too).
- hara-desktop: the exact Node/Bun/Rust versions in `.node-version`, `.bun-version`, and
  `.rust-version` (older toolchains fail fast with the upgrade command), then
  `npm test` + `npm run check:release` + `npm run build` (tsc+vite) + `cargo check`.

## Release train (strict order — CLI first, desktop rides behind)

1. **hara-cli**: gate green → bump version + CHANGELOG → commit → push main →
   `git tag vX.Y.Z && git push origin vX.Y.Z` → CI (`publish-npm` + `release`) →
   verify `npm view @nanhara/hara version --registry https://registry.npmjs.org`
   (npmmirror lags minutes) → docs.hara.run changelog (en+zh) → Feishu notice @冬芹 @汉青.
2. **hara-desktop**: `./scripts/refresh-sidecar.sh` for development, while formal signed builds use
   a disposable detached worktree from the origin-matching stamped CLI tag (so sibling WIP is never
   bundled) → commit →
   bump desktop version → `git tag vA.B.C && git push origin vA.B.C` →
   CI `build.yml` creates a hidden draft, builds on four native target runners from the exact
   `v<SIDECAR_VERSION>` hara-cli tag only when it resolves to `SIDECAR_COMMIT`, executes `--version`
   normally and with `SharedArrayBuffer`
   disabled plus a hostile-cwd `.env`/`bunfig.toml` boundary probe, `--help`, and `serve --help`
   before and after packaging, and signs updater artifacts
   with `TAURI_SIGNING_PRIVATE_KEY`. A single CI job then builds and validates `latest.json` and
   leaves the complete release hidden as a draft. The same tag workflow then automatically enters
   the protected `hara-desktop-production` environment on the controlled Apple Silicon self-hosted
   runner labelled `hara-desktop-release`; no second dispatch is required, and CI never promotes
   unsigned macOS artifacts. The entire workflow holds one tag-scoped concurrency lock, while direct
   local stable promotion is rejected, so draft assembly can never race signed asset replacement.
   The guarded job checks Node/Bun/Rust, exact clean
CLI/Desktop tags, both architectures, the sidecar before and after Developer ID signing and inside
`Hara.app`, then notarizes/staples both DMGs. Matrix receipts and the public source-provenance asset
bind every platform to the committed Desktop/CLI source locks and Node/Bun/Rust versions; every updater artifact receives
streaming minisign verification against the public key embedded in `tauri.conf.json`. The promotion
job also requires run-scoped, atomic provenance markers for both signed Mac architectures. Those markers
live outside Tauri-owned bundle directories, are invalidated before each attempt, and can be written only
after signing, notarization, and package smoke complete. The signing script uses an explicit completion
sentinel because macOS Bash 3.2 can otherwise report some fatal `set -u` exits as status zero. The job
re-downloads and validates the entire draft before it alone promotes stable. Afterward,
send the required notice to Feishu `hara 反馈群` and reply to the original fixed bug reports.
Repository settings must keep immutable releases enabled and `hara-desktop-production` restricted
to exactly one custom deployment policy, the `v*` tag policy, with no manual reviewer rule. An
active Desktop `v*` tag ruleset must restrict creation, update, and deletion to an explicit
release-admin bypass actor so `GITHUB_REF_PROTECTED` is true and ordinary writers cannot authorize
a release by creating a tag. The workflow pins that actor by immutable numeric user ID and requires
the ruleset bypass set to contain exactly that one `User` in `always` mode. The original stable tag creation by that bypass actor is the release
authorization; do not add a second manual dispatch or environment approval. Promotion verifies GitHub's signed
immutable release attestation after publication. Store a fine-grained token with repository
`Administration: read` only as the environment secret `HARA_RELEASE_POLICY_TOKEN`; it is used solely
to fail closed on the immutable-release policy immediately before publication. Assign the custom
runner label only to the signing Mac whose dedicated `hara-ci-signing` keychain contains the
Developer ID identity and whose `~/.tauri` contains the notarization/updater keys. A
GitHub-hosted preflight fails before signing unless the tag-scoped environment protection exists;
GitHub's `runs-on` scheduler then requires the labelled signing runner to be online.
The dmg bundling step (`bundle_dmg.sh`) is flaky when a previous Hara volume is mounted —
detach `/Volumes/Hara*` and delete `bundle/*/rw.*.dmg` before retrying.

## Hotfix path

CLI bug: fix on hara-cli main → patch tag → npm → desktop `refresh-sidecar` → desktop patch tag.
Desktop-only bug: fix → desktop patch tag (sidecar unchanged, stamp already recorded).

## Quality-gate roadmap (adopt from cc-haha, in order)

1. ✅ unit+e2e, tsc/cargo gates, manual smoke
2. ✅ **package-smoke** (`scripts/package-smoke.mjs`, local + CI post-build): bundle structure,
   native target architecture, sidecar version/help/serve-help execution, mounted-DMG inspection,
   hostile-cwd boundary checks, and signed updater assets
3. next: full handshake smoke (launch packaged app headless, assert serve `initialize` succeeds)
4. later: release-notes file required by CI before publish; checksum manifest on releases;
   quarantine list for flaky tests (14-day review rule)

Windows MSI/NSIS updater files are minisign-verified by the current pipeline but are not yet
Authenticode-signed. Integrating a Windows signing service is a separate release-hardening item;
until then, documentation and release notices must disclose possible SmartScreen warnings.

## Secrets & signing

- `HARA_TAURI_SIGNING_PRIVATE_KEY` (the `hara-desktop-production` environment secret, exposed to
  Tauri only as `TAURI_SIGNING_PRIVATE_KEY` inside its build steps) = contents of
  `~/.tauri/hara-desktop.key` — updater artifact signing. Keep it out of repository-level secrets so
  only tag-scoped environment jobs can access it. **Never commit the key.**
- Apple Developer ID Application cert is held on the controlled self-hosted release Mac; tag CI
  macOS artifacts stay unsigned and hidden until protected `build.yml` promotion invokes
  `scripts/build-mac-signed.sh` + `scripts/release-mac-assets.sh` to replace them with signed,
  notarized, stapled assets. The runner uses the dedicated
  `~/Library/Keychains/hara-ci-signing.keychain-db`; its random unlock password stays only in
  `~/.tauri/hara-codesign-keychain.password` with mode `0600`. The signed-build script unlocks it,
  performs an ephemeral Developer ID signing probe, restores the prior keychain search list, and
  locks it again on every exit. This random password is not the Mac login password. Ordinary Hara
  launch never touches this keychain; cancel any unexpected GUI prompt instead of guessing a
  password, then run only the guarded build script, which unlocks it automatically. Do not copy the
  password into Actions logs, notes, or chat.
- Bun's linker-generated ad-hoc signature remains attached while the freshly compiled source sidecar
  executes its boundary smoke, then the script removes it and does not execute or pre-sign that source
  binary again. Tauri must perform the sole Developer ID signing pass on the nested copy inside
  `Hara.app`; promotion verifies that copy's expected authority and trusted timestamp before any
  notarized asset can become public.
- Put the signing Mac in a dedicated runner group restricted to `hara-cli/hara-desktop` and the
  release workflow; never schedule pull requests or ordinary CI on it. Prefer an ephemeral runner,
  or clean the workspace completely after every run.
