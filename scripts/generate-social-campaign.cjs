'use strict';

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const generator = path.join(__dirname, 'generate-social-short.cjs');
const campaigns = [
  {
    slug: 'Folders', start: '1.5',
    headline: 'YOUR COLLECTION DESERVES BETTER THAN FOLDERS.',
    messages: [
      'YOUR GAMES SHOULD FEEL LIKE A COLLECTION.',
      'ONE CINEMATIC CONTROLLER-FIRST HOME.',
      'SCANS LOCAL FILES. MATCHES ARTWORK.',
      'CLASSIC CONSOLES. ARCADE. MODERN EMULATION.',
      'DOWNLOAD GAMEDECK 1.2'
    ],
    copy: 'Your game collection deserves better than folders. GameDeck turns the games you legally own into one cinematic, controller-first library across Windows, macOS, and Linux. No ROMs included.'
  },
  {
    slug: 'Local-First', start: '34',
    headline: 'SETUP SHOULD EXPLAIN ITSELF.',
    messages: [
      'EMULATOR READINESS STAYS VISIBLE.',
      'DOWNLOADS STAY UNDERSTANDABLE.',
      'YOUR COLLECTION STAYS ON YOUR DEVICE.',
      'OPEN SOURCE. NO CLOUD LOCK-IN.',
      'EXPLORE GAMEDECK 1.2'
    ],
    copy: 'Setup should explain itself. GameDeck keeps emulator readiness, downloads, and launch diagnostics visible while your legally owned collection stays local-first. Open source, no cloud lock-in, no ROMs included.'
  }
];

const render = campaign => new Promise((resolve, reject) => {
  const env = {
    ...process.env,
    GAMEDECK_SHORT_SLUG: campaign.slug,
    GAMEDECK_SHORT_START: campaign.start,
    GAMEDECK_SHORT_HEADLINE: campaign.headline,
    GAMEDECK_SHORT_COPY: campaign.copy
  };
  campaign.messages.forEach((message, index) => {
    env[`GAMEDECK_SHORT_MESSAGE_${index + 1}`] = message;
  });
  const child = spawn(process.execPath, [generator], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) return reject(new Error(stderr || `Campaign ${campaign.slug} failed with code ${code}`));
    process.stdout.write(stdout);
    resolve();
  });
});

Promise.all(campaigns.map(render))
  .then(() => console.log('GameDeck social campaign rendered.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
