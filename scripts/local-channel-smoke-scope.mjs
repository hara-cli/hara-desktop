import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Explicit pinned Core checkout and an empty, private, task-owned temporary directory. */
export function validateChannelSmokeScope(core, evidence, expectedCore, temporaryRoot = tmpdir()) {
  assert.notEqual(process.platform, "win32", "Channel smoke requires POSIX directory ownership and permissions");
  assert.equal(typeof core, "string"); assert.ok(core); assert.equal(typeof evidence, "string"); assert.ok(evidence);
  assert.match(expectedCore ?? "", /^[a-f0-9]{40}$/);
  for (const path of [core, evidence]) { assert.equal(fs.realpathSync(path), resolve(path)); assert.equal(fs.statSync(path).isDirectory(), true); }
  const nested = (parent, child) => { const path = relative(parent, child); return path !== "" && path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path); };
  assert.equal(nested(fs.realpathSync(temporaryRoot), resolve(evidence)), true, "Evidence must be a dedicated temporary subdirectory");
  assert.equal(resolve(core) === resolve(evidence) || nested(resolve(core), resolve(evidence)) || nested(resolve(evidence), resolve(core)), false, "Core and evidence must be separate");
  const stat = fs.statSync(evidence); assert.equal(stat.mode & 0o777, 0o700);
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  assert.deepEqual(fs.readdirSync(evidence), []);
}
