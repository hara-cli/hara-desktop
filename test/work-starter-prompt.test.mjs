import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkPrompt } from "../src/work-starter-prompt.ts";

test("the free-form workbench stays generic until a specialist card is selected", () => {
  const prompt = buildWorkPrompt("general", "整理本周客户反馈并给出建议", "zh");

  assert.match(prompt, /完成这项工作/);
  assert.match(prompt, /验收条件/);
  assert.doesNotMatch(prompt, /PPT|演示文稿|表格|文档/);
});

test("the presentation card adds narrative and export-fidelity gates", () => {
  const prompt = buildWorkPrompt("presentation", "季度经营复盘", "zh");

  assert.match(prompt, /受众/);
  assert.match(prompt, /叙事结构和页纲/);
  assert.match(prompt, /可编辑 PPTX/);
  assert.match(prompt, /视觉保真 PPTX\/PDF/);
  assert.match(prompt, /确认后再制作页面/);
});
