import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  chooseLibrarySystem,
  parseArchiveEntryExtensions,
  parseDiscHeaderSystem,
  parseDolphinHeaderSystem
} = require('../library-system-classifier.js');

const genesis = { id: 'genesis', exts: ['.md', '.gen', '.bin', '.zip'] };
const nes = { id: 'nes', exts: ['.nes', '.zip'] };
const fds = { id: 'fds', exts: ['.fds', '.zip'] };
const snes = { id: 'snes', exts: ['.sfc', '.smc', '.zip'] };
const satellaview = { id: 'satellaview', exts: ['.bs', '.zip'] };
const sufami = { id: 'sufami', exts: ['.st', '.zip'] };
const masterSystem = { id: 'mastersystem', exts: ['.sms', '.zip'] };
const gameGear = { id: 'gamegear', exts: ['.gg', '.zip'] };
const gameCube = { id: 'gamecube', exts: ['.iso', '.gcm', '.rvz'] };
const wii = { id: 'wii', exts: ['.iso', '.wbfs', '.rvz'] };

const parsed = parseArchiveEntryExtensions('1994-01-01 00:00:00 ..... 1048576 524288 Sonic The Hedgehog 2 (World).bin\n');
assert.deepEqual([...parsed], ['.bin']);
assert.equal(chooseLibrarySystem([genesis, masterSystem, gameGear], {
  fileExtension: '.zip',
  archiveExtensions: parsed,
  sharedRoot: true
})?.id, 'genesis');
assert.equal(chooseLibrarySystem([genesis, masterSystem, gameGear], {
  fileExtension: '.zip',
  archiveExtensions: new Set(['.sms']),
  sharedRoot: true
})?.id, 'mastersystem');
assert.equal(chooseLibrarySystem([genesis, masterSystem, gameGear], {
  fileExtension: '.zip',
  archiveExtensions: new Set(['.gg']),
  sharedRoot: true
})?.id, 'gamegear');
assert.equal(chooseLibrarySystem([nes, fds], {
  fileExtension: '.zip',
  archiveExtensions: new Set(['.fds']),
  sharedRoot: true
})?.id, 'fds');
assert.equal(chooseLibrarySystem([snes, satellaview, sufami], {
  fileExtension: '.zip',
  archiveExtensions: new Set(['.bs']),
  sharedRoot: true
})?.id, 'satellaview');
assert.equal(chooseLibrarySystem([snes, satellaview, sufami], {
  fileExtension: '.zip',
  archiveExtensions: new Set(['.st']),
  sharedRoot: true
})?.id, 'sufami');
assert.equal(chooseLibrarySystem([gameCube, wii], {
  fileExtension: '.rvz',
  discSystemId: 'wii',
  sharedRoot: true
})?.id, 'wii');
assert.equal(chooseLibrarySystem([gameCube, wii], {
  fileExtension: '.rvz',
  sharedRoot: true,
  directSystemId: 'gamecube'
}), null);
assert.equal(parseDolphinHeaderSystem('{"title_id":281476374285893,"game_id":"SMNE01"}'), 'wii');
assert.equal(parseDolphinHeaderSystem('{"game_id":"GALE01","internal_name":"Super Smash Bros. Melee"}'), 'gamecube');
const wiiHeader = Buffer.alloc(128); Buffer.from([0x5d, 0x1c, 0x9e, 0xa3]).copy(wiiHeader, 96);
const gameCubeHeader = Buffer.alloc(128); Buffer.from([0xc2, 0x33, 0x9f, 0x3d]).copy(gameCubeHeader, 28);
assert.equal(parseDiscHeaderSystem(wiiHeader), 'wii');
assert.equal(parseDiscHeaderSystem(gameCubeHeader), 'gamecube');

console.log('Library system classifier tests passed.');
