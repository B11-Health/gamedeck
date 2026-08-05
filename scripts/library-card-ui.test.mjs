import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');

const renderStart = app.indexOf('function renderGames()');
const renderEnd = app.indexOf('function selectLibrarySystem', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const renderBlock = app.slice(renderStart, renderEnd);
const cardStart = renderBlock.indexOf('return `<article class="game');
const cardEnd = renderBlock.indexOf('</article>`;', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart);
const card = renderBlock.slice(cardStart, cardEnd + 12);

assert.match(card, /role="button"/);
assert.match(card, /aria-label="Play \$\{title\}/);
assert.match(card, /class="cover game-card-launch"/);
assert.match(card, /class="cover-ambient"/);
assert.match(card, /class="cover-art"/);
assert.equal(card.split('src="${artwork}"').length - 1, 2);
assert.match(card, /class="game-title"/);
assert.match(card, /class="details"/);
assert.match(card, /aria-haspopup="dialog"/);
assert.match(card, /class="fav/);
assert.match(card, /class="play"/);
assert.doesNotMatch(card, /ROM SET VERIFIED|ARCHIVE VERIFIED|GAMEDECK ART|MATCHING ART|megabytes|\bMB\b|SaaS|beta play/i);

assert.ok(renderBlock.includes("if (event.target.closest('.details, .fav, .play')) return"));
assert.ok(renderBlock.includes('playGame(event)'));
assert.ok(renderBlock.includes("card.querySelector('.details').onclick"));
assert.ok(renderBlock.includes('openGameDetails(game)'));
assert.ok(renderBlock.includes("card.querySelector('.play').onclick = playGame"));
assert.ok(renderBlock.includes('launch(game.file)'));
assert.ok(renderBlock.includes("['Enter', ' '].includes(event.key)"));

const launchStart = app.indexOf('async function integratedCapabilitiesFor');
const launchEnd = app.indexOf('function renderCatalogFeature', launchStart);
assert.ok(launchStart >= 0 && launchEnd > launchStart);
const launchBlock = app.slice(launchStart, launchEnd);
assert.match(launchBlock, /window\.deck\.playSessionCapabilities\(file\)/);
assert.match(launchBlock, /window\.deck\.ensureRuntime\(false\)/);
assert.match(launchBlock, /startIntegratedPlay\(file, game\)/);
assert.match(launchBlock, /Opening the unified GameDeck player/);
assert.doesNotMatch(launchBlock, /window\.deck\.launch\(file\)/);
assert.doesNotMatch(launchBlock, /normal game window|verified external play route|Switching to the verified external/);
assert.match(app, /const mode = 'docked';/);

assert.match(html, /id="spotlight" role="dialog" aria-modal="true"/);
assert.match(html, /id="spotlightShare"/);
assert.match(html, /id="spotlightPlay"/);
assert.match(html, /id="spotlightClose"/);
assert.ok(app.includes('function openGameDetails(game)'));
assert.ok(app.includes('function closeGameDetails(options = {})'));
assert.ok(app.includes('async function shareFocusedGame()'));

const pristine = css.slice(css.indexOf('/* Pristine artwork-first library cards */'));
assert.ok(pristine.includes('#games .cover-ambient {'));
assert.ok(pristine.includes('filter: blur(20px) saturate(1.24) brightness(.76)'));
assert.ok(pristine.includes('#games .cover-art img,'));
assert.ok(pristine.includes('filter: none !important'));
assert.ok(pristine.includes('object-fit: contain'));

const dock = css.slice(css.indexOf('/* Gamer launch dock and cinematic game details */'));
assert.ok(dock.includes('#games .game-card-tools'));
assert.ok(dock.includes('#games .details'));
assert.ok(dock.includes('#games .play'));
assert.ok(dock.includes('body.game-detail-open'));
assert.ok(dock.includes('#spotlight .spotlight-panel'));
assert.ok(dock.includes('#spotlight .spotlight-art-ambient'));
assert.ok(dock.includes('#spotlight .spotlight-art-main'));
assert.ok(dock.includes('@media (max-width: 720px)'));
assert.ok(dock.includes('@media (prefers-reduced-motion: reduce)'));

assert.ok(app.includes('function pulseUiHaptic(kind, options = {})'));
assert.ok(app.includes("pulseUiHaptic('navigate')"));
assert.ok(app.includes("pulseUiHaptic('scroll')"));
assert.ok(app.includes("pulseUiHaptic('confirm'"));
assert.ok(app.includes("pulseUiHaptic('back'"));
assert.ok(app.includes("pulseUiHaptic('favorite'"));

assert.ok(dock.includes('/* Crisp, zero-blur game detail */'));
assert.ok(dock.includes('backdrop-filter: none !important'));
assert.ok(dock.includes('aspect-ratio: 2 / 3 !important'));
assert.ok(dock.includes('object-fit: contain !important'));
assert.ok(dock.includes('width: 52px !important'));
assert.ok(dock.includes('height: 52px !important'));
assert.ok(dock.includes('grid-template-columns: 1fr 1fr !important'));
assert.ok(app.includes("$('#spotlightSystem').textContent = system?.name || 'GameDeck';"));
assert.ok(app.includes("factMarkup([details.year, details.genre"));

assert.ok(html.includes('<kbd>CLICK</kbd> Play'));
assert.ok(html.includes('<kbd>i</kbd> Details'));
assert.ok(!html.includes('<kbd>CLICK</kbd> Preview'));
assert.ok(!html.includes('<kbd>DOUBLE</kbd> Play'));

const scenarios = (fs.readFileSync(new URL(import.meta.url), 'utf8').match(/assert\./g) || []).length;
console.log(`library click-to-play and detail UI: ${scenarios} scenarios passed`);
