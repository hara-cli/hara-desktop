import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HIDDEN_PROJECTS_STORAGE_KEY,
  OPENED_PROJECTS_STORAGE_KEY,
  parseProjectPaths,
  projectGroups,
  projectListStateForSpace,
  projectListStateFromStorage,
  projectListStorageKey,
  persistProjectListState,
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

test("project navigation is isolated per Space and legacy global paths migrate only to Personal", () => {
  const values = new Map([
    [OPENED_PROJECTS_STORAGE_KEY, '["/legacy/personal"]'],
    [HIDDEN_PROJECTS_STORAGE_KEY, '["/legacy/hidden"]'],
    [projectListStorageKey(OPENED_PROJECTS_STORAGE_KEY, "org:tenant-a"), '["/company/a"]'],
    [projectListStorageKey(HIDDEN_PROJECTS_STORAGE_KEY, "org:tenant-a"), '["/company/hidden"]'],
  ]);
  const read = (key) => values.get(key) ?? null;
  assert.deepEqual(projectListStateForSpace("personal", read), {
    spaceId: "personal",
    opened: ["/legacy/personal"],
    hidden: ["/legacy/hidden"],
  });
  assert.deepEqual(projectListStateForSpace("org:tenant-a", read), {
    spaceId: "org:tenant-a",
    opened: ["/company/a"],
    hidden: ["/company/hidden"],
  });
  assert.deepEqual(projectListStateForSpace("org:tenant-b", read), {
    spaceId: "org:tenant-b",
    opened: [],
    hidden: [],
  }, "a new company never inherits Personal or another company's paths");

  const writes = new Map();
  persistProjectListState({ spaceId: "org:tenant-b", opened: ["/company/b"], hidden: [] }, "org:tenant-b", (key, value) => writes.set(key, value));
  assert.equal(writes.get(projectListStorageKey(OPENED_PROJECTS_STORAGE_KEY, "org:tenant-b")), '["/company/b"]');
  assert.equal(writes.has(OPENED_PROJECTS_STORAGE_KEY), false);
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
