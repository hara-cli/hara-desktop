// Regenerates test/fixtures/settings-rpc-baseline.json from a source tree (normally an export of the baseline commit):
//   git archive fa844bf src | tar -x -C <dir>; ln -s "$PWD/node_modules" <dir>/node_modules
//   node test/support/record-settings-rpc.mjs <dir> > test/fixtures/settings-rpc-baseline.json
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { BASELINE, recordSettingsRpc, settingsModelCalls } from "./settings-rpc-scenarios.mjs";
const tree = process.argv[2];
const { WorkspaceDevModel } = await import(`${tree}/src/workspace-dev-state.ts`);
const read = file => existsSync(`${tree}/src/${file}`) ? readFileSync(`${tree}/src/${file}`, "utf8") : null;
console.log(JSON.stringify({ baseline: BASELINE, generatedBy: "node test/support/record-settings-rpc.mjs <export of the baseline commit>",
  note: "outcome «error» means the synthetic reply did not pass the model's reply check after the call was sent; the recorded call is what matters.",
  modelCalls: settingsModelCalls(ts, read), rpc: await recordSettingsRpc(WorkspaceDevModel) }, null, 1));
