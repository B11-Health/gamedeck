"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const contracts = [
  { name: "community blob", file: path.join(__dirname, "..", "contracts", "gamedeck-blob.wasm") },
  { name: "community rooms", file: path.join(__dirname, "..", "contracts", "gamedeck-rooms.wasm") },
  { name: "community chat", file: path.join(__dirname, "..", "contracts", "gamedeck-chat.wasm") }
];
const required = ["memory", "__frnt__initiate_buffer", "validate_state", "update_state", "summarize_state", "get_state_delta"];
for (const contract of contracts) {
  assert(fs.existsSync(contract.file), `${contract.name} contract is missing. Run npm run freenet:contract.`);
  const bytes = fs.readFileSync(contract.file);
  assert(bytes.length > 1024, `${contract.name} contract is unexpectedly small.`);
  const wasmModule = new WebAssembly.Module(bytes);
  const exportedNames = new Set(WebAssembly.Module.exports(wasmModule).map(item => item.name));
  for (const name of required) assert(exportedNames.has(name), `${contract.name} contract is missing export ${name}.`);
  console.log(`${contract.name} contract verified: ${bytes.length} bytes, sha256 ${crypto.createHash("sha256").update(bytes).digest("hex")}`);
}
