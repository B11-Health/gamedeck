"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const contracts = [
  {
    name: "community blob",
    manifest: path.join(repoRoot, "contracts", "gamedeck-blob", "Cargo.toml"),
    source: path.join(repoRoot, "contracts", "gamedeck-blob", "target", "wasm32-unknown-unknown", "release", "gamedeck_blob_contract.wasm"),
    target: path.join(repoRoot, "contracts", "gamedeck-blob.wasm")
  },
  {
    name: "community rooms",
    manifest: path.join(repoRoot, "contracts", "gamedeck-rooms", "Cargo.toml"),
    source: path.join(repoRoot, "contracts", "gamedeck-rooms", "target", "wasm32-unknown-unknown", "release", "gamedeck_rooms_contract.wasm"),
    target: path.join(repoRoot, "contracts", "gamedeck-rooms.wasm")
  },
  {
    name: "community chat",
    manifest: path.join(repoRoot, "contracts", "gamedeck-chat", "Cargo.toml"),
    source: path.join(repoRoot, "contracts", "gamedeck-chat", "target", "wasm32-unknown-unknown", "release", "gamedeck_chat_contract.wasm"),
    target: path.join(repoRoot, "contracts", "gamedeck-chat.wasm")
  }
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}

run("rustup", ["target", "add", "wasm32-unknown-unknown"]);
for (const contract of contracts) {
  run("cargo", ["test", "--manifest-path", contract.manifest]);
  run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", contract.manifest]);
  fs.mkdirSync(path.dirname(contract.target), { recursive: true });
  fs.copyFileSync(contract.source, contract.target);
  const bytes = fs.readFileSync(contract.target);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  console.log(`Built ${contract.name}: ${path.relative(repoRoot, contract.target)} (${bytes.length} bytes, sha256 ${digest}).`);
}
