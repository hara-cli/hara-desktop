// Ordinary CI only: reproduce the original full suite in a private, credential-free HOME.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,privateEnvironment,run,assertToolchain} from './candidate-common.mjs';
const output=path.resolve(process.argv[2]??'');
assert(process.argv[2] && path.isAbsolute(process.argv[2]) && !fs.existsSync(output),'fresh absolute CI evidence directory required');
assertToolchain();
fs.mkdirSync(output,{mode:0o700});
const env=privateEnvironment(path.join(output,'private-home'));
try {
  await run('Ordinary CI original full suite','bash',['-c','exec npm test'],{cwd:ROOT,env,capture:true,logFile:path.join(output,'tests.log')});
} finally {
  // Retain evidence; only the short-lived temp created by privateEnvironment belongs to this call.
  fs.rmSync(env.TMPDIR,{recursive:true,force:true});
}
