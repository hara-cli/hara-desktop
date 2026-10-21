import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {privateEnvironment,nativeTarget} from '../scripts/candidate-common.mjs';
import {hydrateCore} from '../scripts/candidate-native.mjs';
function npm(args,cwd,env){return spawnSync('bash',['-c','exec npm "$@"','synthetic-npm',...args],{cwd,env,encoding:'utf8',timeout:60000});}
function packageTar(root,name,script,env){
  const dir=path.join(root,name.replaceAll('/','-').replaceAll('@',''));fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.1.0',...(script?{scripts:{install:'node install.cjs'}}:{})}));
  if(script)fs.writeFileSync(path.join(dir,'install.cjs'),script);
  const packed=npm(['pack','--json','--ignore-scripts','--offline','--pack-destination',root],dir,env);
  assert.equal(packed.status,0,packed.stderr);return 'file:'+path.join(root,JSON.parse(packed.stdout)[0].filename).replaceAll('\\','/');
}
async function fixture(t,requiredFailure){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'core-optional-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const env=privateEnvironment(path.join(root,'home'),{HARA_NPM_CI_ATTEMPTS:'1'});t.after(()=>fs.rmSync(env.TMPDIR,{recursive:true,force:true}));
  Object.assign(env,{npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false'});
  const pi=packageTar(root,'@earendil-works/pi-coding-agent',null,env);
  const optional=packageTar(root,'synthetic-unsupported-native','process.exit(1)',env);
  const required=packageTar(root,'synthetic-required',requiredFailure?'process.exit(2)':'require("fs").writeFileSync("installed.txt","required script ran")',env);
  const core=path.join(root,'core');fs.mkdirSync(core);
  fs.writeFileSync(path.join(core,'package.json'),JSON.stringify({name:'synthetic-core',version:'1.0.0',dependencies:{'@earendil-works/pi-coding-agent':pi,'synthetic-required':required},optionalDependencies:{'synthetic-unsupported-native':optional}}));
  const lock=npm(['install','--package-lock-only','--ignore-scripts','--offline'],core,env);assert.equal(lock.status,0,lock.stderr);
  // The production Pi preflight requires the exact Pi root version; the local tarball remains frozen in resolved/integrity.
  const lockFile=path.join(core,'package-lock.json'),value=JSON.parse(fs.readFileSync(lockFile));
  value.packages[''].dependencies['@earendil-works/pi-coding-agent']='1.1.0';fs.writeFileSync(lockFile,JSON.stringify(value));
  const manifest=JSON.parse(fs.readFileSync(path.join(core,'package.json')));manifest.dependencies['@earendil-works/pi-coding-agent']='1.1.0';fs.writeFileSync(path.join(core,'package.json'),JSON.stringify(manifest));
  return {core,env};
}
test('locked hydration honors optional native failure but runs required install scripts offline',async t=>{
  const c=await fixture(t,false);
  assert.equal(npm(['ci','--ignore-scripts','--offline'],c.core,c.env).status,0);
  assert.notEqual(npm(['rebuild','--no-audit','--fund=false'],c.core,c.env).status,0,'old blanket rebuild rejects a failing optional lifecycle');
  await hydrateCore({...c,target:nativeTarget()});
  assert(!fs.existsSync(path.join(c.core,'node_modules/synthetic-unsupported-native')));
  assert.equal(fs.readFileSync(path.join(c.core,'node_modules/synthetic-required/installed.txt'),'utf8'),'required script ran');
});
test('required lifecycle failure still rejects locked hydration without a platform-wide waiver',async t=>{
  const c=await fixture(t,true);await assert.rejects(()=>hydrateCore({...c,target:nativeTarget()}),/candidate phase failed/);
});
