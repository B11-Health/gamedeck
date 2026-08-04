import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

assert.match(html, /id="playAmbient"[\s\S]*id="playAmbientVideo"/);
assert.match(html, /GAMEDECK PLAY/);
assert.doesNotMatch(html.match(/<section class="play-surface[\s\S]*?<\/section>/)?.[0] || '', /RetroArch/);

assert.match(css, /\.play-surface\s*\{[\s\S]*--ambient-left:/);
assert.match(css, /\.play-surface\.mode-docked\.play-ambient-live #playAmbientVideo/);
assert.match(css, /filter: blur\(58px\) saturate\(1\.65\) brightness\(\.48\)/);
assert.equal([...css].reduce((balance, char) => balance + (char === '{' ? 1 : char === '}' ? -1 : 0), 0), 0, 'CSS braces must stay balanced');
assert.ok(css.indexOf('/* Integrated GameDeck Play surface */') > css.indexOf('.launch-handoff-spinner { animation-duration: 1.5s; }\n}'), 'Play surface must not be trapped inside reduced-motion media query');

assert.match(app, /const mode = 'docked';/);
assert.doesNotMatch(app, /writePreference\('play-mode'/);
assert.match(app, /setInterval\(samplePlayAmbientFrame, 180\)/);
assert.match(app, /playAmbientColorState = Object\.create\(null\)/);
assert.match(app, /ambientVideo\.srcObject = playCaptureStream/);

assert.match(main, /\| 0x00000080 \| 0x08000000/);
assert.match(main, /& ~0x00040000/);
assert.doesNotMatch(main, /GameDeckTaskbar|TaskbarListCom|taskbarVisible/);

console.log('play surface UI: 16 scenarios passed');
