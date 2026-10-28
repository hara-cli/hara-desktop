// Native parts of the shared candidate package path. Credentials never reach these runners.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, INPUT, TARGETS, identity, context, assertSources, receipt, assertReceipt, sync, run,
  save, readJson, fileHash, downloadArtifact, restoreBuildBinaries } from './candidate-common.mjs';
import { upgradeSmoke } from './candidate-upgrade.mjs';
import { validateTar, validateExtractedTree } from './candidate-archive.mjs';
import { runLocalTar } from './candidate-local-tar.mjs';

export const bunTarget = target => ({ 'aarch64-apple-darwin': 'bun-darwin-arm64', 'x86_64-apple-darwin': 'bun-darwin-x64-baseline',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64-baseline', 'x86_64-pc-windows-msvc': '' }[target]);
export function packageKinds(target) {
  assert(TARGETS.includes(target)); return target.endsWith('apple-darwin') ? 'app,dmg' : target.endsWith('linux-gnu') ? 'deb,rpm' : 'msi,nsis';
}
export function testCounts(output) {
  assert(!/^not ok /m.test(output), 'a failed file or case cannot be hidden by a later summary');
  const summaries = [...output.matchAll(/^# tests (\d+)\r?$/gm)];
  assert(summaries.length > 0, 'complete TAP accounting required');
  const total = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 };
  for (let i = 0; i < summaries.length; i++) {
    const block = output.slice(summaries[i].index, summaries[i + 1]?.index);
    const counts = Object.fromEntries(Object.keys(total).map(name => {
      const found = [...block.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, 'gm'))];
      assert.equal(found.length, 1, `one complete ${name} count per test batch required`);
      return [name, Number(found[0][1])];
    }));
    assert(Object.values(counts).every(Number.isSafeInteger) && counts.tests > 0 && counts.pass > 0);
    assert.equal(counts.fail, 0); assert.equal(counts.cancelled, 0); assert.equal(counts.tests, counts.pass + counts.skipped);
    for (const name of Object.keys(total)) { total[name] += counts[name]; assert(Number.isSafeInteger(total[name])); }
  }
  return total;
}
export function coreTestCommand(core, platform = process.platform, arch = process.arch) {
  // Intel keeps Core's strict batches/case deadlines; see candidate-core-native-tests.mjs for its file budget.
  if (platform === 'darwin' && arch === 'x64') return { script: path.join(ROOT, 'scripts/candidate-core-native-tests.mjs'), args: [] };
  if (platform === 'darwin') return { script: path.join(core, 'scripts/native-ci-tests.mjs'), args: ['--original-deadlines'] };
  if (platform === 'win32') return { script: path.join(core, 'scripts/windows-ci-tests.mjs'), args: [] };
  assert.equal(platform, 'linux', 'unsupported candidate Core platform');
  return null;
}
export function coreTestCoverage(platform = process.platform) {
  return platform === 'win32' ? 'windows-contract-subset-v1' : 'full';
}
export function coreTestDeadlines(platform = process.platform, arch = process.arch) {
  return platform === 'darwin' && arch === 'x64' ? 'intel-slow-file-300s-v1' : 'original';
}
export async function assertStrictNativeCore(c) {
  const command = coreTestCommand(c.core, 'darwin', 'arm64');
  // Application code must not run in the credential-bearing orchestration process.
  await run('Verify pinned Core strict native test capability', process.execPath, ['--input-type=module', '-e',
    'const runner=await import(process.argv[1]);if(typeof runner.strictNativeTestBatches!=="function")throw Error("pinned Core must support strict original-deadline native full tests");console.log("strict native capability confirmed");',
    pathToFileURL(command.script).href], { cwd: c.core, env: c.env, capture: true, logFile: path.join(c.base, 'core-capability-tests.log') });
}
const bash = (label, args, options) => run(label, 'bash', args, options);
const npm = (label, args, options) => bash(label, ['-c', 'exec npm "$@"', 'candidate-npm', ...args], options);
const node = (label, script, args, options) => run(label, process.execPath, [script, ...args], options);
const releaseBase = c => path.join(c.desktop, 'src-tauri/target', c.target, 'release');
async function archive(c, phase, inputDirectory, extra = {}) {
  const out = path.join(c.base, phase + '-output'); assert(!fs.existsSync(out)); fs.mkdirSync(out, { mode: 0o700 });
  const file = path.join(out, 'bundle.tar.gz');
  await runLocalTar('Archive immutable native payload', 'create', file, inputDirectory, ['bundle'], { env: c.env });
  save(path.join(out, 'receipt.json'), receipt({ phase, target: c.target, archive: { name: 'bundle.tar.gz', size: fs.statSync(file).size, sha256: fileHash(file) }, ...extra }));
  console.log(`CANDIDATE_OUTPUT=${out}`); return out;
}
async function extract(c, directory, destination, phase) {
  const r = readJson(path.join(directory, 'receipt.json')); assertReceipt(r); assert.equal(r.phase, phase); assert.equal(r.target, c.target);
  assert.equal(r.archive.name, 'bundle.tar.gz'); const file = path.join(directory, 'bundle.tar.gz');
  assert.equal(fs.statSync(file).size, r.archive.size); assert.equal(fileHash(file), r.archive.sha256);
  await validateTar(file);
  assert(!fs.existsSync(path.join(destination, 'bundle'))); fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  await runLocalTar('Extract source-bound native payload', 'extract', file, destination, [], { env: c.env });
  validateExtractedTree(path.join(destination, 'bundle'));
  return r;
}
export async function hydrate(c) {
  await bash('Install locked orchestration dependencies', [path.join(ROOT, 'scripts/npm-ci-retry.sh')], { cwd: ROOT, env: c.env });
  await bash('Install exact application dependencies', [path.join(ROOT, 'scripts/npm-ci-retry.sh')], { cwd: c.desktop, env: c.env });
  await hydrateCore(c);
  assertSources(c.desktop, c.core);
  save(path.join(c.base, 'hydration.json'), receipt({ target: c.target, piOnlyLockVerified: true }));
}
export async function hydrateCore(c) {
  await bash('Install exact Core dependencies without lifecycle scripts', [path.join(ROOT, 'scripts/npm-ci-retry.sh')], { cwd: c.core, env: { ...c.env, HARA_NPM_CI_IGNORE_SCRIPTS: '1' } });
  await node('Pi-only locked hydration preflight', path.join(ROOT, 'scripts/hydrate-locked-sidecar-dependencies.mjs'), [c.core, c.target], { env: c.env });
  // npm rebuild treats even an unsupported OPTIONAL install script as fatal. A normal locked
  // install applies npm's optional-dependency semantics, while required lifecycle failures still fail.
  await npm('Install locked Core with native optional-dependency semantics', ['ci', '--no-audit', '--fund=false'], { cwd: c.core, env: c.env });
}
export async function tests(c) {
  await bash('Original formal production dependency audit', [path.join(c.desktop, 'scripts/npm-audit-retry.sh')], { cwd: c.desktop, env: c.env });
  for (const [name, cwd] of [['Orchestration', ROOT], ['Desktop', c.desktop], ['Core', c.core]]) {
    const options = { cwd, env: c.env, capture: true, logFile:path.join(c.base, `${name.toLowerCase()}-tests.log`) };
    const command = name === 'Core' ? coreTestCommand(c.core) : null;
    if (command && process.platform === 'darwin') await assertStrictNativeCore(c);
    const coverage = name === 'Core' ? coreTestCoverage() : 'full', deadlines = name === 'Core' ? coreTestDeadlines() : 'original';
    const output = command ? await node(`${name} ${coverage} at ${deadlines} deadlines`, command.script, command.args, options)
      : await npm(`${name} original full suite`, ['test'], options);
    const counts = testCounts(output); console.log(`${name} tests ${JSON.stringify(counts)}`);
    save(path.join(c.base, `${name.toLowerCase()}-tests.json`), receipt({ target: c.target, coverage, deadlines, counts }));
  }
  await npm('Validate application release metadata', ['run', 'check:release'], { cwd: c.desktop, env: c.env });
  await npm('Build exact production renderer', ['run', 'build'], { cwd: c.desktop, env: c.env });
  assertSources(c.desktop, c.core);
}
// A reused local Core checkout (C5 preflight) keeps the previous run's ignored dist/bin output.
// Remove only that exact file so the sidecar is always rebuilt; a directory or other entry still fails closed.
export function clearCandidateSidecar(filename) {
  fs.rmSync(filename, { force: true });
  assert(!fs.existsSync(filename), 'stale candidate sidecar must be rebuilt, never reused');
}
export async function sidecar(c) {
  await npm('Compile exact Core', ['run', 'build'], { cwd: c.core, env: c.env });
  const filename = path.join(c.core, 'dist/bin/hara-candidate') + (process.platform === 'win32' ? '.exe' : '');
  clearCandidateSidecar(filename);
  await run('Compile Pi-only standalone sidecar', 'bun', ['scripts/build-binary.ts', 'dist/bin/hara-candidate', bunTarget(c.target), 'dist/cli.js', 'desktop-sidecar'], { cwd: c.core, env: c.env });
  if (process.platform === 'darwin') {
    try { sync('/usr/bin/codesign', ['--verify', filename]); }
    catch { await run('Repair Bun source ad-hoc signature', '/usr/bin/codesign', ['--force', '--sign', '-', filename], { env: c.env }); }
  }
  await node('Native standalone boundary and runtime-manifest smoke', path.join(c.desktop, 'scripts/sidecar-smoke.mjs'), [filename, INPUT.core.version, c.target], { env: c.env });
  const binaries = path.join(c.desktop, 'src-tauri/binaries');
  fs.copyFileSync(filename, path.join(binaries, `hara-${c.target}${process.platform === 'win32' ? '.exe' : ''}`));
  await node('Hydrate exact checksum-pinned browser helper', path.join(c.desktop, 'scripts/refresh-herdr-runtime.mjs'), [c.target], { env: c.env });
  await node('Verify Pi-only runtime configuration', path.join(c.desktop, 'scripts/check-runtime-distribution.mjs'), [], { env: c.env });
  await run('Native locked Rust unit tests', 'cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--target', c.target], { cwd: c.desktop, env: c.env });
  assertSources(c.desktop, c.core);
}
export async function build(c) {
  const installerArgs = ['run', 'tauri', 'build', '--', '--target', c.target, '--bundles', packageKinds(c.target),
    '--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } })];
  const buildEnv = { ...c.env, NO_STRIP: 'true' };
  if (c.target.endsWith('apple-darwin')) {
    await node('Formal native installer build (no keys or publication)', path.join(ROOT, 'scripts/macos-dmg-detach.mjs'),
      ['run', 'npm', ...installerArgs], { cwd: c.desktop, env: buildEnv });
  } else {
    await npm('Formal native installer build (no keys or publication)', installerArgs, { cwd: c.desktop, env: buildEnv });
  }
  assertSources(c.desktop, c.core);
  if (process.platform === 'darwin') {
    const dmg = path.join(releaseBase(c), 'bundle/dmg', `Hara_${INPUT.desktop.version}_${c.target.startsWith('aarch64') ? 'aarch64' : 'x64'}.dmg`);
    await node('Native unsigned DMG structural smoke (not final acceptance)', path.join(c.desktop, 'scripts/mac-dmg-smoke.mjs'), [dmg, c.target], { env: c.env });
  }
  const out = await archive(c, 'unsigned', releaseBase(c), { nativeTarget: c.target, piOnlyLockVerified: true });
  const buildBinaries = {};
  for (const name of ['hara', 'herdr']) {
    const generated = path.join(c.desktop, 'src-tauri/binaries', `${name}-${c.target}${process.platform === 'win32' ? '.exe' : ''}`);
    const file = `${name}-native${process.platform === 'win32' ? '.exe' : ''}`; fs.copyFileSync(generated, path.join(out, file));
    buildBinaries[name] = { name: file, size: fs.statSync(generated).size, sha256: fileHash(generated) };
  }
  save(path.join(out, 'receipt.json'), { ...readJson(path.join(out, 'receipt.json')), buildBinaries });
  for (const file of fs.readdirSync(c.base).filter(n => /-tests\.(?:json|log)$/.test(n))) fs.copyFileSync(path.join(c.base, file), path.join(out, file));
}
export async function nativeDmg(c) {
  assert.equal(process.platform, 'darwin');
  const raw = await downloadArtifact('unsigned', c.target, path.join(c.base, 'unsigned-input'));
  const signed = await downloadArtifact('app-signed', c.target, path.join(c.base, 'signed-input'));
  const rawBase = path.join(c.base, 'original-native-build'); const rawReceipt = await extract(c, raw, rawBase, 'unsigned');
  assert.equal(rawReceipt.nativeTarget, c.target);
  const signedReceipt = readJson(path.join(signed, 'receipt.json')); assertReceipt(signedReceipt);
  assert.equal(signedReceipt.phase, 'app-signed'); assert.equal(signedReceipt.target, c.target);
  const zip = path.join(signed, 'Hara.app.zip'); assert.equal(fileHash(zip), signedReceipt.zipSha256);
  const work = path.join(c.base, 'signed-native-bundle'), macos = path.join(work, 'bundle/macos'), dmgFolder = path.join(work, 'bundle/dmg');
  fs.mkdirSync(macos, { recursive: true, mode: 0o700 }); fs.mkdirSync(dmgFolder, { recursive: true, mode: 0o700 });
  await run('Restore exact signed and stapled App', '/usr/bin/ditto', ['-x', '-k', zip, macos], { env: c.env });
  const app = path.join(macos, 'Hara.app');
  validateExtractedTree(app);
  await run('Verify received Developer ID App', '/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { env: c.env });
  await node('Verify received App ticket', path.join(c.desktop, 'scripts/stapler-validate.mjs'), [app], { env: c.env });
  await run('Gatekeeper received App', '/usr/sbin/spctl', ['-a', '-vv', app], { env: c.env });
  const generated = path.join(rawBase, 'bundle/dmg'), script = path.join(generated, 'bundle_dmg.sh');
  assert(fs.statSync(script).isFile()); const icons = fs.readdirSync(generated).filter(n => n.endsWith('.icns')); assert.equal(icons.length, 1);
  const dmgName = `Hara_${INPUT.desktop.version}_${c.target.startsWith('aarch64') ? 'aarch64' : 'x64'}.dmg`;
  // Same generated Tauri DMG program as the formal build; retain the signed App, no second app bundling.
  const stage = path.join(c.base, 'dmg-app-staging'); fs.mkdirSync(stage, { mode: 0o700 });
  await run('Stage exact stapled App outside DMG output', '/usr/bin/ditto', [app, path.join(stage, 'Hara.app')], { env: c.env });
  await node('Formal signed-App DMG build on the native target', path.join(ROOT, 'scripts/macos-dmg-detach.mjs'), ['script', script, '--volname', `Hara-${INPUT.desktop.version}-${c.target}`, '--icon', 'Hara.app', '180', '170',
    '--app-drop-link', '480', '170', '--window-size', '660', '400', '--hide-extension', 'Hara.app', '--volicon', path.join(generated, icons[0]), path.join(dmgFolder, dmgName), stage], { cwd: stage, env: c.env });
  for (const name of ['Hara.app.tar.gz', 'Hara.app.tar.gz.sig']) {
    assert.equal(fileHash(path.join(signed, name)), signedReceipt.files[name]); fs.copyFileSync(path.join(signed, name), path.join(macos, name));
  }
  await node('Native final DMG content/signature smoke', path.join(c.desktop, 'scripts/mac-dmg-smoke.mjs'), [path.join(dmgFolder, dmgName), c.target, '--require-signatures'], { env: c.env });
  await archive(c, 'dmg-native', work, { nativeTarget: c.target, generatedScriptSha256: fileHash(script), signedAppReceipt: signedReceipt });
}
export async function verify(c) {
  const native = await downloadArtifact('unsigned', c.target, path.join(c.base, 'native-compiler-input'));
  restoreBuildBinaries(c, native, readJson(path.join(native, 'receipt.json')));
  const input = await downloadArtifact('final', c.target, path.join(c.base, 'final-input'));
  const r = await extract(c, input, releaseBase(c), 'final');
  if (process.platform === 'darwin') {
    const original = path.join(releaseBase(c), 'bundle/macos/Hara.app');
    const quarantined = path.join(c.base, 'fresh-quarantine/Hara.app');
    fs.mkdirSync(path.dirname(quarantined), { mode: 0o700 });
    await run('Fresh private installation copy (never /Applications)', '/usr/bin/ditto', [original, quarantined], { env: c.env });
    validateExtractedTree(quarantined);
    await run('Apply quarantine to fresh candidate copy', '/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;HaraCandidate;', quarantined], { env: c.env });
    await run('Verify strict signature on fresh quarantined App', '/usr/bin/codesign', ['--verify', '--deep', '--strict', quarantined], { env: c.env });
    await run('Gatekeeper fresh quarantined App', '/usr/sbin/spctl', ['-a', '-vv', quarantined], { env: c.env });
    await node('Validate fresh quarantined App ticket', path.join(c.desktop, 'scripts/stapler-validate.mjs'), [quarantined], { env: c.env });
    save(path.join(c.base, 'quarantine-check.json'), receipt({ target: c.target, gatekeeper: true, staple: true, strictSignature: true, privateCopyOnly: true }));
  }
  const nativeEnv = { ...c.env, TAURI_TARGET: c.target, ...(process.platform === 'darwin' ? { HARA_REQUIRE_MAC_SIGNATURES: '1' } : {}) };
  await node('Original full native package smoke, updater signatures and Pi runtime manifest', path.join(c.desktop, 'scripts/package-smoke.mjs'), [], { env: nativeEnv, timeout: 15 * 60000 });
  const out = path.join(c.base, 'verified-output');
  await node('Collect canonical verified immutable assets', path.join(c.desktop, 'scripts/collect-release-assets.mjs'), [c.target, out, INPUT.desktop.commit, INPUT.core.commit], { env: nativeEnv });
  await upgradeSmoke(c, out);
  // A receipt alone never grants release authority. The external run verifier checks real jobs and bytes.
  save(path.join(out, 'candidate-verification.json'), receipt({ phase: 'verified', target: c.target,
    transport: readJson(path.join(input, 'transport-evidence.json')), signing: r.signing,
    piOnlyPreinstalledRequirementMet: true, nativePackageSmoke: true, publicationAuthorized: false }));
  if (process.platform === 'darwin') fs.copyFileSync(path.join(c.base, 'quarantine-check.json'), path.join(out, 'candidate-quarantine.json'));
  console.log(`CANDIDATE_OUTPUT=${out}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const operation = process.argv[2], c = context();
  const stage = { hydrate, tests, sidecar, build, 'native-dmg': nativeDmg, verify }[operation];
  assert(stage, 'unknown native candidate stage'); await stage(c);
}
