"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildAsset } = require("./build-community-asset.cjs");
const { normalizePayload } = require("../freenet-content-provider");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-asset-builder-"));
  const file = path.join(root, "qa-homebrew.bin");
  const bytes = crypto.randomBytes(700 * 1024 + 17);
  fs.writeFileSync(file, bytes);
  const asset = await buildAsset({
    file,
    folder: "homebrew",
    title: "QA Homebrew",
    systemId: "homebrew",
    systemName: "Homebrew",
    policy: "open-source",
    chunkSize: 256 * 1024
  });
  assert.strictEqual(asset.chunks.length, 3);
  assert.strictEqual(asset.size, bytes.length);
  assert.strictEqual(asset.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert(asset.chunks.every(chunk => /^[1-9A-HJ-NP-Za-km-z]+\.[A-Za-z0-9_-]+$/.test(chunk.contractKey)));
  const normalized = normalizePayload({ version: 1, generatedAt: Date.now(), assets: [asset] });
  assert.strictEqual(normalized.assets.length, 1);
  console.log("community asset builder QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
