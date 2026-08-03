import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const warn = [];
const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const textExtensions = new Set([
  '', '.cjs', '.css', '.gradle', '.html', '.js', '.json', '.md', '.mjs',
  '.srt', '.swift', '.txt', '.xml', '.yaml', '.yml'
]);
const forbiddenTracked = [
  /^node_modules\//,
  /^dist\//,
  /^backups\//,
  /^screenshots\//,
  /^build\/runtime-cache\//,
  /^vault\//,
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:log|tmp)$/i
];
const unfinishedPattern = new RegExp(`\\b(?:${['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK', 'X' + 'XX'].join('|')})\\b`, 'i');
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,})\b/,
  /\b(?:mnemonic|seed phrase)\s*[:=]\s*["'][^"']{20,}["']/i
];

const relativeReference = (sourceFile, reference) => {
  const clean = String(reference || '').trim().replace(/[?#].*$/, '').replace(/^<|>$/g, '');
  if (!clean || clean.startsWith('#') || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:|file:|\/\/)/i.test(clean)) return null;
  if (clean.startsWith('/')) return path.normalize(path.join(path.dirname(sourceFile), clean.slice(1)));
  return path.normalize(path.join(path.dirname(sourceFile), clean));
};

const report = (file, line, message) => {
  fail.push(`${file}${line ? `:${line}` : ''} — ${message}`);
};

for (const file of tracked) {
  if (forbiddenTracked.some(pattern => pattern.test(file))) report(file, 0, 'generated, secret, or local-only path is tracked');

  const absolute = path.join(root, file);
  const buffer = readFileSync(absolute);
  const extension = path.extname(file).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  if (buffer.includes(0)) {
    report(file, 0, 'text file contains a NUL byte');
    continue;
  }

  const text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) report(file, 1, 'UTF-8 BOM is not allowed');

  const crlf = (text.match(/\r\n/g) || []).length;
  const bareLf = (text.match(/(?<!\r)\n/g) || []).length;
  if (crlf && bareLf) report(file, 0, `mixed line endings (${crlf} CRLF, ${bareLf} LF)`);

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const number = index + 1;
    if (/[ \t]+$/.test(line)) report(file, number, 'trailing whitespace');
    if (unfinishedPattern.test(line)) report(file, number, 'unfinished marker');
    if (/\bdebugger\s*;/.test(line)) report(file, number, 'debugger statement');
    if (/\b(?:eval|new Function)\s*\(/.test(line)) report(file, number, 'dynamic code evaluation');
    if (!file.startsWith('scripts/') && /console\.(?:log|debug|trace)\s*\(/.test(line)) {
      report(file, number, 'debug logging outside a CLI/build script');
    }
    if (secretPatterns.some(pattern => pattern.test(line))) report(file, number, 'possible secret material');
  });

  if (extension === '.json') {
    try {
      JSON.parse(text);
    } catch (error) {
      report(file, 0, `invalid JSON: ${error.message}`);
    }
  }

  if (extension === '.css') {
    const scrubbed = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    let depth = 0;
    let minimum = 0;
    for (const character of scrubbed) {
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      minimum = Math.min(minimum, depth);
    }
    if (depth !== 0 || minimum < 0) report(file, 0, `unbalanced CSS braces (depth ${depth}, minimum ${minimum})`);
  }

  if (extension === '.html') {
    const ids = [...text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
    const counts = new Map();
    ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    for (const [id, count] of counts) {
      if (count > 1) report(file, 0, `duplicate DOM id "${id}" (${count} occurrences)`);
    }

    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const resolved = relativeReference(file, match[1]);
      if (resolved && !existsSync(path.join(root, resolved))) report(file, 0, `missing local reference "${match[1]}"`);
    }

    for (const match of text.matchAll(/<a\b([^>]*)>/gi)) {
      const attributes = match[1];
      if (/\btarget\s*=\s*["']_blank["']/i.test(attributes) &&
          !/\brel\s*=\s*["'][^"']*\bnoopener\b[^"']*["']/i.test(attributes)) {
        report(file, 0, 'target="_blank" link is missing rel="noopener"');
      }
    }
  }

  if (extension === '.md') {
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const resolved = relativeReference(file, match[1]);
      if (resolved && !existsSync(path.join(root, resolved))) report(file, 0, `missing local Markdown reference "${match[1]}"`);
    }
  }
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (packageJson.version !== packageLock.version || packageJson.version !== packageLock.packages?.['']?.version) {
  report('package.json', 0, 'package and lockfile versions do not match');
}

for (const required of packageJson.build?.files || []) {
  if (required.includes('*') || required.startsWith('!')) continue;
  if (!existsSync(path.join(root, required))) report('package.json', 0, `build.files entry is missing: ${required}`);
}

const fingerprints = new Map();
for (const file of tracked) {
  const digest = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
  if (!fingerprints.has(digest)) fingerprints.set(digest, []);
  fingerprints.get(digest).push(file);
}
for (const duplicates of fingerprints.values()) {
  if (duplicates.length > 1) warn.push(`identical tracked assets: ${duplicates.join(', ')}`);
}

if (fail.length) {
  console.error(`Repository audit failed with ${fail.length} issue${fail.length === 1 ? '' : 's'}:`);
  fail.forEach(issue => console.error(`- ${issue}`));
  process.exit(1);
}

console.log(`Repository audit passed: ${tracked.length} tracked files, no malformed data, broken local references, duplicate IDs, debug residue, line-ending drift, or secret-like material.`);
if (warn.length) warn.forEach(message => console.log(`Note: ${message}`));
