import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const included = (pkg.build?.files || []).filter(item => typeof item === 'string' && !item.startsWith('!'));
const localRequires = [...mainSource.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)]
  .map(match => match[1])
  .map(specifier => specifier.replace(/^\.\//, ''))
  .map(specifier => path.extname(specifier) ? specifier : specifier + '.js')
  .filter(file => fs.existsSync(path.join(root, file)));

function covered(file) {
  return included.some(pattern => {
    if (pattern === file) return true;
    if (pattern.endsWith('/**/*')) return file.startsWith(pattern.slice(0, -4));
    if (pattern === '**/*') return true;
    return false;
  });
}

const unique = [...new Set(localRequires)].sort();
const missing = unique.filter(file => !covered(file));
assert.deepEqual(missing, [], 'Packaged build omits local main-process modules: ' + missing.join(', '));
console.log('package files contract: ' + unique.length + ' local main-process modules covered');
