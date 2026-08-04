const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OPENBOR_CONFIG_MIN_BYTES = 352;
const OPENBOR_CONFIG_OFFSETS = Object.freeze({
  usejoy: 40,
  keys: 52,
  swfilter: 284,
  fullscreen: 324,
  stretch: 328,
  usegl: 340,
  hwscale: 344,
  hwfilter: 348
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeSegment(value, fallback = 'game') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 72);
  return normalized || fallback;
}

function sessionIdentity(sourcePak) {
  const resolved = path.resolve(sourcePak);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

const OPENBOR_PLAYER_COUNT = 4;
const OPENBOR_BUTTON_COUNT = 13;
const OPENBOR_JOY_LIST_FIRST = 600;
const OPENBOR_JOY_MAX_INPUTS = 64;
const OPENBOR_P1_KEYBOARD_DEFAULTS = Object.freeze([82, 81, 80, 79, 4, 22, 29, 27, 7, 9, 40, 69, 0]);
const OPENBOR_XINPUT_P1_KEYS = Object.freeze([
  624, // D-pad up (hat 0)
  626, // D-pad down
  627, // D-pad left
  625, // D-pad right
  601, // A: primary attack
  603, // X: secondary attack
  604, // Y: third attack
  606, // Right bumper: fourth attack
  602, // B: jump
  605, // Left bumper: special
  608  // Menu/Start
]);

function openBorPlayerKeyOffset(player, action) {
  const normalizedPlayer = Number(player);
  const normalizedAction = Number(action);
  if (!Number.isInteger(normalizedPlayer) || normalizedPlayer < 0 || normalizedPlayer >= OPENBOR_PLAYER_COUNT) throw new Error('OpenBOR player index is invalid.');
  if (!Number.isInteger(normalizedAction) || normalizedAction < 0 || normalizedAction >= OPENBOR_BUTTON_COUNT) throw new Error('OpenBOR action index is invalid.');
  return OPENBOR_CONFIG_OFFSETS.keys + ((normalizedPlayer * OPENBOR_BUTTON_COUNT + normalizedAction) * 4);
}

function readOpenBorPlayerKeys(source, player = 0) {
  if (!Buffer.isBuffer(source) || source.length < OPENBOR_CONFIG_MIN_BYTES) throw new Error(`OpenBOR settings must be at least ${OPENBOR_CONFIG_MIN_BYTES} bytes.`);
  return Array.from({ length: OPENBOR_BUTTON_COUNT }, (_, action) => source.readInt32LE(openBorPlayerKeyOffset(player, action)));
}

function seedOpenBorControllerProfile(target, mode = 'xinput-if-default') {
  if (mode === false || mode === 'preserve') return false;
  target.writeInt32LE(1, OPENBOR_CONFIG_OFFSETS.usejoy);
  const current = readOpenBorPlayerKeys(target, 0);
  const defaultKeyboard = OPENBOR_P1_KEYBOARD_DEFAULTS.slice(0, OPENBOR_XINPUT_P1_KEYS.length).every((value, index) => current[index] === value);
  const empty = current.slice(0, OPENBOR_XINPUT_P1_KEYS.length).every(value => value === 0);
  if (mode !== 'xinput-force' && !defaultKeyboard && !empty) return false;
  OPENBOR_XINPUT_P1_KEYS.forEach((value, action) => target.writeInt32LE(value, openBorPlayerKeyOffset(0, action)));
  return true;
}

function openBorControllerProfile(source) {
  const keys = readOpenBorPlayerKeys(source, 0);
  return {
    usejoy: source.readInt32LE(OPENBOR_CONFIG_OFFSETS.usejoy) !== 0,
    player1Keys: keys,
    xinputReady: OPENBOR_XINPUT_P1_KEYS.every((value, action) => keys[action] === value),
    movement: OPENBOR_XINPUT_P1_KEYS.slice(0, 4),
    actions: OPENBOR_XINPUT_P1_KEYS.slice(4)
  };
}

function patchOpenBorConfig(source, {
  fullscreen = true,
  preserveAspect = true,
  useOpenGl = false,
  hardwareScale = 1,
  hardwareFilter = true,
  softwareFilter = 0,
  controllerProfile = 'xinput-if-default'
} = {}) {
  if (!Buffer.isBuffer(source) || source.length < OPENBOR_CONFIG_MIN_BYTES) {
    throw new Error(`OpenBOR settings must be at least ${OPENBOR_CONFIG_MIN_BYTES} bytes.`);
  }
  const result = Buffer.from(source);
  seedOpenBorControllerProfile(result, controllerProfile);
  result.writeInt32LE(Number(softwareFilter) || 0, OPENBOR_CONFIG_OFFSETS.swfilter);
  result.writeInt32LE(fullscreen ? 1 : 0, OPENBOR_CONFIG_OFFSETS.fullscreen);
  result.writeInt32LE(preserveAspect ? 0 : 1, OPENBOR_CONFIG_OFFSETS.stretch);
  result.writeInt32LE(useOpenGl ? 1 : 0, OPENBOR_CONFIG_OFFSETS.usegl);
  result.writeFloatLE(Number.isFinite(Number(hardwareScale)) ? Number(hardwareScale) : 1, OPENBOR_CONFIG_OFFSETS.hwscale);
  result.writeInt32LE(hardwareFilter ? 1 : 0, OPENBOR_CONFIG_OFFSETS.hwfilter);
  return result;
}

function findConfigTemplate(engineRoot, fsImpl = fs) {
  const savesRoot = path.join(engineRoot, 'Saves');
  const preferred = [
    path.join(savesRoot, 'default.cfg'),
    path.join(savesRoot, 'bor.cfg')
  ];
  for (const candidate of preferred) {
    try {
      if (fsImpl.statSync(candidate).size >= OPENBOR_CONFIG_MIN_BYTES) return candidate;
    } catch {}
  }
  let entries = [];
  try {
    entries = fsImpl.readdirSync(savesRoot, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.cfg') continue;
    const candidate = path.join(savesRoot, entry.name);
    try {
      if (fsImpl.statSync(candidate).size >= OPENBOR_CONFIG_MIN_BYTES) return candidate;
    } catch {}
  }
  return '';
}

function ensureDirectory(directory, fsImpl = fs) {
  fsImpl.mkdirSync(directory, { recursive: true });
  return directory;
}

function copyExecutableIfNeeded(source, target, fsImpl = fs) {
  let current = null;
  let expected = null;
  try { current = fsImpl.statSync(target); } catch {}
  try { expected = fsImpl.statSync(source); } catch {}
  if (!expected?.isFile()) throw new Error('OpenBOR executable is unavailable.');
  if (!current?.isFile() || current.size !== expected.size || Math.floor(current.mtimeMs) !== Math.floor(expected.mtimeMs)) {
    fsImpl.copyFileSync(source, target);
    try { fsImpl.utimesSync(target, expected.atime, expected.mtime); } catch {}
  }
}

function clearDirectory(directory, fsImpl = fs) {
  ensureDirectory(directory, fsImpl);
  for (const entry of fsImpl.readdirSync(directory, { withFileTypes: true })) {
    fsImpl.rmSync(path.join(directory, entry.name), { recursive: true, force: true });
  }
}

function linkOrCopyFile(source, target, fsImpl = fs) {
  try {
    fsImpl.linkSync(source, target);
    return 'hard-link';
  } catch (linkError) {
    try {
      fsImpl.copyFileSync(source, target);
      return 'copy';
    } catch (copyError) {
      throw new Error(`Could not stage the OpenBOR game: ${copyError.message || linkError.message}`);
    }
  }
}

function readCompatibleConfig(candidate, template, fsImpl = fs) {
  try {
    const current = fsImpl.readFileSync(candidate);
    if (current.length >= OPENBOR_CONFIG_MIN_BYTES && current.readUInt32LE(0) === template.readUInt32LE(0)) return current;
  } catch {}
  return template;
}

function prepareOpenBorLaunch({ engineExecutable, sourcePak, sessionsRoot, configOptions = {}, presentation = 'native-fullscreen', fsImpl = fs } = {}) {
  if (!isNonEmptyString(engineExecutable)) throw new Error('OpenBOR executable path is required.');
  if (!isNonEmptyString(sourcePak)) throw new Error('OpenBOR PAK path is required.');
  if (!isNonEmptyString(sessionsRoot)) throw new Error('OpenBOR sessions root is required.');

  const executable = path.resolve(engineExecutable);
  const pak = path.resolve(sourcePak);
  if (path.extname(pak).toLowerCase() !== '.pak') throw new Error('OpenBOR launches require a .pak file.');
  if (!fsImpl.statSync(executable).isFile()) throw new Error('OpenBOR executable is unavailable.');
  if (!fsImpl.statSync(pak).isFile()) throw new Error('The selected OpenBOR PAK is unavailable.');

  const engineRoot = path.dirname(executable);
  const templatePath = findConfigTemplate(engineRoot, fsImpl);
  if (!templatePath) throw new Error('OpenBOR is missing a compatible settings template.');
  const template = fsImpl.readFileSync(templatePath);

  const stem = path.parse(pak).name;
  const identity = sessionIdentity(pak);
  const sessionRoot = ensureDirectory(path.join(path.resolve(sessionsRoot), `${safeSegment(stem)}-${identity}`), fsImpl);
  const paksRoot = path.join(sessionRoot, 'Paks');
  const savesRoot = ensureDirectory(path.join(sessionRoot, 'Saves'), fsImpl);
  ensureDirectory(path.join(sessionRoot, 'Logs'), fsImpl);
  ensureDirectory(path.join(sessionRoot, 'ScreenShots'), fsImpl);
  clearDirectory(paksRoot, fsImpl);

  const sessionExecutable = path.join(sessionRoot, path.basename(executable));
  copyExecutableIfNeeded(executable, sessionExecutable, fsImpl);

  const stagedPak = path.join(paksRoot, path.basename(pak));
  const stagingMethod = linkOrCopyFile(pak, stagedPak, fsImpl);

  const gameConfigPath = path.join(savesRoot, `${stem}.cfg`);
  const gameConfig = patchOpenBorConfig(readCompatibleConfig(gameConfigPath, template, fsImpl), configOptions);
  fsImpl.writeFileSync(gameConfigPath, gameConfig);
  fsImpl.writeFileSync(path.join(savesRoot, 'default.cfg'), patchOpenBorConfig(template, configOptions));

  return {
    executable: sessionExecutable,
    args: [],
    cwd: sessionRoot,
    sessionRoot,
    stagedPak,
    gameConfigPath,
    logFile: path.join(sessionRoot, 'Logs', 'OpenBorLog.txt'),
    saveDirectory: savesRoot,
    sourcePak: pak,
    stagingMethod,
    controllerProfile: openBorControllerProfile(gameConfig),
    presentation
  };
}

module.exports = {
  OPENBOR_CONFIG_MIN_BYTES,
  OPENBOR_CONFIG_OFFSETS,
  OPENBOR_BUTTON_COUNT,
  OPENBOR_P1_KEYBOARD_DEFAULTS,
  OPENBOR_XINPUT_P1_KEYS,
  findConfigTemplate,
  openBorControllerProfile,
  openBorPlayerKeyOffset,
  patchOpenBorConfig,
  readOpenBorPlayerKeys,
  seedOpenBorControllerProfile,
  prepareOpenBorLaunch,
  safeSegment,
  sessionIdentity
};
