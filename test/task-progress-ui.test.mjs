import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { taskProgressStopExplanation } from "../src/task-progress-presentation.ts";
import { makeT } from "../src/i18n.ts";

const root = new URL("..", import.meta.url).pathname;

test("Desktop renders typed round, token, todo, and no-progress state from the Engine event", () => {
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const styles = readFileSync(`${root}/src/App.css`, "utf8");
  const presentation = readFileSync(`${root}/src/task-progress-presentation.ts`, "utf8");

  assert.match(client, /export interface AgentRunProgress/);
  assert.match(client, /trigger\?: "repeated_tool_call"/);
  assert.match(client, /progress\?: AgentRunProgress/);
  assert.match(client, /stopReason\?:[^;]+"no_progress"[^;]+"repeat_loop"/);

  assert.match(timeline, /TaskProgressTelemetry/);
  assert.match(timeline, /\{progress\.rounds\}\/\{progress\.maxRounds\}/);
  assert.match(timeline, /progress\.toolCalls\.toLocaleString\(\)/);
  assert.match(timeline, /progress\.tokens\.total\.toLocaleString\(\)/);
  assert.match(timeline, /t\("modelIo"\)/, "the cumulative counter is not mislabeled as one context window");
  assert.match(timeline, /t\("modelIoTip"\)/, "the metric explains its model-request scope");
  assert.match(timeline, /\{progress\.todo\.done\}\/\{progress\.todo\.total\}/);
  assert.match(timeline, /taskProgressStopped/);
  assert.match(timeline, /taskProgressWarning/);
  assert.match(timeline, /taskProgressStopExplanation\(visibleTask\.progress, t\)/);
  assert.match(presentation, /case "repeated_tool_call"/);
  assert.match(presentation, /case "similar_tool_evidence"/);
  assert.match(presentation, /case "unattended_without_checkpoint"/);
  assert.match(presentation, /case "unattended_token_budget"/);
  assert.match(timeline, /visibleTask\.progress\?\.state === "stopped"/,
    "the concise task surface exposes a typed stop reason without enabling debug telemetry");
  assert.match(timeline, /className="task-progress-stop-reason"/);
  assert.match(timeline, /taskProgressStopRecovery/);
  assert.doesNotMatch(timeline, /JSON\.parse\([^)]*detail/, "the UI never infers progress from terminal prose");

  assert.match(styles, /\.task-progress-telemetry\.is-stopped/);
  assert.match(styles, /\.task-progress-stop-reason/);
  assert.match(styles, /\.task-progress-metrics/);
  assert.match(styles, /task-progress-telemetry-state[\s\S]+color: var\(--warning\)/,
    "warning text follows the accessible light/dark semantic palette");
  assert.match(styles, /task-progress-telemetry\.is-stopped[\s\S]+color: var\(--danger\)/,
    "stopped text follows the accessible light/dark semantic palette");
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "narrow windows retain readable metrics");
});

test("each typed stop cause has a resolved explanation in both locales", () => {
  const progress = { checkpointStaleRounds: 8, tokens: { total: 286506 } };
  for (const locale of ["en", "zh"]) {
    const t = makeT(locale);
    const causes = [
      "repeated_tool_call", "similar_tool_evidence",
      "unattended_without_checkpoint", "unattended_token_budget",
    ];
    const explanations = causes.map((trigger) => taskProgressStopExplanation({ ...progress, trigger }, t));
    assert.equal(new Set(explanations).size, causes.length);
    for (const explanation of explanations) {
      assert.ok(explanation.length > 10);
      assert.doesNotMatch(explanation, /\{tokens\}|\{rounds\}/);
    }
    assert.ok(explanations[2].includes("8"));
    assert.ok(explanations[3].includes(progress.tokens.total.toLocaleString()));
    assert.ok(explanations[3].includes("8"));
  }
});

test("missing or future stop causes remain neutral and do not leak raw evidence", () => {
  for (const locale of ["en", "zh"]) {
    const t = makeT(locale);
    for (const trigger of [undefined, "future_engine_reason"]) {
      assert.equal(taskProgressStopExplanation({
        trigger,
        checkpointStaleRounds: 0,
        tokens: { total: 0 },
        repeatedTool: "sensitive-command-or-output",
      }, t), t("taskProgressStopUnknown"));
    }
  }
});
