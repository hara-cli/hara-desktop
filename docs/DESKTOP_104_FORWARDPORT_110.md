# Browser preview and signing safeguards in 1.1.0

The redesigned workspace preserves the browser preview and release-signing safeguards while
keeping the current UI, version metadata and exact sidecar source lock.

## Behavior mapping

- The preview stays in the redesign's `WorkspaceBrowserExtension` / `workspace-browser.css` grid
  column beside chat. Expanding changes the preview column width, not the chat's visibility or
  conversation state. Keep the loopback-only URL validation, opaque iframe sandbox, independent
  error boundary, and English / Simplified Chinese / Traditional Chinese controls.
- The updater file reader and explicit `codesign --keychain` wrapper remain in place.
  The formal signed build checks the existing private file before unlocking the dedicated
  Developer ID keychain. No login-Keychain updater lookup or search-list/default/ACL/partition/settings
  mutation is added. No signing credentials are read during the synthetic regression run.
- Keep stable tag/source, Core lock, toolchain, updater verification, notarization, and publication
  guards. These UI changes do not authorize release or runner configuration changes.

## Verification boundary

Node regressions use synthetic keys and private homes. Preview tests cover the real component's
localized controls, sandbox boundary and layout beside chat. Full Desktop tests, release metadata,
the production renderer build and native host checks are separate gates.

Component regressions do not establish package signing, notarization, upgrade compatibility or
native visual acceptance. See [WORKFLOW.md](../WORKFLOW.md) for the release safeguards.
