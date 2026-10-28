import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import test, {mock} from 'node:test';
import {api, candidateEvidence, downloadArtifact, githubReadEnvironment, run, sync} from '../scripts/candidate-common.mjs';

// live30 sign_apps: Actions-scoped read-only gh (api/downloadArtifact) must receive exactly
// one GH token after evidence scrub, while generic sync/run children keep none.
const realSpawnSync = childProcess.spawnSync, realSpawn = childProcess.spawn;
const credentialKey = /TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|SECRET|CREDENTIAL|^APPLE_|^AWS_|^ALIYUN_|^npm_config_.*auth/i;
const probe = `const p=process.env;console.log(JSON.stringify({
  childHasGhToken:Object.hasOwn(p,'GH_TOKEN'),
  childHasGithubToken:Object.hasOwn(p,'GITHUB_TOKEN'),
  credentialKeys:Object.keys(p).filter(k=>${credentialKey}.test(k)).sort(),
  hasSshAgent:Object.hasOwn(p,'SSH_AUTH_SOCK'),
  hasNodeOptions:Object.hasOwn(p,'NODE_OPTIONS'),
  privateHome:p.HOME===p.USERPROFILE&&p.HOME===p.CFFIXED_USER_HOME&&p.HARA_HOME===require('node:path').join(p.HOME,'.hara'),
  githubHostPinned:p.GH_HOST==='github.com',
  githubConfigPrivate:p.GH_CONFIG_DIR===require('node:path').join(p.XDG_CONFIG_HOME,'gh')
}));`;
const probeEnv = env => JSON.parse(realSpawnSync(process.execPath, ['-e', probe], {env, encoding: 'utf8', timeout: 20000}).stdout);

function parentFixture() {
  const scope = candidateEvidence();
  return {scope, parent: {...scope.environment(),
    GH_TOKEN: 'SYNTHETIC_ACTIONS_PRIMARY', GITHUB_TOKEN: 'SYNTHETIC_ACTIONS_FALLBACK',
    OTHER_TOKEN: 'SYNTHETIC_OTHER', APPLE_PASSWORD: 'SYNTHETIC_APPLE_PASSWORD', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_AWS',
    TAURI_SIGNING_PRIVATE_KEY: 'SYNTHETIC_PRIVATE', npm_config__auth: 'SYNTHETIC_NPM_AUTH',
    SSH_AUTH_SOCK: 'SYNTHETIC_SSH_AGENT', NODE_OPTIONS: '--trace-warnings',
    GH_HOST: 'synthetic-foreign.invalid', GH_CONFIG_DIR: path.join(scope.tmp, 'foreign-gh-config'),
  }};
}
function withParent(parent, action) {
  const previous = process.env; process.env = {...parent};
  return Promise.resolve().then(action).finally(() => { process.env = previous; });
}
function assertChild(result, tokenAllowed) {
  assert.equal(result.childHasGhToken, tokenAllowed, 'unexpected GH token visibility');
  assert(!result.childHasGithubToken, 'fallback key must not be forwarded');
  assert.deepEqual(result.credentialKeys, tokenAllowed ? ['GH_TOKEN'] : []);
  assert(!result.hasSshAgent && !result.hasNodeOptions && result.privateHome);
  if (tokenAllowed) assert(result.githubHostPinned && result.githubConfigPrivate);
}
// Only gh is intercepted; unzip and other generic commands use the real scrubbed path.
function fakeGh({syncResult, zip} = {}) {
  const calls = [];
  const mocks = [mock.method(childProcess, 'spawnSync', (command, args, options) => {
    if (command !== 'gh') return realSpawnSync(command, args, options);
    calls.push({kind: 'sync', args: [...args], options, child: probeEnv(options.env)});
    return syncResult(args, options);
  }), mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, 'gh', 'only the synthetic gh replacement is accepted');
    calls.push({kind: 'spawn', args: [...args], options, child: probeEnv(options.env)});
    return realSpawn(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', zip], {...options, env: {}});
  })];
  syncBuiltinESMExports();
  return {calls, restore() { for (const m of mocks) m.mock.restore(); syncBuiltinESMExports(); }};
}
const tokens = parent => [parent.GH_TOKEN, parent.GITHUB_TOKEN];

test('candidate-actions-gh-auth: api/downloadArtifact reinject only GH_TOKEN; generic children stay stripped', async t => {
  const {scope, parent} = parentFixture(), initialParent = JSON.stringify(parent);

  await t.test('helper forwards one credential and pins host/config', () => {
    const env = githubReadEnvironment(parent);
    assert(Object.isFrozen(env)); scope.assertEnvironment(env);
    assert.equal(env.GH_TOKEN, parent.GH_TOKEN);
    assert.deepEqual(Object.keys(env).filter(k => credentialKey.test(k)), ['GH_TOKEN']);
    const fallback = {...parent}; delete fallback.GH_TOKEN;
    assert.equal(githubReadEnvironment(fallback).GH_TOKEN, parent.GITHUB_TOKEN);
    const missing = {...fallback}; delete missing.GITHUB_TOKEN;
    assert.throws(() => githubReadEnvironment(missing), /candidate Actions GitHub token required/);
  });

  await t.test('api child receives GH_TOKEN only; endpoint stays Actions-scoped GET', async () => {
    const gh = fakeGh({syncResult: () => ({status: 0, stdout: '{"ok":true}', stderr: ''})});
    try {
      await withParent(parent, () => assert.deepEqual(api('repos/hara-cli/hara-desktop/actions/runs/1/artifacts?per_page=100&page=1'), {ok: true}));
      assert.equal(gh.calls.length, 1); assertChild(gh.calls[0].child, true);
      assert.deepEqual(gh.calls[0].args, ['api', '--method', 'GET', 'repos/hara-cli/hara-desktop/actions/runs/1/artifacts?per_page=100&page=1']);
      assert.equal(gh.calls[0].options.env.GH_TOKEN, parent.GH_TOKEN);
      assert(!gh.calls[0].args.some(a => tokens(parent).some(v => a.includes(v))), 'no token may enter argv');
      await withParent(parent, () => {
        for (const endpoint of ['repos/hara-cli/hara-desktop/environments/x', 'repos/foreign/repo/actions/runs/1',
          'repos/hara-cli/hara-desktop/actions/secrets/x', 'repos/hara-cli/hara-desktop/actions/runs/1\n--method=POST', 7])
          assert.throws(() => api(endpoint), /read-only and Actions-scoped/);
      });
      assert.equal(gh.calls.length, 1, 'refused endpoints must not spawn');
    } finally { gh.restore(); }
  });

  await t.test('api failures never echo credential values', async () => {
    for (const result of [{status: 4, stderr: parent.GH_TOKEN, stdout: parent.GITHUB_TOKEN},
      {status: null, error: Error(parent.GH_TOKEN), stdout: '', stderr: ''},
      {status: 0, signal: 'SIGTERM', stdout: '{}', stderr: ''}, {status: 0, stdout: parent.GH_TOKEN, stderr: ''}]) {
      const gh = fakeGh({syncResult: () => result});
      try {
        await withParent(parent, () => {
          let caught; try { api('repos/hara-cli/hara-desktop/actions/runs/1'); } catch (error) { caught = error; }
          assert(caught instanceof Error);
          assert(!tokens(parent).some(v => caught.message.includes(v)), 'credential leaked in error');
        });
      } finally { gh.restore(); }
    }
  });

  await t.test('downloadArtifact list and zip children both receive GH_TOKEN only', async () => {
    const work = scope.fixture('actions-gh-zip'), payload = path.join(work, 'payload.txt');
    fs.writeFileSync(payload, 'synthetic artifact\n');
    const zip = path.join(work, 'envelope.zip');
    assert.equal(realSpawnSync('zip', ['-q', '-j', zip, payload], {env: scope.environment()}).status, 0);
    const bytes = fs.readFileSync(zip), orchestration = 'a'.repeat(40);
    const artifact = {id: 42, name: 'candidate-unsigned-x86_64-apple-darwin-7-1', expired: false, size_in_bytes: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, workflow_run: {id: 7, head_sha: orchestration}};
    const gh = fakeGh({zip, syncResult: () => ({status: 0, stdout: JSON.stringify({artifacts: [artifact]}), stderr: ''})});
    try {
      const target = path.join(work, 'unsigned-input');
      await withParent(parent, () => downloadArtifact('unsigned', 'x86_64-apple-darwin', target, {runId: 7, attempt: 1, orchestration}));
      assert.deepEqual(gh.calls.map(c => c.kind), ['sync', 'spawn']);
      for (const call of gh.calls) { assertChild(call.child, true); assert.equal(call.options.env.GH_TOKEN, parent.GH_TOKEN); }
      assert.deepEqual(gh.calls[1].args, ['api', '--method', 'GET', 'repos/hara-cli/hara-desktop/actions/artifacts/42/zip']);
      assert.equal(fs.readFileSync(path.join(target, 'payload.txt'), 'utf8'), 'synthetic artifact\n');
    } finally { gh.restore(); }
  });

  await t.test('generic sync, run and scoped environment() children keep every credential stripped', async () => {
    assertChild(JSON.parse(sync(process.execPath, ['-e', probe], {env: parent})), false);
    assertChild(JSON.parse(await run('actions-gh synthetic sentinel', process.execPath, ['-e', probe], {env: parent, capture: true})), false);
    assertChild(probeEnv(candidateEvidence(parent).environment({CANDIDATE_OUTPUT_DIR: scope.tmp})), false);
  });
  assert.equal(JSON.stringify(parent), initialParent, 'parent environment must be unchanged');
});
