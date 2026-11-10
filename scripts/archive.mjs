#!/usr/bin/env node
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {root} from './build.mjs';
import {exportRelease, releaseTargets} from './export.mjs';

/** RFC 1951 stored blocks + RFC 1952 wrapper. Native zlib builds can emit different
 * compressed bytes on macOS and Linux; a small uncompressed member is reproducible
 * across Node/zlib versions while remaining a standard .tar.gz file. */
export function portableGzip(data) {
  const chunks = [Buffer.from('1f8b08000000000000ff', 'hex')];
  for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
    const length = Math.min(65535, data.length - offset), block = Buffer.alloc(5);
    block[0] = offset + length === data.length ? 1 : 0;
    block.writeUInt16LE(length, 1); block.writeUInt16LE(length ^ 0xffff, 3);
    chunks.push(block, data.subarray(offset, offset + length));
    if (!length) break;
  }
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0); trailer.writeUInt32LE(data.length >>> 0, 4);
  chunks.push(trailer);
  return Buffer.concat(chunks);
}

// Fixed timestamps, ownership, modes and sorted file order keep review hashes reproducible.
export function archive(folder, name) {
  const chunks = [];
  function add(directory, prefix) {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(directory, entry.name), archivePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) { add(path, archivePath); continue; }
      if (!lstatSync(path).isFile() || entry.isSymbolicLink()) throw new Error(`Archive requires regular files: ${archivePath}`);
      if (Buffer.byteLength(archivePath) > 100) throw new Error(`Archive path exceeds USTAR name limit: ${archivePath}`);
      const data = readFileSync(path), header = Buffer.alloc(512);
      const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
      header.write(archivePath, 0, 100, 'utf8');
      octal(/\/(?:bin|scripts)\/.*\.mjs$/.test(archivePath) ? 0o755 : 0o644, 100, 8);
      octal(0, 108, 8); octal(0, 116, 8); octal(data.length, 124, 12); octal(0, 136, 12);
      header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
      const checksum = header.reduce((sum, value) => sum + value, 0);
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
  }
  add(folder, `testsy-${name}`); chunks.push(Buffer.alloc(1024));
  return portableGzip(Buffer.concat(chunks));
}

export function writeArchives({publicAssets = false, check = false} = {}) {
  if (check && !publicAssets) throw new Error('Archive freshness checks require the public assets destination.');
  const repo = resolve(root, '../..');
  if (publicAssets && !['shared/hosts.ts', 'scripts/ops/config-gen.ts', 'apps/landing/public'].every(path => existsSync(join(repo, path)))) {
    throw new Error('Public assets can only be written from the parent Testsy application checkout.');
  }
  const exported = exportRelease();
  const out = publicAssets ? join(repo, 'apps/landing/public/downloads/testsy') : join(exported, 'archives');
  const files = {}, pending = new Map();
  for (const target of releaseTargets) {
    const filename = `testsy-${target}.tar.gz`, data = archive(join(exported, target), target);
    pending.set(filename, data);
    files[filename] = {sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length};
  }
  pending.set('SHA256SUMS', Buffer.from(Object.entries(files).map(([name, value]) => `${value.sha256}  ${name}\n`).join('')));
  const release = JSON.parse(readFileSync(join(exported, 'release.json'), 'utf8'));
  pending.set('release.json', Buffer.from(JSON.stringify({...release, files,
    publication: 'Downloadable integration files. No public directory approval or live-client validation implied.'}, null, 2) + '\n'));
  if (!check) mkdirSync(out, {recursive: true});
  for (const [name, data] of pending) {
    const path = join(out, name);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(data)) throw new Error(`Public integration download is stale: ${name}. Run npm run downloads.`);
    } else writeFileSync(path, data);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--public-assets', '--check-public-assets'].includes(arg)) || args.length > 1) throw new Error('Usage: node scripts/archive.mjs [--public-assets|--check-public-assets]');
  const check = args[0] === '--check-public-assets';
  console.log(`${check ? 'Verified' : 'Prepared'} deterministic integration downloads in ${writeArchives({publicAssets: args.length > 0, check})}`);
}
