import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';

// Evaluate the actual functions with virtual IO. No downloader, signing entry point,
// real temporary directory, credential reader or system process runs in this suite.
function loadFunctions(file, globals, names, cliMarker) {
  const source = fs.readFileSync(new URL('../scripts/' + file, import.meta.url), 'utf8');
  const boundary = source.indexOf(cliMarker);
  assert(boundary > 0, 'source CLI boundary must remain explicit');
  const body = source.slice(0, boundary)
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];$/gm, '')
    .replace(/^export /gm, '');
  const context = vm.createContext(globals);
  new vm.Script(body + '\nthis.functions = {' + names.join(',') + '};', {filename: file}).runInContext(context);
  return context.functions;
}
const payload = Buffer.from('verified fixture bytes');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function downloadFixture({outcome = 'success', paths = path, parentToken} = {}) {
  const root = paths.resolve('virtual-downloads'), target = paths.join(root, 'fixture.zip');
  const rows = new Map([[root, {kind: 'directory', bytes: Buffer.alloc(0)}]]);
  const calls = [], timers = new Set();
  let uuid = 0;
  const put = (file, bytes, extra = {}) => rows.set(file, {kind: 'file', bytes: Buffer.from(bytes), nlink: 1, ...extra});
  const missing = () => Object.assign(Error('virtual missing file'), {code: 'ENOENT'});
  const metadata = file => {
    const row = rows.get(file); if (!row) throw missing();
    return {isFile: () => row.kind === 'file', isDirectory: () => row.kind === 'directory',
      isSymbolicLink: () => row.kind === 'symlink', nlink: row.nlink ?? 1, size: row.bytes.length};
  };
  const exclusive = () => Object.assign(Error('virtual destination exists'), {code: 'EEXIST'});
  const io = {
    constants: fs.constants, existsSync: file => rows.has(file) && rows.get(file).kind !== 'symlink',
    lstatSync: metadata, statSync: metadata,
    readFileSync(file) {if (!rows.has(file)) throw missing(); return Buffer.from(rows.get(file).bytes);},
    openSync(file, flags, mode) {
      assert.equal(flags, 'wx'); assert.equal(mode, 0o600); if (rows.has(file)) throw exclusive();
      put(file, Buffer.alloc(0)); return 17;
    },
    closeSync(fd) {assert.equal(fd, 17);},
    copyFileSync(from, to, flags) {
      assert.equal(flags, fs.constants.COPYFILE_EXCL); if (rows.has(to)) throw exclusive();
      put(to, rows.get(from).bytes);
    },
    rmSync() {assert.fail('automatic deletion requested');}, unlinkSync() {assert.fail('automatic deletion requested');},
  };
  const functions = loadFunctions('github-release-api-download.mjs', {
    ...io, createHash, randomUUID: () => 'fixture-' + ++uuid, basename: paths.basename, join: paths.join, resolve: paths.resolve,
    Buffer, process: {env: {...(parentToken ? {GH_TOKEN: parentToken} : {}), GITHUB_TOKEN: 'FAKE_PARENT_TOKEN'}, pid: 7},
    console: {log() {}}, setTimeout(callback) {const timer = {callback}; timers.add(timer); return timer;},
    clearTimeout(timer) {timers.delete(timer);}, spawn() {assert.fail('un-injected process requested');},
  }, ['downloadReleaseAssetsViaApi'], '\nconst invoked =');
  const metadataInput = [{name: 'fixture.zip', state: 'uploaded', size: payload.length, digest: 'sha256:' + digest(payload),
    apiUrl: 'https://api.github.com/repos/fixture/repository/releases/assets/1'}];
  function execute(command, args, options) {
    const partial = args[args.indexOf('--output') + 1];
    const call = {command, args, options, partial}; calls.push(call);
    if (outcome === 'throw') throw Error('virtual spawn failure');
    const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.end = value => {call.stdin = value;};
    child.kill = signal => {call.signal = signal; queueMicrotask(() => child.emit('close', null, signal));};
    queueMicrotask(() => {
      put(partial, outcome === 'digest' ? Buffer.from('bad bytes') : payload);
      if (outcome === 'collision') put(target, 'concurrent diagnostic');
      if (outcome === 'timeout') return [...timers][0].callback();
      if (outcome === 'error') return child.emit('error', Error('virtual child failure'));
      child.emit('close', outcome === 'http' ? 22 : 0, null);
    });
    return child;
  }
  const download = (options = {}, input = {}) => functions.downloadReleaseAssetsViaApi({metadata: metadataInput,
    repository: 'fixture/repository', directory: root, ...input}, {execute, token: 'FAKE_DOWNLOAD_TOKEN', ...options});
  return {root, target, rows, calls, timers, put, download};
}

test('release download retains a verified target without requesting a child', async () => {
  const h = downloadFixture(); h.put(h.target, payload);
  const result = await h.download(); assert.equal(result.retained, 1); assert.equal(result.downloaded, 0);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.rows.get(h.target).bytes, payload);
});
for (const kind of ['file', 'directory', 'symlink']) test('release download refuses existing ' + kind + ' without overwrite or HTTP', async () => {
  const h = downloadFixture(); h.put(h.target, 'retained diagnostic', {kind});
  await assert.rejects(() => h.download(), /already exists; retained without overwrite/);
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 2);
  assert.equal(h.rows.get(h.target).bytes.toString(), 'retained diagnostic');
});
for (const [outcome, error] of [['throw', /virtual spawn failure/], ['http', /exit code 22/],
  ['error', /virtual child failure/], ['timeout', /i\/o timeout/], ['digest', /digest mismatch/]]) {
  test('release download keeps its partial after ' + outcome, async () => {
    const h = downloadFixture({outcome}); await assert.rejects(() => h.download(), error);
    assert.equal(h.calls.length, 1); assert(h.rows.has(h.calls[0].partial)); assert(!h.rows.has(h.target));
    assert.equal(h.timers.size, 0);
    if (outcome === 'timeout') assert.equal(h.calls[0].signal, 'SIGKILL');
  });
}
for (const paths of [path.posix, path.win32]) test('release download exclusively publishes and verifies bytes with ' + paths.sep + ' paths', async () => {
  const h = downloadFixture({paths, parentToken: 'FAKE_PARENT_TOKEN'}); const result = await h.download();
  assert.equal(result.expected, 1); assert.equal(result.downloaded, 1); assert.equal(result.retained, 0);
  const call = h.calls[0]; assert.equal(call.command, '/usr/bin/curl');
  assert.deepEqual(h.rows.get(h.target).bytes, payload); assert.deepEqual(h.rows.get(call.partial).bytes, payload);
  assert.equal(call.options.env.GH_TOKEN, undefined); assert.equal(call.options.env.GITHUB_TOKEN, undefined);
  assert(!call.args.includes('FAKE_DOWNLOAD_TOKEN')); assert(call.stdin.includes('Bearer FAKE_DOWNLOAD_TOKEN'));
  assert.equal(call.args[call.args.indexOf('--max-time') + 1], '570'); assert.equal(h.timers.size, 0);
});
test('release download refuses an in-flight target collision and keeps both diagnostics', async () => {
  const h = downloadFixture({outcome: 'collision'});
  await assert.rejects(() => h.download(), {code: 'EEXIST'});
  assert.equal(h.rows.get(h.target).bytes.toString(), 'concurrent diagnostic');
  assert.deepEqual(h.rows.get(h.calls[0].partial).bytes, payload); assert.equal(h.timers.size, 0);
});
for (const token of [undefined, '', 'FAKE\nTOKEN', 'FAKE"TOKEN']) test('release download refuses invalid token before any output', async () => {
  const h = downloadFixture(); await assert.rejects(() => h.download({token}), /GH_TOKEN is missing or unsafe/);
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 1);
});
test('release download refuses unsafe destination and asset names without effects', async () => {
  const h = downloadFixture(); h.rows.get(h.root).kind = 'symlink';
  await assert.rejects(() => h.download(), /real directory/);
  h.rows.get(h.root).kind = 'directory';
  await assert.rejects(() => h.download({}, {metadata: [{name: '../escape'}]}), /asset name is unsafe/);
  assert.equal(h.calls.length, 0); assert.equal(h.rows.size, 1);
});

function signingFixture({kind = 'file', nlink = 1, alias = false, missing = false, admissionError = false} = {}) {
  const root = path.resolve('virtual-signing'), keychain = path.join(root, 'dedicated.keychain-db');
  const env = {RUNNER_NAME: 'fixture-runner', HARA_CANDIDATE_RUNNER_NAME: 'fixture-runner',
    HARA_CANDIDATE_RUNNER_DIRECTORY: path.join(root, 'runner'), HARA_CANDIDATE_OPS_DIRECTORY: path.join(root, 'ops'),
    HARA_CANDIDATE_SIGNING_KEYCHAIN: keychain, HARA_CANDIDATE_SIGNING_PASSWORD_FILE: path.join(root, 'password'),
    HARA_CANDIDATE_NOTARY_KEY_FILE: path.join(root, 'notary'), HARA_CANDIDATE_NOTARY_KEY_ID: 'ABCDEFGHIJ',
    HARA_CANDIDATE_NOTARY_ISSUER_ID: '00000000-0000-0000-0000-000000000001'};
  const trace = {metadata: [], updater: 0, keyReads: 0};
  const process = {env, platform: 'darwin', arch: 'arm64', getuid: () => 7};
  const operator = loadFunctions('candidate-operator-config.mjs', {assert, path, process},
    ['candidateSigningConfiguration'], '\nif (process.argv[1]');
  const io = {
    lstatSync(file) {
      trace.metadata.push(file);
      if (file === keychain && missing) throw Object.assign(Error('virtual missing keychain'), {code: 'ENOENT'});
      return {uid: 7, mode: 0o700, nlink, isDirectory: () => file !== keychain || kind === 'directory',
        isFile: () => file === keychain && kind === 'file', isSymbolicLink: () => file === keychain && kind === 'symlink'};
    },
    realpathSync(file) {trace.metadata.push(file); return alias ? path.join(root, 'System.keychain') : file;},
    existsSync() {return false;},
    statSync(file) {assert.equal(file, env.HARA_CANDIDATE_NOTARY_KEY_FILE); return {isFile: () => true};},
    readFileSync(file) {
      assert.equal(file, path.join(env.HARA_CANDIDATE_RUNNER_DIRECTORY, '.runner')); // Never a key file.
      return JSON.stringify({agentId: 1, poolId: 2, poolName: 'fixture-group', agentName: 'fixture-runner', gitHubUrl: 'https://github.com/hara-cli'});
    },
  };
  const functions = loadFunctions('candidate-signing.mjs', {assert, fs: io, path, process, INPUT: {runnerId: 1, runnerGroupId: 2, runnerGroup: 'fixture-group'},
    candidateSigningConfiguration: operator.candidateSigningConfiguration, realHome: path.join(root, 'synthetic-home'),
    async readAdmission() {if (admissionError) throw Error('virtual admission refused');},
    readUpdaterKey() {trace.updater++; throw Error('virtual updater missing');},
  }, ['preconditions'], '\nif (process.argv[1]');
  return {env, keychain, trace, preconditions: functions.preconditions, operator};
}
for (const [label, options] of [['symlink', {kind: 'symlink'}], ['directory', {kind: 'directory'}],
  ['hardlink', {nlink: 2}], ['canonical alias', {alias: true}], ['missing', {missing: true}]]) {
  test('dedicated keychain ' + label + ' is refused before updater material', async () => {
    const h = signingFixture(options); await assert.rejects(() => h.preconditions(), /dedicated|symlink|alias/i);
    assert.equal(h.trace.updater, 0); assert.equal(h.trace.keyReads, 0);
  });
}
for (const name of ['login.keychain-db', 'System.keychain', 'LOGIN.keychain-db']) test('literal ' + name + ' remains refused without file access', () => {
  const h = signingFixture(); h.env.HARA_CANDIDATE_SIGNING_KEYCHAIN = path.join(path.dirname(h.keychain), name);
  assert.throws(() => h.operator.candidateSigningConfiguration(), /dedicated/); assert.equal(h.trace.metadata.length, 0);
});
test('admission refusal still precedes dedicated keychain metadata and updater access', async () => {
  const h = signingFixture({admissionError: true}); await assert.rejects(() => h.preconditions(), /admission refused/);
  assert(!h.trace.metadata.includes(h.keychain)); assert.equal(h.trace.updater, 0);
});
test('canonical single-link keychain reaches only the synthetic updater stop', async () => {
  const h = signingFixture(); await assert.rejects(() => h.preconditions(), /virtual updater missing/);
  assert.equal(h.trace.updater, 1); assert.equal(h.trace.keyReads, 0);
});
test('user keychain metadata reads real account domain without changing evidence HOME', () => {
  const calls = [], process = {env: {HOME: '/evidence/synthetic-home'}};
  const {userKeychainMetadata} = loadFunctions('candidate-signing.mjs', {
    realHome: '/account', process,
    sync(command, args, options) {calls.push({command, args, options}); return args[2];},
  }, ['userKeychainMetadata'], '\nif (process.argv[1]');
  assert.deepEqual({...userKeychainMetadata()}, {search: 'list-keychains', default: 'default-keychain'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {command: '/usr/bin/env', args: ['HOME=/account', '/usr/bin/security', 'list-keychains', '-d', 'user']},
    {command: '/usr/bin/env', args: ['HOME=/account', '/usr/bin/security', 'default-keychain', '-d', 'user']},
  ]);
  assert.equal(process.env.HOME, '/evidence/synthetic-home');
});
