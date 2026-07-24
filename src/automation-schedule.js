/**
 * Pure schedule-draft helpers for the Desktop automation form.
 *
 * Presets deliberately hide cron syntax. The returned spec is the compact string accepted by
 * `automation.add`; only the advanced preset accepts a user-authored cron expression.
 */

export const AUTOMATION_SCHEDULE_MODES = Object.freeze([
  "once",
  "interval",
  "daily",
  "weekdays",
  "weekly",
  "advanced",
]);

const MODE_SET = new Set(AUTOMATION_SCHEDULE_MODES);
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INTEGER_PATTERN = /^\d+$/;

const INTERVAL_UNITS = Object.freeze({
  minutes: { suffix: "m", milliseconds: 60_000, zh: "分钟", en: ["minute", "minutes"] },
  hours: { suffix: "h", milliseconds: 3_600_000, zh: "小时", en: ["hour", "hours"] },
  days: { suffix: "d", milliseconds: 86_400_000, zh: "天", en: ["day", "days"] },
});

const WEEKDAYS = Object.freeze([
  { key: "mon", cron: 1, zh: "周一", en: "Monday" },
  { key: "tue", cron: 2, zh: "周二", en: "Tuesday" },
  { key: "wed", cron: 3, zh: "周三", en: "Wednesday" },
  { key: "thu", cron: 4, zh: "周四", en: "Thursday" },
  { key: "fri", cron: 5, zh: "周五", en: "Friday" },
  { key: "sat", cron: 6, zh: "周六", en: "Saturday" },
  { key: "sun", cron: 0, zh: "周日", en: "Sunday" },
]);
const WEEKDAY_BY_KEY = new Map(WEEKDAYS.map((weekday) => [weekday.key, weekday]));
const ENGLISH_MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

/**
 * A validation error with stable machine-readable details for form field feedback.
 */
export class AutomationScheduleError extends Error {
  /**
   * @param {string} code
   * @param {string} field
   * @param {string} message
   */
  constructor(code, field, message) {
    super(message);
    this.name = "AutomationScheduleError";
    this.code = code;
    this.field = field;
  }
}

/**
 * Convert one of the ordinary-user presets (or the explicit advanced cron mode) into the schedule
 * string understood by Hara, together with deterministic Chinese and English descriptions.
 *
 * `now` is injectable so a one-shot form can be validated without reading the clock in tests.
 *
 * @param {Record<string, unknown>} draft
 * @param {{ now?: Date | number }} [options]
 * @returns {{ mode: string, spec: string, summary: { zh: string, en: string } }}
 */
export function buildAutomationSchedule(draft, options = {}) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw scheduleError("INVALID_MODE", "mode", "Choose a schedule type.");
  }

  const mode = draft.mode;
  if (typeof mode !== "string" || !MODE_SET.has(mode)) {
    throw scheduleError("INVALID_MODE", "mode", "Choose a supported schedule type.");
  }

  switch (mode) {
    case "once":
      return buildOnceSchedule(draft, options);
    case "interval":
      return buildIntervalSchedule(draft);
    case "daily":
      return buildDailySchedule(draft);
    case "weekdays":
      return buildWeekdaySchedule(draft);
    case "weekly":
      return buildWeeklySchedule(draft);
    case "advanced":
      return buildAdvancedSchedule(draft);
    default:
      // MODE_SET and the switch intentionally mirror one another. Keep a defensive branch for JS
      // callers in case they are ever changed independently.
      throw scheduleError("INVALID_MODE", "mode", "Choose a supported schedule type.");
  }
}

function buildOnceSchedule(draft, options) {
  const date = parseDate(draft.date);
  const time = parseTime(draft.time);
  const runAt = new Date(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);

  // A skipped local wall-clock time during a DST transition is not the time the user entered.
  if (
    runAt.getFullYear() !== date.year
    || runAt.getMonth() !== date.month - 1
    || runAt.getDate() !== date.day
    || runAt.getHours() !== time.hour
    || runAt.getMinutes() !== time.minute
  ) {
    throw scheduleError("INVALID_TIME", "time", "This local date and time does not exist.");
  }

  if (runAt.getTime() <= parseNow(options.now)) {
    throw scheduleError("PAST_TIME", "date", "Choose a time in the future.");
  }

  const spec = `${date.source}T${time.source}:00`;
  return {
    mode: "once",
    spec,
    summary: {
      zh: `仅一次：${date.year}年${date.month}月${date.day}日 ${time.source}`,
      en: `Once: ${ENGLISH_MONTHS[date.month - 1]} ${date.day}, ${date.year} at ${time.source}`,
    },
  };
}

function buildIntervalSchedule(draft) {
  const unit = typeof draft.unit === "string" ? INTERVAL_UNITS[draft.unit] : undefined;
  if (!unit) {
    throw scheduleError("INVALID_INTERVAL_UNIT", "unit", "Choose minutes, hours, or days.");
  }

  const every = parsePositiveInteger(draft.every);
  if (every === null || every > Math.floor(Number.MAX_SAFE_INTEGER / unit.milliseconds)) {
    throw scheduleError("INVALID_INTERVAL", "every", "Enter a positive whole-number interval.");
  }

  return {
    mode: "interval",
    spec: `every ${every}${unit.suffix}`,
    summary: {
      zh: `每 ${every} ${unit.zh}`,
      en: `Every ${every} ${unit.en[every === 1 ? 0 : 1]}`,
    },
  };
}

function buildDailySchedule(draft) {
  const time = parseTime(draft.time);
  return {
    mode: "daily",
    spec: `${time.minute} ${time.hour} * * *`,
    summary: {
      zh: `每天 ${time.source}`,
      en: `Every day at ${time.source}`,
    },
  };
}

function buildWeekdaySchedule(draft) {
  const time = parseTime(draft.time);
  return {
    mode: "weekdays",
    spec: `${time.minute} ${time.hour} * * 1-5`,
    summary: {
      zh: `工作日 ${time.source}`,
      en: `Weekdays at ${time.source}`,
    },
  };
}

function buildWeeklySchedule(draft) {
  const time = parseTime(draft.time);
  const weekdays = parseWeekdays(draft.weekdays);

  if (weekdays.length === WEEKDAYS.length) {
    return {
      mode: "weekly",
      spec: `${time.minute} ${time.hour} * * *`,
      summary: {
        zh: `每天 ${time.source}`,
        en: `Every day at ${time.source}`,
      },
    };
  }

  return {
    mode: "weekly",
    spec: `${time.minute} ${time.hour} * * ${weekdays.map((weekday) => weekday.cron).join(",")}`,
    summary: {
      zh: `每${weekdays.map((weekday) => weekday.zh).join("、")} ${time.source}`,
      en: `Every ${formatEnglishList(weekdays.map((weekday) => weekday.en))} at ${time.source}`,
    },
  };
}

function buildAdvancedSchedule(draft) {
  if (typeof draft.cron !== "string") {
    throw scheduleError("INVALID_CRON", "cron", "Enter a five-field cron expression.");
  }
  const parts = draft.cron.trim().split(/\s+/);
  if (!isValidCron(parts)) {
    throw scheduleError("INVALID_CRON", "cron", "Enter a valid five-field cron expression.");
  }
  const spec = parts.join(" ");
  return {
    mode: "advanced",
    spec,
    summary: {
      zh: `自定义计划：${spec}`,
      en: `Custom schedule: ${spec}`,
    },
  };
}

function parseDate(value) {
  if (typeof value !== "string") {
    throw scheduleError("INVALID_DATE", "date", "Enter a date in YYYY-MM-DD format.");
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw scheduleError("INVALID_DATE", "date", "Enter a date in YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw scheduleError("INVALID_DATE", "date", "Enter a real calendar date.");
  }
  return { source: value, year, month, day };
}

function parseTime(value) {
  if (typeof value !== "string") {
    throw scheduleError("INVALID_TIME", "time", "Enter a time in HH:mm format.");
  }
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw scheduleError("INVALID_TIME", "time", "Enter a time in HH:mm format.");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw scheduleError("INVALID_TIME", "time", "Enter a valid 24-hour time.");
  }
  return { source: value, hour, minute };
}

function parseWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw scheduleError("INVALID_WEEKDAYS", "weekdays", "Choose at least one weekday.");
  }

  const selected = new Set();
  for (const key of value) {
    if (typeof key !== "string" || !WEEKDAY_BY_KEY.has(key) || selected.has(key)) {
      throw scheduleError("INVALID_WEEKDAYS", "weekdays", "Choose valid weekdays without duplicates.");
    }
    selected.add(key);
  }
  return WEEKDAYS.filter((weekday) => selected.has(weekday.key));
}

function parsePositiveInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!INTEGER_PATTERN.test(source)) return null;
  const parsed = Number(source);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNow(value) {
  if (value === undefined) return Date.now();
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) {
    throw scheduleError("INVALID_NOW", "now", "The validation clock must be a valid date or timestamp.");
  }
  return milliseconds;
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function formatEnglishList(values) {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function isValidCron(parts) {
  if (parts.length !== 5) return false;
  return (
    parseCronField(parts[0], 0, 59)
    && parseCronField(parts[1], 0, 23)
    && parseCronField(parts[2], 1, 31)
    && parseCronField(parts[3], 1, 12)
    && parseCronField(parts[4], 0, 6)
  );
}

// Match the five-field cron grammar accepted by Hara's scheduler: wildcard, list, range and step.
function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    if (part === "") return false;
    const slash = part.split("/");
    if (slash.length > 2) return false;

    const [rangeSource, stepSource] = slash;
    if (stepSource !== undefined && !INTEGER_PATTERN.test(stepSource)) return false;
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isSafeInteger(step) || step < 1) return false;

    let first;
    let last;
    if (rangeSource === "*") {
      first = min;
      last = max;
    } else if (rangeSource.includes("-")) {
      const range = rangeSource.split("-");
      if (
        range.length !== 2
        || !INTEGER_PATTERN.test(range[0])
        || !INTEGER_PATTERN.test(range[1])
      ) {
        return false;
      }
      first = Number(range[0]);
      last = Number(range[1]);
    } else {
      if (!INTEGER_PATTERN.test(rangeSource)) return false;
      first = Number(rangeSource);
      last = stepSource === undefined ? first : max;
    }

    if (
      !Number.isSafeInteger(first)
      || !Number.isSafeInteger(last)
      || first < min
      || last > max
      || first > last
    ) {
      return false;
    }
    for (let value = first; value <= last; value += step) values.add(value);
  }
  return values.size > 0;
}

function scheduleError(code, field, message) {
  return new AutomationScheduleError(code, field, message);
}
