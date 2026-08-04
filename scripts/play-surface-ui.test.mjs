import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const haptics = fs.readFileSync(path.join(root, 'src/game-haptics.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

assert.match(html, /id="playAmbient"[\s\S]*id="playAmbientVideo"/);
assert.match(html, /GAMEDECK PLAY/);
assert.match(html, /id="playHapticsToggle"[\s\S]*Haptics Auto/);
assert.match(html, /analyze game sound locally and never record it/);
assert.ok(html.indexOf('game-haptics.js') < html.indexOf('app.js'), 'Haptics helper must load before the renderer.');
assert.doesNotMatch(html.match(/<section class="play-surface[\s\S]*?<\/section>/)?.[0] || '', /RetroArch/);

assert.match(css, /\.play-surface\s*\{[\s\S]*--ambient-left:/);
assert.match(css, /\.play-surface\.mode-docked\.play-ambient-live #playAmbientVideo/);
assert.match(css, /filter: blur\(58px\) saturate\(1\.65\) brightness\(\.48\)/);
assert.match(css, /@keyframes haptic-breath/);
assert.match(css, /\.play-haptics-toggle\.reactive span/);
assert.match(css, /\.play-haptics-toggle\.enhance/);
assert.equal([...css].reduce((balance, char) => balance + (char === '{' ? 1 : char === '}' ? -1 : 0), 0), 0, 'CSS braces must stay balanced');
assert.ok(css.indexOf('/* Integrated GameDeck Play surface */') > css.indexOf('.launch-handoff-spinner { animation-duration: 1.5s; }\n}'), 'Play surface must not be trapped inside reduced-motion media query');

assert.match(app, /const mode = 'docked';/);
assert.doesNotMatch(app, /writePreference\('play-mode'/);
assert.match(app, /setInterval\(samplePlayAmbientFrame, 180\)/);
assert.match(app, /playAmbientColorState = Object\.create\(null\)/);
assert.match(app, /ambientVideo\.srcObject = playCaptureStream/);
assert.match(app, /window\.deck\.playSessionArmCapture\(sessionId, includeAudio\)/);
assert.match(app, /const HAPTIC_PREFERENCE_ORDER = \['auto', 'enhance', 'off'\]/);
assert.match(app, /hapticPolicyForSystem\?\.\(status\?\.systemId, preference\)/);
assert.match(app, /shouldCaptureHapticAudio\(status, previousPreference\)/);
assert.match(app, /audioRequirementChanged/);
assert.match(app, /controller\.startReactive\(playCaptureStream, status\.systemId, state\.hapticPreference\)/);
assert.match(app, /controller\.startLoading\(\)/);
assert.match(app, /writePreference\('haptics', state\.hapticPreference\)/);
assert.match(haptics, /const FALLBACK_SYSTEMS = new Set/);
assert.match(haptics, /const NATIVE_RUMBLE_SYSTEMS = new Set/);
assert.match(haptics, /const HAPTIC_PREFERENCES = new Set/);
assert.match(haptics, /selected === 'enhance'/);
assert.match(haptics, /const HAPTIC_PREFERENCES = new Set\(\['auto', 'enhance', 'off'\]\)/);
assert.match(haptics, /if \(selected === 'enhance'\) return 'adaptive'/);
assert.match(haptics, /if \(selected === 'off'\) return 'off'/);
assert.match(haptics, /getByteFrequencyData/);
assert.match(haptics, /dual-rumble/);

assert.match(main, /\| 0x00000080 \| 0x08000000/);
assert.match(main, /& ~0x00040000/);
assert.match(main, /play-session-arm-capture'[\s\S]*includeAudio = false/);
assert.match(main, /Boolean\(includeAudio && process\.platform === 'win32'\)/);
assert.match(preload, /includeAudio = false/);
assert.match(preload, /includeAudio === true/);
assert.doesNotMatch(main, /GameDeckTaskbar|TaskbarListCom|taskbarVisible/);

console.log('play surface UI: 40 scenarios passed');
