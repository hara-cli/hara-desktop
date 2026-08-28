import assert from "node:assert/strict";
import test from "node:test";

import { knownManualActionHintKeys } from "../src/task-manual-action.ts";

test("known external-action failures map to focused, deduplicated recovery hints", () => {
  assert.deepEqual(
    knownManualActionHintKeys([
      "launchctl load failed: 5: Input/output error; exit code=0",
      "Operation not permitted",
      "Permission denied",
    ]),
    [
      "taskKnownHintLaunchLoad",
      "taskKnownHintLaunchVerify",
      "taskKnownHintOperationNotPermitted",
      "taskKnownHintPermissionDenied",
    ],
  );
  assert.deepEqual(knownManualActionHintKeys(["ordinary external approval is pending"]), []);
});
