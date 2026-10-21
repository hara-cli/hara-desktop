import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {run} from '../scripts/candidate-common.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-process-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'process.log');}
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
  await assert.rejects(()=>run('synthetic overwrite',process.execPath,code,{capture:true,logFile}),/EEXIST/);
});
