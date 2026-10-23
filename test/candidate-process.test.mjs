import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {run,candidateEvidence} from '../scripts/candidate-common.mjs';
function fixture(){const scope=candidateEvidence(),dir=scope.fixture('candidate-process');return path.join(dir,'process.log');}
test('captured failing test output and original exit are durable before the gate rejects',async t=>{
  const logFile=fixture(t);
  await assert.rejects(()=>run('synthetic failure',process.execPath,['-e','console.log("not ok 1 - original failing case");process.exitCode=7'],{capture:true,logFile}),/exit=7/);
  assert.match(fs.readFileSync(logFile,'utf8'),/not ok 1 - original failing case/);
  assert.deepEqual(JSON.parse(fs.readFileSync(logFile+'.result.json')),{code:7,signal:null,spawnCode:null,failureKind:null,capturedBytes:Buffer.byteLength('not ok 1 - original failing case\n'),complete:true});
});
test('captured diagnostic output redacts credentials split across child writes',async t=>{
  const logFile=fixture(t),secret='synthetic-credential-123456';
  await assert.rejects(()=>run('synthetic redaction',process.execPath,['-e',`process.stdout.write(${JSON.stringify(secret.slice(0,10))});setTimeout(()=>{console.log(${JSON.stringify(secret.slice(10))});console.log("Bearer abc.def.ghi");process.exitCode=3},5)`],{capture:true,logFile,env:{...process.env,TEST_API_KEY:secret}}));
  const text=fs.readFileSync(logFile,'utf8');assert(!text.includes(secret));assert(!text.includes('abc.def.ghi'));assert.match(text,/REDACTED/);
});
test('spawn errors and bounded output failures remain failures with usable receipts',async t=>{
  const logFile=fixture(t);
  await assert.rejects(()=>run('synthetic missing command',path.join(path.dirname(logFile),'not-a-command'),[],{capture:true,logFile}),/reason=spawn/);
  assert.equal(JSON.parse(fs.readFileSync(logFile+'.result.json')).spawnCode,'ENOENT');
  const limited=logFile+'.large';
  await assert.rejects(()=>run('synthetic output bound',process.execPath,['-e','process.stdout.write(Buffer.alloc(9*1024*1024,65))'],{capture:true,logFile:limited}),/reason=output-limit/);
  const result=JSON.parse(fs.readFileSync(limited+'.result.json'));assert.equal(result.complete,false);assert.equal(result.capturedBytes,8*1024*1024);assert(fs.statSync(limited).size<=8*1024*1024);
});
test('success retains original return data and refuses to overwrite diagnostic evidence',async t=>{
  const logFile=fixture(t),code=['-e','console.log("passed")'];
  assert.equal(await run('synthetic success',process.execPath,code,{capture:true,logFile}),'passed\n');
  const before=fs.readFileSync(logFile),resultBefore=fs.readFileSync(logFile+'.result.json');
  const marker=path.join(path.dirname(logFile),'must-not-run');
  const replay=['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'replayed')`];
  await assert.rejects(()=>run('synthetic overwrite',process.execPath,replay,{capture:true,logFile}),/diagnostic result already exists; refuse replay/);
  assert.deepEqual(fs.readFileSync(logFile),before);
  assert.deepEqual(fs.readFileSync(logFile+'.result.json'),resultBefore);
  assert(!fs.existsSync(marker),'rejected replay must not start its child');
});
