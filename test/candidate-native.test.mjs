import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT, INPUT, TARGETS, identity, assertEvent, nativeTarget, privateEnvironment, receipt, assertReceipt, artifactName, checkArchiveEntries, assertNoRosettaProbe } from '../scripts/candidate-common.mjs';
import { assertSigner } from '../scripts/candidate-signing.mjs';
import { testCounts, packageKinds, bunTarget } from '../scripts/candidate-native.mjs';
import { updaterTarget, updaterPayload } from '../scripts/candidate-upgrade.mjs';
import { validateTar, validateExtractedTree } from '../scripts/candidate-archive.mjs';
import { lockedSidecarSpecs } from '../scripts/hydrate-locked-sidecar-dependencies.mjs';

const event = () => ({ GITHUB_ACTIONS:'true', GITHUB_REPOSITORY:'hara-cli/hara-desktop', GITHUB_EVENT_NAME:'push',
  GITHUB_REF: INPUT.controlledRef, GITHUB_REF_PROTECTED:'true', GITHUB_ACTOR_ID:String(INPUT.approverId),
  GITHUB_SHA:'f'.repeat(40), GITHUB_WORKFLOW_SHA:'f'.repeat(40), GITHUB_WORKFLOW_REF:`hara-cli/hara-desktop/.github/workflows/candidate.yml@${INPUT.controlledRef}`,
  GITHUB_RUN_ID:'123', GITHUB_RUN_ATTEMPT:'1' });
test('exact controlled push separates application and orchestration identities', () => { assertEvent(event()); assert.notEqual(event().GITHUB_SHA, INPUT.desktop.commit); assert.match(identity,/^[a-f0-9]{64}$/); });
for (const [key, values] of Object.entries({ GITHUB_ACTIONS:['false'], GITHUB_REPOSITORY:['fork/hara-desktop'], GITHUB_EVENT_NAME:['pull_request','workflow_dispatch'],
  GITHUB_REF:['refs/heads/main','refs/tags/v1.1.0','refs/heads/candidate/1.1.0-7217ef7'], GITHUB_REF_PROTECTED:['false'],
  GITHUB_ACTOR_ID:['123'], GITHUB_SHA:['HEAD'], GITHUB_WORKFLOW_SHA:['e'.repeat(40)], GITHUB_WORKFLOW_REF:['fork/hara-desktop/candidate.yml@main'], GITHUB_RUN_ID:['x'], GITHUB_RUN_ATTEMPT:[''] })) {
  for (const value of values) test(`candidate rejects unapproved ${key}=${value}`, () => assert.throws(() => assertEvent({...event(),[key]:value})));
}
test('only the migrated organization signer is admitted', () => {
  const configuredName='synthetic-candidate-signer', e={RUNNER_NAME:configuredName}, s={agentId:INPUT.runnerId,gitHubUrl:'https://github.com/hara-cli',poolId:INPUT.runnerGroupId,poolName:INPUT.runnerGroup,agentName:e.RUNNER_NAME};
  assertSigner(e,s,configuredName);
  assert.throws(()=>assertSigner(e,s)); assert.throws(()=>assertSigner(e,s,'different-signer'));
  for(const [key,value] of Object.entries({agentId:21,gitHubUrl:'https://github.com/hara-cli/hara-desktop',poolId:1,poolName:'Default',agentName:'unknown'})) assert.throws(()=>assertSigner(e,{...s,[key]:value},configuredName));
});
test('all four target/package/update contracts are native and deterministic', () => {
  assert.equal(nativeTarget('darwin','x64'),TARGETS[1]); assert.equal(nativeTarget('darwin','arm64'),TARGETS[0]);
  assert.equal(nativeTarget('linux','x64'),TARGETS[2]); assert.equal(nativeTarget('win32','x64'),TARGETS[3]);
  assert.throws(()=>nativeTarget('linux','arm64')); assert.throws(()=>nativeTarget('darwin','ia32'));
  assert.equal(packageKinds(TARGETS[1]),'app,dmg'); assert.equal(packageKinds(TARGETS[2]),'deb,rpm'); assert.equal(packageKinds(TARGETS[3]),'msi,nsis');
  assert.equal(bunTarget(TARGETS[1]),'bun-darwin-x64-baseline');
  assert.equal(updaterTarget(TARGETS[1]),'darwin-x86_64'); assert.equal(updaterPayload(TARGETS[0]),'Hara_aarch64.app.tar.gz');
  for(const t of TARGETS) { assert(updaterTarget(t)); assert(updaterPayload(t)); }
});
test('real Intel missing-translation OID is native, translation or unknown probe errors fail closed', () => {
  assertNoRosettaProbe({status:0,stdout:'0\n'}); assertNoRosettaProbe({status:1,stderr:"sysctl: unknown oid 'sysctl.proc_translated'\n"});
  assert.throws(()=>assertNoRosettaProbe({status:0,stdout:'1\n'})); assert.throws(()=>assertNoRosettaProbe({status:1,stderr:'operation not permitted'}));
  assert.throws(()=>assertNoRosettaProbe({status:null,stderr:''}));
});
test('private test environment strips credentials and isolates all HOME variants', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-env-')); t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const old=process.env.HARA_TEST_API_KEY; process.env.HARA_TEST_API_KEY='fake-not-a-secret';
  try { const e=privateEnvironment(home); assert.equal(e.HOME,home); assert.equal(e.USERPROFILE,home); assert.equal(e.CFFIXED_USER_HOME,home); assert.equal(e.HARA_TEST_API_KEY,undefined); assert.equal(e.HARA_HOME,path.join(home,'.hara')); assert.equal(e.HARA_UPDATE_CHECK,undefined); assert(e.TMPDIR.length < (process.platform === 'win32' ? 1024 : 32)); fs.rmSync(e.TMPDIR,{recursive:true,force:true}); }
  finally { if(old===undefined)delete process.env.HARA_TEST_API_KEY;else process.env.HARA_TEST_API_KEY=old; }
});
test('receipt rejects stale source, policy, run and attempt without trusting self-reported success', () => {
  const r=receipt(); assertReceipt(r);
  for(const key of ['identity','application','core','orchestration','runId','attempt','schema']) assert.throws(()=>assertReceipt({...r,[key]:'wrong'}));
  assert.match(artifactName('final',TARGETS[1]),/^candidate-final-x86_64-apple-darwin-/); assert.throws(()=>artifactName('../final',TARGETS[1]));
});
test('TAP accounting rejects failure, cancellation, missing or contradictory totals', () => {
  const text='# tests 4\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 1\n'; assert.equal(testCounts(text).tests,4);
  for(const bad of ['',text.replace('fail 0','fail 1'),text.replace('cancelled 0','cancelled 1'),text.replace('tests 4','tests 5')]) assert.throws(()=>testCounts(bad));
});
test('Pi-only formal hydration supports all native platforms without reintroducing SDK', () => {
  const p='@earendil-works/pi-coding-agent', lock={lockfileVersion:3,packages:{'':{dependencies:{[p]:'1.2.3'}},['node_modules/'+p]:{version:'1.2.3',integrity:'sha512-YWJjZA=='}}};
  for(const target of TARGETS) assert.deepEqual(lockedSidecarSpecs(lock,target),[]);
  assert.throws(()=>lockedSidecarSpecs(lock,'unsupported'));
});
function tar(entries) {
  const blocks=[];
  for(const row of entries) {
    const h=Buffer.alloc(512), bytes=Buffer.from(row.body??'');
    h.write(row.name,0,100); h.write('0000644\0',100); h.write('0000000\0',108); h.write('0000000\0',116);
    h.write(bytes.length.toString(8).padStart(11,'0')+'\0',124); h.write('00000000000\0',136); h.fill(32,148,156);
    h.write(row.type??'0',156); if(row.link)h.write(row.link,157,100); h.write('ustar\0',257); h.write('00',263);
    h.write(h.reduce((s,n)=>s+n,0).toString(8).padStart(6,'0')+'\0 ',148); blocks.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
async function fixture(t,entries,fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-tar-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'input.tar.gz'); fs.writeFileSync(file,tar(entries)); return fn(file,dir);
}
test('tar validation accepts ordinary files, directories and contained framework links',t=>fixture(t,[{name:'bundle/',type:'5'},{name:'bundle/App',type:'5'},{name:'bundle/App/bin',body:'ok'},{name:'bundle/App/current',type:'2',link:'bin'}],async file=>assert.equal((await validateTar(file)).length,4)));
for(const [name,rows] of Object.entries({ traversal:[{name:'bundle/../../outside'}], absolute:[{name:'/tmp/outside'}], wrongRoot:[{name:'other/file'}], windowsAds:[{name:'bundle/file:stream'}],
  hardlink:[{name:'bundle/file',type:'1',link:'other'}], device:[{name:'bundle/device',type:'3'}], escapeLink:[{name:'bundle/App/link',type:'2',link:'../../../outside'}],
  parentLink:[{name:'bundle/A',type:'2',link:'B'},{name:'bundle/A/file',body:'bad'}], duplicate:[{name:'bundle/file'},{name:'bundle/file'}], gnuLongEscape:[{name:'././@LongLink',type:'L',body:'../../outside\0'},{name:'bundle/file'}] })) {
  test(`tar rejects ${name} before extraction`,t=>fixture(t,rows,file=>assert.rejects(()=>validateTar(file))));
}
test('truncated archive fails closed', t=>fixture(t,[{name:'bundle/file',body:'data'}],async(file)=>{const b=fs.readFileSync(file);fs.writeFileSync(file,b.subarray(0,-12));await assert.rejects(()=>validateTar(file));}));
test('post-extraction link validation is scoped to a private root', t=>fixture(t,[{name:'bundle/file'}],async(_file,dir)=>{const root=path.join(dir,'root');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'file'),'ok');validateExtractedTree(root);fs.symlinkSync(os.tmpdir(),path.join(root,'bad'));assert.throws(()=>validateExtractedTree(root));}));
test('outer artifact archive rejects traversal',()=>{for(const text of ['/absolute','a/../b','a\\b',''])assert.throws(()=>checkArchiveEntries(text));});
test('candidate workflow has exact non-main input and no publishing authority', () => {
  const w=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  assert(w.includes(INPUT.controlledRef.replace('refs/heads/',''))); assert(w.includes(INPUT.desktop.commit)); assert(w.includes(INPUT.core.commit));
  assert.equal((w.match(/os: macos-15-intel/g)??[]).length,3); assert(!/contents: write|packages: write|id-token: write|secrets\.|gh release|git push|ossutil|stable\/latest/.test(w));
  assert(w.includes('environment: hara-desktop-candidate')); assert(!w.includes('hara-desktop-production')); assert(w.includes('GIT_CONFIG_KEY_0: core.autocrlf'));
});
