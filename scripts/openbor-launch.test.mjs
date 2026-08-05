import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  OPENBOR_CONFIG_MIN_BYTES,
  OPENBOR_CONFIG_OFFSETS,
  patchOpenBorConfig,
  prepareOpenBorLaunch,
  safeSegment,
  sessionIdentity
} = require('../openbor-launch.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-openbor-launch-'));
try {
  const engineRoot = path.join(root, 'engine');
  const engineSaves = path.join(engineRoot, 'Saves');
  const libraryRoot = path.join(root, 'library');
  const sessionsRoot = path.join(root, 'sessions');
  fs.mkdirSync(engineSaves, { recursive: true });
  fs.mkdirSync(libraryRoot, { recursive: true });

  const executable = path.join(engineRoot, 'OpenBOR.exe');
  const pak = path.join(libraryRoot, 'Battletoads [Test].pak');
  fs.writeFileSync(executable, Buffer.alloc(4096, 0x45));
  fs.writeFileSync(pak, Buffer.from('legal-test-pak'));

  const template = Buffer.alloc(OPENBOR_CONFIG_MIN_BYTES, 0);
  template.writeUInt32LE(210760, 0);
  template.writeUInt32LE(99, 100);
  template.writeUInt32LE(7, OPENBOR_CONFIG_OFFSETS.swfilter);
  template.writeUInt32LE(0, OPENBOR_CONFIG_OFFSETS.fullscreen);
  template.writeUInt32LE(1, OPENBOR_CONFIG_OFFSETS.stretch);
  template.writeUInt32LE(1, OPENBOR_CONFIG_OFFSETS.usegl);
  template.writeFloatLE(3.5, OPENBOR_CONFIG_OFFSETS.hwscale);
  template.writeUInt32LE(0, OPENBOR_CONFIG_OFFSETS.hwfilter);
  fs.writeFileSync(path.join(engineSaves, 'bor.cfg'), template);

  const patched = patchOpenBorConfig(template);
  assert.equal(patched.length, template.length);
  assert.equal(patched.readUInt32LE(0), 210760);
  assert.equal(patched.readUInt32LE(100), 99);
  assert.equal(patched.readUInt32LE(OPENBOR_CONFIG_OFFSETS.swfilter), 0);
  assert.equal(patched.readUInt32LE(OPENBOR_CONFIG_OFFSETS.fullscreen), 1);
  assert.equal(patched.readUInt32LE(OPENBOR_CONFIG_OFFSETS.stretch), 0);
  assert.equal(patched.readUInt32LE(OPENBOR_CONFIG_OFFSETS.usegl), 0);
  assert.equal(patched.readFloatLE(OPENBOR_CONFIG_OFFSETS.hwscale), 1);
  assert.equal(patched.readUInt32LE(OPENBOR_CONFIG_OFFSETS.hwfilter), 1);
  assert.equal(template.readUInt32LE(OPENBOR_CONFIG_OFFSETS.fullscreen), 0, 'source buffer must stay immutable');
  assert.throws(() => patchOpenBorConfig(Buffer.alloc(64)), /at least 352 bytes/);

  assert.equal(safeSegment('  Battletoads: Test?  '), 'Battletoads-Test');
  assert.equal(sessionIdentity(pak), sessionIdentity(path.resolve(pak)));
  assert.equal(sessionIdentity(pak).length, 16);

  const first = prepareOpenBorLaunch({ engineExecutable: executable, sourcePak: pak, sessionsRoot });
  assert.equal(first.args.length, 0);
  assert.equal(first.presentation, 'native-fullscreen');
  assert(fs.existsSync(first.executable));
  assert(fs.existsSync(first.stagedPak));
  assert(fs.existsSync(first.gameConfigPath));
  assert.equal(path.basename(first.stagedPak), path.basename(pak));
  assert(['hard-link', 'copy'].includes(first.stagingMethod));
  assert.deepEqual(fs.readdirSync(path.join(first.sessionRoot, 'Paks')), [path.basename(pak)]);
  assert.equal(fs.statSync(first.stagedPak).size, fs.statSync(pak).size);

  const gameConfig = fs.readFileSync(first.gameConfigPath);
  assert.equal(gameConfig.readUInt32LE(OPENBOR_CONFIG_OFFSETS.fullscreen), 1);
  assert.equal(gameConfig.readUInt32LE(OPENBOR_CONFIG_OFFSETS.stretch), 0);
  assert.equal(gameConfig.readUInt32LE(OPENBOR_CONFIG_OFFSETS.usegl), 0);
  assert.equal(gameConfig.readUInt32LE(OPENBOR_CONFIG_OFFSETS.hwfilter), 1);
  assert.equal(fs.readFileSync(path.join(first.sessionRoot, 'Saves', 'default.cfg')).readUInt32LE(OPENBOR_CONFIG_OFFSETS.fullscreen), 1);

  gameConfig.writeUInt32LE(4242, 100);
  gameConfig.writeUInt32LE(0, OPENBOR_CONFIG_OFFSETS.fullscreen);
  fs.writeFileSync(first.gameConfigPath, gameConfig);
  fs.writeFileSync(path.join(first.sessionRoot, 'Paks', 'obsolete.pak'), Buffer.from('obsolete'));

  const second = prepareOpenBorLaunch({ engineExecutable: executable, sourcePak: pak, sessionsRoot });
  assert.equal(second.sessionRoot, first.sessionRoot, 'session identity must be stable');
  const preserved = fs.readFileSync(second.gameConfigPath);
  assert.equal(preserved.readUInt32LE(100), 4242, 'non-display game settings must persist');
  assert.equal(preserved.readUInt32LE(OPENBOR_CONFIG_OFFSETS.fullscreen), 1, 'display settings must be re-enforced');
  assert.deepEqual(fs.readdirSync(path.join(second.sessionRoot, 'Paks')), [path.basename(pak)], 'session must contain exactly one PAK');

  const otherPak = path.join(libraryRoot, 'Other Game.pak');
  fs.writeFileSync(otherPak, Buffer.from('other-pak'));
  const other = prepareOpenBorLaunch({ engineExecutable: executable, sourcePak: otherPak, sessionsRoot });
  assert.notEqual(other.sessionRoot, first.sessionRoot);
  assert.deepEqual(fs.readdirSync(path.join(other.sessionRoot, 'Paks')), [path.basename(otherPak)]);

  assert.throws(
    () => prepareOpenBorLaunch({ engineExecutable: executable, sourcePak: path.join(libraryRoot, 'not-a-pak.zip'), sessionsRoot }),
    /require a \.pak file/
  );

  console.log('openbor launch preparation: 32 scenarios passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
