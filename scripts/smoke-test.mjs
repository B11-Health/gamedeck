import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = file => readFile(path.join(root, file), 'utf8');
const fail = message => {
  console.error(`Smoke test failed: ${message}`);
  process.exitCode = 1;
};

const [main, preload, renderer, html, pkgText, donations] = await Promise.all([
  read('main.js'),
  read('preload.js'),
  read('src/app.js'),
  read('src/index.html'),
  read('package.json'),
  read('config/donations.json')
]);
const pkg = JSON.parse(pkgText);
const donationConfig = JSON.parse(donations);

for (const id of ['games', 'discover', 'community', 'sponsorCard', 'donationMethods', 'settingLibrary']) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
  if (matches.length !== 1) fail(`expected one #${id}, found ${matches.length}`);
}

for (const channel of ['settings', 'save-settings', 'sponsors', 'donations', 'open-external']) {
  if (!main.includes(`'${channel}'`)) fail(`main process is missing ${channel}`);
  const preloadName = channel.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (!preload.includes(preloadName)) fail(`preload bridge is missing ${preloadName}`);
}

if (/C:\\\\Users\\\\[^'"\s]+/i.test(main)) fail('main.js contains a personal Windows user path');
if (!renderer.includes("'community'")) fail('renderer view cycle is missing Community');
if (!pkg.build?.win || !pkg.build?.mac || !pkg.build?.linux) fail('package metadata must configure Windows, macOS, and Linux');
if (!Array.isArray(donationConfig.methods)) fail('donation methods must be an array');
if (donationConfig.enabled && donationConfig.methods.length === 0) fail('enabled donations require at least one public method');

const forbiddenWalletFields = new Set(['privatekey', 'mnemonic', 'seed', 'recoveryphrase', 'keystore', 'password']);
const inspectDonationFields = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenWalletFields.has(key.toLowerCase())) fail(`donation config contains forbidden wallet field: ${key}`);
    inspectDonationFields(nested);
  }
};
inspectDonationFields(donationConfig);

for (const method of donationConfig.methods) {
  if (!method?.label || !method?.address) fail('each donation method requires a label and public address');
  if (method.id === 'evm' && !/^0x[0-9a-fA-F]{40}$/.test(method.address)) fail('EVM donation address is malformed');
}

for (const asset of [
  'assets/branding/gamedeck-mark-source.png',
  'assets/branding/gamedeck-hero.png',
  'build/icon.ico',
  'build/icon.icns',
  'build/icons/512x512.png'
]) {
  try {
    await access(path.join(root, asset));
  } catch {
    fail(`missing required asset: ${asset}`);
  }
}

if (!process.exitCode) console.log('GameDeck smoke test passed.');
