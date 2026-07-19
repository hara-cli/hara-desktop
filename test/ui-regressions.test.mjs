import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyEngineVersion } from "../src/engine-version.js";

const root = fileURLToPath(new URL("..", import.meta.url));

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

  assert.match(app, /import \{ AppRail, type AppPlace \} from "\.\/AppRail"/);
  assert.match(app, /<ConversationTimeline/);
  assert.doesNotMatch(app, /<nav className="rail"/);
  assert.match(rail, /export type AppPlace = "chat" \| "projects" \| "auto" \| "settings"/);
  assert.match(timeline, /case "approval"/, "approvals stay in the session timeline");
  assert.match(timeline, /const lastUser = items\.map/, "busy progress remains scoped to the current turn");
});

test("settings use shared page templates and keep Desktop, engine, and update state distinct", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const settings = readFileSync(`${root}/src/SettingsUI.tsx`, "utf8");
  const css = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(settings, /export function SettingsPage/);
  assert.match(settings, /export function SettingsCard/);
  assert.match(settings, /export function SettingsItem/);
  assert.match(settings, /export function SettingsNotice/);
  assert.match(settings, /htmlFor=\{htmlFor\}/, "shared rows can expose a real label to form controls");
  assert.match(settings, /tone === "warning" \|\| tone === "error" \? "alert"/);
  assert.match(app, /getVersion\(\)\.then\(setDesktopVersion\)/);
  assert.match(app, /title=\{t\("desktopVersion"\)\}/);
  assert.match(app, /t\("engineVersion"\)/);
  assert.match(app, /classifyEngineVersion\(server\?\.version \?\? "", BUNDLED_ENGINE_VERSION\)/);
  assert.match(app, /engineVersionState === "older" \|\| engineVersionState === "incompatible"/);
  assert.match(app, /engineVersionState === "newer"[\s\S]*<SettingsNotice tone="neutral"/);
  assert.doesNotMatch(app, /server\.version === BUNDLED_ENGINE_VERSION/, "engine health is not a raw string comparison");
  assert.match(app, /<ProviderSettings\s+embedded/, "the default provider page uses the shared settings shell");
  assert.match(app, /t\("restartNow"\)/);
  assert.match(app, /await update\.downloadAndInstall\(\);\s+setUpdAvail\(""\)/, "ready and available update states cannot conflict");
  assert.match(app, /setUpdateTone\("error"\)/, "updater failures render as errors");
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
  assert.match(nativeHost, /fn terminate_legacy_serve\(expected_pid: u32\) -> Result<\(\), String>/);
  assert.match(nativeHost, /read_private_discovery_at\(&path\)/);
  assert.match(nativeHost, /process_path_is_hara_sidecar/);
  assert.match(nativeHost, /libc::kill\(pid as i32, libc::SIGTERM\)/);
  assert.match(nativeHost, /terminate_legacy_serve,/);
  assert.match(app, /const pid = await invoke<number>\("start_serve"\)/);
  assert.match(app, /if \(discovery\.pid === pid\)/, "startup ignores a stale discovery from another process");
  assert.match(app, /expectedPid !== null && d\.pid !== expectedPid/, "the final connection repeats the pid handshake");
  assert.match(app, /await connect\(pid\)/);
  assert.match(app, /await invoke\("restart_after_update"\)/);
  assert.match(nativeHost, /fn take_update_restart_marker\(app: tauri::AppHandle\)/);
  assert.match(nativeHost, /fn restart_after_update\(app: tauri::AppHandle\)/);
  assert.match(nativeHost, /arm_update_restart_marker_at/);
  assert.match(nativeHost, /app\.restart\(\)/);
  assert.match(nativeHost, /take_update_restart_marker,/);
  assert.match(nativeHost, /restart_after_update,/);
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
  assert.match(providerSettings, /disabled=\{phase !== "idle"\}/, "draft fields are locked while an async connection test is in flight");
  assert.match(providerSettings, /aria-pressed=\{draft\.model === model\}/, "discovered models expose selection state");
  assert.match(providerSettings, /className="provider-result pending" role="status" aria-live="polite"/);
  assert.match(providerSettings, /className="provider-result ok" role="status" aria-live="polite"/);
  assert.match(providerSettings, /className="provider-result error" role="alert" aria-live="assertive"/);
  assert.doesNotMatch(app, /invoke\("write_config"/, "renderer must not bypass the serve control plane");
  assert.match(client, /settings\.providers\.list/);
  assert.match(client, /settings\.providers\.test/);
  assert.match(client, /settings\.providers\.save/);
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

  assert.match(app, /<WorkStarter/);
  assert.match(app, /const sessionId = await openAssistant\(\)/);
  assert.match(app, /await sendText\(sessionId, prompt\)/, "a starter job must enter the normal serve-backed conversation");
  assert.doesNotMatch(starter, /\b(?:Agent|Skill|MCP|cwd)\b/, "novice-facing copy must not expose runtime jargon");
  assert.match(prompt, /可编辑 PPTX/);
  assert.match(prompt, /视觉保真 PPTX\/PDF/, "presentation prompts must state the export-fidelity boundary");
  assert.match(prompt, /能力已经安装/, "artifact cards must verify capability availability before promising an export");
  assert.match(starter, /aria-label=\{copy\.describe\}/);
  assert.match(css, /\.workstarter-grid/);
  assert.match(css, /@media \(max-width: 760px\)/, "the workbench must remain usable in a narrow window");
});

test("switching places cannot reuse a conversation from the wrong place", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");

  assert.match(app, /activeByZoneRef/);
  assert.match(app, /sessionOpenRequestRef/);
  assert.match(app, /sessionActivationAllowed/, "late async session results must pass both generation and place checks");
  assert.match(app, /sessionPlace\(candidate\) === z/);
  assert.match(app, /setActive\(candidate && sessionPlace\(candidate\) === z \? candidate\.id : null\)/);
  assert.match(app, /sessionsRef\.current = list\.sessions;\s+setSessions\(list\.sessions\)/, "fork routing sees a refreshed session before changing place");
  assert.match(app, /clearActiveSession\(id\)/, "archiving or deleting must also clear the remembered place");
});

test("disabled plugins cannot launch a panel from settings", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");

  assert.match(app, /p\.enabled && \(p\.panels \?\? \[\]\)\.map/);
  assert.match(app, /pluginsRef\.current\?\.find\(\(plugin\) => plugin\.name === pluginName\)\?\.enabled !== true/);
  assert.match(app, /!enabled && split\?\.plugin === name/);
  assert.match(app, /panels\.filter\(\(panel\) => panel\.plugin !== name\)/, "disabling a plugin evicts cached project panels");
  assert.match(app, /const plugin = pluginsRef\.current\?\.find/, "cached project panels are gated again before launch");
  assert.match(app, /className="ready-error" role="alert"/, "ready-state failures stay visible and dismissible");
});
