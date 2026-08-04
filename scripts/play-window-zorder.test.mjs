import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const controller = main.slice(main.indexOf('function setEmbeddedEngineWindowMode'), main.indexOf('function registerGameDeckOpenBorProcess'));
const setModeBlock = controller.slice(controller.indexOf('async setMode(mode, session)'), controller.indexOf('release(session)'));
const popout = setModeBlock.slice(setModeBlock.indexOf("if (mode === 'popout')"), setModeBlock.indexOf("if (mainWindow.isMinimized()) mainWindow.restore()"));

assert.equal(controller.includes('setAlwaysOnTop(true'), false);
assert.equal(controller.includes('setAlwaysOnTop(false)'), true);
assert.ok(popout.indexOf('mainWindow.minimize()') < popout.indexOf("setEmbeddedEngineWindowMode(session, 'popout')"));
assert.equal(popout.includes('setTimeout(() =>'), true);
assert.equal(popout.includes("setEmbeddedEngineWindowMode(session, 'popout')"), true);
assert.equal(popout.includes('}, 180);'), true);
assert.ok(setModeBlock.indexOf('setEmbeddedEngineWindowMode(session, mode);') < setModeBlock.indexOf('mainWindow.moveTop();'));
assert.equal(app.includes('let playCaptureGeneration = 0;'), true);
assert.equal(app.includes('captureGeneration !== playCaptureGeneration'), true);
assert.equal(app.includes("fallbackPlayCaptureToPopout('The live game window stopped sharing."), true);
assert.equal(app.includes('await fallbackPlayCaptureToPopout(error.message'), true);
assert.equal(app.includes("await setPlayMode('popout')"), true);

console.log('play window z-order: 12 scenarios passed');
