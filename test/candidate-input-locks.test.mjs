import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { INPUT, ROOT } from '../scripts/candidate-common.mjs';
import path from 'node:path';
import vm from 'node:vm';

const read = file => fs.readFileSync(path.join(ROOT, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('candidate Core identity exactly matches the committed sidecar, not an earlier plan', () => {
  const commit = read('src-tauri/binaries/SIDECAR_COMMIT').toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(INPUT.core.commit, commit);
  assert.match(INPUT.core.tree, /^[a-f0-9]{40}$/);
  assert.equal(INPUT.core.version, read('src-tauri/binaries/SIDECAR_VERSION').toString().trim());
  assert.equal(INPUT.desktop.version, JSON.parse(read('package.json')).version);
  // The application source is frozen independently; orchestration adds its binding afterwards.
  // Requiring INPUT.desktop.commit === HEAD here would create an impossible self-reference.
  assert.match(INPUT.desktop.commit, /^[a-f0-9]{40}$/);
  assert.match(INPUT.desktop.tree, /^[a-f0-9]{40}$/);
});

test('candidate lock hashes are hashes of the exact committed lock bytes, including the sidecar newline', () => {
  for (const [file, field] of [['package-lock.json', 'npm'], ['src-tauri/Cargo.lock', 'cargo'], ['src-tauri/binaries/SIDECAR_COMMIT', 'sidecar']]) {
    assert.equal(INPUT.locks[field], hash(read(file)), `${field} candidate lock drift`);
  }
});

test('candidate versions and updater public-key identity stay bound without reading signing keys', () => {
  for (const tool of ['node', 'bun', 'rust']) assert.equal(INPUT.toolchain[tool], read(`.${tool}-version`).toString().trim());
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(INPUT.updaterPublicKeySha256, hash(config.plugins.updater.pubkey));
  assert.equal(config.version, INPUT.desktop.version);
});

const APPROVED_APP = { commit: '8c17541091f3febf8225b173743f49b7a3c75679', tree: '880c09a484d80b42b909c69dfd51e632f3fb88bb', version: '1.1.0' };
const APPROVED_CORE = { commit: 'b11009bdcafd2367cd587a47c665dea260d69df4', tree: '302e8a288218ab0a4ec52d8ce8d88a43522cb9fb', version: '1.0.2' };
const JOBS = ['admission', 'credential_preflight', 'native_build', 'sign_apps', 'native_dmg', 'sign_payloads', 'native_verify'];
const MATRIX_JOBS = ['native_build', 'native_dmg', 'native_verify'];
const workflowText = () => read('.github/workflows/candidate.yml').toString('utf8');
function sections(text = workflowText()) {
  const found = [...text.matchAll(/^  ([a-z][a-z_]+):\n/gm)].filter(row => row.index > text.indexOf('\njobs:\n'));
  assert.deepEqual(found.map(row => row[1]), JOBS);
  return Object.fromEntries(found.map((row, index) => [row[1], text.slice(row.index, found[index + 1]?.index ?? text.length)]));
}
function provisionCode(section) {
  const match = section.match(/          node --input-type=module <<'NODE'\n([\s\S]*?)          NODE\n/);
  assert(match, 'each job must contain its explicit provision program');
  return match[1].split('\n').filter(Boolean).map(line => {
    assert(line.startsWith('          '), 'workflow program indentation'); return line.slice(10);
  }).join('\n');
}
function checkSources(text) {
  const checkouts = text.split(/^      - uses: /m).filter(step => step.startsWith('actions/checkout@'));
  for (const [directory, source, count] of [['app', APPROVED_APP, 6], ['core', APPROVED_CORE, 6]]) {
    const rows = checkouts.filter(step => new RegExp('\\bpath: ' + directory + '(?:[,\\s}])').test(step));
    assert.equal(rows.length, count);
    for (const row of rows) assert.equal(row.match(/\bref: ([a-f0-9]{40})\b/)?.[1], source.commit, 'stale checkout');
  }
  const orchestration = checkouts.filter(step => /\bpath: orchestration(?:[,\s}])/.test(step));
  assert.equal(orchestration.length, 7);
  for (const row of orchestration) assert.match(row, /ref: ['"]?\$\{\{ github\.sha \}\}['"]?/);
}
test('orchestration binds exact reviewed application and Core without a self pin', () => {
  assert.deepEqual(INPUT.desktop, APPROVED_APP); assert.deepEqual(INPUT.core, APPROVED_CORE);
  assert(!/5d670cc268b6eef6491ca2f2ad47a93ab92efe4b|000f0ae41f29945daa07176af0b035ba5f2809e7|86e3d21e4df3bc0845d74db027094a4bdfa978ee|96eb3d18a2ff7c0e6d9150c4037ccfaedcdd26b5|f9825bb629521d84aa947bedf5cdf267a950989c|9f70796c6bf1cafb109b6280acb43f02d82922a8/.test(read('candidate-inputs.json')));
  checkSources(workflowText());
});
for (const commit of [APPROVED_APP.commit, APPROVED_CORE.commit]) {
  for (let occurrence = 0; occurrence < 6; occurrence++) {
    test('checkout mutation rejected: ' + (commit === APPROVED_APP.commit ? 'application' : 'Core') + ' phase ' + occurrence, () => {
      const text = workflowText(), occurrences = [...text.matchAll(new RegExp('ref: ' + commit, 'g'))];
      assert.equal(occurrences.length, 6);
      const start = occurrences[occurrence].index + 'ref: '.length;
      assert.throws(() => checkSources(text.slice(0, start) + 'a'.repeat(40) + text.slice(start + 40)), /stale checkout/);
    });
  }
}
for (const retired of ['5d670cc268b6eef6491ca2f2ad47a93ab92efe4b', '86e3d21e4df3bc0845d74db027094a4bdfa978ee', 'f9825bb629521d84aa947bedf5cdf267a950989c']) {
  test('retired application checkout cannot authorize the new source: ' + retired, () => {
    const changed = workflowText().replaceAll('ref: ' + APPROVED_APP.commit, 'ref: ' + retired);
    assert.throws(() => checkSources(changed), /stale checkout/);
  });
}
test('seven jobs provision explicit run/attempt/job/target roots before candidate commands', () => {
  const programs = [];
  for (const [job, section] of Object.entries(sections())) {
    const target = MATRIX_JOBS.includes(job) ? '$' + '{{ matrix.target }}' : 'controller';
    const root = 'CANDIDATE_EVIDENCE_ROOT: $' + '{{ github.workspace }}/candidate-evidence/$' + '{{ github.run_id }}/$' + '{{ github.run_attempt }}/' + job + '/' + target;
    assert(section.includes(root)); assert(section.includes('CANDIDATE_EVIDENCE_TARGET: ' + target));
    assert.equal((section.match(/id: evidence/g) ?? []).length, 1);
    const program = provisionCode(section); programs.push(program);
    const firstCommand = [...section.matchAll(/node scripts\/candidate-(?:admission|operator-config|native|signing)/g)][0]?.index;
    assert(Number.isInteger(firstCommand) && firstCommand > section.indexOf('          NODE\n'));
  }
  assert.equal(new Set(programs).size, 1, 'all jobs must use the same audited inline program');
});
test('artifacts follow provision output without implicit temp or cleanup; platform and permission gates remain', () => {
  const text = workflowText();
  assert.equal((text.match(/\$\{\{ steps\.evidence\.outputs\.output \}\}/g) ?? []).length, 13);
  assert(!/runner\.temp|RUNNER_TEMP|os\.tmpdir|mkdtemp|\brm\s+-|\.rmSync\s*\(|\.rmdirSync\s*\(/.test(text));
  assert.equal((text.match(/os: macos-15-intel/g) ?? []).length, 3);
  assert(!/contents: write|actions: write|packages: write|id-token: write|secrets\.|gh release|git push|ossutil|stable\/latest/.test(text));
});
const PROGRAM = new vm.Script(provisionCode(sections().admission).replace(/^import .+;$/gm, ''), { filename: 'inline-evidence-provision' });
function virtualJob({ paths = path.posix, workspace = '/workspace/repo', accountHome = '/account', target = 'controller', job = 'admission' } = {}) {
  let inode = 100n, calls = 0;
  const rows = new Map(), writes = [], appended = new Map();
  const root = paths.join(workspace, 'candidate-evidence', '123', '2', job, target);
  const commandFiles = [paths.join(workspace, 'runner-env'), paths.join(workspace, 'runner-output')];
  function add(value, type = 'directory') {
    const row = { dev: 1n, ino: inode++, uid: 7n, mode: 0o700n, nlink: 1n, type };
    rows.set(value, row); return row;
  }
  add(workspace); for (const file of commandFiles) add(file, 'file');
  const env = { GITHUB_WORKSPACE: workspace, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: job,
    CANDIDATE_EVIDENCE_ROOT: root, CANDIDATE_EVIDENCE_TARGET: target, GITHUB_ENV: commandFiles[0], GITHUB_OUTPUT: commandFiles[1],
    HOME: '/inherited-user', TMPDIR: '/inherited-temp' };
  const io = {
    lstatSync(value) {
      calls++; if (!rows.has(value)) throw Object.assign(Error('missing virtual path'), { code: 'ENOENT' });
      const row = rows.get(value);
      return { ...row, isDirectory: () => row.type === 'directory', isFile: () => row.type === 'file', isSymbolicLink: () => row.type === 'symlink' };
    },
    realpathSync(value) { calls++; assert(rows.has(value), 'missing virtual realpath'); return rows.get(value).alias ?? value; },
    mkdirSync(value, options) {
      if (rows.has(value)) throw Object.assign(Error('already retained'), { code: 'EEXIST' });
      assert.equal(options.mode, 0o700); writes.push(value); add(value);
    },
    appendFileSync(file, bytes) { assert(commandFiles.includes(file), 'only runner command files may be appended'); appended.set(file, (appended.get(file) ?? '') + bytes); }
  };
  const execute = () => PROGRAM.runInNewContext({ assert, fs: io, os: { userInfo: () => ({ homedir: accountHome }) }, path: paths, process: { env, getuid: () => 7 } });
  const exported = () => Object.fromEntries((appended.get(commandFiles[0]) ?? '').trim().split('\n').filter(Boolean).map(line => {
    const equals = line.indexOf('='); return [line.slice(0, equals), line.slice(equals + 1)];
  }));
  return { env, io, rows, add, root, workspace, paths, commandFiles, writes, appended, execute, exported, calls: () => calls };
}
for (const [label, options] of [['POSIX', {}], ['Windows', { paths: path.win32, workspace: 'D:\\work\\repo', accountHome: 'C:\\Users\\fixture', target: 'x86_64-pc-windows-msvc', job: 'native_build' }]]) {
  test('explicit ' + label + ' provision binds both private roots and retains evidence', () => {
    const v = virtualJob(options); v.execute();
    const e = v.exported(), home = v.paths.join(v.root, 'synthetic-home'), tmp = v.paths.join(v.root, 'tmp');
    assert.equal(e.CANDIDATE_EVIDENCE_ROOT, v.root); assert.equal(e.HARA_WRAPPER_EVIDENCE_ROOT, v.root);
    for (const key of ['HOME', 'USERPROFILE', 'CFFIXED_USER_HOME']) assert.equal(e[key], home);
    assert.equal(e.HARA_HOME, v.paths.join(home, '.hara'));
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(e[key], tmp);
    assert.equal(e.CANDIDATE_OUTPUT_DIR, v.paths.join(tmp, 'output'));
    assert.deepEqual(Object.keys(e).slice(-2), ['HOME', 'TMPDIR']);
    assert(v.rows.has(home) && v.rows.has(tmp) && v.rows.has(e.CANDIDATE_OUTPUT_DIR));
    assert(v.appended.get(v.commandFiles[1]).includes('output=' + e.CANDIDATE_OUTPUT_DIR));
  });
}
test('Windows mixed workflow separators normalize without a different-drive fallback', () => {
  const v = virtualJob({ paths: path.win32, workspace: 'D:\\work\\repo', accountHome: 'C:\\Users\\fixture' });
  v.env.CANDIDATE_EVIDENCE_ROOT = v.root.replaceAll('\\', '/'); v.execute();
  assert.equal(v.exported().CANDIDATE_EVIDENCE_ROOT, v.root);
});
for (const key of ['CANDIDATE_EVIDENCE_ROOT', 'GITHUB_WORKSPACE', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'CANDIDATE_EVIDENCE_TARGET', 'GITHUB_ENV', 'GITHUB_OUTPUT']) {
  test('missing ' + key + ' has no filesystem calls or fallback', () => {
    const v = virtualJob(); delete v.env[key]; assert.throws(v.execute, /missing or invalid/);
    assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
for (const root of ['/tmp/run', '/private/tmp/run', '/var/folders/run', '/private/var/folders/run', '/account/Library/Caches/run', '/account/.hara', '/account/.hara/run', 'relative', '/workspace/repo/../elsewhere']) {
  test('forbidden root ' + root + ' is lexical only', () => {
    const v = virtualJob(); v.env.CANDIDATE_EVIDENCE_ROOT = root; assert.throws(v.execute, /forbidden|absolute evidence/);
    assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
test('workspace under account .hara-runners is not a forbidden evidence prefix false positive', () => {
  const workspace = '/account/.hara-runners/hara-desktop-release/_work/hara-desktop/hara-desktop';
  const v = virtualJob({ workspace });
  v.execute();
  assert.equal(v.exported().CANDIDATE_EVIDENCE_ROOT, v.root);
  assert(v.root.startsWith(workspace + '/'));
});
for (const [key, value] of [['GITHUB_RUN_ID', '0'], ['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_JOB', '../job'], ['CANDIDATE_EVIDENCE_TARGET', 'other']]) {
  test('invalid identity ' + key + ' is rejected before filesystem access', () => {
    const v = virtualJob(); v.env[key] = value; assert.throws(v.execute, /invalid/);
    assert.equal(v.calls(), 0); assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
for (const [label, change] of [
  ['foreign run', v => v.env.GITHUB_RUN_ID = '124'], ['foreign attempt', v => v.env.GITHUB_RUN_ATTEMPT = '3'],
  ['foreign job', v => v.env.GITHUB_JOB = 'native_build'], ['foreign target', v => v.env.CANDIDATE_EVIDENCE_TARGET = 'aarch64-apple-darwin'],
  ['different workspace', v => { v.env.GITHUB_WORKSPACE = '/workspace/other'; v.add('/workspace/other'); }]
]) {
  test('root for a ' + label + ' is rejected before directory creation', () => {
    const v = virtualJob(); change(v); assert.throws(v.execute, /exact workspace/);
    assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
test('existing job/attempt leaves are retained and refused instead of reused', () => {
  const v = virtualJob(), kept = v.add(v.root); v.rows.set(v.root + '/sentinel', { type: 'file' });
  assert.throws(v.execute, /already retained/); assert.equal(v.rows.get(v.root), kept);
  assert(v.rows.has(v.root + '/sentinel')); assert.equal(v.appended.size, 0);
});
for (const [label, change] of [
  ['link', row => row.type = 'symlink'], ['foreign owner', row => row.uid = 8n], ['group writable', row => row.mode = 0o770n],
  ['realpath alias', row => row.alias = '/outside']
]) {
  test('unsafe evidence parent ' + label + ' has no child creation', () => {
    const v = virtualJob(), parent = v.paths.join(v.workspace, 'candidate-evidence'); change(v.add(parent));
    assert.throws(v.execute); assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
for (const [label, change] of [
  ['link', row => row.type = 'symlink'], ['hardlink', row => row.nlink = 2n], ['foreign owner', row => row.uid = 8n]
]) {
  test('unsafe runner command file ' + label + ' fails before evidence creation', () => {
    const v = virtualJob(); change(v.rows.get(v.commandFiles[0])); assert.throws(v.execute);
    assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
  });
}
test('workspace aliases never provision or publish paths', () => {
  const v = virtualJob(); v.rows.get(v.workspace).alias = '/other'; assert.throws(v.execute, /workspace alias/);
  assert.equal(v.writes.length, 0); assert.equal(v.appended.size, 0);
});
test('changed directory identity before binding fails and retains created evidence', () => {
  const v = virtualJob(), output = v.paths.join(v.root, 'tmp', 'output'), original = v.io.lstatSync;
  let reads = 0;
  v.io.lstatSync = value => { if (value === output && ++reads === 3) v.rows.get(value).ino++; return original(value); };
  assert.throws(v.execute, /identity changed/); assert.equal(v.appended.size, 0);
  assert(v.rows.has(output) && v.rows.has(v.paths.join(v.root, 'synthetic-home')));
});
