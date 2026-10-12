# Conversation-first workspace: stage 1

Source version: Desktop 0.1.185, prepared for the protected release pipeline. Local acceptance
does not establish publication; public release evidence is recorded separately. The preceding
Desktop 0.1.184 does not include this follow-up. Engine 0.186.0 and its exact source lock are unchanged.

## Scope

- Agent contacts use their public identity, a readable preview from an already loaded transcript,
  and a persistent details/history action. No background history fan-out is added. When the latest
  transcript has not been loaded, the contact shows its public role, not a fabricated message.
- One `New` menu separates continuing a colleague's chat, explicitly starting a fresh topic, and
  creating an Agent. The last action reuses the existing recommendations/custom recruitment flow.
  It preserves Personal-Space and negotiated capability checks.
- The lazy colleague drawer is read-only. It keeps counted history, the existing profile editor,
  public workspace metadata and an explicit permission boundary. Escape, Tab wrapping, inert
  background and focus restoration do not clear drafts or stop execution.
- The chat uses open assistant text, a compact automatically growing composer, a visible focus
  ring, and consistent choice/approval card alignment. Existing send/stop, attachment eligibility,
  IME handlers, permission decisions and concise tool presentation remain authoritative.
- At narrow widths, contact navigation becomes single-pane. Successfully opening an authorized
  historical conversation returns to chat. Advanced external-session pages are excluded.
- A conversational artifact dock cannot leave the chat narrower than 480px. Below 960px of work
  area it becomes single-pane with a labelled `Back to chat` action. Pending approvals retain a
  readable chat above the artifact. Collapsing the dock releases its layout space, including while
  an approval is pending. Project and Office docks do not adopt this new conversation layout.

## Reproducible component browser gate

Use the repository-pinned Node version, installed locked dependencies, and a locally installed
Chrome/Chromium (or an explicit `CHROME_PATH`). Start a task-owned Vite port:

```sh
npm run dev -- --host 127.0.0.1 --port 54988
node scripts/conversation-visual-smoke.mjs http://127.0.0.1:54988/ /absolute/private/evidence-directory
```

The runner launches its own headless browser and disposable profile. It never attaches to the
user's Chrome or starts an Engine. The DEV-only fixture mounts the real contact, menu, drawer,
composer, timeline, choice, approval and extension components with synthetic data. Both the route
and its lazy import are DEV-gated; the production assets exclude `ConversationPreview`.

The gate checks 73 layout combinations:

- 16 regular chats: Chinese/English × light/dark × 720/900/1100/1280px.
- 48 long-content, choice and approval layouts across those languages, themes and widths.
- 5 open/closed artifact layouts: 720/900/1100/1280/1600px.
- 4 pending-approval plus artifact layouts, including the complete card within the scroll viewport.

Additional interactions cover multiline growth/capping, draft preservation, drawer focus/inert/Escape,
New-menu keyboard navigation, IME Enter suppression, synthetic send, narrow contact selection,
one-action approval resolution, choice keyboard navigation, a genuinely loaded 72% dock preference,
maximizing, and returning to chat. Renderer exceptions, overflow and private-profile cleanup fail
the runner. Results and screenshots are saved to the explicit evidence directory.

The `--record-extension-baseline` option records the four-width original layout without asserting
readability. Before the fix, the 1100px and 1280px synthetic windows measured only 353px and 436px
of chat beside the dock. This was measured, not inferred from a CSS percentage.

## Local acceptance, 2026-10-12

- `npm test`: 476 passed, 0 failed. Tests that bind temporary loopback listeners require a host
  environment permitting that operation; sandbox EPERM is not an application assertion failure.
- Browser runner: 73 layouts passed; renderer exceptions absent; owned browser/profile cleaned.
- `npm run check:release`: passed for the 0.1.185 release candidate, with Engine 0.186.0 unchanged.
- `npm run build`: TypeScript, production Vite build and asset gate passed; no conversation preview
  asset in the production output. The existing main-chunk size warning remains; it is not waived
  as a performance measurement.
- Pinned Rust 1.97.0 `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- `git diff --check`: passed.

## Boundaries and remaining work

This gate is **component/layout acceptance**, not packaged-WebView, public-network, external-send,
provider, real coding-session or business acceptance. It does not measure sustained 20+ token/s
streaming; the existing follow-scroll, up-scroll protection and timeline memoization are unchanged.

The permanent Conversation/Message/TaskRun projection, stable message identities, pagination,
multi-client cursors and durable group chats remain ADR-UI-004's next stages. A session-scoped Agent
Room is not relabelled as persistent group chat. Global schedules remain global until the data has
an authoritative Agent owner; no ownership is guessed from names.

No installer, updater manifest, website deployment or installed-app replacement is established by
this local UI acceptance. Publishing 0.1.185 must use the normal immutable protected pipeline and
close the linked Hara feedback report only after the public artifacts are verified.

## Desktop 0.1.186 candidate: the main assistant as a distinct contact

This follow-up is not in the frozen `v0.1.185` tag. It was developed and verified in an isolated
clone of that exact source while the protected release was running.

- Separate the coordinator above the recency-ordered colleague list, with a sticky main-contact
  section. Preserve the caller's existing searched, Space-filtered entries and original open/history
  handlers. No new catalog requests, sessions, subscriptions or permissions are introduced.
- Identify the coordinator by `main` or the authoritative `root_orchestrator` role, never by its
  nickname. An ordinary colleague named Hara is not promoted to a coordinator.
- Reuse `src/mark.tsx` and the existing `src/assets/hara-mark.svg` as the default main portrait.
  No brand master, platform icon, generated avatar or packaging asset is changed. A valid chosen
  avatar wins; removing it restores the canonical mark. Accent settings affect the frame, not the
  logo's approved colors. Idle is not shown as a verified online connection.
- Keep existing profile authorization, revision checks, avatar validation and explicit save/default
  restoration behavior. A renamed main assistant retains its permanent role and cannot be dismissed.
- Local regression: 478 tests pass; TS/Vite production build and 34-asset gate pass. The browser gate
  retains the original 73 scenarios and adds four scrollable main-contact layouts plus two synthetic
  profile upload/save/reset flows (Chinese/English): 79 scenarios, cleanup passed.

These are synthetic UI checks only. They do not establish server-side profile persistence,
multi-client synchronization, packaged WebView or external-action acceptance. The existing production
profile API and permission authority are unchanged.

### Independent candidate recheck, 2026-10-12

The isolated 0.1.186 candidate passed all 478 regressions, release metadata, the production renderer
build and its 34-asset gate, and the production dependency audit (0 advisories). The pinned Rust
1.97.0 host check passed with at most two build jobs; Cargo regenerated only the root package
version in its lockfile, and the subsequent locked check passed. As in CI, ignored `/usr/bin/true`
sidecar fixtures were used only for the native compile check, never as release binaries.

The synthetic browser gate independently passed all 79 scenarios. Chinese main-contact scrolling
and avatar reset screenshots were also inspected. Its own Vite process, headless browser and
disposable profile were closed; it did not attach to the user's browser or start an Engine.
These checks do not replace the protected packaging/signing/public-edge gates or establish a
production gateway deployment. Exact release identities and publication evidence are recorded
separately after those gates pass.

### Final bundled-Engine candidate recheck, 2026-10-12

The candidate now locks Engine 0.186.1 to exact commit
`28e7c6c863687f6762ba3d1cb57528abb8a9ccb4`. The CLI production change removes only each
completed polling wait's own abort listener; queued delivery and retries are unchanged. No UI
implementation or avatar asset changed in this lock update.

The final lock passed all 478 Desktop regressions (0 failures, cancellations or skips), release
metadata validation, TypeScript/Vite production build and the 34-asset check, the pinned Rust
1.97.0 host check with two build jobs, and the official-registry production audit (0 advisories).
The earlier 79-scenario browser evidence applies to the unchanged renderer, not a new live-gateway
or native packaged-app acceptance claim. The ignored compile-only sidecar fixtures remain excluded
from signed release builds.

Neither these checks nor a Desktop installation switch a separately running gateway. Live CPU,
single-consumer maintenance and real receive/send acceptance remain separately pending. Email/Desk
integration and the newly audited understanding-gate, archived-colleague restore, creation-scope
and detailed auto-pause improvements are not included in this patch. Protected signing, notarization,
public-edge verification and first-party updater/CDN verification must pass before release closure.
