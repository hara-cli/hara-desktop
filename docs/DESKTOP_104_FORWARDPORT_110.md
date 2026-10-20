# Cancelled 1.0.4 fixes carried into 1.1.0

Jeff cancelled Desktop 1.0.4 on 2026-10-20. Its tag and hidden draft are retained; stable remains
1.0.3. This change is based on the committed 1.1.0 redesign at `422eb866` and does not import the
old 1.0.4 version stamps, legacy UI, release artifacts, or another window's uncommitted channel work.

## Behavior mapping

- The preview stays in the redesign's `WorkspaceBrowserExtension` / `workspace-browser.css` grid
  column beside chat. Expanding changes the preview column width, not the chat's visibility or
  conversation state. Keep the loopback-only URL validation, opaque iframe sandbox, independent
  error boundary, and English / Simplified Chinese / Traditional Chinese controls.
- Carry the approved 1.0.4 updater file reader and explicit `codesign --keychain` wrapper into
  1.1.0. The formal signed build checks the existing private file before unlocking the dedicated
  Developer ID keychain. No login-Keychain updater lookup or search-list/default/ACL/partition/settings
  mutation is added. No signing credentials are read during the synthetic regression run.
- Keep stable tag/source, Core lock, toolchain, updater verification, notarization, and publication
  guards. `.github/workflows/` is unchanged in this integration; the requested workflow/cache/parallelism
  improvements remain a read-only proposal in the root release retrospective.

## Verification boundary

The Node regressions exercise fake keys/private homes and the actual preview component in SSR plus
source/layout contracts. Full Desktop tests, release metadata, and the production renderer build
pass. One sandboxed run failed loopback listener checks with `listen EPERM`; the unchanged suite
passes with loopback permitted. Keep both logs rather than editing assertions or skipping tests.

No Rust implementation is changed. This is not a native Intel/ARM package, Developer ID signing,
Apple notarization, visual screenshot, upgrade, or published-channel acceptance receipt. Those remain
mandatory for the future 1.1.0 candidate on both Mac architectures. See
`../../inbox/2026-10-20-codex-release-failures-retro.md` for the proposed pre-tag package gate.
