// GNU tar treats a Windows drive letter in -f as a remote host. Keep the archive
// basename local via cwd, using the same operands on GNU tar and bsdtar.
import assert from 'node:assert/strict';
import path from 'node:path';
import { run } from './candidate-common.mjs';

export function localTarInvocation(operation, archive, directory, entries = [], platform = process.platform) {
  assert(['create', 'extract'].includes(operation), 'unsupported local tar operation');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  for (const value of [archive, directory]) {
    assert(typeof value === 'string' && value.length <= 32767 && !/[\x00-\x1f\x7f]/.test(value)
      && paths.isAbsolute(value), 'absolute local tar path required');
    if (platform === 'win32') assert(/^[A-Za-z]:[\\/]/.test(value), 'local drive path required');
  }
  const name = paths.basename(archive);
  assert(name && !/[\\/:]/.test(name) && !['.', '..'].includes(name), 'local archive basename required');
  assert(Array.isArray(entries) && (operation === 'create' ? entries.length > 0 : entries.length === 0), 'invalid tar entries');
  for (const entry of entries) assert(typeof entry === 'string' && entry.length > 0
    && !/[\\:\x00-\x1f\x7f]/.test(entry) && !entry.startsWith('-') && !path.posix.isAbsolute(entry)
    && !entry.split('/').some(part => !part || part === '.' || part === '..'), 'relative tar entry required');
  // path.relative() cannot cross drives. -C accepts an absolute directory; only -f must lack a colon.
  const localDirectory = platform === 'win32' ? paths.normalize(directory).replaceAll('\\', '/') : directory;
  return { cwd: paths.dirname(archive), args: [operation === 'create' ? '-czf' : '-xzf', `./${name}`, '-C', localDirectory, '--', ...entries] };
}

export async function runLocalTar(label, operation, archive, directory, entries = [], options = {}) {
  const { cwd, args } = localTarInvocation(operation, archive, directory, entries);
  return run(label, 'tar', args, { ...options, cwd });
}
