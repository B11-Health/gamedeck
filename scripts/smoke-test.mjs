import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = file => readFile(path.join(root, file), 'utf8');
const fail = message => {
  console.error(`Smoke test failed: ${message}`);
  process.exitCode = 1;
};

const [main, preload, renderer, html, styles, pkgText, donations] = await Promise.all([
  read('main.js'),
  read('preload.js'),
  read('src/app.js'),
  read('src/index.html'),
  read('src/styles.css'),
  read('package.json'),
  read('config/donations.json')
]);
const pkg = JSON.parse(pkgText);
const donationConfig = JSON.parse(donations);

for (const id of [
  'games',
  'discover',
  'community',
  'sponsorCard',
  'donationMethods',
  'settingLibrary',
  'mainContent',
  'sidebarToggle',
  'densityToggle',
  'libraryToolbar',
  'heroResume',
  'heroDiscover',
  'spotlightSource',
  'heroDiscover',
  'spotlightSource',
  'heroResumeLabel',
  'heroResume',
  'loadingPhase',
  'loadingStepLibrary',
  'loadingStepLaunchers',
  'loadingStepArtwork',
  'loadingStepControls',
  'setupToggle',
  'setupCoach',
  'setupSteps',
  'surpriseMe',
  'communitySettings',
  'gameSort',
  'resultCount',
  'emptyTitle',
  'arcadeDeck',
  'arcadeAuditButton',
  'openArcadeGuide',
  'openArcadeFeedback',
  'spotlightArtwork',
  'spotlightDetails',
  'arcadeControllerState',
  'settingMame'
]) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
  if (matches.length !== 1) fail(`expected one #${id}, found ${matches.length}`);
}

for (const channel of ['settings', 'save-settings', 'sponsors', 'donations', 'open-external', 'arcade-audit', 'refresh-game-details', 'choose-game-artwork']) {
  if (!main.includes(`'${channel}'`)) fail(`main process is missing ${channel}`);
  const preloadName = channel.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (!preload.includes(preloadName)) fail(`preload bridge is missing ${preloadName}`);
}

if (!main.includes('configuredEmulator') || !main.includes("launchMode: 'mame'") || !main.includes("'-nowindow'")) fail('standalone MAME routing is missing');
if (!main.includes("'.bs'")) fail('Satellaview .bs ROM support is missing');
if (!main.includes('catalogFileIdentities') || !main.includes('installedCatalogFile')) fail('catalog path identity matching is missing');
if (!main.includes('inspectArcadeArchive') || !renderer.includes('renderArcadeDeck')) fail('arcade health diagnostics are missing');
if (!preload.includes('onArcadeAudit')) fail('arcade audit progress bridge is missing');

if (/C:\\\\Users\\\\[^'"\s]+/i.test(main)) fail('main.js contains a personal Windows user path');
if (!renderer.includes("'community'")) fail('renderer view cycle is missing Community');
if (!renderer.includes("setAttribute('aria-current', 'page')")) fail('main navigation must expose the active view accessibly');
if (!renderer.includes('GAME_SORTS')) fail('renderer is missing persistent library sorting');
if (!renderer.includes('sidebar-collapsed')) fail('renderer is missing the collapsible systems rail');
if (!html.includes('toast-message') || !renderer.includes('updateScrollChrome')) fail('polished feedback and sticky toolbar behavior are missing');
if (!renderer.includes('missing-art') || !renderer.includes('art-status')) fail('library artwork quality states are missing');
if (!renderer.includes('renderSetupCoach') || !renderer.includes('setupReadiness')) fail('renderer is missing the zero-hassle ready check');
if (!renderer.includes('loadingStepLibrary') || !renderer.includes('loadingPhase')) fail('renderer is missing staged startup progress');
if (html.includes('loading-orbit') || html.includes('loading-console') || styles.includes('loadingSpin') || styles.includes('bootSweep')) fail('legacy animated loading spinner styles must stay removed');
if (!html.includes('boot-panel') || !styles.includes('.loading-steps')) fail('premium status-driven boot panel is missing');
if (!renderer.includes('surpriseMe')) fail('renderer is missing the random playable game action');
if (!renderer.includes('renderHeroActions')) fail('renderer is missing context-aware hero actions');
if (!renderer.includes('setLaunchingState') || !styles.includes('.game.launching')) fail('launch feedback states are missing');
if (!renderer.includes('spotlightSource') || !styles.includes('.feature-source')) fail('metadata source feedback is missing');
if (!renderer.includes('artworkFilter') || !html.includes('id="artworkFilter"')) fail('library artwork quality filter is missing');
if (!renderer.includes('chooseFocusedArtwork') || !renderer.includes('refreshFocusedDetails')) fail('renderer is missing manual artwork or detail repair controls');
if (!main.includes('artworkCoverage')) fail('diagnostics are missing artwork coverage');
if (!renderer.includes('dataset.captureReady') || !main.includes('rendererReady')) fail('UI capture readiness handshake is missing');
if (!preload.includes('includeLibrary = false')) fail('startup diagnostics must avoid a duplicate library scan');
if (!main.includes('environmentOverrides') || !main.includes('GAMEDECK_LIBRARY')) fail('explicit environment overrides must take precedence over saved settings');
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
  'docs/ARCADE.md',
  'docs/COMMUNITY_LAUNCH.md',
  'docs/images/gamedeck-ready-check.png',
  'docs/images/gamedeck-startup.png',
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
