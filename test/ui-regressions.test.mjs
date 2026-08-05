import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyEngineVersion } from "../src/engine-version.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("the static Desktop cat mark keeps both traced eye apertures visible", () => {
  const mark = readFileSync(`${root}/src/mark.tsx`, "utf8");

  assert.match(mark, /The two eye apertures are already cut out/);
  assert.match(mark, /<path d="/);
  assert.doesNotMatch(
    mark,
    /<circle\b/,
    "website blink-overlay circles fill the eye apertures when copied without their animation",
  );
});

test("rail buttons reset global padding so navigation SVGs cannot collapse into dots", () => {
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const rail = readFileSync(`${root}/src/AppRail.tsx`, "utf8");
  const railButton = css.match(/\.rail button \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const railSvg = css.match(/\.rail button > svg \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(railButton, /padding:\s*0\s*;/);
  assert.match(railButton, /flex:\s*0\s+0\s+34px\s*;/);
  assert.match(railButton, /color:\s*#d0cdc6\s*;/);
  assert.match(railSvg, /flex:\s*0\s+0\s+auto\s*;/);
  assert.match(app, /<AppRail/);
  assert.match(rail, /<nav className="rail" aria-label=\{labels\.mainNavigation\}>/);
  assert.match(rail, /aria-current=\{activePlace === "settings" \? "page" : undefined\}/);
});

test("the app shell delegates stable navigation and transcript presentation", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const rail = readFileSync(`${root}/src/AppRail.tsx`, "utf8");
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const diff = css.match(/\.diff \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(app, /type AppPlace,[\s\S]*type AppRailItem,[\s\S]*from "\.\/AppRail"/);
  assert.match(app, /<ConversationTimeline/);
  assert.doesNotMatch(app, /<nav className="rail"/);
  assert.match(rail, /export type \{ AppPlace \} from "\.\/navigation"/);
  assert.match(rail, /items\.map\(\(item\) =>/);
  assert.match(timeline, /case "approval"/, "approvals stay in the session timeline");
  assert.match(timeline, /const lastUser = items\.map/, "busy progress remains scoped to the current turn");
  assert.match(timeline, /<pre key=\{index\} className="diff">/);
  assert.match(diff, /flex:\s*0 0 auto\s*;/, "diff cards cannot be flex-shrunk until their body disappears");
  assert.match(diff, /min-height:\s*3\.5rem\s*;/);
  assert.match(diff, /max-height:\s*min\(48vh,\s*420px\)\s*;/);
  assert.match(diff, /overflow:\s*auto\s*;/, "long or wide diffs remain scrollable inside the card");
  assert.match(diff, /white-space:\s*pre\s*;/, "unified diff alignment is preserved");
});

test("external and not-yet-classified sessions never duplicate channel system notifications", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const notificationBranch =
    app.match(/const s = sessionsRef\.current\.find\(\(x\) => x\.id === e\.sessionId\);([\s\S]*?)\n\s*}\n\s*}\n\s*break;/)?.[1] ?? "";

  assert.match(notificationBranch, /if \(s && !isAutomated\(s\)\)/);
  assert.doesNotMatch(
    notificationBranch,
    /!s \|\| !isAutomated\(s\)/,
    "an unknown gateway session must fail closed instead of being mistaken for a local manual task",
  );
  assert.match(notificationBranch, /sendNotification\(\{ title: s\.title \|\| "hara"/);
});

test("automation is one guided control console with local-only status refresh", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const automation = readFileSync(`${root}/src/Automations.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");

  assert.match(app, /<AutomationSidebar/);
  assert.match(app, /<AutomationsPage/);
  assert.doesNotMatch(app, /jobForm|className="jobtable"/, "the legacy duplicate task editor and table are gone");
  assert.match(
    app,
    /window\.setInterval\(\(\) => void refreshAuto\(\), 30_000\)/,
    "task status refreshes from the authenticated local serve connection",
  );
  assert.match(app, /Refreshing it on focus and every 30 seconds[\s\S]*without consuming model tokens/);
  for (const method of ["automation.validate", "automation.update", "automation.run", "automation.scheduler.install"]) {
    assert.match(client, new RegExp(method.replace(".", "\\.")));
  }
  assert.match(automation, /onContextMenu=\{\(event\) => onOpenMenu\(event, job, true\)\}/);
  assert.match(automation, /setEditor\(\{ kind: "duplicate", job \}\)/);
  assert.match(automation, /<DeleteDialog/);
  assert.match(automation, /buildAutomationSchedule\(scheduleDraft\(values\)\)\.spec/);
  assert.match(
    automation,
    /function unchangedPastOneShotSpec[\s\S]*state\.kind !== "edit"[\s\S]*editorRunAtValue\(originalMillis\) === values\.runAt/,
    "an unchanged completed one-shot remains editable without allowing arbitrary past schedules",
  );
  assert.match(
    automation,
    /scheduleError instanceof AutomationScheduleError[\s\S]*scheduleError\.code === "PAST_TIME"[\s\S]*unchangedPastOneShotSpec/,
  );
  assert.match(automation, /schedule: buildSchedule\(values, state\)/);
  assert.match(
    automation,
    /<code>\{scheduleSpec \|\| "—"\}<\/code>/,
    "invalid schedule previews stay inert instead of throwing during render",
  );
  assert.match(automation, /deliveryTarget:\s*""/, "saved delivery destinations are write-only in the editor");
  assert.match(
    automation,
    /const savedDeliverMode = kind === "edit" \? job\?\.deliverMode \?\? job\?\.delivery\?\.mode : undefined/,
    "duplicating a task cannot imply that its private write-only destination was copied",
  );
  assert.match(
    automation,
    /hasSavedDelivery[\s\S]*draft\.clearDeliver = true[\s\S]*draft\.deliverMode = values\.deliverMode/,
    "editing can clear a private target or change its policy without reading the target back",
  );
  assert.match(
    automation,
    /const savedTimezone = state\.kind === "edit"[\s\S]*const timezoneInput = timezone \|\| \(timezoneApplies && savedTimezone \? "" : undefined\)/,
    "clearing an existing cron timezone produces an explicit empty-string update",
  );
  assert.match(app, /const timezone = draft\.tz !== undefined \? draft\.tz : draft\.timezone/);
  assert.match(app, /timezone !== undefined && timezoneApplies \? \{ tz: timezone \} : \{\}/);
  assert.match(client, /tz !== undefined \? \{ tz \} : \{\}/);
  assert.match(
    app,
    /await client\.validateAutomationSchedule\(input\.schedule, input\.tz\);\s*await client\.addAutomationDraft\(input\)/,
    "new tasks are engine-validated before they are persisted",
  );
  assert.match(
    app,
    /await client\.validateAutomationSchedule\(input\.schedule, input\.tz, jobId\);\s*await client\.updateAutomation\(jobId, input\)/,
    "edits are engine-validated against their existing task before they are persisted",
  );
  assert.match(app, /draft\.clearDeliver \? \{ clearDeliver: true \}/);
  assert.match(client, /if \(!result\.ok\) throw new Error/);
  assert.match(client, /nextRunDeferred\?: boolean/);
  assert.match(
    automation,
    /job\.nextRunDeferred \? copy\.nextRunDeferred : copy\.noNextRun/,
    "a bounded preview timeout is shown as still calculating, not as a task with no schedule",
  );
  assert.match(automation, /job\?\.deliverMode \?\? job\?\.delivery\?\.mode/);
  assert.match(automation, /alertAfter: String\(job\?\.alertAfter \?\? 3\)/);
  assert.doesNotMatch(
    automation,
    /return job\.deliver;/,
    "a stored webhook or channel target is never rendered back into the task list",
  );
});

test("typed task lifecycle drives status while conversation and execution inputs stay separate", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const lifecycle = readFileSync(`${root}/src/task-lifecycle.ts`, "utf8");

  assert.match(client, /capabilities\?: \{ methods\?: string\[\]; events\?: string\[\]; features\?: string\[\] \}/);
  assert.match(client, /this\.events = new Set\(result\.capabilities\?\.events \?\? \[\]\)/);
  assert.match(client, /this\.features = new Set\(result\.capabilities\?\.features \?\? \[\]\)/);
  assert.match(client, /supportsEvent\(event: string\)/);
  assert.match(client, /supportsFeature\(feature: string\)/);
  assert.match(client, /"session\.steer"/);
  assert.match(app, /case "event\.task_state"/);
  assert.match(app, /clientRef\.current\?\.supportsEvent\("event\.task_state"\)/);
  assert.match(app, /await c\.steer\(sessionId, text, turnId\)/);
  assert.match(app, /const live = taskStateIsLive\(e\.state\)/);
  assert.match(app, /interface QueuedInput[\s\S]*attachments\?: ComposerAttachment\[\]/);
  assert.match(app, /next\.attachments,[\s\S]*recordUser: next\.recorded !== true/);
  assert.match(app, /queueRef\.current = next;[\s\S]*return next;/);
  assert.match(app, /const BUSY_SEND_RETRIES = 4/);
  assert.match(app, /busyAttempt < BUSY_SEND_RETRIES[\s\S]*window\.setTimeout/);
  assert.match(app, /if \(!live\) \{\s*setSessionBusy\(sessionId, false\)/);
  assert.match(app, /const retryQueuedInput = useCallback/);
  assert.match(app, /const currentTurnId = activeTurnsRef\.current\[sessionId\]/);
  assert.match(app, /if \(!live\) \{\s+await sendText\(sessionId, text\);\s+return "sent";/, "a late stale-steer rejection starts a fresh turn");
  assert.match(app, /const pendingApproval = target && busyRef\.current\[target\][\s\S]*item\.kind === "approval" && !item\.answered/);
  assert.match(app, /legacyState[\s\S]*phase: pendingApproval \? "approval"/, "older engines still project approval state into companion chat");
  assert.match(
    app,
    /updateComposerDraft\(sessionId, \(draft\) => \(\{[\s\S]*appendComposerAttachments\(attachments, draft\.attachments\)/,
    "failed composer sends restore the original session's text and attachments",
  );
  assert.match(
    app,
    /const accepted = await sendText\(sessionId, text, attachments\);[\s\S]*if \(!accepted\)[\s\S]*appendComposerAttachments\(attachments, draft\.attachments\)/,
    "authoritative Serve validation failures also restore attachment drafts",
  );
  assert.match(
    app,
    /e\.phase === "restored" && e\.state === "completed"\)[\s\S]*removePet\(e\.sessionId\)/,
    "restored completion clears a stale disconnect activity without creating a notification",
  );
  assert.match(app, /answered: "expired"/, "turn end retires legacy approvals");
  assert.match(app, /requeueFrontOnBusy: true/, "a drained message retains FIFO order if the engine is still busy");
  assert.match(app, /position === "front" \? \[input, \.\.\.current\]/);
  assert.match(app, /!attachedSessionsRef\.current\.has\(sessionId\)[\s\S]*const resumed = await c\.resumeSession\(sessionId\)/, "cold companion sends attach persisted sessions first");
  assert.match(app, /resolveOptimisticUser\(items, removed\.id, false\)/, "canceling a queue item removes its never-persisted optimistic transcript entry");
  assert.match(app, /persistedUserTurnsFrom\(items, i\)/, "rewind counts only server-persisted user turns");
  assert.match(app, /const pendingSendDispatchesRef = useRef/, "accepted sends are tracked until their matching turn settles");
  assert.match(
    app,
    /const setSessionBusy = useCallback[\s\S]*busyRef\.current = next;\s*setBusy\(next\)/,
    "the execution lock becomes visible synchronously across the main and companion composers",
  );
  assert.match(
    app,
    /case "event\.turn_start"[\s\S]*dispatch\.turnId = e\.turnId/,
    "a send binds its optimistic message to the turn that actually accepted it",
  );
  assert.match(
    app,
    /case "event\.turn_end"[\s\S]*dispatch\.completed = true;[\s\S]*resolvePendingUser\(e\.sessionId, dispatch\.pendingId, true\)/,
    "a failed model/tool turn still makes the accepted user message durable and rewindable",
  );
  assert.match(
    app,
    /const pending = queueRef\.current\[e\.sessionId\][\s\S]*setSessionBusy\(e\.sessionId, true\)[\s\S]*setTimeout/,
    "the next queued turn holds the local execution lock during its drain handoff",
  );
  const retryStart = app.indexOf("const retryQueuedInput = useCallback");
  const retryEnd = app.indexOf("/** Submit against the authoritative execution plane", retryStart);
  const retryFlow = app.slice(retryStart, retryEnd);
  assert.ok(
    retryFlow.indexOf("await c.resumeSession(sessionId)") <
      retryFlow.indexOf("latest.filter"),
    "a reconnect retry attaches the persisted session before removing its queue item",
  );
  assert.match(
    retryFlow,
    /restoreAuthoritativeConversation\(\s*conversationHistory\(resumed\.history\)/,
    "reconnect hydration replaces partial local output with authoritative serve history",
  );
  assert.match(
    app,
    /catch \(steerError: any\)[\s\S]*const currentTurnId = activeTurnsRef\.current\[sessionId\][\s\S]*if \(!live\) \{\s*busyAttempt = 0;\s*continue;/,
    "a late fallback-steer BUSY response rechecks live state and retries as a fresh send",
  );
  assert.match(
    app,
    /const answer = async[\s\S]*if \(!c\?\.connected\) \{\s*throw new Error/,
    "disconnected approvals fail visibly instead of being marked as accepted",
  );
  assert.match(app, /hydrateLegacyTaskState\(c, id, r\.task\)/, "legacy resume status reaches the task and companion projection");
  assert.match(app, /attachedSessionsRef\.current\.clear\(\)/, "a new serve connection invalidates old live attachments");
  assert.match(app, /displayHistoryText\(m\.text\)/, "resumed history hides internal steering wrappers");
  assert.doesNotMatch(app, /notePet\(sessionId, "running", text\)/, "raw user text never becomes an always-on-top pet title");
  assert.doesNotMatch(
    lifecycle,
    /event\.(?:detail|objective|brief|checkpoint)/,
    "ambient pet titles do not use raw lifecycle content",
  );
  assert.match(app, /activeTurnsRef\.current = \{\}/, "disconnect clears stale execution identity");
  assert.match(lifecycle, /state === "completed" \? "ready" : state/);
});

test("the model picker stages busy selections and confirms them before the next turn", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");

  assert.match(client, /listModels\(opts\?: \{ sessionId\?: string; cwd\?: string \}\)/);
  assert.match(client, /effort: string \| null/);
  assert.match(app, /refreshModelInfo\(\{ sessionId: active \}\)/, "active-session changes request a scoped catalog");
  assert.match(
    app,
    /const flushStagedModelChange = useCallback[\s\S]*client\.setSessionModel\(\s*sessionId,\s*staged\.model,\s*staged\.effort \|\| undefined[\s\S]*refreshModelInfo\(\{ sessionId \}\)/,
    "the latest staged model and effort are validated by Serve before the authoritative catalog refreshes",
  );
  assert.match(app, /\[opts\.sessionId!\]: info\.effort \?\? ""/, "the server's per-session effort replaces stale UI state");
  assert.match(app, /MODEL_CHANGE_BUSY_RETRY_DELAYS_MS/, "the turn-end BUSY handoff has a hard retry bound");
  assert.match(app, /if \(!live\) void flushStagedModelChange\(e\.sessionId\)/);
  const sendStart = app.indexOf("const sendText = useCallback");
  const sendEnd = app.indexOf("const retryQueuedInput = useCallback", sendStart);
  const sendFlow = app.slice(sendStart, sendEnd);
  assert.ok(
    sendFlow.indexOf("await flushStagedModelChange(sessionId)") < sendFlow.indexOf("await c.send(sessionId"),
    "a fresh or queued send cannot overtake the staged model change",
  );
  const modelToolbarStart = app.indexOf('className={`model-pill');
  const modelToolbarEnd = app.indexOf("{(() => {", modelToolbarStart);
  const modelToolbar = app.slice(modelToolbarStart, modelToolbarEnd);
  assert.doesNotMatch(
    modelToolbar,
    /disabled=\{!!busy\[active\]\}/,
    "model and thinking controls stay interactive while the current turn runs",
  );
  assert.match(modelToolbar, /model-next-turn/);
  assert.match(modelToolbar, /本轮继续使用/);
  assert.match(modelToolbar, /onChange=\{\(e\) => void changeModel\(undefined, e\.target\.value\)\}/);
});

test("settings use shared page templates and keep Desktop, engine, and update state distinct", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const settings = readFileSync(`${root}/src/SettingsUI.tsx`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const nativeHost = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");

  assert.match(settings, /export function SettingsPage/);
  assert.match(settings, /export function SettingsCard/);
  assert.match(settings, /export function SettingsItem/);
  assert.match(settings, /export function SettingsNotice/);
  assert.match(settings, /htmlFor=\{htmlFor\}/, "shared rows can expose a real label to form controls");
  assert.match(settings, /tone === "warning" \|\| tone === "error" \? "alert"/);
  assert.match(app, /getVersion\(\)\.then\(setDesktopVersion\)/);
  assert.match(app, /title=\{t\("desktopVersion"\)\}/);
  assert.match(app, /t\("engineVersion"\)/);
  assert.match(app, /invoke<CommandLineHaraStatus>\("synchronize_command_line_hara"\)/);
  assert.match(app, /invoke<CommandLineHaraStatus>\("inspect_command_line_hara"\)/);
  assert.match(app, /invoke<CommandLineHaraStatus>\("install_command_line_hara"\)/);
  assert.match(app, /commandLineHara\.current && commandLineHara\.managed[\s\S]*t\("cliCurrent"\)/);
  assert.match(app, /commandLineHara\?\.current[\s\S]*t\("cliManage"\)/);
  assert.match(app, /commandLineHara\.installed[\s\S]*t\("cliUpdate"\)/);
  assert.match(app, /~\/\.hara\/bin\/hara/);
  assert.match(app, /classifyEngineVersion\(server\?\.version \?\? "", BUNDLED_ENGINE_VERSION\)/);
  assert.match(app, /engineVersionState === "older" \|\| engineVersionState === "incompatible"/);
  assert.match(app, /engineVersionState === "newer"[\s\S]*<SettingsNotice tone="neutral"/);
  assert.doesNotMatch(app, /server\.version === BUNDLED_ENGINE_VERSION/, "engine health is not a raw string comparison");
  assert.match(app, /<ProviderSettings\s+embedded/, "the default provider page uses the shared settings shell");
  assert.doesNotMatch(app, /<OrganizationSettings/, "enterprise routes live in the model switchboard instead of a detached card");
  assert.match(app, /<GatewaySettings client=\{clientRef\.current\} locale=\{locale\}/);
  assert.match(app, /t\("restartNow"\)/);
  assert.match(app, /await candidate\.download\(\(event\) => \{[\s\S]*setUpdAvail\(""\)/, "ready and available update states cannot conflict");
  assert.doesNotMatch(app, /downloadAndInstall/, "the updater must not install while the Windows sidecar is running");
  assert.match(app, /setUpdateTone\("error"\)/, "updater failures render as errors");
  assert.match(app, /desktopUpdateIsSnoozed\(u\.version\)[\s\S]*setUpdateNoticeVisible\(true\)/, "launch checks surface a visible in-app update guide");
  assert.match(app, /UPDATE_SNOOZE_MS = 24 \* 60 \* 60 \* 1_000/, "later snoozes one version instead of permanently hiding updates");
  assert.match(app, /event\.event === "Progress"[\s\S]*event\.data\.chunkLength/, "background downloads expose real progress");
  assert.match(app, /invoke<DesktopUpdateStorageStatus>\("inspect_desktop_update_storage"\)/, "launch inspects Windows updater leftovers");
  assert.match(app, /invoke<DesktopUpdateStorageStatus>\("clean_desktop_update_storage"\)/, "settings expose bounded cleanup of Hara updater leftovers");
  assert.match(app, /updateStorage\.managedEntries[\s\S]*formatStorageBytes\(updateStorage\.managedBytes, locale\)/, "settings show verified Hara-only staging usage before cleanup");
  assert.match(app, /updateStoragePathHint/, "the UI distinguishes Windows temporary storage from the install drive");
  assert.match(nativeHost, /WINDOWS_UPDATE_STAGING_AUTOCLEAN_AGE/, "startup cleanup keeps an age floor around active installers");
  assert.match(nativeHost, /metadata_is_reparse_point/, "cleanup rejects links and Windows reparse points");
  assert.match(nativeHost, /WINDOWS_UPDATE_STAGING_FILE_LIMIT/, "cleanup remains shallow and bounded");
  assert.match(app, /setSetSec\("engine"\)[\s\S]*setZone\("settings"\)/, "update details route to the existing update settings");
  assert.match(app, /updateNoticeReadyBody/, "the ready state explains that Desktop and its managed CLI update together");
  assert.match(css, /\.desktop-update-notice/);
  assert.match(css, /\.desktop-update-progress/);
  assert.match(app, /role="group"\s+aria-labelledby=/, "settings navigation groups have accessible names");
  assert.match(app, /htmlFor="hara-default-approval"/);
  assert.match(app, /id="hara-default-approval"/);
  assert.match(css, /\.settings-page-head/);
  assert.match(css, /\.settings-card/);
  assert.match(css, /\.setnav-label/);
  const selectedNav = css.match(/\.setnav\.on \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const selectedColor = selectedNav.match(/color:\s*#([0-9a-f]{6})/i)?.[1];
  const selectedBackground = selectedNav.match(/background:\s*#([0-9a-f]{6})/i)?.[1];
  assert.ok(selectedColor && selectedBackground, "selected settings navigation declares stable colors");
  const luminance = (hex) => {
    const channels = hex.match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const foreground = luminance(selectedColor);
  const background = luminance(selectedBackground);
  const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  assert.ok(contrast >= 4.5, `selected 13px navigation contrast is ${contrast.toFixed(2)}:1`);
  assert.match(css, /\.board \.boardpad\.setstage/, "settings padding wins over the board's generic rule");
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.settings-capability-list \.plug[\s\S]*flex-direction:\s*column/);
});

test("secondary work surfaces are split from startup and preload on navigation intent", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const rail = readFileSync(`${root}/src/AppRail.tsx`, "utf8");

  for (const component of [
    "AutomationSidebar",
    "AutomationsPage",
    "ExtensionDock",
    "ArtifactWorkbench",
    "CapabilityDirectory",
    "ProviderSettings",
    "GatewaySettings",
    "DesktopCompanionSettings",
  ]) {
    assert.match(app, new RegExp(`const ${component} = lazy\\(`));
  }
  assert.match(app, /const GroupsStage = lazy\(loadGroups\)/);
  assert.match(app, /warmModule\(loadAutomations\(\)\)/);
  assert.match(app, /warmModule\(Promise\.all\(\[loadOfficeHome\(\), loadArtifactWorkbench\(\), loadExtensionDock\(\)\]\)\)/);
  assert.match(app, /warmModule\(Promise\.all\(\[loadProviderSettings\(\), loadGatewaySettings\(\)\]\)\)/);
  assert.match(app, /onMouseEnter=\{\(\) => preloadSettingsSection\(k\)\}/);
  assert.match(app, /onFocus=\{\(\) => preloadSettingsSection\(k\)\}/);
  assert.match(rail, /onMouseEnter=\{\(\) => onIntent\(item\.id\)\}/);
  assert.match(rail, /onFocus=\{\(\) => onIntent\(item\.id\)\}/);
  assert.match(rail, /onMouseEnter=\{onIntentSettings\}/);
  assert.match(rail, /onFocus=\{onIntentSettings\}/);
});

test("skills settings can start a safe conversational skill builder", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const i18n = readFileSync(`${root}/src/i18n.ts`, "utf8");

  assert.match(
    app,
    /const startSkillCreation = async \(\) => \{[\s\S]*await startNewAssistantConversation\(\)[\s\S]*updateComposerDraft\(sessionId,[\s\S]*t\("skillCreationPrompt"\)/,
    "the builder starts in a fresh assistant conversation and prefills a guided request",
  );
  assert.match(app, /onClick=\{\(\) => void startSkillCreation\(\)\}/);
  assert.match(app, /s\.source === "project"[\s\S]*skillSourceProject/);
  assert.match(app, /s\.source === "global"[\s\S]*skillSourcePersonal/);
  assert.match(app, /s\.source === "plugin"[\s\S]*skillSourceCapability/);
  assert.match(i18n, /Only after I explicitly confirm may you use skill_create/);
  assert.match(i18n, /只有我明确确认后，才可以调用 skill_create/);
  assert.match(i18n, /remove API keys, tokens, passwords/);
  assert.match(i18n, /移除 API Key、令牌、密码/);
});

test("updater restart waits for real shutdown and one-shot relaunch starts the bundled engine", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const nativeHost = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");

  assert.match(client, /async shutdownServer\(\)[\s\S]*"server\.shutdown"/);
  assert.match(client, /await this\.waitForClose\(\)/);
  assert.match(app, /client\.supports\("server\.shutdown"\)/);
  assert.match(app, /await client\.shutdownServer\(\)/);
  assert.match(app, /invoke\("terminate_legacy_serve", \{ expectedPid: server\.pid \}\)/);
  assert.match(app, /t\("engineRestartNow"\)/);
  assert.match(app, /await waitForDiscoveryRetirement\(\)/);
  assert.doesNotMatch(app, /setTimeout\(\s*\(resolve\)\s*=>\s*resolve,\s*180\s*\)/);
  assert.match(app, /error\?\.code === SERVER_BUSY/);
  assert.match(app, /invoke<boolean>\("take_update_restart_marker"\)/);
  assert.match(app, /updateRestart \? startServer\(\) : connect\(\)/);
  assert.match(nativeHost, /fn start_serve\(\) -> Result<u32, String>/);
  assert.match(nativeHost, /fn inspect_command_line_hara\(\) -> Result<CommandLineHaraStatus, String>/);
  assert.match(nativeHost, /fn synchronize_command_line_hara\(\) -> Result<CommandLineHaraStatus, String>/);
  assert.match(nativeHost, /fn install_command_line_hara\(\) -> Result<CommandLineHaraStatus, String>/);
  assert.match(nativeHost, /replace_managed_file/);
  assert.match(nativeHost, /files_are_identical/);
  assert.match(nativeHost, /ManagedCliReceipt/);
  assert.match(nativeHost, /regular_file_sha256/);
  assert.match(nativeHost, /inspect_command_line_hara,/);
  assert.match(nativeHost, /synchronize_command_line_hara,/);
  assert.match(nativeHost, /install_command_line_hara,/);
  assert.match(nativeHost, /fn terminate_legacy_serve\(expected_pid: u32\) -> Result<\(\), String>/);
  assert.match(nativeHost, /read_private_discovery_at\(&path\)/);
  assert.match(nativeHost, /process_path_is_hara_sidecar/);
  assert.match(nativeHost, /libc::kill\(pid as i32, libc::SIGTERM\)/);
  assert.match(nativeHost, /terminate_legacy_serve,/);
  assert.match(nativeHost, /recover_discovered_serve_before_start\(\)\?/);
  assert.match(nativeHost, /SocketAddr::from\(\(\[127, 0, 0, 1\], DEFAULT_SERVE_PORT\)\)/);
  assert.match(nativeHost, /SocketAddr::from\(\([\s\S]*\[127, 0, 0, 1\],[\s\S]*0,[\s\S]*\)\)/);
  assert.match(nativeHost, /command\.args\(\["serve", "--port"/);
  assert.match(app, /const pid = await invoke<number>\("start_serve"\)/);
  assert.match(app, /if \(discovery\.pid === pid\)/, "startup ignores a stale discovery from another process");
  assert.match(app, /expectedPid !== null && d\.pid !== expectedPid/, "the final connection repeats the pid handshake");
  assert.match(app, /await connect\(pid\)/);
  assert.match(nativeHost, /fn take_update_restart_marker\(app: tauri::AppHandle\)/);
  assert.match(nativeHost, /fn restart_after_update\(app: tauri::AppHandle\)/);
  assert.match(nativeHost, /arm_update_restart_marker_at/);
  assert.match(nativeHost, /app\.restart\(\)/);
  assert.match(nativeHost, /take_update_restart_marker,/);
  assert.match(nativeHost, /restart_after_update,/);

  assert.match(app, /applyDesktopUpdateHandoff\(pendingUpdate/);
  assert.match(
    app,
    /retireEngine: async \(\) => \{[\s\S]*await waitForDiscoveryRetirement\(\);[\s\S]*install: \(\) => pendingUpdate\.update\.install\(\),[\s\S]*restart: \(\) => invoke\("restart_after_update"\)/,
    "Desktop wires authenticated retirement, install, and relaunch into the tested handoff state machine",
  );
});

test("macOS Dock reopen restores or recreates the main window", () => {
  const nativeHost = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");

  assert.match(nativeHost, /fn reopen_main_window<R: tauri::Runtime>/);
  assert.match(nativeHost, /app\.get_webview_window\("main"\)/);
  assert.match(nativeHost, /WebviewWindowBuilder::from_config\(app, &config\)/);
  assert.match(nativeHost, /window\s*\.unminimize\(\)/);
  assert.match(nativeHost, /window\s*\.show\(\)/);
  assert.match(nativeHost, /window\s*\.set_focus\(\)/);
  assert.match(nativeHost, /const MIN_MAIN_WINDOW_WIDTH: u32 = 720/);
  assert.match(nativeHost, /const MIN_MAIN_WINDOW_HEIGHT: u32 = 480/);
  assert.match(nativeHost, /scale_factor: monitor\.scale_factor\(\)/);
  assert.match(
    nativeHost,
    /let \(requested_width, requested_height\) = if size_is_invalid \{[\s\S]*logical_to_physical_dimension\(DEFAULT_MAIN_WINDOW_WIDTH, target\.scale_factor\)[\s\S]*logical_to_physical_dimension\(DEFAULT_MAIN_WINDOW_HEIGHT, target\.scale_factor\)/,
    "one invalid axis must restore both logical dimensions at the target display scale",
  );
  assert.match(
    nativeHost,
    /tauri::RunEvent::Reopen \{ \.\. \} => \{[\s\S]*reopen_main_window\(app\)/,
    "the macOS applicationShouldHandleReopen event must restore the main window",
  );
  assert.match(
    nativeHost,
    /tauri::RunEvent::Ready => \{[\s\S]*#\[cfg\(target_os = "macos"\)\][\s\S]*reopen_main_window\(app\)/,
    "a fresh macOS launch must recover when state restoration suppresses the configured main window",
  );
  assert.match(
    nativeHost,
    /#\[cfg\(target_os = "macos"\)\][\s\S]*tauri::RunEvent::WindowEvent \{[\s\S]*tauri::WindowEvent::Resized\(size\)[\s\S]*label == "main"[\s\S]*recover_main_window_if_offscreen\(&window\)/,
    "late window-state restoration must not leave an unusable on-screen main window",
  );
});

test("provider settings keep credentials transient and support local no-key presets", () => {
  const providerSettings = readFileSync(`${root}/src/ProviderSettings.tsx`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");

  assert.match(providerSettings, /type="password"/);
  assert.doesNotMatch(providerSettings, /localStorage\.(setItem|getItem)/);
  assert.match(providerSettings, /setApiKey\(""\)/, "credential input is cleared after provider changes and save");
  assert.match(providerSettings, /endpointIdentity/, "credential reuse is bound to the exact provider endpoint");
  assert.match(providerSettings, /profileId === "personal"/, "named-profile credentials are never offered for Personal reuse");
  assert.match(providerSettings, /setApiKey\(""\)[\s\S]*await client\.listProviderSettings/, "refresh clears a credential before replacing its draft");
  assert.match(providerSettings, /managedExpiryWarning/, "managed provider settings surface token lifecycle warnings");
  assert.match(providerSettings, /role="alert"/, "an expired managed token is announced accessibly");
  assert.match(providerSettings, /disabled=\{phase !== "idle"\}/, "draft fields are locked while an async connection test is in flight");
  assert.match(providerSettings, /aria-pressed=\{draft\.model === model\}/, "discovered models expose selection state");
  assert.match(providerSettings, /className="provider-result pending" role="status" aria-live="polite"/);
  assert.match(providerSettings, /className="provider-result ok" role="status" aria-live="polite"/);
  assert.match(providerSettings, /className="provider-result error" role="alert" aria-live="assertive"/);
  assert.doesNotMatch(app, /invoke\("write_config"/, "renderer must not bypass the serve control plane");
  assert.match(client, /settings\.providers\.list/);
  assert.match(client, /settings\.providers\.test/);
  assert.match(client, /settings\.providers\.save/);
  for (const method of ["create", "test", "use", "remove"]) {
    assert.match(client, new RegExp(`settings\\.providers\\.connections\\.${method}`));
  }
  assert.match(providerSettings, /const transientKey = input\.apiKey \?\? "";[\s\S]*setApiKey\(""\);[\s\S]*await client\.createProviderConnection/,
    "a newly saved connection removes its credential from renderer state before the RPC");
  assert.match(providerSettings, /selectedConnection\.keyHint/, "saved connections expose only the engine's redacted key hint");
  assert.match(providerSettings, /client\.testProviderConnection/, "each named connection can be checked independently");
  assert.match(providerSettings, /client\.useProviderConnection/, "named personal routes can become the new-session default");
  assert.match(client, /settings\.profiles\.unpin/);
  assert.match(providerSettings, /state\.current\.profileSource === "pin"/);
  assert.match(providerSettings, /client\.unpinProjectProfile\(cwd\)/, "project route recovery is an explicit authenticated Serve action");
  assert.match(providerSettings, /Existing sessions keep the identity they started with|已有会话仍保留创建时的身份/);
  assert.match(app, /cwd=\{activeSession\?\.cwd \?\? server\?\.cwd\}/, "Settings resolves the same workspace cwd used by new sessions");
  assert.match(app, /scope=\{activeSession \? "workspace" : "global"\}/);
});

test("bot settings show redacted live gateway health without model polling", () => {
  const gatewaySettings = readFileSync(`${root}/src/GatewaySettings.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

  assert.match(client, /settings\.gateways\.list/);
  for (const method of ["start", "status", "cancel"]) {
    assert.match(client, new RegExp(`settings\\.gateways\\.login\\.${method}`));
  }
  assert.match(gatewaySettings, /const REFRESH_MS = 120_000/);
  assert.match(gatewaySettings, /client\.listGatewayStatuses\(\)/);
  assert.match(gatewaySettings, /lastConnectedAt, status\.lastPollAt, status\.lastMessageAt/);
  assert.match(gatewaySettings, /lastErrorCode === "session-expired"/);
  assert.match(gatewaySettings, /status\.runtimeState !== "connected"/);
  assert.match(gatewaySettings, /processOnly/);
  assert.match(gatewaySettings, /不调用模型，也不消耗 Token/);
  assert.match(gatewaySettings, /import\("qrcode"\)/, "the QR encoder is loaded only after login starts");
  assert.match(gatewaySettings, /window\.setTimeout\(\(\) => void poll\(\), LOGIN_POLL_MS\)/, "polling is recursive and non-overlapping");
  assert.match(gatewaySettings, /window\.clearTimeout\(timer\)/, "polling is cancelled when the panel unmounts");
  assert.match(gatewaySettings, /client\.cancelGatewayLogin\("weixin", active\.id\)/, "unmount closes the owned login session");
  assert.match(gatewaySettings, /Generated locally · not uploaded|仅在本机生成 · 不上传/);
  assert.doesNotMatch(gatewaySettings, /api\.qrserver|chart\.google|quickchart|fetch\(/i, "QR payloads are never uploaded to a renderer service");
  assert.match(css, /\.gateway-login-panel/);
  assert.equal(pkg.dependencies.qrcode.length > 0, true);
  assert.doesNotMatch(gatewaySettings, /apiKey|appSecret|token\s*:/i, "renderer status never accepts connector credentials");
});

test("the model switchboard uses user-added enterprise connections instead of a static managed preset", () => {
  const providers = readFileSync(`${root}/src/ProviderSettings.tsx`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");

  for (const method of ["list", "enroll", "use", "remove", "check"]) {
    assert.match(client, new RegExp(`settings\\.organizations\\.${method}`));
  }
  assert.match(providers, /Promise\.allSettled\(\[[\s\S]*listProviderSettings[\s\S]*listOrganizationConnections/);
  assert.match(providers, /provider\.location !== "managed"/, "the provider catalog's generic gateway is not rendered as a fixed choice");
  assert.match(providers, /organizations\?\.connections\.map/, "every user-added Hara Control is rendered in the switchboard");
  assert.match(providers, /uniqueOrganizationId/, "multiple deployments receive collision-safe local identities");
  assert.match(providers, /type="password"/);
  assert.doesNotMatch(providers, /localStorage\.(setItem|getItem)/);
  assert.match(
    providers,
    /const transientCode = registrationCode\.trim\(\);[\s\S]*setRegistrationCode\(""\);[\s\S]*await client\.enrollOrganizationConnection/,
    "the one-time registration code leaves renderer state before the network request",
  );
  assert.match(providers, /No enterprise is preconfigured|没有预置任何企业/);
  assert.match(
    providers,
    /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void enrollOrganization\(false\); \}\}/,
    "saving an enterprise connection is the default form action and does not replace Personal",
  );
  assert.match(providers, /onClick=\{\(\) => void enrollOrganization\(true\)\}/, "switching to an enterprise is explicit");
  assert.match(providers, /editingOrganization \? existing\?\.active === true : activateRequested/, "re-enrollment preserves an inactive enterprise instead of stealing the current route");
  assert.match(providers, /仅保存，不切换当前连接|Save without switching/, "the safe action explains that the current route stays active");
  assert.match(providers, /window\.confirm\(copy\.removeConfirm\)/, "local removal explains that server-side revocation is separate");
  assert.match(providers, /client\.checkOrganizationConnection/, "connection health is checked explicitly rather than by model polling");
  assert.doesNotMatch(providers, /deviceToken|authorization/i, "renderer never accepts the organization device credential");
  assert.match(
    app,
    /onSaved=\{\(next: ProviderSettingsState\) => \{[\s\S]*void refreshGroupsDirectory\(\)/,
    "a one-click organization switch refreshes the model route and Desk bundle together",
  );
  assert.doesNotMatch(app, /OrganizationSettings/, "the old detached enterprise card is not left below the model picker");
});

test("a resumed conversation exposes its persisted profile inside the searchable model picker", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(client, /interface SessionInfo[\s\S]*profileId\?: string/);
  assert.match(client, /resumeSession[\s\S]*profileId\?: string/);
  assert.match(client, /listModels[\s\S]*profileId\?: string/);
  assert.match(app, /activeModelInfo\?\.profileId/);
  assert.match(app, /className=\{`model-route/);
  assert.match(app, /管理模型与连接/);
  assert.match(css, /\.model-route/);
});

test("the chat model picker can start a profile-pinned organization conversation without migrating history", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const providers = readFileSync(`${root}/src/ProviderSettings.tsx`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(client, /interface OrganizationConnection[\s\S]*availableModels\?: string\[\]/);
  assert.match(client, /OrganizationAccessState[\s\S]*"permanent"/);
  assert.match(app, /refreshOrganizationRoutes/);
  assert.match(app, /connection\.availableModels\?\.length/);
  assert.match(app, /startOrganizationSession\(connection, model\)/);
  assert.match(
    app,
    /await client\.useOrganizationConnection\(connection\.id, sourceSession\.cwd\)[\s\S]*await newSession\(sourceSession\.cwd\)/,
    "cross-profile selection explicitly changes the future-session route before creating a separate conversation",
  );
  assert.match(app, /window\.confirm\(locale === "zh"/);
  assert.match(app, /当前会话和历史仍留在原连接，不会静默迁移/);
  assert.match(app, /delete next\[sourceSessionId\]/, "an unsent draft is moved, not duplicated across trust boundaries");
  assert.match(app, /新会话默认使用/);
  assert.match(providers, /selectedOrganization\.tokenNeverExpires \? copy\.permanent/);
  assert.match(providers, /selectedOrganization\.availableModels\.map/);
  assert.match(css, /\.model-route-group/);
  assert.match(css, /\.model-menu-route-notice/);
});

test("the chat model picker can safely return from an organization route to a named personal connection", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(client, /interface ProviderConnection[\s\S]*legacyPersonal: boolean/);
  assert.match(app, /visiblePersonalConnectionRoutes/);
  assert.match(app, /startPersonalConnectionSession\(connection\)/);
  assert.match(
    app,
    /await client\.useProviderConnection\(connection\.id, sourceSession\.cwd\)[\s\S]*await newSession\(sourceSession\.cwd\)/,
    "personal selection changes only the future-session route before creating a separate conversation",
  );
  assert.match(app, /当前企业\/个人会话及历史仍留在原连接，不会静默迁移/);
  assert.match(app, /当前未发送的文字和附件会移动到新对话/);
  assert.match(app, /className="model-route-group personal"/);
  assert.match(app, /个人直连/);
  assert.match(app, /setProviderRoutes\(next\)/, "settings changes refresh the in-composer route catalog immediately");
  assert.match(css, /\.model-route-group\.personal/);
});

test("the composer has per-session attachments, bounded folders, and capability-aware model selection", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const composer = readFileSync(`${root}/src/composer-state.ts`, "utf8");
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(app, /useState<Record<string, ComposerDraft>>/);
  assert.match(app, /composerDrafts\[active\]/, "text and attachments are resolved by the active session");
  assert.doesNotMatch(app, /pendImgs|setPendImgs/, "attachments cannot leak through one global image list");
  assert.match(app, /attachPickedFiles\("image"\)/);
  assert.match(app, /attachPickedFiles\("file"\)/);
  assert.match(app, /attachPickedDirectory\(\)/);
  assert.match(app, /只建立有界清单，不整目录注入模型/);
  assert.match(app, /打开为新项目/, "persistent workspace and one-turn folder context are distinguished");
  assert.match(app, /disabled=\{!activeDraftCanSend\}/, "an attachment-only compatible turn can be sent");
  assert.match(app, /activeAttachmentIssue/, "incompatible image routes block send without deleting the draft");
  assert.match(app, /vision-sidecar/);
  assert.match(app, /modelSearch/);
  assert.match(app, /visibleModelEntries/);
  assert.match(client, /features\?: string\[\]/);
  assert.match(client, /supportsFeature\(feature: string\)/);
  assert.match(client, /attachments\?: SessionAttachmentIntent\[\]/);
  assert.match(composer, /image-unsupported/);
  assert.match(composer, /engine-update-required/);
  assert.match(timeline, /message-attachments/);
  assert.match(css, /\.composer-shell/);
  assert.match(css, /\.composer-menu/);
});

test("engine health follows SemVer precedence instead of raw text equality", () => {
  assert.equal(classifyEngineVersion("0.124.1", "0.124.1"), "matching");
  assert.equal(classifyEngineVersion("v0.124.1+external.7", "0.124.1+desktop.2"), "matching");
  assert.equal(classifyEngineVersion("0.125.0", "0.124.9"), "newer");
  assert.equal(classifyEngineVersion("1.0.0", "0.124.9"), "newer");
  assert.equal(classifyEngineVersion("0.124.1-beta.2", "0.124.1"), "older");
  assert.equal(classifyEngineVersion("0.123.9", "0.124.1"), "older");
  assert.equal(classifyEngineVersion("dev-build", "0.124.1"), "incompatible");
  assert.equal(classifyEngineVersion("", "0.124.1"), "unknown");
});

test("an unconfigured serve routes Desktop into provider settings instead of parsing an auth failure", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  assert.match(app, /info\.setupState === "needs-credentials"/);
  assert.match(app, /setSetSec\("providers"\)/);
  assert.match(app, /setupRequired \|\| !pendingRef\.current/, "a pending empty-state action waits until provider setup succeeds");
  assert.match(app, /Update Hara Desktop/, "an old bundled engine gives the actionable product upgrade path");
  assert.doesNotMatch(app, /npm install -g @nanhara\/hara@latest/, "a global CLI upgrade cannot replace the bundled Desktop engine");
});

test("the assistant empty state is a plain-language workbench backed by real sessions", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const starter = readFileSync(`${root}/src/WorkStarter.tsx`, "utf8");
  const prompt = readFileSync(`${root}/src/work-starter-prompt.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const native = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");

  assert.match(app, /<WorkStarter/);
  assert.match(app, /sessionId = await openAssistant\(\)/);
  assert.match(app, /await sendText\(sessionId, prompt, attachments\)/, "a starter job must enter the normal serve-backed conversation with structured attachments");
  assert.match(starter, /onDragDropEvent/, "the native desktop drop channel accepts real file-system paths");
  assert.match(starter, /onPickFiles\("image"\)/);
  assert.match(starter, /onPickFiles\("file"\)/);
  assert.match(starter, /onPickDirectory/);
  assert.match(starter, /onPasteImages/);
  assert.match(starter, /attachment\.name/, "the attachment tray shows a safe basename");
  assert.doesNotMatch(starter, /attachment\.path/, "the homepage never renders a local absolute path");
  assert.match(app, /"classify_attachment_paths"/);
  assert.match(app, /entry\.byteSize/);
  assert.match(app, /f\.size > maxBytes/);
  assert.match(app, /尚未发送给模型，也不会静默转用 OCR/);
  assert.match(client, /maxBytes\?: number/);
  assert.match(native, /MAX_COMPOSER_IMAGE_BYTES: usize = 3_600_000/);
  assert.match(native, /byte_size: Option<u64>/);
  assert.match(app, /appendComposerAttachments\(attachments, draft\.attachments\)/, "a failed first turn restores the exact selected material");
  assert.doesNotMatch(starter, /\b(?:Agent|Skill|MCP|cwd)\b/, "novice-facing copy must not expose runtime jargon");
  assert.match(prompt, /可编辑 PPTX/);
  assert.match(prompt, /视觉保真 PPTX\/PDF/, "presentation prompts must state the export-fidelity boundary");
  assert.match(prompt, /能力已经安装/, "artifact cards must verify capability availability before promising an export");
  assert.match(starter, /aria-label=\{copy\.describe\}/);
  assert.match(css, /\.workstarter-grid/);
  assert.match(css, /@media \(max-width: 760px\)/, "the workbench must remain usable in a narrow window");
});

test("the deliverables workbench stays serve-backed, local-first, and honest about the phase-one boundary", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const workbench = readFileSync(`${root}/src/ArtifactWorkbench.tsx`, "utf8");
  const office = readFileSync(`${root}/src/OfficeHome.tsx`, "utf8");
  const copy = readFileSync(`${root}/src/i18n.ts`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  for (const method of [
    "artifact.import",
    "artifact.list",
    "artifact.get",
    "artifact.revisions",
    "artifact.validate",
    "artifact.export",
  ]) {
    assert.match(client, new RegExp(method.replace(".", "\\.")));
  }
  assert.match(app, /presentation: \["pptx", "ppt", "odp"\]/);
  assert.match(app, /spreadsheet: \["xlsx", "xls", "csv", "ods"\]/);
  assert.match(app, /document: \["docx", "doc", "odt", "rtf", "md", "txt"\]/);
  assert.match(app, /await client\.importArtifact\(selected, kind \? \{ kind \} : undefined\)/);
  assert.match(app, /client\.getArtifact\(imported\.artifact\.artifactId\)/, "a new import is integrity-checked before display");
  assert.match(app, /<ArtifactWorkbench/);
  assert.match(app, /zone === "office"/, "Office owns the deliverables shelf and workbench");
  assert.match(app, /<OfficeHome/);
  assert.match(office, /copy\.included/);
  assert.match(office, /copy\.localFirst/);
  assert.match(office, /onClick=\{\(\) => onImport\(item\.id\)\}/, "each Office type card starts a matching filtered import");
  assert.doesNotMatch(app, /invoke\([^)]*"artifact\./, "the renderer never bypasses hara serve for Artifact authority");
  assert.match(workbench, /<button[\s\S]*artifact-verify-action/, "integrity verification is keyboard accessible");
  assert.match(workbench, /artifact-export-action/, "same-format export is a separate keyboard-accessible action");
  assert.match(app, /client\.validateArtifact\(artifactId, revisionId\)/, "verification creates a Serve-backed report for the exact revision");
  assert.match(app, /client\.exportArtifact\(\{/, "export authority remains in Hara Serve");
  assert.doesNotMatch(workbench, /`\$\{copy\.verify\} · \$\{copy\.verified\}`/, "an unchecked revision is never labeled verified");
  assert.match(workbench, /artifact-preview-disclaimer/, "the decorative placeholder is explicitly labeled as not being a real layout preview");
  assert.match(copy, /原文件没有被修改/);
  assert.match(copy, /才会显示真实版面预览/);
  assert.match(copy, /只新建同格式副本；Hara 不会覆盖任何已有文件/);
  assert.match(copy, /现已支持原格式安全另存/);
  assert.match(copy, /matching reviewed capability/, "English copy also avoids promising an unavailable editor/exporter");
  assert.match(css, /\.artifact-workbench-grid/);
  assert.match(css, /\.artifact-sidebar-card:focus-visible/);
  assert.match(css, /\.artifact-verify-action:focus-visible/);
  assert.match(css, /\.artifact-export-action:focus-visible/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.artifact-workbench/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
});

test("the capability directory keeps Hara, organization, market, and installed sources distinct", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const directory = readFileSync(`${root}/src/CapabilityDirectory.tsx`, "utf8");
  const copy = readFileSync(`${root}/src/i18n.ts`, "utf8");

  assert.match(directory, /type DirectorySource = "hara" \| "organization" \| "market" \| "installed"/);
  assert.match(directory, /\["hara", copy\.hara\]/);
  assert.match(directory, /\["organization", copy\.organization\]/);
  assert.match(directory, /\["market", copy\.market\]/);
  assert.match(directory, /\["installed", copy\.installed\]/);
  assert.match(directory, /aria-controls=\{`capability-panel-\$\{id\}`\}/);
  assert.match(directory, /event\.key === "ArrowRight"/, "directory tabs support keyboard navigation");
  assert.match(directory, /organization\.model/);
  assert.match(directory, /organization\.deskConnected/);
  assert.match(directory, /plugin\.enabled && \(plugin\.panels \?\? \[\]\)\.map/);
  assert.doesNotMatch(
    directory,
    /deviceToken|authorization|enrollKey/,
    "the renderer receives status and catalog metadata, never organization credentials",
  );
  assert.match(app, /"core\.office", title: t\("zoneOffice"\)/);
  assert.match(app, /activeOrganizationConnection/);
  assert.match(app, /activeOrganizationDesk/);
  assert.match(app, /const OfficeHome = lazy/);
  assert.match(app, /const CapabilityDirectory = lazy/);
  assert.match(copy, /officeIncluded: "Included in the open core"/);
  assert.match(copy, /capabilityOpenCore: "开源核心"/);
  assert.match(copy, /capabilityMarketGateTitle: "当前版本尚未启用市场服务"/);
});

test("switching places cannot reuse a conversation from the wrong place", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");

  assert.match(app, /activeByZoneRef/);
  assert.match(app, /sessionOpenRequestRef/);
  assert.match(app, /sessionActivationAllowed/, "late async session results must pass both generation and place checks");
  assert.match(app, /sessionPlace\(candidate\) === z/);
  assert.match(
    app,
    /setActive\(candidate && sessionPlace\(candidate\) === z \? candidate\.id : null\)/,
    "each conversation place restores only a session that belongs to that place",
  );
  assert.match(app, /sessionsRef\.current = list\.sessions;\s+setSessions\(list\.sessions\)/, "fork routing sees a refreshed session before changing place");
  assert.match(app, /clearActiveSession\(id\)/, "archiving or deleting must also clear the remembered place");
});

test("disabled plugins cannot launch a panel from settings", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const directory = readFileSync(`${root}/src/CapabilityDirectory.tsx`, "utf8");

  assert.match(directory, /plugin\.enabled && \(plugin\.panels \?\? \[\]\)\.map/);
  assert.match(app, /pluginsRef\.current\?\.find\(\(plugin\) => plugin\.name === pluginName\)\?\.enabled !== true/);
  assert.match(app, /!enabled && extensionDock\?\.type === "legacy-panel" && extensionDock\.plugin === name/);
  assert.match(app, /panels\.filter\(\(panel\) => panel\.plugin !== name\)/, "disabling a plugin evicts cached project panels");
  assert.match(app, /const plugin = pluginsRef\.current\?\.find/, "cached project panels are gated again before launch");
  assert.match(app, /className="ready-error" role="alert"/, "ready-state failures stay visible and dismissible");
});

test("extension screens remain owner-bound and never display a raw panel URL", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const dock = readFileSync(`${root}/src/ExtensionDock.tsx`, "utf8");
  const css = readFileSync(`${root}/src/ExtensionDock.css`, "utf8");
  const host = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");

  assert.match(app, /extensionMatchesContext\(extensionDock/);
  assert.match(app, /sessionsRef\.current\.find\(\(session\) => session\.id === projectSessionId\)/);
  assert.match(app, /if \(!projectSession \|\| sessionPlace\(projectSession\) !== "projects"\)/);
  assert.match(app, /projectClient\.projectPanels\(\{ sessionId: projectSession\.id \}\)/);
  assert.match(app, /detected\.panels\.find\(\(panel\) => panel\.plugin === pluginName && panel\.id === spec\.id\)/);
  assert.equal(
    app.match(/assertPanelLaunchContext\(\);/g)?.length,
    2,
    "project, client, zone, and plugin ownership are checked before and after the panel process wait",
  );
  assert.match(app, /sessionOpenRequestRef\.current !== launchGeneration/);
  assert.match(app, /assertDirectPanelLaunchContext\(\);/);
  assert.match(app, /cwd: projectSession\.cwd/, "settings-launched panels inherit a real project owner");
  assert.match(app, /detail=\{publicPanelOrigin\(panelExtension\.url\)/);
  assert.doesNotMatch(app, />\{panelExtension\.url\}</, "paths, queries, and URL tokens never become visible chrome");
  assert.match(app, /referrerPolicy="no-referrer"/);
  assert.match(app, /setArtifactRevisions\(revisionResult\.revisions\)/);
  assert.match(
    app,
    /report\?\.revisionId !== revisionId \|\| report\.snapshotDigest !== details\.content\.sha256/,
    "validation and export proof stay bound to the active Artifact revision",
  );
  assert.match(app, /artifactOpenRequestRef\.current \+= 1/);
  assert.match(host, /parse_local_panel_url\(candidate, port_hint\)/);
  assert.doesNotMatch(host, /text\.chars\(\)\.take\(/, "invalid panel output never reaches renderer-visible errors");
  assert.match(dock, /role="separator"/);
  assert.match(dock, /aria-valuemin=\{36\}/);
  assert.match(dock, /aria-valuemax=\{72\}/);
  assert.match(css, /@container extension-work \(max-width: 1120px\)[\s\S]*\.extension-work > \.extension-primary[\s\S]*display:\s*none/);
  assert.match(css, /\.extension-dock-mode-action[\s\S]*display:\s*none !important/);
});
