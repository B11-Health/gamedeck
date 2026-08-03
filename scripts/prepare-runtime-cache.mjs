import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config', 'runtime-manifest.json'), 'utf8'));
const requested = process.argv.find(value => value.startsWith('--platform='))?.split('=')[1] || '';

function currentPlatformKey() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)) return `darwin-${process.arch}`;
  return `${process.platform}-${process.arch}`;
}

const keys = requested === 'darwin-universal'
  ? ['darwin-x64', 'darwin-arm64']
  : [requested || currentPlatformKey()];
const allowedHosts = new Set(manifest.allowedHosts || []);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const MAX_RUNTIME_ASSET_BYTES = 1024 ** 3;

function sizeLimitError(label, maxBytes) {
  const limit = maxBytes === MAX_RUNTIME_ASSET_BYTES ? '1 GB' : `${maxBytes} bytes`;
  const error = new Error(`${label} exceeds the ${limit} safety limit.`);
  error.code = 'ERR_RUNTIME_SIZE_LIMIT';
  return error;
}

export async function streamResponseToFile(response, target, {
  existing = 0,
  label = 'Runtime asset',
  maxBytes = MAX_RUNTIME_ASSET_BYTES,
  onProgress = null
} = {}) {
  if (!response?.body) throw new Error(`${label} has no response body.`);
  const rangeTotal = String(response.headers.get('content-range') || '').match(/\/(\d+)$/);
  const contentLength = Number(response.headers.get('content-length') || 0);
  const total = rangeTotal ? Number(rangeTotal[1]) : (contentLength > 0 ? existing + contentLength : 0);
  if (existing > maxBytes || total > maxBytes) {
    fs.rmSync(target, { force: true });
    throw sizeLimitError(label, maxBytes);
  }

  const writer = fs.createWriteStream(target, { flags: existing ? 'a' : 'w' });
  const reader = response.body.getReader();
  let received = existing;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw sizeLimitError(label, maxBytes);
      if (!writer.write(Buffer.from(value))) await new Promise(resolve => writer.once('drain', resolve));
      onProgress?.({ received, total });
    }
    await new Promise((resolve, reject) => writer.end(error => error ? reject(error) : resolve()));
    return { received, total };
  } catch (error) {
    try { await reader.cancel(); } catch {}
    await new Promise(resolve => {
      writer.once('close', resolve);
      writer.destroy();
    });
    if (error?.code === 'ERR_RUNTIME_SIZE_LIMIT') fs.rmSync(target, { force: true });
    throw error;
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadOnce(urlValue, target, label) {
  const url = new URL(urlValue);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error(`Unapproved runtime source: ${url.hostname}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  let existing = 0;
  try { existing = fs.statSync(partial).size; } catch {}
  const headers = { 'user-agent': `GameDeck-build/${manifest.runtimeVersion || 'dev'}` };
  if (existing) headers.range = `bytes=${existing}-`;
  let response = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (existing && response.status !== 206) {
    fs.rmSync(partial, { force: true });
    existing = 0;
    response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': headers['user-agent'] }, signal: AbortSignal.timeout(30 * 60 * 1000) });
  }
  if (!response.ok || !response.body) throw new Error(`${label} failed with HTTP ${response.status}`);
  let lastPercent = -10;
  await streamResponseToFile(response, partial, {
    existing,
    label,
    onProgress: ({ received, total }) => {
      const percent = total ? Math.floor(received / total * 100) : 0;
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        console.log(`${label}: ${percent}%${existing ? ' (resumed)' : ''}`);
      }
    }
  });
  fs.renameSync(partial, target);
}

async function ensureAsset(url, target, label, expected = '') {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      if (!fs.existsSync(target)) await downloadOnce(url, target, label);
      const digest = await sha256(target);
      if (expected && digest !== expected.toLowerCase()) {
        fs.rmSync(target, { force: true });
        throw new Error(`${label} failed SHA-256 verification.`);
      }
      return { sha256: digest, size: fs.statSync(target).size };
    } catch (error) {
      if (error?.code === 'ERR_RUNTIME_SIZE_LIMIT' || attempt >= 4) throw error;
      console.warn(`${label}: ${error.message}; retrying with resume support.`);
      await sleep(Math.min(12000, 1200 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`${label} could not be cached.`);
}

export async function main() {
  for (const platformKey of keys) {
    const spec = manifest.platforms[platformKey];
    if (!spec) throw new Error(`No runtime manifest exists for ${platformKey}.`);
    const platformRoot = path.join(root, 'build', 'runtime-cache', platformKey);
    const index = { schemaVersion: 1, platformKey, runtimeVersion: manifest.runtimeVersion, generatedAt: new Date().toISOString(), assets: {} };
    console.log(`Preparing full GameDeck runtime for ${platformKey}…`);

    for (const component of spec.components.filter(item => item.required !== false)) {
      if (component.type === 'core-set') {
        for (const name of component.files || []) {
          const url = `${String(component.baseUrl).replace(/\/$/, '')}/${name}`;
          const target = path.join(platformRoot, component.id, name);
          index.assets[url] = await ensureAsset(url, target, `${component.label}: ${name}`);
        }
      } else {
        const name = path.basename(new URL(component.url).pathname);
        const target = path.join(platformRoot, component.id, name);
        index.assets[component.url] = await ensureAsset(component.url, target, component.label, component.sha256 || '');
      }
    }

    fs.mkdirSync(platformRoot, { recursive: true });
    fs.writeFileSync(path.join(platformRoot, 'cache-index.json'), JSON.stringify(index, null, 2));
    const bytes = Object.values(index.assets).reduce((sum, asset) => sum + Number(asset.size || 0), 0);
    console.log(`${platformKey}: full runtime cached (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
