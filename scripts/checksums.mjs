import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const label = String(process.argv[2] || `${process.platform}-${process.arch}`).replace(/[^a-z0-9._-]/gi, '-');
const directory = path.resolve('dist');
const ignored = new Set(['builder-debug.yml']);
const entries = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && !entry.name.endsWith('.blockmap') && !entry.name.startsWith('SHA256SUMS-') && !ignored.has(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

const digest = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const rows = [];
for (const name of entries) rows.push(`${await digest(path.join(directory, name))}  ${name}`);
if (!rows.length) throw new Error('No release artifacts were found for checksums.');
const output = path.join(directory, `SHA256SUMS-${label}.txt`);
await writeFile(output, `${rows.join('\n')}\n`);
console.log(`Wrote ${output}`);
