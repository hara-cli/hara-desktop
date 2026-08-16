# Changelog

## 0.1.81 — 2026-08-16 — official animated Hara and bounded companion motion

- Embed the visually approved Hara v2 `8×11` atlas as Desktop's single official companion, with
  genuine working, waiting, completion, failure, walking, and look-direction poses. The official
  companion no longer depends on a user-local Codex pet package; old 0.1.79 selectors and the reviewed
  `codex:hara` staging package migrate to the same embedded Hara identity.
- Separate task meaning from animation playback. Only dragging and real running work loop; idle holds
  a calm pose after one bounded greeting, while waiting, paused, completed, and blocked gestures also
  play once and settle. Completion notices expire after eight seconds, and `turn_end` now repairs a
  missing or reordered terminal task-state event so the companion cannot remain falsely busy. Enlarge
  the tuck-away hit target and hide the native companion surface immediately before synchronizing the
  settings state, so its close control cannot disappear into the transparent window.
- Reuse the same atlas and state mapping in Agent Office, remove perpetual waiting/blocked motion, and
  add full-scene and selected-station camera modes to the existing owner-scoped 2.5D workspace. Bundle
  unchanged Hara CLI `0.148.0` at exact verified commit
  `675b96fe1904decc73741ed256b720fe71ede087`; existing conversations, projects, Artifacts, and custom
  pets require no migration. Windows packages remain updater-signed but not Authenticode-signed, so
  SmartScreen may still show a reputation warning.

## 0.1.78 — 2026-08-14 — keep the companion action visually attached

- Reduce the transparent companion surface from `260×240` to the compact `220×240` safe envelope and
  place the chat action beside the visible character rather than at the edge of unused atlas padding.
  Mila and the other bundled v2 companions now read as one interaction cluster without reintroducing the
  Retina crop fixed in `0.1.77`.
- Temporarily hide the chat action while the companion is being dragged, so the widest walking frames can
  extend naturally without covering the button. The action returns as soon as movement settles. Bundle
  unchanged Hara CLI `0.147.2`; conversations, projects, schedules, Artifacts, presentations, and pet
  packages require no migration. Windows packages remain updater-signed but not Authenticode-signed, so
  SmartScreen may still show a reputation warning.

## 0.1.77 — 2026-08-14 — migrate companion geometry safely

- Stop the native window-state plugin from restoring sizes for the fixed pet and pet-chat windows. A
  `0.1.75` Retina installation could otherwise restore the former `224x230` physical pet viewport as
  `112x115` logical pixels and override `0.1.76`'s larger renderer, leaving only Mila's torso visible.
- Resolve saved companion positions against each monitor's usable work area, then clamp the complete
  `260x240` logical viewport before creation. Legacy edge positions remain useful without allowing the
  Dock, taskbar, a removed display, or stale native geometry to crop the character or chat action.
- Keep the exact source-pixel atlas renderer introduced in `0.1.76` and add regression coverage for the
  native persistence boundary. Bundle unchanged Hara CLI `0.147.2`; conversations, projects, schedules,
  Artifacts, presentations, and pet packages require no migration. Windows packages remain updater-signed
  but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.76 — 2026-08-14 — complete companion frames and bounded placement

- Render local v1/v2 companion atlases through an exact source-pixel Canvas crop instead of moving the
  complete sheet with percentage offsets, preventing neighboring cells from bleeding into a correctly
  sized transparent companion window under Retina scaling and WebKit layout.
- Give the companion and its chat action separate space, enlarge the intended fixed transparent viewport,
  and add positive- and negative-origin display clamping. Migration of native sizes saved by older Desktop
  builds is completed in `0.1.77`.
- Validate all three installed Codex v2 pets against the 8×11 atlas contract and record the staged Hara
  mascot, custom-asset service, replay, and optional 3D workforce architecture. Bundle unchanged Hara CLI
  `0.147.2` at exact verified commit `7f3ca032c06b58b189ce63f583cb5ec1016c2d63`; conversations, projects,
  schedules, Artifacts, presentations, and pet packages require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.75 — 2026-08-14 — live project-instruction refresh

- Bundle Hara CLI `0.147.2` at exact verified commit
  `7f3ca032c06b58b189ce63f583cb5ec1016c2d63`. Existing Desktop conversations now reload the bounded,
  protected `AGENTS.md` project instructions immediately before each new idle turn, so project-rule edits
  take effect without restarting Hara, reopening the project, or losing conversation history.
- Keep every active turn's system context stable. Steering accepted while work is running does not change
  instructions underneath that execution; the next idle turn receives the refresh. Approval modes, gateway
  sender restrictions, protected-file rules, and the existing 32 KiB instruction cap remain unchanged.
- Existing conversations, projects, schedules, Artifacts, presentations, local files, and pet state require
  no migration. Windows packages remain updater-signed but not Authenticode-signed, so SmartScreen may still
  show a reputation warning.

## 0.1.74 — 2026-08-14 — truthful completion and native local-image inspection

- Bundle Hara CLI `0.147.1` at exact verified commit
  `064c3532bd1de85c653ad10e18e476129eb1ac7d`. Images downloaded or discovered during a task now use
  the conversation's authorized image-capable route through a verified private snapshot. Qwen 3.7 Plus
  no longer detours through project scripts, protected `.env` files, or a second API key to inspect them.
- Keep an accepted task paused until Core receives a fresh final receipt with observable acceptance
  evidence. Asking the user for missing data becomes an explicit resumable `awaiting_user` state instead
  of a false `completed`, and later work invalidates an earlier success receipt automatically.
- Stop interleaved repeated failures from evading the bounded circuit breaker, prefer a matching configured
  MCP service over browsing its implementation, and record the exact Hara engine version in each new or
  resumed session for actionable feedback reports.
- Prefer Git Bash on Windows and reject mixed WSL/drive-letter paths before they resolve to malformed
  locations. Existing conversations, projects, schedules, Artifacts, presentations, and local files require
  no migration. Windows packages remain updater-signed but not Authenticode-signed, so SmartScreen may still
  show a reputation warning.

## 0.1.73 — 2026-08-14 — durable DeepSeek reasoning and scoped image capability

- Bundle Hara CLI `0.147.0` at exact verified commit
  `6b0094b1f747e30ede6f286e77f54f611092fc53`. Direct DeepSeek V4 Flash and Pro connections now expose
  `off` / `low` / `high` / `max` thinking through native stateless Responses and preserve completed
  reasoning across tool rounds; organization connections expose the same choices through their
  server-authorized catalog.
- Improve Chinese task understanding so concise follow-ups such as “开始”, “继续”, and “修复” resolve
  against the active request and checkpoint instead of being treated as casual chat. Bounded read-only
  sub-agents now share a root concurrency budget, isolate child state, support cancellation, and report
  delegated usage without distorting the parent conversation gauge.
- Stop advertising a globally configured image fallback inside an organization session unless that
  company connection explicitly authorizes the model. This removes the false “image compatible” state
  reported in Desktop while retaining the optional fallback for compatible personal connections.
- Compact private Hara directory rules before macOS sandbox compilation so large session stores no longer
  exceed the Seatbelt profile-size limit. Existing conversations, projects, schedules, Artifacts,
  presentations, and local files require no migration. Windows packages remain updater-signed but not
  Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.72 — 2026-08-13 — authoritative turn input routing

- Bundle Hara CLI `0.146.3` at exact verified commit
  `5095315abd44686b5a467b2a7294db3880c6e691`. Desktop now submits composer input through one
  feature-detected Core admission point, so delayed renderer state cannot misroute a new message between
  starting, steering, or queueing.
- Keep attachment text and files together for the next turn, prevent `newTask` input from entering a live
  task, and preserve ordered type-ahead steering. Late turn-end events can no longer acknowledge the wrong
  optimistic message or leave a false busy state; a visible queued message remains retryable.
- Bind staged model and thinking changes to the next fresh turn. Core verifies the expected provider
  configuration at the exact admission boundary, so a turn ending between configuration and send cannot
  start the message on the previous model. Older engines retain the guarded legacy path. Existing
  conversations, projects, schedules, Artifacts, presentations, and local files require no migration.
  Windows packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning.

## 0.1.71 — 2026-08-13 — DeepSeek V4 Pro Responses parity

- Bundle Hara CLI `0.146.2` at exact verified commit
  `09de91e3ac5b029f2287ba9ad7d849d71450f368`. Official direct `deepseek-v4-flash` and
  `deepseek-v4-pro` connections now use the native stateless Responses API; explicit non-thinking mode
  continues through Chat because DeepSeek Responses does not document an `off` reasoning value.
- Keep Hara Control organization connections on their current Chat-compatible route until the managed
  gateway itself exposes `/v1/responses`; official provider support alone never changes a proxy's wire
  contract. Exact hostname/path matching prevents lookalike or custom endpoints from inheriting official
  DeepSeek transport behavior.
- Reject ambiguous Responses streams whose sequence numbers regress or whose output continues after a
  terminal event. Provider exceptions are bounded and credential-redacted before entering Desktop errors
  or durable history. Existing conversations, projects, organization connections, schedules, Artifacts,
  presentations, and local files require no migration. Windows packages remain updater-signed but not
  Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.70 — 2026-08-12 — verified presentation delivery and recovery

- Export PDF as a first-class, receipt-backed file from the exact self-contained presenter instead of
  opening the operating-system print dialog. PDF, HTML, and editable PPTX stay blocked until the exact
  saved revision passes structural, narrative, and rendered-layout validation; advisory findings still
  allow a clearly marked JSON source copy so unfinished work remains recoverable.
- Keep narrative-quality guidance in a bounded panel below the presentation canvas. Localized findings
  identify repeated titles, claims, generic headings, duplicated body copy, repetitive composition, and
  visual monotony; selecting a page-scoped finding opens that slide in the existing inspector without
  covering the preview or exposing raw engine prose.
- Bundle Hara CLI `0.146.1` at exact verified commit
  `4290c3010ad5d66dd03e64c0c2236e047a34dbc9`. It adds native DeepSeek V4 Flash Responses, verified
  local PDF rendering, Agent-deck narrative checks, Windows Chinese-path reads and healthy Bash
  fallback, and lazy MCP capability descriptions. Existing conversations, projects, organization
  connections, schedules, Artifacts, presentations, and local files require no migration. Windows
  packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning.

## 0.1.69 — 2026-08-12 — clearer presentation editing and diagnostics

- Keep presentation diagnostics outside the slide canvas. Validation findings now appear in a
  dedicated panel below the preview, carry localized and actionable copy, and can locate the exact
  slide or content block; the slide rail also marks affected pages without covering authored output.
- Remove the native iframe title tooltip from presentation previews and reserve the canvas for the
  deck itself. The presentation inspector remains a real workbench column, while narrower windows can
  collapse it without creating a second floating workbench or squeezing controls over the slide.
- Improve starter instructions and the native Presentation specialist so generated decks assign one
  narrative job to each page, keep title/claim/evidence/action roles distinct, avoid internal Artifact
  and revision terminology, and move background detail to speaker notes. The shared Presentation
  runtime now chooses opening layouts from content, improves Chinese title wrapping, applies tighter
  density limits, and keeps HTML/PPTX visible blocks aligned.
- Bundle Hara CLI `0.145.1` at exact verified commit
  `fe2edac18a7f0a9234bf38a626e6baed4d769bc2`, including Presentation kernel
  `0.1.0-alpha.8`. Existing conversations, projects, organization connections, schedules,
  Artifacts, presentations, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.68 — 2026-08-11 — dependency-safe release preflight

- Ship the IME composition guard, fail-closed macOS updater architecture check, and exact Hara CLI
  `0.145.0` sidecar described in the 0.1.67 candidate below.
- Keep updater architecture policy and its localized failure copy in a dependency-free module, so the
  protected release preflight can verify it before installing Tauri runtime packages. This release
  supersedes the unpublished 0.1.67 candidate; no 0.1.67 installer or updater manifest was exposed.

## 0.1.67 — 2026-08-10 — reliable input, updates, and browser verification (unpublished candidate)

- Keep Chinese and other IME composition inside the composer. Enter, keypad Enter, and legacy
  `keyCode` 229 events no longer submit while text is being composed; the completed text can still be
  sent normally after `compositionend` across the main Workbench, pet chat, and start screen.
- Make macOS updates fail closed on architecture mismatches. Desktop now supplies the native updater
  target explicitly and independently validates the selected manifest archive before installation, so
  Intel Macs cannot silently receive an Apple Silicon package (or vice versa). The error is localized
  and preserves the installed app when the update feed is inconsistent.
- Bundle Hara CLI `0.145.0` at exact verified commit
  `6b13003319b5322bd9583917713372381b50d2f4`. Website UI and SPA checks can move from bounded text
  extraction to the real system browser with explicit approval; project grants are reused by operation
  family; mid-turn forks use protocol-complete snapshots; and repeated failures plus 50/100-round task
  budgets stop unproductive loops recoverably. Existing conversations, projects, organization
  connections, schedules, Artifacts, presentations, and local files require no migration. Windows
  packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning.

## 0.1.66 — 2026-08-09 — layout-safe presentations and durable permissions

- Measure the final presentation DOM after fonts and wrapping settle. Title/content collisions,
  block overlap, clipping, overflow, and safe-area violations now produce localized slide findings;
  saving a version, verification, browser/PDF output, HTML, and PPTX export remain blocked until the
  exact draft passes. JSON stays available as the recoverable canonical source.
- Make pitch, report, technical, and visual true layout templates independent from color themes.
  Keep the native bar, line, area, pie, and doughnut chart editor bounded to readable category and
  series limits, and surface the same density rules before a draft can become a valid revision.
- Keep the presentation inspector as a real third workbench column at ordinary widths. It can be
  shown or hidden explicitly; on very narrow windows it replaces the canvas stage instead of
  overlaying controls or squeezing the slide into a misleading miniature.
- Add a conversation-scoped permission selector beside the composer for ask-each-time, automatic
  editing, and full-auto. The selected mode is persisted by the engine and survives Desktop
  reconnects and engine restarts; protected paths, screen-control grants, external extensions, and
  explicit deny rules still retain mandatory approval boundaries.
- Bundle Hara CLI `0.144.1` at exact verified commit
  `2c0c9fba736dfd30792040bfadea5f6ea5d8cc08`, including Presentation kernel
  `0.1.0-alpha.7`. Existing conversations, projects, organization connections, schedules,
  Artifacts, presentations, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.65 — 2026-08-08 — editable presentations and a visual workbench

- Make native Hara presentations a complete editable Desktop surface: create or import a structured
  deck, edit its outline and slide content, preview the exact unsaved draft, save a concurrency-safe
  Artifact revision, validate it, present it in fullscreen, open it in a browser, and export HTML,
  JSON, or editable PPTX from the same canonical source. Existing third-party PPTX files remain
  byte-preserved imports rather than being presented as losslessly converted decks.
- Render every accepted nested content shape consistently in Desktop, HTML, and PPTX, including
  columns, flows and architecture diagrams. Add bounded local images, editable native bar, line,
  area, pie, and doughnut charts, four distinct themes, and pitch, report, technical, and visual-story
  starting templates. The embedded Browser remains the print/save-as-PDF path.
- Add an owner-bound, multi-tab Extension Dock beside the Workbench and Office library. It can be
  hidden and restored without closing work, while individual tabs can be closed explicitly. Project
  agents may also show an already-running Node/Vite/Next page there after CLI and Desktop both verify
  a credential-free loopback HTTP URL with an explicit port; arbitrary or authenticated web pages
  still open in the system browser.
- Keep creation and revision conversation-native: Office's new-presentation action now enters the
  same Workbench chat with a focused editable brief, generated results open in the right Dock, and
  the composer visibly targets the selected result only while that Dock is open. “Open in browser”
  creates a sandboxed in-app Browser tab for the exact saved presentation instead of jumping to a
  system browser or requesting permission to open a private preview file.
- Grow the native window to the right when monitor space is available and keep a true resizable split
  at ordinary widths. The selected tab and the content currently receiving keyboard interaction have
  distinct states; collapsing the Dock preserves editor state. In Office, the low-frequency start page
  now yields to a full-width document or Browser stage while the deliverables list remains available;
  the capability cards also reserve their format/action footer so labels no longer overlap.
- Present personal conversations and local projects in one Workbench context index while retaining
  their separate internal places, session authority, working directories, and persisted ownership.
  Opening Office continues to show the durable deliverables library rather than a second chat shell.
- Use one current model for the Presentation Specialist and its focused presentation prompt. Native
  image input remains the normal multimodal path; the optional visual-recognition model is only a
  compatibility fallback when a text-only route must inspect an image attachment, and is not part of
  the default PPT generation or editing path. Spreadsheet and document editors remain explicitly
  planned rather than being implied by the Office shell.
- Update DOMPurify to `3.4.13` and the build-only Nano ID dependency to `3.3.18`, closing the current
  official-registry XSS and denial-of-service advisories before packaging; the complete npm audit now
  reports no remaining vulnerability.
- Refuse to start PPT generation on a still-running engine that lacks native Presentation surfaces;
  Desktop safely switches an idle legacy engine to the bundled one first. If a legacy turn already
  created a deck but lost its surface notification, recover only the native `.hpres` revision written
  by that exact session and turn. Generated HTML, exported PPTX paths, and assistant prose never count
  as proof that a right-side tab opened. Desktop reports success only after loading and verifying the
  exact Artifact revision and preview. If the Artifact advances while the preview is being prepared,
  Desktop automatically loads one coherent latest revision; any remaining failure is shown in the
  selected interface language without leaking the engine's internal exception text.
- Bundle Hara CLI `0.144.0` at exact verified commit
  `6bccfd0744863efb7d552f9f8387c7ce723d3698`. Existing conversations, projects, organization
  connections, schedules, Artifacts, presentations, and local files require no migration. Windows
  packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning.

## 0.1.64 — 2026-08-07 — reliable actions and data-first debugging

- Open explicit local-folder requests directly in Finder or the platform file manager through Hara's
  dedicated, path-safe `open_directory` capability. The action no longer falls into task intake or the
  repeated-failure breaker, while generic shell commands keep their existing safety gates.
- Guide debugging turns to validate real inputs and observable state before editing the reported
  function, then trace missing values through callers and data construction. One ineffective symptom
  edit now triggers upstream data-flow inspection instead of repeated rewrites of the same function.
- Harden the protected release lane against transient Apple notarization URL timeouts and interrupted
  GitHub asset downloads. Retries remain bounded, rebuild signed bundles cleanly, and retain downloaded
  files only after GitHub-declared size and SHA-256 validation; no unsigned or unchecked fallback exists.
- Bundle Hara CLI `0.142.2` at exact verified commit
  `4281e7c360d69f2c9313b5c2e56c172cd277f513`. This release supersedes the unpublished 0.1.63
  candidate. Existing conversations, projects, organization connections, schedules, Artifacts,
  presentations, and local files require no migration. Windows packages remain updater-signed but not
  Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.63 — 2026-08-07 — reliable directory opening

- Open local folders through Hara's dedicated `open_directory` capability, so requests such as
  “把文件目录打开” reach Finder or the platform file manager directly instead of being misclassified as
  an opaque Bash command that requires task intake or trips the repeated-failure breaker.
- Bundle Hara CLI `0.142.1` at exact verified commit
  `a872aa3d6e3677427f92cd796521fffaf8ea318b`. Existing conversations, projects, organization
  connections, schedules, Artifacts, presentations, and local files require no migration. Windows
  packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning.

## 0.1.60 — 2026-08-07 — native presentation workbench

- Add Presentation as a preinstalled Hara capability with a dedicated right-side workbench. Generated
  `hara.presentation/1` decks render in an isolated preview, can enter presentation fullscreen, and can
  open as a self-contained page in the system browser without replacing the active conversation.
- Import bounded Hara presentation JSON and safe Slidev-style Markdown, then inspect and validate the
  normalized deck before delivery. Executable Vue/HTML, local imports, scripts, and remote content are
  rejected instead of being evaluated inside Desktop.
- Export the structured source, a self-contained HTML presentation, or an editable PPTX generated by
  the audited `@nanhara/hara-presentation` runtime. Browser print remains the explicit PDF path.
  Arbitrary legacy PPTX/ODP files still use the byte-preserving Office Artifact flow; this release does
  not claim editable conversion of an existing third-party deck.
- Bundle Hara CLI `0.142.0` at exact verified commit
  `f6eb4b2728847df0da25edc5d073407ede887ef8`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.59 — 2026-08-06 — reliable attachments and execution progress

- Persist pasted clipboard images in Desktop's explicit model-input media surface instead of protected
  private runtime state. New directories and files are owner-only, link-shaped paths fail closed, and
  the persisted media remains available when a later turn resumes the same image-backed conversation.
- Accept native cross-application file and folder drops in the formal conversation composer, not only
  on the empty workbench. Classification remains bounded in the native shell, late results cannot cross
  into another session, and replay-only history continues to reject new attachments.
- Bundle Hara CLI `0.141.1`, which filters leaked reasoning tags from streamed and persisted text, keeps
  user-visible language consistent, shows an explicit model-waiting state after `task_intake`, and keeps
  local preview servers and public tunnels alive as managed background jobs.
- Bundle the exact verified Hara CLI commit
  `7fc73d5cb2e8fad78d8981e43b12f54db6c9ab42`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.58 — 2026-08-06 — recoverable conversations and clearer execution

- Keep old conversations readable when their pinned organization connection or model is no longer
  authorized. Desktop falls back to provider-independent local history, visibly marks the conversation
  read-only, disables every send path, and offers a focused recovery action instead of a blank error page.
- Let users explicitly copy the current conversation into any authorized personal or organization
  connection, including a newly authorized model on the same connection. The confirmation explains
  exactly what is copied; the original stays unchanged and no context reaches the target until the user
  sends the next message.
- Separate the assistant's answer from local execution evidence, add concise, standard, and debug display
  modes, and surface durable task blockers, facts, capability checks, next steps, and artifacts so paused
  work can resume without pretending it finished.
- Show redacted organization service bindings, explain narrowly scoped project approvals, and let enabled
  plugin panels be pinned into the configurable module dock without weakening the fixed Settings recovery
  entry or workspace ownership boundaries.
- Bundle the exact verified Hara CLI `0.141.0` commit
  `dbfa379df565666da9cc6722d0647ca99da86e2f`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.57 — 2026-08-05 — flexible personal and organization model routes

- Add multiple named personal model connections in Settings. Each user-owned connection keeps its
  own provider, model, endpoint, and private credential, can be tested independently, and is saved
  without replacing the current route unless the user explicitly chooses “add and use”. Desktop
  receives only redacted connection metadata and never persists API keys in renderer storage.
- Make the chat model picker bidirectional: an organization-bound conversation can now start a new
  Personal conversation, and a Personal conversation can start a new organization-bound one. The
  original conversation and history remain pinned to their original identity; an unsent draft moves
  only after confirmation and is never submitted automatically across that trust boundary.
- Clean only Hara-owned stale Windows updater staging directories after startup and expose the real
  updater cache location plus a manual cleanup action in Settings. The installed application remains
  in the user's chosen directory; no unsupported custom-download-path control is presented.
- Bundle the exact verified Hara CLI `0.140.0` commit
  `06ef619461ab841a30832c3757219c3fff29d981`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.56 — 2026-08-05 — safe enterprise model switching

- Show every model authorized by an enrolled Hara Control connection directly in the chat model
  picker, even when the open conversation remains pinned to a personal provider or another
  organization. Search matches both organization names and managed model IDs.
- Selecting a model from another connection now asks for confirmation and creates a separate,
  profile-pinned conversation. Existing history stays on its original provider; unsent text and
  attachments move to the new draft but are not sent until the user explicitly submits them.
- Distinguish permanent, revocable organization access from legacy servers that did not report an
  expiry, and show the connection's authorized model catalog in Settings. Quota, model scope, and
  revocation remain controlled by the organization's Hara Control administrator.
- Bundle the exact verified Hara CLI `0.139.1` commit
  `7ae456f542c4a2e9474e926a0b755073b03f03db`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.55 — 2026-08-05 — honest Office validation and safe delivery

- Replace the Office workbench's pre-labelled success state with an explicit “Not checked” state.
  “Verified” now appears only after Hara Serve returns a pass report bound to the exact current
  revision and digest; reopening or changing an Artifact invalidates the displayed proof.
- Add a separate “Save safe copy” flow for the original Office format. It automatically obtains a
  current validation report when needed, uses the native save dialog, never overwrites an existing
  file, and shows the path-redacted export receipt only after the written bytes are reopened and
  matched to the validated SHA-256.
- Keep the product boundary visible: this release provides byte-identical PPTX, XLSX, and DOCX
  delivery, not Office editing or format conversion. The workbench remains bilingual, keyboard
  reachable, responsive, and clear about the next reviewed capability stage.
- Bundle the exact verified Hara CLI `0.139.0` commit
  `fd9b928c0ab8ad1bc6a870416b0379b5695f264c`. Existing conversations, projects, organization
  connections, schedules, Artifacts, and local files require no migration. Windows packages remain
  updater-signed but not Authenticode-signed, so SmartScreen may still show a reputation warning.

## 0.1.54 — 2026-08-05 — safe next-turn model selection

- Keep the model and thinking controls interactive while a turn is running. A new visible “Next
  turn” state makes it explicit that the current turn retains its original route and the staged choice
  applies only after that turn finishes.
- Serialize rapid model or effort changes per session so the newest choice wins. Desktop bridges the
  short terminal-event/BUSY handoff with bounded retries while Hara Serve remains authoritative for
  organization authorization, image-history compatibility, model availability, and effort levels.
- Confirm every staged choice before a fresh or queued message is dispatched. If Serve cannot apply
  it, the message stays unsent instead of silently running on the previous model; actionable errors
  remain in the conversation.
- Use the staged model's attachment capabilities and reasoning options in the composer, preventing an
  image from being validated against the old model while it is waiting for the next turn.
- Continue to bundle Hara CLI `0.138.2`; existing conversations, projects, organization connections,
  schedules, and local files require no migration. Windows packages remain updater-signed but not
  Authenticode-signed, so SmartScreen may still show a reputation warning on some computers.

## 0.1.53 — 2026-08-05 — honest oversized-image handling

- Preflight image size consistently for file selection, native drag and drop, and clipboard paste.
  Picker and drop paths use file metadata without reading image contents; paste is rejected before
  allocating or persisting an oversized Base64 payload.
- Keep an oversized image visibly blocked in the composer and explain that it was not sent to the
  selected model and was not silently routed to OCR. Users are asked to compress or crop it before
  retrying; the authoritative Serve validation still applies to every persistent client.
- Negotiate the image byte limit from Hara Serve while retaining a 3.6 MB fallback for older engines.
  Local byte-size metadata is used only for renderer preflight and is removed before the attachment
  intent crosses the authenticated RPC boundary.
- Bundle Hara CLI `0.138.2`, which advertises the same limit and returns the actionable error before
  any native vision or vision-helper request. Existing conversations, projects, organization
  connections, schedules, and local files require no migration.
- Windows packages remain updater-signed but not Authenticode-signed, so SmartScreen may still show a
  reputation warning on some computers.

## 0.1.52 — 2026-08-05 — workspace route recovery and first-turn attachments

- Let people add images, files, or one folder before opening their first Assistant conversation.
  The homepage supports native file-system drag and drop, image paste, attachment-only turns, safe
  basename chips, removal, and exact draft restoration when the first send cannot be accepted.
- Reuse Serve's negotiated `composer.attachments.v1` protocol and model image-capability check. The
  native shell only classifies a bounded drop as a regular file or directory; Hara Serve remains the
  authority for protected paths, symlinks, content types, sizes, directory inventories, and model input.
- Keep the homepage and formal conversation composer on the same attachment constructors and
  deduplication rules. Existing conversations, projects, models, organization connections, and local
  files require no migration.
- Show the effective connection for the active workspace instead of silently displaying only the
  global default. A visible recovery action can remove the project profile override governing future
  conversations, including one inherited from a parent directory; existing conversations stay pinned.
- Bundle Hara CLI `0.138.1`, whose authenticated, redacted Serve action performs that project-route
  recovery. The Windows packages remain Tauri-updater signed but are not yet Authenticode-signed, so
  Windows may still show a SmartScreen reputation warning.

## 0.1.51 — personal-first model connections and accurate local gateway recovery

- Keep a user's personal provider as the safe default when adding Hara Control connections. The
  enrollment form now offers two explicit actions: save without switching, or add and switch. Pressing
  Enter uses the non-switching action, and refreshing an inactive enterprise authorization no longer
  replaces the current personal or organization route.
- Bundle Hara CLI `0.138.0`. A stopped or stale loopback model/gateway is now reported as a local
  endpoint lifecycle problem with focused recovery choices: start the local service, switch to a
  working personal direct connection, or reconnect the selected organization. Loopback remains
  intentionally proxy-bypassed and private endpoint details remain redacted.
- Preserve the existing Windows PAC/SOCKS and HTTP(S) proxy guidance for actual remote failures, while
  updating production dependencies for the latest npm security advisories. The bundled engine also
  enforces skill-declared runtime tool allowlists.
- Existing conversations remain pinned to the connection where they started; projects, schedules,
  organization profiles, Desk connections, and credentials require no migration.

## 0.1.50 — architecture-safe updater verification

- Add a read-only native release diagnostic that reports the updater configuration Tauri reconstructs
  at runtime. Every final macOS, Linux, and Windows desktop executable must execute it and return the
  exact first-party-CDN-then-GitHub order before a release can be promoted.
- Invalidate `hara-desktop`'s architecture-specific Cargo/build-script output before each protected
  macOS signing build while retaining dependency caches.
- Revalidate the Intel build through native execution: its generated runtime configuration contains
  both correct endpoints. Raw Mach-O string presence was not a valid proxy because the Intel linker
  can transform one URL while Tauri still reconstructs the configured value.
- Upgrade the build-time PostCSS dependency to a release that fixes GHSA-r28c-9q8g-f849; the npm
  official-registry audit reports no remaining vulnerabilities.
- Keep the bundled Hara CLI at the already verified `0.137.0`. Existing conversations, projects,
  schedules, organization profiles, Desk connections, and credentials require no migration.
- The valid first-party manifest remains
  `https://assets.nanhara.com/hara/desktop/stable/latest.json`; immutable 0.1.48 artifacts are not
  replaced.

## 0.1.49 — unpublished release validation

- Add the first final-executable updater endpoint gate across macOS, Linux, and Windows packages.
- The first version of that gate searched raw executable bytes and blocked Intel macOS before draft
  promotion. Native follow-up proved this was a linker-layout false positive, so version 0.1.49 was
  never published or mirrored; its tag remains immutable as release evidence.

## 0.1.48 — open-core workspaces and context-owned extension dock

- Make Chat, Projects, Tasks, Groups, and Office first-class open-core modules in one configurable
  dock. Groups and Office are visible for new profiles, every work entry may be hidden or reordered,
  and Settings remains fixed as the recovery path.
- Add a dedicated local-first Office surface for presentation, spreadsheet, and document imports.
  Imported files are validated and integrity-checked through Hara Serve, while the UI stays explicit
  that high-fidelity editing and export require a reviewed capability.
- Replace the flat plugin list with a capability directory that keeps Hara, the active organization,
  the future signed market, and installed packages separate. The market has an honest unavailable
  state until package signatures, permission review, revocation, and isolated Panel v2 are enforced.
- Treat organization selection as one context switch for its managed model route and native Desk,
  without exposing model or Desk credentials to the renderer. Existing conversations remain pinned
  to the profile they started with.
- Split the Tasks automation console, Groups, Office, Artifact details, model/bot settings, Desktop
  companion settings, and the capability directory from the initial Assistant bundle. Dock and
  Settings entries preload their matching module on pointer hover or keyboard focus to keep
  intentional navigation responsive.
- Replace the anonymous Projects preview split with an owner-bound Extension Dock. Local Design and
  plugin panels now require a real project session, display only a redacted origin, and keep their
  owner while users move between modules. Office PPT, spreadsheet, and document Artifacts use the
  same resizable/focusable shell without pretending that high-fidelity editing already exists.
- Require Serve's project detection result before a Settings-launched panel can run, parse emitted
  panel URLs as exact loopback HTTP origins with their declared port, re-check ownership after the
  panel process wait, never echo invalid process output, and keep an Office dock pinned when
  verification discovers a newer Artifact revision.
- Document the target enterprise bootstrap contract for Hara-hosted and customer-hosted Desk/Collab.
  Today an employee's one-time join can install the model route plus an optional native Desk binding;
  administrator service bindings, signed manifests, and reviewed organization surfaces remain planned.

## 0.1.47 — actionable Windows organization-network diagnostics

- Bundle the exact verified Hara CLI `0.137.0`. When an organization model request fails before
  generation, Desktop now preserves Hara's bounded network-route diagnosis instead of reducing it to
  the OpenAI SDK's generic `Connection error`.
- On Windows, the error identifies whether the request used an explicit proxy, the enabled static
  WinINET proxy, or no supported HTTP(S) route, and gives a focused `hara config set proxy
  http://127.0.0.1:<port>` action for PAC-only or SOCKS-only setups. Proxy credentials, organization
  keys, private gateway addresses, and unrelated nested errors remain redacted.
- Support atomic organization enrollment responses that may include a separate native Desk binding.
  Existing Control deployments that do not return one keep the current model-only behavior, and
  existing conversations, projects, schedules, profiles, Desk connections, and credentials are
  preserved.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.46 — first-party signed updater channel

- Check Hara's first-party CDN updater manifest before GitHub so ordinary in-app upgrades no longer
  depend on a working GitHub connection. GitHub remains a secondary endpoint for non-successful CDN
  responses.
- Keep the exact release artifacts and embedded minisign signatures unchanged on the mirror. Versioned
  payloads are immutable and byte-verified through the public CDN before the short-lived stable
  manifest is published last.
- Users still on `0.1.45` whose GitHub request already fails need one manual upgrade from Hara's
  domestic download page; upgrades after `0.1.46` use the first-party signed channel automatically.
- Bundle the unchanged, verified Hara CLI `0.136.0`; existing conversations, projects, schedules,
  organization profiles, Desk connections, and credentials are preserved.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.45 — native multi-organization Desk

- Turn the default-hidden Groups foundation into a native, read-only organization Desk. Users can
  browse every enrolled organization, see its local Desk connection state, explicitly load a bounded
  task board, and open one task dossier without an iframe, embedded web login, background polling, or
  renderer-owned credential.
- Keep browsing separate from routing: selecting an organization changes only the Groups view, while
  “Use for new work” is the explicit action that changes the default route. Existing conversations
  remain pinned to the organization profile they started with.
- Partition in-memory board and task data by enrollment identity and an opaque Desk binding revision.
  Removing, re-enrolling, or rotating the same organization ID immediately discards prior cached
  content, while stale asynchronous responses cannot repopulate it.
- Bundle the exact verified Hara CLI `0.136.0`, which adds profile-scoped Desk registration and
  authenticated Serve reads, keeps native bearers separate from the legacy MCP store, and blocks both
  credential stores from agent file/search access.
- Existing conversations, projects, schedules, organization profiles, and credentials are preserved.
  Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.44 — Groups foundation and reliable Windows proxy routing

- Add the first, default-hidden Groups module shell to the configurable work dock. It establishes the
  public community, organization workspace, and task-hall information architecture without starting a
  remote service, polling in the background, or changing existing Chat, Projects, and Tasks behavior.
- Keep Settings fixed as the recovery path while allowing Groups to be shown, hidden, and reordered like
  other dock modules. The current preview clearly marks future collaboration surfaces instead of
  presenting placeholder data as live work.
- Bundle the exact verified Hara CLI `0.135.4`. Windows standalone builds now keep Node's proxy transport
  lazy, use Bun's native proxy path, and honor explicit/environment/static WinINET proxy configuration
  without stalling Desktop's local Serve handshake.
- Existing conversations, project data, schedules, organization profiles, and credentials are preserved.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.43 — fresh conversations and a configurable work dock

- Add a visible “New conversation” action to the Assistant sidebar. Starting a fresh thread keeps
  the previous Desktop conversation available under a folded History section, while gateway chats
  remain separated by their external origin.
- Turn the far-left rail into a user-configurable module dock. Chat, Projects, and Tasks can be
  shown, hidden, and reordered without deleting any work; Settings remains fixed as the recovery
  path, and corrupted or stale plugin preferences fail safely.
- Add a guided “Create skill” action in Settings. It starts a separate conversation with a bounded
  skill-design brief, requires a preview before any file is written, and keeps installation,
  replacement, and external dependency changes behind explicit approval.
- Document the reviewed Panel v2 boundary required before an installed plugin can become a
  first-class dock module. Arbitrary command panels do not receive trusted navigation, credentials,
  files, network, notifications, or task-dispatch access.
- Bundle the unchanged, verified Hara CLI `0.135.2`; existing sessions, projects, model routes,
  schedules, connections, and credentials are not migrated by this Desktop-only update.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.42 — keep recovered windows usable across display scales

- Recover stale main-window geometry in the target display's physical scale while preserving the
  intended 1100 × 760 logical size on Retina and standard-density monitors.
- Reset both dimensions together when either restored axis is too small or larger than the target
  work area, preventing a visible but unusably tall or narrow window after monitor changes.
- Keep the 0.1.41 macOS reopen behavior: closing the main window and launching Hara again recreates
  a visible, focused window. The bundled Hara CLI remains the verified `0.135.2`.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.41 — recover the main window after closing or display changes

- Restore or recreate the macOS main window when Hara is launched again from Finder or the Dock,
  including when the previous window was closed.
- Recover stale window state that leaves the app off-screen, smaller than a usable conversation
  window, or larger than the display after monitor and scaling changes. The recovered window stays
  on the display with the largest visible overlap.
- Bundle the unchanged, verified Hara CLI `0.135.2`; conversations, project data, connections, and
  credentials are preserved by this Desktop-only update.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.40 — restore conversation startup with Hara 0.135.2

- Restore “Start conversation” and project opening after the 0.1.39 regression. The bundled Hara
  engine now initializes and lists sessions correctly under Bun 1.3.9 instead of failing while
  closing a session-index directory handle.
- Extend the final sidecar, packaged-app, DMG, and updater smoke path to run `hara sessions` under an
  isolated HOME. Release candidates now exercise the same session-index startup path as Desktop,
  rather than passing only version, doctor, and help checks.
- Bundle the exact verified Hara CLI `0.135.2` hotfix. Existing model routes, attachments, schedules,
  sessions, and project data remain unchanged.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.39 — guided automation, rich context, and Hara 0.135.0

- Consolidate scheduled work into one guided automation console with plain-language task descriptions,
  status and next-run visibility, search and filters, detail and run history views, plus edit, duplicate,
  run-now, pause/resume, and delete actions from the task row or its context menu.
- Replace the text-only conversation footer with one session-scoped composer for text, pasted or selected
  images, ordinary files, and one-turn folder context. Attachments remain visible and removable, attachment-
  only turns can be sent, failed validation restores the exact draft, and a persistent project workspace is
  kept distinct from a bounded folder inventory attached to one turn.
- Move model selection into the composer as a searchable, session-bound catalog showing provider,
  enterprise connection, image-input route, and plain-language thinking levels. Unsupported or unverified
  image routes block sending without deleting the draft; configured vision helpers are explained before
  the user sends.
- Keep automation delivery destinations write-only. Desktop can replace, preserve, change the policy for,
  or explicitly clear a saved Feishu, WeCom, Telegram, or webhook destination without reading the private
  target back into the renderer; duplicating a task never implies that its private destination was copied.
- Validate task changes against the local authenticated Hara engine before saving, surface run-now
  failures, install or repair the native scheduler from the same console, and distinguish a bounded
  next-run calculation from a task that genuinely has no future schedule. Clearing an existing cron
  timezone now sends an explicit local-time request instead of silently preserving the old timezone.
- Keep a completed one-shot task editable when its original run time is unchanged, while new, duplicated,
  or modified one-shot tasks still reject past times. Invalid schedule previews remain inert instead of
  throwing during form rendering.
- Stop sending a second macOS system notification for gateway-originated or not-yet-classified sessions;
  Feishu and other channel notifications remain owned by their channel client.
- Upload protected signed macOS release assets independently and reconcile exact remote bytes after a
  transient GitHub response failure, so one interrupted upload cannot replay or replace an already verified
  asset set.
- Bundle the exact verified Hara CLI `0.135.0` release, including redacted automation controls plus the
  structured attachment protocol, authoritative local file safety checks, path-free renderer history,
  model capability discovery, and session-pinned native or vision-helper image handling.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.38 — session-bound enterprise routes and Hara 0.134.6

- Show the persisted Personal or enterprise `profileId` beside the active conversation's model picker.
  A resumed thread remains visibly bound to the connection that created it even after the user switches
  the default connection for new sessions.
- Bundle the exact verified Hara CLI `0.134.6` release. Existing conversations keep their provider,
  model, guardian, subagent, managed-role, heartbeat, and gateway specialist routes on the same profile;
  removed or unauthorized connections fail closed instead of silently changing organization.
- Surface new Desktop versions with a visible in-app guide instead of only a settings dot. Users can
  download in the background with real progress, keep working, defer one version for 24 hours, inspect
  details, and explicitly restart after tasks stop; the ready state explains that a Desktop-managed CLI
  is synchronized by the same update.
- Refresh an existing Hara Control connection's authorized model catalog during heartbeat, so the same
  device Token can expose both DeepSeek V4 Flash and V4 Pro without re-enrollment or manual Key changes.
- Include Hara CLI's macOS cron LaunchAgent fix. Existing macOS cron users should run
  `hara cron install` once after upgrading so calendar-minute events replace the coalescible 60-second
  interval timer; saved jobs and run history remain unchanged.
- Treat Apple's explicit `HTTPClientError.connectTimeout` as a bounded transient notarization upload
  failure, while authentication and other permanent errors still fail immediately. This stabilizes the
  protected signed-macOS promotion lane without weakening notarization.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.37 — scoped DeepSeek V4 controls and Hara 0.134.1

- Refresh the model catalog and thinking controls from the active session and enterprise connection,
  so each Hara Control token shows only its authorized DeepSeek V4 model and the documented `off`,
  `high`, and `max` choices. Switching connections or sessions immediately replaces stale model state.
- Bundle the exact verified Hara CLI `0.134.1` release. Managed gateway requests now preserve DeepSeek
  V4 thinking parameters and reject model or effort choices outside the enrolled token's server-advertised
  scope before they reach Hara Control.
- Ship the Desktop-owned WeChat QR login lifecycle prepared in 0.1.36: the QR renders inside Settings,
  expired codes can be retried, closing the panel cancels safely, and transient task shells no longer leave
  an orphaned login process.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.36 — managed WeChat login and Hara 0.134.0

- Move WeChat QR login out of transient agent commands and into a single Desktop-owned session
  controller exposed through authenticated loopback RPC. Settings can start or retry login, render
  the QR locally, show each login phase, refresh expired codes, and cancel safely when the panel or
  app closes without leaving an orphaned login process.
- Keep WeChat credentials inside Hara's owner-only local state. QR payloads are bounded and the
  renderer receives only the short-lived code plus redacted phase/error data; token persistence
  failures stop the session with a focused local-state recovery message.
- Block `hara gateway --platform weixin --login` when an automated task tries to launch it in a
  headless task shell, directing users to Desktop or a real interactive terminal where the QR and
  process lifetime can be managed reliably.
- Bundle the exact verified Hara CLI `0.134.0` release. It also prioritizes project-local memory and
  skills before global/plugin material when building the bounded context digest, so installed plugin
  volume cannot push current-project guidance out of memory search context.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.35 — managed connections and resilient Desktop workflows

- Recover Desktop startup when `127.0.0.1:8790` is already occupied. A healthy authenticated Hara
  remains reusable through its private discovery record; an explicitly retried stale Hara is stopped
  only after its PID and executable path are revalidated; dead records are removed without signalling;
  and unrelated applications are left untouched while Desktop starts its managed engine on a
  loopback-only fallback port advertised through authenticated discovery.
- Restore both visible eye apertures in the static Desktop cat mark instead of filling them with the
  website animation's detached blink-overlay circles.
- Keep `write_file`, edit, and patch difference cards from shrinking their body to an empty strip inside
  the flex transcript. Difference text now has a stable minimum height, preserves unified alignment, and
  scrolls within a bounded responsive card for long lines, high display scaling, and narrow windows.
- Replace the model picker's fixed Enterprise Gateway preset and detached organization card with one
  connection switchboard: cloud/local options remain presets, while every enterprise row is a named,
  user-enrolled Hara Control deployment. Users can add multiple deployments, inspect authorization and
  endpoint state, heartbeat-check, re-enroll, remove locally, and explicitly switch the route used by new
  sessions. One-time codes are cleared before enrollment and device credentials never enter the renderer.
- Launch plugin panels from their verified installed entry instead of a login shell. Node-based panels now
  skip obsolete runtimes such as Node 11, prefer Node 22 from PATH or common version managers, preserve a
  bounded actionable failure when no supported runtime exists, and execute arguments without shell parsing.
  Native regressions cover repeated launch and rejection of command links outside the plugin store.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.34 — visible window recovery and Hara 0.133.0

- Recover the main window after display disconnection, rearrangement, or resolution changes whenever
  its restored rectangle no longer overlaps any current display work area. The window keeps its saved
  size when possible, is constrained to the primary work area when necessary, and is centered where
  its title bar and controls are reachable again.
- Add native geometry regressions for negative monitor coordinates, disconnected displays, exact edge
  contact, oversized saved windows, and missing-primary fallback, and run the Rust host suite in CI.
- Bundle the exact verified Hara CLI `0.133.0` release so Desktop-managed CLI installs and updates stay
  on the current public CLI version.

## 0.1.33 — Hara 0.132.4 managed CLI and connection settings

- Add a user-owned Enterprise connections card: users enter their own Hara Control URL and one-time
  registration code, then can switch, re-enroll, explicitly check, or locally remove the connection. No
  enterprise URL is prefilled; one-time codes leave renderer state before the request, and device tokens never
  cross into the renderer. Local removal warns that administrator-side revocation remains separate.
- Show redacted WeChat and Feishu runtime health from the local Hara engine, with actual connection/activity
  timestamps and focused recovery steps. The status refreshes every two minutes and never calls a model or
  spends model tokens.
- Automatically install command-line Hara from Desktop's exact verified sidecar when the managed
  path is missing, then keep only Desktop-owned, unmodified copies synchronized after later Desktop
  updates. Each install is staged, content-verified, atomically replaced, and bound to a private
  SHA-256 ownership receipt at `~/.hara/desktop-cli.json`.
- Show whether the CLI is missing, stale, current, manually managed, blocked, or unavailable, plus
  the bundled version, destination path, and PATH guidance. Existing npm/source/manual installs are
  never silently overwritten; users can explicitly opt the managed path into automatic updates.
- Bundle the exact verified Hara CLI `0.132.4` release, including observable chat-gateway status, scoped Web
  proxy support, complete configuration redaction, immediate prompt-key routing, and reliable non-Git
  `@path` completion on slow machines.
- Update DOMPurify to `3.4.12`, closing the newly disclosed custom-element hook bypass before release.

## 0.1.32 — hara 0.130.1 Windows serve and updater handoff

- Bundle Hara CLI `0.130.1`, which omits inapplicable POSIX descriptor-mode operations on Windows
  while retaining private discovery type, identity, atomic replacement, and authentication checks.
  The official Windows sidecar can start `hara serve` without the reported `fchmod` `EPERM`.
- Split Desktop update download from installation. Hara now keeps the task engine available during
  download, waits for active work to finish, performs authenticated engine shutdown, confirms
  `serve.json` retirement, and only then installs and restarts.
- NSIS setup and uninstall now use Tauri's current-user-aware process gate for the detached
  `hara.exe`. Interactive upgrades ask before closing it; silent updates close it or abort rather
  than claiming success while retaining a locked old sidecar.
- Make the update handoff retry-safe: an already installed package is not installed twice, and a
  failed installer/relaunch restores the task engine when possible. This prevents Windows in-place
  upgrades from leaving the adjacent `hara.exe` at an older version because it was still locked.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.31 — hara 0.130.0 ordered task-state delivery

- Bundle Hara CLI `0.130.0` from its exact public tag and commit. Typed task lifecycle events now
  carry one server-stream identity and a monotonically increasing sequence across sessions,
  steering, approvals, checkpoints, resume, and completion.
- Reject duplicated or stale lifecycle events from the same engine stream before they can overwrite
  the current Desktop busy state, active turn, approval, checkpoint, completion notification, or
  companion status. A restarted server begins a new accepted stream.
- Keep the protocol-v1 compatibility boundary additive: Desktop still connects to older supported
  engines that do not send ordering metadata, while new engines provide deterministic ordering
  without mixing task execution into conversation text.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.30 — hara 0.129.0 workspace recovery and resilient release transfers

- Carry the complete local Deliverables workbench, Hara CLI `0.129.0` workspace recovery, Apple
  timestamp retry, and recoverable notarization changes prepared in the withheld `0.1.27` through
  `0.1.29` drafts.
- Download every hidden or public GitHub Release asset set into a new private staging directory and
  replace the verification directory only after a complete transfer. A failed attempt is discarded,
  so a partial installer or updater can never be reused on the next attempt.
- Retry release uploads and downloads at most three times only when a bounded private log proves a
  GitHub transport transient such as the connection reset that blocked `0.1.29`. Authentication,
  authorization, missing releases, digest/signature mismatches, and exhausted retries remain
  terminal; uploads retry the entire canonical clobber set while the release is still hidden.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.29 — WITHHELD (never published; hara 0.129.0 workspace recovery and resilient signing)

- Ship the local Deliverables workbench originally prepared in the withheld `0.1.27`/`0.1.28`
  drafts, now backed by the exact Hara CLI `0.129.0` sidecar. The engine adds immutable Artifact
  commit/revert transactions and conflict protection; the current Desktop workbench remains an
  explicitly non-editing foundation until reviewed Office capabilities are connected.
- Carry Hara CLI workspace recovery into Desktop: a Home-root interactive engine can offer a
  confirmed recent-project switch, cross-tool Home-boundary failures share one bounded root-cause
  breaker, private Plugin Git failures are actionable without leaking remote diagnostics, and
  Feishu WebSocket reconnect health is observable.
- Retry a signed Tauri bundle at most three times only when its private build log proves an Apple
  timestamp network/service transient. Every attempt discards partial bundle assets; identity,
  keychain, malformed-signature, and persistent timestamp failures still fail closed, and the
  release never falls back to a Developer ID signature without a trusted timestamp.
- Preserve the recoverable DMG notarization flow from `0.1.28`: a validated submission ID survives
  a crashed status child, while bounded native status queries still reject invalid or missing
  notarization facts.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.28 — WITHHELD (never published; hara 0.128.0 recoverable notarization)

- Ship the local Deliverables workbench originally prepared in the withheld `0.1.27` draft: safe
  presentation/spreadsheet/document import, file facts, integrity verification, and immutable
  revision history through the authenticated Hara CLI `0.128.0` sidecar.
- Separate DMG submission from status waiting on the protected macOS release host. A validated
  submission ID now survives a crashed `notarytool` status child, while bounded native status
  queries retry only explicit process/network failures and still fail closed on invalid responses,
  rejected artifacts, or a one-hour processing deadline.
- Keep all four native package gates, Developer ID signing, app and DMG notarization, stapling,
  Gatekeeper checks, exact updater verification, and hidden-draft promotion unchanged.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.27 — WITHHELD (never published; hara 0.128.0 local deliverable workbench)

- Bundle Hara CLI `0.128.0` from its exact public tag and commit, including the authenticated
  `artifact/1` import, list, integrity-check, and revision-history runtime plus quiet cron delivery
  policies from `0.127.2`.
- Add a plain-language Deliverables shelf to Projects. People can choose a presentation, spreadsheet,
  or document and Hara imports an immutable owner-only snapshot without changing the original file or
  retaining its absolute source path.
- Add a responsive, keyboard-accessible local workbench with file facts, digest verification, and
  revision history. The decorative format card is explicitly labeled as a placeholder: this release
  does not claim to show the real layout or provide editing/export before a reviewed Office capability
  is installed.
- Negotiate Artifact methods with the connected engine and show a focused upgrade message for an older
  sidecar instead of maintaining an indefinite compatibility branch. Corrupt local entries stay hidden
  while healthy deliverables remain usable.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.26 — hara 0.127.1 managed access lifecycle

- Bundle Hara CLI `0.127.1` from its exact public tag and commit.
- Show an accessible warning when organization-managed access is corrupt, expired, or within its
  final 24 hours, with a focused instruction to request a new enrollment code.
- Treat expired managed profiles as unauthenticated instead of letting a new task fail later at the
  model gateway. Personal/local providers and legacy control planes remain unchanged.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.25 — hara 0.127.0 task-aware companion chat and typed execution state

- Bundle Hara CLI `0.127.0` from its exact public tag and commit. Prompt context now has stable
  system/session and dynamic turn/digest sections, while Desktop consumes the versioned typed task
  lifecycle instead of inferring execution state from conversation text.
- Separate conversation input from execution control. Live text refinements use expected-turn
  steering; attachments remain one queued next turn; stable local identities keep optimistic messages,
  retries, cancellation, and rewind aligned with what Hara Serve actually persisted.
- Add a focusable companion chat beside the non-focusable desktop pet. It pins one session when opened,
  can submit work or answer the current one-time approval, restores failed drafts, resumes cold sessions
  before sending, and never redirects a draft when another task becomes active.
- Keep the companion least-privilege: its dedicated webview has only event/window permissions and a
  production deny-by-default CSP with no browser network channel. Agent execution, files, credentials,
  model access, Native commands, and approval validation remain owned by the trusted main window and
  authenticated Hara Serve.
- Harden failure and reconnect boundaries: accepted failed turns remain in durable history, partial
  disconnected output is replaced by authoritative resumed history, late BUSY steering retries cannot
  strand input, simultaneous main/companion sends share one synchronous execution lock, and disconnected
  approvals fail visibly instead of being shown as accepted.
- Ambient always-on-top status uses fixed state/phase labels only; command previews, paths, task text,
  checkpoints, and tool output remain inside an explicitly opened conversation.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.24 — hara 0.126.1 verified Plugin package and ownership boundary

- Bundle Hara CLI `0.126.1` from its exact public tag and commit so Desktop's built-in engine receives
  the same Plugin manifest, path-containment, private staging, atomic activation, ownership-receipt,
  update rollback, and safe-uninstall boundary as the standalone CLI.
- Bind Plugin MCP relative executables and conventional runtime entry scripts to the installed package
  root and use that root as the process working directory. Desktop no longer falls back to the user's
  project when its built-in engine resolves a reviewed Plugin entry.
- Keep the `0.1.23` place/session isolation and disabled-Panel protections unchanged. Third-party
  executable Panel v2 remains closed until its CSP/origin/token/capability/process boundary is complete;
  this sidecar refresh does not claim that open-market boundary.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show a
  SmartScreen warning until the planned signing service is integrated.

## 0.1.23 — hara 0.126.0 novice workbench, provider settings, and safe engine replacement

- Reframe the four-place shell as a plain-language personal workbench: specialist cards start
  guided PPT, spreadsheet, document, video, research, and data-analysis tasks without making users
  understand agents or skills first. Keep place/session ownership explicit so project and chat
  contexts cannot silently cross-wire.
- Redesign Settings around model providers, engine lifecycle, security, language, companions,
  capabilities, and skills. Shared setting rows, notices, status chips, and accessible navigation
  improve hierarchy, keyboard behavior, contrast, and version visibility.
- Manage cloud, OpenAI-compatible, Qwen OAuth, enterprise, Ollama, and LM Studio connections only
  through authenticated Hara Serve RPC. Candidate endpoints are validated, tests are bounded and
  redacted, credentials are write-only, environment-managed settings remain read-only, and changes
  apply only to new sessions.
- Display Desktop, bundled-engine, and connected-engine versions separately. When an older engine
  survives an app relaunch, offer an explicit “Use bundled engine” action instead of reconnecting
  forever: modern engines use authenticated `server.shutdown`; the one-time legacy bridge reopens
  the owner-only discovery record, verifies the exact PID and Hara executable, and terminates it
  with a five-second bound before starting the bundled sidecar.
- Add the optional companion shell and lifecycle surfaces while keeping it non-focusable and
  separate from the task runtime. Record the novice Office architecture and the reusable Hara
  Slides, Sheets, and Docs repository boundaries without claiming unsupported editable-PPTX
  fidelity.
- Bundle Hara CLI `0.126.0`, including bounded human-input waits, stronger session leases and tool
  execution, provider-control RPC, and the WeCom-compatible WebSocket transport. The sidecar remains
  pinned to the exact public CLI tag and commit.
- Windows installers remain updater-signed but are not yet Authenticode-signed, so Windows may show
  a SmartScreen warning until the planned signing service is integrated.

## 0.1.22 — hara 0.124.1 task pets, navigation visibility, and Windows sidecar recovery

- Keep the four left navigation icons at their intended 19 px size and raise inactive contrast. The
  global button padding had reduced a 34 px rail button to a 2 px flex content box, shrinking each
  SVG into the dot-like marks seen in the live report.
- Add an optional non-focusable desktop pet that reflects running, needs-input, ready, and blocked
  task states without changing the agent loop or taking keyboard focus. Multi-task priority and
  reduced-motion behavior match the Codex desktop model.
- Bundle a CSS-native Hara companion and discover compatible local Codex/Hara v1 and v2 sprite
  packages. Native validation confines reads to fixed catalog roots, rejects traversal and symlinks,
  bounds metadata/assets, verifies PNG/WebP geometry, and gives the pet webview validated image data
  instead of filesystem access.
- Separate built-in, Hara-local, read-only Codex-local, and future Hara-market package provenance;
  bound local catalog scans, and document the independent generation, signed public catalog, optional
  login, creator-ingestion, moderation, and entitlement architecture.
- Bundle hara CLI `0.124.1` so Desktop consumes explicit turn lifecycle and approval events while
  retaining a safe fallback for older event streams. Windows private-state staging now uses the
  portable `wx`/`CREATE_NEW` contract, and descriptor/path identity follows stable NTFS file IDs, so
  the native sidecar passes an isolated `doctor` without weakening symlink or hard-link fences.
- Make the protected release host select the exact rustup toolchain even when Homebrew appears first
  on `PATH`, and require the dedicated codesigning keychain to be automatically unlocked from its
  owner-only local password file with a real ephemeral signing probe before either notarized macOS
  build starts. Ordinary Hara startup never accesses signing material.
- Compile the Windows sidecar from the already installed and SHA-256-verified native baseline Bun
  runtime instead of asking Bun 1.3.9 to download that same target runtime a second time. Sanitize the
  macOS keychain search list so malformed stale entries cannot survive a protected signing build.
- Make the protected signer compatible with macOS Bash 3.2 when its original keychain list starts
  empty, and require an explicit verified-completion sentinel so a fatal shell error can never be
  mistaken for a successful signing step. Store atomic, per-run architecture provenance outside
  Tauri-owned bundle directories and invalidate stale markers before every attempt.
- Execute the freshly compiled Bun sidecar boundary smoke while its valid ad-hoc signature remains,
  then remove that signature and let Tauri perform the only Developer ID signing pass on the nested
  Hara.app copy. Verify the packaged sidecar's exact signing authority and trusted timestamp before
  notarization, so replacing an already signed nested binary cannot discard the timestamp.
- Retry Apple staple validation at most three times only for explicit CloudKit/network transport
  failures; missing tickets, invalid signatures, and the final failed attempt remain blocking. Use
  `/usr/sbin/spctl` explicitly for every Gatekeeper gate so the protected non-login Actions shell
  cannot lose the system security tool through its restricted `PATH`.

## 0.1.21 — WITHHELD (never published; hara 0.124.1)

> The sole nested-sidecar signing fix worked: Hara.app and its sidecar were Developer ID signed,
> Apple accepted and stapled the app, and the package/DMG/updater sidecar smokes passed. Attempt 1
> then hit one CloudKit ticket lookup timeout during staple validation. Attempt 2 passed that gate,
> Apple also accepted and stapled the DMG container, then the non-login Actions shell could not find
> bare `spctl` outside its PATH. Both attempts failed closed before Intel signing or promotion; no
> installer or updater was published. Upgrade from `0.1.10` or earlier directly to `0.1.22`.

## 0.1.20 — WITHHELD (never published; hara 0.124.1)

> Four-platform native builds, installer extraction, updater verification, hidden-draft assembly,
> protected keychain unlock, the signing probe, and the freshly compiled sidecar smoke all passed.
> The script then pre-signed the sidecar before Tauri assembled Hara.app; Tauri necessarily signed
> the nested copy again, and codesign rejected that replacement because its trusted timestamp was
> absent. The explicit completion sentinel reported the ARM64 step as a real failure, so Intel,
> promotion, installers, and updater remained hidden. Upgrade from `0.1.10` or earlier to `0.1.22`.

## 0.1.19 — WITHHELD (never published; hara 0.124.1)

> All four native lanes, installer extraction checks, updater signatures, and hidden-draft assembly
> passed. On the protected macOS runner, Bash 3.2 rejected empty-array iteration under `set -u` before
> either signed build started, then supplied a false zero status to the EXIT cleanup trap. The final
> promotion still failed closed because both signed-build provenance markers were absent. No signed
> asset, installer, or updater was published; upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.18 — WITHHELD (never published; hara 0.124.0)

> The release stayed hidden with zero public assets. Its SHA-256-verified Bun 1.3.9 Windows sidecar
> compiled successfully, then failed the isolated `doctor` smoke while opening a newly created
> `.hara-private-*.tmp` staging file. The root cause was CLI 0.124.0's non-portable numeric POSIX open
> flags and Windows descriptor/path identity assumptions. No installer or updater was exposed;
> upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.17 — WITHHELD (never published; hara 0.124.0)

> The release stayed hidden. Windows installed and SHA-256-verified the pinned baseline Bun runtime,
> but an explicit same-target compile made Bun 1.3.9 download it again and that redundant transfer
> timed out before packaging. No installer or updater was exposed. Upgrade directly from `0.1.10` or
> earlier to `0.1.22`.

## 0.1.16 — WITHHELD (never published; hara 0.122.7)

> All native build lanes, installer extraction checks, updater signatures, and hidden-draft assembly
> passed. The protected macOS worker could enumerate but not use the login-keychain private key, so
> Developer ID signing failed closed and the draft was never published. Upgrade directly from
> `0.1.10` or earlier to `0.1.22`.

- Bundle hara CLI `0.122.7`, retaining the standalone boundary that disables Bun's ambient `.env`
  and `bunfig.toml` loaders before the Desktop sidecar starts. Resumed sessions now continue their
  persisted task instead of rediscovering the workspace; when a session starts at the user's Home,
  directory inventory, recursive search, directory references, coding mutations, and shell/external
  agents are blocked while explicit single-file reads remain available. Tab input also renders at
  the same width as the cursor without changing the submitted text.
- Launch every packaged sidecar from a hostile working directory and reject project preload execution
  or environment injection before the Hara permission boundary.
- Pin Node.js `22.23.1`, Bun, and Rust `1.97.0` for reproducible release builds with actionable
  upgrade guidance; verify the target architecture before signing or packaging.
- Keep tag builds in a hidden GitHub draft until every native platform has built and executed the
  packaged sidecar both normally and with `SharedArrayBuffer` disabled; a single writer constructs
  `latest.json`, then the same tag workflow automatically enters protected signing under the same
  server-side concurrency lock and waits for signed/notarized arm64 and Intel macOS replacements.
- Run sidecar smoke before signing, after Developer ID signing, and again from the packaged app so a
  startup or architecture regression cannot reach the automatic updater channel.
- Compile every x64 sidecar with Bun's baseline target so Intel hosts and Rosetta validation do not
  inherit the modern/AVX assumption from an unqualified x64 build.
- Recognize sibling CLI repositories through Git itself so sidecar refreshes also work when
  `hara-cli` is checked out as a linked worktree whose `.git` entry is a file.
- Retry Bun standalone target downloads at most three times, so a truncated compiler-runtime
  transfer fails with a finite, actionable result instead of making a clean release require a new
  runner immediately.
- Install and SHA-256-verify Bun's pinned Windows baseline executable as the Windows build runtime. This avoids Bun
  1.3.9's consistently failing internal extraction path for the otherwise valid baseline target
  package while retaining the old-CPU compatibility boundary.
- Force the Rust manifest to LF at checkout on every platform. Tauri rewrites `Cargo.toml` while
  injecting managed features; without this rule a Windows CRLF checkout became a false dirty-worktree
  failure after otherwise verified MSI/NSIS builds. The release still requires a completely clean
  worktree before collecting assets.
- Resolve the hidden GitHub draft through `gh release view`'s numeric database ID before replacing
  assets. GitHub's tag endpoint does not expose an unpublished draft, so using that endpoint caused
  a false 404 after all four native build lanes and asset receipts had already passed.
- Extract RPM payloads directly with libarchive instead of buffering `rpm2cpio` output; this covers
  current RPM payload variants while keeping package extraction time and memory bounded.
- Cryptographically verify every updater artifact, extract and execute the actual macOS/deb/rpm/
  MSI/NSIS payloads, pin every native build to the committed Desktop/CLI commits and toolchains, and
  publish source provenance alongside SHA-256-bound matrix receipts. Stable release jobs reject
  prerelease or moved tags and verify GitHub's immutable-release attestation. The promotion gate
  accepts exactly one pinned user bypass for stable tags and carries its protected-job identity into
  every Rosetta-based Intel verification.

## 0.1.15 — WITHHELD (never published)

> All four native build lanes, installer extraction checks, sidecar smoke tests, updater signatures,
> and the 14-asset aggregation passed. Draft assembly then used GitHub's tag endpoint to look up the
> unpublished release; that endpoint returned 404 for the otherwise visible hidden draft. The empty
> draft was deleted, no installer or updater was exposed, and the immutable tag remains at its
> original commit. Upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.14 — WITHHELD (never published)

> The tag candidate remained a hidden draft. Using the pinned baseline Bun fixed Windows standalone
> compilation, and both Windows installers passed signature, extraction, and native sidecar smoke.
> Tauri then normalized `Cargo.toml` from CRLF to LF, so the clean-worktree release gate correctly
> stopped collection. No `0.1.14` installer or updater was exposed. Upgrade directly from `0.1.10`
> or earlier to `0.1.22`.

## 0.1.13 — WITHHELD (never published)

> The tag candidate remained a hidden draft: Bun 1.3.9's Windows standalone compiler repeatedly
> failed to extract its baseline target runtime even though the upstream package was present and
> valid. The bounded retries failed closed and no `0.1.13` installer or updater was exposed. Upgrade
> directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.12 — WITHHELD (never published)

> The tag candidate remained a hidden draft: its Windows lane received an incomplete Bun target
> download and Ubuntu's `rpm2cpio` rejected the generated RPM. No `0.1.12` installer or updater was
> exposed. Upgrade directly from `0.1.10` or earlier to `0.1.22`.

## 0.1.11 — WITHDRAWN (hara 0.122.2)

> Withdrawn from automatic updates on 2026-07-14. The bundled Bun standalone could fail at startup
> when `SharedArrayBuffer` was unavailable. Keep using `0.1.10` or upgrade directly to `0.1.22`.

- Bundle the released hara CLI `0.122.2`, with explicit trust boundaries for project configuration,
  permissions, profiles, sensitive files, Git history, subprocess environments, and external agents.
- Make coding, search, checkpoint, semantic-index, cron, process-tree, and gateway file handling more
  robust against concurrent replacement, stale state, unbounded work, and unsafe attachment paths.
- Keep Chinese/Japanese/Korean IME composition inside the composer: pressing Enter to accept an active
  composition no longer selects an autocomplete item or sends the message prematurely.
- Require Node.js `22.12.0` or newer only for PATH-based CLI fallback, with an actionable upgrade
  message on older runtimes; the bundled desktop sidecar remains self-contained.

## 0.1.10 — hara 0.122.0 lifecycle and file-safety hardening

- Bundle the released hara CLI `0.122.0` with cancellable agent/tool-round lifecycles and reliable
  failure propagation for headless, plan, review, and organization runs.
- Harden `hara serve` shutdown, discovery, compaction, approval cancellation, and concurrent session
  locking while keeping persisted session secrets redacted.
- Make coding and file operations safer around symlinks, inode replacement, FIFOs/devices, rollback,
  undo, large snapshots, searches, and concurrent external edits.
- Bound gateway subprocesses, queues, media downloads, rate-limit state, and daemon shutdown so a
  stuck provider or child process cannot pin the desktop service.

## 0.1.9 — hara 0.121.0 sidecar and connection hardening

- Bundle the released hara CLI `0.121.0`, including `hara desk`, crash-safe coding/file edits,
  bounded large-file/tool output, composer history, and cold-start improvements.
- Cancel superseded WebSocket connection attempts so a stale socket cannot replace the active
  session after reconnecting or switching servers.
- Pin CI sidecar builds to the exact `v<SIDECAR_VERSION>` CLI tag and fail release builds when the
  desktop, Cargo, Tauri, lockfile, Git tag, or bundled CLI versions drift.
