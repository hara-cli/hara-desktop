// Controlled runner only. Consume native-built bytes; never compile another application's source.
// No Release/OSS/stable APIs; updater key stays the original read-only local file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, INPUT, TARGETS, identity, realHome, context, receipt, assertReceipt, readJson, save, saveRetainedNotary,
  sync, run, fileHash, downloadArtifact, verifyUpdater, restoreBuildBinaries } from './candidate-common.mjs';
import { readUpdaterKey, withUpdaterFile } from './with-updater-file.mjs';
import { validateTar, validateExtractedTree } from './candidate-archive.mjs';
import { runLocalTar } from './candidate-local-tar.mjs';
import { parseNotaryResponse } from './notarize-artifact.mjs';
import { readAdmission } from './candidate-admission.mjs';
import { candidateSigningConfiguration } from './candidate-operator-config.mjs';

const IDENTITY = 'Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)';
const mac = target => target.endsWith('apple-darwin');
// Every codesign/notarytool/stapler/spctl call keeps its redacted output in private evidence. run() writes it to
// logFile and, on failure, prints the last 8 KiB to the job log. Without a logFile the output was discarded,
// as in candidate run 42620309741 attempt 5, where a codesign failure left no reason anywhere.
let signingLogSequence = 0;
export function signingLogFile(directory, label) {
  assert(typeof directory === 'string' && path.isAbsolute(directory), 'signing diagnostics need an absolute private evidence directory');
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return path.join(directory, `${String(++signingLogSequence).padStart(3, '0')}-${slug}-${randomUUID().slice(0, 8)}.log`);
}
export async function signingRun(label, command, args, { logDir, echo = false, runner = run, readLog = file => fs.readFileSync(file, 'utf8'), ...options }) {
  const logFile = signingLogFile(logDir, label);
  const output = await runner(label, command, args, { ...options, capture: true, logFile });
  // Calls that used to stream to the job log still show their (redacted) output on success.
  if (echo) process.stdout.write(readLog(logFile));
  return output;
}
// Retry only Apple's transient timestamp-service failure: MacOS error -67885, "The timestamp service is not
// available" (candidate run 42620309741 attempt 5, confirmed in the unified log). Every other codesign error,
// a timeout kill, signal or output limit fails immediately: a hung Keychain prompt must not be re-driven.
export const TIMESTAMP_RETRYABLE = /(?:^|[^\d])-67885(?!\d)|timestamp service is not available/i;
export const TIMESTAMP_RETRY_DELAYS_MS = Object.freeze([10000, 30000]);
export async function timestampedCodesign(label, args, { logDir, record, runner = run, readLog = file => fs.readFileSync(file, 'utf8'),
  delays = TIMESTAMP_RETRY_DELAYS_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 120000 }) {
  // Same file, same identity, same keychain and options on every attempt: the argument list is frozen once.
  const frozen = Object.freeze([...args]);
  assert(frozen.includes('--timestamp') && frozen.includes('--sign') && frozen.includes('--keychain'), 'timestamped Developer ID codesign required');
  assert.equal(typeof record, 'function', 'codesign attempts must be recorded in evidence');
  const evidence = { label, file: frozen.at(-1), identity: frozen[frozen.indexOf('--sign') + 1], maxRetries: delays.length, attempts: [] };
  for (let attempt = 1; ; attempt++) {
    const logFile = signingLogFile(logDir, label);
    try {
      const output = await runner(label, '/usr/bin/codesign', [...frozen], { capture: true, logFile, timeout });
      evidence.attempts.push({ attempt, logFile: path.basename(logFile), outcome: 'success' });
      record({ ...evidence, outcome: 'success', retriesUsed: attempt - 1 });
      return output;
    } catch (error) {
      let text = ''; try { text = readLog(logFile); } catch { /* nothing was captured */ }
      const exitFailure = /\(exit=\d+, signal=none, reason=exit\)/.test(String(error?.message));
      const retryable = exitFailure && TIMESTAMP_RETRYABLE.test(text);
      evidence.attempts.push({ attempt, logFile: path.basename(logFile), outcome: retryable ? 'timestamp-service-unavailable' : 'failure', message: String(error?.message).slice(0, 300) });
      if (!retryable || attempt > delays.length) {
        record({ ...evidence, outcome: 'failure', retriesUsed: attempt - 1 });
        throw new Error(`${error?.message}; codesign attempts=${attempt} (timestamp retries=${attempt - 1}, retryable=${retryable})`, { cause: error });
      }
      console.log(`candidate signing retry: ${label} attempt ${attempt + 1} of ${delays.length + 1} after the timestamp service was unavailable`);
      await wait(delays[attempt - 1]);
    }
  }
}
// Full attempt evidence goes to a private JSON next to the logs; the summary goes into the phase receipt.
export function signingRecorder(directory, summary, { write = save } = {}) {
  return value => {
    write(path.join(directory, `${String(signingLogSequence).padStart(3, '0')}-codesign-attempts-${randomUUID().slice(0, 8)}.json`), value);
    summary.push({ label: value.label, file: path.basename(value.file), attempts: value.attempts.length, retriesUsed: value.retriesUsed, outcome: value.outcome });
  };
}
export function userKeychainMetadata() {
  // Keep commandEvidence's HOME synthetic; only security's user-domain lookup uses the account HOME.
  const userSecurity = args => sync('/usr/bin/env', [`HOME=${realHome}`, '/usr/bin/security', ...args]);
  return { search: userSecurity(['list-keychains', '-d', 'user']), default: userSecurity(['default-keychain', '-d', 'user']) };
}
export function assertSigner(e, settings, configuredName) {
  assert(typeof configuredName === 'string' && configuredName.length > 0, 'configured signer name required');
  assert.equal(e.RUNNER_NAME, configuredName);
  assert.equal(settings.agentId, INPUT.runnerId); assert.equal(settings.gitHubUrl, 'https://github.com/hara-cli');
  assert.equal(settings.poolId, INPUT.runnerGroupId); assert.equal(settings.poolName, INPUT.runnerGroup); assert.equal(settings.agentName, e.RUNNER_NAME);
}
async function preconditions() {
  const config = candidateSigningConfiguration();
  const operations = fs.lstatSync(config.operationsDirectory);
  assert(operations.isDirectory() && !operations.isSymbolicLink() && operations.uid === process.getuid?.()
    && (operations.mode & 0o022) === 0, 'candidate operations directory must be owned and non-writable by others');
  assert(!fs.existsSync(path.join(config.operationsDirectory, '.candidate-signing-ui-hold.json')),'candidate signing/UI hold is active; no Keychain or key access');
  await readAdmission(); // Refuse missing/weakened live protection before opening any signing material.
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  const settings = JSON.parse(fs.readFileSync(path.join(config.runnerDirectory, '.runner'), 'utf8').replace(/^\uFEFF/, ''));
  assertSigner(process.env, settings, config.runnerName);
  try {
    const keychain = fs.lstatSync(config.keychain);
    assert(keychain.isFile() && !keychain.isSymbolicLink() && keychain.nlink === 1
      && fs.realpathSync(config.keychain) === config.keychain,
    'dedicated signing keychain must be a canonical regular file without symlink/alias');
  } catch (cause) {
    throw new Error('dedicated signing keychain path refused: symlink/alias or unsafe file', { cause });
  }
  assert(fs.statSync(config.notaryKeyFile).isFile());
  let bytes;
  try { bytes = readUpdaterKey(realHome); assert(bytes.toString('utf8').trim() && !bytes.includes(0)); }
  finally { bytes?.fill(0); }
  return config;
}
async function withSigning(c, operation) {
  const config = await preconditions(), KEYCHAIN = config.keychain;
  const LEASE = path.join(config.operationsDirectory, '.mac-signing-lease');
  const token = randomUUID();
  const rows = sync('/bin/ps', ['-axo', 'comm=']).split('\n');
  assert(!rows.some(r => /\/(?:codesign|notarytool|productsign)$/.test(r.trim())), 'another signing operation is active');
  fs.writeFileSync(LEASE, JSON.stringify(receipt({ owner: 'candidate-lane', token, pid: process.pid })), { flag: 'wx', mode: 0o600 });
  const metadata = userKeychainMetadata;
  let before, mayNeedRelock = false;
  try {
    before = metadata();
    const helper = path.join(c.base, 'unlock-dedicated');
    await run('Compile dedicated Keychain-only unlock helper', '/usr/bin/xcrun', ['swiftc', '-module-cache-path', path.join(c.base, 'swift-cache'), path.join(ROOT, 'scripts/candidate-unlock.swift'), '-o', helper], { env: process.env });
    mayNeedRelock = true;
    await run('Unlock only the existing dedicated signing Keychain', helper, [], { timeout: 30000, capture: true });
    assert(sync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', KEYCHAIN]).includes(IDENTITY));
    await operation(config);
  } finally {
    const errors = [];
    try { if (mayNeedRelock) sync('/usr/bin/security', ['lock-keychain', KEYCHAIN]); } catch (e) { errors.push(e); }
    try { if (before) { const after = metadata(); save(path.join(c.base, 'keychain-metadata.json'), { unchanged: JSON.stringify(before) === JSON.stringify(after), configurationWritten: false });
      assert.deepEqual(after, before, 'global Keychain metadata changed; do not restore or overwrite it'); } } catch (e) { errors.push(e); }
    try { assert.equal(readJson(LEASE).token, token); fs.unlinkSync(LEASE); } catch (e) { errors.push(e); }
    if (errors.length) throw new AggregateError(errors, 'candidate signing cleanup failed; stop');
  }
}
export async function durableNotary(file, target, kind, output, config = candidateSigningConfiguration(), logDir = path.join(path.dirname(output), 'signing-diagnostics')) {
  assert(mac(target)); assert(['app', 'dmg'].includes(kind));
  const retained = path.join(config.runnerDirectory, '_candidate-notary', identity);
  const NOTARY_ARGS = ['--key', config.notaryKeyFile, '--key-id', config.notaryKeyId, '--issuer', config.notaryIssuerId];
  const digest = fileHash(file), directory = path.join(retained, target, kind, digest);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = path.join(directory, 'notary.json'); let state;
  const persist = value => saveRetainedNotary(statePath, value, config.runnerDirectory);
  if (fs.existsSync(statePath)) {
    state = readJson(statePath); assert.equal(state.inputSha256, digest); assert.equal(state.identity, identity);
    assert.match(state.submissionId ?? '', /^[a-f0-9-]{36}$/i, 'prior submission outcome unknown: never submit again');
  } else {
    const frozen = path.join(directory, `submission.${kind === 'app' ? 'zip' : 'dmg'}`);
    fs.copyFileSync(file, frozen, fs.constants.COPYFILE_EXCL); fs.chmodSync(frozen, 0o600); assert.equal(fileHash(frozen), digest);
    state = receipt({ kind, target, inputSha256: digest, frozen, status: 'submission-starting-outcome-unknown' });
    persist(state); // Durable intent under runner _candidate-notary (outside evidence whitelist) before the non-idempotent POST.
    const raw = await signingRun(`Submit ${target} ${kind} notarization once`, '/usr/bin/xcrun', ['notarytool', 'submit', frozen, ...NOTARY_ARGS, '--no-wait', '--output-format', 'json'], { logDir, timeout: 20 * 60000 });
    const submitted = parseNotaryResponse(raw, 'candidate notary submission');
    state = { ...state, submissionId: submitted.id, status: submitted.status ?? 'In Progress' }; persist(state);
  }
  const deadline = Date.now() + 60 * 60000;
  while (state.status !== 'Accepted') {
    assert(Date.now() < deadline, `notary result pending; retain ${state.submissionId}, query only`);
    const raw = await signingRun(`Query ${target} ${kind} notarization`, '/usr/bin/xcrun', ['notarytool', 'info', state.submissionId, ...NOTARY_ARGS, '--output-format', 'json'], { logDir, timeout: 120000 });
    const info = parseNotaryResponse(raw, 'candidate notary query'); assert.equal(info.id, state.submissionId);
    assert(['In Progress', 'Accepted'].includes(info.status), 'Apple rejected candidate; stop and retain evidence');
    state = { ...state, status: info.status }; persist(state);
    if (state.status !== 'Accepted') await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const { frozen, ...publicState } = state; // Retained local recovery path is not an uploaded artifact.
  save(output, publicState); return publicState; // Public notary receipt stays inside evidence whitelist.
}
async function importBundle(c, phase, target, directory) {
  const transport = await downloadArtifact(phase, target, path.join(c.base, `${phase}-${target}`));
  const r = readJson(path.join(transport, 'receipt.json')); assertReceipt(r); assert.equal(r.phase, phase); assert.equal(r.target, target);
  if (phase === 'unsigned' && target === c.target) restoreBuildBinaries(c, transport, r);
  const file = path.join(transport, 'bundle.tar.gz'); assert.equal(r.archive.name, 'bundle.tar.gz');
  assert.equal(fileHash(file), r.archive.sha256); assert.equal(fs.statSync(file).size, r.archive.size);
  await validateTar(file); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await runLocalTar('Extract immutable native-built bundle', 'extract', file, directory, [], { env: c.env });
  validateExtractedTree(path.join(directory, 'bundle'));
  return r;
}
async function signUpdater(c, file) {
  const env = { PATH: process.env.PATH, HOME: realHome, NO_COLOR: '1', npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1' };
  const code = await withUpdaterFile('bash', ['-c', 'exec npm run tauri -- signer sign "$1"', 'candidate-sign', file], { env });
  assert.equal(code, 0); await verifyUpdater(c, file, 'candidate updater payload');
}
async function verifyApp(c, app, target) {
  const logDir = path.join(c.base, 'signing-diagnostics');
  for (const file of [app, ...['hara-desktop', 'hara', 'herdr'].map(n => path.join(app, 'Contents/MacOS', n))]) {
    await signingRun('Strict Developer ID verification', '/usr/bin/codesign', ['--verify', '--deep', '--strict', file], { env: c.env, logDir, echo: true });
    const details = await signingRun('Read Developer ID metadata', '/usr/bin/codesign', ['-d', '--verbose=4', file], { env: c.env, logDir });
    assert(details.includes(`Authority=${IDENTITY}`) && details.includes('TeamIdentifier=4GMBSXJ67T') && /^Timestamp=/m.test(details) && /flags=0x[0-9a-f]+\(runtime\)/.test(details));
  }
  const expectedArch = target.startsWith('aarch64') ? 'arm64' : 'x86_64';
  for (const name of ['hara-desktop', 'hara', 'herdr']) assert.equal(sync('/usr/bin/lipo', ['-archs', path.join(app, 'Contents/MacOS', name)]), expectedArch);
}
export async function credentialPreflight(c) {
  const hydrated = readJson(path.join(c.base, 'hydration.json')); assertReceipt(hydrated); assert.equal(hydrated.piOnlyLockVerified, true);
  // Build a cheap binary from the UNCHANGED formal streaming verifier, not the whole App.
  // No placeholder sidecar is needed just to discover a mismatched updater key.
  await run('Compile exact formal updater verifier for early key probe', 'cargo', ['build', '--locked', '--manifest-path', path.join(ROOT, 'scripts/candidate-updater-verifier/Cargo.toml'), '--target-dir', path.join(c.base, 'early-updater-verifier')], { env: c.env });
  const probeCodesign = [];
  await withSigning(c, async config => {
    const probe = path.join(c.base, 'developer-id-probe'); fs.copyFileSync('/usr/bin/true', probe, fs.constants.COPYFILE_EXCL);
    const logDir = path.join(c.base, 'signing-diagnostics');
    await timestampedCodesign('Background Developer ID signing probe', ['--force', '--options', 'runtime', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, probe], { logDir, record: signingRecorder(logDir, probeCodesign) });
    await signingRun('Verify Developer ID signing probe', '/usr/bin/codesign', ['--verify', '--strict', probe], { env: c.env, logDir });
    const payload = path.join(c.base, 'updater-key-probe.txt'); fs.writeFileSync(payload, 'Hara controlled candidate updater key probe\n', { flag: 'wx', mode: 0o600 });
    const code = await withUpdaterFile('bash', ['-c', 'exec npm run tauri -- signer sign "$1"', 'candidate-key-probe', payload], { env: { PATH:process.env.PATH, HOME:realHome, NO_COLOR:'1', NO_UPDATE_NOTIFIER:'1', npm_config_update_notifier:'false' } });
    assert.equal(code, 0);
    await run('Verify original updater key against exact application public key', path.join(c.base, 'early-updater-verifier/debug/hara-candidate-updater-verifier'), [payload, payload + '.sig', readJson(path.join(c.desktop, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey], { env: c.env });
  });
  save(path.join(c.base, 'credential-preflight.json'), receipt({ originalUpdaterFileReadable: true, originalUpdaterKeyMatched: true, developerIdProbePassed: true, piOnlyLockVerified: true, productionWriteCredentialsProvided: false, codesignAttempts: probeCodesign }));
}
export async function signApps(c) {
  await withSigning(c, async config => {
    for (const target of TARGETS.filter(mac)) {
      const directory = path.join(c.base, `app-input-${target}`); await importBundle(c, 'unsigned', target, directory);
      const app = path.join(directory, 'bundle/macos/Hara.app'), logDir = path.join(c.base, 'signing-diagnostics'), codesignAttempts = [];
      for (const file of [...['hara', 'herdr', 'hara-desktop'].map(n => path.join(app, 'Contents/MacOS', n)), app])
        await timestampedCodesign('Sign exact native-built executable/App', ['--force', '--options', 'runtime', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, '--entitlements', path.join(c.desktop, 'src-tauri/Entitlements.plist'), file], { logDir, record: signingRecorder(logDir, codesignAttempts) });
      await verifyApp(c, app, target);
      const out = path.join(c.base, `app-signed-output-${target}`); fs.mkdirSync(out, { mode: 0o700 });
      const upload = path.join(c.base, `notary-app-${target}.zip`); await run('Archive signed App submission', '/usr/bin/ditto', ['-c', '-k', '--keepParent', app, upload], { env: c.env });
      const notary = await durableNotary(upload, target, 'app', path.join(out, 'app-notary.json'), config, logDir);
      await signingRun('Staple notarized App', '/usr/bin/xcrun', ['stapler', 'staple', app], { env: c.env, logDir, echo: true });
      await run('Validate App staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), app], { env: c.env });
      await signingRun('Gatekeeper notarized App', '/usr/sbin/spctl', ['-a', '-vv', app], { env: c.env, logDir, echo: true });
      await verifyApp(c, app, target);
      const zip = path.join(out, 'Hara.app.zip'); await run('Archive exact stapled App transport', '/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip], { env: c.env });
      const archive = path.join(out, 'Hara.app.tar.gz'); await runLocalTar('Create canonical updater archive', 'create', archive, path.dirname(app), ['Hara.app'], { env: c.env });
      await signUpdater(c, archive);
      save(path.join(out, 'receipt.json'), receipt({ phase: 'app-signed', target, zipSha256: fileHash(zip), appNotary: notary, codesignAttempts,
        files: { 'Hara.app.tar.gz': fileHash(archive), 'Hara.app.tar.gz.sig': fileHash(archive + '.sig') } }));
    }
  });
}
export async function signFinal(c) {
  const support = await downloadArtifact('unsigned', c.target, path.join(c.base, 'sign-final-compiler-input'));
  restoreBuildBinaries(c, support, readJson(path.join(support, 'receipt.json')));
  await withSigning(c, async config => {
    for (const target of TARGETS) {
      const directory = path.join(c.base, `final-input-${target}`);
      const prior = await importBundle(c, mac(target) ? 'dmg-native' : 'unsigned', target, directory);
      let signing;
      if (mac(target)) {
        const dmg = path.join(directory, 'bundle/dmg', `Hara_${INPUT.desktop.version}_${target.startsWith('aarch64') ? 'aarch64' : 'x64'}.dmg`);
        const logDir = path.join(c.base, 'signing-diagnostics'), codesignAttempts = [];
        await timestampedCodesign('Sign native final DMG container', ['--force', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, dmg], { logDir, record: signingRecorder(logDir, codesignAttempts) });
        await signingRun('Verify native final DMG signature', '/usr/bin/codesign', ['--verify', '--strict', dmg], { env: c.env, logDir });
        const notary = await durableNotary(dmg, target, 'dmg', path.join(directory, 'dmg-notary.json'), config, logDir);
        await signingRun('Staple notarized native DMG', '/usr/bin/xcrun', ['stapler', 'staple', dmg], { env: c.env, logDir, echo: true });
        await run('Validate DMG staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), dmg], { env: c.env });
        await signingRun('Gatekeeper final DMG', '/usr/sbin/spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmg], { env: c.env, logDir, echo: true });
        signing = { appNotary: prior.signedAppReceipt.appNotary, dmgNotary: notary, finalDmgSha256: fileHash(dmg), nativeDmg: true, nativeTarget: prior.nativeTarget, codesignAttempts };
      } else {
        const bundles = path.join(directory, 'bundle');
        const list = folder => fs.readdirSync(path.join(bundles, folder)).filter(n => /\.(?:deb|rpm|msi|exe)$/.test(n)).map(n => path.join(bundles, folder, n));
        const files = (target.endsWith('linux-gnu') ? ['deb', 'rpm'] : ['msi', 'nsis']).flatMap(list); assert.equal(files.length, 2);
        for (const file of files) await signUpdater(c, file);
        signing = { updaterSignaturesVerified: true, authenticode: false };
      }
      const out = path.join(c.base, `final-output-${target}`); fs.mkdirSync(out, { mode: 0o700 });
      const archive = path.join(out, 'bundle.tar.gz'); await runLocalTar('Archive immutable final package set', 'create', archive, directory, ['bundle'], { env: c.env });
      await validateTar(archive); // fail where the archive is made, not in candidate-verify
      save(path.join(out, 'receipt.json'), receipt({ phase: 'final', target, signing, archive: { name: 'bundle.tar.gz', size: fs.statSync(archive).size, sha256: fileHash(archive) } }));
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stage = { preflight: credentialPreflight, 'sign-apps': signApps, 'sign-final': signFinal }[process.argv[2]];
  assert(stage, 'unknown signing stage'); const c = context(); await stage(c);
}
