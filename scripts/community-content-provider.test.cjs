'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFreenetContentProvider, sha256Buffer } = require('../freenet-content-provider');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-community-'));
  const library = path.join(root, 'library');
  const source = path.join(root, 'peer.bin');
  const manifest = path.join(root, 'manifest.json');
  const bytes = crypto.randomBytes(1024 * 1024 + 117);
  fs.writeFileSync(source, bytes);

  const chunks = [];
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const value = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    chunks.push({ size: value.length, sha256: sha256Buffer(value), localPath: source });
  }

  // Each localPath is replaced with a dedicated chunk file for the QA-only adapter.
  chunks.forEach((chunk, index) => {
    const offset = index * chunkSize;
    const file = path.join(root, `chunk-${index}.bin`);
    fs.writeFileSync(file, bytes.subarray(offset, offset + chunk.size));
    chunk.localPath = file;
  });

  const asset = {
    id: 'qa-game',
    title: 'QA Game',
    systemId: 'nes',
    systemName: 'Nintendo Entertainment System',
    folder: 'nes',
    fileName: 'qa-game.nes',
    size: bytes.length,
    sha256: sha256Buffer(bytes),
    distributionPolicy: 'community-cache-allowed',
    chunks
  };
  fs.writeFileSync(manifest, JSON.stringify({ payload: { version: 1, generatedAt: Date.now(), assets: [asset] } }, null, 2));

  const provider = createFreenetContentProvider({
    libraryRoot: library,
    cacheRoot: path.join(root, 'cache'),
    bootstrapManifestPath: manifest,
    allowUnsigned: true,
    allowLocalSources: true,
    client: { close: async () => {} }
  });

  assert(provider.findAsset({ folder: 'nes', fileName: 'qa-game.nes' }));
  const systems = provider.catalogSystems();
  assert.strictEqual(systems.length, 1, 'approved community system should be listed');
  const games = provider.catalogGames(systems[0].source);
  assert.strictEqual(games.length, 1, 'approved community game should be listed');
  assert.strictEqual(games[0].id, 0, 'catalog game IDs should be stable numeric indexes');
  const result = await provider.downloadAsset(asset);
  assert.strictEqual(fs.readFileSync(result.file).compare(bytes), 0, 'fallback file must match original bytes');

  fs.rmSync(result.file, { force: true });
  fs.writeFileSync(chunks[1].localPath, Buffer.alloc(chunks[1].size, 0x41));
  await assert.rejects(() => provider.downloadAsset(asset), /verification/i, 'poisoned peer chunk must be rejected');

  console.log('community fallback QA passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
