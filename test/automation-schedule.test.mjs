import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_SCHEDULE_MODES,
  AutomationScheduleError,
  buildAutomationSchedule,
} from "../src/automation-schedule.js";

const FIXED_NOW = new Date(2026, 6, 24, 8, 0, 0);

function assertScheduleError(run, code, field) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof AutomationScheduleError);
    assert.equal(error.code, code);
    assert.equal(error.field, field);
    return true;
  });
}

test("exposes the six schedule modes in ordinary-to-advanced order", () => {
  assert.deepEqual(AUTOMATION_SCHEDULE_MODES, [
    "once",
    "interval",
    "daily",
    "weekdays",
    "weekly",
    "advanced",
  ]);
  assert.equal(Object.isFrozen(AUTOMATION_SCHEDULE_MODES), true);
});

test("once builds a local ISO spec and bilingual summary against an injected clock", () => {
  assert.deepEqual(
    buildAutomationSchedule(
      { mode: "once", date: "2026-07-25", time: "09:30" },
      { now: FIXED_NOW },
    ),
    {
      mode: "once",
      spec: "2026-07-25T09:30:00",
      summary: {
        zh: "仅一次：2026年7月25日 09:30",
        en: "Once: July 25, 2026 at 09:30",
      },
    },
  );
});

test("once strictly validates calendar date, 24-hour time, future ordering, and test clock", () => {
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2026/07/25", time: "09:30" },
      { now: FIXED_NOW },
    ),
    "INVALID_DATE",
    "date",
  );
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2026-02-29", time: "09:30" },
      { now: FIXED_NOW },
    ),
    "INVALID_DATE",
    "date",
  );
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2028-02-29", time: "9:30" },
      { now: FIXED_NOW },
    ),
    "INVALID_TIME",
    "time",
  );
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2028-02-29", time: "24:00" },
      { now: FIXED_NOW },
    ),
    "INVALID_TIME",
    "time",
  );
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2026-07-24", time: "08:00" },
      { now: FIXED_NOW },
    ),
    "PAST_TIME",
    "date",
  );
  assertScheduleError(
    () => buildAutomationSchedule(
      { mode: "once", date: "2026-07-25", time: "09:30" },
      { now: new Date("invalid") },
    ),
    "INVALID_NOW",
    "now",
  );
});

test("interval maps minute, hour and day presets without exposing cron", () => {
  assert.deepEqual(buildAutomationSchedule({ mode: "interval", every: "15", unit: "minutes" }), {
    mode: "interval",
    spec: "every 15m",
    summary: { zh: "每 15 分钟", en: "Every 15 minutes" },
  });
  assert.deepEqual(buildAutomationSchedule({ mode: "interval", every: 1, unit: "hours" }), {
    mode: "interval",
    spec: "every 1h",
    summary: { zh: "每 1 小时", en: "Every 1 hour" },
  });
  assert.deepEqual(buildAutomationSchedule({ mode: "interval", every: 3, unit: "days" }), {
    mode: "interval",
    spec: "every 3d",
    summary: { zh: "每 3 天", en: "Every 3 days" },
  });
});

test("interval rejects zero, negative, fractional, unsafe, and unsupported values", () => {
  for (const every of [0, -1, 1.5, "", "1.5", "1e2", Number.MAX_SAFE_INTEGER + 1]) {
    assertScheduleError(
      () => buildAutomationSchedule({ mode: "interval", every, unit: "minutes" }),
      "INVALID_INTERVAL",
      "every",
    );
  }
  assertScheduleError(
    () => buildAutomationSchedule({ mode: "interval", every: 2, unit: "weeks" }),
    "INVALID_INTERVAL_UNIT",
    "unit",
  );
  assertScheduleError(
    () => buildAutomationSchedule({
      mode: "interval",
      every: Math.floor(Number.MAX_SAFE_INTEGER / 86_400_000) + 1,
      unit: "days",
    }),
    "INVALID_INTERVAL",
    "every",
  );
});

test("daily and weekdays produce hidden canonical cron specs and clear summaries", () => {
  assert.deepEqual(buildAutomationSchedule({ mode: "daily", time: "09:05" }), {
    mode: "daily",
    spec: "5 9 * * *",
    summary: { zh: "每天 09:05", en: "Every day at 09:05" },
  });
  assert.deepEqual(buildAutomationSchedule({ mode: "weekdays", time: "18:30" }), {
    mode: "weekdays",
    spec: "30 18 * * 1-5",
    summary: { zh: "工作日 18:30", en: "Weekdays at 18:30" },
  });
  assertScheduleError(
    () => buildAutomationSchedule({ mode: "daily", time: "12:60" }),
    "INVALID_TIME",
    "time",
  );
  assertScheduleError(
    () => buildAutomationSchedule({ mode: "weekdays", time: " 09:00 " }),
    "INVALID_TIME",
    "time",
  );
});

test("weekly validates, sorts and describes selected weekdays without mutating the draft", () => {
  const weekdays = ["fri", "mon", "wed"];
  assert.deepEqual(buildAutomationSchedule({ mode: "weekly", time: "07:15", weekdays }), {
    mode: "weekly",
    spec: "15 7 * * 1,3,5",
    summary: {
      zh: "每周一、周三、周五 07:15",
      en: "Every Monday, Wednesday, and Friday at 07:15",
    },
  });
  assert.deepEqual(weekdays, ["fri", "mon", "wed"]);

  assert.deepEqual(
    buildAutomationSchedule({ mode: "weekly", time: "20:00", weekdays: ["sun", "sat"] }),
    {
      mode: "weekly",
      spec: "0 20 * * 6,0",
      summary: {
        zh: "每周六、周日 20:00",
        en: "Every Saturday and Sunday at 20:00",
      },
    },
  );
});

test("weekly collapses all seven selected days to the daily machine spec", () => {
  assert.deepEqual(
    buildAutomationSchedule({
      mode: "weekly",
      time: "06:00",
      weekdays: ["sun", "sat", "fri", "thu", "wed", "tue", "mon"],
    }),
    {
      mode: "weekly",
      spec: "0 6 * * *",
      summary: { zh: "每天 06:00", en: "Every day at 06:00" },
    },
  );
});

test("weekly rejects missing, empty, unknown, duplicate, and non-string weekdays", () => {
  for (const weekdays of [undefined, [], ["monday"], ["mon", "mon"], ["mon", 2]]) {
    assertScheduleError(
      () => buildAutomationSchedule({ mode: "weekly", time: "09:00", weekdays }),
      "INVALID_WEEKDAYS",
      "weekdays",
    );
  }
});

test("advanced is the only user-authored cron mode and normalizes whitespace", () => {
  assert.deepEqual(
    buildAutomationSchedule({ mode: "advanced", cron: "  */15   0-6  1,15  *  1-5  " }),
    {
      mode: "advanced",
      spec: "*/15 0-6 1,15 * 1-5",
      summary: {
        zh: "自定义计划：*/15 0-6 1,15 * 1-5",
        en: "Custom schedule: */15 0-6 1,15 * 1-5",
      },
    },
  );
  assert.equal(buildAutomationSchedule({ mode: "advanced", cron: "5/15 * * * *" }).spec, "5/15 * * * *");
});

test("advanced strictly rejects malformed and out-of-range cron expressions", () => {
  for (const cron of [
    "",
    "* * * *",
    "* * * * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 7",
    "0 9 * * 1,",
    "/5 * * * *",
    "5/ * * * *",
    "*/0 * * * *",
    "10-5 * * * *",
    "x 9 * * *",
  ]) {
    assertScheduleError(
      () => buildAutomationSchedule({ mode: "advanced", cron }),
      "INVALID_CRON",
      "cron",
    );
  }
});

test("invalid drafts fail with stable mode errors", () => {
  for (const draft of [null, undefined, [], {}, { mode: "monthly" }]) {
    assertScheduleError(
      () => buildAutomationSchedule(draft),
      "INVALID_MODE",
      "mode",
    );
  }
});
