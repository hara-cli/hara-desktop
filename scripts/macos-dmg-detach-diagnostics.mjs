// Read-only, scoped lsof/fuser evidence at the failure, never a force-eject/kill implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
function command(cmd, args, input, stdoutLimit = 32768) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 2500, maxBuffer: 128 * 1024 });
  return { code: r.status, signal: r.signal, error: r.error?.code, stdout: (r.stdout ?? '').slice(0, stdoutLimit), stderr: (r.stderr ?? '').slice(0, 4096) };
}
export function identifyOwnedImage(images, device, creator) {
  assert(/^\/dev\/disk\d+$/.test(device) && /^\d+$/.test(creator));
  const rows = images.filter(row => row['system-entities']?.some(e => e['dev-entry'] === device));
  assert.equal(rows.length, 1, 'Device is absent/ambiguous; do not inspect another image');
  const row = rows[0], image = row['image-path'];
  assert(typeof image === 'string' && basename(image).startsWith(`rw.${creator}.`), 'Not the temporary image made by this exact DMG script');
  const mount = row['system-entities'].find(e => e['mount-point'])?.['mount-point'];
  assert(typeof mount === 'string' && /^\/Volumes\/[^/\r\n\0]+$/.test(mount));
  return { device, image, mount };
}
export function capture(device, creator, code, attempt) {
  const info = command('/usr/bin/hdiutil', ['info', '-plist'], undefined, 128 * 1024); assert.equal(info.code, 0);
  const converted = command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], info.stdout, 128 * 1024); assert.equal(converted.code, 0);
  const mapped = identifyOwnedImage(JSON.parse(converted.stdout).images, device, creator);
  const lsof = command('/usr/sbin/lsof', ['-nP', '-Fpcftn', '+f', '--', mapped.mount]);
  const fuser = command('/usr/bin/fuser', ['-c', mapped.mount]);
  const ids = new Set([...lsof.stdout.matchAll(/^p(\d+)$/gm)].map(m => m[1]));
  for (const id of fuser.stdout.match(/\b\d+\b/g) ?? []) ids.add(id);
  const processes = ids.size ? command('/bin/ps', ['-p', [...ids].join(','), '-o', 'pid=,ppid=,comm=']) : undefined;
  return { at: new Date().toISOString(), ...mapped, creator, detachExit: Number(code), attempt: Number(attempt), uid: process.getuid(), lsof, fuser, processes,
    note: 'No visible holders is not proof that kernel/other-user transient holds are absent; no force or kill requested' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = capture(...process.argv.slice(2));
    const folder = process.env.HARA_DMG_DIAGNOSTICS_DIR;
    if (folder) {
      const st = fs.lstatSync(folder); assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o777) === 0o700);
      fs.writeFileSync(join(folder, `detach-${Date.now()}-${result.attempt}.json`), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
    console.error(JSON.stringify({ dmgDetachDiagnostics: result }));
  } catch (error) { console.error('DMG diagnostic unavailable: ' + error.message); process.exitCode = 1; }
}
