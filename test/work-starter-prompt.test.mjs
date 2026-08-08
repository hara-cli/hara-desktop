import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkPrompt } from "../src/work-starter-prompt.ts";

test("the free-form workbench stays generic until a specialist card is selected", () => {
  const prompt = buildWorkPrompt("general", "整理本周客户反馈并给出建议", "zh");

  assert.match(prompt, /完成这项工作/);
  assert.match(prompt, /验收条件/);
  assert.doesNotMatch(prompt, /PPT|演示文稿|表格|文档/);
});

test("the presentation card enters a specialist flow without requiring a second vision model", () => {
  const prompt = buildWorkPrompt("presentation", "季度经营复盘", "zh");

  assert.match(prompt, /受众/);
  assert.match(prompt, /PPT 专业模式/);
  assert.match(prompt, /右侧工作区/);
  assert.match(prompt, /可编辑 PPTX/);
  assert.match(prompt, /同一个 Artifact/);
  assert.match(prompt, /不得另行配置或调用视觉辅助模型/);
  assert.match(prompt, /结构化版本和同源渲染结果/);
});

test("an attachment-only starter turn gets a useful plain-language goal", () => {
  const prompt = buildWorkPrompt("summary", "", "zh");

  assert.match(prompt, /审阅本轮附加的资料/);
  assert.match(prompt, /事实证据与推断分开/);
  assert.doesNotMatch(prompt, /：\s*\n/);
});
