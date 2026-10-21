import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workspacePreviewURL } from "../src/workspace-browser-state.ts";
import { buildWorkspaceShell } from "../src/workspace-shell-state.ts";

test("browser preview accepts explicit loopback addresses and rejects credentials or external authority", () => {
  for (const url of ["http://localhost:3456/preview", "https://127.0.0.1/example", "http://[::1]:8080/"]) assert.equal(workspacePreviewURL(url), url);
  for (const url of ["https://example.com/", "http://localhost.example.com/", "http://user:synthetic@localhost/", "file:///etc/passwd", "javascript:void(0)", "data:text/html,hello", "not a URL"]) assert.equal(workspacePreviewURL(url), null);
});
test("retired browser overlay selectors are absent from settings; preview has a dedicated grid column", () => {
  const settings = readFileSync(new URL("../src/workspace-settings.css", import.meta.url), "utf8");
  assert.equal(/wsd-browser-extension|wsd-browser-address|\.wsd-app\.has-browser/.test(settings), false);
  const browser = readFileSync(new URL("../src/workspace-browser.css", import.meta.url), "utf8");
  assert.equal(/\.hs \.hs-win\.has-browser\s*\{\s*grid-template-columns:/.test(browser), true);
  assert.equal(/\.hs-browser\s*\{[^}]*position\s*:\s*(?:absolute|fixed)/.test(browser), false);
});
test("task history preserves real labels, deduplicates live tasks and never fabricates approval authority", () => {
  const live = { workspaceId:"A", resourceGeneration:"g-A", selectedAgentId:"main", approvals:[], conversation:{ taskId:"live", objective:"Current task", taskState:"completed", state:"completed" } };
  const result = buildWorkspaceShell([live], Date.now(), [
    {taskId:"live",objective:"Stale duplicate",status:"blocked",colleague:"Wrong historical name"},
    {taskId:"old",objective:"Archived work",status:"completed",colleague:"Original colleague"},
    {taskId:"past-blocked",objective:"Retained record",status:"blocked",colleague:"Same display name"},
  ]);
  assert.equal(result.tasks.length,3); assert.equal(result.tasks[0].title,"Current task");
  assert.equal(result.tasks[1].colleagueLabel,"Original colleague"); assert.equal(result.tasks[1].agentId,undefined);
  assert.equal(result.tasks[2].agentId,undefined); assert.equal(result.waiting.length,0); assert.equal(result.navBadge,0);
});
