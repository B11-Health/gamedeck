"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFreenetNodeManager, fileSha256, platformKey } = require("../freenet-node-manager");

(async () => {
  assert.strictEqual(platformKey("win32", "x64"), "win32-x64");
  assert.strictEqual(platformKey("linux", "arm64"), "linux-arm64");
  assert.strictEqual(platformKey("darwin", "x64"), "darwin-x64");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamedeck-node-manager-unit-"));
  const sample = path.join(root, "sample.bin");
  fs.writeFileSync(sample, "GameDeck community runtime QA");
  assert.strictEqual(
    await fileSha256(sample),
    crypto.createHash("sha256").update(fs.readFileSync(sample)).digest("hex")
  );

  const manifestPath = path.join(__dirname, "..", "config", "freenet-runtime-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version));
  for (const [key, spec] of Object.entries(manifest.platforms)) {
    assert(/^https:\/\/github\.com\//.test(spec.url), `${key} must use an approved HTTPS release URL`);
    assert(/^[a-f0-9]{64}$/.test(spec.sha256), `${key} must pin SHA-256`);
    assert(Number(spec.size) > 1024 * 1024 && Number(spec.size) < 100 * 1024 * 1024, `${key} size must be bounded`);
  }

  const unsupported = createFreenetNodeManager({
    root: path.join(root, "unsupported"),
    manifestPath,
    platform: "freebsd",
    arch: "x64",
    port: 17609
  });
  assert.strictEqual(unsupported.status().supported, false);
  const result = await unsupported.ensureInstalled();
  assert.strictEqual(result.phase, "unsupported");
  console.log("community node manager unit QA passed");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
