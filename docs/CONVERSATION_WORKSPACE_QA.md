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
