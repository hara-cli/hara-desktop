import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseProjectPaths,
  projectGroups,
  projectListStateFromStorage,
  setProjectVisible,
} from "../src/project-list.ts";

const session = (id, cwd, updatedAt = "2026-08-21T00:00:00.000Z", source = "desktop") => ({
  id,
  cwd,
  updatedAt,
  source,
});

test("stored project paths tolerate corruption and discard invalid duplicates", () => {
  assert.deepEqual(parseProjectPaths("not-json"), []);
  assert.deepEqual(parseProjectPaths(JSON.stringify(["/work/a", 7, "", "/work/a", "/work/b"])), [
    "/work/a",
    "/work/b",
  ]);
  assert.deepEqual(projectListStateFromStorage('["/work/a"]', '["/work/b"]'), {
    opened: ["/work/a"],
    hidden: ["/work/b"],
  });
});

test("a populated project can leave the list without deleting sessions and reopening restores it", () => {
  const sessions = [session("s1", "/work/hara"), session("s2", "/work/hara")];
  const initial = { opened: ["/work/hara"], hidden: [] };
  const hidden = setProjectVisible(initial, "/work/hara", false);

  assert.deepEqual(hidden, { opened: [], hidden: ["/work/hara"] });
  assert.deepEqual(projectGroups(sessions, hidden), []);
  assert.equal(sessions.length, 2, "navigation removal never mutates or deletes sessions");

  const restored = setProjectVisible(hidden, "/work/hara", true);
  assert.deepEqual(restored, { opened: ["/work/hara"], hidden: [] });
  assert.deepEqual(projectGroups(sessions, restored), [["/work/hara", sessions]]);
});

test("project grouping excludes assistant, automation, gateway, temporary, and hidden work", () => {
  const visible = session("visible", "/work/visible", "2026-08-21T02:00:00.000Z");
  assert.deepEqual(projectGroups([
    session("assistant", "/Users/alice/.hara/workspace"),
    session("cron", "/work/cron", undefined, "cron"),
    session("gateway", "/work/gateway", undefined, "gateway"),
    session("temporary", "/private/tmp/hara-test-fixture"),
    session("hidden", "/work/hidden"),
    visible,
  ], {
    opened: ["/work/empty", "/work/hidden"],
    hidden: ["/work/hidden"],
  }), [
    ["/work/empty", []],
    ["/work/visible", [visible]],
  ]);
});

test("every project header exposes an accessible, explicitly non-destructive removal action", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");
  const projectHeader = app.slice(
    app.indexOf("visibleProjectGroups.length ? visibleProjectGroups.map"),
    app.indexOf("{zone === \"office\""),
  );

  assert.match(projectHeader, /<button[\s\S]*className="project-remove inbox-project-remove"[\s\S]*aria-label=/);
  assert.match(projectHeader, /onClick=\{\(\) => removeProjectFromList\(cwd\)\}/);
  assert.doesNotMatch(
    projectHeader,
    /className="inbox-contact is-project"[\s\S]*className="project-remove inbox-project-remove"[\s\S]*<\/button>\s*<\/button>/,
    "the removal action stays a sibling rather than nesting one button inside another",
  );
  assert.match(app, /removeProjectKeepsData[\s\S]*removeProjectRestore/);
  assert.match(i18n, /不会删除磁盘上的任何内容/);
  assert.match(i18n, /Open this folder again to restore it to the list/);
  assert.match(css, /\.project-remove:focus-visible[\s\S]*outline:/);
});
