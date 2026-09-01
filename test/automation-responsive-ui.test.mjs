import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the embedded automation surface responds to its actual stage width", () => {
  const app = read("src/App.tsx");
  const preview = read("src/AutomationPreview.tsx");
  const shell = read("src/App.css");
  const automation = read("src/Automations.css");

  assert.match(
    app,
    /zone === "auto"[\s\S]*?<main className="chat board automation-board">/,
    "the embedded automation route must opt into its stage container",
  );
  assert.match(shell, /\.automation-board\s*\{[\s\S]*?container:\s*automation-stage\s*\/\s*inline-size;/);
  assert.match(automation, /@container automation-stage \(max-width: 760px\)/);
  assert.match(
    automation,
    /@container automation-stage \(max-width: 760px\)[\s\S]*?\.hara-automation-task-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 34px;/,
  );
  assert.match(automation, /@container automation-stage \(max-width: 520px\)/);
  assert.match(preview, /className="chat board automation-board"/);
  assert.match(preview, /detail: "The local scheduler is installed and healthy\."/);
});

test("the separately mounted automation sidebar owns complete light and dark tokens", () => {
  const automation = read("src/Automations.css");
  const daylight = read("src/theme-light.css");
  const sidebar = automation.match(/\.hara-automation-sidebar\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  for (const token of [
    "--automation-coral",
    "--automation-ink",
    "--automation-muted",
    "--automation-base",
    "--automation-panel",
    "--automation-raised",
    "--automation-line",
  ]) {
    assert.match(sidebar, new RegExp(`${token}:`), `${token} must exist without a .hara-automation-view ancestor`);
  }
  assert.match(
    daylight,
    /html\[data-theme="light"\] \.hara-automation-view,[\s\S]*?html\[data-theme="light"\] \.hara-automation-sidebar\s*\{/,
  );
});

test("scheduler status copy follows the selected Desktop language", () => {
  const source = read("src/Automations.tsx");
  const banner = source.slice(source.indexOf("function SchedulerBanner"), source.indexOf("function PageMetrics"));

  assert.doesNotMatch(banner, /body\s*=\s*scheduler\.(?:detail|issue)/);
  assert.match(banner, /body = copy\.schedulerMissingBody/);
  assert.match(banner, /body = copy\.schedulerOfflineBody/);
  assert.match(banner, /body = copy\.schedulerReadyBody/);
});
