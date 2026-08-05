'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalize, createFreenetContentProvider, sha256Buffer } = require('../freenet-content-provider');

function rawPublicKey(key) {
  const der = key.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}

(async () => {
  const nodeUrl = process.env.GAMEDECK_FREENET_LIVE_URL;
  if (!nodeUrl) throw new Error('Set GAMEDECK_FREENET_LIVE_URL to the local Freenet WebSocket endpoint.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-freenet-live-'));
  const sourceLibrary = path.join(root, 'source-library');
  const targetLibrary = path.join(root, 'target-library');
  const sourceFile = path.join(sourceLibrary, 'homebrew', 'gamedeck-network-qa.bin');
  const contract = path.join(__dirname, '..', 'contracts', 'gamedeck-blob.wasm');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  const totalBytes = Number(process.env.GAMEDECK_FREENET_LIVE_BYTES || (768 * 1024 + 137));
  const bytes = crypto.randomBytes(totalBytes);
  fs.writeFileSync(sourceFile, bytes);
  const chunks = [];
  const chunkSize = Number(process.env.GAMEDECK_FREENET_LIVE_CHUNK_SIZE || (192 * 1024));
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const value = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    chunks.push({ size: value.length, sha256: sha256Buffer(value) });
  }
  const asset = {
    id: 'gamedeck-network-qa',
    title: 'GameDeck Network QA',
    systemId: 'homebrew',
    systemName: 'Homebrew',
    folder: 'homebrew',
    fileName: 'gamedeck-network-qa.bin',
    size: bytes.length,
    sha256: sha256Buffer(bytes),
    distributionPolicy: 'open-source',
    listed: true,
    chunks
  };
  const seedManifest = path.join(root, 'seed-manifest.json');
  fs.writeFileSync(seedManifest, JSON.stringify({ payload: { version: 1, generatedAt: Date.now(), assets: [asset] } }, null, 2));
  const seeder = createFreenetContentProvider({
    libraryRoot: sourceLibrary,
    cacheRoot: path.join(root, 'seed-cache'),
    bootstrapManifestPath: seedManifest,
    contractWasmPath: contract,
    nodeUrl,
    allowUnsigned: true,
    appVersion: 'live-qa'
  });
  const seeded = await seeder.seedAsset(asset, sourceFile);
  assert.strictEqual(seeded.seeded, true);
  assert.strictEqual(seeded.contractKeys.length, chunks.length);
  const networkAsset = { ...asset, chunks: chunks.map((chunk, index) => ({ ...chunk, contractKey: seeded.contractKeys[index] })) };
  const payload = { version: 1, generatedAt: Date.now(), assets: [networkAsset] };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signature = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKey).toString('base64');
  const manifest = path.join(root, 'network-manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ payload, signature: { algorithm: 'ed25519', keyId: 'live-qa', value: signature } }, null, 2));
  const receiver = createFreenetContentProvider({
    libraryRoot: targetLibrary,
    cacheRoot: path.join(root, 'receive-cache'),
    bootstrapManifestPath: manifest,
    contractWasmPath: contract,
    nodeUrl,
    trustedKeys: { 'live-qa': rawPublicKey(publicKey) },
    appVersion: 'live-qa'
  });
  const approved = receiver.findAsset({ folder: networkAsset.folder, fileName: networkAsset.fileName, expectedSha256: networkAsset.sha256 });
  assert(approved, 'signed network asset should be approved');
  const result = await receiver.downloadAsset(approved);
  assert.strictEqual(fs.readFileSync(result.file).compare(bytes), 0, 'live Freenet retrieval must match the seeded bytes');
  await seeder.close();
  await receiver.close();
  console.log(JSON.stringify({ ok: true, bytes: bytes.length, chunks: chunks.length, contractKeys: seeded.contractKeys, file: result.file }, null, 2));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
