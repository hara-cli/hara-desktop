import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
import test, {mock} from 'node:test';
import * as admission from '../scripts/candidate-admission.mjs';
import {ROOT, candidateEvidence, run, sync} from '../scripts/candidate-common.mjs';

const realSpawnSync = childProcess.spawnSync;
const credentialKey = /TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|SECRET|CREDENTIAL|^APPLE_|^AWS_|^ALIYUN_|^npm_config_.*auth/i;
const probe = `const p=process.env;console.log(JSON.stringify({
  childHasGhToken:Object.hasOwn(p,'GH_TOKEN'),
  childHasGithubToken:Object.hasOwn(p,'GITHUB_TOKEN'),
  credentialKeys:Object.keys(p).filter(k=>${credentialKey}.test(k)).sort(),
  hasSshAgent:Object.hasOwn(p,'SSH_AUTH_SOCK'),
  hasNodeOptions:Object.hasOwn(p,'NODE_OPTIONS'),
  privateHome:p.HOME===p.USERPROFILE&&p.HOME===p.CFFIXED_USER_HOME&&p.HARA_HOME===require('node:path').join(p.HOME,'.hara'),
  privateTmp:p.TMPDIR===p.TMP&&p.TMPDIR===p.TEMP,
  githubHostPinned:p.GH_HOST==='github.com',
  githubConfigPrivate:p.GH_CONFIG_DIR===require('node:path').join(p.XDG_CONFIG_HOME,'gh')
}));`;

function parentFixture() {
  const scope = candidateEvidence();
  return {scope, parent: {...scope.environment(),
    GH_TOKEN: 'SYNTHETIC_ADMISSION_PRIMARY', GITHUB_TOKEN: 'SYNTHETIC_ADMISSION_FALLBACK',
    OTHER_TOKEN: 'SYNTHETIC_OTHER', SOME_SECRET: 'SYNTHETIC_SECRET',
    DEPLOY_CREDENTIAL: 'SYNTHETIC_CREDENTIAL', API_KEY: 'SYNTHETIC_API',
    APPLE_ID: 'SYNTHETIC_APPLE', APPLE_PASSWORD: 'SYNTHETIC_APPLE_PASSWORD',
    AWS_ACCESS_KEY_ID: 'SYNTHETIC_AWS', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_AWS_SECRET',
    TAURI_SIGNING_PRIVATE_KEY: 'SYNTHETIC_PRIVATE', npm_config__auth: 'SYNTHETIC_NPM_AUTH',
    npm_config_registry_authToken: 'SYNTHETIC_NPM_TOKEN',
    SSH_AUTH_SOCK: 'SYNTHETIC_SSH_AGENT', NODE_OPTIONS: '--trace-warnings',
    GH_HOST: 'synthetic-foreign.invalid', gh_host: 'synthetic-lowercase.invalid',
    GH_CONFIG_DIR: path.join(scope.tmp, 'foreign-gh-config'), gh_config_dir: path.join(scope.tmp, 'lowercase-gh-config'),
  }};
}

function withParent(parent, action) {
  const previous = process.env;
  process.env = {...parent};
  try { return action(); } finally { process.env = previous; }
}

// A real Node child receives the exact gh spawn options. No real gh process or
// network request is permitted, and the child prints booleans/key names only.
function fakeGh(action, resultOverride) {
  const calls = [];
  const mocked = mock.method(childProcess, 'spawnSync', (command, args, options) => {
    assert(command === 'gh', 'only the synthetic gh replacement is accepted');
    calls.push({args: [...args], options});
    if (resultOverride) return resultOverride(options);
    return realSpawnSync(process.execPath, ['-e', probe], {...options, timeout: 20000});
  });
  syncBuiltinESMExports();
  try { return {value: action(), calls}; }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
}

function assertPrivateChild(result, tokenAllowed) {
  assert(result.childHasGhToken === tokenAllowed, 'unexpected GH token visibility');
  assert(!result.childHasGithubToken, 'fallback key must not be forwarded');
  assert.deepEqual(result.credentialKeys, tokenAllowed ? ['GH_TOKEN'] : []);
  assert(!result.hasSshAgent && !result.hasNodeOptions, 'process injection keys must remain stripped');
  assert(result.privateHome && result.privateTmp, 'private evidence authority must be retained');
  if (tokenAllowed) assert(result.githubHostPinned && result.githubConfigPrivate, 'admission must use the fixed public host and private gh config');
}

test('candidate-admission-auth-s0s1: admission-only credential capability, offline sentinel', async t => {
  let networkAttempts = 0;
  const denied = () => { networkAttempts++; throw Error('network forbidden in admission-auth S0S1'); };
  const guards = [mock.method(globalThis, 'fetch', denied), mock.method(http, 'request', denied),
    mock.method(http, 'get', denied), mock.method(https, 'request', denied),
    mock.method(https, 'get', denied), mock.method(net, 'connect', denied), mock.method(tls, 'connect', denied)];
  syncBuiltinESMExports();
  try {
    const {scope, parent} = parentFixture();
    const initialParent = JSON.stringify(parent);
    const initial = withParent(parent, () => fakeGh(() => admission.policyGet('environments/hara-desktop-candidate')));
    assert(initial.value.childHasGhToken, 'policyGet child must receive one GH token');
    assertPrivateChild(initial.value, true);
    assert(initial.calls.length === 1, 'one GET must spawn exactly once');
    assert(initial.calls[0].options.env.GH_TOKEN === parent.GH_TOKEN, 'primary token must be preferred');
    assert(!initial.calls[0].args.some(a => a.includes(parent.GH_TOKEN) || a.includes(parent.GITHUB_TOKEN)), 'no token may enter argv');
    assert(JSON.stringify(parent) === initialParent, 'parent environment must be unchanged');

    await t.test('helper returns an immutable private environment with a single credential key', () => {
      const env = admission.admissionGhEnvironment(parent);
      assert(Object.isFrozen(env)); scope.assertEnvironment(env);
      assert(env.GH_TOKEN === parent.GH_TOKEN, 'primary token mismatch');
      assert.deepEqual(Object.keys(env).filter(k => credentialKey.test(k)), ['GH_TOKEN']);
      assert(env.GH_HOST === 'github.com' && env.GH_CONFIG_DIR === path.join(scope.home, '.config', 'gh'));
      assert.deepEqual(Object.keys(env).filter(k => /^gh_(?:host|config_dir)$/i.test(k)).sort(), ['GH_CONFIG_DIR', 'GH_HOST']);
      assert(!Object.hasOwn(env, 'SSH_AUTH_SOCK') && !Object.hasOwn(env, 'NODE_OPTIONS'));
      assert(JSON.stringify(parent) === initialParent, 'helper must not mutate its parent');
    });

    await t.test('fallback is forwarded only as GH_TOKEN, including an empty primary', () => {
      for (const primary of [undefined, '']) {
        const fallback = {...parent};
        if (primary === undefined) delete fallback.GH_TOKEN; else fallback.GH_TOKEN = primary;
        const env = admission.admissionGhEnvironment(fallback);
        assert(env.GH_TOKEN === parent.GITHUB_TOKEN, 'fallback credential mismatch');
        assert.deepEqual(Object.keys(env).filter(k => credentialKey.test(k)), ['GH_TOKEN']);
        const child = withParent(fallback, () => fakeGh(() => admission.policyGet('rulesets/123')));
        assertPrivateChild(child.value, true);
        assert(child.calls[0].options.env.GH_TOKEN === parent.GITHUB_TOKEN, 'fallback not passed to child');
      }
    });

    await t.test('absent or malformed credentials refuse before any gh process can look up credentials', () => {
      for (const value of [undefined, '', 'bad\nvalue', 'bad\rvalue', 'bad\0value', 7]) {
        const missing = {...parent}; delete missing.GITHUB_TOKEN;
        if (value === undefined) delete missing.GH_TOKEN; else missing.GH_TOKEN = value;
        const result = withParent(missing, () => fakeGh(() => {
          assert.throws(() => admission.policyGet('rulesets/123'), /admission.*token/i);
        }));
        assert(result.calls.length === 0, 'credential refusal must precede spawning');
      }
    });

    await t.test('an invalid private HOME binding cannot be rescued by token injection', () => {
      assert.throws(() => admission.admissionGhEnvironment({...parent, HOME: path.dirname(parent.HOME)}));
    });

    await t.test('the existing three endpoint families always use one fixed repository GET', () => {
      for (const endpoint of ['environments/hara-desktop-candidate',
        'environments/hara-desktop-candidate/deployment-branch-policies', 'rulesets/123',
        'issues/1/comments?since=2026-10-25T00%3A00%3A00Z&per_page=100&page=1']) {
        const result = withParent(parent, () => fakeGh(() => admission.policyGet(endpoint)));
        assertPrivateChild(result.value, true);
        assert.deepEqual(result.calls[0].args, ['api', '--method', 'GET', `repos/hara-cli/hara-desktop/${endpoint}`]);
        assert(result.calls[0].options.cwd === ROOT && !result.calls[0].options.shell);
      }
    });

    await t.test('write endpoints, foreign URLs and argument injection fail before the child', () => {
      const result = withParent(parent, () => fakeGh(() => {
        for (const endpoint of ['POST', '--method=PATCH', 'https://api.github.com/repos/foreign/repository',
          'environments/hara-desktop-production', 'environments/hara-desktop-candidate/secrets',
          'rulesets/../123', 'issues/1/comments', 'issues/2/comments?page=1',
          'issues/1/comments?page=1\n--method=POST']) assert.throws(() => admission.policyGet(endpoint));
      }));
      assert(result.calls.length === 0, 'refused endpoints must not spawn');
    });

    await t.test('child failures, spawn errors, signals and malformed JSON expose no credential or response', () => {
      for (const childResult of [
        {status: 4, stderr: parent.GH_TOKEN, stdout: parent.GITHUB_TOKEN},
        {status: null, error: Error(parent.GH_TOKEN), stdout: '', stderr: ''},
        {status: 0, signal: 'SIGTERM', stdout: '{}', stderr: ''},
        {status: 0, stdout: parent.GH_TOKEN, stderr: ''},
      ]) {
        withParent(parent, () => fakeGh(() => {
          let caught;
          try { admission.policyGet('rulesets/123'); } catch (error) { caught = error; }
          assert(caught instanceof Error, 'unsafe child result must be refused');
          assert(!caught.message.includes(parent.GH_TOKEN) && !caught.message.includes(parent.GITHUB_TOKEN), 'credential leaked in error');
        }, () => childResult));
      }
    });

    let syncChild, runChild, upgradeChild;
    await t.test('generic sync keeps stripping every credential from an actual Node child', () => {
      syncChild = JSON.parse(sync(process.execPath, ['-e', probe], {env: parent}));
      assertPrivateChild(syncChild, false);
    });
    await t.test('generic run keeps stripping every credential from an actual Node child', async () => {
      runChild = JSON.parse(await run('Hara 同事 synthetic environment sentinel', process.execPath, ['-e', probe], {env: parent, capture: true}));
      assertPrivateChild(runChild, false);
    });
    await t.test('the exact scoped environment used by upgradeSmoke still reaches a child without credentials', () => {
      const env = candidateEvidence(parent).environment({CANDIDATE_OUTPUT_DIR: scope.tmp});
      const child = scope.guardSync(env, () => realSpawnSync(process.execPath, ['-e', probe], {cwd: ROOT, env, encoding: 'utf8', timeout: 20000}));
      assert(child.status === 0 && !child.error);
      upgradeChild = JSON.parse(child.stdout); assertPrivateChild(upgradeChild, false);
    });
    assert(networkAttempts === 0, 'the sentinel attempted network access');
    assert(JSON.stringify(parent) === initialParent, 'parent changed during the sentinel');
    const sentinel = {schema: 1, purpose: 'candidate-admission-auth-s0s1', syntheticOnly: true,
      networkRequests: networkAttempts, realGhInvocations: 0, parentHasGhToken: true,
      admissionChildHas: initial.value.childHasGhToken, admissionChildHasGhToken: initial.value.childHasGhToken,
      admissionCredentialKeys: initial.value.credentialKeys, nonAdmissionChildHas: syncChild.childHasGhToken || runChild.childHasGhToken || upgradeChild.childHasGhToken,
      syncChildHasGhToken: syncChild.childHasGhToken, runChildHasGhToken: runChild.childHasGhToken,
      upgradeChildHasGhToken: upgradeChild.childHasGhToken, readonlyGetShapeVerified: true,
      admissionHostPinned: initial.value.githubHostPinned, admissionGhConfigPrivate: initial.value.githubConfigPrivate,
      tokenPermissionProbePerformed: false, parentUnchanged: true, privateHomeAndTmpPreserved: true,
      candidateReady: false, nextStop: 'await-S2-dispatch'};
    const output = process.env.HARA_ADMISSION_AUTH_SENTINEL_PATH;
    if (output) fs.writeFileSync(scope.checked(output, {missing: true}), JSON.stringify(sentinel, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  } finally {
    for (const guard of guards) guard.mock.restore();
    syncBuiltinESMExports();
  }
});
