import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-capability-simplification-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import React from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {CapabilityDirectory} from "./src/CapabilityDirectory.tsx";
    export function render(props) {return renderToStaticMarkup(React.createElement(CapabilityDirectory, props));}
  `, resolveDir: fileURLToPath(root), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "directory.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);

function props() {
  const copy = new Proxy({
    title: "Skills & extensions", mySkills: "Skills", installed: "Extensions",
    hara: "RETIRED_CORE", organization: "RETIRED_ORGANIZATION", market: "RETIRED_MARKET",
    skillBuilderTitle: "Create a skill", availableSkills: "Available skills", createSkill: "Build in chat",
  }, { get: (object, key) => object[key] ?? String(key) });
  return { copy, core: [{ id: "core.computer", title: "RETIRED_COMPUTER_SHORTCUT" }],
    organization: { label: "RETIRED_ORGANIZATION_DETAILS", model: "model" },
    plugins: [], skills: [{ id: "my-skill", description: "Useful skill", source: "global" }],
    isSkillCreating: false, isPanelBusy: () => false, panelInDock: () => false,
    onCreateSkill() {}, onOpenCore() { throw new Error("Retired shortcut cannot be used"); },
    onTogglePlugin() {}, onOpenPanel() {}, onTogglePanelInDock() {},
  };
}

test("the actual directory opens useful skills and has exactly two tabs, without empty or duplicated destinations", () => {
  const html = render(props());
  assert.equal((html.match(/role="tab" /g) ?? []).length, 2);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 1);
  assert.match(html, /id="capability-tab-skills"[^>]*aria-selected="true"/);
  assert.match(html, /id="capability-panel-skills"/);
  assert.match(html, /my-skill/);
  assert.doesNotMatch(html, /RETIRED_|capability-tab-(?:hara|organization|market)/);
});

test("loading and empty inventories stay actionable without exposing organization state or claiming installed capabilities", () => {
  const input = props();
  input.skills = null;
  input.plugins = null;
  assert.match(render(input), /loading/);
  input.skills = [];
  const html = render(input);
  assert.match(html, /noSkills/);
  assert.match(html, /Build in chat/);
  assert.doesNotMatch(html, /RETIRED_|deviceToken|credentialGeneration/);
});
