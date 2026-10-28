import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import test, {mock} from 'node:test';
import {ROOT, INPUT, TARGETS, identity, candidateEvidence} from '../scripts/candidate-common.mjs';
import {STAGES, MAX_AGE_MS, LocalPreflightRefusal, assertLocalPreflight, orchestrationHead, receiptDirectory,
  runPreflight} from '../scripts/candidate-local-aarch64-preflight.mjs';
import {attestRun} from '../scripts/candidate-policy-admin.mjs';
import {parseArgs, pushControlledRef} from '../scripts/candidate-controlled-ref-push.mjs';

// Local operator gate: kick/proof paths refuse before remote CI unless the exact tip passed aarch64 locally.
const realSpawnSync = childProcess.spawnSync, scope = candidateEvidence(), sha = 'a'.repeat(40), tree = 'b'.repeat(40), other = 'c'.repeat(40);
const refusal = pattern => error => error instanceof LocalPreflightRefusal && pattern.test(error.message) && /preflight\.mjs run /.test(error.message);
function receipt(root, overrides = {}, {name, mode = 0o600} = {}) {
  const directory = receiptDirectory(root); fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const finishedAt = overrides.finishedAt ?? new Date().toISOString();
  const r = {schema: 1, kind: 'hara-local-aarch64-preflight', result: 'pass', orchestration: sha, tree, identity,
    application: INPUT.desktop.commit, core: INPUT.core.commit, target: 'aarch64-apple-darwin', host: {platform: 'darwin', arch: 'arm64'},
    stages: STAGES.map(n => ({name: n, status: 'pass'})), finishedAt, ...overrides};
  const file = path.join(directory, name ?? `${r.orchestration}-${Date.parse(finishedAt)}.json`);
  fs.writeFileSync(file, JSON.stringify(r), {mode}); fs.chmodSync(file, mode); return file;
}
const bareEnv = () => { const e = {...process.env}; delete e.CANDIDATE_EVIDENCE_ROOT; delete e.HARA_WRAPPER_EVIDENCE_ROOT; return e; };

test('receipt check binds exact HEAD/tree, inputs, stages, host, mode and freshness', () => {
  const root = scope.fixture('preflight-check');
  assert.throws(() => assertLocalPreflight({root: undefined, sha, tree}), refusal(/CANDIDATE_LOCAL_PREFLIGHT_ROOT/));
  assert.throws(() => assertLocalPreflight({root, sha, tree}), refusal(/no local aarch64 receipt directory/));
  receipt(root, {orchestration: other});
  assert.throws(() => assertLocalPreflight({root, sha, tree}), refusal(/missing or SHA mismatch/));
  const good = receipt(root);
  assert.equal(assertLocalPreflight({root, sha, tree}).file, good);
  assert.throws(() => assertLocalPreflight({root, sha, tree: other}), refusal(/not HEAD/));
  assert.throws(() => assertLocalPreflight({root, sha, tree, now: Date.now() + MAX_AGE_MS + 60000}), refusal(/stale/));
  fs.chmodSync(good, 0o644); assert.throws(() => assertLocalPreflight({root, sha, tree}), refusal(/0600/)); fs.chmodSync(good, 0o600);
  const t = Date.now() + 1000;
  for (const [overrides, pattern] of [[{stages: STAGES.slice(0, 3).map(n => ({name: n, status: 'pass'}))}, /passing stages/],
    [{stages: STAGES.map(n => ({name: n, status: n === 'build' ? 'fail' : 'pass'}))}, /passing stages/],
    [{result: 'fail'}, /not a passing/], [{identity: 'x'}, /candidate inputs/], [{host: {platform: 'darwin', arch: 'x64'}}, /native aarch64/],
    [{finishedAt: new Date(Date.now() + 3600000).toISOString()}, /future/]]) {
    const file = receipt(root, {finishedAt: new Date(t).toISOString(), ...overrides}, {name: `${sha}-${t}.json`});
    assert.throws(() => assertLocalPreflight({root, sha, tree, now: t}), refusal(pattern)); fs.rmSync(file);
  }
  fs.chmodSync(receiptDirectory(root), 0o755);
  assert.throws(() => assertLocalPreflight({root, sha, tree}), refusal(/0700/));
});

test('runPreflight runs hydrate → tests → sidecar → build and writes a receipt only when all pass', async () => {
  const head = () => ({sha, tree, clean: true}), calls = [];
  const deps = (stages, extra = {}) => ({env: bareEnv(), head, platform: 'darwin', arch: 'arm64', stages,
    assertToolchain() {}, nativeTarget: () => 'aarch64-apple-darwin', sourceDirectories: () => ({desktop: '/d', core: '/c'}), assertSources() {}, ...extra});
  const ok = Object.fromEntries(STAGES.map(n => [n, c => { calls.push([n, c.target, c.desktop, c.env.HOME]); }]));
  await assert.rejects(runPreflight(scope.fixture('preflight-x64'), deps(ok, {arch: 'x64'})), refusal(/Rosetta\/x64 refused/));
  await assert.rejects(runPreflight(scope.fixture('preflight-actions'), deps(ok, {env: {...bareEnv(), GITHUB_ACTIONS: 'true'}})), refusal(/cannot run in Actions/));
  await assert.rejects(runPreflight(scope.fixture('preflight-dirty'), deps(ok, {head: () => ({sha, tree, clean: false})})), refusal(/must be clean/));
  await assert.rejects(runPreflight(scope.fixture('preflight-tools'), deps(ok, {assertToolchain() { assert.equal('22.22.3', '22.23.1'); }})),
    refusal(/pinned toolchain .* check failed before stages/));
  await assert.rejects(runPreflight(scope.fixture('preflight-sources'), deps(ok, {assertSources() { throw Error('dirty app'); }})),
    refusal(/pinned application\/Core sources .* failed before stages: dirty app/));
  assert.equal(calls.length, 0, 'no stage runs before toolchain/source checks pass');
  const failRoot = scope.fixture('preflight-fail');
  await assert.rejects(runPreflight(failRoot, deps({...ok, tests() { throw Error('Core full at original deadlines failed'); }})),
    refusal(/stage tests failed for HEAD a{40}: Core full/));
  assert(!fs.existsSync(receiptDirectory(failRoot)), 'a failed stage must not leave a receipt');
  assert.throws(() => assertLocalPreflight({root: failRoot, sha, tree}), LocalPreflightRefusal);
  calls.length = 0;
  const root = scope.fixture('preflight-pass'), before = JSON.stringify(process.env);
  const result = await runPreflight(root, deps(ok));
  assert.deepEqual(calls.map(c => c[0]), STAGES);
  assert(calls.every(c => c[1] === 'aarch64-apple-darwin' && c[2] === '/d' && c[3] === path.join(root, 'synthetic-home')));
  assert.equal(JSON.stringify(process.env), before, 'operator environment restored');
  assert.equal(fs.statSync(result.file).mode & 0o777, 0o600);
  assert.equal(assertLocalPreflight({root, sha, tree}).file, result.file);
  assert.equal(result.publicationAuthorized, false);
  let n = 0;
  await assert.rejects(runPreflight(scope.fixture('preflight-moved'), deps(ok, {head: () => ({sha: n++ ? other : sha, tree, clean: true})})), refusal(/changed during preflight/));
});

test('Gate A publish/prepare refuse before any gh call without a tip-bound receipt; pass through with one', async () => {
  const proofDir = scope.fixture('preflight-proof'), gh = [];
  const m = mock.method(childProcess, 'spawnSync', (command, args, options) => {
    if (command !== 'gh') return realSpawnSync(command, args, options);
    gh.push(args); return {status: 0, stdout: JSON.stringify({id: 1}), stderr: ''};
  }); syncBuiltinESMExports();
  const previous = process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT;
  try {
    for (const publish of [true, false]) {
      delete process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT;
      await assert.rejects(attestRun(7, proofDir, {publish}), refusal(/CANDIDATE_LOCAL_PREFLIGHT_ROOT/));
      const root = scope.fixture('preflight-admin'); process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT = root;
      await assert.rejects(attestRun(7, proofDir, {publish}), refusal(/no local aarch64 receipt/));
      assert.equal(gh.length, 0, 'refusal precedes every gh read');
      const head = orchestrationHead(); receipt(root, {orchestration: head.sha, tree: head.tree});
      await assert.rejects(attestRun(7, proofDir, {publish}), /local administrator identity mismatch/);
      assert.deepEqual(gh.splice(0), [['api', '--method', 'GET', 'user']], 'green receipt proceeds to existing attestation');
    }
    process.env.GITHUB_ACTIONS = 'true';
    await assert.rejects(attestRun(7, proofDir, {publish: true}), /cannot run in Actions/);
  } finally {
    delete process.env.GITHUB_ACTIONS;
    if (previous === undefined) delete process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT; else process.env.CANDIDATE_LOCAL_PREFLIGHT_ROOT = previous;
    m.mock.restore(); syncBuiltinESMExports();
  }
});

test('controlled-ref push helper: receipt, confirm, FF-only, no force or tags', () => {
  const root = scope.fixture('preflight-push'), tip = 'd'.repeat(40), ref = INPUT.controlledRef;
  const fakeGit = ({ancestor = true, url = 'git@github.com:hara-cli/hara-desktop.git', listed = `${tip}\t${ref}`} = {}) => {
    const calls = [];
    return {calls, git(args) {
      calls.push(args);
      if (args[0] === 'remote') return {status: 0, stdout: url};
      if (args[0] === 'ls-remote') return {status: 0, stdout: listed};
      if (args[0] === 'cat-file') return {status: 0, stdout: ''};
      if (args[0] === 'merge-base') return {status: ancestor ? 0 : 1, stdout: ''};
      if (args[0] === 'push') return {status: 0, stdout: ''};
      throw Error('unexpected git ' + args[0]);
    }};
  };
  const head = () => ({sha, tree, clean: true}), env = {};
  const pushes = g => g.calls.filter(a => a[0] === 'push');
  let g = fakeGit();
  assert.throws(() => pushControlledRef({root, confirm: sha}, {git: g.git, head, env}), refusal(/no local aarch64 receipt/));
  assert.equal(g.calls.length, 0, 'no remote access before the receipt');
  receipt(root);
  assert.throws(() => pushControlledRef({root, confirm: other}, {git: g.git, head, env}), refusal(/--confirm-kick must equal/));
  assert.throws(() => pushControlledRef({root, confirm: sha}, {git: g.git, head: () => ({sha, tree, clean: false}), env}), refusal(/clean/));
  assert.throws(() => pushControlledRef({root, confirm: sha}, {git: g.git, head, env: {GITHUB_ACTIONS: 'true'}}), refusal(/Actions/));
  for (const [options, pattern] of [[{ancestor: false}, /does not fast-forward/], [{url: 'git@github.com:foreign/repo.git'}, /must push to hara-cli/],
    [{listed: ''}, /must already exist/], [{listed: `${sha}\t${ref}`}, /same-SHA push/]]) {
    g = fakeGit(options);
    assert.throws(() => pushControlledRef({root, confirm: sha}, {git: g.git, head, env}), refusal(pattern));
    assert.equal(pushes(g).length, 0);
  }
  g = fakeGit();
  assert.deepEqual(pushControlledRef({root, confirm: sha, dryRun: true}, {git: g.git, head, env}).command,
    ['git', 'push', '--porcelain', '--no-follow-tags', 'origin', `${sha}:${ref}`]);
  assert.equal(pushes(g).length, 0, 'dry run never pushes');
  assert.deepEqual(pushControlledRef({root, confirm: sha}, {git: g.git, head, env}), {dryRun: false, from: tip, to: sha, ref});
  const [push] = pushes(g);
  assert.deepEqual(push, ['push', '--porcelain', '--no-follow-tags', 'origin', `${sha}:${ref}`]);
  assert(!push.some(a => /force|^\+|^--tags$|^--mirror$|refs\/tags/.test(a)), 'never force or tags');
  assert.deepEqual(parseArgs([root, '--confirm-kick', sha, '--dry-run']), {root, confirm: sha, remote: 'origin', dryRun: true});
  assert.throws(() => parseArgs([root, '--force']), LocalPreflightRefusal);
});

test('hosted candidate workflow keeps all four platforms and never invokes the local-only gate', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/candidate.yml'), 'utf8');
  for (const target of TARGETS) assert(workflow.includes(target), `hosted workflow must still build ${target}`);
  for (const local of ['candidate-local-aarch64-preflight', 'candidate-controlled-ref-push', 'CANDIDATE_LOCAL_PREFLIGHT_ROOT'])
    assert(!workflow.includes(local), `${local} is local operator only`);
});
