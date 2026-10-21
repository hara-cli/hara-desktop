// Controlled runner only. Consume native-built bytes; never compile another application's source.
// No Release/OSS/stable APIs; updater key stays the original read-only local file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, INPUT, TARGETS, identity, realHome, context, receipt, assertReceipt, readJson, save,
  sync, run, fileHash, downloadArtifact, verifyUpdater, restoreBuildBinaries } from './candidate-common.mjs';
import { readUpdaterKey, withUpdaterFile } from './with-updater-file.mjs';
import { validateTar, validateExtractedTree } from './candidate-archive.mjs';
import { parseNotaryResponse } from './notarize-artifact.mjs';
import { readAdmission } from './candidate-admission.mjs';
import { candidateSigningConfiguration } from './candidate-operator-config.mjs';

const IDENTITY = 'Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)';
const mac = target => target.endsWith('apple-darwin');
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
  assert(fs.statSync(config.keychain).isFile()); assert(fs.statSync(config.notaryKeyFile).isFile());
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
  const metadata = () => ({ search: sync('/usr/bin/security', ['list-keychains', '-d', 'user']), default: sync('/usr/bin/security', ['default-keychain', '-d', 'user']) });
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
export async function durableNotary(file, target, kind, output, config = candidateSigningConfiguration()) {
  assert(mac(target)); assert(['app', 'dmg'].includes(kind));
  const retained = path.join(config.runnerDirectory, '_candidate-notary', identity);
  const NOTARY_ARGS = ['--key', config.notaryKeyFile, '--key-id', config.notaryKeyId, '--issuer', config.notaryIssuerId];
  const digest = fileHash(file), directory = path.join(retained, target, kind, digest);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = path.join(directory, 'notary.json'); let state;
  if (fs.existsSync(statePath)) {
    state = readJson(statePath); assert.equal(state.inputSha256, digest); assert.equal(state.identity, identity);
    assert.match(state.submissionId ?? '', /^[a-f0-9-]{36}$/i, 'prior submission outcome unknown: never submit again');
  } else {
    const frozen = path.join(directory, `submission.${kind === 'app' ? 'zip' : 'dmg'}`);
    fs.copyFileSync(file, frozen, fs.constants.COPYFILE_EXCL); fs.chmodSync(frozen, 0o600); assert.equal(fileHash(frozen), digest);
    state = receipt({ kind, target, inputSha256: digest, frozen, status: 'submission-starting-outcome-unknown' });
    save(statePath, state); // Durable intent before the non-idempotent POST; never auto-replay it.
    const raw = await run(`Submit ${target} ${kind} notarization once`, '/usr/bin/xcrun', ['notarytool', 'submit', frozen, ...NOTARY_ARGS, '--no-wait', '--output-format', 'json'], { capture: true, timeout: 20 * 60000 });
    const submitted = parseNotaryResponse(raw, 'candidate notary submission');
    state = { ...state, submissionId: submitted.id, status: submitted.status ?? 'In Progress' }; save(statePath, state);
  }
  const deadline = Date.now() + 60 * 60000;
  while (state.status !== 'Accepted') {
    assert(Date.now() < deadline, `notary result pending; retain ${state.submissionId}, query only`);
    const raw = await run(`Query ${target} ${kind} notarization`, '/usr/bin/xcrun', ['notarytool', 'info', state.submissionId, ...NOTARY_ARGS, '--output-format', 'json'], { capture: true, timeout: 120000 });
    const info = parseNotaryResponse(raw, 'candidate notary query'); assert.equal(info.id, state.submissionId);
    assert(['In Progress', 'Accepted'].includes(info.status), 'Apple rejected candidate; stop and retain evidence');
    state = { ...state, status: info.status }; save(statePath, state);
    if (state.status !== 'Accepted') await new Promise(resolve => setTimeout(resolve, 15000));
  }
  const { frozen, ...publicState } = state; // Retained local recovery path is not an uploaded artifact.
  save(output, publicState); return publicState;
}
async function importBundle(c, phase, target, directory) {
  const transport = await downloadArtifact(phase, target, path.join(c.base, `${phase}-${target}`));
  const r = readJson(path.join(transport, 'receipt.json')); assertReceipt(r); assert.equal(r.phase, phase); assert.equal(r.target, target);
  if (phase === 'unsigned' && target === c.target) restoreBuildBinaries(c, transport, r);
  const file = path.join(transport, 'bundle.tar.gz'); assert.equal(r.archive.name, 'bundle.tar.gz');
  assert.equal(fileHash(file), r.archive.sha256); assert.equal(fs.statSync(file).size, r.archive.size);
  await validateTar(file); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await run('Extract immutable native-built bundle', 'tar', ['-xzf', file, '-C', directory], { env: c.env });
  validateExtractedTree(path.join(directory, 'bundle'));
  return r;
}
async function signUpdater(c, file) {
  const env = { PATH: process.env.PATH, HOME: realHome, NO_COLOR: '1', npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1' };
  const code = await withUpdaterFile('bash', ['-c', 'exec npm run tauri -- signer sign "$1"', 'candidate-sign', file], { env });
  assert.equal(code, 0); await verifyUpdater(c, file, 'candidate updater payload');
}
async function verifyApp(c, app, target) {
  for (const file of [app, ...['hara-desktop', 'hara', 'herdr'].map(n => path.join(app, 'Contents/MacOS', n))]) {
    await run('Strict Developer ID verification', '/usr/bin/codesign', ['--verify', '--deep', '--strict', file], { env: c.env });
    const details = await run('Read Developer ID metadata', '/usr/bin/codesign', ['-d', '--verbose=4', file], { capture: true, env: c.env });
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
  await withSigning(c, async config => {
    const probe = path.join(c.base, 'developer-id-probe'); fs.copyFileSync('/usr/bin/true', probe, fs.constants.COPYFILE_EXCL);
    await run('Background Developer ID signing probe', '/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, probe], { timeout: 120000, capture: true });
    sync('/usr/bin/codesign', ['--verify', '--strict', probe]);
    const payload = path.join(c.base, 'updater-key-probe.txt'); fs.writeFileSync(payload, 'Hara controlled candidate updater key probe\n', { flag: 'wx', mode: 0o600 });
    const code = await withUpdaterFile('bash', ['-c', 'exec npm run tauri -- signer sign "$1"', 'candidate-key-probe', payload], { env: { PATH:process.env.PATH, HOME:realHome, NO_COLOR:'1', NO_UPDATE_NOTIFIER:'1', npm_config_update_notifier:'false' } });
    assert.equal(code, 0);
    await run('Verify original updater key against exact application public key', path.join(c.base, 'early-updater-verifier/debug/hara-candidate-updater-verifier'), [payload, payload + '.sig', readJson(path.join(c.desktop, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey], { env: c.env });
  });
  save(path.join(c.base, 'credential-preflight.json'), receipt({ originalUpdaterFileReadable: true, originalUpdaterKeyMatched: true, developerIdProbePassed: true, piOnlyLockVerified: true, productionWriteCredentialsProvided: false }));
}
export async function signApps(c) {
  await withSigning(c, async config => {
    for (const target of TARGETS.filter(mac)) {
      const directory = path.join(c.base, `app-input-${target}`); await importBundle(c, 'unsigned', target, directory);
      const app = path.join(directory, 'bundle/macos/Hara.app');
      for (const file of [...['hara', 'herdr', 'hara-desktop'].map(n => path.join(app, 'Contents/MacOS', n)), app])
        await run('Sign exact native-built executable/App', '/usr/bin/codesign', ['--force', '--options', 'runtime', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, '--entitlements', path.join(c.desktop, 'src-tauri/Entitlements.plist'), file], { capture: true, timeout: 120000 });
      await verifyApp(c, app, target);
      const out = path.join(c.base, `app-signed-output-${target}`); fs.mkdirSync(out, { mode: 0o700 });
      const upload = path.join(c.base, `notary-app-${target}.zip`); await run('Archive signed App submission', '/usr/bin/ditto', ['-c', '-k', '--keepParent', app, upload], { env: c.env });
      const notary = await durableNotary(upload, target, 'app', path.join(out, 'app-notary.json'), config);
      await run('Staple notarized App', '/usr/bin/xcrun', ['stapler', 'staple', app], { env: c.env });
      await run('Validate App staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), app], { env: c.env });
      await run('Gatekeeper notarized App', '/usr/sbin/spctl', ['-a', '-vv', app], { env: c.env });
      await verifyApp(c, app, target);
      const zip = path.join(out, 'Hara.app.zip'); await run('Archive exact stapled App transport', '/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip], { env: c.env });
      const archive = path.join(out, 'Hara.app.tar.gz'); await run('Create canonical updater archive', 'tar', ['-czf', archive, '-C', path.dirname(app), 'Hara.app'], { env: c.env });
      await signUpdater(c, archive);
      save(path.join(out, 'receipt.json'), receipt({ phase: 'app-signed', target, zipSha256: fileHash(zip), appNotary: notary,
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
        await run('Sign native final DMG container', '/usr/bin/codesign', ['--force', '--timestamp', '--keychain', config.keychain, '--sign', IDENTITY, dmg], { capture: true, timeout: 120000 });
        sync('/usr/bin/codesign', ['--verify', '--strict', dmg]);
        const notary = await durableNotary(dmg, target, 'dmg', path.join(directory, 'dmg-notary.json'), config);
        await run('Staple notarized native DMG', '/usr/bin/xcrun', ['stapler', 'staple', dmg], { env: c.env });
        await run('Validate DMG staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), dmg], { env: c.env });
        await run('Gatekeeper final DMG', '/usr/sbin/spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmg], { env: c.env });
        signing = { appNotary: prior.signedAppReceipt.appNotary, dmgNotary: notary, finalDmgSha256: fileHash(dmg), nativeDmg: true, nativeTarget: prior.nativeTarget };
      } else {
        const bundles = path.join(directory, 'bundle');
        const list = folder => fs.readdirSync(path.join(bundles, folder)).filter(n => /\.(?:deb|rpm|msi|exe)$/.test(n)).map(n => path.join(bundles, folder, n));
        const files = (target.endsWith('linux-gnu') ? ['deb', 'rpm'] : ['msi', 'nsis']).flatMap(list); assert.equal(files.length, 2);
        for (const file of files) await signUpdater(c, file);
        signing = { updaterSignaturesVerified: true, authenticode: false };
      }
      const out = path.join(c.base, `final-output-${target}`); fs.mkdirSync(out, { mode: 0o700 });
      const archive = path.join(out, 'bundle.tar.gz'); await run('Archive immutable final package set', 'tar', ['-czf', archive, '-C', directory, 'bundle'], { env: c.env });
      save(path.join(out, 'receipt.json'), receipt({ phase: 'final', target, signing, archive: { name: 'bundle.tar.gz', size: fs.statSync(archive).size, sha256: fileHash(archive) } }));
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const stage = { preflight: credentialPreflight, 'sign-apps': signApps, 'sign-final': signFinal }[process.argv[2]];
  assert(stage, 'unknown signing stage'); const c = context(); await stage(c);
}
