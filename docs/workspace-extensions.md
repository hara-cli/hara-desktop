# Workspace plugins UI (catalog slice)

The workspace settings sidebar has a Plugins & MCP page. The main Hara/colleague Inspector uses the
same component for that colleague's assignment. Both require `workspace.extensions.v1`; an older
Core shows unavailable and receives no extension RPC. All new copy is English, Simplified Chinese
and Traditional Chinese, using the existing Workspace locale and theme.

The settings page displays safe source metadata, review status, the workspace switch, explicit tool
checkboxes and configured colleague count. The Inspector displays an independent assignment
switch and permits selecting only tools already allowed in the workspace. Nothing is automatically
selected. Empty selections grant nothing. Sources without reviewed tools explain that no tools can
be granted; this slice never probes, installs, starts or invokes an upstream.

Changes remain local drafts until Review change. The Host returns a client-bound proposal; a visible
review shows the source, enable/disable decision and selected tool names. Deciding one source preserves unrelated unsaved source drafts. Confirm change sends
`approved: true` and the exact proposal revision. Cancel rejects the proposal. The authenticated Host
makes all permission decisions; disabled controls are not an authorization mechanism.

Every model method carries explicit workspace ID/generation, permission revision and colleague epoch
where applicable. Late loads/proposals/approvals cannot replace another scope, a newer colleague
epoch, a replacement model, or a later A→B→A view. Duplicate actions are fenced synchronously. The
settings page participates in its existing dirty-leave guard. Unknown save/proposal outcomes and
failed reloads disable mutation until an explicit saved-state read; mutations are never retried blindly.
The colleague Inspector's drafts stay local and are discarded if its view is replaced; no deferred
save follows the user into a different colleague or workspace.

This is the catalog/permission UI only. It does not mean real MCP tools are runnable. New access
requires a fresh future attempt snapshot; removal blocks future dispatch checks immediately. Core's
`docs/workspace-extensions.md` specifies storage, RPC and runtime-manager follow-up boundaries.

Focused tests execute actual component events/effects with deferred RPCs, actual WorkspaceDevModel
methods, and adjacent settings/Inspector regressions. They do not constitute visual/native acceptance:

```sh
npm run build
node --experimental-strip-types --test --test-concurrency=1 test/workspace-extensions.test.mjs test/workspace-colleague-inspector.test.mjs test/workspace-settings-shell.test.mjs test/settings-leave-guard.test.mjs
```
