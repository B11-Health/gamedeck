import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildFbneoReadiness,
  isFatalLibretroReadinessLog,
  isFbneoCore,
  resolveLibretroLaunchCwd,
  safeDriverName
} = require('../libretro-launch');

assert.equal(isFbneoCore('C:/cores/fbneo_libretro.dll'), true);
assert.equal(isFbneoCore('/cores/fbneo_libretro.so'), true);
assert.equal(isFbneoCore('/cores/mame_libretro.so'), false);
assert.equal(
  resolveLibretroLaunchCwd({
    contentFile: 'C:/Games/RGSX/roms/fbneo/ddonpach.7z',
    emulatorExecutable: 'C:/RetroArch/retroarch.exe',
    arcade: true
  }),
  path.resolve('C:/Games/RGSX/roms/fbneo')
);
assert.equal(
  resolveLibretroLaunchCwd({
    contentFile: 'C:/Games/RGSX/roms/nes/metroid.zip',
    emulatorExecutable: 'C:/RetroArch/retroarch.exe',
    arcade: false
  }),
  path.resolve('C:/RetroArch')
);
assert.equal(safeDriverName(' DoDonPach! '), 'dodonpach');
assert.throws(() => safeDriverName('***'), /valid driver name/);
const readiness = buildFbneoReadiness({ userData: 'C:/Users/Test/AppData/Roaming/gamedeck', shortName: 'ddonpach' });
assert.equal(readiness.requiredText, 'Driver ddonpach was successfully started');
assert.equal(readiness.logFile.endsWith(path.join('runtime', 'logs', 'fbneo-ddonpach.log')), true);
assert.equal(isFatalLibretroReadinessLog('[FBNeo] None of those archives was found in your paths'), true);
assert.equal(isFatalLibretroReadinessLog('[FBNeo] Driver ddonpach was successfully started'), false);

const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.ok(mainSource.split('resolveLibretroLaunchCwd(').length - 1 >= 2, 'Both embedded and native Libretro launch paths must resolve a content-aware working directory.');
assert.equal(mainSource.includes("buildFbneoReadiness({ userData: app.getPath('userData'), shortName: game.shortName })"), true);
assert.equal(mainSource.includes('`--log-file=${libretroReadiness.logFile}`'), true);
assert.equal(mainSource.includes('isFatalLibretroReadinessLog(text)'), true);

console.log('libretro launch contract: 14 scenarios passed');
