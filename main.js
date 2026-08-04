const { app, BrowserWindow, ipcMain, shell, screen, dialog, clipboard, desktopCapturer, session, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { handoffHostWindowForNativeGame, presentNativeGameWindow } = require('./native-window-presenter');
const { prepareOpenBorLaunch } = require('./openbor-launch');
const { buildFbneoReadiness, isFatalLibretroReadinessLog, isFbneoCore, resolveLibretroLaunchCwd } = require('./libretro-launch');
const { path7za } = require('7zip-bin');
const { createRuntimeManager, pathsFor: managedRuntimePathsFor, key: managedRuntimeKey } = require('./runtime-manager');
const { createStreamServer } = require('./stream-server');
const { createNetplayManager } = require('./netplay-manager');
const { createEmbeddedPlayManager } = require('./embedded-play-manager');
const {
  buildCapabilityFailure,
  buildStatusFailure,
  createPlaySessionManager,
  isTrustedMainFrameCaller,
  rankSourceCandidates,
  resolveCapabilitiesSafely,
  validateCapabilityFileArgument
} = require('./play-session-manager');
const {
  chooseLibrarySystem,
  parseArchiveEntryExtensions,
  parseDiscHeaderSystem,
  parseDolphinHeaderSystem
} = require('./library-system-classifier');

if (process.platform === 'win32') app.setAppUserModelId('io.gamedeck.launcher');

const HOME_DIR = os.homedir();
const DOCUMENTS_DIR = app.getPath('documents');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const NETPLAY_ROOT = path.join(app.getPath('userData'), 'netplay');
const MANAGED_RUNTIME_ROOT = path.join(app.getPath('userData'), 'runtime');
const MANAGED_RUNTIME_PATHS = managedRuntimePathsFor(MANAGED_RUNTIME_ROOT, process.platform);
const BUNDLED_RUNTIME_ROOT = path.join(process.resourcesPath, 'runtime-cache', managedRuntimeKey());
const BUNDLED_RUNTIME_AVAILABLE = fs.existsSync(path.join(BUNDLED_RUNTIME_ROOT, 'cache-index.json'));
const MANAGED_RUNTIME_MANIFEST = readJson(path.join(__dirname, 'config', 'runtime-manifest.json'), { platforms: {} });

function managedRuntimeInstalled() {
  const spec = MANAGED_RUNTIME_MANIFEST.platforms?.[managedRuntimeKey()];
  const required = (spec?.components || []).filter(component => component.required !== false);
  if (!required.length) return false;
  return required.every(component => (component.expected || []).every(value => {
    try {
      return fs.statSync(path.join(MANAGED_RUNTIME_ROOT, ...String(value || '').split('/').filter(Boolean))).size > 0;
    } catch {
      return false;
    }
  }));
}

const MANAGED_RUNTIME_INSTALLED = managedRuntimeInstalled();
const MANAGED_RUNTIME_PREFERRED = BUNDLED_RUNTIME_AVAILABLE || MANAGED_RUNTIME_INSTALLED;

function firstExisting(candidates, fallback = '') {
  return candidates.filter(Boolean).find(candidate => fs.existsSync(candidate)) || fallback;
}

function findOnPath(names) {
  for (const name of names) {
    const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 3000
    });
    const found = String(lookup.stdout || '').split(/\r?\n/).map(value => value.trim()).find(Boolean);
    if (found && fs.existsSync(found)) return found;
  }
  return '';
}

const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
const localAppData = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');
const applicationSupport = path.join(HOME_DIR, 'Library', 'Application Support');

function findExecutableUnder(root, names, maxDepth = 4) {
  if (!root || !fs.existsSync(root)) return '';
  const wanted = new Set(names.map(name => name.toLowerCase()));
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLowerCase())) return candidate;
      if (entry.isDirectory() && depth < maxDepth) queue.push({ directory: candidate, depth: depth + 1 });
    }
  }
  return '';
}
const defaultRgsxRoot = firstExisting([
  process.env.GAMEDECK_RGSX_ROOT,
  path.join(HOME_DIR, 'Games', 'RGSX'),
  path.join(HOME_DIR, 'RGSX')
], path.join(HOME_DIR, 'Games', 'RGSX'));

const detectedRetroArch = firstExisting([
  process.env.GAMEDECK_RETROARCH,
  process.platform === 'win32' && 'C:\\RetroArch-Win64\\retroarch.exe',
  process.platform === 'win32' && path.join(programFiles, 'RetroArch-Win64', 'retroarch.exe'),
  process.platform === 'darwin' && '/Applications/RetroArch.app/Contents/MacOS/RetroArch',
  process.platform === 'linux' && findOnPath(['retroarch'])
].filter(Boolean));

const detectedMame = firstExisting([
  process.env.GAMEDECK_MAME,
  process.platform === 'win32' && path.join(localAppData, 'Programs', 'MAME', 'mame.exe'),
  process.platform === 'win32' && path.join(programFiles, 'MAME', 'mame.exe'),
  process.platform === 'win32' && findOnPath(['mame.exe', 'mame64.exe']),
  process.platform === 'darwin' && '/Applications/MAME.app/Contents/MacOS/mame',
  process.platform === 'linux' && findOnPath(['mame'])
].filter(Boolean));

const detectedCoreDir = firstExisting([
  process.env.GAMEDECK_RETROARCH_CORES,
  detectedRetroArch && path.join(path.dirname(detectedRetroArch), 'cores'),
  process.platform === 'darwin' && '/Applications/RetroArch.app/Contents/Resources/cores',
  process.platform === 'linux' && path.join(HOME_DIR, '.config', 'retroarch', 'cores'),
  process.platform === 'linux' && '/usr/lib/libretro',
  process.platform === 'linux' && '/usr/lib/x86_64-linux-gnu/libretro'
].filter(Boolean), detectedRetroArch ? path.join(path.dirname(detectedRetroArch), 'cores') : path.join(HOME_DIR, '.config', 'retroarch', 'cores'));

const defaultSettings = {
  libraryRoot: process.env.GAMEDECK_LIBRARY || path.join(defaultRgsxRoot, 'roms'),
  rgsxRoot: defaultRgsxRoot,
  emulationRoot: process.env.GAMEDECK_EMULATION_ROOT || path.join(HOME_DIR, 'Games', 'Emulation'),
  retroArchPath: MANAGED_RUNTIME_PREFERRED ? MANAGED_RUNTIME_PATHS.retroArch : (detectedRetroArch || MANAGED_RUNTIME_PATHS.retroArch),
  retroArchCores: MANAGED_RUNTIME_PREFERRED ? MANAGED_RUNTIME_PATHS.cores : (detectedCoreDir || MANAGED_RUNTIME_PATHS.cores),
  mamePath: detectedMame,
  retroArchSystem: process.env.GAMEDECK_RETROARCH_SYSTEM || (MANAGED_RUNTIME_PREFERRED
    ? MANAGED_RUNTIME_PATHS.system
    : detectedRetroArch
      ? path.join(path.dirname(detectedRetroArch), 'system')
      : MANAGED_RUNTIME_PATHS.system),
  sponsorsEnabled: true,
  sponsorManifestUrl: 'https://raw.githubusercontent.com/B11-Health/gamedeck/main/sponsors.json'
};
const runtimeSettings = { ...defaultSettings, ...readJson(SETTINGS_FILE, {}) };
if (MANAGED_RUNTIME_PREFERRED) {
  runtimeSettings.retroArchPath = MANAGED_RUNTIME_PATHS.retroArch;
  runtimeSettings.retroArchCores = MANAGED_RUNTIME_PATHS.cores;
  runtimeSettings.retroArchSystem = MANAGED_RUNTIME_PATHS.system;
}
const environmentOverrides = {
  libraryRoot: process.env.GAMEDECK_LIBRARY,
  rgsxRoot: process.env.GAMEDECK_RGSX_ROOT,
  emulationRoot: process.env.GAMEDECK_EMULATION_ROOT,
  retroArchPath: process.env.GAMEDECK_RETROARCH,
  retroArchCores: process.env.GAMEDECK_RETROARCH_CORES,
  retroArchSystem: process.env.GAMEDECK_RETROARCH_SYSTEM,
  mamePath: process.env.GAMEDECK_MAME
};
for (const [key, value] of Object.entries(environmentOverrides)) {
  if (String(value || '').trim()) runtimeSettings[key] = String(value).trim();
}

const LIBRARY = path.resolve(runtimeSettings.libraryRoot);
const RA = runtimeSettings.retroArchPath;
const CORES = runtimeSettings.retroArchCores;
const RA_SYSTEM = runtimeSettings.retroArchSystem;
const MAME = runtimeSettings.mamePath;
const RGSX_ROOT = path.resolve(runtimeSettings.rgsxRoot);
const EMULATION_ROOT = path.resolve(runtimeSettings.emulationRoot);
const RGSX_DATA = path.join(RGSX_ROOT, 'saves', 'ports', 'rgsx');
const RGSX_GAMES = path.join(RGSX_DATA, 'games');
const RGSX_APP = path.join(RGSX_ROOT, 'roms', 'ports', 'RGSX');
const RGSX_PYTHON = firstExisting([
  path.join(RGSX_ROOT, 'system', 'tools', 'Python', 'python.exe'),
  findOnPath(process.platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python'])
]);
const RGSX_CLI = path.join(RGSX_APP, 'rgsx_cli.py');
const bundledSevenZip = String(path7za).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
const SEVEN_ZIP = firstExisting([
  bundledSevenZip,
  path.join(RGSX_APP, 'assets', 'progs', '7z.exe'),
  path.join(RGSX_APP, 'assets', 'progs', '7zz'),
  findOnPath(process.platform === 'win32' ? ['7z.exe', '7zz.exe'] : ['7zz', '7z'])
]);
const RGSX_FIRMWARE_PACK = firstExisting([
  path.join(RGSX_ROOT, 'Retrobat V8.0.0.zip'),
  path.join(RGSX_ROOT, 'bios.zip')
], path.join(RGSX_ROOT, 'Retrobat V8.0.0.zip'));
const STORE = path.join(app.getPath('userData'), 'library.json');
const DOWNLOADS_FILE = path.join(app.getPath('userData'), 'downloads.json');
const ART_CACHE = path.join(app.getPath('userData'), 'artwork');
const DETAILS_CACHE = path.join(app.getPath('userData'), 'details');
const ARCADE_AUDIT_FILE = path.join(app.getPath('userData'), 'arcade-audit.json');
const ARCADE_CONTROLLER_CONFIG = path.join(app.getPath('userData'), 'retroarch-arcade.cfg');
const EMBEDDED_RETROARCH_CONFIG = path.join(app.getPath('userData'), 'retroarch-embedded.cfg');
const SPONSORS_FILE = path.join(__dirname, 'sponsors.json');
const DONATIONS_FILE = path.join(__dirname, 'config', 'donations.json');
const ART_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const CORE_EXT = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
const coreFile = name => `${name}.${CORE_EXT}`;

const emulatorPaths = {
  duckstation: firstExisting([
    process.env.GAMEDECK_DUCKSTATION,
    process.platform === 'win32' && path.join(localAppData, 'Programs', 'DuckStation', 'duckstation-qt-x64-ReleaseLTCG.exe'),
    process.platform === 'win32' && path.join(programFiles, 'DuckStation', 'duckstation-qt-x64-ReleaseLTCG.exe'),
    process.platform === 'darwin' && '/Applications/DuckStation.app/Contents/MacOS/DuckStation',
    process.platform === 'linux' && findOnPath(['duckstation-qt', 'duckstation'])
  ].filter(Boolean)),
  pcsx2: firstExisting([
    process.env.GAMEDECK_PCSX2,
    process.platform === 'win32' && path.join(programFiles, 'PCSX2', 'pcsx2-qt.exe'),
    process.platform === 'darwin' && '/Applications/PCSX2.app/Contents/MacOS/PCSX2',
    process.platform === 'linux' && findOnPath(['pcsx2-qt', 'pcsx2'])
  ].filter(Boolean)),
  ppsspp: firstExisting([
    process.env.GAMEDECK_PPSSPP,
    process.platform === 'win32' && path.join(programFiles, 'PPSSPP', 'PPSSPPWindows64.exe'),
    process.platform === 'darwin' && '/Applications/PPSSPPSDL.app/Contents/MacOS/PPSSPPSDL',
    process.platform === 'linux' && findOnPath(['PPSSPPSDL', 'ppsspp'])
  ].filter(Boolean)),
  dolphin: firstExisting([
    process.env.GAMEDECK_DOLPHIN,
    process.platform === 'win32' && path.join(localAppData, 'Programs', 'Dolphin', 'Dolphin.exe'),
    process.platform === 'darwin' && '/Applications/Dolphin.app/Contents/MacOS/Dolphin',
    process.platform === 'linux' && findOnPath(['dolphin-emu', 'dolphin'])
  ].filter(Boolean)),
  cemu: firstExisting([
    process.env.GAMEDECK_CEMU,
    process.platform === 'win32' && findExecutableUnder(path.join(localAppData, 'Microsoft', 'WinGet', 'Packages'), ['Cemu.exe']),
    process.platform === 'win32' && findOnPath(['Cemu.exe']),
    process.platform === 'darwin' && '/Applications/Cemu.app/Contents/MacOS/Cemu',
    process.platform === 'linux' && findOnPath(['cemu'])
  ].filter(Boolean)),
  openbor: firstExisting([
    process.env.GAMEDECK_OPENBOR,
    process.platform === 'win32' && findExecutableUnder(path.join(app.getPath('userData'), 'runtime', 'openbor'), ['OpenBOR.exe'], 8),
    process.platform === 'win32' && path.join(RGSX_ROOT, 'emulators', 'openbor', 'OpenBOR.exe'),
    process.platform === 'win32' && findOnPath(['OpenBOR.exe']),
    process.platform === 'darwin' && '/Applications/OpenBOR.app/Contents/MacOS/OpenBOR',
    process.platform === 'linux' && findOnPath(['OpenBOR', 'openbor'])
  ].filter(Boolean)),
  mame: MAME
};

const DOLPHIN_TOOL = firstExisting([
  emulatorPaths.dolphin && path.join(path.dirname(emulatorPaths.dolphin), process.platform === 'win32' ? 'DolphinTool.exe' : 'dolphin-tool'),
  process.platform === 'win32' && findOnPath(['DolphinTool.exe']),
  process.platform !== 'win32' && findOnPath(['dolphin-tool'])
].filter(Boolean));

const firmwareSearchRoots = [
  path.join(process.env.APPDATA || '', 'RetroArch', 'system'),
  path.join(process.env.LOCALAPPDATA || '', 'RetroArch', 'system'),
  path.join(process.env.USERPROFILE || '', 'Documents', 'RetroArch', 'system'),
  path.join(DOCUMENTS_DIR, 'RetroArch', 'system'),
  path.join(process.env.APPDATA || '', 'DuckStation', 'bios'),
  path.join(process.env.LOCALAPPDATA || '', 'DuckStation', 'bios'),
  path.join(process.env.APPDATA || '', 'PCSX2', 'bios'),
  path.join(process.env.LOCALAPPDATA || '', 'PCSX2', 'bios'),
  path.join(process.env.USERPROFILE || '', 'Documents', 'PCSX2', 'bios'),
  path.join(DOCUMENTS_DIR, 'PCSX2', 'bios'),
  path.join(RGSX_ROOT, 'roms', 'bios'),
  path.join(RGSX_ROOT, 'bios'),
  path.join(EMULATION_ROOT, 'bios'),
  path.join(EMULATION_ROOT, 'Retro', 'system'),
  path.join(EMULATION_ROOT, 'PS1'),
  path.join(EMULATION_ROOT, 'PS2'),
  path.join(HOME_DIR, '.config', 'retroarch', 'system'),
  path.join(HOME_DIR, '.local', 'share', 'duckstation', 'bios'),
  path.join(HOME_DIR, '.config', 'PCSX2', 'bios'),
  path.join(HOME_DIR, '.local', 'share', 'PCSX2', 'bios'),
  path.join(applicationSupport, 'DuckStation', 'bios'),
  path.join(applicationSupport, 'PCSX2', 'bios')
].filter(Boolean);

const thumbnailRepos = {
  snes: 'Nintendo_-_Super_Nintendo_Entertainment_System',
  sufami: 'Nintendo_-_Sufami_Turbo',
  satellaview: 'Nintendo_-_Satellaview',
  nes: 'Nintendo_-_Nintendo_Entertainment_System',
  fds: 'Nintendo_-_Family_Computer_Disk_System',
  n64: 'Nintendo_-_Nintendo_64',
  n64dd: 'Nintendo_-_Nintendo_64DD',
  gb: 'Nintendo_-_Game_Boy',
  gbc: 'Nintendo_-_Game_Boy_Color',
  gba: 'Nintendo_-_Game_Boy_Advance',
  nds: 'Nintendo_-_Nintendo_DS',
  megadrive: 'Sega_-_Mega_Drive_-_Genesis',
  genesis: 'Sega_-_Mega_Drive_-_Genesis',
  sega32x: 'Sega_-_32X',
  mastersystem: 'Sega_-_Master_System_-_Mark_III',
  gamegear: 'Sega_-_Game_Gear',
  segacd: 'Sega_-_Mega-CD_-_Sega_CD',
  megacd: 'Sega_-_Mega-CD_-_Sega_CD',
  pcengine: 'NEC_-_PC_Engine_-_TurboGrafx_16',
  supergrafx: 'NEC_-_PC_Engine_SuperGrafx',
  saturn: 'Sega_-_Saturn',
  dreamcast: 'Sega_-_Dreamcast',
  atari2600: 'Atari_-_2600',
  fbneo: 'FBNeo_-_Arcade_Games',
  arcade: 'FBNeo_-_Arcade_Games',
  mame: 'MAME',
  neogeo: 'SNK_-_Neo_Geo',
  psx: 'Sony_-_PlayStation',
  ps1: 'Sony_-_PlayStation',
  ps2: 'Sony_-_PlayStation_2',
  psp: 'Sony_-_PlayStation_Portable',
  gamecube: 'Nintendo_-_GameCube',
  wii: 'Nintendo_-_Wii',
  wiiu: 'Nintendo_-_Wii_U'
};

const systems = [
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', color: '#8b5cf6', folders: ['snes'], exts: ['.sfc', '.smc', '.zip'], core: coreFile('snes9x_libretro'), icon: 'S' },
  { id: 'satellaview', name: 'Satellaview', short: 'BS-X', color: '#7c3aed', folders: ['satellaview'], exts: ['.bs', '.zip'], core: coreFile('snes9x_libretro'), bios: ['BS-X.bin'], biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'BS' },
  { id: 'sufami', name: 'Sufami Turbo', short: 'SUFAMI', color: '#a855f7', folders: ['sufami'], exts: ['.st', '.zip'], core: coreFile('snes9x_libretro'), bios: ['STBIOS.bin'], biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'ST' },
  { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', color: '#ef4444', folders: ['nes'], exts: ['.nes', '.zip'], core: coreFile('mesen_libretro'), icon: 'N' },
  { id: 'fds', name: 'Famicom Disk System', short: 'FDS', color: '#dc2626', folders: ['fds'], exts: ['.fds', '.zip'], core: coreFile('mesen_libretro'), bios: ['disksys.rom'], biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'FD' },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', color: '#22c55e', folders: ['n64', 'n64dd'], exts: ['.n64', '.z64', '.v64', '.zip'], core: coreFile('mupen64plus_next_libretro'), icon: '64' },
  { id: 'gb', name: 'Game Boy and Color', short: 'GB / GBC', color: '#84cc16', folders: ['gb', 'gbc'], exts: ['.gb', '.gbc', '.zip'], core: coreFile('sameboy_libretro'), icon: 'GB' },
  { id: 'gba', name: 'Game Boy Advance', short: 'GBA', color: '#6366f1', folders: ['gba'], exts: ['.gba', '.zip'], core: coreFile('mgba_libretro'), icon: 'A' },
  { id: 'nds', name: 'Nintendo DS', short: 'NDS', color: '#64748b', folders: ['nds'], exts: ['.nds', '.zip'], core: coreFile('melondsds_libretro'), icon: 'DS' },
  { id: 'genesis', name: 'Sega Genesis', short: 'GENESIS', color: '#2563eb', folders: ['megadrive', 'genesis'], exts: ['.md', '.gen', '.bin', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'SE' },
  { id: 'sega32x', name: 'Sega 32X', short: '32X', color: '#334155', folders: ['sega32x', '32x'], exts: ['.32x', '.bin', '.zip'], core: coreFile('picodrive_libretro'), icon: '32' },
  { id: 'mastersystem', name: 'Sega Master System', short: 'MASTER SYSTEM', color: '#e11d48', folders: ['mastersystem'], exts: ['.sms', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'MS' },
  { id: 'gamegear', name: 'Sega Game Gear', short: 'GAME GEAR', color: '#f43f5e', folders: ['gamegear'], exts: ['.gg', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'GG' },
  { id: 'segacd', name: 'Sega CD', short: 'SEGA CD', color: '#3b82f6', folders: ['segacd', 'megacd'], exts: ['.cue', '.chd'], core: coreFile('genesis_plus_gx_libretro'), bios: ['bios_CD_E.bin', 'bios_CD_U.bin', 'bios_CD_J.bin'], biosMode: 'all', biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'CD' },
  { id: 'pce', name: 'PC Engine', short: 'PCE', color: '#f97316', folders: ['pcengine', 'supergrafx'], exts: ['.pce', '.zip'], core: coreFile('mednafen_pce_fast_libretro'), icon: 'P' },
  { id: 'saturn', name: 'Sega Saturn', short: 'SATURN', color: '#38bdf8', folders: ['saturn'], exts: ['.cue', '.chd', '.m3u'], core: coreFile('mednafen_saturn_libretro'), bios: ['sega_101.bin', 'mpr-17933.bin'], biosMode: 'all', biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'ST' },
  { id: 'dreamcast', name: 'Dreamcast', short: 'DC', color: '#fb923c', folders: ['dreamcast'], exts: ['.gdi', '.cdi', '.chd'], core: coreFile('flycast_libretro'), icon: 'DC' },
  { id: 'atari2600', name: 'Atari 2600', short: 'ATARI', color: '#f59e0b', folders: ['atari2600'], exts: ['.a26', '.bin', '.zip'], core: coreFile('stella_libretro'), icon: 'A' },
  { id: 'arcade', name: 'FinalBurn Neo', short: 'FBNEO', color: '#ec4899', folders: ['fbneo', 'neogeo'], exts: ['.zip', '.7z'], core: coreFile('fbneo_libretro'), icon: 'FB' },
  { id: 'mame', name: 'MAME', short: 'MAME', color: '#f43f8f', folders: ['mame', 'arcade'], exts: ['.zip', '.7z'], core: coreFile('mame_libretro'), exe: emulatorPaths.mame, preferExe: true, launchMode: 'mame', icon: 'M' },
  { id: 'ps1', name: 'PlayStation', short: 'PS1', color: '#94a3b8', folders: ['psx', 'ps1'], exts: ['.cue', '.chd', '.pbp'], core: coreFile('pcsx_rearmed_libretro'), exe: emulatorPaths.duckstation, preferExe: true, args: ['-batch', '-fullscreen'], biosPattern: /^scph[a-z0-9_-]*\.(?:bin|rom)$/i, biosHint: 'a BIOS file named like scph1001.bin or scph5500.rom', biosDirs: [path.join(localAppData, 'DuckStation', 'bios'), path.join(applicationSupport, 'DuckStation', 'bios'), path.join(HOME_DIR, '.local', 'share', 'duckstation', 'bios'), path.join(RGSX_ROOT, 'roms', 'bios')], icon: 'PS' },
  { id: 'ps2', name: 'PlayStation 2', short: 'PS2', color: '#3b82f6', folders: ['ps2'], exts: ['.iso', '.chd'], core: coreFile('play_libretro'), exe: emulatorPaths.pcsx2, preferExe: true, args: ['-fullscreen', '-batch', '--'], biosPattern: /^scph[a-z0-9_-]*\.(?:bin|rom)$/i, biosHint: 'a BIOS file named like scph39001.bin or scph70012.rom', biosDirs: [path.join(DOCUMENTS_DIR, 'PCSX2', 'bios'), path.join(applicationSupport, 'PCSX2', 'bios'), path.join(HOME_DIR, '.config', 'PCSX2', 'bios'), path.join(HOME_DIR, '.local', 'share', 'PCSX2', 'bios'), path.join(RGSX_ROOT, 'roms', 'bios')], icon: 'P2' },
  { id: 'psp', name: 'PlayStation Portable', short: 'PSP', color: '#06b6d4', folders: ['psp'], exts: ['.iso', '.cso', '.pbp', '.chd'], core: coreFile('ppsspp_libretro'), exe: emulatorPaths.ppsspp, preferExe: true, icon: 'PP' },
  { id: 'gamecube', name: 'Nintendo GameCube', short: 'GAMECUBE', color: '#7c3aed', folders: ['gamecube'], exts: ['.iso', '.gcm', '.rvz'], core: coreFile('dolphin_libretro'), exe: emulatorPaths.dolphin, preferExe: true, args: ['-b', '-e'], icon: 'GC' },
  { id: 'wii', name: 'Nintendo Wii', short: 'WII', color: '#0ea5e9', folders: ['wii'], exts: ['.wbfs', '.rvz'], core: coreFile('dolphin_libretro'), exe: emulatorPaths.dolphin, preferExe: true, args: ['-b', '-e'], icon: 'W' },
  { id: 'wiiu', name: 'Nintendo Wii U', short: 'WII U', color: '#00a2e8', folders: ['wiiu'], exts: ['.wud', '.wux', '.rpx'], exe: emulatorPaths.cemu, args: ['-f', '-g'], icon: 'WU' },
  { id: 'openbor', name: 'OpenBOR', short: 'OPENBOR', color: '#f97316', folders: ['openbor'], exts: ['.pak'], exe: emulatorPaths.openbor, preferExe: true, launchMode: 'openbor', presentation: 'native-fullscreen', icon: 'OB' }
];

const tgdbPlatforms = {
  snes: 6, satellaview: 6, sufami: 6, nes: 7, fds: 7, n64: 3, gb: 4, gba: 5, nds: 8, genesis: 18,
  mastersystem: 35, gamegear: 20, segacd: 21, pce: 34, saturn: 17,
  dreamcast: 16, atari2600: 22, arcade: 23, mame: 23, ps1: 10, ps2: 11,
  psp: 13, gamecube: 2, wii: 9, wiiu: 38
};

const AUTOMATION_MODE = process.argv.some(argument => String(argument).startsWith('--remote-debugging-port'));
let appIsQuitting = false;
let mainWindow = null;
let activity = [];
const downloads = new Map();
const downloadProcesses = new Map();
const gameDeckOpenBorProcesses = new Map();
const embeddedNativeWindows = new Map();
const pendingLaunches = new Map();
const mameLaunchVerificationCache = new Map();
const artworkRequests = new Map();
const artworkMisses = new Set();
const detailRequests = new Map();
const detailMisses = new Set();
const catalogRowsCache = new Map();
const thumbnailIndexRequests = new Map();
let artworkBackoffUntil = 0;
let artworkBackoffLogged = false;
let detailBackoffUntil = 0;
let mameTitleIndex = null;
let mameConfiguredRomPaths = null;
let arcadeAuditTask = null;
let controllerHintsCache = null;
const mameMetadataCache = new Map();
const firmwareInventoryCache = new Map();
const archiveSystemHintCache = new Map();
const playableArchiveIntegrityCache = new Map();
const discSystemHintCache = new Map();
let libraryFolderSystemIndex = null;
let runtimeManager = null;
let streamCaptureSourceId = '';
let streamCaptureAudio = true;
let streamServer = null;
let netplayManager = null;
let playSessionManager = null;
let embeddedPlayManager = null;
let armedPlayCapture = null;
let launchCurtainTimer = null;
let remotePlayProcess = null;
let remotePlaySession = null;
let remoteInputSocket = null;
let remoteInputTimer = null;
const remoteInputQueues = new Map();
function emitRemotePlay(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote-play-update', update);
}
function remotePlayStatus() {
  return remotePlaySession
    ? { ...remotePlaySession, active: Boolean(remotePlaySession.active), pid: remotePlayProcess?.pid || 0 }
    : { active: false, phase: 'idle', title: '', playerCount: 1, maxPlayers: 0, message: 'Ready for Remote Play Together.' };
}
function emitNetplay(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('netplay-update', update);
}
function gameDeckNetplayStatus() {
  return netplayManager ? netplayManager.status() : { active: false, phase: 'idle', message: 'Multiplayer is starting.' };
}
function emitStream(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream-update', update);
}
function gameDeckStreamStatus() {
  return streamServer ? streamServer.status() : { active: false, viewerCount: 0, viewers: [], urls: [], primaryUrl: '', localOnly: true };
}
async function gameDeckStreamSources() {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });
  return sources
    .filter(source => !/^GameDeck$/i.test(source.name))
    .map(source => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('screen:') ? 'screen' : 'window',
      displayId: source.display_id || '',
      thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
    }))
    .sort((a, b) => Number(a.type === 'screen') - Number(b.type === 'screen') || a.name.localeCompare(b.name));
}
function captureSourceNameKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function resolvePlayCaptureSource(playCapture) {
  let sources = [];
  const expectedName = captureSourceNameKey(playCapture?.sourceName);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
    const exact = sources.find(source => source.id === playCapture?.sourceId);
    if (exact) return { selected: exact, sources };
    if (expectedName) {
      const named = sources.find(source => {
        if (!source.id?.startsWith('window:') || /^GameDeck$/i.test(source.name)) return false;
        const candidate = captureSourceNameKey(source.name);
        return candidate === expectedName || candidate.includes(expectedName) || expectedName.includes(candidate);
      });
      if (named) return { selected: named, sources };
    }
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 120));
  }
  return { selected: null, sources };
}

function configureGameDeckCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    let completed = false;
    const finish = options => {
      if (completed) return;
      completed = true;
      callback(options);
    };
    try {
      const playCapture = armedPlayCapture && armedPlayCapture.expiresAt > Date.now() ? armedPlayCapture : null;
      let sources = [];
      let selected = null;
      if (playCapture) {
        const resolved = await resolvePlayCaptureSource(playCapture);
        sources = resolved.sources;
        selected = resolved.selected;
      } else {
        sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
        selected = sources.find(source => source.id === streamCaptureSourceId)
          || sources.find(source => source.id.startsWith('screen:'))
          || sources[0];
      }
      if (!selected) {
        armedPlayCapture = null;
        finish({});
        return;
      }
      const audio = playCapture ? playCapture.audio : streamCaptureAudio;
      armedPlayCapture = null;
      finish(audio && process.platform === 'win32' ? { video: selected, audio: 'loopback' } : { video: selected });
    } catch (error) {
      armedPlayCapture = null;
      addActivity('error', 'GameDeck capture failed: ' + error.message);
      if (!completed) finish({});
    }
  }, { useSystemPicker: false });
}

function emitRuntime(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime-update', update);
}
function managedRuntimeStatus() {
  return runtimeManager ? runtimeManager.status() : { supported: false, ready: false, installing: false, phase: 'idle', progress: 0, message: 'Runtime manager is starting.' };
}
function ensureManagedRuntime(options = {}) {
  if (!runtimeManager) return Promise.resolve(managedRuntimeStatus());
  return runtimeManager.ensure(options);
}

const arcadeAuditCache = readJson(ARCADE_AUDIT_FILE, { version: 1, entries: {}, updatedAt: 0 });
if (!arcadeAuditCache.entries || typeof arcadeAuditCache.entries !== 'object') arcadeAuditCache.entries = {};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function restorePersistedDownloads() {
  const rows = readJson(DOWNLOADS_FILE, []);
  if (!Array.isArray(rows)) return;
  for (const saved of rows.slice(-60)) {
    if (!saved?.id) continue;
    const job = { ...saved };
    delete job.pauseRequested;
    if (job.status === 'running') {
      job.status = 'paused';
      job.stage = 'Paused';
      job.resumable = true;
      job.message = 'Transfer was interrupted. Resume to continue from the saved progress.';
      job.updatedAt = Date.now();
    }
    downloads.set(job.id, job);
  }
}

function persistDownloads() {
  try {
    fs.mkdirSync(path.dirname(DOWNLOADS_FILE), { recursive: true });
    const rows = [...downloads.values()]
      .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0))
      .slice(-60)
      .map(job => ({ ...job }));
    fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(rows, null, 2));
  } catch (error) {
    addActivity('info', `Transfer state could not be saved: ${error.message}`);
  }
}

restorePersistedDownloads();

function readStore() {
  return readJson(STORE, { favorites: [], recent: {} });
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function walk(dir, out = [], seen = new Set()) {
  if (!fs.existsSync(dir)) return out;
  let realDir;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return out;
  }
  const key = process.platform === 'win32' ? realDir.toLowerCase() : realDir;
  if (seen.has(key)) return out;
  seen.add(key);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const item = path.join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = fs.statSync(item).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (isDirectory) walk(item, out, seen);
    else out.push(item);
  }
  return out;
}

function cleanName(file) {
  const leaf = String(file || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf
    .replace(/\.[^.]+$/, '')
    .replace(/[_.]/g, ' ')
    .replace(/^Sega\s*-\s*32X\s*/i, '')
    .replace(/\s*\[[^\]]*\]|\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawGameName(file) {
  const leaf = String(file || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').trim();
}

function lookupTitleName(value) {
  const text = String(value || '').trim();
  const extension = path.extname(text).toLowerCase();
  const knownExtensions = new Set([...systems.flatMap(system => system.exts), ...ART_EXTS]);
  if (!knownExtensions.has(extension)) return text;
  const leaf = text.replace(/\\/g, '/').split('/').pop() || text;
  return leaf.slice(0, -extension.length).trim();
}

function metadataLookupTitle(value, context = {}) {
  return cleanName(context.name || lookupTitleName(value)) || String(context.name || lookupTitleName(value) || 'Selected game').trim();
}

function normalizeName(value) {
  return lookupTitleName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fileIdentity(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function catalogFileIdentities(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\.[^.]+$/, '');
  return [...new Set([
    fileIdentity(value),
    normalized.toLowerCase().replace(/[^a-z0-9]+/g, '')
  ].filter(Boolean))];
}

function installedCatalogFile(installed, value) {
  for (const identity of catalogFileIdentities(value)) {
    const file = installed.get(identity);
    if (file) return file;
  }
  return '';
}

const ARCADE_SUPPORT_ARCHIVES = new Set(['neogeo.zip']);

function isArcadeSystem(systemOrId) {
  const id = typeof systemOrId === 'string' ? systemOrId : systemOrId?.id;
  return id === 'arcade' || id === 'mame';
}

function isArcadeSupportArchive(file, systemOrId) {
  return isArcadeSystem(systemOrId) && ARCADE_SUPPORT_ARCHIVES.has(path.basename(String(file || '')).toLowerCase());
}

function getMameTitleIndex() {
  if (mameTitleIndex) return mameTitleIndex;
  mameTitleIndex = new Map();
  if (!MAME || !fs.existsSync(MAME)) return mameTitleIndex;
  const listing = spawnSync(MAME, ['-listfull'], {
    cwd: path.dirname(MAME),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (listing.status !== 0) return mameTitleIndex;
  for (const line of String(listing.stdout || '').split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+"(.*)"$/);
    if (match) mameTitleIndex.set(match[1].toLowerCase(), match[2].replace(/""/g, '"'));
  }
  return mameTitleIndex;
}

function arcadeDisplayTitle(shortName) {
  const raw = rawGameName(shortName);
  return getMameTitleIndex().get(raw.toLowerCase()) || cleanName(raw);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlAttribute(markup, name) {
  return decodeXmlText(markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '');
}

function mameGameMetadata(shortName) {
  const key = rawGameName(shortName).toLowerCase();
  if (!key || !MAME || !fs.existsSync(MAME)) return null;
  if (mameMetadataCache.has(key)) return mameMetadataCache.get(key);
  const query = spawnSync(MAME, ['-listxml', key], {
    cwd: path.dirname(MAME),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (query.status !== 0) {
    mameMetadataCache.set(key, null);
    return null;
  }
  const xml = String(query.stdout || '');
  const machine = xml.match(/<machine\b[^>]*>[\s\S]*?<\/machine>/)?.[0] || '';
  const input = machine.match(/<input\b[^>]*>/)?.[0] || '';
  const control = machine.match(/<control\b[^>]*>/)?.[0] || '';
  const description = decodeXmlText(machine.match(/<description>([\s\S]*?)<\/description>/)?.[1] || arcadeDisplayTitle(key));
  const year = decodeXmlText(machine.match(/<year>([\s\S]*?)<\/year>/)?.[1] || '');
  const manufacturer = decodeXmlText(machine.match(/<manufacturer>([\s\S]*?)<\/manufacturer>/)?.[1] || '');
  const players = xmlAttribute(input, 'players');
  const buttons = xmlAttribute(control, 'buttons');
  const controlType = xmlAttribute(control, 'type');
  const ways = xmlAttribute(control, 'ways');
  const inputSummary = [players && `${players} player${players === '1' ? '' : 's'}`, controlType && `${ways ? `${ways}-way ` : ''}${controlType}`, buttons && `${buttons} buttons`].filter(Boolean).join(' · ');
  const metadata = {
    title: description,
    description: `${description}${year ? ` (${year})` : ''}${manufacturer ? ` by ${manufacturer}` : ''} is indexed by the installed MAME database.${inputSummary ? ` Cabinet input: ${inputSummary}.` : ''}`,
    year,
    players,
    buttons,
    controlType,
    manufacturer,
    source: 'MAME'
  };
  mameMetadataCache.set(key, metadata);
  return metadata;
}

function editionLabel(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const tags = [...leaf.matchAll(/\(([^)]+)\)/g)].map(match => match[1]).filter(Boolean);
  return tags.slice(0, 3).join(' / ');
}

function toFileUrl(file) {
  return pathToFileURL(file).href;
}

function firmwareFiles(directory) {
  const resolved = path.resolve(String(directory || ''));
  if (!resolved || !fs.existsSync(resolved)) return [];
  if (firmwareInventoryCache.has(resolved)) return firmwareInventoryCache.get(resolved);
  const files = walk(resolved).map(file => path.basename(file));
  firmwareInventoryCache.set(resolved, files);
  return files;
}

function invalidateFirmwareInventory(directory = '') {
  if (!directory) firmwareInventoryCache.clear();
  else firmwareInventoryCache.delete(path.resolve(directory));
}

function systemBiosReady(system) {
  if (!system.bios && !system.biosPattern) return true;
  const files = (system.biosDirs || []).flatMap(firmwareFiles);
  if (system.bios) {
    const available = new Set(files.map(file => file.toLowerCase()));
    const expected = system.bios.map(file => file.toLowerCase());
    const ready = system.biosMode === 'all'
      ? expected.every(file => available.has(file))
      : expected.some(file => available.has(file));
    if (ready) return true;
  }
  return Boolean(system.biosPattern && files.some(file => system.biosPattern.test(file)));
}

function restoreFirmwareFromExistingPack(system) {
  if (!system || systemBiosReady(system)) return true;
  if (!fs.existsSync(SEVEN_ZIP) || !fs.existsSync(RGSX_FIRMWARE_PACK)) return false;
  try {
    if (fs.statSync(RGSX_FIRMWARE_PACK).size < 1024 * 1024) return false;
    const destination = (system.biosDirs || []).find(Boolean);
    if (!destination) return false;
    const members = system.bios?.length
      ? system.bios.map(file => `bios\\${file}`)
      : system.id === 'ps2'
        ? ['bios\\scph39001.bin', 'bios\\SCPH30004R.bin']
        : system.id === 'ps1'
          ? ['bios\\scph5501.bin', 'bios\\scph1001.bin']
          : [];
    if (!members.length) return false;
    fs.mkdirSync(destination, { recursive: true });
    const extraction = spawnSync(SEVEN_ZIP, ['e', '-y', '-aoa', `-o${destination}`, '--', RGSX_FIRMWARE_PACK, ...members], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 60000
    });
    if (extraction.status === 0) invalidateFirmwareInventory(destination);
    if (extraction.status === 0 && systemBiosReady(system)) {
      addActivity('success', `${system.name} firmware restored from the existing RGSX BIOS pack.`);
      return true;
    }
  } catch (error) {
    addActivity('info', `Could not restore ${system.name} firmware from the local BIOS pack: ${error.message}`);
  }
  return false;
}

function systemFirmwareIssue(system) {
  const dirs = (system.biosDirs || []).filter(Boolean);
  const preferredDir = dirs[0] || '';
  if (system.bios?.length) {
    const separator = system.biosMode === 'all' ? ' and ' : ' or ';
    return `${system.name} firmware is required. Add ${system.bios.join(separator)} to ${preferredDir}.`;
  }
  if (system.biosPattern) {
    return `${system.name} firmware is required. Add ${system.biosHint || 'a compatible BIOS file'} to ${preferredDir}.`;
  }
  return `${system.name} firmware is required in ${preferredDir}.`;
}

function configuredEmulator(system) {
  const standaloneReady = Boolean(system.exe && fs.existsSync(system.exe));
  const corePath = system.core ? path.join(CORES, system.core) : '';
  const coreReady = Boolean(system.core && fs.existsSync(RA) && fs.existsSync(corePath));
  if (system.preferExe && standaloneReady) {
    return { kind: system.launchMode || 'standalone', executable: system.exe, label: system.id === 'mame' ? 'MAME standalone' : system.name };
  }
  if (coreReady) return { kind: 'libretro', executable: RA, corePath, label: system.id === 'arcade' ? 'RetroArch · FinalBurn Neo' : `RetroArch · ${system.name}` };
  if (standaloneReady) return { kind: system.launchMode || 'standalone', executable: system.exe, label: system.name };
  return null;
}

function configuredIntegratedEmulator(system) {
  const corePath = system.core ? path.join(CORES, system.core) : '';
  const managedCoreReady = Boolean(
    system.core
    && fs.existsSync(MANAGED_RUNTIME_PATHS.retroArch)
    && fs.existsSync(corePath)
  );
  if (managedCoreReady) {
    return {
      kind: 'libretro',
      executable: MANAGED_RUNTIME_PATHS.retroArch,
      corePath,
      label: system.id === 'arcade'
        ? 'GameDeck · FinalBurn Neo'
        : system.id === 'mame'
          ? 'GameDeck · MAME'
          : `GameDeck · ${system.name}`,
      integrated: true
    };
  }
  const standaloneReady = Boolean(system.exe && fs.existsSync(system.exe));
  if (standaloneReady) {
    return {
      kind: system.launchMode || 'standalone',
      executable: system.exe,
      label: system.id === 'mame' ? 'MAME standalone' : system.name,
      integrated: process.platform === 'win32'
    };
  }
  return null;
}

const SYSTEM_DISPLAY_ASPECT = new Map([
  ['gb', 10 / 9],
  ['gba', 3 / 2],
  ['nds', 2 / 3],
  ['psp', 16 / 9],
  ['gamecube', 16 / 9],
  ['wii', 16 / 9],
  ['wiiu', 16 / 9],
  ['openbor', 4 / 3]
]);

function systemDisplayAspect(system) {
  const value = Number(SYSTEM_DISPLAY_ASPECT.get(system?.id) || 4 / 3);
  return Number.isFinite(value) && value > 0.4 && value < 3 ? value : 4 / 3;
}

function playSessionCapabilityInput(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');

  const emulator = configuredIntegratedEmulator(system);
  const corePath = system.core ? path.join(CORES, system.core) : '';
  const firmwareReady = systemBiosReady(system);
  const dependenciesReady = !isArcadeSystem(system) || arcadeDependencySpecs(safeFile).every(dependency => Boolean(installedArcadeDependency(safeFile, dependency)));
  const managedRetroArch = Boolean(emulator?.kind === 'libretro' && emulator.executable === MANAGED_RUNTIME_PATHS.retroArch);
  const coreRelative = corePath ? path.relative(MANAGED_RUNTIME_PATHS.cores, corePath) : '';
  const managedCore = Boolean(corePath && coreRelative && !coreRelative.startsWith('..') && !path.isAbsolute(coreRelative));
  const openBorRelative = emulator?.executable ? path.relative(MANAGED_RUNTIME_ROOT, emulator.executable) : '';
  const managedOpenBor = Boolean(emulator?.kind === 'openbor' && openBorRelative && !openBorRelative.startsWith('..') && !path.isAbsolute(openBorRelative));
  const wayland = process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY || String(process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland');

  return {
    platform: process.platform,
    wayland,
    system: { id: system.id, name: system.name },
    engine: {
      kind: emulator?.kind || (system.core ? 'libretro' : 'unknown'),
      label: emulator?.label || system.name,
      managed: Boolean((managedRetroArch && managedCore) || managedOpenBor),
      captureEligible: Boolean(emulator?.integrated && process.platform === 'win32'),
      available: Boolean(emulator),
      coreAvailable: system.core ? Boolean(fs.existsSync(MANAGED_RUNTIME_PATHS.retroArch) && fs.existsSync(corePath)) : true,
      configAvailable: managedRetroArch ? fs.existsSync(MANAGED_RUNTIME_PATHS.config) : true
    },
    dependencies: {
      firmwareReady,
      ready: dependenciesReady
    },
    certification: system.id === 'openbor' && process.platform === 'win32' ? 'verified' : 'experimental'
  };
}
function systemSetupIssue(system) {
  if (!configuredEmulator(system)) {
    if (system.preferExe && system.core) return `${system.name} needs standalone MAME or its RetroArch core.`;
    if (system.core && !fs.existsSync(RA)) return 'RetroArch is not installed.';
    if (system.core && !fs.existsSync(path.join(CORES, system.core))) return `${system.name} core is not installed.`;
    return `${system.name} emulator is not installed or configured.`;
  }
  if (!systemBiosReady(system)) return systemFirmwareIssue(system);
  return '';
}

function systemReady(system) {
  return !systemSetupIssue(system);
}

function systemForFolder(folder) {
  const key = String(folder || '').toLowerCase();
  return systems.find(system => system.folders.includes(key)) || null;
}

function canonicalLibraryRootKey(value) {
  const resolved = path.resolve(value);
  try {
    const real = fs.realpathSync(resolved);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

function libraryFolderSystems(folder) {
  if (!libraryFolderSystemIndex) {
    const rootGroups = new Map();
    const folderRoots = new Map();
    for (const system of systems) {
      for (const alias of system.folders) {
        const key = canonicalLibraryRootKey(path.join(LIBRARY, alias));
        folderRoots.set(alias, key);
        const group = rootGroups.get(key) || new Map();
        group.set(system.id, system);
        rootGroups.set(key, group);
      }
    }
    libraryFolderSystemIndex = new Map([...folderRoots].map(([alias, key]) => [alias, [...(rootGroups.get(key)?.values() || [])]]));
  }
  return libraryFolderSystemIndex.get(String(folder || '').toLowerCase()) || [];
}

function archiveContentExtensions(file) {
  let fingerprint = '';
  try {
    const stat = fs.statSync(file);
    fingerprint = stat.size + ':' + Math.floor(stat.mtimeMs);
  } catch {
    return new Set();
  }
  const cached = archiveSystemHintCache.get(file);
  if (cached?.fingerprint === fingerprint) return cached.extensions;
  if (!SEVEN_ZIP || !fs.existsSync(SEVEN_ZIP)) return new Set();
  const listing = spawnSync(SEVEN_ZIP, ['l', '-ba', file], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 6000,
    maxBuffer: 2 * 1024 * 1024
  });
  const extensions = listing.status === 0 ? parseArchiveEntryExtensions(listing.stdout) : new Set();
  archiveSystemHintCache.set(file, { fingerprint, extensions });
  return extensions;
}

function playableArchiveIntegrity(file) {
  const extension = path.extname(file).toLowerCase();
  if (!['.zip', '.7z', '.rar'].includes(extension)) return { ok: true, checked: false, message: '' };
  let fingerprint = '';
  try {
    const stat = fs.statSync(file);
    fingerprint = stat.size + ':' + Math.floor(stat.mtimeMs);
  } catch {
    return { ok: false, checked: true, message: 'The game archive is missing or unreadable.' };
  }
  const cached = playableArchiveIntegrityCache.get(file);
  if (cached?.fingerprint === fingerprint) return cached.result;
  if (!SEVEN_ZIP || !fs.existsSync(SEVEN_ZIP)) return { ok: true, checked: false, message: '' };
  const test = spawnSync(SEVEN_ZIP, ['t', '-bd', '-bso0', '-bsp0', '--', file], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  const output = [test.stdout, test.stderr].filter(Boolean).join('\n');
  const ok = test.status === 0 && !/Unexpected end of archive|Data Error|CRC Failed|Headers Error|Can not open the file as archive/i.test(output);
  const result = {
    ok,
    checked: true,
    message: ok ? '' : 'This game archive is damaged or incomplete. Replace it from a legally owned backup before launching.'
  };
  playableArchiveIntegrityCache.set(file, { fingerprint, result });
  return result;
}

function rawDiscSystem(file) {
  try {
    const handle = fs.openSync(file, 'r');
    const header = Buffer.alloc(512);
    fs.readSync(handle, header, 0, header.length, 0);
    fs.closeSync(handle);
    return parseDiscHeaderSystem(header);
  } catch {
    return '';
  }
}

function discSystemForFile(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.wbfs' || extension === '.wad') return 'wii';
  if (extension === '.gcm' || extension === '.tgc') return 'gamecube';
  let fingerprint = '';
  try {
    const stat = fs.statSync(file);
    fingerprint = stat.size + ':' + Math.floor(stat.mtimeMs);
  } catch {
    return '';
  }
  const cached = discSystemHintCache.get(file);
  if (cached?.fingerprint === fingerprint) return cached.systemId;
  let systemId = ['.iso', '.gcm', '.rvz', '.wia', '.gcz'].includes(extension) ? rawDiscSystem(file) : '';
  if (!systemId && DOLPHIN_TOOL && fs.existsSync(DOLPHIN_TOOL) && ['.rvz', '.wia', '.gcz', '.iso'].includes(extension)) {
    const header = spawnSync(DOLPHIN_TOOL, ['header', '-i', file, '-j'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024
    });
    if (header.status === 0) systemId = parseDolphinHeaderSystem(header.stdout);
  }
  if (!systemId) {
    const name = path.basename(file);
    if (/\bwii\b/i.test(name)) systemId = 'wii';
    else if (/\bgamecube\b|\bgc\b/i.test(name)) systemId = 'gamecube';
  }
  discSystemHintCache.set(file, { fingerprint, systemId });
  return systemId;
}

function detectSystem(file) {
  const relative = path.relative(LIBRARY, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const folder = relative.split(path.sep)[0].toLowerCase();
  const direct = systemForFolder(folder);
  const candidates = libraryFolderSystems(folder);
  const extension = path.extname(file).toLowerCase();
  const compatible = candidates.filter(system => system.exts.includes(extension));
  const selected = chooseLibrarySystem(compatible, {
    fileExtension: extension,
    archiveExtensions: ['.zip', '.7z'].includes(extension) ? archiveContentExtensions(file) : new Set(),
    discSystemId: ['.iso', '.gcm', '.rvz', '.wbfs', '.wia', '.gcz', '.tgc', '.wad'].includes(extension) ? discSystemForFile(file) : '',
    directSystemId: direct?.id || '',
    sharedRoot: new Set(candidates.map(system => system.id)).size > 1
  });
  if (selected) return selected;
  if (direct && candidates.length <= 1 && direct.exts.includes(extension)) return direct;

  const matches = systems.filter(system => system.exts.includes(extension));
  return matches.length === 1 ? matches[0] : null;
}

function isPlayableFile(file, system) {
  const extension = path.extname(file).toLowerCase();
  if (!system || !system.exts.includes(extension)) return false;
  if (extension !== '.m3u') return true;
  try {
    const entries = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(value => value && !value.startsWith('#'));
    return entries.length > 0 && entries.every(value => fs.existsSync(path.resolve(path.dirname(file), value)));
  } catch {
    return false;
  }
}

function cachedArtworkPath(title, systemId, folder = '') {
  const identity = lookupTitleName(title).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const key = crypto.createHash('sha1').update(`${folder}:${systemId}:${identity}`).digest('hex');
  return path.join(ART_CACHE, `${key}.image`);
}

function cachedDetailsPath(title, systemId) {
  const identity = normalizeName(title) || 'game';
  const key = crypto.createHash('sha1').update(`${systemId}:${identity}`).digest('hex');
  return path.join(DETAILS_CACHE, `${key}.json`);
}

function gameTags(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  return [...leaf.matchAll(/\(([^)]+)\)/g)].map(match => match[1].trim()).filter(Boolean);
}

function gameRegion(tags) {
  const regions = ['USA', 'Europe', 'Japan', 'World', 'Asia', 'Australia', 'Brazil', 'Canada', 'France', 'Germany', 'Italy', 'Korea', 'Spain', 'Sweden', 'Taiwan'];
  return tags.find(tag => regions.some(region => new RegExp(`(^|[, ])${region}($|[, ])`, 'i').test(tag))) || '';
}

function localGameMetadata(title, context = {}) {
  const file = String(context.file || '');
  if (!file || !fs.existsSync(file)) return null;
  const directory = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  const candidates = [
    path.join(directory, `${base}.json`),
    path.join(directory, `${base}.metadata.json`),
    path.join(directory, 'metadata', `${base}.json`),
    path.join(directory, 'media', 'metadata', `${base}.json`)
  ];
  const source = candidates.find(candidate => fs.existsSync(candidate));
  if (!source) return null;
  const data = readJson(source, null);
  if (!data || typeof data !== 'object') return null;
  const description = String(data.description || data.overview || data.summary || '').replace(/\s+/g, ' ').trim();
  if (!description) return null;
  const releaseDate = String(data.releaseDate || data.release_date || data.released || '').trim();
  return {
    title: String(data.title || data.name || metadataLookupTitle(title, context)).trim(),
    description,
    releaseDate,
    year: String(data.year || releaseDate.match(/\b(19|20)\d{2}\b/)?.[0] || '').trim(),
    players: String(data.players || data.playerCount || '').trim(),
    rating: String(data.rating || '').trim(),
    genre: String(data.genre || '').trim(),
    developer: String(data.developer || '').trim(),
    publisher: String(data.publisher || '').trim(),
    source: 'Local metadata'
  };
}

function fallbackGameDetails(title, systemId, context = {}) {
  const system = systems.find(item => item.id === systemId);
  const gameTitle = metadataLookupTitle(title, context);
  const systemName = system?.name || String(context.systemName || 'this console');
  const edition = String(context.edition || '').trim();
  const region = String(context.region || '').trim();
  const releaseLabel = [region && `${region} release`, edition && !edition.includes(region) ? edition : ''].filter(Boolean).join(' · ');
  const availability = context.installed
    ? 'It is installed and ready to launch with the emulator already configured for this system.'
    : 'Add it to your deck through RGSX, then GameDeck will match it with the configured emulator automatically.';
  return {
    title: gameTitle,
    description: `${gameTitle} is part of the ${systemName} collection${releaseLabel ? ` (${releaseLabel})` : ''}. ${availability}`,
    releaseDate: '',
    year: '',
    players: '',
    rating: '',
    source: 'GameDeck'
  };
}

async function fetchGameDetails(title, systemId, context = {}) {
  const localArcade = isArcadeSystem(systemId) ? mameGameMetadata(context.shortName || title) : null;
  const localMetadata = localGameMetadata(title, context);
  const fallback = { ...fallbackGameDetails(title, systemId, context), ...(localArcade || {}), ...(localMetadata || {}) };
  const platformId = tgdbPlatforms[systemId];
  const detailTitle = metadataLookupTitle(title, context);
  const cacheFile = cachedDetailsPath(detailTitle, systemId);
  const cached = readJson(cacheFile, null);
  if (localMetadata?.description) return localMetadata;
  if (cached?.description) return cached;
  if (!platformId || detailMisses.has(cacheFile) || Date.now() < detailBackoffUntil) return fallback;
  if (detailRequests.has(cacheFile)) return detailRequests.get(cacheFile);

  const request = (async () => {
    try {
      const key = fs.readFileSync(path.join(RGSX_APP, 'assets', 'TheGamesDBAPI.txt'), 'utf8').trim();
      if (!key) return fallback;
      const params = new URLSearchParams({
        apikey: key,
        name: detailTitle,
        'filter[platform]': String(platformId)
      });
      const response = await fetch(`https://api.thegamesdb.net/v1/Games/ByGameName?${params}`, { signal: AbortSignal.timeout(8000) });
      if (response.status === 429) {
        detailBackoffUntil = Date.now() + 10 * 60 * 1000;
        return fallback;
      }
      if (!response.ok) throw Error(`metadata HTTP ${response.status}`);
      const payload = await response.json();
      const game = payload?.data?.games?.[0];
      const overview = String(game?.overview || '').replace(/\s+/g, ' ').trim();
      if (!game?.id || !overview) {
        detailMisses.add(cacheFile);
        return fallback;
      }
      const releaseDate = String(game.release_date || '').trim();
      const details = {
        title: String(game.game_title || fallback.title).trim(),
        description: overview,
        releaseDate,
        year: releaseDate.match(/\b(19|20)\d{2}\b/)?.[0] || fallback.year || '',
        players: String(game.players || '').trim() || fallback.players || '',
        rating: Number.isFinite(Number(game.rating)) && Number(game.rating) > 0 ? Number(game.rating).toFixed(1) : '',
        buttons: fallback.buttons || '',
        controlType: fallback.controlType || '',
        manufacturer: fallback.manufacturer || '',
        source: 'TheGamesDB'
      };
      fs.mkdirSync(DETAILS_CACHE, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(details, null, 2));
      return details;
    } catch (error) {
      addActivity('info', `Game details are temporarily unavailable for ${detailTitle}: ${error.message}`);
      return fallback;
    } finally {
      detailRequests.delete(cacheFile);
    }
  })();

  detailRequests.set(cacheFile, request);
  return request;
}

function rgsxSystemArtwork(folders) {
  const names = [...folders, 'default'];
  const found = names.map(name => path.join(RGSX_DATA, 'images', `${name}.png`)).find(candidate => fs.existsSync(candidate));
  return found ? toFileUrl(found) : '';
}

function resolveGameArt(file, title, systemId, folder) {
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  const candidates = [];
  const artNames = [...new Set([base, title, lookupTitleName(title)].filter(Boolean))];
  const artFolders = ['', 'images', 'artwork', 'boxart', 'boxarts', 'covers', path.join('media', 'images'), path.join('media', 'boxart'), path.join('media', 'covers')];
  for (const extension of ART_EXTS) {
    for (const artFolder of artFolders) {
      for (const artName of artNames) candidates.push(path.join(dir, artFolder, `${artName}${extension}`));
    }
    if (isArcadeSystem(systemId) && MAME && fs.existsSync(MAME)) {
      const mameRoot = path.dirname(MAME);
      for (const mediaFolder of ['flyers', 'snap', 'titles', 'cabinets', 'marquees']) {
        candidates.push(path.join(mameRoot, mediaFolder, `${base}${extension}`));
        candidates.push(path.join(mameRoot, mediaFolder, base, `0000${extension}`));
      }
    }
  }
  candidates.push(cachedArtworkPath(base, systemId, folder));
  candidates.push(cachedArtworkPath(title, systemId, folder));
  candidates.push(cachedArtworkPath(title, systemId));
  const found = candidates.find(candidate => fs.existsSync(candidate));
  return found ? toFileUrl(found) : '';
}

function archiveFingerprint(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return '';
  }
}

function cachedArchiveAudit(file) {
  const entry = arcadeAuditCache.entries?.[file];
  if (!entry || entry.fingerprint !== archiveFingerprint(file)) {
    return { status: 'unchecked', message: 'Waiting for an archive integrity check.', checkedAt: 0 };
  }
  return entry;
}

function saveArcadeAuditCache() {
  try {
    arcadeAuditCache.updatedAt = Date.now();
    fs.mkdirSync(path.dirname(ARCADE_AUDIT_FILE), { recursive: true });
    fs.writeFileSync(ARCADE_AUDIT_FILE, JSON.stringify(arcadeAuditCache, null, 2));
  } catch (error) {
    addActivity('info', `Arcade audit cache could not be saved: ${error.message}`);
  }
}

function configuredMameRomPaths() {
  if (mameConfiguredRomPaths) return mameConfiguredRomPaths;
  mameConfiguredRomPaths = [];
  if (!MAME || !fs.existsSync(MAME)) return mameConfiguredRomPaths;
  const config = spawnSync(MAME, ['-showconfig'], {
    cwd: path.dirname(MAME),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024
  });
  const value = String(config.stdout || '').match(/^rompath\s+(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, '') || 'roms';
  mameConfiguredRomPaths = value.split(';').map(item => item.trim()).filter(Boolean);
  return mameConfiguredRomPaths;
}

function mameRomSearchPath(file) {
  const romDirectory = path.dirname(file);
  const candidates = [romDirectory, ...configuredMameRomPaths()];
  if (path.basename(romDirectory).toLowerCase() === 'roms') {
    const chdDirectory = path.join(path.dirname(romDirectory), 'CHDs');
    if (fs.existsSync(chdDirectory)) candidates.push(chdDirectory);
  }
  return [...new Set(candidates)].join(';');
}

function processResult(executable, args, options = {}) {
  return new Promise(resolve => {
    let output = '';
    let settled = false;
    let timer = null;
    const child = spawn(executable, args, {
      cwd: options.cwd || path.dirname(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const collect = chunk => { output = `${output}${chunk}`.slice(-12000); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', error => finish({ ok: false, code: -1, output, error: error.message }));
    child.once('close', code => finish({ ok: code === 0, code, output }));
    timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: -1, output, error: 'Timed out' });
    }, options.timeout || 20000);
  });
}

async function inspectArcadeArchive(game) {
  const extension = path.extname(game.file).toLowerCase();
  const fingerprint = archiveFingerprint(game.file);
  const base = { fingerprint, checkedAt: Date.now(), format: extension.replace('.', '').toUpperCase() };
  if (!fingerprint) return { ...base, status: 'damaged', message: 'The archive is missing or unreadable.' };
  const size = Number(fingerprint.split(':')[0] || 0);
  if (size < 64) return { ...base, status: 'damaged', message: 'The archive is empty or incomplete.' };
  const missingDependencies = missingArcadeDependencies(game.file);
  if (missingDependencies.length) {
    return { ...base, status: 'repairable', dependencies: missingDependencies.map(item => item.fileName), message: 'GameDeck will install ' + missingDependencies.map(item => item.label).join(', ') + ' automatically on first launch.' };
  }
  if (!SEVEN_ZIP || !fs.existsSync(SEVEN_ZIP)) {
    return { ...base, status: 'unchecked', message: 'Install 7-Zip or configure RGSX to enable integrity checks.' };
  }
  const container = await processResult(SEVEN_ZIP, ['t', '-bso0', '-bsp0', '-bse1', '--', game.file], { timeout: 30000 });
  if (!container.ok) {
    const detail = String(container.output || container.error || '').split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'Integrity check failed.';
    return { ...base, status: 'damaged', message: `Archive damage detected: ${detail}` };
  }
  if (game.system === 'mame' && MAME && fs.existsSync(MAME)) {
    const verification = await processResult(MAME, ['-verifyroms', game.shortName, '-rompath', mameRomSearchPath(game.file)], { timeout: 45000 });
    if (!verification.ok) {
      return { ...base, status: 'incomplete', message: 'MAME reports missing, mismatched, parent, or BIOS files for this ROM set.' };
    }
    return { ...base, status: 'verified', message: 'Archive and MAME ROM-set verification passed.' };
  }
  return { ...base, status: 'verified', message: 'Archive integrity passed. FBNeo compatibility still depends on a matching ROM-set version.' };
}

function inspectArcadeArchiveSync(game) {
  const fingerprint = archiveFingerprint(game.file);
  const extension = path.extname(game.file).toLowerCase();
  const base = { fingerprint, checkedAt: Date.now(), format: extension.replace('.', '').toUpperCase() };
  const size = Number(fingerprint.split(':')[0] || 0);
  const missingDependencies = fingerprint && size >= 64 ? missingArcadeDependencies(game.file) : [];
  if (missingDependencies.length) {
    const repairable = { ...base, status: 'repairable', dependencies: missingDependencies.map(item => item.fileName), message: 'GameDeck will install ' + missingDependencies.map(item => item.label).join(', ') + ' automatically on first launch.' };
    arcadeAuditCache.entries[game.file] = repairable;
    saveArcadeAuditCache();
    return repairable;
  }
  const cached = cachedArchiveAudit(game.file);
  if (cached.status !== 'unchecked' && cached.status !== 'repairable' && game.system !== 'mame') return cached;
  let result;
  if (!fingerprint || size < 64) {
    result = { ...base, status: 'damaged', message: 'The archive is empty, incomplete, or unreadable.' };
  } else if (!SEVEN_ZIP || !fs.existsSync(SEVEN_ZIP)) {
    result = { ...base, status: 'unchecked', message: 'Archive integrity could not be checked because 7-Zip is unavailable.' };
  } else {
    const container = spawnSync(SEVEN_ZIP, ['t', '-bso0', '-bsp0', '-bse1', '--', game.file], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    });
    result = container.status === 0
      ? { ...base, status: 'verified', message: 'Archive integrity passed.' }
      : { ...base, status: 'damaged', message: 'Archive damage detected. Replace it with a verified dump; GameDeck will not redownload it automatically.' };
    if (result.status === 'verified' && game.system === 'mame' && MAME && fs.existsSync(MAME)) {
      const verify = spawnSync(MAME, ['-verifyroms', game.shortName, '-rompath', mameRomSearchPath(game.file)], {
        cwd: path.dirname(MAME),
        windowsHide: true,
        encoding: 'utf8',
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024
      });
      result = verify.status === 0
        ? { ...base, status: 'verified', message: 'Archive and MAME ROM-set verification passed.' }
        : { ...base, status: 'incomplete', message: 'MAME reports missing, mismatched, parent, or BIOS files for this ROM set.' };
    }
  }
  arcadeAuditCache.entries[game.file] = result;
  saveArcadeAuditCache();
  return result;
}

function arcadeAuditSnapshot(games) {
  const arcadeGames = games.filter(game => isArcadeSystem(game.system));
  const items = arcadeGames.map(game => ({ file: game.file, shortName: game.shortName, ...cachedArchiveAudit(game.file) }));
  return {
    total: items.length,
    verified: items.filter(item => item.status === 'verified').length,
    attention: items.filter(item => ['damaged', 'incomplete', 'repairable'].includes(item.status)).length,
    unchecked: items.filter(item => item.status === 'unchecked').length,
    zip: arcadeGames.filter(game => game.format === 'ZIP').length,
    sevenZip: arcadeGames.filter(game => game.format === '7Z').length,
    updatedAt: Math.max(0, ...items.map(item => Number(item.checkedAt || 0))),
    items
  };
}

function emitArcadeAuditProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('arcade-audit-progress', payload);
}

async function auditArcadeLibrary(force = false) {
  if (arcadeAuditTask) return arcadeAuditTask;
  arcadeAuditTask = (async () => {
    const library = getLibrary();
    const games = library.games.filter(game => isArcadeSystem(game.system));
    const pending = games.filter(game => force || cachedArchiveAudit(game.file).status === 'unchecked');
    let cursor = 0;
    let done = 0;
    emitArcadeAuditProgress({ running: true, done, total: pending.length, current: '' });
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) {
        const game = pending[cursor++];
        const result = await inspectArcadeArchive(game);
        arcadeAuditCache.entries[game.file] = result;
        done += 1;
        emitArcadeAuditProgress({ running: true, done, total: pending.length, current: game.title, status: result.status });
      }
    });
    await Promise.all(workers);
    if (pending.length) saveArcadeAuditCache();
    const snapshot = arcadeAuditSnapshot(games);
    emitArcadeAuditProgress({ running: false, done: pending.length, total: pending.length, ...snapshot });
    return snapshot;
  })().finally(() => { arcadeAuditTask = null; });
  return arcadeAuditTask;
}

function getLibrary() {
  const state = readStore();
  const games = walk(LIBRARY).map(file => {
    if (activeManagedDownloadFile(file)) return null;
    const system = detectSystem(file);
    if (!isPlayableFile(file, system) || isArcadeSupportArchive(file, system)) return null;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    const shortName = rawGameName(file);
    const title = isArcadeSystem(system) ? arcadeDisplayTitle(shortName) : cleanName(file);
    const folder = path.relative(LIBRARY, file).split(path.sep)[0].toLowerCase();
    const archive = isArcadeSystem(system) ? cachedArchiveAudit(file) : null;
    return {
      id: Buffer.from(file).toString('base64url'),
      title,
      file,
      system: system.id,
      size: stat.size,
      art: resolveGameArt(file, title, system.id, folder),
      artworkTitle: isArcadeSystem(system) ? title : shortName,
      metadataTitle: title,
      artworkFolder: folder,
      shortName,
      edition: editionLabel(file),
      region: gameRegion(gameTags(file)),
      format: path.extname(file).replace('.', '').toUpperCase(),
      archiveHealth: archive?.status || '',
      archiveHealthMessage: archive?.message || '',
      autoRepair: Boolean(isArcadeSystem(system) && ['damaged', 'incomplete'].includes(archive?.status) && findRgsxCatalogAsset(path.basename(file), folder)),
      favorite: state.favorites.includes(file),
      lastPlayed: state.recent[file] || null
    };
  }).filter(Boolean);
  const installedBySystem = Object.fromEntries(systems.map(system => [system.id, 0]));
  for (const game of games) installedBySystem[game.system] = (installedBySystem[game.system] || 0) + 1;

  return {
    systems: systems.map(system => ({
      ...system,
      image: rgsxSystemArtwork(system.folders),
      ready: systemReady(system),
      issue: systemSetupIssue(system),
      emulatorKind: configuredEmulator(system)?.kind || '',
      emulatorLabel: configuredEmulator(system)?.label || '',
      count: games.filter(game => game.system === system.id).length,
      installedCount: installedBySystem[system.id] || 0
    })),
    games
  };
}

function addActivity(level, message, taskId = null) {
  const clean = String(message || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim();
  if (!clean) return;
  const entry = { id: `${Date.now()}-${Math.random()}`, at: Date.now(), level, message: clean, taskId };
  activity = [...activity.slice(-399), entry];
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('activity', entry);
}

runtimeManager = createRuntimeManager({
  root: MANAGED_RUNTIME_ROOT,
  manifestPath: path.join(__dirname, 'config', 'runtime-manifest.json'),
  appVersion: app.getVersion(),
  bundledCacheRoot: BUNDLED_RUNTIME_ROOT,
  onUpdate: emitRuntime,
  onLog: addActivity
});
streamServer = createStreamServer({
  mobileRoot: path.join(__dirname, 'mobile', 'web'),
  onUpdate: emitStream,
  onLog: addActivity
});
netplayManager = createNetplayManager({
  root: NETPLAY_ROOT,
  appVersion: app.getVersion(),
  onUpdate: emitNetplay,
  onLog: addActivity
});
playSessionManager = createPlaySessionManager({
  resolveCapabilityInput: playSessionCapabilityInput
});

function emitDownload(job) {
  if (!job?.id) return;
  downloads.set(job.id, job);
  persistDownloads();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-update', { ...job });
}

function emitLaunch(update) {
  if (!update || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('launch-update', { ...update });
}

function registerPendingLaunch(taskId, file, message) {
  if (!taskId || !file) return;
  pendingLaunches.set(taskId, { file, message: String(message || 'GameDeck is preparing this game.') });
  emitLaunch({ file, taskId, status: 'repairing', message: String(message || 'GameDeck is preparing this game.') });
}

function completePendingLaunch(taskId, ok, error = '') {
  const pending = pendingLaunches.get(taskId);
  if (!pending) return;
  pendingLaunches.delete(taskId);
  if (!ok) {
    emitLaunch({ file: pending.file, taskId, status: 'failed', message: error || 'Automatic setup could not be completed.' });
    return;
  }
  setTimeout(() => {
    try {
      launchGame(pending.file, { automatic: true });
    } catch (launchError) {
      addActivity('error', `Automatic launch failed: ${launchError.message}`, taskId);
      emitLaunch({ file: pending.file, taskId, status: 'failed', message: launchError.message });
    }
  }, 350);
}

function unitBytes(value, unit) {
  const powers = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 };
  return Number(value) * (1024 ** (powers[String(unit || 'B').toUpperCase()] || 0));
}

function updateDownloadFromLine(job, line) {
  const clean = String(line || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trim();
  if (!clean) return;

  const percent = clean.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) job.progress = Math.min(100, Math.max(0, Number(percent[1])));

  const transfer = clean.match(/\(?\s*(\d+(?:\.\d+)?)\s*(B|K(?:i)?B|M(?:i)?B|G(?:i)?B|T(?:i)?B)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|K(?:i)?B|M(?:i)?B|G(?:i)?B|T(?:i)?B)\s*\)?/i);
  if (transfer) {
    job.downloadedBytes = Math.round(unitBytes(transfer[1], transfer[2]));
    job.totalBytes = Math.round(unitBytes(transfer[3], transfer[4]));
  }

  const speed = clean.match(/(?:@|at)?\s*(\d+(?:\.\d+)?)\s*(B|K(?:i)?B|M(?:i)?B|G(?:i)?B|T(?:i)?B)\s*\/\s*s\b/i);
  if (speed) {
    job.speedBytes = Math.round(unitBytes(speed[1], speed[2]));
    job.speed = `${Number(speed[1]).toFixed(Number(speed[1]) < 10 ? 1 : 0)} ${speed[2].replace(/i/i, '')}/s`;
  }

  const eta = clean.match(/ETA\s*[: ]\s*([0-9:]+|\d+\s*[smh])/i);
  if (eta) job.eta = eta[1];
  else if (job.speedBytes > 0 && job.totalBytes > job.downloadedBytes) {
    job.etaSeconds = Math.max(1, Math.round((job.totalBytes - job.downloadedBytes) / job.speedBytes));
  }

  if (/extract|unpack|install/i.test(clean)) job.stage = 'Installing';
  else if (/verif|checksum|hash/i.test(clean)) job.stage = 'Verifying';
  else if (/connect|resolv|prepar|queue/i.test(clean)) job.stage = 'Preparing';
  else if (/download|\d+\s*%/i.test(clean)) job.stage = job.localInstall ? 'Installing' : 'Downloading';
  job.message = clean.slice(0, 220);
  job.updatedAt = Date.now();
  emitDownload(job);
}

function safeLibraryFile(file) {
  const resolved = path.resolve(String(file || ''));
  const relative = path.relative(path.resolve(LIBRARY), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
    throw Error('The selected game is not inside the RGSX library.');
  }
  if (activeManagedDownloadFile(resolved)) {
    throw Error('This game is still downloading. Wait for the transfer to finish before launching.');
  }
  return resolved;
}

function ensureRetroArchArcadeControllerConfig() {
  const lines = [
    'input_autodetect_enable = "true"',
    'input_player1_joypad_index = "0"',
    'input_player2_joypad_index = "1"',
    'input_player1_analog_dpad_mode = "1"',
    'input_player2_analog_dpad_mode = "1"'
  ];
  if (process.platform === 'win32') lines.unshift('input_joypad_driver = "xinput"');
  const content = `${lines.join('\n')}\n`;
  try {
    fs.mkdirSync(path.dirname(ARCADE_CONTROLLER_CONFIG), { recursive: true });
    if (!fs.existsSync(ARCADE_CONTROLLER_CONFIG) || fs.readFileSync(ARCADE_CONTROLLER_CONFIG, 'utf8') !== content) {
      fs.writeFileSync(ARCADE_CONTROLLER_CONFIG, content);
    }
    return ARCADE_CONTROLLER_CONFIG;
  } catch (error) {
    addActivity('info', `Arcade controller profile could not be refreshed: ${error.message}`);
    return '';
  }
}

function ensureRetroArchEmbeddedConfig() {
  const lines = [
    'video_fullscreen = "false"',
    'video_windowed_fullscreen = "false"',
    'video_window_show_decorations = "false"',
    'video_aspect_ratio_auto = "true"',
    'aspect_ratio_index = "22"',
    'video_force_aspect = "true"',
    'video_scale_integer = "false"',
    'video_scale = "3.0"',
    'pause_nonactive = "false"',
    'menu_show_load_content_animation = "false"',
    'notification_show_autoconfig = "false"',
    'notification_show_cheats_applied = "false"',
    'notification_show_fast_forward = "false"',
    'notification_show_refresh_rate = "false"',
    'video_font_enable = "false"'
  ];
  const content = `${lines.join('\n')}\n`;
  fs.mkdirSync(path.dirname(EMBEDDED_RETROARCH_CONFIG), { recursive: true });
  if (!fs.existsSync(EMBEDDED_RETROARCH_CONFIG) || fs.readFileSync(EMBEDDED_RETROARCH_CONFIG, 'utf8') !== content) {
    fs.writeFileSync(EMBEDDED_RETROARCH_CONFIG, content);
  }
  return EMBEDDED_RETROARCH_CONFIG;
}

function ensureOpenBorRuntimeConfig(executable = emulatorPaths.openbor) {
  if (!executable || !fs.existsSync(executable)) return { ready: false, issue: 'OpenBOR is not installed.' };
  const root = path.dirname(executable);
  const directories = ['Logs', 'Paks', 'Saves', 'ScreenShots'];
  for (const folder of directories) fs.mkdirSync(path.join(root, folder), { recursive: true });
  const profile = {
    version: 1,
    engine: 'OpenBOR',
    compatibilityBuild: 'v3.0 Build 6391',
    executable,
    root,
    directPakLaunch: false,
    deterministicSinglePackSession: true,
    backgroundControllerInput: true,
    controllerProfile: 'xinput-player-1',
    savesDirectory: path.join(root, 'Saves'),
    logsDirectory: path.join(root, 'Logs'),
    screenshotsDirectory: path.join(root, 'ScreenShots'),
    updatedAt: new Date().toISOString()
  };
  const profileFile = path.join(app.getPath('userData'), 'openbor-runtime.json');
  fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2));
  return { ready: true, root, profileFile, logFile: path.join(root, 'Logs', 'OpenBorLog.txt') };
}

function ensureOpenBorGameSession(file, executable = emulatorPaths.openbor) {
  const runtime = ensureOpenBorRuntimeConfig(executable);
  if (!runtime.ready) throw Error(runtime.issue || 'OpenBOR runtime setup is incomplete.');
  const launch = prepareOpenBorLaunch({
    engineExecutable: executable,
    sourcePak: safeLibraryFile(file),
    sessionsRoot: path.join(app.getPath('userData'), 'runtime', 'openbor', 'sessions'),
    presentation: 'integrated',
    configOptions: {
      fullscreen: false,
      preserveAspect: true,
      useOpenGl: false,
      hardwareScale: 1,
      hardwareFilter: true,
      softwareFilter: 0,
      controllerProfile: 'xinput-if-default'
    }
  });
  return { ...launch, root: launch.sessionRoot };
}

function emitPlaySession(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('play-session-update', update);
}

async function embeddedCaptureSources() {
  const gameDeckSourceId = mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.getMediaSourceId === 'function'
    ? mainWindow.getMediaSourceId()
    : '';
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    type: 'window',
    ownedByGameDeck: Boolean(source.id === gameDeckSourceId || /^GameDeck$/i.test(source.name))
  }));
}

function restoreGameDeckWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(launchCurtainTimer);
  launchCurtainTimer = null;
  mainWindow.setAlwaysOnTop(false);
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function windowsWindowInteropScript(body) {
  return `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameDeckWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int value);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetMenu(IntPtr hWnd, IntPtr hMenu);
  [DllImport("user32.dll")] public static extern bool DrawMenuBar(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
${body}`;
}

function readWindowsEngineWindow(pid) {
  if (process.platform !== 'win32' || !Number(pid)) return null;
  const script = windowsWindowInteropScript(`
$process = Get-Process -Id ${Number(pid)} -ErrorAction Stop
for ($i = 0; $i -lt 80 -and $process.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 100; $process.Refresh() }
$handle = $process.MainWindowHandle
if ($handle -eq 0) { throw 'Game window handle was not available.' }
$rect = New-Object GameDeckWindow+RECT
$client = New-Object GameDeckWindow+RECT
[GameDeckWindow]::GetWindowRect($handle, [ref]$rect) | Out-Null
[GameDeckWindow]::GetClientRect($handle, [ref]$client) | Out-Null
[pscustomobject]@{
  handle = [long]$handle
  menu = [long][GameDeckWindow]::GetMenu($handle)
  style = [GameDeckWindow]::GetWindowLong($handle, -16)
  exStyle = [GameDeckWindow]::GetWindowLong($handle, -20)
  owner = [long][GameDeckWindow]::GetWindowLongPtr($handle, -8)
  x = $rect.Left
  y = $rect.Top
  width = $rect.Right - $rect.Left
  height = $rect.Bottom - $rect.Top
  clientWidth = $client.Right - $client.Left
  clientHeight = $client.Bottom - $client.Top
  title = $process.MainWindowTitle
} | ConvertTo-Json -Compress
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0 || !String(result.stdout || '').trim()) return null;
  try { return JSON.parse(String(result.stdout).trim()); } catch { return null; }
}

function applyWindowsEngineWindow(pid, config) {
  if (process.platform !== 'win32' || !Number(pid) || !config) return false;
  const script = windowsWindowInteropScript(`
$process = Get-Process -Id ${Number(pid)} -ErrorAction Stop
$handle = $process.MainWindowHandle
if ($handle -eq 0) { throw 'Game window handle was not available.' }
[GameDeckWindow]::SetWindowLong($handle, -16, ${Number(config.style) | 0}) | Out-Null
[GameDeckWindow]::SetWindowLong($handle, -20, ${Number(config.exStyle) | 0}) | Out-Null
$menu = [IntPtr]${config.hideMenu ? 0 : Number(config.menu || 0)}
[GameDeckWindow]::SetMenu($handle, $menu) | Out-Null
[GameDeckWindow]::DrawMenuBar($handle) | Out-Null
[GameDeckWindow]::ShowWindow($handle, 9) | Out-Null
$after = [IntPtr](${config.behind ? 1 : 0})
$flags = [uint32](0x0020 -bor 0x0040${config.activate ? '' : ' -bor 0x0010'})
[GameDeckWindow]::SetWindowPos($handle, $after, ${Math.round(config.x)}, ${Math.round(config.y)}, ${Math.max(1, Math.round(config.width))}, ${Math.max(1, Math.round(config.height))}, $flags) | Out-Null
${config.activate ? '[GameDeckWindow]::SetForegroundWindow($handle) | Out-Null' : ''}
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return result.status === 0;
}

function engineWindowState(session) {
  const pid = Number(session?.child?.pid || 0);
  if (!pid || process.platform !== 'win32') return null;
  let state = embeddedNativeWindows.get(pid);
  if (!state) {
    state = readWindowsEngineWindow(pid);
    if (state) embeddedNativeWindows.set(pid, state);
  }
  return state ? { pid, state } : null;
}

function physicalScreenRect(window, rect) {
  try {
    if (typeof screen.dipToScreenRect === 'function') return screen.dipToScreenRect(window, rect);
  } catch {}
  const display = screen.getDisplayMatching(rect);
  const scaleFactor = Number(display?.scaleFactor || 1);
  return {
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor)
  };
}

function setEmbeddedEngineWindowMode(session, mode) {
  const owned = engineWindowState(session);
  if (!owned || !mainWindow || mainWindow.isDestroyed()) return false;
  const { pid, state } = owned;
  const mainBoundsDip = mainWindow.getBounds();
  const mainBounds = physicalScreenRect(mainWindow, mainBoundsDip);
  if (mode === 'popout') {
    const display = screen.getDisplayMatching(mainBoundsDip);
    const area = physicalScreenRect(mainWindow, display.workArea);
    const width = Math.min(Math.max(800, state.width || 960), Math.max(800, area.width - 120));
    const height = Math.min(Math.max(450, state.height || 544), Math.max(450, area.height - 120));
    const x = Math.round(area.x + (area.width - width) / 2);
    const y = Math.round(area.y + (area.height - height) / 2);
    return applyWindowsEngineWindow(pid, { ...state, menu: state.menu, hideMenu: false, x, y, width, height, behind: false, activate: true });
  }

  const chromeMask = 0x00C00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000;
  const style = (Number(state.style) | 0) & ~chromeMask;
  const exStyle = (((Number(state.exStyle) | 0) | 0x00000080 | 0x08000000) & ~0x00040000);
  const requestedAspect = Number(session?.aspectRatio || session?.spec?.aspectRatio || 16 / 9);
  const aspect = Number.isFinite(requestedAspect) && requestedAspect > 0.4 && requestedAspect < 3 ? requestedAspect : 16 / 9;
  const horizontalMargin = Math.max(96, Math.round(mainBounds.width * 0.08));
  const verticalMargin = Math.max(96, Math.round(mainBounds.height * 0.11));
  let width = Math.max(800, mainBounds.width - (horizontalMargin * 2));
  let height = Math.round(width / aspect);
  const maxHeight = Math.max(450, mainBounds.height - (verticalMargin * 2));
  if (height > maxHeight) { height = maxHeight; width = Math.round(height * aspect); }
  const x = Math.round(mainBounds.x + (mainBounds.width - width) / 2);
  const y = Math.round(mainBounds.y + (mainBounds.height - height) / 2);
  const applied = applyWindowsEngineWindow(pid, { style, exStyle, menu: 0, hideMenu: true, x, y, width, height, behind: true, activate: false });
  if (applied && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  }
  return applied;
}

const embeddedWindowController = {
  async prepare() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.show();
    mainWindow.setAlwaysOnTop(false);
    mainWindow.focus();
  },
  async integrate(session, _source, requestedMode) {
    if (process.platform === 'win32') {
      const owned = engineWindowState(session);
      if (owned) {
        const measured = Number(owned.state?.clientWidth || 0) / Math.max(1, Number(owned.state?.clientHeight || 0));
        if (Number.isFinite(measured) && measured > 0.4 && measured < 3) session.aspectRatio = measured;
      }
      if (requestedMode !== 'popout') setEmbeddedEngineWindowMode(session, requestedMode || 'docked');
    }
  },
  captureStarted(session) {
    if (process.platform !== 'win32' || !session || session.mode === 'popout') return;
    const stabilize = delay => setTimeout(() => {
      const current = embeddedPlayManager?.status();
      if (!current?.active || current.sessionId !== session.id || current.mode === 'popout') return;
      setEmbeddedEngineWindowMode(session, current.mode || 'docked');
    }, delay);
    setEmbeddedEngineWindowMode(session, session.mode || 'docked');
    stabilize(350);
    stabilize(1100);
  },
  setAspect(_aspect, session) {
    if (process.platform === 'win32' && session?.mode !== 'popout') setEmbeddedEngineWindowMode(session, session?.mode || 'docked');
  },
  async setMode(mode, session) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mode === 'popout') {
      mainWindow.setAlwaysOnTop(false);
      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      if (!mainWindow.isMinimized()) mainWindow.minimize();
      setEmbeddedEngineWindowMode(session, 'popout');
      setTimeout(() => {
        const current = embeddedPlayManager?.status();
        if (!current?.active || current.sessionId !== session.id || current.mode !== 'popout') return;
        setEmbeddedEngineWindowMode(session, 'popout');
      }, 180);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.setFullScreen(mode === 'fullscreen');
    mainWindow.setAlwaysOnTop(false);
    setEmbeddedEngineWindowMode(session, mode);
    mainWindow.moveTop();
    mainWindow.focus();
  },
  release(session) {
    const pid = Number(session?.child?.pid || 0);
    if (pid) embeddedNativeWindows.delete(pid);
  },
  restore: restoreGameDeckWindow
};

function registerGameDeckOpenBorProcess(child) {
  if (!child?.pid) return child;
  gameDeckOpenBorProcesses.set(child.pid, child);
  const forget = () => gameDeckOpenBorProcesses.delete(child.pid);
  child.once?.('exit', forget);
  child.once?.('error', forget);
  return child;
}

function stopGameDeckOpenBorProcesses(exceptPid = 0) {
  for (const [pid, child] of [...gameDeckOpenBorProcesses]) {
    if (Number(pid) === Number(exceptPid)) continue;
    try {
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(-pid, 'SIGTERM');
    } catch {
      try { child?.kill?.('SIGTERM'); } catch {}
    }
    gameDeckOpenBorProcesses.delete(pid);
  }
}

function terminateEmbeddedProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
}

function protectExternalLaunch(duration = 3400) {
  if (!mainWindow || mainWindow.isDestroyed() || embeddedPlayManager?.status().active) return;
  clearTimeout(launchCurtainTimer);
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.focus();
  launchCurtainTimer = setTimeout(() => {
    launchCurtainTimer = null;
    if (!embeddedPlayManager?.status().active && mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false);
  }, duration);
}

function embeddedLaunchSpec(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');
  if (!isArcadeSystem(system)) {
    const archiveIntegrity = playableArchiveIntegrity(safeFile);
    if (!archiveIntegrity.ok) throw Error(archiveIntegrity.message);
  }
  const setupIssue = systemSetupIssue(system);
  if (setupIssue) throw Error(setupIssue);
  const dependencyResult = resolveLaunchDependencies(safeFile, system);
  if (dependencyResult?.queued) return { queued: true, ...dependencyResult };
  if (!dependencyResult?.ok) throw Error(dependencyResult?.error || 'Required game files could not be prepared.');

  const game = { file: safeFile, system: system.id, shortName: rawGameName(safeFile) };
  if (isArcadeSystem(system)) {
    const audit = inspectArcadeArchiveSync(game);
    if (audit.status === 'damaged' || audit.status === 'incomplete') throw Error(audit.message || 'This arcade set needs repair before integrated play.');
  }
  const emulator = configuredIntegratedEmulator(system);
  if (!emulator) throw Error(system.name + ' emulator is not installed or configured.');
  const capabilities = playSessionManager.capabilities(safeFile);
  if (!capabilities?.eligible || !capabilities?.presentation?.embedded) throw Error(capabilities?.fallback?.playerMessage || 'This game uses external play.');

  let args = [];
  let launchCwd = path.dirname(emulator.executable);
  let openBorSession = null;
  let libretroReadiness = null;
  if (emulator.kind === 'libretro') {
    if (emulator.executable !== MANAGED_RUNTIME_PATHS.retroArch) throw Error('Integrated play requires the managed GameDeck RetroArch runtime.');
    const arcade = isArcadeSystem(system);
    const configs = [ensureRetroArchEmbeddedConfig(), arcade ? ensureRetroArchArcadeControllerConfig() : ''].filter(Boolean);
    launchCwd = resolveLibretroLaunchCwd({ contentFile: safeFile, emulatorExecutable: emulator.executable, arcade });
    if (arcade && isFbneoCore(emulator.corePath)) {
      libretroReadiness = buildFbneoReadiness({ userData: app.getPath('userData'), shortName: game.shortName });
      fs.mkdirSync(path.dirname(libretroReadiness.logFile), { recursive: true });
      try { fs.unlinkSync(libretroReadiness.logFile); } catch {}
    }
    args = [
      ...(fs.existsSync(MANAGED_RUNTIME_PATHS.config) ? ['--config', MANAGED_RUNTIME_PATHS.config] : []),
      ...(configs.length ? [`--appendconfig=${configs.join('|')}`] : []),
      ...(libretroReadiness ? ['--verbose', `--log-file=${libretroReadiness.logFile}`] : []),
      '-L', emulator.corePath, safeFile
    ];
  } else if (emulator.kind === 'openbor') {
    openBorSession = ensureOpenBorGameSession(safeFile, emulator.executable);
    try { fs.unlinkSync(openBorSession.logFile); } catch {}
    launchCwd = openBorSession.root;
    args = [];
  } else if (emulator.kind === 'mame') {
    args = [
      game.shortName,
      '-rompath', mameRomSearchPath(safeFile),
      '-joystick',
      ...(process.platform === 'win32' ? ['-joystickprovider', 'winhybrid'] : []),
      '-skip_gameinfo',
      '-noconfirm_quit',
      '-window'
    ];
  } else if (emulator.kind === 'standalone') {
    const windowedArgs = (system.args || []).filter(argument => !['-fullscreen', '--fullscreen', '-f'].includes(String(argument).toLowerCase()));
    args = [...windowedArgs, safeFile];
  } else {
    throw Error('This engine is not enabled for integrated play yet.');
  }

  const displayName = isArcadeSystem(system) ? arcadeDisplayTitle(game.shortName) : cleanName(safeFile);
  return {
    executable: emulator.executable,
    args,
    cwd: launchCwd,
    readiness: openBorSession ? {
      logFile: openBorSession.logFile,
      requiredText: `Game Selected: ./Paks/${path.basename(safeFile)}`,
      timeoutMs: 30000,
      pollMs: 200,
      message: 'Loading the selected OpenBOR pack…',
      failureMessage: 'OpenBOR started, but the selected game pack did not load.'
    } : libretroReadiness,
    env: {
      ...process.env,
      SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '1',
      SDL_VIDEO_MINIMIZE_ON_FOCUS_LOSS: '0',
      SDL_VIDEO_CENTERED: '1',
      SDL_JOYSTICK_HIDAPI: '1',
      SDL_JOYSTICK_HIDAPI_XBOX: '1',
      GAMEDECK_EMBEDDED_PLAY: '1'
    },
    title: displayName,
    shortName: game.shortName,
    systemId: system.id,
    classification: capabilities.classification,
    engineLabel: emulator.label,
    engineKind: emulator.kind,
    aspectRatio: systemDisplayAspect(system),
    captureAudio: false,
    audioMode: 'native_engine',
    controllerProfile: openBorSession?.controllerProfile || null,
    sourceTerms: [
      displayName,
      game.shortName,
      system.name,
      emulator.kind === 'openbor' ? 'OpenBOR' : '',
      emulator.kind === 'libretro' ? 'RetroArch' : '',
      path.basename(emulator.executable, path.extname(emulator.executable))
    ].filter(Boolean),
    sourceTimeoutMs: emulator.kind === 'libretro' ? 20000 : 45000,
    file: safeFile
  };
}

async function startEmbeddedPlay(file, options = {}) {
  const activeStatus = embeddedPlayManager?.status();
  if (activeStatus?.active) return { ok: false, error: 'A GameDeck Play session is already active.', status: activeStatus };
  const spec = embeddedLaunchSpec(file);
  if (spec.systemId === 'openbor') stopGameDeckOpenBorProcesses();
  if (spec.queued) return { ok: true, queued: true, taskId: spec.taskId, message: spec.message };
  if (netplayManager?.status().active) netplayManager.stop('Opening integrated play.');
  const result = await embeddedPlayManager.start(spec, options);
  if (result.ok) {
    const store = readStore();
    store.recent[spec.file] = Date.now();
    writeStore(store);
    const controllerNote = spec.controllerProfile?.xinputReady ? ' with Xbox/XInput Player 1 controls' : '';
    addActivity('success', `Integrated play ready: ${spec.title} with ${spec.engineLabel}${controllerNote}`);
  } else {
    addActivity('error', `Integrated play failed: ${result.error}`);
  }
  return result;
}

function arcadeDependencySpecs(file) {
  const folder = path.relative(LIBRARY, file).split(path.sep)[0]?.toLowerCase() || '';
  if (folder === 'neogeo') {
    return [{ fileName: 'neogeo.zip', folder: 'neogeo', label: 'Neo Geo system files' }];
  }
  return [];
}

function missingArcadeDependencies(file) {
  return arcadeDependencySpecs(file).filter(dependency => !installedArcadeDependency(file, dependency));
}

function installedArcadeDependency(file, dependency) {
  const candidates = [
    path.join(path.dirname(file), dependency.fileName),
    path.join(LIBRARY, dependency.folder || '', dependency.fileName),
    path.join(RA_SYSTEM, 'fbneo', dependency.fileName),
    path.join(RA_SYSTEM, dependency.fileName)
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function findRgsxCatalogAsset(fileName, preferredFolder = '') {
  const target = String(fileName || '').toLowerCase();
  const catalog = getCatalogSystems().sort((a, b) => Number(b.folder === preferredFolder) - Number(a.folder === preferredFolder));
  for (const platform of catalog) {
    const row = readCatalogRows(platform.gamesFile).find(item => String(item?.[0] || '').toLowerCase() === target);
    if (row) return { source: platform.source, folder: platform.folder, fileName: row[0], size: row[2] || '' };
  }
  return null;
}

function queueLaunchDependency(file, dependency) {
  const installed = installedArcadeDependency(file, dependency);
  if (installed) return { ok: true, ready: true, installedFile: installed };
  const asset = findRgsxCatalogAsset(dependency.fileName, dependency.folder);
  if (!asset) return { ok: false, error: dependency.label + ' are missing and no managed RGSX source is available.' };
  const title = dependency.label;
  const result = queueRgsxDownload(asset.source, asset.folder, title, asset.fileName);
  if (result?.installedFile) return { ok: true, ready: true, installedFile: result.installedFile };
  if (result?.queued) {
    const job = downloads.get(result.taskId);
    const gameTitle = isArcadeSystem(detectSystem(file)) ? arcadeDisplayTitle(rawGameName(file)) : cleanName(file);
    const message = 'Installing ' + dependency.label + '. ' + gameTitle + ' will open automatically.';
    if (job) {
      job.dependency = true;
      job.autoLaunch = true;
      job.launchFile = file;
      job.title = dependency.label;
      job.stage = 'Auto setup';
      job.message = message;
      emitDownload(job);
    }
    registerPendingLaunch(result.taskId, file, message);
    return { ok: true, queued: true, taskId: result.taskId, message };
  }
  return result || { ok: false, error: 'Automatic dependency setup could not start.' };
}

function queueManagedGameRepair(file, audit) {
  const folder = path.relative(LIBRARY, file).split(path.sep)[0]?.toLowerCase() || '';
  const asset = findRgsxCatalogAsset(path.basename(file), folder);
  if (!asset) return { ok: false, error: audit?.message || 'This game needs a verified replacement archive.' };
  const gameTitle = isArcadeSystem(detectSystem(file)) ? arcadeDisplayTitle(rawGameName(file)) : cleanName(file);
  const result = queueRgsxDownload(asset.source, asset.folder, gameTitle, asset.fileName, { force: true, repair: true });
  if (result?.queued) {
    const job = downloads.get(result.taskId);
    const message = 'Repairing ' + gameTitle + ' from its managed RGSX source. It will open automatically.';
    if (job) {
      job.autoLaunch = true;
      job.launchFile = file;
      job.stage = 'Repairing';
      job.message = message;
      emitDownload(job);
    }
    registerPendingLaunch(result.taskId, file, message);
    return { ok: true, queued: true, taskId: result.taskId, message };
  }
  return result || { ok: false, error: 'Automatic repair could not start.' };
}

function resolveLaunchDependencies(file, system) {
  if (!isArcadeSystem(system)) return { ok: true, ready: true };
  for (const dependency of arcadeDependencySpecs(file)) {
    const result = queueLaunchDependency(file, dependency);
    if (!result?.ready) return result;
  }
  return { ok: true, ready: true };
}

function verifyMameLaunchRoute(game) {
  if (!MAME || !fs.existsSync(MAME)) return { ok: false, reason: 'MAME is unavailable.' };
  const dependencySignature = arcadeDependencySpecs(game.file).map(dependency => {
    const installed = installedArcadeDependency(game.file, dependency);
    if (!installed) return dependency.fileName + ':missing';
    const stat = fs.statSync(installed);
    return dependency.fileName + ':' + stat.size + ':' + Math.floor(stat.mtimeMs);
  }).join('|');
  const fingerprint = archiveFingerprint(game.file) + ':' + dependencySignature;
  const cached = mameLaunchVerificationCache.get(game.file);
  if (cached?.fingerprint === fingerprint) return cached;
  const verification = spawnSync(MAME, ['-verifyroms', game.shortName, '-rompath', mameRomSearchPath(game.file)], {
    cwd: path.dirname(MAME),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024
  });
  const result = {
    ok: verification.status === 0,
    fingerprint,
    output: (String(verification.stdout || '') + String(verification.stderr || '')).trim()
  };
  mameLaunchVerificationCache.set(game.file, result);
  return result;
}

function selectLaunchEmulator(system, game) {
  const preferred = configuredEmulator(system);
  const folder = path.relative(LIBRARY, game.file).split(path.sep)[0]?.toLowerCase() || '';
  if (isArcadeSystem(system) && (folder === 'neogeo' || system.id === 'mame')) {
    const verification = verifyMameLaunchRoute(game);
    if (verification.ok && preferred && system.id !== 'mame') {
      return { ...preferred, label: preferred.label + ' · verified set', verified: true };
    }
    if (verification.ok) {
      return { kind: 'mame', executable: MAME, label: 'MAME · verified route', verified: true };
    }
    if (!preferred) throw Error(verification.output || 'No compatible arcade engine could validate this ROM set.');
    addActivity('info', 'MAME did not validate ' + game.shortName + '; using ' + preferred.label + ' instead.');
  }
  return preferred;
}

const NETPLAY_SYSTEMS = new Set(['arcade', 'mame', 'nes', 'snes', 'genesis', 'mastersystem', 'gamegear', 'pce', 'atari2600', 'gb', 'gba']);

function netplayPlayerCapacity(system, shortName) {
  if (isArcadeSystem(system)) {
    const metadata = mameGameMetadata(shortName);
    const players = Number(metadata?.players || 0);
    if (players > 1) return Math.min(16, players);
    if (/^(gauntlet|tmnt|simpsons|xmen|captaven|sunsetr|dungeons|ddtod|ddsom)/i.test(shortName)) return 4;
  }
  return 2;
}

async function netplaySpecForFile(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');
  if (!NETPLAY_SYSTEMS.has(system.id)) throw Error(`${system.name} is not yet in GameDeck's verified netplay set.`);
  if (!system.core) throw Error(`${system.name} does not have a compatible Libretro netplay engine.`);

  let corePath = path.join(CORES, system.core);
  if ((!fs.existsSync(RA) || !fs.existsSync(corePath)) && runtimeManager?.canInstall) {
    const installed = await ensureManagedRuntime();
    if (!installed?.ready) throw Error(installed?.message || 'GameDeck could not prepare the multiplayer engine.');
    corePath = path.join(CORES, system.core);
  }
  if (!fs.existsSync(RA)) throw Error('RetroArch is required for synchronized multiplayer.');
  if (!fs.existsSync(corePath)) throw Error(`${system.name} multiplayer core is not installed.`);
  if (!systemBiosReady(system)) throw Error(systemFirmwareIssue(system));

  const dependencyResult = resolveLaunchDependencies(safeFile, system);
  if (dependencyResult?.queued) throw Error('GameDeck is still preparing this game. Start multiplayer when the transfer finishes.');
  if (!dependencyResult?.ok) throw Error(dependencyResult?.error || 'Required game files could not be prepared.');

  const game = { file: safeFile, system: system.id, shortName: rawGameName(safeFile) };
  if (isArcadeSystem(system)) {
    const audit = inspectArcadeArchiveSync(game);
    if (audit.status === 'damaged' || audit.status === 'incomplete') {
      throw Error(audit.message || 'This arcade archive must be repaired before multiplayer.');
    }
  }

  const controllerConfig = isArcadeSystem(system) ? ensureRetroArchArcadeControllerConfig() : '';
  const managedConfig = RA === MANAGED_RUNTIME_PATHS.retroArch && fs.existsSync(MANAGED_RUNTIME_PATHS.config)
    ? ['--config', MANAGED_RUNTIME_PATHS.config]
    : [];
  const rawDisplayName = isArcadeSystem(system) ? arcadeDisplayTitle(game.shortName) : cleanName(safeFile);
  const displayName = rawDisplayName.replace(/\s*\((?:NGM|NGH)-[^)]+\)$/i, '');
  const stat = fs.statSync(safeFile);
  return {
    executable: RA,
    baseArgs: ['-f', ...managedConfig],
    appendConfigs: controllerConfig ? [controllerConfig] : [],
    corePath,
    coreLabel: system.id === 'arcade' ? 'FinalBurn Neo' : system.name,
    contentFile: safeFile,
    fileSize: stat.size,
    title: displayName,
    systemId: system.id,
    maxPlayers: netplayPlayerCapacity(system, game.shortName),
    shortName: game.shortName
  };
}

function netplayGameInfo(file) {
  try {
    const safeFile = safeLibraryFile(file);
    const system = detectSystem(safeFile);
    if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');
    const shortName = rawGameName(safeFile);
    const supported = NETPLAY_SYSTEMS.has(system.id) && Boolean(system.core);
    return {
      ok: true,
      supported,
      title: isArcadeSystem(system) ? arcadeDisplayTitle(shortName) : cleanName(safeFile),
      systemId: system.id,
      systemName: system.name,
      maxPlayers: supported ? netplayPlayerCapacity(system, shortName) : 0,
      coreFile: system.core || '',
      issue: supported ? '' : `${system.name} is not yet in GameDeck's verified netplay set.`
    };
  } catch (error) {
    return { ok: false, supported: false, error: error.message, issue: error.message, maxPlayers: 0 };
  }
}

async function netplayMatchInfo(file) {
  try {
    const spec = await netplaySpecForFile(file);
    const [contentSha256, coreSha256] = await Promise.all([
      netplayManager.fileSha256(spec.contentFile),
      netplayManager.fileSha256(spec.corePath)
    ]);
    const compact = value => String(value).slice(0, 12).toUpperCase().match(/.{1,4}/g).join('-');
    return {
      ok: true,
      supported: true,
      title: spec.title,
      systemId: spec.systemId,
      systemName: spec.coreLabel,
      coreFile: path.basename(spec.corePath),
      coreLabel: spec.coreLabel,
      maxPlayers: spec.maxPlayers,
      matchId: compact(contentSha256),
      coreMatchId: compact(coreSha256),
      contentSha256,
      coreSha256
    };
  } catch (error) {
    return { ok: false, supported: false, error: error.message, issue: error.message, maxPlayers: 0 };
  }
}

const MAX_REMOTE_PLAY_CODE_LENGTH = 64 * 1024;
const MAX_REMOTE_PLAY_COMPRESSED_BYTES = 48 * 1024;
const MAX_REMOTE_PLAY_PAYLOAD_BYTES = 256 * 1024;

function encodeRemotePlayCode(prefix, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  if (json.length > MAX_REMOTE_PLAY_PAYLOAD_BYTES) throw Error('Remote Play invitation data is too large.');
  const compressed = zlib.brotliCompressSync(json, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length
    }
  });
  return `${prefix}.${compressed.toString('base64url')}`;
}

function decodeRemotePlayCode(value, acceptedPrefixes = []) {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_REMOTE_PLAY_CODE_LENGTH) throw Error('This Remote Play code is empty or too large.');
  const prefix = acceptedPrefixes.find(candidate => text.startsWith(`${candidate}.`));
  if (!prefix) throw Error(`Expected a ${acceptedPrefixes.join(' or ')} code.`);
  const encoded = text.slice(prefix.length + 1);
  let payload;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error('This Remote Play code is malformed.');
  if (prefix.endsWith('2')) {
    const compressed = Buffer.from(encoded, 'base64url');
    if (!compressed.length || compressed.length > MAX_REMOTE_PLAY_COMPRESSED_BYTES) throw Error('This Remote Play code is too large.');
    const decoded = zlib.brotliDecompressSync(compressed, { maxOutputLength: MAX_REMOTE_PLAY_PAYLOAD_BYTES });
    payload = JSON.parse(decoded.toString('utf8'));
  } else {
    const decoded = Buffer.from(encoded, 'base64url');
    if (!decoded.length || decoded.length > MAX_REMOTE_PLAY_PAYLOAD_BYTES) throw Error('This Remote Play code is too large.');
    payload = JSON.parse(decoded.toString('utf8'));
  }
  if (payload?.version !== 1) throw Error('This Remote Play code uses an unsupported version.');
  if (payload.expiresAt && Date.now() > Number(payload.expiresAt)) throw Error('This Remote Play code has expired.');
  return payload;
}

function remoteInputPacket(playerIndex, buttonId, state) {
  const packet = Buffer.alloc(20);
  packet.writeInt32LE(playerIndex, 0);
  packet.writeInt32LE(1, 4); // RETRO_DEVICE_JOYPAD
  packet.writeInt32LE(0, 8);
  packet.writeInt32LE(buttonId, 12);
  packet.writeUInt16LE(state ? 1 : 0, 16);
  return packet;
}

function ensureRemoteInputPump() {
  if (remoteInputTimer) return;
  if (!remoteInputSocket) remoteInputSocket = dgram.createSocket('udp4');
  remoteInputTimer = setInterval(() => {
    if (!remotePlaySession?.active) return;
    for (const [playerIndex, queue] of remoteInputQueues) {
      const event = queue.shift();
      if (!event) continue;
      const packet = remoteInputPacket(playerIndex, event.id, event.state);
      remoteInputSocket.send(packet, remotePlaySession.basePort + playerIndex, '127.0.0.1');
    }
  }, 17);
  remoteInputTimer.unref?.();
}

function queueRemotePlayInput(payload = {}) {
  if (!remotePlaySession?.active || payload.sessionId !== remotePlaySession.sessionId) return false;
  const playerIndex = Number(payload.playerIndex);
  if (!Number.isInteger(playerIndex) || playerIndex < 1 || playerIndex >= remotePlaySession.maxPlayers) return false;
  const events = Array.isArray(payload.events) ? payload.events.slice(0, 32) : [];
  if (!events.length) return false;
  const queue = remoteInputQueues.get(playerIndex) || [];
  let accepted = 0;
  for (const event of events) {
    const id = Number(event?.id);
    if (!Number.isInteger(id) || id < 0 || id > 15) continue;
    queue.push({ id, state: event.state ? 1 : 0 });
    accepted += 1;
  }
  if (!accepted) return false;
  if (queue.length > 180) queue.splice(0, queue.length - 180);
  remoteInputQueues.set(playerIndex, queue);
  remotePlaySession.inputEventCount = Number(remotePlaySession.inputEventCount || 0) + accepted;
  remotePlaySession.lastInputAt = Date.now();
  remotePlaySession.lastInputPlayer = playerIndex + 1;
  emitRemotePlay(remotePlaySession);
  ensureRemoteInputPump();
  return true;
}

function stopRemotePlay(reason = 'Remote Play Together ended.') {
  if (remotePlayProcess?.pid) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(remotePlayProcess.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else process.kill(-remotePlayProcess.pid, 'SIGTERM');
    } catch {
      try { process.kill(remotePlayProcess.pid); } catch {}
    }
  }
  remotePlayProcess = null;
  remoteInputQueues.clear();
  if (remoteInputTimer) clearInterval(remoteInputTimer);
  remoteInputTimer = null;
  if (remoteInputSocket) {
    try { remoteInputSocket.close(); } catch {}
    remoteInputSocket = null;
  }
  const previous = remotePlaySession;
  remotePlaySession = null;
  const status = { active: false, phase: 'idle', title: previous?.title || '', playerCount: 1, maxPlayers: 0, message: reason };
  emitRemotePlay(status);
  return status;
}

async function startRemotePlay(file, config = {}) {
  stopRemotePlay('Starting a new Remote Play Together session.');
  netplayManager?.stop('Switching to Remote Play Together.');
  const spec = await netplaySpecForFile(file);
  const maxPlayers = Math.max(2, Math.min(spec.maxPlayers || 2, Number(config.maxPlayers || spec.maxPlayers || 2)));
  const basePort = 55400;
  const id = `remote-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const sessionId = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(NETPLAY_ROOT, { recursive: true });
  const configFile = path.join(NETPLAY_ROOT, `${id}.cfg`);
  const lines = [
    'network_remote_enable = "true"',
    `network_remote_base_port = "${basePort}"`,
    `input_max_users = "${maxPlayers}"`,
    'network_remote_enable_user_p1 = "false"'
  ];
  for (let player = 2; player <= maxPlayers; player += 1) lines.push(`network_remote_enable_user_p${player} = "true"`);
  fs.writeFileSync(configFile, `${lines.join('\n')}\n`);
  const appendConfig = [...(spec.appendConfigs || []), configFile].filter(Boolean).join('|');
  const logFile = path.join(NETPLAY_ROOT, `${id}.log`);
  const args = [
    '--verbose',
    `--log-file=${logFile}`,
    ...spec.baseArgs,
    ...(appendConfig ? [`--appendconfig=${appendConfig}`] : []),
    '-L',
    spec.corePath,
    spec.contentFile
  ];
  remotePlayProcess = spawn(spec.executable, args, {
    cwd: path.dirname(spec.executable),
    detached: true,
    windowsHide: false,
    stdio: 'ignore'
  });
  remotePlaySession = {
    active: true,
    phase: 'launching',
    id,
    sessionId,
    title: spec.title,
    systemId: spec.systemId,
    maxPlayers,
    playerCount: 1,
    inputEventCount: 0,
    lastInputAt: 0,
    lastInputPlayer: 0,
    basePort,
    contentFile: spec.contentFile,
    coreFile: path.basename(spec.corePath),
    startedAt: Date.now(),
    logFile,
    message: `Opening ${spec.title} for Remote Play Together…`
  };
  remotePlayProcess.once('error', error => {
    addActivity('error', `Remote Play Together failed: ${error.message}`);
    if (remotePlaySession?.id === id) {
      remotePlaySession = { ...remotePlaySession, active: false, phase: 'error', error: error.message, message: error.message };
      emitRemotePlay(remotePlaySession);
    }
  });
  remotePlayProcess.once('exit', code => {
    if (remotePlaySession?.id !== id) return;
    const message = code === 0 ? 'Remote Play game closed.' : `Remote Play game exited with code ${code}.`;
    remotePlayProcess = null;
    remotePlaySession = null;
    emitRemotePlay({ active: false, phase: 'idle', title: spec.title, playerCount: 1, maxPlayers: 0, message });
  });
  remotePlayProcess.unref();
  const store = readStore();
  store.recent[spec.contentFile] = Date.now();
  writeStore(store);
  setTimeout(() => {
    if (remotePlaySession?.id === id && remotePlaySession.active) {
      remotePlaySession = { ...remotePlaySession, phase: 'ready', message: 'Game is running. Create an encrypted player invitation.' };
      emitRemotePlay(remotePlaySession);
    }
  }, 1800);
  emitRemotePlay(remotePlaySession);
  addActivity('success', `Remote Play Together started for ${spec.title}.`);
  return remotePlayStatus();
}

async function findNetplayGame(inviteValue, preferredFile = '') {
  const invite = netplayManager.decodeInvite(inviteValue);
  if (preferredFile) {
    try {
      const preferred = safeLibraryFile(preferredFile);
      const system = detectSystem(preferred);
      if (system?.id === invite.systemId && fs.statSync(preferred).size === Number(invite.fileSize || 0)) {
        return preferred;
      }
    } catch {}
  }
  const library = getLibrary().games.filter(game => game.system === invite.systemId);
  const exactName = library.filter(game => path.basename(game.file).toLowerCase() === String(invite.fileName || '').toLowerCase());
  const sameSize = library.filter(game => Number(game.size || 0) === Number(invite.fileSize || 0));
  const candidates = [...new Map([...exactName, ...sameSize].map(game => [game.file, game])).values()];
  for (const game of candidates) {
    const digest = await netplayManager.fileSha256(game.file);
    if (digest.toLowerCase() === String(invite.contentSha256 || '').toLowerCase()) return game.file;
  }
  throw Error(`GameDeck could not find the exact ${invite.title || invite.fileName || 'game'} revision required by this invite.`);
}

function queueManagedRuntimeLaunch(file, system) {
  const snapshot = managedRuntimeStatus();
  if (!runtimeManager?.canInstall) return null;
  const taskId = 'runtime-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const message = 'Installing GameDeck game engines for ' + system.name + '. The game will open automatically.';
  registerPendingLaunch(taskId, file, message);
  addActivity('info', message, taskId);
  ensureManagedRuntime().then(result => {
    if (result?.ready) {
      addActivity('success', 'GameDeck game engines installed.', taskId);
      completePendingLaunch(taskId, true);
    } else {
      completePendingLaunch(taskId, false, result?.error || result?.message || 'Game engine installation failed.');
    }
  }).catch(error => completePendingLaunch(taskId, false, error.message));
  return { queued: true, taskId, message, runtime: snapshot };
}

function launchGame(file, options = {}) {
  const activePlay = embeddedPlayManager?.status();
  if (activePlay?.active) throw Error('Close the current GameDeck Play session before opening another game.');
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');
  if (netplayManager?.status().active && !options.netplay) netplayManager.stop('Opening a local game.');
  if (!isArcadeSystem(system)) {
    const archiveIntegrity = playableArchiveIntegrity(safeFile);
    if (!archiveIntegrity.ok) throw Error(archiveIntegrity.message);
  }
  const setupIssue = systemSetupIssue(system);
  if (setupIssue) {
    if (String(setupIssue).toLowerCase().includes('firmware')) {
      const firmwareResult = queueRgsxFirmwareDownload(system.id);
      if (firmwareResult?.ready) {
        // Continue directly when existing firmware was restored.
      } else if (firmwareResult?.queued) {
        const message = system.name + ' firmware is being installed. The game will open automatically.';
        registerPendingLaunch(firmwareResult.taskId, safeFile, message);
        return { ok: true, queued: true, taskId: firmwareResult.taskId, message };
      } else {
        throw Error(firmwareResult?.error || setupIssue);
      }
    } else {
      throw Error(setupIssue);
    }
  }

  const dependencyResult = resolveLaunchDependencies(safeFile, system);
  if (dependencyResult?.queued) return { ok: true, ...dependencyResult };
  if (!dependencyResult?.ok) throw Error(dependencyResult?.error || 'Required game files could not be prepared.');

  const game = { file: safeFile, system: system.id, shortName: rawGameName(safeFile) };
  if (isArcadeSystem(system)) {
    const audit = inspectArcadeArchiveSync(game);
    if (audit.status === 'damaged' || audit.status === 'incomplete') {
      const repair = queueManagedGameRepair(safeFile, audit);
      if (repair?.queued) return { ok: true, ...repair };
      throw Error(repair?.error || audit.message);
    }
  }

  const emulator = selectLaunchEmulator(system, game);
  if (!emulator) throw Error(system.name + ' emulator is not installed or configured.');
  let launchExecutable = emulator.executable;
  let launchCwd = path.dirname(emulator.executable);
  let presentation = system.presentation || '';
  let args;
  let openBorLaunch = null;
  if (emulator.kind === 'openbor') {
    openBorLaunch = prepareOpenBorLaunch({
      engineExecutable: emulator.executable,
      sourcePak: safeFile,
      sessionsRoot: path.join(app.getPath('userData'), 'runtime', 'openbor', 'sessions')
    });
    launchExecutable = openBorLaunch.executable;
    launchCwd = openBorLaunch.cwd;
    presentation = openBorLaunch.presentation;
    args = openBorLaunch.args;
  } else if (emulator.kind === 'libretro') {
    const arcade = isArcadeSystem(system);
    const controllerConfig = arcade ? ensureRetroArchArcadeControllerConfig() : '';
    const managedConfig = emulator.executable === MANAGED_RUNTIME_PATHS.retroArch && fs.existsSync(MANAGED_RUNTIME_PATHS.config) ? ['--config', MANAGED_RUNTIME_PATHS.config] : [];
    launchCwd = resolveLibretroLaunchCwd({ contentFile: safeFile, emulatorExecutable: emulator.executable, arcade });
    args = ['-f', ...managedConfig, ...(controllerConfig ? ['--appendconfig=' + controllerConfig] : []), '-L', emulator.corePath, safeFile];
  } else if (emulator.kind === 'mame') {
    args = [game.shortName, '-rompath', mameRomSearchPath(safeFile), '-joystick', ...(process.platform === 'win32' ? ['-joystickprovider', 'winhybrid'] : []), '-skip_gameinfo', '-noconfirm_quit', '-nowindow'];
  } else {
    args = [...(system.args || []), safeFile];
  }

  protectExternalLaunch();
  const child = spawn(launchExecutable, args, {
    cwd: launchCwd,
    env: emulator.kind === 'openbor' ? {
      ...process.env,
      SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '1',
      SDL_VIDEO_MINIMIZE_ON_FOCUS_LOSS: '0',
      SDL_VIDEO_CENTERED: '1',
      SDL_JOYSTICK_HIDAPI: '1',
      SDL_JOYSTICK_HIDAPI_XBOX: '1'
    } : process.env,
    detached: true,
    stdio: 'ignore'
  });
  if (emulator.kind === 'openbor') registerGameDeckOpenBorProcess(child);
  const nativeHandoff = presentation ? handoffHostWindowForNativeGame({ hostWindow: mainWindow, child }) : null;
  child.once('error', error => {
    addActivity('error', system.name + ' launch failed: ' + error.message);
    emitLaunch({ file: safeFile, status: 'failed', message: error.message });
  });
  if (presentation && child.pid) {
    presentNativeGameWindow({ pid: child.pid, mode: presentation }).then(windowResult => {
      if (windowResult?.ok) {
        const detail = windowResult.status === 'native-fullscreen'
          ? 'native fullscreen with preserved aspect ratio'
          : windowResult.status === 'borderless-fullscreen'
            ? 'borderless fullscreen'
            : windowResult.status === 'centered-fallback'
              ? 'centered window fallback'
              : 'centered window';
        addActivity('success', system.name + ' presentation ready: ' + detail + (nativeHandoff?.minimized ? '; GameDeck will return when the game closes.' : '.'));
      } else {
        addActivity('info', system.name + ' opened, but GameDeck could not confirm the native window: ' + (windowResult?.status || 'unknown result') + '.');
      }
    }).catch(error => addActivity('info', system.name + ' opened without window confirmation: ' + error.message));
  }
  child.unref();
  const store = readStore();
  store.recent[safeFile] = Date.now();
  writeStore(store);
  const displayName = isArcadeSystem(system) ? arcadeDisplayTitle(game.shortName) : cleanName(safeFile);
  if (openBorLaunch) addActivity('info', 'Prepared an isolated OpenBOR session using ' + openBorLaunch.stagingMethod + ' staging.');
  addActivity('success', 'Launched ' + displayName + ' with ' + emulator.label);
  const fullscreen = presentation === 'native-fullscreen' || presentation === 'borderless-fullscreen';
  const result = { ok: true, launched: true, emulator: emulator.label, presentation, message: displayName + ' opened with ' + emulator.label + (fullscreen ? ' in fullscreen.' : '.') };
  if (options.automatic) emitLaunch({ file: safeFile, status: 'launched', emulator: emulator.label, message: result.message });
  return result;
}
function openSystemSetup(systemId) {
  const system = systems.find(item => item.id === systemId);
  if (!system) return { ok: false, error: 'Unknown console configuration.' };
  const firmwareResult = queueRgsxFirmwareDownload(systemId);
  if (firmwareResult.ok && (firmwareResult.queued || firmwareResult.downloaded || firmwareResult.ready)) {
    return firmwareResult;
  }
  if (system.bios || system.biosPattern) {
    return { ok: false, error: firmwareResult.error || `${system.name} firmware is required. Download via RGSX is unavailable.` };
  }
  const emulator = configuredEmulator(system);
  const folder = (system.biosDirs || []).find(directory => directory)
    || (emulator?.kind === 'mame' ? path.dirname(emulator.executable) : system.core ? RA_SYSTEM : system.exe ? path.dirname(system.exe) : LIBRARY);
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
  const issue = systemSetupIssue(system);
  addActivity('info', issue || `${system.name} is already configured.`);
  return { ok: true, folder, issue };
}

function primeFirmwareFolders() {
  for (const system of systems) {
    const folder = (system.biosDirs || []).find(directory => directory) || '';
    if (!folder) continue;
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch {
      // Best effort: auto-prime setup folders without failing startup.
    }
  }
}

function getRgsxSystems() {
  return readJson(path.join(RGSX_DATA, 'systems_list.json'), []);
}

function getRgsxBiosPlatform() {
  const list = getRgsxSystems();
  const platform = list.find(item => String(item.folder || '').toLowerCase() === 'bios');
  if (!platform) return null;
  const gamesFile = path.join(RGSX_GAMES, `${platform.platform_name}.json`);
  if (!fs.existsSync(gamesFile)) return null;
  const rows = readCatalogRows(gamesFile);
  return rows.length ? { ...platform, gamesFile, rows } : null;
}

function readCatalogRows(file) {
  try {
    const stat = fs.statSync(file);
    const cached = catalogRowsCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.rows;
    const rows = readJson(file, []);
    const validRows = Array.isArray(rows) ? rows : [];
    catalogRowsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, rows: validRows });
    return validRows;
  } catch {
    return [];
  }
}

function activeManagedDownloadFile(file) {
  const candidate = path.resolve(String(file || ''));
  const candidateKey = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  return [...downloads.values()].some(job => {
    if (job?.status !== 'running' || !job.folder || !job.fileName) return false;
    const expected = path.resolve(LIBRARY, String(job.folder), path.basename(String(job.fileName)));
    const expectedKey = process.platform === 'win32' ? expected.toLowerCase() : expected;
    return candidateKey === expectedKey;
  });
}

function installedFiles(folder) {
  const root = path.resolve(LIBRARY, String(folder || ''));
  const relative = path.relative(path.resolve(LIBRARY), root);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return new Map();
  const system = systemForFolder(folder);
  const artifacts = new Map();
  for (const file of walk(root)) {
    if (activeManagedDownloadFile(file)) continue;
    const playable = isPlayableFile(file, system);
    const archive = ['.zip', '.rar', '.7z'].includes(path.extname(file).toLowerCase());
    if (!playable && !archive) continue;
    const identity = fileIdentity(file);
    if (playable || !artifacts.has(identity)) artifacts.set(identity, file);
  }
  return artifacts;
}

function getCatalogSystems() {
  const list = getRgsxSystems();
  const seen = new Set();

  return list.filter(platform => !platform.platform_name.toLowerCase().includes('bios')).map(platform => {
    const key = platform.folder || platform.platform_name.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);

    const providers = list.filter(item => item.folder === platform.folder);
    const resolved = providers.find(item => fs.existsSync(path.join(RGSX_GAMES, `${item.platform_name}.json`))) || platform;
    const system = systemForFolder(platform.folder);
    if (!system) return null;
    const gamesFile = path.join(RGSX_GAMES, `${resolved.platform_name}.json`);
    const count = readCatalogRows(gamesFile).length;
    const name = platform.platform_name
      .replace(/\s*\([^)]*(Archive|Vimms|Torrent|EdgeEmu|LolRoms|1Fichier)[^)]*\)/ig, '')
      .trim();

    return {
      id: key,
      name,
      folder: platform.folder,
      source: resolved.platform_name,
      image: toFileUrl(path.join(RGSX_DATA, 'images', platform.platform_image)),
      count,
      gamesFile,
      systemId: system.id,
      playable: systemReady(system),
      issue: systemSetupIssue(system)
    };
  }).filter(Boolean).filter(item => item.count > 0).sort((a, b) => a.name.localeCompare(b.name));
}

function getCatalogGames(source) {
  const file = path.resolve(path.isAbsolute(source) ? source : path.join(RGSX_GAMES, `${path.basename(source)}.json`));
  const catalogSystem = getCatalogSystems().find(system => path.resolve(system.gamesFile) === file);
  if (!catalogSystem || !fs.existsSync(file)) return [];
  const folder = catalogSystem.folder;
  const installed = installedFiles(folder);
  return readCatalogRows(file).map((row, index) => {
    const tags = gameTags(row[0]);
    const installedFile = installedCatalogFile(installed, row[0]);
    return {
      id: index,
      name: cleanName(row[0]),
      fileName: row[0],
      edition: editionLabel(row[0]),
      region: gameRegion(tags),
      tags: tags.slice(0, 5),
      size: row[2] || '',
      installedFile,
      installedReady: Boolean(installedFile && isPlayableFile(installedFile, systemForFolder(folder)))
    };
  });
}

function queueRgsxDownload(source, folder, title, fileName, options = {}) {
  if (!fs.existsSync(RGSX_PYTHON) || !fs.existsSync(RGSX_CLI)) {
    return { ok: false, error: 'RGSX runtime is not installed correctly. Open Activity for details.' };
  }

  const catalog = getCatalogSystems();
  const platform = catalog.find(item => item.source === source && item.folder === folder);
  if (!platform) return { ok: false, error: 'The selected RGSX platform is no longer available.' };

  const available = readJson(platform.gamesFile, []).some(row => row[0] === fileName);
  if (!available) return { ok: false, error: 'The selected game is not present in the current RGSX catalog.' };

  const installed = installedCatalogFile(installedFiles(folder), fileName);
  if (installed && !options.force && !options.resumeFrom) {
    return {
      ok: true,
      downloaded: false,
      installedFile: installed,
      installedReady: isPlayableFile(installed, systemForFolder(folder))
    };
  }

  const active = [...downloads.values()].find(job => job.source === source && job.fileName === fileName && job.status === 'running');
  if (active) return { ok: true, queued: true, taskId: active.id };

  const resume = options.resumeFrom?.id ? options.resumeFrom : null;
  const id = resume?.id || `rgsx-${Date.now()}`;
  const system = systemForFolder(folder);
  const job = {
    ...(resume || {}),
    id,
    source,
    folder,
    systemId: system?.id || '',
    systemName: system?.name || folder,
    title,
    fileName,
    status: 'running',
    stage: resume ? 'Resuming' : 'Preparing',
    message: resume ? 'Resuming from saved progress.' : 'RGSX is preparing the transfer.',
    startedAt: resume?.startedAt || Date.now(),
    updatedAt: Date.now(),
    progress: Number(resume?.progress || 0),
    speed: '',
    downloadedBytes: Number(resume?.downloadedBytes || 0),
    totalBytes: Number(resume?.totalBytes || 0),
    repair: Boolean(options.repair || resume?.repair),
    resumable: true
  };
  downloads.set(id, job);
  addActivity('info', `RGSX started: ${title}`, id);
  emitDownload(job);

  const child = spawn(RGSX_PYTHON, [RGSX_CLI, 'download', '--platform', source, '--game', fileName, '--force'], {
    cwd: RGSX_APP,
    windowsHide: true,
    env: {
      ...process.env,
      RGSX_ROOT,
      PYGAME_HIDE_SUPPORT_PROMPT: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONWARNINGS: 'ignore'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  downloadProcesses.set(id, child);

  const consume = (level, chunk) => {
    for (const line of String(chunk).split(/[\r\n]+/)) {
      updateDownloadFromLine(job, line);
      addActivity(level, line, id);
    }
  };
  child.stdout.on('data', chunk => consume('info', chunk));
  child.stderr.on('data', chunk => consume('error', chunk));
  child.on('error', error => {
    downloadProcesses.delete(id);
    job.status = 'error';
    job.stage = 'Failed';
    job.error = error.message;
    job.message = error.message;
    job.finishedAt = Date.now();
    emitDownload(job);
    addActivity('error', `RGSX failed to start: ${error.message}`, id);
  });
  child.on('close', code => {
    downloadProcesses.delete(id);
    if (job.pauseRequested) {
      delete job.pauseRequested;
      job.status = 'paused';
      job.stage = 'Paused';
      job.resumable = true;
      job.message = 'Paused. Resume whenever you are ready.';
      job.updatedAt = Date.now();
      emitDownload(job);
      return;
    }
    job.status = code === 0 ? 'complete' : 'error';
    job.stage = code === 0 ? (job.dependency || job.repair ? 'Launching' : 'Ready to play') : 'Failed';
    job.finishedAt = Date.now();
    job.progress = code === 0 ? 100 : job.progress;
    job.message = code === 0
      ? (job.dependency ? 'Required files installed. Launching automatically.' : job.repair ? 'Fresh managed copy installed. Launching automatically.' : 'Download complete. The game is ready in your library.')
      : `RGSX exited with code ${code}.`;
    emitDownload(job);
    addActivity(code === 0 ? 'success' : 'error', code === 0 ? `RGSX finished: ${title}` : `RGSX exited with code ${code}: ${title}`, id);
    completePendingLaunch(id, code === 0, job.message);
  });

  return { ok: true, queued: true, taskId: id };
}

function prepareGameArchive(file, options = {}) {
  let safeFile;
  try {
    safeFile = safeLibraryFile(file);
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message });
  }
  const system = detectSystem(safeFile);
  if (!system) return Promise.resolve({ ok: false, error: 'Could not identify the console for this downloaded file.' });
  if (isPlayableFile(safeFile, system)) return Promise.resolve({ ok: true, file: safeFile, alreadyReady: true });
  if (!['.zip', '.rar', '.7z'].includes(path.extname(safeFile).toLowerCase())) {
    return Promise.resolve({ ok: false, error: `${path.extname(safeFile) || 'This file type'} cannot be prepared automatically.` });
  }
  if (!fs.existsSync(SEVEN_ZIP)) return Promise.resolve({ ok: false, error: 'The RGSX extraction tool is missing.' });

  const existing = walk(path.dirname(safeFile)).find(candidate => isPlayableFile(candidate, system) && fileIdentity(candidate) === fileIdentity(safeFile));
  if (existing) return Promise.resolve({ ok: true, file: existing, alreadyReady: true });

  const active = [...downloads.values()].find(job => job.archiveFile === safeFile && job.status === 'running');
  if (active) return Promise.resolve({ ok: true, queued: true, taskId: active.id });

  const resume = options.resumeFrom?.id ? options.resumeFrom : null;
  const id = resume?.id || `install-${Date.now()}`;
  const job = {
    ...(resume || {}),
    id,
    source: 'Local archive',
    folder: path.basename(path.dirname(safeFile)),
    systemId: system.id,
    systemName: system.name,
    title: cleanName(safeFile),
    fileName: path.basename(safeFile),
    archiveFile: safeFile,
    status: 'running',
    stage: resume ? 'Resuming' : 'Installing',
    message: resume ? 'Resuming game preparation.' : 'Unpacking the downloaded game. The original archive will be kept.',
    startedAt: resume?.startedAt || Date.now(),
    updatedAt: Date.now(),
    progress: Number(resume?.progress || 0),
    speed: '',
    downloadedBytes: 0,
    totalBytes: fs.statSync(safeFile).size,
    localInstall: true,
    resumable: true
  };
  downloads.set(id, job);
  addActivity('info', `Preparing downloaded game: ${job.title}`, id);
  emitDownload(job);

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(SEVEN_ZIP, ['e', '-y', '-aoa', '-bso0', '-bsp1', `-o${path.dirname(safeFile)}`, '--', safeFile], {
      cwd: path.dirname(safeFile),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    downloadProcesses.set(id, child);
    const consume = (level, chunk) => {
      for (const line of String(chunk).split(/[\r\n]+/)) {
        updateDownloadFromLine(job, line);
        addActivity(level, line, id);
      }
    };
    child.stdout.on('data', chunk => consume('info', chunk));
    child.stderr.on('data', chunk => consume('info', chunk));
    child.on('error', error => {
      downloadProcesses.delete(id);
      job.status = 'error';
      job.stage = 'Failed';
      job.error = error.message;
      job.message = error.message;
      job.finishedAt = Date.now();
      emitDownload(job);
      addActivity('error', `Could not prepare ${job.title}: ${error.message}`, id);
      finish({ ok: false, error: error.message, taskId: id });
    });
    child.on('close', code => {
      downloadProcesses.delete(id);
      if (job.pauseRequested) {
        delete job.pauseRequested;
        job.status = 'paused';
        job.stage = 'Paused';
        job.resumable = true;
        job.message = 'Paused. Resume whenever you are ready.';
        job.updatedAt = Date.now();
        emitDownload(job);
        return;
      }
      const prepared = walk(path.dirname(safeFile)).find(candidate => isPlayableFile(candidate, system) && fileIdentity(candidate) === fileIdentity(safeFile));
      const ok = code === 0 && Boolean(prepared);
      job.status = ok ? 'complete' : 'error';
      job.stage = ok ? 'Ready to play' : 'Failed';
      job.finishedAt = Date.now();
      job.progress = ok ? 100 : job.progress;
      job.message = ok ? 'Game unpacked successfully. The original archive was kept.' : `Extraction finished without a playable ${system.name} game.`;
      emitDownload(job);
      addActivity(ok ? 'success' : 'error', ok ? `Game prepared: ${job.title}` : job.message, id);
      finish(ok ? { ok: true, file: prepared, taskId: id } : { ok: false, error: job.message, taskId: id });
    });
  });
}

function queueRgsxFirmwareDownload(systemId, options = {}) {
  const system = systems.find(item => item.id === systemId);
  if (!system) return { ok: false, error: 'Unknown console configuration.' };
  if (systemBiosReady(system) || restoreFirmwareFromExistingPack(system)) return { ok: true, ready: true };

  const biosPlatform = getRgsxBiosPlatform();
  if (!biosPlatform) {
    return { ok: false, error: 'RGSX BIOS pack is not available.' };
  }

  const [fileName] = biosPlatform.rows[0] || [];
  if (!fileName) return { ok: false, error: 'RGSX BIOS pack is empty.' };
  if (!fs.existsSync(RGSX_PYTHON) || !fs.existsSync(RGSX_CLI)) {
    return { ok: false, error: 'RGSX runtime is not installed correctly. Open Activity for details.' };
  }

  const active = [...downloads.values()].find(job => job.source === biosPlatform.platform_name && job.fileName === fileName && job.status === 'running');
  if (active) return { ok: true, queued: true, taskId: active.id };

  const resume = options.resumeFrom?.id ? options.resumeFrom : null;
  const id = resume?.id || `rgsx-bios-${Date.now()}`;
  const job = {
    ...(resume || {}),
    id,
    source: biosPlatform.platform_name,
    folder: biosPlatform.folder,
    systemId: system.id,
    systemName: system.name,
    title: `${system.name} firmware`,
    fileName,
    status: 'running',
    stage: resume ? 'Resuming' : 'Preparing',
    message: resume ? `Resuming ${system.name} firmware.` : `Preparing ${system.name} firmware.`,
    startedAt: resume?.startedAt || Date.now(),
    updatedAt: Date.now(),
    progress: Number(resume?.progress || 0),
    speed: '',
    downloadedBytes: Number(resume?.downloadedBytes || 0),
    totalBytes: Number(resume?.totalBytes || 0),
    firmware: true,
    resumable: true
  };
  downloads.set(id, job);
  addActivity('info', `RGSX started: ${system.name} BIOS`, id);
  emitDownload(job);

  const child = spawn(RGSX_PYTHON, [RGSX_CLI, 'download', '--platform', biosPlatform.platform_name, '--game', fileName, '--force'], {
    cwd: RGSX_APP,
    windowsHide: true,
    env: {
      ...process.env,
      RGSX_ROOT,
      PYGAME_HIDE_SUPPORT_PROMPT: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONWARNINGS: 'ignore'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  downloadProcesses.set(id, child);

  const consume = (level, chunk) => {
    for (const line of String(chunk).split(/[\r\n]+/)) {
      updateDownloadFromLine(job, line);
      addActivity(level, line, id);
    }
  };
  child.stdout.on('data', chunk => consume('info', chunk));
  child.stderr.on('data', chunk => consume('error', chunk));
  child.on('error', error => {
    downloadProcesses.delete(id);
    job.status = 'error';
    job.stage = 'Failed';
    job.error = error.message;
    job.message = error.message;
    job.finishedAt = Date.now();
    emitDownload(job);
    addActivity('error', `RGSX failed to start: ${error.message}`, id);
  });
  child.on('close', code => {
    downloadProcesses.delete(id);
    if (job.pauseRequested) {
      delete job.pauseRequested;
      job.status = 'paused';
      job.stage = 'Paused';
      job.resumable = true;
      job.message = 'Paused. Resume whenever you are ready.';
      job.updatedAt = Date.now();
      emitDownload(job);
      return;
    }
    job.status = code === 0 ? 'complete' : 'error';
    job.stage = code === 0 ? 'Ready to use' : 'Failed';
    job.finishedAt = Date.now();
    job.progress = code === 0 ? 100 : job.progress;
    job.message = code === 0 ? `${system.name} firmware is ready.` : `RGSX exited with code ${code}.`;
    emitDownload(job);
    addActivity(code === 0 ? 'success' : 'error', code === 0 ? `RGSX finished: ${system.name} BIOS` : `RGSX exited with code ${code}: ${system.name} BIOS`, id);
    completePendingLaunch(id, code === 0, job.message);
  });

  return { ok: true, queued: true, taskId: id };
}

function pauseDownload(id) {
  const job = downloads.get(String(id || ''));
  if (!job) return { ok: false, error: 'Transfer was not found.' };
  if (job.status !== 'running') return { ok: true, job };
  job.pauseRequested = true;
  job.stage = 'Pausing';
  job.message = 'Saving progress…';
  job.updatedAt = Date.now();
  emitDownload(job);
  const child = downloadProcesses.get(job.id);
  if (child) child.kill();
  else {
    delete job.pauseRequested;
    job.status = 'paused';
    job.stage = 'Paused';
    job.message = 'Paused. Resume whenever you are ready.';
    emitDownload(job);
  }
  return { ok: true, job };
}

function retryDownload(id) {
  const job = downloads.get(String(id || ''));
  if (!job) return Promise.resolve({ ok: false, error: 'Transfer was not found.' });
  if (job.status === 'running') return Promise.resolve({ ok: true, queued: true, taskId: job.id });
  delete job.error;
  delete job.finishedAt;
  delete job.pauseRequested;
  if (job.localInstall && job.archiveFile) return prepareGameArchive(job.archiveFile, { resumeFrom: job });
  if (job.firmware && job.systemId) return Promise.resolve(queueRgsxFirmwareDownload(job.systemId, { resumeFrom: job }));
  if (job.source && job.folder && job.fileName) {
    return Promise.resolve(queueRgsxDownload(job.source, job.folder, job.title, job.fileName, {
      force: Boolean(job.repair),
      repair: Boolean(job.repair),
      resumeFrom: job
    }));
  }
  return Promise.resolve({ ok: false, error: 'This transfer cannot be resumed automatically.' });
}

function dismissDownload(id) {
  const key = String(id || '');
  const job = downloads.get(key);
  if (!job) return { ok: true };
  if (job.status === 'running') return { ok: false, error: 'Pause the transfer before dismissing it.' };
  downloads.delete(key);
  persistDownloads();
  return { ok: true };
}

function pauseActiveDownloads() {
  for (const job of downloads.values()) {
    if (job.status !== 'running') continue;
    job.pauseRequested = true;
    job.status = 'paused';
    job.stage = 'Paused';
    job.resumable = true;
    job.message = 'GameDeck closed. Resume to continue from saved progress.';
    job.updatedAt = Date.now();
    try { downloadProcesses.get(job.id)?.kill(); } catch {}
  }
  persistDownloads();
}

function thumbnailNameCandidates(title) {
  const raw = lookupTitleName(title).trim();
  const aliases = raw
    .replace(/\((JP|JPN|J)\)/gi, '(Japan)')
    .replace(/\((US|U)\)/gi, '(USA)')
    .replace(/\((EU|EUR|E|UK)\)/gi, '(Europe)');
  const revisionNumeric = aliases.replace(/\(Rev ([A-Z])\)/gi, (_, letter) => `(Rev ${letter.toUpperCase().charCodeAt(0) - 64})`);
  const revisionLetter = aliases.replace(/\(Rev (\d+)\)/gi, (_, number) => {
    const value = Number(number);
    return value >= 1 && value <= 26 ? `(Rev ${String.fromCharCode(64 + value)})` : `(Rev ${number})`;
  });
  const withoutDumpTags = aliases.replace(/\s*\[[^\]]+\]/g, '').trim();
  const stripNonRegionTags = value => value.replace(/\s*\(([^)]+)\)/g, (match, tag) => {
    return /\b(USA|Europe|Japan|World|Asia|Australia|Brazil|Canada|France|Germany|Italy|Korea|Spain|Sweden|Taiwan)\b/i.test(tag) ? match : '';
  }).replace(/\s+/g, ' ').trim();
  const reorderArticle = value => {
    const trailing = value.match(/^(.*),\s+(The|A|An)(\s+\([^)]*\))?$/i);
    if (trailing) return `${trailing[2]} ${trailing[1]}${trailing[3] || ''}`;
    const leading = value.match(/^(The|A|An)\s+(.+?)(\s+\([^)]*\))?$/i);
    return leading ? `${leading[2]}, ${leading[1]}${leading[3] || ''}` : '';
  };
  const base = [
    raw,
    aliases,
    revisionNumeric,
    revisionLetter,
    withoutDumpTags,
    aliases.replace(/\s+-\s+(?:CD|Disc|Disk)\s*(\d+)/i, ' (Disc $1)'),
    aliases.replace(/\s*\((?:Disc|Disk)\s*\d+\)\s*$/i, ''),
    stripNonRegionTags(withoutDumpTags),
    cleanName(withoutDumpTags)
  ].filter(Boolean);
  const articleVariants = base.map(reorderArticle).filter(Boolean);
  const punctuationVariants = [...base, ...articleVariants].flatMap(value => [
    value.replace(/\./g, ''),
    value.replace(/\s+&\s+/g, ' and '),
    value.replace(/\s+and\s+/gi, ' & '),
    value.replace(/\s+-\s+/g, ' - ')
  ]).filter(Boolean);
  const regionless = cleanName(withoutDumpTags) || stripNonRegionTags(withoutDumpTags);
  const inferredRegions = ['USA', 'USA, Europe', 'World', 'Europe', 'Japan'].map(region => `${regionless} (${region})`);
  const names = [...base, ...inferredRegions, ...articleVariants, ...punctuationVariants]
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(names.flatMap(name => [name, name.replace(/[&*/:`<>?\\|]/g, '_')]))].slice(0, 32);
}

function thumbnailRepoCandidates(systemId, folder) {
  const repositories = [thumbnailRepos[folder]];
  const system = systems.find(item => item.id === systemId);
  if (system) repositories.push(...system.folders.map(item => thumbnailRepos[item]));
  if (systemId === 'arcade') repositories.push('MAME', 'SNK_-_Neo_Geo');
  if (systemId === 'gamegear') repositories.push('Sega_-_Mega_Drive_-_Genesis', 'Sega_-_Master_System_-_Mark_III');
  if (systemId === 'gamecube') repositories.push('Nintendo_-_Wii');
  return [...new Set(repositories.filter(Boolean))];
}

function thumbnailCdnRepository(repository) {
  return String(repository || '').replace(/_-_/g, ' - ').replace(/_/g, ' ');
}

function thumbnailIdentity(value) {
  return cleanName(String(value || '').replace(/\.png$/i, ''))
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function thumbnailTokens(value) {
  return cleanName(String(value || '').replace(/\.png$/i, ''))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .match(/[a-z0-9]+/g) || [];
}

function thumbnailRegionScore(value, requested) {
  const candidate = String(value || '').toLowerCase();
  const source = String(requested || '').toLowerCase();
  let score = 0;
  for (const region of ['usa', 'world', 'europe', 'japan', 'australia']) {
    if (source.includes(region) && candidate.includes(region)) score += 30;
  }
  if (candidate.includes('(usa')) score += 8;
  else if (candidate.includes('(world')) score += 6;
  else if (candidate.includes('(europe')) score += 4;
  else if (candidate.includes('(japan')) score += 2;
  return score;
}

async function thumbnailIndex(repository) {
  if (thumbnailIndexRequests.has(repository)) return thumbnailIndexRequests.get(repository);
  const request = (async () => {
    try {
      const directory = thumbnailCdnRepository(repository);
      const response = await fetch(`https://thumbnails.libretro.com/${encodeURIComponent(directory)}/Named_Boxarts/`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) return [];
      const markup = await response.text();
      return [...markup.matchAll(/href="([^"]+\.png)"/gi)].map(match => {
        try {
          return decodeURIComponent(match[1].replace(/&amp;/g, '&'));
        } catch {
          return match[1];
        }
      });
    } catch {
      return [];
    }
  })();
  thumbnailIndexRequests.set(repository, request);
  return request;
}

async function saveThumbnailResponse(response, cache) {
  if (!response.ok || !String(response.headers.get('content-type')).startsWith('image/')) return '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) return '';
  fs.mkdirSync(ART_CACHE, { recursive: true });
  fs.writeFileSync(cache, bytes);
  return toFileUrl(cache);
}

async function fetchIndexedLibretroArtwork(repository, title, names, cache) {
  const entries = await thumbnailIndex(repository);
  if (!entries.length) return '';
  const targets = [...new Set(names.map(thumbnailIdentity).filter(value => value.length >= 4))];
  const targetTokenSets = names.map(thumbnailTokens).filter(tokens => tokens.length >= 5);
  const matches = entries.map(entry => {
    const identity = thumbnailIdentity(entry);
    const candidateTokens = thumbnailTokens(entry);
    let relation = 0;
    for (const target of targets) {
      if (identity === target) relation = Math.max(relation, 1000);
      else if (target.length >= 8 && identity.startsWith(target)) relation = Math.max(relation, 700 - Math.min(200, identity.length - target.length));
      else if (identity.length >= 8 && target.startsWith(identity)) relation = Math.max(relation, 650 - Math.min(200, target.length - identity.length));
    }
    for (const tokens of targetTokenSets) {
      if (tokens.every(token => candidateTokens.includes(token))) {
        relation = Math.max(relation, 580 - Math.min(120, Math.max(0, candidateTokens.length - tokens.length) * 5));
      }
    }
    return { entry, identity, score: relation + thumbnailRegionScore(entry, title) };
  }).filter(match => match.score >= 500).sort((a, b) => b.score - a.score || a.entry.length - b.entry.length);
  const match = matches[0];
  if (!match) return '';
  try {
    const directory = thumbnailCdnRepository(repository);
    const url = `https://thumbnails.libretro.com/${encodeURIComponent(directory)}/Named_Boxarts/${encodeURIComponent(match.entry).replace(/%2F/gi, '_')}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return saveThumbnailResponse(response, cache);
  } catch {
    return '';
  }
}

async function fetchLibretroArtwork(title, systemId, folder, cache) {
  const repositories = thumbnailRepoCandidates(systemId, folder);
  const names = thumbnailNameCandidates(title);
  const directNames = names.slice(0, 5);
  for (const repository of repositories) {
    const cdnRepository = thumbnailCdnRepository(repository);
    for (const name of directNames) {
      const encodedName = encodeURIComponent(name).replace(/%2F/gi, '_');
      try {
        const response = await fetch(`https://thumbnails.libretro.com/${encodeURIComponent(cdnRepository)}/Named_Boxarts/${encodedName}.png`, { signal: AbortSignal.timeout(8000) });
        const found = await saveThumbnailResponse(response, cache);
        if (found) return found;
      } catch {
        // Continue to indexed and GitHub fallbacks.
      }
    }
  }
  for (const repository of repositories) {
    const indexed = await fetchIndexedLibretroArtwork(repository, title, names, cache);
    if (indexed) return indexed;
  }
  for (const repository of repositories) {
    for (const name of names.slice(0, 5)) {
      const encodedName = encodeURIComponent(name).replace(/%2F/gi, '_');
      try {
        const response = await fetch(`https://raw.githubusercontent.com/libretro-thumbnails/${repository}/master/Named_Boxarts/${encodedName}.png`, { signal: AbortSignal.timeout(8000) });
        const found = await saveThumbnailResponse(response, cache);
        if (found) return found;
      } catch {
        // TheGamesDB remains the final fallback.
      }
    }
  }
  return '';
}

async function fetchArtwork(title, systemId, folder = '') {
  const platformId = tgdbPlatforms[systemId];
  const detailTitle = lookupTitleName(title);
  const cache = cachedArtworkPath(title, systemId, folder);
  if (fs.existsSync(cache)) return toFileUrl(cache);
  if (artworkMisses.has(cache)) return '';
  if (artworkRequests.has(cache)) return artworkRequests.get(cache);

  const request = (async () => {
    try {
      const libretroArtwork = await fetchLibretroArtwork(title, systemId, folder, cache);
      if (libretroArtwork) return libretroArtwork;
      if (!platformId || Date.now() < artworkBackoffUntil) return '';

      const key = fs.readFileSync(path.join(RGSX_APP, 'assets', 'TheGamesDBAPI.txt'), 'utf8').trim();
      if (!key) return '';
      const params = new URLSearchParams({
        apikey: key,
        name: detailTitle,
        'filter[platform]': String(platformId)
      });
      const gameResponse = await fetch(`https://api.thegamesdb.net/v1/Games/ByGameName?${params}`);
      if (gameResponse.status === 429) {
        artworkBackoffUntil = Date.now() + 5 * 60 * 1000;
        if (!artworkBackoffLogged) addActivity('info', 'Artwork service is rate limited; cover fetching paused for five minutes.');
        artworkBackoffLogged = true;
        return '';
      }
      if (!gameResponse.ok) throw Error(`metadata HTTP ${gameResponse.status}`);
      const gameData = await gameResponse.json();
      const game = gameData?.data?.games?.[0];
      if (!game?.id) {
        artworkMisses.add(cache);
        return '';
      }

      const imageParams = new URLSearchParams({
        apikey: key,
        games_id: String(game.id),
        'filter[type]': 'boxart'
      });
      const imageResponse = await fetch(`https://api.thegamesdb.net/v1/Games/Images?${imageParams}`);
      if (!imageResponse.ok) throw Error(`artwork HTTP ${imageResponse.status}`);
      const imageData = await imageResponse.json();
      const images = imageData?.data?.images?.[String(game.id)] || [];
      const image = images.find(item => item.type === 'boxart' && item.side === 'front') || images.find(item => item.type === 'boxart') || images[0];
      const baseUrl = imageData?.data?.base_url?.original || '';
      if (!image?.filename || !baseUrl) return '';

      const artResponse = await fetch(`${baseUrl}${image.filename}`);
      if (!artResponse.ok) throw Error(`image HTTP ${artResponse.status}`);
      fs.mkdirSync(ART_CACHE, { recursive: true });
      fs.writeFileSync(cache, Buffer.from(await artResponse.arrayBuffer()));
      artworkBackoffLogged = false;
      return toFileUrl(cache);
    } catch (error) {
      addActivity('error', `Artwork lookup failed for ${lookupTitleName(title)}: ${error.message}`);
      return '';
    } finally {
      artworkRequests.delete(cache);
    }
  })();

  artworkRequests.set(cache, request);
  return request;
}

function publicSettings() {
  return {
    libraryRoot: LIBRARY,
    rgsxRoot: RGSX_ROOT,
    emulationRoot: EMULATION_ROOT,
    retroArchPath: RA,
    retroArchCores: CORES,
    retroArchSystem: RA_SYSTEM,
    mamePath: MAME,
    sponsorsEnabled: runtimeSettings.sponsorsEnabled !== false,
    sponsorManifestUrl: runtimeSettings.sponsorManifestUrl || '',
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    settingsFile: SETTINGS_FILE
  };
}

function inspectSettings(changes = {}) {
  const current = publicSettings();
  const values = { ...current, ...changes };
  const specs = {
    libraryRoot: { kind: 'directory', label: 'Game library', required: true, ready: 'Library folder found', missing: 'Choose an existing game-library folder' },
    rgsxRoot: { kind: 'directory', label: 'RGSX', required: false, ready: 'RGSX folder found', missing: 'Optional · Discover transfers unavailable' },
    retroArchPath: { kind: 'file', label: 'RetroArch', required: false, ready: 'RetroArch executable found', missing: 'Optional · standalone emulators may still work' },
    retroArchCores: { kind: 'directory', label: 'RetroArch cores', required: false, ready: 'Core folder found', missing: 'Optional · needed for RetroArch systems' },
    retroArchSystem: { kind: 'directory', label: 'System / BIOS', required: false, ready: 'System folder found', missing: 'Optional · firmware checks may need this folder' },
    mamePath: { kind: 'file', label: 'MAME', required: false, ready: 'Standalone MAME found', missing: 'Optional · current MAME sets use this path' }
  };
  const fields = {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = String(values[key] || '').trim();
    let exists = false;
    let correctKind = false;
    if (value) {
      try {
        const stat = fs.statSync(path.normalize(value));
        exists = true;
        correctKind = spec.kind === 'file' ? stat.isFile() : stat.isDirectory();
      } catch {
        exists = false;
      }
    }
    const ready = exists && correctKind;
    fields[key] = {
      ...spec,
      value,
      exists,
      ready,
      tone: ready ? 'ok' : spec.required ? 'bad' : 'muted',
      message: ready ? spec.ready : value && exists ? `Expected a ${spec.kind}` : spec.missing
    };
  }
  const readyCount = Object.values(fields).filter(field => field.ready).length;
  const requiredReady = Object.values(fields).filter(field => field.required).every(field => field.ready);
  return {
    fields,
    readyCount,
    total: Object.keys(fields).length,
    requiredReady,
    summary: requiredReady
      ? `${readyCount} of ${Object.keys(fields).length} device paths ready`
      : 'Choose a valid game-library folder to continue'
  };
}

function saveSettings(changes = {}) {
  const current = readJson(SETTINGS_FILE, {});
  const next = { ...current };
  const pathKeys = ['libraryRoot', 'rgsxRoot', 'emulationRoot', 'retroArchPath', 'retroArchCores', 'retroArchSystem', 'mamePath'];
  let restartRequired = false;

  for (const key of pathKeys) {
    if (!(key in changes)) continue;
    const value = String(changes[key] || '').trim();
    if (!value) continue;
    const normalized = path.normalize(value);
    if (normalized !== runtimeSettings[key]) restartRequired = true;
    next[key] = normalized;
  }
  if ('sponsorsEnabled' in changes) {
    next.sponsorsEnabled = Boolean(changes.sponsorsEnabled);
    runtimeSettings.sponsorsEnabled = next.sponsorsEnabled;
  }
  if ('sponsorManifestUrl' in changes) {
    const value = String(changes.sponsorManifestUrl || '').trim();
    if (value && !/^https:\/\//i.test(value)) throw Error('Sponsor manifest must use HTTPS.');
    next.sponsorManifestUrl = value;
    runtimeSettings.sponsorManifestUrl = value;
  }
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  addActivity('success', restartRequired ? 'Settings saved. Restart GameDeck to apply path changes.' : 'Settings saved.');
  return { ok: true, restartRequired, settings: { ...publicSettings(), ...next } };
}

async function chooseGameArtwork(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system) throw Error('Could not identify this game system.');
  const shortName = rawGameName(safeFile);
  const title = isArcadeSystem(system) ? arcadeDisplayTitle(shortName) : cleanName(safeFile);
  const folder = path.relative(LIBRARY, safeFile).split(path.sep)[0].toLowerCase();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Choose artwork for ${title}`,
    defaultPath: path.dirname(safeFile),
    properties: ['openFile'],
    filters: [{ name: 'Game artwork', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const source = result.filePaths[0];
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size < 16 || stat.size > 20 * 1024 * 1024) throw Error('Choose an image smaller than 20 MB.');
  const target = cachedArtworkPath(title, system.id, folder);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  artworkMisses.delete(target);
  addActivity('success', `Custom artwork saved for ${title}.`);
  return { ok: true, url: toFileUrl(target), title };
}

async function deleteGame(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  const title = system && isArcadeSystem(system) ? arcadeDisplayTitle(rawGameName(safeFile)) : cleanName(safeFile);
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Remove game from GameDeck',
    message: `Move ${title} to the Trash?`,
    detail: `The game file will leave your library and move to the operating system Trash or Recycle Bin. You may be able to restore it from there.\n\n${safeFile}`,
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return { ok: true, canceled: true };

  await shell.trashItem(safeFile);
  const store = readStore();
  store.favorites = store.favorites.filter(item => item !== safeFile);
  delete store.recent[safeFile];
  writeStore(store);
  if (arcadeAuditCache.entries?.[safeFile]) {
    delete arcadeAuditCache.entries[safeFile];
    saveArcadeAuditCache();
  }
  addActivity('success', `${title} moved to Trash.`);
  return { ok: true, canceled: false, title, file: safeFile };
}

async function refreshGameDetails(title, systemId, context = {}) {
  const detailTitle = metadataLookupTitle(title, context);
  const cacheFile = cachedDetailsPath(detailTitle, systemId);
  try {
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  } catch (error) {
    addActivity('info', `Could not clear cached details for ${lookupTitleName(title)}: ${error.message}`);
  }
  detailMisses.delete(cacheFile);
  detailBackoffUntil = 0;
  const details = await fetchGameDetails(title, systemId, context);
  addActivity('success', `Game details refreshed for ${lookupTitleName(title)}.`);
  return details;
}

async function chooseDirectory(kind) {
  const titles = {
    libraryRoot: 'Choose your game library',
    rgsxRoot: 'Choose your RGSX folder',
    emulationRoot: 'Choose your emulation folder',
    retroArchPath: 'Choose the RetroArch executable',
    retroArchCores: 'Choose the RetroArch cores folder',
    retroArchSystem: 'Choose the RetroArch system / BIOS folder',
    mamePath: 'Choose the MAME executable'
  };
  if (!titles[kind]) throw Error('Unsupported folder setting.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: titles[kind],
    defaultPath: publicSettings()[kind] || HOME_DIR,
    properties: ['retroArchPath', 'mamePath'].includes(kind) ? ['openFile'] : ['openDirectory', 'createDirectory']
  });
  return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] };
}

function sanitizeSponsorManifest(payload) {
  const rows = Array.isArray(payload?.placements) ? payload.placements : [];
  return {
    version: Number(payload?.version || 1),
    placements: rows.slice(0, 8).map((item, index) => {
      const url = String(item?.url || '').trim();
      return {
        id: String(item?.id || `sponsor-${index}`).slice(0, 64),
        eyebrow: String(item?.eyebrow || 'SPONSORED').slice(0, 32),
        title: String(item?.title || 'GameDeck community sponsor').slice(0, 100),
        body: String(item?.body || '').slice(0, 280),
        cta: String(item?.cta || 'Learn more').slice(0, 42),
        url: /^https:\/\//i.test(url) ? url : '',
        accent: /^#[0-9a-f]{6}$/i.test(String(item?.accent || '')) ? item.accent : '#72e7ff',
        image: String(item?.image || '').replace(/[^a-z0-9_./-]/gi, '').slice(0, 180)
      };
    })
  };
}

async function getSponsors() {
  const local = sanitizeSponsorManifest(readJson(SPONSORS_FILE, { version: 1, placements: [] }));
  if (runtimeSettings.sponsorsEnabled === false) return { enabled: false, ...local };
  const manifestUrl = String(runtimeSettings.sponsorManifestUrl || '');
  if (!/^https:\/\//i.test(manifestUrl)) return { enabled: true, ...local };
  try {
    const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(4500), redirect: 'follow' });
    if (!response.ok) return { enabled: true, ...local };
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 1024 * 1024) return { enabled: true, ...local };
    const remote = sanitizeSponsorManifest(await response.json());
    return { enabled: true, ...(remote.placements.length ? remote : local) };
  } catch {
    return { enabled: true, ...local };
  }
}

function getDonationConfig() {
  const payload = readJson(DONATIONS_FILE, { enabled: false, methods: [] });
  return {
    enabled: Boolean(payload.enabled),
    headline: String(payload.headline || 'Fuel the next build').slice(0, 100),
    message: String(payload.message || 'Donation methods are being configured.').slice(0, 300),
    methods: (Array.isArray(payload.methods) ? payload.methods : []).slice(0, 8).map(method => ({
      id: String(method?.id || '').slice(0, 32),
      label: String(method?.label || '').slice(0, 64),
      network: String(method?.network || '').slice(0, 64),
      address: String(method?.address || '').slice(0, 180),
      explorerUrl: /^https:\/\//i.test(String(method?.explorerUrl || '')) ? String(method.explorerUrl) : ''
    })).filter(method => method.address)
  };
}

function openExternal(target) {
  const value = String(target || '').trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw Error('That link is not valid.');
  }
  if (!['https:', 'mailto:'].includes(parsed.protocol)) throw Error('Only secure web and email links are allowed.');
  return shell.openExternal(parsed.toString());
}

function detectedControllerHints() {
  if (controllerHintsCache) return controllerHintsCache;
  controllerHintsCache = [];
  if (process.platform !== 'win32') return controllerHintsCache;
  const script = "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Xbox Wireless Controller|XINPUT compatible input device|Gamepad' } | Select-Object -ExpandProperty FriendlyName | Sort-Object -Unique | ConvertTo-Json -Compress";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 6000,
    maxBuffer: 512 * 1024
  });
  if (result.status !== 0 || !String(result.stdout || '').trim()) return controllerHintsCache;
  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    const names = (Array.isArray(parsed) ? parsed : [parsed]).map(value => String(value)).filter(Boolean);
    const xbox = names.some(name => /xbox|xinput/i.test(name));
    controllerHintsCache = [...(xbox ? ['Xbox Wireless Controller'] : []), ...names.filter(name => !/xbox|xinput/i.test(name))].slice(0, 4);
  } catch {
    controllerHintsCache = [];
  }
  return controllerHintsCache;
}

function diagnostics(includeLibrary = true) {
  const library = includeLibrary ? getLibrary() : { games: [] };
  const artworkCount = library.games.filter(game => Boolean(game.art)).length;
  return {
    library: LIBRARY,
    libraryExists: fs.existsSync(LIBRARY),
    libraryGameCount: library.games.length,
    artworkCount,
    artworkCoverage: library.games.length ? Math.round((artworkCount / library.games.length) * 1000) / 10 : 0,
    rgsxData: RGSX_DATA,
    rgsxRuntime: fs.existsSync(RGSX_PYTHON),
    managedRuntime: managedRuntimeStatus(),
    streaming: gameDeckStreamStatus(),
    remotePlay: remotePlayStatus(),
    multiplayer: gameDeckNetplayStatus(),
    retroarch: fs.existsSync(RA),
    mame: Boolean(MAME && fs.existsSync(MAME)),
    archiveInspector: Boolean(SEVEN_ZIP && fs.existsSync(SEVEN_ZIP)),
    arcade: arcadeAuditSnapshot(library.games),
    controllers: detectedControllerHints(),
    platform: process.platform,
    arch: process.arch,
    settings: publicSettings(),
    systems: systems.map(system => {
      const count = library.games.filter(game => game.system === system.id).length;
      const emulator = configuredEmulator(system);
      return { id: system.id, name: system.name, ready: systemReady(system), issue: systemSetupIssue(system), emulatorKind: emulator?.kind || '', emulatorLabel: emulator?.label || '', count, installedCount: count };
    }),
    downloads: [...downloads.values()],
    activity
  };
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const captureMode = process.env.GAMEDECK_CAPTURE === '1';
  const requestedCaptureWidth = Number(process.env.GAMEDECK_CAPTURE_WIDTH || 0);
  const requestedCaptureHeight = Number(process.env.GAMEDECK_CAPTURE_HEIGHT || 0);
  const captureWidth = requestedCaptureWidth > 0 ? Math.max(980, requestedCaptureWidth) : 1500;
  const captureHeight = requestedCaptureHeight > 0 ? Math.max(650, requestedCaptureHeight) : 900;
  mainWindow = new BrowserWindow({
    width: Math.min(captureMode ? captureWidth : 1500, workArea.width),
    height: Math.min(captureMode ? captureHeight : 900, workArea.height),
    minWidth: 980,
    minHeight: 650,
    show: !captureMode,
    backgroundColor: '#090b10',
    icon: path.join(__dirname, 'assets', 'branding', 'gamedeck-mark-source.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#0c0f15', symbolColor: '#f2f5f9', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.center();
  mainWindow.on('close', event => {
    if (!AUTOMATION_MODE || appIsQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    addActivity('info', 'GameDeck automation continues with the window hidden.');
  });
  mainWindow.on('leave-full-screen', () => {
    const status = embeddedPlayManager?.status();
    if (!status?.active || status.mode !== 'fullscreen') return;
    setTimeout(() => {
      const current = embeddedPlayManager?.status();
      if (current?.active && current.mode === 'fullscreen') embeddedPlayManager.setMode(current.sessionId, 'docked').catch(() => {});
    }, 0);
  });
  if (captureMode) mainWindow.once('ready-to-show', () => mainWindow.showInactive());
  const captureView = String(process.env.GAMEDECK_CAPTURE_VIEW || '');
  mainWindow.loadFile('src/index.html', captureView ? { query: { captureView } } : undefined);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => {
    addActivity('success', 'GameDeck ready');
    const capturePath = String(process.env.GAMEDECK_CAPTURE_PATH || '');
    if (captureMode && capturePath) {
      (async () => {
        try {
          const deadline = Date.now() + 90000;
          let rendererReady = false;
          while (Date.now() < deadline && !rendererReady) {
            rendererReady = await mainWindow.webContents.executeJavaScript("document.body?.dataset.captureReady === 'true'").catch(() => false);
            if (!rendererReady) await new Promise(resolve => setTimeout(resolve, 500));
          }
          if (!rendererReady) addActivity('info', `QA capture timed out waiting for ${captureView || 'default'} readiness.`);
          await new Promise(resolve => setTimeout(resolve, 700));
          const image = await mainWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(capturePath), { recursive: true });
          fs.writeFileSync(capturePath, image.toPNG());
          addActivity('success', `QA capture saved: ${capturePath}`);
        } catch (error) {
          addActivity('error', `QA capture failed: ${error.message}`);
        } finally {
          app.quit();
        }
      })();
    }
  });
  mainWindow.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (level >= 2) addActivity('error', `Renderer: ${message} (${path.basename(sourceId || 'app')}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_, details) => addActivity('error', `Renderer stopped: ${details.reason}`));
}

ipcMain.handle('library', () => getLibrary());
ipcMain.handle('favorite', (_, file) => {
  const safeFile = safeLibraryFile(file);
  const store = readStore();
  store.favorites = store.favorites.includes(safeFile) ? store.favorites.filter(item => item !== safeFile) : [...store.favorites, safeFile];
  writeStore(store);
  return getLibrary();
});
ipcMain.handle('launch', (event, file) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller' };
  const activePlay = embeddedPlayManager?.status();
  if (activePlay?.active) return { ok: false, error: 'Close the current GameDeck Play session before opening another game.' };
  try {
    return launchGame(file);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('setup-system', (_, systemId) => {
  try {
    return openSystemSetup(systemId);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('open-library', () => shell.openPath(LIBRARY));
ipcMain.handle('rescan', () => getLibrary());
ipcMain.handle('catalog-systems', () => getCatalogSystems());
ipcMain.handle('catalog-games', (_, source) => getCatalogGames(source));
ipcMain.handle('import-owned', (_, source, folder, title, fileName) => queueRgsxDownload(source, folder, title, fileName));
ipcMain.handle('prepare-game', (_, file) => prepareGameArchive(file));
ipcMain.handle('retry-download', (_, id) => retryDownload(id));
ipcMain.handle('pause-download', (_, id) => pauseDownload(id));
ipcMain.handle('dismiss-download', (_, id) => dismissDownload(id));
ipcMain.handle('artwork', (_, title, systemId, folder) => fetchArtwork(title, systemId, folder));
ipcMain.handle('game-details', (_, title, systemId, context) => fetchGameDetails(title, systemId, context));
ipcMain.handle('refresh-game-details', (_, title, systemId, context) => refreshGameDetails(title, systemId, context));
ipcMain.handle('choose-game-artwork', (_, file) => chooseGameArtwork(file));
ipcMain.handle('delete-game', (_, file) => deleteGame(file).catch(error => ({ ok: false, error: error.message })));
ipcMain.handle('diagnostics', (_, includeLibrary) => diagnostics(includeLibrary !== false));
ipcMain.handle('runtime-status', () => managedRuntimeStatus());
ipcMain.handle('play-session-capabilities', (event, file) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return buildCapabilityFailure('untrusted_caller');
  const validated = validateCapabilityFileArgument(file);
  if (!validated.ok) return buildCapabilityFailure(validated.reasonCode);
  return resolveCapabilitiesSafely(playSessionManager, validated.file);
});
ipcMain.handle('play-session-status', event => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return buildStatusFailure('untrusted_caller');
  return embeddedPlayManager?.status() || playSessionManager.status();
});
ipcMain.handle('play-session-start', async (event, file, options = {}) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller', status: embeddedPlayManager?.status() };
  const validated = validateCapabilityFileArgument(file);
  if (!validated.ok) return { ok: false, error: validated.reasonCode, status: embeddedPlayManager?.status() };
  try {
    return await startEmbeddedPlay(validated.file, { mode: options?.mode });
  } catch (error) {
    addActivity('error', `Integrated play could not start: ${error.message}`);
    return { ok: false, error: error.message, status: embeddedPlayManager?.status() };
  }
});
ipcMain.handle('play-session-set-mode', async (event, sessionId, mode) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller', status: embeddedPlayManager?.status() };
  try {
    return await embeddedPlayManager.setMode(String(sessionId || '').slice(0, 160), String(mode || '').slice(0, 32));
  } catch (error) {
    return { ok: false, error: error.message, status: embeddedPlayManager?.status() };
  }
});
ipcMain.handle('play-session-set-aspect', (event, sessionId, aspectRatio) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller', status: embeddedPlayManager?.status() };
  return embeddedPlayManager.setAspect(String(sessionId || '').slice(0, 160), Number(aspectRatio));
});
ipcMain.handle('play-session-arm-capture', (event, sessionId, includeAudio = false) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller' };
  const source = embeddedPlayManager.captureSource(String(sessionId || '').slice(0, 160));
  if (!source) return { ok: false, error: 'capture_unavailable', status: embeddedPlayManager.status() };
  const audio = Boolean(includeAudio && process.platform === 'win32');
  armedPlayCapture = { ...source, audio, expiresAt: Date.now() + 10000 };
  return { ok: true, audio, status: embeddedPlayManager.status() };
});
ipcMain.handle('play-session-capture-started', (event, sessionId) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller' };
  return embeddedPlayManager.captureStarted(String(sessionId || '').slice(0, 160));
});
ipcMain.handle('play-session-stop', async (event, sessionId, reason) => {
  if (!isTrustedMainFrameCaller(event, mainWindow)) return { ok: false, error: 'untrusted_caller', status: embeddedPlayManager?.status() };
  return embeddedPlayManager.stop(String(sessionId || '').slice(0, 160), String(reason || 'requested').slice(0, 120));
});
ipcMain.handle('ensure-runtime', (_, force) => ensureManagedRuntime({ force: Boolean(force) }));
ipcMain.handle('stream-status', () => gameDeckStreamStatus());
ipcMain.handle('stream-sources', () => gameDeckStreamSources().catch(error => ({ error: error.message, sources: [] })));
ipcMain.handle('stream-start', async (_, config = {}) => {
  const sources = await gameDeckStreamSources();
  const selected = sources.find(source => source.id === config.sourceId)
    || sources.find(source => source.type === 'screen')
    || sources[0];
  if (!selected) return { ok: false, error: 'No screen or game window is available to stream.' };
  streamCaptureSourceId = selected.id;
  streamCaptureAudio = config.audio !== false;
  const stream = await streamServer.start({
    port: Number(config.port || 41783),
    title: config.title || 'GameDeck Live',
    sourceName: selected.name,
    quality: config.quality || '1080p',
    audio: streamCaptureAudio
  });
  return { ok: true, source: selected, stream };
});
ipcMain.handle('stream-stop', () => ({ ok: true, stream: streamServer.stop() }));
ipcMain.handle('stream-host-pull', () => streamServer.hostPull());
ipcMain.handle('stream-host-send', (_, viewerId, payload) => streamServer.hostSend(viewerId, payload));
ipcMain.handle('remote-play-code-encode', (_, prefix, payload) => encodeRemotePlayCode(prefix, payload));
ipcMain.handle('remote-play-code-decode', (_, value, acceptedPrefixes) => decodeRemotePlayCode(value, acceptedPrefixes));
ipcMain.handle('remote-play-status', () => remotePlayStatus());
ipcMain.handle('remote-play-start', async (_, file, config = {}) => {
  try {
    return { ok: true, status: await startRemotePlay(file, config) };
  } catch (error) {
    addActivity('error', `Remote Play Together could not start: ${error.message}`);
    return { ok: false, error: error.message, status: remotePlayStatus() };
  }
});
ipcMain.handle('remote-play-stop', () => ({ ok: true, status: stopRemotePlay() }));
ipcMain.on('remote-play-input', (_, payload) => { queueRemotePlayInput(payload || {}); });
ipcMain.handle('netplay-status', () => gameDeckNetplayStatus());
ipcMain.handle('netplay-game-info', (_, file) => netplayGameInfo(file));
ipcMain.handle('netplay-match-info', (_, file) => netplayMatchInfo(file));
ipcMain.handle('netplay-relays', () => netplayManager?.relays() || []);
ipcMain.handle('netplay-host', async (_, file, config = {}) => {
  try {
    const spec = await netplaySpecForFile(file);
    const status = await netplayManager.host({
      ...spec,
      relayId: config.relayId || 'nyc',
      maxPlayers: Math.max(2, Math.min(spec.maxPlayers, Number(config.maxPlayers || spec.maxPlayers)))
    });
    const store = readStore();
    store.recent[spec.contentFile] = Date.now();
    writeStore(store);
    return { ok: true, status };
  } catch (error) {
    addActivity('error', `Multiplayer host failed: ${error.message}`);
    return { ok: false, error: error.message, status: gameDeckNetplayStatus() };
  }
});
ipcMain.handle('netplay-join', async (_, invite, preferredFile = '', config = {}) => {
  try {
    const file = await findNetplayGame(invite, preferredFile);
    const spec = await netplaySpecForFile(file);
    const status = await netplayManager.join(invite, {
      ...spec,
      nickname: config.nickname || ''
    });
    const store = readStore();
    store.recent[spec.contentFile] = Date.now();
    writeStore(store);
    return { ok: true, file, status };
  } catch (error) {
    addActivity('error', `Multiplayer join failed: ${error.message}`);
    return { ok: false, error: error.message, status: gameDeckNetplayStatus() };
  }
});
ipcMain.handle('netplay-stop', () => ({ ok: true, status: netplayManager?.stop() || gameDeckNetplayStatus() }));
ipcMain.handle('arcade-audit', (_, force) => auditArcadeLibrary(Boolean(force)));
ipcMain.handle('settings', () => publicSettings());
ipcMain.handle('inspect-settings', (_, changes) => inspectSettings(changes || {}));
ipcMain.handle('save-settings', (_, changes) => {
  try {
    return saveSettings(changes);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('choose-directory', (_, kind) => chooseDirectory(kind));
ipcMain.handle('sponsors', () => getSponsors());
ipcMain.handle('donations', () => getDonationConfig());
ipcMain.handle('copy-text', (_, value) => {
  clipboard.writeText(String(value || ''));
  return true;
});
ipcMain.handle('read-clipboard', () => clipboard.readText());
ipcMain.handle('open-external', (_, target) => {
  try {
    openExternal(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit(0);
  return true;
});
ipcMain.handle('clear-activity', () => {
  activity = [];
  return true;
});

app.on('before-quit', () => {
  appIsQuitting = true;
  clearTimeout(launchCurtainTimer);
  launchCurtainTimer = null;
  const playStatus = embeddedPlayManager?.status();
  if (playStatus?.active) embeddedPlayManager.stop(playStatus.sessionId, 'GameDeck closed.').catch(() => {});
  pauseActiveDownloads();
  stopRemotePlay('GameDeck closed.');
  netplayManager?.stop('GameDeck closed.');
  streamServer?.close().catch(() => {});
  stopGameDeckOpenBorProcesses();
  globalShortcut.unregisterAll();
});

app.whenReady().then(() => {
  configureGameDeckCapture();
  fs.mkdirSync(LIBRARY, { recursive: true });
  primeFirmwareFolders();
  ensureRetroArchArcadeControllerConfig();
  ensureRetroArchEmbeddedConfig();
  ensureOpenBorRuntimeConfig();
  embeddedPlayManager = createEmbeddedPlayManager({
    listSources: embeddedCaptureSources,
    rankSources: rankSourceCandidates,
    spawnProcess: spec => {
      const child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        detached: false,
        windowsHide: false,
        stdio: 'ignore'
      });
      return spec.systemId === 'openbor' ? registerGameDeckOpenBorProcess(child) : child;
    },
    terminateProcess: terminateEmbeddedProcess,
    checkReadiness: readiness => {
      if (!readiness?.logFile || !readiness?.requiredText) return { ready: true };
      let text = '';
      try { text = fs.readFileSync(readiness.logFile, 'utf8'); } catch { return { ready: false }; }
      if (text.includes(readiness.requiredText)) return { ready: true };
      if (isFatalLibretroReadinessLog(text) || /Unable to load|FATAL|Could not open|No games were found/i.test(text)) {
        return { ready: false, fatal: true, error: readiness.failureMessage || 'The selected game did not load.' };
      }
      return { ready: false };
    },
    windowController: embeddedWindowController,
    onUpdate: emitPlaySession,
    onLog: addActivity
  });
  createWindow();
  globalShortcut.register('F10', async () => {
    const status = embeddedPlayManager?.status();
    if (!status?.active) return;
    const mode = status.mode === 'popout' ? 'docked' : 'popout';
    await embeddedPlayManager.setMode(status.sessionId, mode).catch(() => {});
  });
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
