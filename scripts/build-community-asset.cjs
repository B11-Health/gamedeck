"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ContractKey } = require("@freenetorg/freenet-stdlib");
const { buildBlobParameters, sha256Buffer } = require("../freenet-content-provider");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function deriveContractKey(contractWasm, parameters) {
  const { blake3 } = await import("@noble/hashes/blake3.js");
  const codeHash = Uint8Array.from(blake3(Uint8Array.from(contractWasm)));
  const instanceId = Uint8Array.from(blake3(Uint8Array.from(Buffer.concat([Buffer.from(codeHash), Buffer.from(parameters)]))));
  const key = new ContractKey(instanceId, codeHash);
  return `${key.encode()}.${Buffer.from(codeHash).toString("base64url")}`;
}

async function buildAsset(options) {
  const file = path.resolve(options.file);
  const contractFile = path.resolve(options.contractFile || path.join(__dirname, "..", "contracts", "gamedeck-blob.wasm"));
  const bytes = fs.readFileSync(file);
  if (!bytes.length) throw new Error("Community asset cannot be empty.");
  const contractWasm = fs.readFileSync(contractFile);
  const chunkSize = Math.max(64 * 1024, Math.min(64 * 1024 * 1024, Number(options.chunkSize || 4 * 1024 * 1024)));
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    const sha256 = sha256Buffer(chunk);
    chunks.push({
      size: chunk.length,
      sha256,
      contractKey: await deriveContractKey(contractWasm, buildBlobParameters(sha256, chunk.length))
    });
  }
  const folder = String(options.folder || "").trim();
  if (!folder || /[\\/\0]/.test(folder)) throw new Error("A safe library folder is required.");
  const fileName = String(options.fileName || path.basename(file)).trim();
  if (!fileName || /[\\/\0]/.test(fileName)) throw new Error("A safe filename is required.");
  return {
    id: String(options.id || `${folder}:${fileName}`).slice(0, 240),
    title: String(options.title || path.parse(fileName).name).slice(0, 240),
    systemId: String(options.systemId || folder).slice(0, 64),
    systemName: String(options.systemName || options.systemId || folder).slice(0, 120),
    folder,
    fileName,
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    distributionPolicy: String(options.policy || "community-cache-allowed"),
    listed: options.listed !== false,
    chunks
  };
}

async function main() {
  const file = argument("file");
  const folder = argument("folder");
  const output = argument("output");
  if (!file || !folder || !output) {
    throw new Error("Usage: node scripts/build-community-asset.cjs --file game.bin --folder homebrew --output asset.json [--title Name --system-id homebrew --system-name Homebrew --policy open-source --chunk-size 4194304]");
  }
  const asset = await buildAsset({
    file,
    folder,
    id: argument("id"),
    title: argument("title"),
    fileName: argument("file-name"),
    systemId: argument("system-id"),
    systemName: argument("system-name"),
    policy: argument("policy", "community-cache-allowed"),
    chunkSize: Number(argument("chunk-size", 4 * 1024 * 1024)),
    listed: argument("listed", "true") !== "false"
  });
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(asset, null, 2)}\n`);
  console.log(`Built community asset manifest for ${asset.title}: ${asset.chunks.length} chunks, ${asset.size} bytes.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { buildAsset, deriveContractKey };
