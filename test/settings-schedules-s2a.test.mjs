import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { scheduleHumanText } from "../src/settings-schedule-text.ts";
import { emptySchedulePicker } from "../src/workspace-schedule-picker.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {WorkspaceSchedulePicker} from "./src/WorkspaceSchedulePicker.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const panels = readFileSync(new URL("../src/WorkspaceSettingsPanels.tsx", import.meta.url), "utf8");
const tz = "Asia/Taipei";

test("schedules read in plain words in the schedule's own time zone, in three languages", () => {
  const zh = makeT("zh-Hans"), en = makeT("en"), hant = makeT("zh-Hant");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "0 9 * * 1,2,3,4,5" }, tz, zh, tz), "每个工作日 09:00");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "0 9 * * 1,2,3,4,5" }, tz, en, tz), "Every weekday at 09:00");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "30 8 * * *" }, tz, hant, tz), "每天 08:30");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "0 18 * * 3,1" }, tz, zh, tz), "周一、周三 18:00");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "0 18 * * 1,3" }, tz, en, tz), "Mon, Wed at 18:00");
  assert.equal(scheduleHumanText({ kind: "every", everyMs: 2 * 3_600_000 }, tz, zh, tz), "每 2 小时");
  assert.equal(scheduleHumanText({ kind: "every", everyMs: 15 * 60_000 }, tz, en, tz), "Every 15 min");
  assert.equal(scheduleHumanText({ kind: "once", runAt: Date.parse("2026-12-01T01:00:00Z") }, tz, zh, tz), "2026-12-01 09:00 一次");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "0 9 * * *" }, tz, zh, "Europe/Berlin"), "每天 09:00 (Asia/Taipei)", "another time zone is named");
  assert.equal(scheduleHumanText({ kind: "cron", expr: "*/7 * * * *" }, tz, zh, tz), "*/7 * * * *", "unrepresentable schedules show the original expression");
});

test("rows show who and when; cron, source, anchor and history move under the page's Advanced", () => {
  assert.match(panels, /<small className="wsd-schedule-when">\{scheduleHumanText\(row\.schedule, row\.tz \?\? localTz, t\)\} · \{t\("ws\.schedules\.byAgent", \{ name: agentName\(row\.agentId\) \}\)\}<\/small>/);
  assert.doesNotMatch(panels, /<code>\{row\.schedule\.expr \?\? row\.schedule\.display\}<\/code>/, "the raw expression is not on the row");
  const fold = panels.slice(panels.indexOf('<SettingsAdvanced page="schedules"'));
  for (const pattern of [/row\.schedule\.expr \?\? row\.schedule\.display/, /sourceText\(row\.source\)/, /ws\.schedules\.anchor/, /status\.lastRun\.occurredAt/, /ws\.schedules\.colleagueNote/]) assert.match(fold.slice(0, 2000), pattern);
  assert.match(panels, /<small className=\{status\?\.lastRun\?\.state === "failed" \? "wsd-schedule-failed" : undefined\}>/, "a failed last run is shown in red on the row");
  assert.match(panels, /<p className="wsd-schedule-hint">\{t\("ws\.schedules\.chatHint"\)\}<\/p>/);
});

test("edit and delete are row-end menu items that keep the original editor, confirmation and RPCs", () => {
  assert.match(panels, /\{ id: "delete", label: t\("ws\.schedules\.deleteMenu"\), danger: true, onSelect: \(\) => setScheduleDelete\(\{ id: row\.id, name: row\.name \}\) \}/);
  assert.match(panels, /\{ id: "edit", label: t\("ws\.schedules\.edit"\), onSelect: \(\) => \{ setScheduleEditor\(\{ id: row\.id/);
  assert.match(panels, /"workspace\.schedule\.delete", \{ id: scheduleDelete\.id, expectedRevision: value\.revision, approved: true \}/);
  assert.match(panels, /if \(schedule\.kind !== "once" && !confirmed\) \{ setRepeatConfirm\(true\); return; \}/, "repeating schedules still need confirmation");
});

test("the inline «who» reads as a statement, not the form's imperative label", () => {
  assert.equal(makeT("en")("ws.schedules.byAgent", { name: "Alice" }), "By Alice");
  assert.equal(makeT("zh-Hans")("ws.schedules.byAgent", { name: "小明" }), "交给 小明");
  assert.equal(makeT("zh-Hant")("ws.schedules.byAgent", { name: "小明" }), "交給 小明");
});

test("the legacy-scheduler notice is a pinned bar only while legacy schedules exist", () => {
  assert.match(panels, /<SettingsAttention items=\{value\.schedules\.some\(isLegacySchedule\) \? \[\{ id: "legacy", text: t\("ws\.schedules\.legacyNote"\) \}\] : \[\]\} \/>/);
  assert.match(panels, /\{value\.schedules\.some\(isLegacySchedule\) \? null : <p>\{t\("ws\.schedules\.legacyNote"\)\}<\/p>\}/);
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`the form folds the time zone under Advanced, defaulting to this Mac's zone (${locale})`, () => {
  const t = makeT(locale), local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const render = value => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
    try { return renderToStaticMarkup(createElement(module.exports.WorkspaceSchedulePicker, { value, onChange() {}, t })); }
    finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
  };
  const plain = render(emptySchedulePicker(local));
  assert.ok(plain.includes('data-settings-advanced="schedules.form"') && plain.includes(`value="${local}"`));
  assert.equal(plain.includes(t("ws.settings.advanced.customized", { items: "" }).slice(0, 3)), false, "no customized marker for the default zone");
  const other = local === "Asia/Taipei" ? "Europe/Berlin" : "Asia/Taipei";
  assert.ok(render(emptySchedulePicker(other)).includes(t("ws.settings.advanced.customized", { items: `${t("ws.schedules.tz")} ${other}` })));
});
