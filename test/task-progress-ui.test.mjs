import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

test("Desktop renders typed round, token, todo, and no-progress state from the Engine event", () => {
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const styles = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(client, /export interface AgentRunProgress/);
  assert.match(client, /trigger\?: "repeated_tool_call"/);
  assert.match(client, /progress\?: AgentRunProgress/);
  assert.match(client, /stopReason\?:[^;]+"no_progress"[^;]+"repeat_loop"/);

  assert.match(timeline, /TaskProgressTelemetry/);
  assert.match(timeline, /\{progress\.rounds\}\/\{progress\.maxRounds\}/);
  assert.match(timeline, /progress\.toolCalls\.toLocaleString\(\)/);
  assert.match(timeline, /progress\.tokens\.total\.toLocaleString\(\)/);
  assert.match(timeline, /\{progress\.todo\.done\}\/\{progress\.todo\.total\}/);
  assert.match(timeline, /taskProgressStopped/);
  assert.match(timeline, /taskProgressWarning/);
  assert.doesNotMatch(timeline, /JSON\.parse\([^)]*detail/, "the UI never infers progress from terminal prose");

  assert.match(styles, /\.task-progress-telemetry\.is-stopped/);
  assert.match(styles, /\.task-progress-metrics/);
  assert.match(styles, /task-progress-telemetry-state[\s\S]+color: var\(--warning\)/,
    "warning text follows the accessible light/dark semantic palette");
  assert.match(styles, /task-progress-telemetry\.is-stopped[\s\S]+color: var\(--danger\)/,
    "stopped text follows the accessible light/dark semantic palette");
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "narrow windows retain readable metrics");
});
