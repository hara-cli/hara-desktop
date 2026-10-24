import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { provisionCiEvidence, withCiEnvironment } from '../scripts/ci-evidence.mjs';
import { runRegression } from '../scripts/ci-regression.mjs';
import { corePlatformSmoke } from '../scripts/ci-core-platform.mjs';
import { ROOT, candidateEvidence, run } from '../scripts/candidate-common.mjs';

function virtual({ paths = path.posix, parent = '/evidence', accountHome = '/account' } = {}) {
  const root = paths.join(parent, 'run'), output = paths.join(root, 'tmp', 'results');
  let inode = 100n, calls = 0;
  const rows = new Map(), writes = [];
  const add = value => { const row = { dev: 1n, ino: inode++, uid: 7n, mode: 0o700n, nlink: 1n, kind: 'directory' }; rows.set(value, row); return row; };
  add(parent);
  const io = {
    lstatSync(value) {
      calls++; if (!rows.has(value)) throw Object.assign(Error('virtual missing'), { code: 'ENOENT' });
      const row = rows.get(value);
      return { ...row, isDirectory: () => row.kind === 'directory', isSymbolicLink: () => row.kind === 'link', isFile: () => row.kind === 'file' };
    },
    realpathSync(value) { calls++; assert(rows.has(value)); return rows.get(value).alias ?? value; },
    mkdirSync(value, options) {
      if (rows.has(value)) throw Object.assign(Error('retained leaf'), { code: 'EEXIST' });
      assert.equal(options.mode, 0o700); writes.push(value); add(value);
    }
  };
  const options = { evidenceRoot: root, output, io, paths, accountHome, ownerUid: 7, env: { PATH: '/tools', HOME: accountHome, TMPDIR: '/poison', GH_TOKEN: 'synthetic-only', NODE_OPTIONS: '--invalid' } };
  return { root, output, io, paths, options, rows, add, writes, calls: () => calls, provision: extra => provisionCiEvidence({ ...options, ...extra }) };
}
for (const [name, options] of [['POSIX', {}], ['Windows', { paths: path.win32, parent: 'D:\\evidence', accountHome: 'C:\\Users\\fixture' }]]) {
  test('CI explicitly creates and binds retained ' + name + ' evidence without a temp allocator', () => {
    const v = virtual(options), c = v.provision();
    assert.equal(c.evidenceRoot, v.root); assert.equal(c.base, v.output);
    assert.equal(c.env.HOME, v.paths.join(v.root, 'synthetic-home')); assert.equal(c.env.TMPDIR, v.paths.join(v.root, 'tmp'));
    assert.equal(c.env.CANDIDATE_OUTPUT_DIR, v.output); assert.equal(c.env.HARA_WRAPPER_EVIDENCE_ROOT, v.root);
    assert.equal(c.env.RUSTUP_HOME, v.paths.join(v.options.accountHome, '.rustup'));
    assert.equal(c.env.CARGO_HOME, v.paths.join(v.options.accountHome, '.cargo'));
    assert.equal(c.env.GH_TOKEN, undefined); assert.equal(c.env.NODE_OPTIONS, undefined);
    assert.equal(c.cleanup, 'keep'); assert.equal(c.deletionEnabled, false);
    assert.deepEqual(Object.keys(c.env).slice(-2), ['HOME', 'TMPDIR']);
    assert(v.rows.has(c.base));
    const fixture = c.scope.fixture('six-budget');
    assert.equal(v.paths.basename(fixture).length, 'six-budget-'.length + 6);
    assert(v.rows.has(fixture)); assert.equal(v.io.mkdtempSync, undefined);
  });
  test('CI ' + name + ' preserves explicit Rust homes as authority and rejects caller replacements', () => {
    const v = virtual(options), rustup = v.paths.join(v.options.accountHome, 'configured-rustup'), cargo = v.paths.join(v.options.accountHome, 'configured-cargo');
    const c = v.provision({ env: { ...v.options.env, RUSTUP_HOME: rustup, CARGO_HOME: cargo } });
    const env = c.scope.environment({ RUSTUP_HOME: '/poison', CARGO_HOME: '/poison', rustup_home: '/poison', cargo_home: '/poison', HOME: '/poison' });
    assert.equal(env.RUSTUP_HOME, rustup); assert.equal(env.CARGO_HOME, cargo);
    assert.equal(env.rustup_home, undefined); assert.equal(env.cargo_home, undefined);
    assert.equal(env.HOME, v.paths.join(v.root, 'synthetic-home')); c.scope.assertEnvironment(env);
    for (const key of ['RUSTUP_HOME', 'CARGO_HOME']) {
      let ran = false;
      assert.throws(() => c.scope.guardSync({ ...env, [key]: '/poison' }, () => { ran = true; }), /authority changed/);
      assert.equal(ran, false); assert(v.rows.has(c.base));
    }
  });
}
test('both explicit root aliases and output environment binding work without a default directory', () => {
  const v = virtual();
  const c = v.provision({ evidenceRoot: undefined, output: undefined,
    env: { CANDIDATE_EVIDENCE_ROOT: v.root, HARA_WRAPPER_EVIDENCE_ROOT: v.root, CANDIDATE_OUTPUT_DIR: v.output } });
  assert.equal(c.base, v.output);
});
for (const root of [undefined, 'relative', '/tmp/run', '/private/tmp/run', '/var/folders/run', '/private/var/folders/run', '/account/Library/Caches/run', '/account/.hara/run', '/evidence/../outside']) {
  test('missing/forbidden CI root is rejected before filesystem access: ' + String(root), () => {
    const v = virtual(); assert.throws(() => v.provision({ evidenceRoot: root, env: { RUNNER_TEMP: '/ignored-not-created' } }), /evidence path|forbidden/);
    assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0);
  });
}
for (const output of [undefined, '/outside/results', '/evidence/run/tmp-other/results', '/evidence/run/tmp']) {
  test('output must be an explicit private tmp child: ' + String(output), () => {
    const v = virtual(); assert.throws(() => v.provision({ output }), /evidence path|below evidence tmp/);
    assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0);
  });
}
test('conflicting root aliases fail before provisioning', () => {
  const v = virtual(); assert.throws(() => v.provision({ env: { HARA_WRAPPER_EVIDENCE_ROOT: '/other' } }), /conflicting/);
  assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0);
});
for (const [name, change] of [['link', row => row.kind = 'link'], ['alias', row => row.alias = '/elsewhere'], ['foreign owner', row => row.uid = 8n], ['writable parent', row => row.mode = 0o777n]]) {
  test('unsafe root parent fails without creating evidence: ' + name, () => {
    const v = virtual(); change(v.rows.get(v.paths.dirname(v.root))); assert.throws(() => v.provision()); assert.equal(v.writes.length, 0);
  });
}
test('existing output is retained and rejected, with no overwrite or delete API', () => {
  const v = virtual(), c = v.provision(), marker = v.add(v.paths.join(c.base, 'retained'));
  assert.throws(() => v.provision(), /retained leaf/); assert.equal(v.rows.get(v.paths.join(c.base, 'retained')), marker);
  assert(!Object.keys(v.io).some(key => /^(?:rm|rmdir|unlink)/.test(key)));
});
test('exclusive fixture collision fails without retry, fallback or deletion', () => {
  const v = virtual(), c = v.provision(); let attempts = 0;
  v.io.mkdirSync = () => { attempts++; throw Object.assign(Error('collision retained'), { code: 'EEXIST' }); };
  assert.throws(() => c.scope.fixture('collision'), /collision retained/); assert.equal(attempts, 1);
});
for (const outcome of ['success', 'failure', 'cancel']) {
  test('CI ' + outcome + ' retains evidence and restores only its process environment', async () => {
    const v = virtual(), c = v.provision(), target = { HOME: 'prior-home', MARKER: 'keep' }, previous = { ...target };
    const body = async () => { assert.equal(target.HOME, c.env.HOME); target.ADDED = 'temporary';
      if (outcome !== 'success') throw Object.assign(Error(outcome), { name: outcome === 'cancel' ? 'AbortError' : 'Error' }); return 'ok'; };
    if (outcome === 'success') assert.equal(await withCiEnvironment(c, body, target), 'ok');
    else await assert.rejects(() => withCiEnvironment(c, body, target), new RegExp(outcome));
    assert.deepEqual(target, previous); assert(v.rows.has(c.base));
  });
}
test('final directory identity failure is fatal and environment restoration still happens', async () => {
  const v = virtual(), c = v.provision(), target = { HOME: 'original' };
  await assert.rejects(() => withCiEnvironment(c, async () => { v.rows.get(v.root).ino++; return 'body succeeded'; }, target), /identity changed/);
  assert.deepEqual(target, { HOME: 'original' }); assert(v.rows.has(c.base));
});
function actualOptions(environment = process.env) {
  const root = candidateEvidence().fixture('ci-caller');
  // withCiEnvironment replaces the parent env too; retain Windows Node's system runtime root.
  const env = { PATH: environment.PATH, ...(environment.SystemRoot ? { SystemRoot: environment.SystemRoot } : {}),
    TEST_API_KEY: 'synthetic-not-a-key' };
  return { evidenceRoot: root, output: path.join(root, 'tmp', 'results'), env };
}
test('micro-child fixture retains Windows SystemRoot without inheriting user data or credentials', () => {
  const systemRoot = 'C:\\Windows';
  const options = actualOptions({ PATH: process.env.PATH, SystemRoot: systemRoot, HOME: '/caller-home', USERPROFILE: '/caller-profile',
    TMPDIR: '/caller-tmp', TEST_API_KEY: 'caller-key', GH_TOKEN: 'caller-token', NODE_OPTIONS: '--invalid' });
  assert.deepEqual(options.env, { PATH: process.env.PATH, SystemRoot: systemRoot, TEST_API_KEY: 'synthetic-not-a-key' });
  const c = provisionCiEvidence(options);
  assert.equal(c.env.SystemRoot, systemRoot); assert.equal(c.env.TEST_API_KEY, undefined); assert.equal(c.env.GH_TOKEN, undefined);
  assert.equal(c.env.NODE_OPTIONS, undefined); assert.equal(c.env.HOME, path.join(options.evidenceRoot, 'synthetic-home'));
  assert.equal(c.env.TMPDIR, path.join(options.evidenceRoot, 'tmp')); assert.equal(c.cleanup, 'keep'); assert.equal(c.deletionEnabled, false);
});
test('regression caller preserves the full npm command and records a real isolated micro-child result', async () => {
  const options = actualOptions(), previousHome = process.env.HOME; let tools = 0;
  const result = await runRegression(options, {
    assertToolchain() { tools++; assert.equal(process.env.HOME, path.join(options.evidenceRoot, 'synthetic-home')); assert.equal(process.env.TEST_API_KEY, undefined); },
    async run(label, command, args, execution) {
      assert.equal(label, 'Ordinary CI original full suite'); assert.equal(command, 'bash'); assert.deepEqual(args, ['-c', 'exec npm test']);
      const out = await run('CI synthetic environment probe', process.execPath, ['-e', 'console.log(JSON.stringify({home:process.env.HOME,tmp:process.env.TMPDIR,key:process.env.TEST_API_KEY??null,systemRoot:process.env.SystemRoot??null,randomBytes:require("node:crypto").randomBytes(32).length}))'], { ...execution, cwd: execution.env.HOME });
      assert.deepEqual(JSON.parse(out), { home: execution.env.HOME, tmp: execution.env.TMPDIR, key: null,
        systemRoot: options.env.SystemRoot ?? null, randomBytes: 32 });
    }
  });
  assert.equal(tools, 1); assert.equal(result.cleanup, 'keep'); assert.equal(process.env.HOME, previousHome);
  assert(fs.existsSync(path.join(result.output, 'tests.log.result.json')));
});
test('toolchain failure stops before npm and retains its output', async () => {
  const options = actualOptions(); let commands = 0;
  await assert.rejects(() => runRegression(options, { assertToolchain() { throw Error('synthetic tool mismatch'); }, run() { commands++; } }), /tool mismatch/);
  assert.equal(commands, 0); assert(fs.existsSync(options.output));
});
test('Core caller keeps native/lock/hydration/build/search gates and passes private env to every command', async () => {
  const options = actualOptions(), core = path.join(options.evidenceRoot, 'synthetic-core-not-read'), seen = [];
  const commit = fs.readFileSync(path.join(ROOT, 'src-tauri/binaries/SIDECAR_COMMIT'), 'utf8').trim();
  const version = fs.readFileSync(path.join(ROOT, 'src-tauri/binaries/SIDECAR_VERSION'), 'utf8').trim();
  await corePlatformSmoke({ ...options, core }, {
    nativeTarget: () => 'x86_64-apple-darwin', platform: 'darwin', arch: 'x64',
    sync(command, args, execution) { assert.equal(execution.env.HOME, process.env.HOME); assert.equal(execution.cwd, core); seen.push(args[0]); return args[0] === 'rev-parse' ? commit : ''; },
    readJson: () => ({ version }),
    spawnSync(command, args, execution) { assert.equal(command, '/usr/sbin/sysctl'); assert.deepEqual(args, ['-n', 'sysctl.proc_translated']); assert.equal(execution.env.HOME, process.env.HOME); seen.push('native'); return { status: 0, stdout: '0\n' }; },
    async hydrateCore(c) { assert.equal(c.env.HOME, process.env.HOME); assert.equal(c.target, 'x86_64-apple-darwin'); seen.push('hydrate'); },
    async run(_label, command, args, execution) { assert.equal(execution.env.HOME, process.env.HOME); if (command === 'bash') assert.deepEqual(args, ['-c', 'exec npm run build']); else assert(args[0].endsWith('core-search-smoke.mjs')); seen.push(command === 'bash' ? 'build' : 'search'); }
  });
  assert.deepEqual(seen, ['rev-parse', 'native', 'hydrate', 'build', 'search', 'status']);
});
test('wrong Core revision is rejected before hydration or build', async () => {
  const options = actualOptions(); let work = 0;
  await assert.rejects(() => corePlatformSmoke({ ...options, core: path.join(options.evidenceRoot, 'not-read') }, {
    sync: () => 'f'.repeat(40), hydrateCore: async () => { work++; }, run: async () => { work++; }
  }));
  assert.equal(work, 0); assert(fs.existsSync(options.output));
});
test('CLI entries refuse missing root before tools or output creation', () => {
  const outer = candidateEvidence(), output = path.join(outer.fixture('ci-missing-root'), 'absent');
  const env = { ...outer.environment() }; delete env.CANDIDATE_EVIDENCE_ROOT; delete env.HARA_WRAPPER_EVIDENCE_ROOT;
  for (const [file, args] of [['ci-regression.mjs', [output]], ['ci-core-platform.mjs', [path.join(path.dirname(output), 'not-read'), output]]]) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', file), ...args], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /explicit canonical CI evidence path/); assert(!fs.existsSync(output));
  }
});
