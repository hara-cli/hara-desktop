// Same native upstream updater SDK, private copies only. No live updater channel writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { ROOT, INPUT, TARGETS, run, sync, save, receipt, fileHash, verifyUpdater } from './candidate-common.mjs';
import { validateTar, validateExtractedTree } from './candidate-archive.mjs';
import { runLocalTar } from './candidate-local-tar.mjs';

// Consume an explicitly provisioned evidence environment; never allocate a system temp root.
// Kept here so the upgrade probe and its two fixture suites share the same path contract.
export function gateEvidence(evidenceRoot, { env = process.env, io = fs, paths = path,
  accountHome = os.userInfo().homedir, ownerUid = process.getuid?.(), cleanup = 'keep' } = {}) {
  assert.equal(cleanup, 'keep', 'gate evidence must be retained');
  const folded = value => value.replaceAll('\\', '/').toLowerCase();
  const denied = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders',
    paths.join(accountHome, 'Library', 'Caches'), paths.join(accountHome, '.hara')].map(folded);
  function lexical(value) {
    assert(typeof value === 'string' && paths.isAbsolute(value) && !value.includes('\0')
      && !value.split(/[\\/]/).includes('..') && paths.normalize(value) === value, 'explicit canonical evidence path required');
    assert(!denied.some(prefix => { const f = folded(value); return f === prefix || f.startsWith(prefix + '/'); }), 'forbidden evidence prefix');
    return value;
  }
  const root = lexical(evidenceRoot), home = paths.join(root, 'synthetic-home'), tmp = paths.join(root, 'tmp');
  const inside = (base, value) => {
    const relative = paths.relative(base, value);
    return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + paths.sep));
  };
  const authority = { USERPROFILE: home, CFFIXED_USER_HOME: home, HARA_HOME: paths.join(home, '.hara'),
    XDG_CONFIG_HOME: paths.join(home, '.config'), XDG_DATA_HOME: paths.join(home, '.local', 'share'),
    XDG_CACHE_HOME: paths.join(home, '.cache'), npm_config_cache: paths.join(home, '.npm'),
    npm_config_userconfig: paths.join(home, '.npmrc'), npm_config_globalconfig: paths.join(home, '.npmrc-global'),
    npm_config_prefix: paths.join(home, '.local'), TMP: tmp, TEMP: tmp,
    // Toolchain discovery uses the account, even when HOME is the evidence synthetic-home.
    RUSTUP_HOME: env.RUSTUP_HOME ?? paths.join(accountHome, '.rustup'),
    CARGO_HOME: env.CARGO_HOME ?? paths.join(accountHome, '.cargo'),
    CANDIDATE_EVIDENCE_ROOT: root, HARA_WRAPPER_EVIDENCE_ROOT: root, HOME: home, TMPDIR: tmp };
  function boundEnvironment(value) {
    assert(value && [value.CANDIDATE_EVIDENCE_ROOT, value.HARA_WRAPPER_EVIDENCE_ROOT].some(v => v === root), 'explicit evidence binding required');
    for (const key of ['CANDIDATE_EVIDENCE_ROOT', 'HARA_WRAPPER_EVIDENCE_ROOT'])
      assert(value[key] === undefined || value[key] === root, 'conflicting evidence binding');
    for (const key of ['HOME', 'USERPROFILE', 'CFFIXED_USER_HOME', 'HARA_HOME', 'TMPDIR', 'TMP', 'TEMP'])
      assert.equal(value[key], authority[key], 'private evidence environment mismatch');
  }
  // Refuse a missing/poisoned binding before the first filesystem access, not after mkdir.
  boundEnvironment(env);
  const directoryIdentity = value => {
    const st = io.lstatSync(value, { bigint: true });
    assert(st.isDirectory() && !st.isSymbolicLink(), 'evidence directory required; links refused');
    if (ownerUid !== undefined) assert(Number(st.uid) === ownerUid && (Number(st.mode) & 0o022) === 0, 'unsafe evidence directory owner or mode');
    assert.equal(io.realpathSync(value), value, 'evidence path alias refused');
    return [st.dev, st.ino, st.uid].map(String).join(':');
  };
  const anchors = new Map([root, home, tmp].map(value => [value, directoryIdentity(value)]));
  function unchanged() {
    boundEnvironment(env);
    for (const [value, identity] of anchors) assert.equal(directoryIdentity(value), identity, 'evidence directory identity changed');
  }
  function checked(value, { missing = false, directory = false } = {}) {
    lexical(value);
    assert([home, tmp].some(base => inside(base, value)), 'outside evidence whitelist');
    unchanged();
    let cursor = root;
    const parts = paths.relative(root, value).split(paths.sep);
    for (let i = 0; i < parts.length; i++) {
      cursor = paths.join(cursor, parts[i]);
      let st;
      try { st = io.lstatSync(cursor, { bigint: true }); }
      catch (error) { if (missing && error.code === 'ENOENT') return value; throw error; }
      assert(!st.isSymbolicLink(), 'evidence symlink refused');
      if (ownerUid !== undefined) assert(Number(st.uid) === ownerUid && (!st.isDirectory() || (Number(st.mode) & 0o022) === 0), 'unsafe evidence owner or mode');
      assert.equal(io.realpathSync(cursor), cursor, 'evidence path alias refused');
      if (i < parts.length - 1 || directory) assert(st.isDirectory(), 'evidence parent must be a directory');
      else assert(st.isDirectory() || (st.isFile() && Number(st.nlink) === 1), 'special or hardlinked evidence file refused');
    }
    return value;
  }
  function assertEnvironment(value) {
    boundEnvironment(value); unchanged();
    for (const [key, expected] of Object.entries(authority)) assert.equal(value[key], expected, 'private environment authority changed');
  }
  function environment(extra = {}) {
    unchanged();
    // Path refs only (never secret values). Unlock helper needs these after credential strip;
    // PASSWORD in SIGNING_PASSWORD_FILE would otherwise match the generic scrub below.
    const preservedHara = new Set(['HARA_NPM_CI_ATTEMPTS', 'HARA_NPM_CI_IGNORE_SCRIPTS',
      'HARA_CANDIDATE_SIGNING_KEYCHAIN', 'HARA_CANDIDATE_SIGNING_PASSWORD_FILE']);
    const value = { ...env, ...extra }, keys = new Set(Object.keys(authority).map(key => key.toLowerCase()));
    for (const key of Object.keys(value)) {
      if (preservedHara.has(key)) continue;
      if (keys.has(key.toLowerCase()) || /TOKEN|API_KEY|PASSWORD|PRIVATE_KEY|SECRET|CREDENTIAL|^APPLE_|^AWS_|^ALIYUN_|^npm_config_.*auth/i.test(key)
        || /^(?:NODE_OPTIONS|NODE_PATH|NODE_COMPILE_CACHE|BASH_ENV|ENV|LD_PRELOAD|DYLD_.*|SSH_AUTH_SOCK|SSH_AGENT_PID|GIT_ASKPASS)$/i.test(key)
        || /^HARA_/i.test(key)) delete value[key];
    }
    // Private authority is assigned only after all inherited/caller-controlled entries.
    return Object.freeze({ ...value, NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', NODE_DISABLE_COMPILE_CACHE: '1', ...authority });
  }
  function mkdir(value) {
    checked(value, { missing: true }); checked(paths.dirname(value), { directory: true });
    io.mkdirSync(value, { mode: 0o700 }); checked(value, { directory: true });
    anchors.set(value, directoryIdentity(value)); return value;
  }
  function fixture(label) {
    assert(/^[a-z][a-z0-9-]{0,47}$/.test(label), 'safe fixture label required'); unchanged();
    const value = paths.join(tmp, label + '-' + randomBytes(6).toString('base64url').slice(0, 6));
    return mkdir(value); // Exclusive leaf, same six-character suffix budget, retained on every outcome.
  }
  function guardSync(value, operation) {
    assertEnvironment(value);
    try { return operation(); } finally { assertEnvironment(value); }
  }
  async function guard(value, operation) {
    assertEnvironment(value);
    try { return await operation(); } finally { assertEnvironment(value); }
  }
  return Object.freeze({ root, home, tmp, cleanup: 'keep', deletionEnabled: false,
    environment, assertEnvironment, checked, mkdir, fixture, guard, guardSync });
}

export function updaterTarget(target) {
  assert(TARGETS.includes(target)); return target.startsWith('aarch64') ? 'darwin-aarch64' : target.endsWith('apple-darwin') ? 'darwin-x86_64'
    : target.endsWith('linux-gnu') ? 'linux-x86_64' : 'windows-x86_64';
}
export function updaterPayload(target) {
  assert(TARGETS.includes(target)); return target.startsWith('aarch64') ? 'Hara_aarch64.app.tar.gz' : target.endsWith('apple-darwin') ? 'Hara_x64.app.tar.gz'
    : target.endsWith('linux-gnu') ? `Hara_${INPUT.desktop.version}_amd64.deb` : `Hara_${INPUT.desktop.version}_x64_en-US.msi`;
}
async function downloadPublic(url, file, size, digest, command) {
  assert(url.startsWith('https://github.com/hara-cli/hara-desktop/releases/download/'));
  await command('Download original public old-App archive', 'curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '600', '--output', file, url], { timeout: 11 * 60000 });
  assert.equal(fs.statSync(file).size, size); assert.equal(`sha256:${fileHash(file)}`, digest);
}
export async function upgradeSmoke(c, assets) {
  const scope = gateEvidence(c.evidenceRoot ?? c.env?.CANDIDATE_EVIDENCE_ROOT ?? c.env?.HARA_WRAPPER_EVIDENCE_ROOT, { env: c.env });
  scope.checked(c.base, { directory: true });
  scope.checked(assets, { directory: true });
  const env = scope.environment({ CANDIDATE_OUTPUT_DIR: c.base });
  const command = (label, executable, args, options = {}) => scope.guard(env, () => run(label, executable, args, { ...options, env }));
  const synchronous = (executable, args, options = {}) => scope.guardSync(env, () => sync(executable, args, { ...options, env }));
  const root = scope.mkdir(path.join(c.base, 'private-upgrades'));
  const target = updaterTarget(c.target), name = updaterPayload(c.target), payload = path.join(assets, name);
  await scope.guard(env, () => verifyUpdater({ ...c, env }, payload, 'private candidate SDK upgrade'));
  const signature = fs.readFileSync(payload + '.sig', 'utf8').trim();
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
    if (req.url === '/latest.json') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version: INPUT.desktop.version, notes: 'Private candidate only', pub_date: '2025-01-02T03:04:05Z',
        platforms: { [target]: { signature, url: `http://127.0.0.1:${server.address().port}/payload` } } })); return;
    }
    if (req.url !== '/payload') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Length', fs.statSync(payload).size); fs.createReadStream(payload).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rows = [];
  try {
    await command('Compile unchanged-version native updater SDK probe', 'cargo', ['build', '--locked', '--manifest-path', path.join(ROOT, 'scripts/candidate-updater-probe/Cargo.toml'),
      '--target', c.target, '--target-dir', path.join(c.desktop, 'src-tauri/target')], { timeout: 30 * 60000 });
    const probe = path.join(c.desktop, 'src-tauri/target', c.target, 'debug', `hara-updater-compat-probe${process.platform === 'win32' ? '.exe' : ''}`);
    for (const from of INPUT.upgradeFrom) {
      const directory = scope.mkdir(path.join(root, from));
      await command('Fetch original released updater public config', 'git', ['fetch', '--no-tags', 'origin', `refs/tags/v${from}`], { cwd: c.desktop });
      const config = JSON.parse(synchronous('git', ['show', 'FETCH_HEAD:src-tauri/tauri.conf.json'], { cwd: c.desktop }));
      assert.equal(config.version, from); assert.equal(config.identifier, 'com.nanhara.hara');
      assert.equal(createHash('sha256').update(config.plugins.updater.pubkey).digest('hex'), INPUT.updaterPublicKeySha256);
      assert.deepEqual(config.plugins.updater.endpoints, ['https://assets.nanhara.com/hara/desktop/stable/latest.json', 'https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json']);
      const configPath = path.join(directory, 'original-public-config.json'); save(configPath, config);
      let exe, originalArchive;
      if (process.platform === 'darwin') {
        // Independent GitHub public release metadata, not an unverified cache or already-upgraded copy.
        const response = JSON.parse(synchronous('gh', ['api', '--method', 'GET', `repos/hara-cli/hara-desktop/releases/tags/v${from}`]));
        assert.equal(response.tag_name, `v${from}`); assert.equal(response.draft, false); assert.equal(response.prerelease, false);
        const asset = response.assets.find(a => a.name === name); assert(asset); assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
        originalArchive = path.join(directory, name); await downloadPublic(asset.browser_download_url, originalArchive, asset.size, asset.digest, command);
        await validateTar(originalArchive, 'Hara.app');
        await scope.guard(env, () => runLocalTar('Extract original signed old-App into private upgrade copy', 'extract', originalArchive, directory, [], { env }));
        const app = path.join(directory, 'Hara.app'); exe = path.join(app, 'Contents/MacOS/hara-desktop');
        validateExtractedTree(app);
        assert.equal(fs.realpathSync(exe), exe); assert.equal(synchronous('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]), from);
        synchronous('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      } else {
        // Native SDK comparator/download/signature contract, not a GUI/system-wide installer claim.
        exe = path.join(directory, `private-executable${process.platform === 'win32' ? '.exe' : ''}`);
        fs.copyFileSync(process.execPath, exe);
      }
      const output = await command('Original SDK detects and verifies candidate privately', probe, [configPath, target, directory, exe,
        `http://127.0.0.1:${server.address().port}/latest.json`, INPUT.desktop.version, process.platform === 'darwin' ? 'install' : 'download'], { capture: true, timeout: 10 * 60000 });
      const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)); assert.equal(result.from, from); assert.equal(result.to, INPUT.desktop.version);
      assert.equal(result.signatureVerified, true); assert.equal(result.target, target); assert.equal(result.bytes, fs.statSync(payload).size);
      if (process.platform === 'darwin') {
        const app = path.join(directory, 'Hara.app');
        assert.equal(result.privateInstalled, true);
        assert.equal(synchronous('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]), INPUT.desktop.version);
        synchronous('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); synchronous('/usr/sbin/spctl', ['-a', '-vv', app]);
        await command('Verify privately upgraded App staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), app]);
      } else assert.equal(result.privateInstalled, false);
      rows.push({ ...result, scope: process.platform === 'darwin' ? 'real-old-App-private-SDK-install' : 'native-original-SDK-download-signature-not-GUI-install',
        payloadSha256: fileHash(payload), ...(originalArchive ? { originalArchiveSha256: fileHash(originalArchive) } : {}) });
    }
    save(path.join(assets, 'candidate-upgrade.json'), receipt({ phase: 'upgrade', target: c.target, rows, liveAppOrHomeChanged: false, publicChannelChanged: false }));
  } finally {
    try { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    finally { scope.assertEnvironment(env); }
  }
}
