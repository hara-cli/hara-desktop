import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeT } from "../src/i18n.ts";
import { emptySchedulePicker, oneTimeInstant, pickerToSchedule, scheduleToPicker } from "../src/workspace-schedule-picker.ts";

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ["src/WorkspaceSchedulePicker.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false });
const component = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, component, component.exports);
const { WorkspaceSchedulePicker } = component.exports;

test("one-time local date and time round-trip through UTC storage", () => {
  const tz = "Asia/Taipei", value = { ...emptySchedulePicker(tz), mode: "once", date: "2026-12-01", time: "09:30" };
  const stored = pickerToSchedule(value, Date.parse("2026-11-04T00:00:00Z"));
  assert.equal(stored.runAt, Date.parse("2026-12-01T01:30:00Z"));
  assert.deepEqual({ date: scheduleToPicker(stored, tz).date, time: scheduleToPicker(stored, tz).time }, { date: "2026-12-01", time: "09:30" });
});

test("DST gaps and repeated hours are rejected rather than shifted or guessed", () => {
  assert.throws(() => oneTimeInstant("2026-03-08", "02:30", "America/New_York"), /nonexistent_time/);
  assert.throws(() => oneTimeInstant("2026-11-01", "01:30", "America/New_York"), /ambiguous_time/);
  assert.equal(oneTimeInstant("2026-03-08", "03:30", "America/New_York"), Date.parse("2026-03-08T07:30:00Z"));
});

test("daily, weekly and intervals round-trip without changing the Core schedule contract", () => {
  const base = emptySchedulePicker("Europe/Berlin");
  for (const value of [{ ...base, mode: "daily", time: "08:45" }, { ...base, mode: "weekly", time: "18:05", weekdays: [5, 1] },
    { ...base, mode: "interval", interval: "15", intervalUnit: "minutes" }, { ...base, mode: "interval", interval: "2", intervalUnit: "hours" }]) {
    const stored = pickerToSchedule(value), back = scheduleToPicker(stored, value.tz);
    assert.deepEqual(pickerToSchedule(back), stored);
  }
  assert.throws(() => pickerToSchedule({ ...base, mode: "interval", interval: "14" }), /invalid_interval/);
  assert.throws(() => pickerToSchedule({ ...base, mode: "interval", interval: "0" }), /invalid_interval/);
  assert.throws(() => pickerToSchedule({ ...base, mode: "weekly", weekdays: [] }), /invalid_weekdays/);
  assert.throws(() => pickerToSchedule({ ...base, tz: "No/Such_Zone" }), /invalid_timezone/);
  assert.throws(() => pickerToSchedule({ ...base, date: "2026-02-30" }), /invalid_time/);
});

test("unsupported legacy values remain visible and require explicit conversion", () => {
  const old = { kind: "cron", expr: "0 9 1 * *" }, value = scheduleToPicker(old, "UTC");
  assert.equal(value.mode, "unsupported"); assert.deepEqual(value.original, old);
  assert.throws(() => pickerToSchedule(value), /unsupported_schedule/);
  const html = renderToStaticMarkup(createElement(WorkspaceSchedulePicker, { value, onChange() {}, t: makeT("en") }));
  assert.match(html, /0 9 1 \* \*/); assert.match(html, /Change to picker/);
});

test("picker controls render in English, simplified Chinese and traditional Chinese", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const mode of ["once", "daily", "weekly", "interval"]) {
      const html = renderToStaticMarkup(createElement(WorkspaceSchedulePicker, { value: { ...emptySchedulePicker("Asia/Taipei"), mode }, onChange() {}, t }));
      assert.match(html, /<select/); assert.equal(html.includes("ws.schedules."), false);
      assert.ok(html.includes(t("ws.schedules.frequency")));
      if (mode === "weekly") assert.ok(html.includes(t("ws.schedules.weekday.1")));
    }
  }
});
