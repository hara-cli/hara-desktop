// Ordinary hosted CI smoke. No candidate context, production credentials, signing or publication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,readJson,sync,privateEnvironment,run,nativeTarget,assertNoRosettaProbe} from './candidate-common.mjs';
import {spawnSync} from 'node:child_process';
import {hydrateCore} from './candidate-native.mjs';
const core=path.resolve(process.argv[2]??''),base=path.resolve(process.argv[3]??'');
assert(process.argv[2] && process.argv[3] && !fs.existsSync(base),'exact Core checkout and fresh private output required');
const target=nativeTarget();
assert.equal(sync('git',['rev-parse','HEAD'],{cwd:core}),fs.readFileSync(path.join(ROOT,'src-tauri/binaries/SIDECAR_COMMIT'),'utf8').trim());
assert.equal(readJson(path.join(core,'package.json')).version,fs.readFileSync(path.join(ROOT,'src-tauri/binaries/SIDECAR_VERSION'),'utf8').trim());
if(process.platform==='darwin'&&process.arch==='x64')assertNoRosettaProbe(spawnSync('/usr/sbin/sysctl',['-n','sysctl.proc_translated'],{encoding:'utf8'}));
const env=privateEnvironment(path.join(base,'private-home'));
try {
  await hydrateCore({core,target,env});
  await run('Compile exact Core for native optional-dependency smoke','bash',['-c','exec npm run build'],{cwd:core,env});
  await run('Exercise exact Core search without a model or network',process.execPath,[path.join(ROOT,'scripts/core-search-smoke.mjs'),core,path.join(base,'search')],{env,capture:true,logFile:path.join(base,'search.log')});
  assert.equal(sync('git',['status','--porcelain'],{cwd:core}),'');
} finally { fs.rmSync(env.TMPDIR,{recursive:true,force:true}); }
