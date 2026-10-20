// Same native upstream updater SDK, private copies only. No live updater channel writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { ROOT, INPUT, TARGETS, run, sync, save, receipt, fileHash, privateEnvironment, verifyUpdater } from './candidate-common.mjs';
import { validateTar, validateExtractedTree } from './candidate-archive.mjs';

export function updaterTarget(target) {
  assert(TARGETS.includes(target)); return target.startsWith('aarch64') ? 'darwin-aarch64' : target.endsWith('apple-darwin') ? 'darwin-x86_64'
    : target.endsWith('linux-gnu') ? 'linux-x86_64' : 'windows-x86_64';
}
export function updaterPayload(target) {
  assert(TARGETS.includes(target)); return target.startsWith('aarch64') ? 'Hara_aarch64.app.tar.gz' : target.endsWith('apple-darwin') ? 'Hara_x64.app.tar.gz'
    : target.endsWith('linux-gnu') ? `Hara_${INPUT.desktop.version}_amd64.deb` : `Hara_${INPUT.desktop.version}_x64_en-US.msi`;
}
async function downloadPublic(url, file, size, digest) {
  assert(url.startsWith('https://github.com/hara-cli/hara-desktop/releases/download/'));
  await run('Download original public old-App archive', 'curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '600', '--output', file, url], { timeout: 11 * 60000 });
  assert.equal(fs.statSync(file).size, size); assert.equal(`sha256:${fileHash(file)}`, digest);
}
export async function upgradeSmoke(c, assets) {
  const root = path.join(c.base, 'private-upgrades'); fs.mkdirSync(root, { mode: 0o700 });
  const target = updaterTarget(c.target), name = updaterPayload(c.target), payload = path.join(assets, name);
  await verifyUpdater(c, payload, 'private candidate SDK upgrade');
  const signature = fs.readFileSync(payload + '.sig', 'utf8').trim();
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
    if (req.url === '/latest.json') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version: INPUT.desktop.version, notes: 'Private candidate only', pub_date: '2026-10-21T00:00:00Z',
        platforms: { [target]: { signature, url: `http://127.0.0.1:${server.address().port}/payload` } } })); return;
    }
    if (req.url !== '/payload') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Length', fs.statSync(payload).size); fs.createReadStream(payload).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rows = [];
  try {
    await run('Compile unchanged-version native updater SDK probe', 'cargo', ['build', '--locked', '--manifest-path', path.join(ROOT, 'scripts/candidate-updater-probe/Cargo.toml'),
      '--target', c.target, '--target-dir', path.join(c.desktop, 'src-tauri/target')], { env: c.env, timeout: 30 * 60000 });
    const probe = path.join(c.desktop, 'src-tauri/target', c.target, 'debug', `hara-updater-compat-probe${process.platform === 'win32' ? '.exe' : ''}`);
    for (const from of INPUT.upgradeFrom) {
      const directory = path.join(root, from); fs.mkdirSync(directory, { mode: 0o700 });
      await run('Fetch original released updater public config', 'git', ['fetch', '--no-tags', 'origin', `refs/tags/v${from}`], { cwd: c.desktop, env: c.env });
      const config = JSON.parse(sync('git', ['show', 'FETCH_HEAD:src-tauri/tauri.conf.json'], { cwd: c.desktop }));
      assert.equal(config.version, from); assert.equal(config.identifier, 'com.nanhara.hara');
      assert.equal(createHash('sha256').update(config.plugins.updater.pubkey).digest('hex'), INPUT.updaterPublicKeySha256);
      assert.deepEqual(config.plugins.updater.endpoints, ['https://assets.nanhara.com/hara/desktop/stable/latest.json', 'https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json']);
      const configPath = path.join(directory, 'original-public-config.json'); save(configPath, config);
      let exe, originalArchive;
      if (process.platform === 'darwin') {
        // Independent GitHub public release metadata, not an unverified cache or already-upgraded copy.
        const response = JSON.parse(sync('gh', ['api', '--method', 'GET', `repos/hara-cli/hara-desktop/releases/tags/v${from}`]));
        assert.equal(response.tag_name, `v${from}`); assert.equal(response.draft, false); assert.equal(response.prerelease, false);
        const asset = response.assets.find(a => a.name === name); assert(asset); assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
        originalArchive = path.join(directory, name); await downloadPublic(asset.browser_download_url, originalArchive, asset.size, asset.digest);
        await validateTar(originalArchive, 'Hara.app');
        await run('Extract original signed old-App into private upgrade copy', 'tar', ['-xzf', originalArchive, '-C', directory], { env: c.env });
        const app = path.join(directory, 'Hara.app'); exe = path.join(app, 'Contents/MacOS/hara-desktop');
        validateExtractedTree(app);
        assert.equal(fs.realpathSync(exe), exe); assert.equal(sync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]), from);
        sync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      } else {
        // Native SDK comparator/download/signature contract, not a GUI/system-wide installer claim.
        exe = path.join(directory, `private-executable${process.platform === 'win32' ? '.exe' : ''}`);
        fs.copyFileSync(process.execPath, exe);
      }
      const env = privateEnvironment(path.join(directory, 'home'));
      const output = await run('Original SDK detects and verifies candidate privately', probe, [configPath, target, root, exe,
        `http://127.0.0.1:${server.address().port}/latest.json`, INPUT.desktop.version, process.platform === 'darwin' ? 'install' : 'download'], { env, capture: true, timeout: 10 * 60000 });
      const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)); assert.equal(result.from, from); assert.equal(result.to, INPUT.desktop.version);
      assert.equal(result.signatureVerified, true); assert.equal(result.target, target); assert.equal(result.bytes, fs.statSync(payload).size);
      if (process.platform === 'darwin') {
        const app = path.join(directory, 'Hara.app');
        assert.equal(result.privateInstalled, true);
        assert.equal(sync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]), INPUT.desktop.version);
        sync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); sync('/usr/sbin/spctl', ['-a', '-vv', app]);
        await run('Verify privately upgraded App staple', process.execPath, [path.join(c.desktop, 'scripts/stapler-validate.mjs'), app], { env });
      } else assert.equal(result.privateInstalled, false);
      rows.push({ ...result, scope: process.platform === 'darwin' ? 'real-old-App-private-SDK-install' : 'native-original-SDK-download-signature-not-GUI-install',
        payloadSha256: fileHash(payload), ...(originalArchive ? { originalArchiveSha256: fileHash(originalArchive) } : {}) });
    }
    save(path.join(assets, 'candidate-upgrade.json'), receipt({ phase: 'upgrade', target: c.target, rows, liveAppOrHomeChanged: false, publicChannelChanged: false }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
