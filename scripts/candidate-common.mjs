// Shared candidate build/verification primitives. No publication API is implemented here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gateEvidence } from './candidate-upgrade.mjs';
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INPUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'candidate-inputs.json')));
export const TARGETS = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu', 'x86_64-pc-windows-msvc'];
export const realHome = os.userInfo().homedir;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHash = file => hash(fs.readFileSync(file));
export const readJson = file => JSON.parse(fs.readFileSync(file));
export const identity = hash(JSON.stringify(INPUT));
// Consume the caller's provisioned evidence binding; never allocate a system temp root.
export function candidateEvidence(env = process.env) {
  return gateEvidence(env?.CANDIDATE_EVIDENCE_ROOT ?? env?.HARA_WRAPPER_EVIDENCE_ROOT, { env });
}
function commandEvidence(source) {
  const scope = candidateEvidence(source), env = scope.environment();
  scope.assertEnvironment(env);
  return { scope, env };
}
function ensureEvidenceDirectory(scope, directory) {
  scope.checked(directory, { missing: true, directory: true });
  if (!fs.existsSync(directory)) {
    ensureEvidenceDirectory(scope, path.dirname(directory));
    scope.mkdir(directory);
  }
  scope.checked(directory, { directory: true });
  return directory;
}
export function save(file, value) {
  const { scope, env } = commandEvidence(process.env);
  return scope.guardSync(env, () => {
    scope.checked(file, { missing: true });
    ensureEvidenceDirectory(scope, path.dirname(file));
    const next = scope.checked(file + '.next', { missing: true }), fd = fs.openSync(next, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    scope.checked(next); scope.checked(file, { missing: true });
    fs.renameSync(next, file);
  });
}
export function sync(command, args, { cwd = ROOT, env = process.env, timeout = 120000 } = {}) {
  const checked = commandEvidence(env);
  return checked.scope.guardSync(checked.env, () => {
    const r = spawnSync(command, args, { cwd, env: checked.env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
    assert(r.status === 0 && !r.error, `candidate command failed: ${path.basename(command)} (${r.status ?? 'unknown'})`);
    return r.stdout.trim();
  });
}
export function redactDiagnosticOutput(text, env = {}) {
  let safe = text;
  for (const [key, value] of Object.entries(env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(key) && typeof value === 'string' && value.length >= 4)
      safe = safe.split(value).join('[REDACTED]');
  }
  return safe.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[REDACTED]');
}
export async function run(label, command, args, { cwd = ROOT, env = process.env, timeout = 60 * 60000, capture = false, logFile } = {}) {
  const checked = commandEvidence(env), { scope } = checked;
  return scope.guard(checked.env, async () => {
  assert(!logFile || (capture && path.isAbsolute(logFile)), 'diagnostic log requires captured output and an absolute private path');
  let logFd;
  if (logFile) {
    scope.checked(logFile, { missing: true }); scope.checked(logFile + '.result.json', { missing: true });
    assert(!fs.existsSync(logFile + '.result.json'), 'diagnostic result already exists; refuse replay');
    ensureEvidenceDirectory(scope, path.dirname(logFile)); logFd=fs.openSync(logFile,'wx',0o600);
  }
  try {
  console.log(`candidate phase: ${label}`);
  scope.assertEnvironment(checked.env);
  const child = spawn(command, args, { cwd, env: checked.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks=[]; let size=0, failureKind=null, spawnCode=null;
  const consume = bytes => {
    if (capture) {
      const remaining=8*1024*1024-size;
      if (remaining>0) { const part=bytes.subarray(0,remaining); chunks.push(part); size+=part.length; }
      if (bytes.length>remaining && !failureKind) { failureKind='output-limit'; child.kill(); }
    }
    else process.stdout.write(bytes);
  };
  child.stdout.on('data', consume); child.stderr.on('data', capture ? consume : bytes => process.stderr.write(bytes));
  const timer = setTimeout(() => { failureKind ??= 'timeout'; child.kill('SIGKILL'); }, timeout);
  const pulse = setInterval(() => console.log(`candidate phase still running: ${label}`), 30000);
  const [code,signal] = await new Promise(resolve => { child.once('error', error => { failureKind ??= 'spawn'; spawnCode=error.code??null; }); child.once('close', (code,signal)=>resolve([code,signal])); });
  clearTimeout(timer); clearInterval(pulse);
  const output=capture?Buffer.concat(chunks).toString('utf8'):'';
  // Child success is not entry success when the environment or directory anchors changed.
  scope.assertEnvironment(checked.env);
  if (logFd!==undefined) {
    // Do not persist a partial final line (which may be a partial credential) at the output bound.
    const diagnostic=failureKind==='output-limit'?output.slice(0,output.lastIndexOf('\n')+1):output;
    const safe=redactDiagnosticOutput(diagnostic,env);
    try { fs.writeFileSync(logFd,safe); fs.fsyncSync(logFd); } finally { fs.closeSync(logFd); logFd=undefined; }
    scope.checked(logFile + '.result.json', { missing: true });
    fs.writeFileSync(logFile+'.result.json',JSON.stringify({code,signal,spawnCode,failureKind,capturedBytes:size,complete:failureKind===null},null,2)+'\n',{flag:'wx',mode:0o600});
    if (code!==0 || failureKind || signal) process.stderr.write(safe.slice(-8192)+'\n');
  }
  assert(code === 0 && !failureKind && !signal, `candidate phase failed: ${label} (exit=${code}, signal=${signal??'none'}, reason=${failureKind??'exit'}${spawnCode?', spawn='+spawnCode:''})`);
  return output;
  } finally { if (logFd!==undefined) fs.closeSync(logFd); }
  });
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
  const scope = candidateEvidence();
  assert.equal(home, scope.home, 'HOME must be this evidence root synthetic-home');
  return scope.environment(extra);
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
  if (process.platform === 'darwin' && process.arch === 'x64') {
    const { scope, env } = commandEvidence(process.env);
    scope.guardSync(env, () => assertNoRosettaProbe(spawnSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { env, encoding:'utf8', timeout:10000 })));
  }
}
export async function verifyUpdater(c, file, label) {
  // Use the exact application's verifier, in its private HOME, not the orchestration Cargo tree.
  const module = pathToFileURL(path.join(c.desktop, 'scripts/updater-signature.mjs')).href;
  await run(label, process.execPath, ['--input-type=module', '-e', 'const {verifyUpdaterArtifactSignature:v}=await import(process.argv[1]);v(process.argv[2],process.argv[2]+".sig",process.argv[3]);', module, file, label], { cwd: c.desktop, env: c.env, timeout: 15 * 60000 });
}
export function contextPaths(env = process.env) {
  const scope = candidateEvidence(env);
  assert(typeof env.CANDIDATE_OUTPUT_DIR === 'string' && env.CANDIDATE_OUTPUT_DIR.length > 0, 'explicit candidate output directory required');
  const base = scope.checked(env.CANDIDATE_OUTPUT_DIR, { missing: true, directory: true });
  return { scope, base, env: scope.environment(), evidenceRoot: scope.root, cleanup: 'keep', deletionEnabled: false };
}
export function context() {
  // Reject bad bindings/paths before tool/source checks can spawn or create output.
  const { scope, base, env, evidenceRoot, cleanup, deletionEnabled } = contextPaths();
  assertEvent(process.env); assertToolchain();
  const { desktop, core } = sourceDirectories(); assertSources(desktop, core);
  scope.guardSync(env, () => ensureEvidenceDirectory(scope, base));
  return { desktop, core, base, target: nativeTarget(), env, evidenceRoot, cleanup, deletionEnabled };
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
// This capability is only for fixed read-only GitHub GETs (Actions api/downloadArtifact, admission policyGet).
// Generic sync/run/upgrade children keep the globally stripped environment.
export function githubReadEnvironment(parentEnv = process.env, label = 'candidate Actions') {
  const scope = candidateEvidence(parentEnv), clean = { ...scope.environment() };
  const token = parentEnv.GH_TOKEN || parentEnv.GITHUB_TOKEN;
  assert(typeof token === 'string' && token.length > 0 && token.length <= 4096 && !/[\s\0]/.test(token),
    `${label} GitHub token required`);
  // Caller gh routing/config must not redirect this credential outside GitHub/private HOME.
  for (const key of Object.keys(clean)) if (/^GH_(?:HOST|CONFIG_DIR)$/i.test(key)) delete clean[key];
  const env = Object.freeze({ ...clean, GH_TOKEN: token, GH_HOST: 'github.com',
    GH_CONFIG_DIR: path.join(clean.XDG_CONFIG_HOME, 'gh') });
  scope.assertEnvironment(env);
  return env;
}
export function api(endpoint) {
  assert(typeof endpoint === 'string' && /^repos\/hara-cli\/hara-desktop\/actions\/(?:runs|artifacts)\/[^\s]+$/.test(endpoint), 'candidate API is read-only and Actions-scoped');
  const scope = candidateEvidence(process.env), env = githubReadEnvironment(process.env);
  return scope.guardSync(env, () => {
    const r = spawnSync('gh', ['api', '--method', 'GET', endpoint], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    assert(r.status === 0 && !r.error && !r.signal, `candidate command failed: gh (${r.status ?? 'unknown'})`);
    try { return JSON.parse(r.stdout); }
    catch { throw Error('candidate Actions API: invalid GitHub response'); }
  });
}
export async function downloadArtifact(phase, target, directory, e = { runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT), orchestration: process.env.GITHUB_SHA }) {
  const { scope, env } = commandEvidence(process.env);
  return scope.guard(env, async () => {
  assert(Number.isSafeInteger(e.runId) && e.runId > 0 && Number.isSafeInteger(e.attempt) && e.attempt > 0); assert.match(e.orchestration, /^[a-f0-9]{40}$/);
  const expectedName = artifactName(phase, target, e), rows = []; let page = 1;
  scope.checked(directory, { missing: true, directory: true }); scope.checked(directory + '.zip', { missing: true });
  assert(!fs.existsSync(directory)); ensureEvidenceDirectory(scope, directory);
  for (; page <= 20; page++) {
    const response = api(`repos/hara-cli/hara-desktop/actions/runs/${e.runId}/artifacts?per_page=100&page=${page}`);
    rows.push(...response.artifacts); if (response.artifacts.length < 100) break;
  }
  assert(page <= 20); const matches = rows.filter(r => r.name === expectedName); assert.equal(matches.length, 1);
  const a = matches[0]; assert.equal(a.expired, false); assert.equal(a.workflow_run.id, e.runId);
  assert.equal(a.workflow_run.head_sha, e.orchestration); assert.match(a.digest, /^sha256:[a-f0-9]{64}$/);
  const zip = directory + '.zip', fd = fs.openSync(zip, 'wx', 0o600);
  const output = fs.createWriteStream(zip, { fd, autoClose: true });
  const sha = createHash('sha256'); let size = 0;
  assert(Number.isSafeInteger(a.id) && a.id > 0); const ghEnv = githubReadEnvironment(process.env);
  scope.assertEnvironment(env); scope.assertEnvironment(ghEnv);
  const child = spawn('gh', ['api', '--method', 'GET', `repos/hara-cli/hara-desktop/actions/artifacts/${a.id}/zip`], { cwd: ROOT, env: ghEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { sha.update(b); size += b.length; }); child.stdout.pipe(output); child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('artifact download failed'))); });
  const finished = new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject); });
  child.once('error', e => output.destroy(e)); output.once('error', () => child.kill('SIGKILL'));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60000);
  try { await Promise.all([closed, finished]); } finally { clearTimeout(timer); child.kill(); output.destroy(); scope.assertEnvironment(env); }
  assert.equal(size, a.size_in_bytes); assert.equal(`sha256:${sha.digest('hex')}`, a.digest);
  // Outer ZIPs are upload-artifact's flat envelopes only; links cannot become extraction parents.
  const names = checkArchiveEntries(sync('unzip', ['-Z1', zip])); assert(names.every(n => /^[A-Za-z0-9_.-]+$/.test(n)), 'artifact envelope must be flat');
  sync('unzip', ['-q', zip, '-d', directory]);
  for (const name of names) { const st = fs.lstatSync(path.join(directory, name)); assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, 'artifact envelope links forbidden'); }
  save(path.join(directory, 'transport-evidence.json'), { id: a.id, name: a.name, size, sha256: a.digest.slice(7), runId: e.runId, attempt: e.attempt });
  return directory;
  });
}
