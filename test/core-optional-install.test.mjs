import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {nativeTarget} from '../scripts/candidate-common.mjs';
import {hydrateCore} from '../scripts/candidate-native.mjs';
import {gateEvidence} from '../scripts/candidate-upgrade.mjs';
function npm(args,cwd,env,scope){
  scope.checked(cwd,{directory:true});
  return scope.guardSync(env,()=>spawnSync('bash',['-c','exec npm "$@"','synthetic-npm',...args],{cwd,env,encoding:'utf8',timeout:60000}));
}
function packageTar(root,name,script,env,scope){
  const dir=scope.mkdir(path.join(root,name.replaceAll('/','-').replaceAll('@','')));
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.1.0',...(script?{scripts:{install:'node install.cjs'}}:{})}));
  if(script)fs.writeFileSync(path.join(dir,'install.cjs'),script);
  const packed=npm(['pack','--json','--ignore-scripts','--offline','--pack-destination',root],dir,env,scope);
  assert.equal(packed.status,0,packed.stderr);return 'file:'+path.join(root,JSON.parse(packed.stdout)[0].filename).replaceAll('\\','/');
}
async function fixture(t,requiredFailure){
  const scope=gateEvidence(process.env.CANDIDATE_EVIDENCE_ROOT??process.env.HARA_WRAPPER_EVIDENCE_ROOT),root=scope.fixture('core-optional');
  const env=scope.environment({HARA_NPM_CI_ATTEMPTS:'1',npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false'});
  const pi=packageTar(root,'@earendil-works/pi-coding-agent',null,env,scope);
  const optional=packageTar(root,'synthetic-unsupported-native','process.exit(1)',env,scope);
  const required=packageTar(root,'synthetic-required',requiredFailure?'process.exit(2)':'require("fs").writeFileSync("installed.txt","required script ran")',env,scope);
  const core=scope.mkdir(path.join(root,'core'));
  fs.writeFileSync(path.join(core,'package.json'),JSON.stringify({name:'synthetic-core',version:'1.0.0',dependencies:{'@earendil-works/pi-coding-agent':pi,'synthetic-required':required},optionalDependencies:{'synthetic-unsupported-native':optional}}));
  const lock=npm(['install','--package-lock-only','--ignore-scripts','--offline'],core,env,scope);assert.equal(lock.status,0,lock.stderr);
  // The production Pi preflight requires the exact Pi root version; the local tarball remains frozen in resolved/integrity.
  const lockFile=path.join(core,'package-lock.json'),value=JSON.parse(fs.readFileSync(lockFile));
  value.packages[''].dependencies['@earendil-works/pi-coding-agent']='1.1.0';fs.writeFileSync(lockFile,JSON.stringify(value));
  const manifest=JSON.parse(fs.readFileSync(path.join(core,'package.json')));manifest.dependencies['@earendil-works/pi-coding-agent']='1.1.0';fs.writeFileSync(path.join(core,'package.json'),JSON.stringify(manifest));
  return {core,scope,target:nativeTarget(),get env(){scope.assertEnvironment(env);return env;}};
}
test('locked hydration honors optional native failure but runs required install scripts offline',async t=>{
  const c=await fixture(t,false);
  assert.equal(npm(['ci','--ignore-scripts','--offline'],c.core,c.env,c.scope).status,0);
  assert.notEqual(npm(['rebuild','--no-audit','--fund=false'],c.core,c.env,c.scope).status,0,'old blanket rebuild rejects a failing optional lifecycle');
  await c.scope.guard(c.env,()=>hydrateCore(c));
  assert(!fs.existsSync(path.join(c.core,'node_modules/synthetic-unsupported-native')));
  assert.equal(fs.readFileSync(path.join(c.core,'node_modules/synthetic-required/installed.txt'),'utf8'),'required script ran');
});
test('required lifecycle failure still rejects locked hydration without a platform-wide waiver',async t=>{
  const c=await fixture(t,true);await assert.rejects(()=>c.scope.guard(c.env,()=>hydrateCore(c)),/candidate phase failed/);
});
