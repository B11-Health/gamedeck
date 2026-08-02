import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

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
  const rangeTotal = String(response.headers.get('content-range') || '').match(/\/(\d+)$/);
  const total = rangeTotal ? Number(rangeTotal[1]) : existing + Number(response.headers.get('content-length') || 0);
  if (total > 1024 ** 3) throw new Error(`${label} exceeds the 1 GB safety limit.`);
  const writer = fs.createWriteStream(partial, { flags: existing ? 'a' : 'w' });
  const reader = response.body.getReader();
  let received = existing;
  let lastPercent = -10;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!writer.write(Buffer.from(value))) await new Promise(resolve => writer.once('drain', resolve));
      const percent = total ? Math.floor(received / total * 100) : 0;
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        console.log(`${label}: ${percent}%${existing ? ' (resumed)' : ''}`);
      }
    }
    await new Promise((resolve, reject) => writer.end(error => error ? reject(error) : resolve()));
    fs.renameSync(partial, target);
  } catch (error) {
    writer.destroy();
    throw error;
  }
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
      if (attempt >= 4) throw error;
      console.warn(`${label}: ${error.message}; retrying with resume support.`);
      await sleep(Math.min(12000, 1200 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`${label} could not be cached.`);
}

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
