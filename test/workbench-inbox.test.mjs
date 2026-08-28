import assert from "node:assert/strict";
import test from "node:test";

import {
  agentInboxEntries,
  filterInboxSessions,
  inboxSessionsForAgent,
  sortInboxSessions,
  visibleExternalSessions,
} from "../src/workbench-inbox.ts";

const session = (id, updatedAt, options = {}) => ({
  id,
  title: options.title ?? id,
  cwd: options.cwd ?? "/work/hara",
  model: options.model ?? "deepseek-chat",
  updatedAt,
  source: options.source ?? "interactive",
  ...options,
});

const agent = (ref, name, options = {}) => ({
  ref,
  name,
  description: options.description ?? `${name} role`,
  home: options.home ?? "/work/hara",
  scope: options.scope ?? (ref === "main" ? "main" : "global"),
  ...options,
});

test("Agent inbox is a facet over durable sessions and keeps empty contacts visible", () => {
  const main = agent("main", "Hara");
  const designer = agent("designer", "Mori");
  const researcher = agent("researcher", "Lin");
  const sessions = [
    session("main-old", "2026-08-20T10:00:00.000Z"),
    session("design-new", "2026-08-22T10:00:00.000Z", { agentRef: "designer" }),
    session("automation", "2026-08-23T10:00:00.000Z", { agentRef: "researcher", source: "cron" }),
    session("archived", "2026-08-24T10:00:00.000Z", { agentRef: "researcher", archived: true }),
    session("fixture", "2026-08-25T10:00:00.000Z", { agentRef: "researcher", cwd: "/private/tmp/hara-test-fixture" }),
  ];

  const entries = agentInboxEntries([main, designer, researcher], sessions);
  assert.deepEqual(entries.map((entry) => entry.agent.ref), ["designer", "main", "researcher"]);
  assert.deepEqual(entries.map((entry) => entry.sessions.map((item) => item.id)), [
    ["design-new"],
    ["main-old"],
    [],
  ]);
});

test("missing Agent refs map only to the built-in main Agent", () => {
  const sessions = [
    session("legacy", "2026-08-20T10:00:00.000Z"),
    session("named", "2026-08-21T10:00:00.000Z", { agentRef: "designer" }),
  ];
  assert.deepEqual(inboxSessionsForAgent(sessions, "main").map((item) => item.id), ["legacy"]);
  assert.deepEqual(inboxSessionsForAgent(sessions, "designer").map((item) => item.id), ["named"]);
});

test("search covers contact identity and conversation metadata", () => {
  const agents = [
    agent("designer", "Mori", { description: "Visual systems", project: "brand" }),
    agent("researcher", "Lin", { description: "Evidence analyst" }),
  ];
  const sessions = [
    session("design", "2026-08-20T10:00:00.000Z", {
      agentRef: "designer",
      title: "Launch illustration",
      model: "qwen3.7-plus",
    }),
  ];

  assert.deepEqual(agentInboxEntries(agents, sessions, "brand").map((entry) => entry.agent.ref), ["designer"]);
  assert.deepEqual(agentInboxEntries(agents, sessions, "qwen3.7").map((entry) => entry.agent.ref), ["designer"]);
  assert.deepEqual(filterInboxSessions(sessions, "illustration").map((item) => item.id), ["design"]);
});

test("pinned conversations lead while the rest remain latest-first", () => {
  const sessions = [
    session("old-pinned", "2026-08-20T10:00:00.000Z"),
    session("new", "2026-08-22T10:00:00.000Z"),
    session("middle", "2026-08-21T10:00:00.000Z"),
  ];
  assert.deepEqual(sortInboxSessions(sessions, ["old-pinned"]).map((item) => item.id), [
    "old-pinned",
    "new",
    "middle",
  ]);
});

test("external coding sessions remain a distinct, searchable, latest-first inbox facet", () => {
  const sessions = [
    {
      id: "ext_codex_old",
      sourceId: "codex",
      title: "Architecture audit",
      workspaceName: "hara",
      workspaceId: "ws_hara",
      state: "idle",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
      origin: "cli",
      ephemeral: false,
    },
    {
      id: "ext_codex_new",
      sourceId: "codex",
      title: "Release verification",
      workspaceName: "control",
      workspaceId: "ws_control",
      state: "waiting",
      createdAt: "2026-08-22T10:00:00.000Z",
      updatedAt: "2026-08-23T10:00:00.000Z",
      origin: "vscode",
      ephemeral: false,
    },
  ];
  assert.deepEqual(visibleExternalSessions(sessions).map((item) => item.id), ["ext_codex_new", "ext_codex_old"]);
  assert.deepEqual(visibleExternalSessions(sessions, "hara").map((item) => item.id), ["ext_codex_old"]);
  assert.deepEqual(visibleExternalSessions(sessions, "waiting").map((item) => item.id), ["ext_codex_new"]);
});
