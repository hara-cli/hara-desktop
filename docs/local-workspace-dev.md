# Isolated native Workspace Lab

This opt-in Dev lane proves local Workspace → scoped connection → main Hara → confirmed Pi
colleague → delegated file task → restart recovery. It is not a release, migration, real-model
quality evaluation, or the old `local-runtime-dev.mjs` profile-based mode.

Use the approved isolated Core/Desktop branches. Commit their candidate source before startup;
the harness refuses unrelated or dirty tracked checkouts. Existing dependencies/toolchains must
already be present. No install, sidecar refresh, updater, deployment, or real Key is needed.

```bash
export PATH=/Users/zhujianbo/.rustup/toolchains/1.97.0-aarch64-apple-darwin/bin:/Users/zhujianbo/.nvm/versions/node/v22.23.1/bin:$PATH
mktemp -d /private/tmp/hara-workspace-demo.XXXXXX
# Copy the returned canonical private path as ROOT below; keep it for restart.
npm run dev:workspace -- --core /ABSOLUTE/CORE/WORKTREE --root /private/tmp/hara-workspace-demo.REPLACE
```

The root must initially be empty, owned and mode 0700; only a marked synthetic fixture can be
reopened. Use that exact same root to restart. Logs/receipt paths are printed without transport
tokens. `--smoke` builds/starts/authenticates/stops only the isolated backend, without native UI.
`HARA_WORKSPACE_LAB_TARGET=/ABSOLUTE/PRIVATE/TARGET` optionally reuses this lane's Cargo target.
Cargo is offline. Do not point it at a current Dev target.

The native app has a separate identifier `com.nanhara.hara.workspace-lab`, title
`Hara Workspace Lab`, frontend port 1437 and HMR 1438. Occupied ports are a stop, never authority
to kill another process. Only the harness's own detached native group and backend child are
stopped on Ctrl-C/exit. Root, project and receipts are retained. Do not delete locks or force
restart if the receipt says `drain-not-confirmed`.

In the native window:

1. Create a personal Workspace. Main Hara is pinned and uses Pi.
2. Enable **本機合成連接**. The settings drawer shows `hara-synthetic-v1`, never a Key input.
3. Send `你好`; this is a fixed synthetic response through the actual governed Pi driver.
4. Send `建立 Pi 同事 Coder`, then approve the inline card once. Declining must create nobody.
5. Send `委派 Coder 生成 hello.md 並驗證`. Read the completion in main Hara and inspect Coder's
   separate chat. The file is `ROOT/project/WORKSPACE_ID/hello.md`, not real projects. Every
   Workspace has a distinct project root; an identical relative filename never reuses another's file.
6. Quit only this lab, rerun the same command/root, and inspect the same Workspace/connection/
   colleague/transcripts/completion before sending anything. Viewing history does not run models.

Create a second Workspace using ＋ to inspect isolation. Switching while a creation card is open
invalidates it. Old callbacks must not repaint the new space. Tool output is collapsed by default.
Send status is single-flight; an unknown outcome can be checked only with the retained original
request, not automatically resent. Restart never resumes an interrupted task without a click.

This synthetic lane refuses every other model/endpoint/Key before calling it. The script understands
only these fixed scenarios; that is an intentional safety boundary, not evidence of real reasoning.
No Account/enterprise/remote host, channels, Desk, Codex/Claude/OpenCode general-agent driver, or
legacy history migration is included. Those remain separate work.

Earlier Lab candidates used a shared fixture project. Retain those roots as earlier evidence;
do not migrate their interrupted RunBindings or artifacts into this candidate. A mismatched
project-root binding is readable but execution is refused before Provider construction.
Start a fresh empty fixture for this candidate, then reuse that root for its restart test.

Computer Use may relaunch a quit `.app` while asking for its AX tree. The Lab native preflight
requires both the explicit fixture root and matching private Home before setup; a GUI-only
relaunch without these fails closed. After quitting, inspect the owned process receipt instead
of asking an automation tool to reopen it. The harness always supplies the required environment.
