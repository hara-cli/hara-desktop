# hara two-repo workflow — hara-cli (core) × hara-desktop (shell)

> Synthesized from codex (tag-driven multi-stage release, version-in-source, checksummed artifacts)
> and cc-haha (quality-gate lanes, packaged-app smoke, draft-release→validate→publish, release-notes
> files). Adapted for our shape: TWO repos, the desktop bundles hara-cli as a Tauri sidecar binary.

## Version coupling

- **hara-cli** versions independently (`package.json`, SemVer-ish pre-1.0: minor = feature).
- **hara-desktop** versions independently, but every desktop build **records the exact sidecar
  version it bundles** (`src-tauri/binaries/SIDECAR_VERSION`, written by the refresh script).
- Compatibility is contractual through the serve protocol: `initialize` returns
  `capabilities.methods`; the desktop feature-detects and degrades (never assumes).
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
- hara-desktop: `npm run check:release` + `npm run build` (tsc+vite) + `cargo check`.

## Release train (strict order — CLI first, desktop rides behind)

1. **hara-cli**: gate green → bump version + CHANGELOG → commit → push main →
   `git tag vX.Y.Z && git push origin vX.Y.Z` → CI (`publish-npm` + `release`) →
   verify `npm view @nanhara/hara version --registry https://registry.npmjs.org`
   (npmmirror lags minutes) → docs.hara.run changelog (en+zh) → Feishu notice @冬芹 @汉青.
2. **hara-desktop**: `./scripts/refresh-sidecar.sh` (now bundles the released CLI) → commit →
   bump desktop version → `git tag vA.B.C && git push origin vA.B.C` →
   CI `build.yml` (4 platforms, cross-compiles the sidecar from the exact
   `v<SIDECAR_VERSION>` hara-cli tag, signs updater artifacts with
   `TAURI_SIGNING_PRIVATE_KEY` secret) → published GitHub Release → validate assets
   (dmg/msi/deb/rpm + latest.json + .sig per platform).

Local signed build (updater artifacts):
```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/hara-desktop.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri build
```
The dmg bundling step (`bundle_dmg.sh`) is flaky when a previous Hara volume is mounted —
detach `/Volumes/Hara*` and delete `bundle/*/rw.*.dmg` before retrying.

## Hotfix path

CLI bug: fix on hara-cli main → patch tag → npm → desktop `refresh-sidecar` → desktop patch tag.
Desktop-only bug: fix → desktop patch tag (sidecar unchanged, stamp already recorded).

## Quality-gate roadmap (adopt from cc-haha, in order)

1. ✅ unit+e2e, tsc/cargo gates, manual smoke
2. ✅ **package-smoke** (`scripts/package-smoke.mjs`, local + CI post-build): bundle structure,
   sidecar executes + matches SIDECAR_VERSION stamp, dmg/updater archive/.sig present
3. next: full handshake smoke (launch packaged app headless, assert serve `initialize` succeeds)
4. later: release-notes file required by CI before publish; checksum manifest on releases;
   quarantine list for flaky tests (14-day review rule)

## Secrets & signing

- `TAURI_SIGNING_PRIVATE_KEY` (GH secret, hara-desktop) = contents of `~/.tauri/hara-desktop.key`
  — updater artifact signing. **Never commit the key.**
- Apple Developer ID Application cert is held on the controlled release Mac; CI macOS artifacts
  stay unsigned until `scripts/build-mac-signed.sh` + `scripts/release-mac-assets.sh` replace them
  with signed, notarized, stapled assets.
