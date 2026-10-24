import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { ROOT, INPUT, TARGETS, identity, assertEvent, nativeTarget, receipt, assertReceipt, artifactName, checkArchiveEntries, assertNoRosettaProbe } from '../scripts/candidate-common.mjs';
import { assertSigner } from '../scripts/candidate-signing.mjs';
import { testCounts, coreTestCommand, coreTestCoverage, assertStrictNativeCore, packageKinds, bunTarget } from '../scripts/candidate-native.mjs';
import { updaterTarget, updaterPayload, gateEvidence, upgradeSmoke } from '../scripts/candidate-upgrade.mjs';
import { validateTar, validateExtractedTree } from '../scripts/candidate-archive.mjs';
import { lockedSidecarSpecs } from '../scripts/hydrate-locked-sidecar-dependencies.mjs';

const evidence = () => gateEvidence(process.env.CANDIDATE_EVIDENCE_ROOT ?? process.env.HARA_WRAPPER_EVIDENCE_ROOT);
function virtualEvidence({ paths = path.posix, root = '/evidence/run', accountHome = '/account' } = {}) {
  const home = paths.join(root, 'synthetic-home'), tmp = paths.join(root, 'tmp');
  let inode = 100n, calls = 0;
  const rows = new Map(), writes = [];
  const directory = value => rows.set(value, { dev: 1n, ino: inode++, uid: 7n, mode: 0o700n, nlink: 1n,
    isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });
  for (const value of [root, home, tmp]) directory(value);
  const env = { CANDIDATE_EVIDENCE_ROOT: root, HOME: home, USERPROFILE: home, CFFIXED_USER_HOME: home,
    HARA_HOME: paths.join(home, '.hara'), TMPDIR: tmp, TMP: tmp, TEMP: tmp };
  const io = {
    lstatSync(value) { calls++; if (!rows.has(value)) throw Object.assign(Error('missing fixture'), { code: 'ENOENT' }); return rows.get(value); },
    realpathSync(value) { calls++; return rows.get(value)?.alias ?? value; },
    mkdirSync(value) { writes.push(value); assert(!rows.has(value)); directory(value); },
    mkdtempSync(prefix) { const value = prefix + String(inode); writes.push(value); directory(value); return value; }
  };
  return { root, home, tmp, env, io, rows, writes, paths, accountHome, calls: () => calls,
    scope: (options = {}) => gateEvidence(root, { env, io, paths, accountHome, ownerUid: 7, ...options }) };
}

test('evidence binding rejects missing, conflicting and poisoned environment before any filesystem access', () => {
  const v = virtualEvidence();
  for (const env of [{}, { ...v.env, CANDIDATE_EVIDENCE_ROOT: '/other' },
    { ...v.env, HARA_WRAPPER_EVIDENCE_ROOT: '/other' }, { ...v.env, TMPDIR: '/forbidden' }, { ...v.env, HOME: '/account' }])
    assert.throws(() => v.scope({ env }), /binding|environment mismatch/);
  assert.equal(v.calls(), 0); assert.deepEqual(v.writes, []);
});
test('forbidden temp, cache and real-user data roots are lexical negatives, never real probes', () => {
  for (const root of ['/tmp', '/tmp/case', '/private/tmp/case', '/var/folders/case', '/private/var/folders/case',
    '/account/Library/Caches/case', '/account/.hara/case', '/evidence/run/../other', 'relative']) {
    const v = virtualEvidence({ root }); assert.throws(() => v.scope(), /forbidden|canonical/);
    assert.equal(v.calls(), 0); assert.deepEqual(v.writes, []);
  }
});
test('realpath aliases, symlink anchors, foreign owners and writable evidence roots fail closed', () => {
  for (const mutate of [v => v.rows.get(v.root).alias = '/outside', v => v.rows.get(v.home).isSymbolicLink = () => true,
    v => v.rows.get(v.root).uid = 8n, v => v.rows.get(v.tmp).mode = 0o777n]) {
    const v = virtualEvidence(); mutate(v); assert.throws(() => v.scope()); assert.deepEqual(v.writes, []);
  }
});
test('evidence whitelist checks parents before creation and never accepts prefix lookalikes or links', () => {
  const v = virtualEvidence(), scope = v.scope();
  for (const target of ['/evidence/run/tmp-other/new', '/evidence/run/other/new', '/evidence/run/tmp/../new', '/outside/new'])
    assert.throws(() => scope.mkdir(target));
  assert.deepEqual(v.writes, []);
  const link = path.posix.join(v.tmp, 'link');
  v.rows.set(link, { ...v.rows.get(v.tmp), isSymbolicLink: () => true });
  assert.throws(() => scope.checked(path.posix.join(link, 'new'), { missing: true }), /symlink/);
  assert.deepEqual(v.writes, []);
});
test('environment authority wins over extras, strips credentials and keeps only required HARA controls', () => {
  const v = virtualEvidence(), scope = v.scope(), env = scope.environment({ HOME: '/poison', TMPDIR: '/poison',
    RUSTUP_HOME: '/poison', CARGO_HOME: '/poison', rustup_home: '/poison', cargo_home: '/poison',
    npm_config_cache: '/poison', NPM_CONFIG_CACHE: '/poison', HARA_TEST_API_KEY: 'synthetic-only',
    NODE_OPTIONS: '--require=/poison', HARA_UPDATE_CHECK: '1', HARA_NPM_CI_ATTEMPTS: '1', PROBE: 'kept' });
  scope.assertEnvironment(env); assert.equal(env.HOME, v.home); assert.equal(env.TMPDIR, v.tmp);
  assert.equal(env.NPM_CONFIG_CACHE, undefined); assert.equal(env.HARA_TEST_API_KEY, undefined);
  assert.equal(env.RUSTUP_HOME, path.posix.join(v.accountHome, '.rustup')); assert.equal(env.CARGO_HOME, path.posix.join(v.accountHome, '.cargo'));
  assert.equal(env.rustup_home, undefined); assert.equal(env.cargo_home, undefined);
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.HARA_UPDATE_CHECK, undefined);
  assert.equal(env.HARA_NPM_CI_ATTEMPTS, '1'); assert.equal(env.PROBE, 'kept'); assert(Object.isFrozen(env));
  assert.deepEqual(Object.keys(env).slice(-2), ['HOME', 'TMPDIR']);
});
test('Windows evidence paths keep drive identity and reject cross-drive and real-home escapes', () => {
  const v = virtualEvidence({ paths: path.win32, root: 'D:\\evidence\\run', accountHome: 'C:\\Users\\fixture' });
  const scope = v.scope(), env = scope.environment(); scope.assertEnvironment(env);
  assert.equal(env.TMPDIR, 'D:\\evidence\\run\\tmp');
  for (const target of ['C:\\evidence\\run\\tmp\\new', 'D:\\evidence\\run\\tmp-other\\new', 'C:\\Users\\fixture\\.hara\\new'])
    assert.throws(() => scope.checked(target, { missing: true }));
  assert.deepEqual(v.writes, []);
});
test('a changed 64-bit directory identity is detected even beyond Number precision', () => {
  const v = virtualEvidence(); v.rows.get(v.tmp).ino = 9007199254740992n;
  const scope = v.scope(), env = scope.environment();
  v.rows.get(v.tmp).ino += 1n;
  assert.throws(() => scope.guardSync(env, () => assert.fail('must not spawn')), /identity changed/);
});
test('late parent environment contamination fails before fixture creation', () => {
  const v = virtualEvidence(), scope = v.scope(), before = v.calls();
  v.env.TMPDIR = '/forbidden';
  assert.throws(() => scope.fixture('refused'), /environment mismatch/);
  assert.equal(v.calls(), before); assert.deepEqual(v.writes, []);
});
test('keep-only evidence survives success, failure and cancellation; final checks cannot report success', async () => {
  const v = virtualEvidence(), scope = v.scope(), env = scope.environment(), kept = scope.fixture('kept');
  assert.equal(scope.cleanup, 'keep'); assert.equal(scope.deletionEnabled, false);
  assert.equal(await scope.guard(env, async () => 'ok'), 'ok');
  await assert.rejects(() => scope.guard(env, async () => { throw Error('synthetic failure'); }), /synthetic failure/);
  await assert.rejects(() => scope.guard(env, async () => { throw Object.assign(Error('cancelled'), { name: 'AbortError' }); }), /cancelled/);
  const mutable = { ...env };
  await assert.rejects(() => scope.guard(mutable, async () => { mutable.TMPDIR = '/forbidden'; return 0; }), /environment mismatch/);
  const changed = virtualEvidence(), other = changed.scope(), otherEnv = other.environment();
  await assert.rejects(() => other.guard(otherEnv, async () => { changed.rows.get(changed.tmp).ino += 1n; return 0; }), /identity changed/);
  assert(v.rows.has(kept)); assert(!Object.keys(v.io).some(name => /^(?:rm|unlink|rmdir)/.test(name)));
  for (const cleanup of ['apply', 'dry-run', 'delete']) assert.throws(() => v.scope({ cleanup }), /retained/);
});
test('upgrade refuses the old context environment before output creation or any child command', async () => {
  await assert.rejects(() => upgradeSmoke({ base: 'unreachable', env: {} }, 'unreachable'), /evidence path/);
});

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
test('private test environment strips credentials and isolates all HOME variants', () => {
  const scope = evidence(), root = scope.fixture('candidate-env');
  const env = scope.environment({ HARA_TEST_API_KEY: 'fake-not-a-secret', HARA_UPDATE_CHECK: '1' });
  assert.equal(env.HOME, scope.home); assert.equal(env.USERPROFILE, scope.home); assert.equal(env.CFFIXED_USER_HOME, scope.home);
  assert.equal(env.HARA_TEST_API_KEY, undefined); assert.equal(env.HARA_HOME, path.join(scope.home, '.hara'));
  assert.equal(env.HARA_UPDATE_CHECK, undefined); assert.equal(env.TMPDIR, scope.tmp);
  const marker = scope.checked(path.join(root, 'retained.txt'), { missing: true });
  fs.writeFileSync(marker, 'keep', { flag: 'wx', mode: 0o600 });
  const child = scope.guardSync(env, () => spawnSync(process.execPath, ['--input-type=module', '-e',
    'import os from "node:os"; console.log(JSON.stringify({home:process.env.HOME,tmp:process.env.TMPDIR,osTmp:os.tmpdir(),credential:process.env.HARA_TEST_API_KEY??null}));'],
  { cwd: root, env, encoding: 'utf8' }));
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { home: scope.home, tmp: scope.tmp, osTmp: scope.tmp, credential: null });
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');
});
test('a real child finalization failure remains nonzero and retains its private evidence', () => {
  const scope = evidence(), root = scope.fixture('candidate-final-check'), marker = path.join(root, 'retained.txt');
  const env = scope.environment({ PROBE_FILE: marker });
  const module = new URL('../scripts/candidate-upgrade.mjs', import.meta.url).href;
  const child = scope.guardSync(env, () => spawnSync(process.execPath, ['--input-type=module', '-e',
    'import fs from "node:fs"; const {gateEvidence}=await import(process.argv[1]); const s=gateEvidence(process.env.CANDIDATE_EVIDENCE_ROOT); const e={...s.environment()}; await s.guard(e,async()=>{fs.writeFileSync(process.env.PROBE_FILE,"retained",{flag:"wx",mode:0o600});e.TMPDIR="/forbidden";return 0;}); console.log("UNEXPECTED_SUCCESS");', module],
  { cwd: root, env, encoding: 'utf8' }));
  assert.equal(child.status, 1); assert.match(child.stderr, /environment mismatch/);
  assert(!child.stdout.includes('UNEXPECTED_SUCCESS')); assert.equal(fs.readFileSync(marker, 'utf8'), 'retained');
});
test('upgrade rejects output outside the whitelist before creating its upgrade directory', async () => {
  const scope = evidence(), base = scope.fixture('candidate-upgrade-refusal'), env = scope.environment();
  await assert.rejects(() => upgradeSmoke({ base, env }, path.join(scope.root, 'not-allowed')), /outside evidence whitelist/);
  assert.equal(fs.existsSync(path.join(base, 'private-upgrades')), false); scope.assertEnvironment(env);
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
test('complete native batches are aggregated and an earlier success cannot hide any later failure', () => {
  const a='# tests 4\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 1\n';
  const b='# tests 7\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 0\n';
  assert.deepEqual(testCounts(a+b),{tests:11,pass:10,fail:0,cancelled:0,skipped:1});
  assert.equal(testCounts((a+b).replace(/\n/g,'\r\n')).tests,11);
  for(const bad of [a+b.replace('fail 0','fail 1'),a+b.replace('cancelled 0','cancelled 1'),a+b.replace('# skipped 0\n',''),a+'not ok 1 - timed out file\n'+b,a+b+'# pass 7\n']) assert.throws(()=>testCounts(bad));
});
test('Mac Core keeps strict full coverage; Windows shares ordinary CI contracts and receipts disclose the gap', () => {
  const core=path.resolve('synthetic-core');
  assert.deepEqual(coreTestCommand(core,'darwin'),{script:path.join(core,'scripts/native-ci-tests.mjs'),args:['--original-deadlines']});
  assert.deepEqual(coreTestCommand(core,'win32'),{script:path.join(core,'scripts/windows-ci-tests.mjs'),args:[]});
  assert.equal(coreTestCommand(core,'linux'),null);assert.throws(()=>coreTestCommand(core,'unknown'));
  assert.equal(coreTestCoverage('win32'),'windows-contract-subset-v1');
  assert.equal(coreTestCoverage('darwin'),'full');assert.equal(coreTestCoverage('linux'),'full');
  const source=fs.readFileSync(path.join(ROOT,'scripts/candidate-native.mjs'),'utf8');
  assert(source.includes('runner.strictNativeTestBatches'));assert(!source.includes('HARA_INTEL_TEST_BUDGET ='));
  assert(source.includes('target: c.target, coverage, counts'));
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  assert(workflow.includes('candidate-test-diagnostics-'));assert(workflow.includes('if: ${{ always() }}'));
  assert(workflow.includes('/*-tests.log.result.json'));assert(!workflow.includes('/private-home/'));
});
test('Core capability code runs only in a scrubbed child and missing capability fails closed', async t => {
  const scope=evidence(),root=scope.fixture('candidate-core-probe');
  const core=path.join(root,'core'),base=path.join(root,'logs'),marker=path.join(root,'observed.json');
  scope.mkdir(core);scope.mkdir(path.join(core,'scripts'));
  const script=path.join(core,'scripts/native-ci-tests.mjs');
  fs.writeFileSync(script,'import fs from "node:fs";fs.writeFileSync(process.env.PROBE_FILE,JSON.stringify({pid:process.pid,sawCredential:!!process.env.HARA_TEST_API_KEY}));export function strictNativeTestBatches(){}');
  const env=scope.environment({HARA_TEST_API_KEY:'synthetic-parent-only',PROBE_FILE:marker});
  await scope.guard(env, async () => {
    await scope.guard(env,()=>assertStrictNativeCore({core,base,env}));
    const observed=JSON.parse(fs.readFileSync(marker));assert.notEqual(observed.pid,process.pid);assert.equal(observed.sawCredential,false);
    fs.writeFileSync(script,'export const unrelated=true;');
    await assert.rejects(()=>scope.guard(env,()=>assertStrictNativeCore({core,base:path.join(root,'missing'),env})),/candidate phase failed/);
    assert.match(fs.readFileSync(path.join(root,'missing/core-capability-tests.log'),'utf8'),/pinned Core must support strict/);
  });
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
  const scope=evidence(),dir=scope.fixture('candidate-tar'),env=scope.environment();
  const file=scope.checked(path.join(dir,'input.tar.gz'),{missing:true});fs.writeFileSync(file,tar(entries),{flag:'wx',mode:0o600});
  return scope.guard(env,()=>fn(file,dir));
}
test('tar validation accepts ordinary files, directories and contained framework links',t=>fixture(t,[{name:'bundle/',type:'5'},{name:'bundle/App',type:'5'},{name:'bundle/App/bin',body:'ok'},{name:'bundle/App/current',type:'2',link:'bin'}],async file=>assert.equal((await validateTar(file)).length,4)));
for(const [name,rows] of Object.entries({ traversal:[{name:'bundle/../../outside'}], absolute:[{name:'/tmp/outside'}], wrongRoot:[{name:'other/file'}], windowsAds:[{name:'bundle/file:stream'}],
  hardlink:[{name:'bundle/file',type:'1',link:'other'}], device:[{name:'bundle/device',type:'3'}], escapeLink:[{name:'bundle/App/link',type:'2',link:'../../../outside'}],
  parentLink:[{name:'bundle/A',type:'2',link:'B'},{name:'bundle/A/file',body:'bad'}], duplicate:[{name:'bundle/file'},{name:'bundle/file'}], gnuLongEscape:[{name:'././@LongLink',type:'L',body:'../../outside\0'},{name:'bundle/file'}] })) {
  test(`tar rejects ${name} before extraction`,t=>fixture(t,rows,file=>assert.rejects(()=>validateTar(file))));
}
test('truncated archive fails closed', t=>fixture(t,[{name:'bundle/file',body:'data'}],async(file)=>{const b=fs.readFileSync(file);fs.writeFileSync(file,b.subarray(0,-12));await assert.rejects(()=>validateTar(file));}));
test('post-extraction link validation is scoped to a private root', t=>fixture(t,[{name:'bundle/file'}],async(_file,dir)=>{const root=path.join(dir,'root'),outside=path.join(dir,'outside');fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(outside,{mode:0o700});fs.writeFileSync(path.join(root,'file'),'ok');validateExtractedTree(root);fs.symlinkSync(outside,path.join(root,'bad'));assert.throws(()=>validateExtractedTree(root));}));
test('outer artifact archive rejects traversal',()=>{for(const text of ['/absolute','a/../b','a\\b',''])assert.throws(()=>checkArchiveEntries(text));});
test('candidate workflow has exact non-main input and no publishing authority', () => {
  const w=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  assert(w.includes(INPUT.controlledRef.replace('refs/heads/',''))); assert(w.includes(INPUT.desktop.commit)); assert(w.includes(INPUT.core.commit));
  assert.equal((w.match(/os: macos-15-intel/g)??[]).length,3); assert(!/contents: write|packages: write|id-token: write|secrets\.|gh release|git push|ossutil|stable\/latest/.test(w));
  assert(w.includes('environment: hara-desktop-candidate')); assert(!w.includes('hara-desktop-production')); assert(w.includes('GIT_CONFIG_KEY_0: core.autocrlf'));
});

test('every candidate checkout phase pins the exact application and Core inputs', () => {
  const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/candidate.yml'),'utf8');
  function check(text) {
    const checkouts=text.split(/^      - uses: /m).filter(step=>step.startsWith('actions/checkout@'));
    for(const [dir,commit] of [['app',INPUT.desktop.commit],['core',INPUT.core.commit]]) {
      const steps=checkouts.filter(step=>new RegExp(`\\bpath: ${dir}(?:[,\\s}])`).test(step));
      assert.equal(steps.length,6,`${dir}: all six candidate phases must be pinned`);
      for(const step of steps) assert.equal(step.match(/\bref: ([a-f0-9]{40})\b/)?.[1],commit,`${dir}: stale or indirect source ref`);
    }
  }
  check(workflow);
  for(const commit of [INPUT.desktop.commit,INPUT.core.commit]) {
    const occurrences=[...workflow.matchAll(new RegExp(`ref: ${commit}`,'g'))];
    assert.equal(occurrences.length,6);
    for(const {index} of occurrences) {
      const start=index+'ref: '.length;
      const stale=workflow.slice(0,start)+'a'.repeat(40)+workflow.slice(start+40);
      assert.throws(()=>check(stale),/stale or indirect source ref/);
    }
  }
});
