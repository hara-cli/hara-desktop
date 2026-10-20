// Shared candidate build/verification primitives. No publication API is implemented here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INPUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'candidate-inputs.json')));
export const TARGETS = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu', 'x86_64-pc-windows-msvc'];
export const realHome = os.homedir();
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHash = file => hash(fs.readFileSync(file));
export const readJson = file => JSON.parse(fs.readFileSync(file));
export const identity = hash(JSON.stringify(INPUT));
export function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const next = file + '.next', fd = fs.openSync(next, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(next, file);
}
export function sync(command, args, { cwd = ROOT, env = process.env, timeout = 120000 } = {}) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  assert(r.status === 0 && !r.error, `candidate command failed: ${path.basename(command)} (${r.status ?? 'unknown'})`);
  return r.stdout.trim();
}
export async function run(label, command, args, { cwd = ROOT, env = process.env, timeout = 60 * 60000, capture = false } = {}) {
  console.log(`candidate phase: ${label}`);
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', failed = false;
  const consume = bytes => {
    if (capture) { output += bytes.toString(); if (output.length > 8 * 1024 * 1024) { failed = true; child.kill(); } }
    else process.stdout.write(bytes);
  };
  child.stdout.on('data', consume); child.stderr.on('data', capture ? consume : bytes => process.stderr.write(bytes));
  const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, timeout);
  const pulse = setInterval(() => console.log(`candidate phase still running: ${label}`), 30000);
  const code = await new Promise(resolve => { child.once('error', () => { failed = true; }); child.once('close', resolve); });
  clearTimeout(timer); clearInterval(pulse);
  assert(code === 0 && !failed, `candidate phase failed: ${label}`); return output;
}
export function assertEvent(e) {
  assert.equal(e.GITHUB_ACTIONS, 'true'); assert.equal(e.GITHUB_REPOSITORY, 'hara-cli/hara-desktop');
  assert.equal(e.GITHUB_EVENT_NAME, 'push'); assert.equal(e.GITHUB_REF, INPUT.controlledRef);
  assert.equal(e.GITHUB_REF_PROTECTED, 'true'); assert.equal(String(e.GITHUB_ACTOR_ID), String(INPUT.approverId));
  assert.match(e.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/); assert.equal(e.GITHUB_WORKFLOW_SHA, e.GITHUB_SHA);
  assert.equal(e.GITHUB_WORKFLOW_REF, `hara-cli/hara-desktop/.github/workflows/candidate.yml@${INPUT.controlledRef}`);
  assert.match(e.GITHUB_RUN_ID ?? '', /^\d+$/); assert.match(e.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
}
export function nativeTarget(platform = process.platform, arch = process.arch) {
  const t = platform === 'darwin' ? `${arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : 'unsupported'}-apple-darwin`
    : platform === 'linux' && arch === 'x64' ? 'x86_64-unknown-linux-gnu'
      : platform === 'win32' && arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'unsupported';
  assert(TARGETS.includes(t), 'candidate requires a supported native architecture'); return t;
}
export function privateEnvironment(home, extra = {}) {
  assert(path.isAbsolute(home) && home !== realHome, 'private runtime HOME required');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(home, 'tmp'), { recursive: true, mode: 0o700 });
  // Core's scoped Unix socket deliberately rejects paths over 100 bytes. Keep the private
  // test temp short, even when RUNNER_TEMP/HOME are deeply nested, without relaxing that fence.
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : process.platform === 'linux' ? '/tmp' : os.tmpdir(), 'hc-')));
  fs.chmodSync(temp, 0o700);
  const env = { ...process.env, RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(realHome, '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME ?? path.join(realHome, '.cargo'),
    HOME: home, USERPROFILE: home, CFFIXED_USER_HOME: home, HARA_HOME: path.join(home, '.hara'),
    TMPDIR: temp, TMP: temp, TEMP: temp,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
    NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', ...extra };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|SECRET|CREDENTIAL|^APPLE_|^AWS_|^ALIYUN_)/i.test(key)) delete env[key];
    if (/^HARA_/.test(key) && !['HARA_HOME', ...Object.keys(extra)].includes(key)) delete env[key];
  }
  return env;
}
export function sourceDirectories() {
  const desktop = path.resolve(process.env.CANDIDATE_DESKTOP_DIR ?? path.join(ROOT, '../app'));
  const core = path.resolve(process.env.CANDIDATE_CORE_DIR ?? path.join(ROOT, '../core'));
  assert(desktop !== core && desktop !== ROOT && core !== ROOT, 'application/Core/orchestration roots must be distinct');
  return { desktop, core };
}
export function assertSources(desktop, core) {
  for (const [directory, part] of [[desktop, INPUT.desktop], [core, INPUT.core]]) {
    assert.equal(sync('git', ['rev-parse', 'HEAD'], { cwd: directory }), part.commit);
    assert.equal(sync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: directory }), part.tree);
    assert.equal(sync('git', ['status', '--porcelain'], { cwd: directory }), '');
    assert.equal(readJson(path.join(directory, 'package.json')).version, part.version);
  }
  const read = file => fs.readFileSync(path.join(desktop, file));
  for (const [file, key] of [['package-lock.json', 'npm'], ['src-tauri/Cargo.lock', 'cargo'], ['src-tauri/binaries/SIDECAR_COMMIT', 'sidecar']])
    assert.equal(hash(read(file)), INPUT.locks[key]);
  assert.equal(fileHash(path.join(core, 'package-lock.json')), INPUT.locks.coreNpm);
  assert.equal(read('src-tauri/binaries/SIDECAR_COMMIT').toString().trim(), INPUT.core.commit);
  assert.equal(read('src-tauri/binaries/SIDECAR_VERSION').toString().trim(), INPUT.core.version);
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(hash(config.plugins.updater.pubkey), INPUT.updaterPublicKeySha256);
  assert.equal(hash(readJson(path.join(ROOT, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey), INPUT.updaterPublicKeySha256);
  assert.equal(fileHash(path.join(desktop, 'src-tauri/examples/verify_updater_signature.rs')), fileHash(path.join(ROOT, 'src-tauri/examples/verify_updater_signature.rs')), 'early key verifier must share exact formal code');
  assert.deepEqual(config.bundle.externalBin, ['binaries/hara', 'binaries/herdr']);
  const lock = readJson(path.join(core, 'package-lock.json'));
  assert(!Object.keys(lock.packages).some(k => /(?:node_modules\/)(?:@anthropic-ai\/claude-agent-sdk|opencode-(?:darwin|linux|windows)-)/.test(k)), 'optional coding engines cannot be hydrated');
  for (const [tool, version] of Object.entries(INPUT.toolchain)) assert.equal(read(`.${tool}-version`).toString().trim(), version);
  return { identity, desktop: INPUT.desktop, core: INPUT.core };
}
export function assertNoRosettaProbe(result) {
  if (result.status === 0) assert.equal(result.stdout.trim(), '0', 'Rosetta cannot provide native Intel evidence');
  else assert(result.status === 1 && /^sysctl: unknown oid ['"]sysctl\.proc_translated['"]\s*$/.test(result.stderr), 'native Intel probe unavailable');
}
export function assertToolchain() {
  assert.equal(process.versions.node, INPUT.toolchain.node);
  assert.equal(sync('bun', ['--version']), INPUT.toolchain.bun);
  assert.equal(sync('rustc', ['--version']).split(/\s+/)[1], INPUT.toolchain.rust);
  assert.equal(sync('rustc', ['-vV']).match(/^host: (.+)$/m)?.[1], nativeTarget());
  if (process.platform === 'darwin' && process.arch === 'x64') assertNoRosettaProbe(spawnSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { encoding:'utf8', timeout:10000 }));
}
export async function verifyUpdater(c, file, label) {
  // Use the exact application's verifier, in its private HOME, not the orchestration Cargo tree.
  const module = pathToFileURL(path.join(c.desktop, 'scripts/updater-signature.mjs')).href;
  await run(label, process.execPath, ['--input-type=module', '-e', 'const {verifyUpdaterArtifactSignature:v}=await import(process.argv[1]);v(process.argv[2],process.argv[2]+".sig",process.argv[3]);', module, file, label], { cwd: c.desktop, env: c.env, timeout: 15 * 60000 });
}
export function context() {
  assertEvent(process.env); assertToolchain();
  const { desktop, core } = sourceDirectories(); assertSources(desktop, core);
  const base = path.resolve(process.env.CANDIDATE_OUTPUT_DIR ?? path.join(process.env.RUNNER_TEMP, `hara-candidate-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`));
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  return { desktop, core, base, target: nativeTarget(), env: privateEnvironment(path.join(base, 'private-home')) };
}
export function receipt(extra = {}) {
  return { schema: 2, identity, application: INPUT.desktop.commit, core: INPUT.core.commit,
    orchestration: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    createdAt: new Date().toISOString(), ...extra };
}
export function assertReceipt(r, expected = { orchestration: process.env.GITHUB_SHA, runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) }) {
  assert.equal(r.schema, 2); assert.equal(r.identity, identity);
  assert.equal(r.application, INPUT.desktop.commit); assert.equal(r.core, INPUT.core.commit);
  assert.equal(r.orchestration, expected.orchestration);
  assert.equal(r.runId, expected.runId); assert.equal(r.attempt, expected.attempt);
}
export function restoreBuildBinaries(c, directory, r) {
  assertReceipt(r); assert.equal(r.phase, 'unsigned'); assert.equal(r.target, c.target);
  // tauri-build requires externalBin even for the formal Rust signature-verifier example.
  // Reuse the genuine native compiler outputs; never create placeholders or rebuild other bytes.
  for (const name of ['hara', 'herdr']) {
    const record = r.buildBinaries?.[name]; assert(record); assert.equal(record.name, `${name}-native${c.target.endsWith('msvc') ? '.exe' : ''}`);
    const input = path.join(directory, record.name); const st = fs.lstatSync(input); assert(st.isFile() && !st.isSymbolicLink());
    assert.equal(st.size, record.size); assert.equal(fileHash(input), record.sha256);
    const destination = path.join(c.desktop, 'src-tauri/binaries', `${name}-${c.target}${c.target.endsWith('msvc') ? '.exe' : ''}`);
    fs.copyFileSync(input, destination); fs.chmodSync(destination, 0o755);
  }
}
export function checkArchiveEntries(text) {
  const entries = text.trim().split(/\r?\n/); assert(entries.length > 0 && entries.length < 100000);
  for (const entry of entries) assert(entry && !entry.includes('\\') && !entry.startsWith('/') && !entry.split('/').includes('..'), 'unsafe candidate archive entry');
  return entries;
}
export function artifactName(phase, target, e = { runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }) {
  assert(/^[a-z][a-z-]{0,40}$/.test(phase)); assert(target === 'all' || TARGETS.includes(target));
  return `candidate-${phase}-${target}-${e.runId}-${e.attempt}`;
}
export function api(endpoint) {
  assert(/^repos\/hara-cli\/hara-desktop\/actions\/(?:runs|artifacts)\//.test(endpoint), 'candidate API is read-only and Actions-scoped');
  return JSON.parse(sync('gh', ['api', '--method', 'GET', endpoint]));
}
export async function downloadArtifact(phase, target, directory, e = { runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT), orchestration: process.env.GITHUB_SHA }) {
  assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert(Number.isSafeInteger(e.runId) && e.runId > 0 && Number.isSafeInteger(e.attempt) && e.attempt > 0); assert.match(e.orchestration, /^[a-f0-9]{40}$/);
  const expectedName = artifactName(phase, target, e), rows = []; let page = 1;
  for (; page <= 20; page++) {
    const response = api(`repos/hara-cli/hara-desktop/actions/runs/${e.runId}/artifacts?per_page=100&page=${page}`);
    rows.push(...response.artifacts); if (response.artifacts.length < 100) break;
  }
  assert(page <= 20); const matches = rows.filter(r => r.name === expectedName); assert.equal(matches.length, 1);
  const a = matches[0]; assert.equal(a.expired, false); assert.equal(a.workflow_run.id, e.runId);
  assert.equal(a.workflow_run.head_sha, e.orchestration); assert.match(a.digest, /^sha256:[a-f0-9]{64}$/);
  const zip = directory + '.zip', output = fs.createWriteStream(zip, { flags: 'wx', mode: 0o600 });
  const sha = createHash('sha256'); let size = 0;
  const child = spawn('gh', ['api', '--method', 'GET', `repos/hara-cli/hara-desktop/actions/artifacts/${a.id}/zip`], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { sha.update(b); size += b.length; }); child.stdout.pipe(output); child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('artifact download failed'))); });
  const finished = new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); });
  child.once('error', e => output.destroy(e)); output.once('error', () => child.kill('SIGKILL'));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60000);
  try { await Promise.all([closed, finished]); } finally { clearTimeout(timer); child.kill(); output.destroy(); }
  assert.equal(size, a.size_in_bytes); assert.equal(`sha256:${sha.digest('hex')}`, a.digest);
  // Outer ZIPs are upload-artifact's flat envelopes only; links cannot become extraction parents.
  const names = checkArchiveEntries(sync('unzip', ['-Z1', zip])); assert(names.every(n => /^[A-Za-z0-9_.-]+$/.test(n)), 'artifact envelope must be flat');
  sync('unzip', ['-q', zip, '-d', directory]);
  for (const name of names) { const st = fs.lstatSync(path.join(directory, name)); assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, 'artifact envelope links forbidden'); }
  save(path.join(directory, 'transport-evidence.json'), { id: a.id, name: a.name, size, sha256: a.digest.slice(7), runId: e.runId, attempt: e.attempt });
  return directory;
}
