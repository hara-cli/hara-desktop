import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("rail buttons reset global padding so navigation SVGs cannot collapse into dots", () => {
  const css = readFileSync(`${root}/src/App.css`, "utf8");
  const railButton = css.match(/\.rail button \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const railSvg = css.match(/\.rail button > svg \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(railButton, /padding:\s*0\s*;/);
  assert.match(railButton, /flex:\s*0\s+0\s+34px\s*;/);
  assert.match(railButton, /color:\s*#d0cdc6\s*;/);
  assert.match(railSvg, /flex:\s*0\s+0\s+auto\s*;/);
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
  assert.doesNotMatch(app, /invoke\("write_config"/, "renderer must not bypass the serve control plane");
  assert.match(client, /settings\.providers\.list/);
  assert.match(client, /settings\.providers\.test/);
  assert.match(client, /settings\.providers\.save/);
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
