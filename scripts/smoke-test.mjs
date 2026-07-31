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
if (!Array.isArray(JSON.parse(donations).methods)) fail('donation methods must be an array');

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
