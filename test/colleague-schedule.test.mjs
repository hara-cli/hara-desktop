import test from "node:test";
import assert from "node:assert/strict";
import { parseColleagueScheduleRequest } from "../src/colleague-schedule.js";

test("chat schedule drafts retain explicit colleague-local time and timezone", () => {
  assert.deepEqual(parseColleagueScheduleRequest("每天工作日 09:00 给我视觉债摘要", "Asia/Taipei"), {
    name: "每天工作日 09:00 给我视觉债摘要", schedule: "0 9 * * 1-5",
    task: "每天工作日 09:00 给我视觉债摘要", tz: "Asia/Taipei",
  });
  assert.equal(parseColleagueScheduleRequest("每周一 18:30 整理决策", "Asia/Taipei")?.schedule, "30 18 * * 1");
  assert.equal(parseColleagueScheduleRequest("请分析每天的工作流程", "Asia/Taipei"), null);
});
