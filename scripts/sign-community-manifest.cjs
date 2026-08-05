'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize } = require('../freenet-content-provider');

function argument(name) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const input = argument('input');
const output = argument('output') || input;
const keyFile = argument('key');
const keyId = argument('key-id') || 'gamedeck-release';
if (!input || !output || !keyFile) {
  throw new Error('Usage: node scripts/sign-community-manifest.cjs --input payload.json --output manifest.json --key private-key.pem [--key-id gamedeck-release]');
}
const source = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const payload = source.payload || source;
if (!payload || !Array.isArray(payload.assets)) throw new Error('Manifest payload must contain an assets array.');
const privateKey = crypto.createPrivateKey(fs.readFileSync(path.resolve(keyFile), 'utf8'));
const signature = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), privateKey).toString('base64');
const envelope = { payload, signature: { algorithm: 'ed25519', keyId, value: signature } };
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(path.resolve(output), JSON.stringify(envelope, null, 2) + '\n');
console.log('Signed ' + input + ' as ' + output + ' with key ' + keyId + '.');
