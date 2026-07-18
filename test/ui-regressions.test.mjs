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
