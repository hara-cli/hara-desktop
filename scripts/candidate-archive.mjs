// Validate the full tar stream BEFORE extraction, including PAX/GNU names and link targets.
// A signature check after extracting through a malicious link is too late.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';

const number = bytes => {
  assert(!(bytes[0] & 0x80), 'base-256 tar numbers are not admitted');
  const text = bytes.toString('ascii').replace(/\0.*$/, '').trim();
  assert(/^[0-7]*$/.test(text), 'invalid tar number');
  const value = parseInt(text || '0', 8); assert(Number.isSafeInteger(value) && value >= 0); return value;
};
const string = bytes => bytes.toString('utf8').replace(/\0.*$/, '');
function safeName(name, root) {
  assert(name.length < 16384 && !/[\x00-\x1f\\:]/.test(name) && !name.startsWith('/') && !name.split('/').includes('..'), 'unsafe archive name');
  const n = path.posix.normalize(name.replace(/^(?:\.\/)+/, '')).replace(/\/$/, '');
  assert(n === root || n.startsWith(root + '/'), 'archive entry outside expected root'); return n;
}
function pax(bytes) {
  const result = {}; let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset); assert(space > offset);
    const length = Number(bytes.subarray(offset, space).toString());
    assert(Number.isSafeInteger(length) && length > space - offset + 2 && offset + length <= bytes.length);
    const record = bytes.subarray(space + 1, offset + length); assert.equal(record.at(-1), 10);
    const equal = record.indexOf(61); assert(equal > 0);
    result[record.subarray(0, equal).toString()] = record.subarray(equal + 1, -1).toString(); offset += length;
  }
  return result;
}
export async function validateTar(file, root = 'bundle') {
  const input = fs.createReadStream(file), unzip = createGunzip(); input.on('error', e => unzip.destroy(e)); input.pipe(unzip);
  let buffer = Buffer.alloc(0), remaining = 0, metadata = null, body = [], bodySize = 0, next = {}, count = 0, zeroes = 0;
  const entries = [], names = new Set();
  try {
    for await (const chunk of unzip) {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (remaining) {
          const n = Math.min(remaining, buffer.length); if (!n) break;
          if (metadata && bodySize < metadata.size) { const bytes = buffer.subarray(0, Math.min(n, metadata.size - bodySize)); body.push(bytes); bodySize += bytes.length; }
          remaining -= n; buffer = buffer.subarray(n); if (remaining) break;
          if (metadata) {
            const bytes = Buffer.concat(body);
            if (metadata.type === 'x') next = { ...next, ...pax(bytes) };
            else if (metadata.type === 'g') { const global = pax(bytes); assert(!Object.keys(global).some(k => ['path', 'linkpath', 'size'].includes(k)), 'global path overrides are forbidden'); }
            else next[metadata.type === 'L' ? 'path' : 'linkpath'] = string(bytes).replace(/\n$/, '');
            metadata = null; body = []; bodySize = 0;
          }
        }
        if (buffer.length < 512) break;
        const h = buffer.subarray(0, 512); buffer = buffer.subarray(512);
        if (h.every(b => b === 0)) { zeroes++; continue; }
        assert.equal(zeroes, 0, 'data after tar end marker');
        assert.equal(number(h.subarray(148, 156)), h.reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0), 'tar header checksum mismatch');
        const type = String.fromCharCode(h[156] || 48), size = number(h.subarray(124, 136));
        if (['x', 'g', 'L', 'K'].includes(type)) {
          assert(size > 0 && size <= 65536); metadata = { type, size }; remaining = Math.ceil(size / 512) * 512; continue;
        }
        assert(['0', '2', '5'].includes(type), 'hardlinks/devices/sparse entries are forbidden');
        const name = safeName(next.path ?? [string(h.subarray(345, 500)), string(h.subarray(0, 100))].filter(Boolean).join('/'), root);
        assert(!names.has(name), 'duplicate archive entry'); names.add(name);
        if (next.size !== undefined) assert.equal(Number(next.size), size, 'PAX size override not admitted');
        if (type === '2') {
          const link = next.linkpath ?? string(h.subarray(157, 257));
          assert(link && !/[\x00-\x1f\\:]/.test(link) && !link.startsWith('/'), 'unsafe archive link');
          safeName(path.posix.join(path.posix.dirname(name), link), root);
        }
        entries.push({ name, type }); next = {}; assert(++count < 100000);
        remaining = Math.ceil(size / 512) * 512;
      }
    }
    assert.equal(remaining, 0, 'truncated archive body'); assert.equal(buffer.length, 0, 'truncated archive header');
    assert(zeroes >= 2 && count > 0 && Object.keys(next).length === 0, 'incomplete archive');
    const links = new Set(entries.filter(e => e.type === '2').map(e => e.name));
    for (const { name } of entries) { let ancestor = path.posix.dirname(name); while (ancestor !== '.') { assert(!links.has(ancestor), 'archive writes through a symlink'); ancestor = path.posix.dirname(ancestor); } }
    return entries;
  } finally { input.destroy(); unzip.destroy(); }
}
export function validateExtractedTree(root) {
  const actualRoot = fs.realpathSync(root);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), st = fs.lstatSync(file);
      const relative = path.relative(actualRoot, fs.realpathSync(file));
      assert(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'extracted link escapes root');
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) visit(file);
      else assert(st.isFile() && st.nlink === 1, 'extracted special file/hardlink forbidden');
    }
  };
  visit(actualRoot);
}
