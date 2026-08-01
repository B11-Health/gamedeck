const { app, BrowserWindow, ipcMain, shell, screen, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

if (process.platform === 'win32') app.setAppUserModelId('io.gamedeck.launcher');

const HOME_DIR = os.homedir();
const DOCUMENTS_DIR = app.getPath('documents');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

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
  retroArchPath: detectedRetroArch,
  retroArchCores: detectedCoreDir,
  mamePath: detectedMame,
  retroArchSystem: process.env.GAMEDECK_RETROARCH_SYSTEM || (detectedRetroArch
    ? path.join(path.dirname(detectedRetroArch), 'system')
    : path.join(HOME_DIR, '.config', 'retroarch', 'system')),
  sponsorsEnabled: true,
  sponsorManifestUrl: 'https://raw.githubusercontent.com/B11-Health/gamedeck/main/sponsors.json'
};
const runtimeSettings = { ...defaultSettings, ...readJson(SETTINGS_FILE, {}) };

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
const SEVEN_ZIP = firstExisting([
  path.join(RGSX_APP, 'assets', 'progs', '7z.exe'),
  path.join(RGSX_APP, 'assets', 'progs', '7zz'),
  findOnPath(process.platform === 'win32' ? ['7z.exe', '7zz.exe'] : ['7zz', '7z'])
]);
const RGSX_FIRMWARE_PACK = firstExisting([
  path.join(RGSX_ROOT, 'Retrobat V8.0.0.zip'),
  path.join(RGSX_ROOT, 'bios.zip')
], path.join(RGSX_ROOT, 'Retrobat V8.0.0.zip'));
const STORE = path.join(app.getPath('userData'), 'library.json');
const ART_CACHE = path.join(app.getPath('userData'), 'artwork');
const DETAILS_CACHE = path.join(app.getPath('userData'), 'details');
const ARCADE_AUDIT_FILE = path.join(app.getPath('userData'), 'arcade-audit.json');
const ARCADE_CONTROLLER_CONFIG = path.join(app.getPath('userData'), 'retroarch-arcade.cfg');
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
  mame: MAME
};

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
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', color: '#8b5cf6', folders: ['snes', 'sufami', 'satellaview'], exts: ['.sfc', '.smc', '.zip'], core: coreFile('snes9x_libretro'), icon: 'S' },
  { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', color: '#ef4444', folders: ['nes', 'fds'], exts: ['.nes', '.fds', '.zip'], core: coreFile('mesen_libretro'), icon: 'N' },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', color: '#22c55e', folders: ['n64', 'n64dd'], exts: ['.n64', '.z64', '.v64', '.zip'], core: coreFile('mupen64plus_next_libretro'), icon: '64' },
  { id: 'gb', name: 'Game Boy and Color', short: 'GB / GBC', color: '#84cc16', folders: ['gb', 'gbc'], exts: ['.gb', '.gbc', '.zip'], core: coreFile('sameboy_libretro'), icon: 'GB' },
  { id: 'gba', name: 'Game Boy Advance', short: 'GBA', color: '#6366f1', folders: ['gba'], exts: ['.gba', '.zip'], core: coreFile('mgba_libretro'), icon: 'A' },
  { id: 'nds', name: 'Nintendo DS', short: 'NDS', color: '#64748b', folders: ['nds'], exts: ['.nds', '.zip'], core: coreFile('melondsds_libretro'), icon: 'DS' },
  { id: 'genesis', name: 'Sega Genesis', short: 'GENESIS', color: '#2563eb', folders: ['megadrive', 'genesis'], exts: ['.md', '.gen', '.bin', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'SE' },
  { id: 'mastersystem', name: 'Sega Master System', short: 'MASTER SYSTEM', color: '#e11d48', folders: ['mastersystem'], exts: ['.sms', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'MS' },
  { id: 'gamegear', name: 'Sega Game Gear', short: 'GAME GEAR', color: '#f43f5e', folders: ['gamegear'], exts: ['.gg', '.zip'], core: coreFile('genesis_plus_gx_libretro'), icon: 'GG' },
  { id: 'segacd', name: 'Sega CD', short: 'SEGA CD', color: '#3b82f6', folders: ['segacd', 'megacd'], exts: ['.cue', '.chd'], core: coreFile('genesis_plus_gx_libretro'), bios: ['bios_CD_E.bin', 'bios_CD_U.bin', 'bios_CD_J.bin'], biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'CD' },
  { id: 'pce', name: 'PC Engine', short: 'PCE', color: '#f97316', folders: ['pcengine', 'supergrafx'], exts: ['.pce', '.zip'], core: coreFile('mednafen_pce_fast_libretro'), icon: 'P' },
  { id: 'saturn', name: 'Sega Saturn', short: 'SATURN', color: '#38bdf8', folders: ['saturn'], exts: ['.cue', '.chd'], core: coreFile('mednafen_saturn_libretro'), bios: ['sega_101.bin', 'mpr-17933.bin'], biosDirs: [RA_SYSTEM, ...firmwareSearchRoots], icon: 'ST' },
  { id: 'dreamcast', name: 'Dreamcast', short: 'DC', color: '#fb923c', folders: ['dreamcast'], exts: ['.gdi', '.cdi', '.chd'], core: coreFile('flycast_libretro'), icon: 'DC' },
  { id: 'atari2600', name: 'Atari 2600', short: 'ATARI', color: '#f59e0b', folders: ['atari2600'], exts: ['.a26', '.bin', '.zip'], core: coreFile('stella_libretro'), icon: 'A' },
  { id: 'arcade', name: 'FinalBurn Neo', short: 'FBNEO', color: '#ec4899', folders: ['fbneo', 'neogeo'], exts: ['.zip', '.7z'], core: coreFile('fbneo_libretro'), icon: 'FB' },
  { id: 'mame', name: 'MAME', short: 'MAME', color: '#f43f8f', folders: ['mame', 'arcade'], exts: ['.zip', '.7z'], core: coreFile('mame_libretro'), exe: emulatorPaths.mame, preferExe: true, launchMode: 'mame', icon: 'M' },
  { id: 'ps1', name: 'PlayStation', short: 'PS1', color: '#94a3b8', folders: ['psx', 'ps1'], exts: ['.cue', '.chd', '.pbp'], exe: emulatorPaths.duckstation, args: ['-batch', '-fullscreen'], biosPattern: /^scph[a-z0-9_-]*\.(?:bin|rom)$/i, biosHint: 'a BIOS file named like scph1001.bin or scph5500.rom', biosDirs: [path.join(localAppData, 'DuckStation', 'bios'), path.join(applicationSupport, 'DuckStation', 'bios'), path.join(HOME_DIR, '.local', 'share', 'duckstation', 'bios'), path.join(RGSX_ROOT, 'roms', 'bios')], icon: 'PS' },
  { id: 'ps2', name: 'PlayStation 2', short: 'PS2', color: '#3b82f6', folders: ['ps2'], exts: ['.iso', '.chd'], exe: emulatorPaths.pcsx2, args: ['-fullscreen', '-batch', '--'], biosPattern: /^scph[a-z0-9_-]*\.(?:bin|rom)$/i, biosHint: 'a BIOS file named like scph39001.bin or scph70012.rom', biosDirs: [path.join(DOCUMENTS_DIR, 'PCSX2', 'bios'), path.join(applicationSupport, 'PCSX2', 'bios'), path.join(HOME_DIR, '.config', 'PCSX2', 'bios'), path.join(HOME_DIR, '.local', 'share', 'PCSX2', 'bios'), path.join(RGSX_ROOT, 'roms', 'bios')], icon: 'P2' },
  { id: 'psp', name: 'PlayStation Portable', short: 'PSP', color: '#06b6d4', folders: ['psp'], exts: ['.iso', '.cso', '.pbp'], exe: emulatorPaths.ppsspp, icon: 'PP' },
  { id: 'gamecube', name: 'Nintendo GameCube', short: 'GAMECUBE', color: '#7c3aed', folders: ['gamecube'], exts: ['.iso', '.gcm', '.rvz'], exe: emulatorPaths.dolphin, args: ['-b', '-e'], icon: 'GC' },
  { id: 'wii', name: 'Nintendo Wii', short: 'WII', color: '#0ea5e9', folders: ['wii'], exts: ['.wbfs', '.rvz'], exe: emulatorPaths.dolphin, args: ['-b', '-e'], icon: 'W' },
  { id: 'wiiu', name: 'Nintendo Wii U', short: 'WII U', color: '#00a2e8', folders: ['wiiu'], exts: ['.wud', '.wux', '.rpx'], exe: emulatorPaths.cemu, args: ['-f', '-g'], icon: 'WU' }
];

const tgdbPlatforms = {
  snes: 6, nes: 7, n64: 3, gb: 4, gba: 5, nds: 8, genesis: 18,
  mastersystem: 35, gamegear: 20, segacd: 21, pce: 34, saturn: 17,
  dreamcast: 16, atari2600: 22, arcade: 23, mame: 23, ps1: 10, ps2: 11,
  psp: 13, gamecube: 2, wii: 9, wiiu: 38
};

let mainWindow = null;
let activity = [];
const downloads = new Map();
const artworkRequests = new Map();
const artworkMisses = new Set();
const detailRequests = new Map();
const detailMisses = new Set();
const catalogRowsCache = new Map();
let artworkBackoffUntil = 0;
let artworkBackoffLogged = false;
let detailBackoffUntil = 0;
let mameTitleIndex = null;
let mameConfiguredRomPaths = null;
let arcadeAuditTask = null;
let controllerHintsCache = null;
const mameMetadataCache = new Map();
const arcadeAuditCache = readJson(ARCADE_AUDIT_FILE, { version: 1, entries: {}, updatedAt: 0 });
if (!arcadeAuditCache.entries || typeof arcadeAuditCache.entries !== 'object') arcadeAuditCache.entries = {};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function readStore() {
  return readJson(STORE, { favorites: [], recent: {} });
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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
    if (isDirectory) walk(item, out);
    else out.push(item);
  }
  return out;
}

function cleanName(file) {
  const leaf = String(file || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf
    .replace(/\.[^.]+$/, '')
    .replace(/[_.]/g, ' ')
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

function normalizeName(value) {
  return lookupTitleName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fileIdentity(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isArcadeSystem(systemOrId) {
  const id = typeof systemOrId === 'string' ? systemOrId : systemOrId?.id;
  return id === 'arcade' || id === 'mame';
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

function systemBiosReady(system) {
  if (!system.bios && !system.biosPattern) return true;
  const files = (system.biosDirs || []).flatMap(directory => walk(directory)).map(file => path.basename(file));
  if (system.bios) {
    const available = new Set(files.map(file => file.toLowerCase()));
    if (system.bios.some(file => available.has(file.toLowerCase()))) return true;
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
    return `${system.name} firmware is required. Add ${system.bios.join(' or ')} to ${preferredDir}.`;
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

function detectSystem(file) {
  const relative = path.relative(LIBRARY, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const folder = relative.split(path.sep)[0].toLowerCase();
  const byFolder = systemForFolder(folder);
  if (byFolder) return byFolder;

  const extension = path.extname(file).toLowerCase();
  const matches = systems.filter(system => system.exts.includes(extension));
  return matches.length === 1 ? matches[0] : null;
}

function isPlayableFile(file, system) {
  return system && system.exts.includes(path.extname(file).toLowerCase());
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
    title: String(data.title || data.name || lookupTitleName(title)).trim(),
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
  const gameTitle = lookupTitleName(title) || String(context.name || 'Selected game');
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
  const cacheFile = cachedDetailsPath(title, systemId);
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
        name: lookupTitleName(title),
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
      addActivity('info', `Game details are temporarily unavailable for ${lookupTitleName(title)}: ${error.message}`);
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
  const cached = cachedArchiveAudit(game.file);
  if (cached.status !== 'unchecked' && game.system !== 'mame') return cached;
  const fingerprint = archiveFingerprint(game.file);
  const extension = path.extname(game.file).toLowerCase();
  const base = { fingerprint, checkedAt: Date.now(), format: extension.replace('.', '').toUpperCase() };
  const size = Number(fingerprint.split(':')[0] || 0);
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
    attention: items.filter(item => ['damaged', 'incomplete'].includes(item.status)).length,
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
    const system = detectSystem(file);
    if (!isPlayableFile(file, system)) return null;
    const stat = fs.statSync(file);
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
      artworkTitle: title,
      artworkFolder: folder,
      shortName,
      edition: editionLabel(file),
      region: gameRegion(gameTags(file)),
      format: path.extname(file).replace('.', '').toUpperCase(),
      archiveHealth: archive?.status || '',
      archiveHealthMessage: archive?.message || '',
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

function emitDownload(job) {
  if (!job || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('download-update', { ...job });
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

function launchGame(file) {
  const safeFile = safeLibraryFile(file);
  const system = detectSystem(safeFile);
  if (!system || !isPlayableFile(safeFile, system)) throw Error('Could not identify this game system.');
  const setupIssue = systemSetupIssue(system);
  if (setupIssue) {
    if (String(setupIssue).toLowerCase().includes('firmware')) {
      const firmwareResult = queueRgsxFirmwareDownload(system.id);
      if (firmwareResult?.ok) {
        addActivity('info', `${system.name} firmware is being downloaded through RGSX.`);
        return false;
      }
    }
    throw Error(setupIssue);
  }

  const game = {
    file: safeFile,
    system: system.id,
    shortName: rawGameName(safeFile)
  };
  if (isArcadeSystem(system)) {
    const audit = inspectArcadeArchiveSync(game);
    if (audit.status === 'damaged' || audit.status === 'incomplete') throw Error(audit.message);
  }

  const emulator = configuredEmulator(system);
  if (!emulator) throw Error(`${system.name} emulator is not installed or configured.`);
  let args;
  if (emulator.kind === 'libretro') {
    const controllerConfig = isArcadeSystem(system) ? ensureRetroArchArcadeControllerConfig() : '';
    args = [
      '-f',
      ...(controllerConfig ? [`--appendconfig=${controllerConfig}`] : []),
      '-L',
      emulator.corePath,
      safeFile
    ];
  } else if (emulator.kind === 'mame') {
    args = [
      game.shortName,
      '-rompath', mameRomSearchPath(safeFile),
      '-joystick',
      ...(process.platform === 'win32' ? ['-joystickprovider', 'winhybrid'] : []),
      '-skip_gameinfo',
      '-noconfirm_quit',
      '-nowindow'
    ];
  } else {
    args = [...(system.args || []), safeFile];
  }

  const child = spawn(emulator.executable, args, {
    cwd: path.dirname(emulator.executable),
    detached: true,
    stdio: 'ignore'
  });
  child.once('error', error => addActivity('error', `${system.name} launch failed: ${error.message}`));
  child.unref();
  const store = readStore();
  store.recent[safeFile] = Date.now();
  writeStore(store);
  const displayName = isArcadeSystem(system) ? arcadeDisplayTitle(game.shortName) : cleanName(safeFile);
  addActivity('success', `Launched ${displayName} with ${emulator.label}`);
  return true;
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

function installedFiles(folder) {
  const root = path.resolve(LIBRARY, String(folder || ''));
  const relative = path.relative(path.resolve(LIBRARY), root);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return new Map();
  const system = systemForFolder(folder);
  const artifacts = new Map();
  for (const file of walk(root)) {
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
    const installedFile = installed.get(fileIdentity(row[0])) || '';
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

function queueRgsxDownload(source, folder, title, fileName) {
  if (!fs.existsSync(RGSX_PYTHON) || !fs.existsSync(RGSX_CLI)) {
    return { ok: false, error: 'RGSX runtime is not installed correctly. Open Activity for details.' };
  }

  const catalog = getCatalogSystems();
  const platform = catalog.find(item => item.source === source && item.folder === folder);
  if (!platform) return { ok: false, error: 'The selected RGSX platform is no longer available.' };

  const available = readJson(platform.gamesFile, []).some(row => row[0] === fileName);
  if (!available) return { ok: false, error: 'The selected game is not present in the current RGSX catalog.' };

  const installed = installedFiles(folder).get(fileIdentity(fileName));
  if (installed) {
    return {
      ok: true,
      downloaded: false,
      installedFile: installed,
      installedReady: isPlayableFile(installed, systemForFolder(folder))
    };
  }

  const active = [...downloads.values()].find(job => job.source === source && job.fileName === fileName && job.status === 'running');
  if (active) return { ok: true, queued: true, taskId: active.id };

  const id = `rgsx-${Date.now()}`;
  const system = systemForFolder(folder);
  const job = {
    id,
    source,
    folder,
    systemId: system?.id || '',
    systemName: system?.name || folder,
    title,
    fileName,
    status: 'running',
    stage: 'Preparing',
    message: 'RGSX is preparing the transfer.',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    speed: '',
    downloadedBytes: 0,
    totalBytes: 0
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

  const consume = (level, chunk) => {
    for (const line of String(chunk).split(/[\r\n]+/)) {
      updateDownloadFromLine(job, line);
      addActivity(level, line, id);
    }
  };
  child.stdout.on('data', chunk => consume('info', chunk));
  child.stderr.on('data', chunk => consume('error', chunk));
  child.on('error', error => {
    job.status = 'error';
    job.stage = 'Failed';
    job.error = error.message;
    job.message = error.message;
    job.finishedAt = Date.now();
    emitDownload(job);
    addActivity('error', `RGSX failed to start: ${error.message}`, id);
  });
  child.on('close', code => {
    job.status = code === 0 ? 'complete' : 'error';
    job.stage = code === 0 ? 'Ready to play' : 'Failed';
    job.finishedAt = Date.now();
    job.progress = code === 0 ? 100 : job.progress;
    job.message = code === 0 ? 'Download complete. The game is ready in your library.' : `RGSX exited with code ${code}.`;
    emitDownload(job);
    addActivity(code === 0 ? 'success' : 'error', code === 0 ? `RGSX finished: ${title}` : `RGSX exited with code ${code}: ${title}`, id);
  });

  return { ok: true, queued: true, taskId: id };
}

function prepareGameArchive(file) {
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

  const id = `install-${Date.now()}`;
  const job = {
    id,
    source: 'Local archive',
    folder: path.basename(path.dirname(safeFile)),
    systemId: system.id,
    systemName: system.name,
    title: cleanName(safeFile),
    fileName: path.basename(safeFile),
    archiveFile: safeFile,
    status: 'running',
    stage: 'Installing',
    message: 'Unpacking the downloaded game. The original archive will be kept.',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    speed: '',
    downloadedBytes: 0,
    totalBytes: fs.statSync(safeFile).size,
    localInstall: true
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
    const consume = (level, chunk) => {
      for (const line of String(chunk).split(/[\r\n]+/)) {
        updateDownloadFromLine(job, line);
        addActivity(level, line, id);
      }
    };
    child.stdout.on('data', chunk => consume('info', chunk));
    child.stderr.on('data', chunk => consume('info', chunk));
    child.on('error', error => {
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

function queueRgsxFirmwareDownload(systemId) {
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

  const id = `rgsx-bios-${Date.now()}`;
  const job = {
    id,
    source: biosPlatform.platform_name,
    folder: biosPlatform.folder,
    systemId: system.id,
    systemName: system.name,
    title: `${system.name} firmware`,
    fileName,
    status: 'running',
    stage: 'Preparing',
    message: `Preparing ${system.name} firmware.`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    speed: '',
    downloadedBytes: 0,
    totalBytes: 0,
    firmware: true
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

  const consume = (level, chunk) => {
    for (const line of String(chunk).split(/[\r\n]+/)) {
      updateDownloadFromLine(job, line);
      addActivity(level, line, id);
    }
  };
  child.stdout.on('data', chunk => consume('info', chunk));
  child.stderr.on('data', chunk => consume('error', chunk));
  child.on('error', error => {
    job.status = 'error';
    job.stage = 'Failed';
    job.error = error.message;
    job.message = error.message;
    job.finishedAt = Date.now();
    emitDownload(job);
    addActivity('error', `RGSX failed to start: ${error.message}`, id);
  });
  child.on('close', code => {
    job.status = code === 0 ? 'complete' : 'error';
    job.stage = code === 0 ? 'Ready to use' : 'Failed';
    job.finishedAt = Date.now();
    job.progress = code === 0 ? 100 : job.progress;
    job.message = code === 0 ? `${system.name} firmware is ready.` : `RGSX exited with code ${code}.`;
    emitDownload(job);
    addActivity(code === 0 ? 'success' : 'error', code === 0 ? `RGSX finished: ${system.name} BIOS` : `RGSX exited with code ${code}: ${system.name} BIOS`, id);
  });

  return { ok: true, queued: true, taskId: id };
}

function thumbnailNameCandidates(title) {
  const raw = lookupTitleName(title);
  const expanded = raw
    .replace(/\((JP|JPN|J)\)/gi, '(Japan)')
    .replace(/\((US|U)\)/gi, '(USA)')
    .replace(/\((EU|EUR|E)\)/gi, '(Europe)')
    .replace(/\((UK)\)/gi, '(Europe)');
  const disc = expanded.replace(/\s+-\s+(?:CD|Disc)\s*(\d+)/i, ' (Disc $1)');
  const withoutDisc = disc.replace(/\s*\((?:Disc|Disk)\s*\d+\)\s*$/i, '');
  const names = [expanded, disc, withoutDisc];
  return [...new Set(names.filter(Boolean).flatMap(name => [name, name.replace(/[&*/:`<>?\\|]/g, '_')]))].slice(0, 6);
}

function thumbnailRepoCandidates(systemId, folder) {
  const repositories = [thumbnailRepos[folder]];
  const system = systems.find(item => item.id === systemId);
  if (system) repositories.push(...system.folders.map(item => thumbnailRepos[item]));
  if (systemId === 'arcade') repositories.push('MAME', 'SNK_-_Neo_Geo');
  return [...new Set(repositories.filter(Boolean))];
}

async function fetchLibretroArtwork(title, systemId, folder, cache) {
  for (const repository of thumbnailRepoCandidates(systemId, folder)) {
    for (const name of thumbnailNameCandidates(title)) {
      const encoded = encodeURIComponent(name).replace(/%2F/gi, '_');
      const url = `https://raw.githubusercontent.com/libretro-thumbnails/${repository}/master/Named_Boxarts/${encoded}.png`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok || !String(response.headers.get('content-type')).startsWith('image/')) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) continue;
        fs.mkdirSync(ART_CACHE, { recursive: true });
        fs.writeFileSync(cache, bytes);
        return toFileUrl(cache);
      } catch {
        // TheGamesDB remains available as a fallback when GitHub is unavailable.
      }
    }
  }
  return '';
}

async function fetchArtwork(title, systemId, folder = '') {
  const platformId = tgdbPlatforms[systemId];
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
        name: lookupTitleName(title),
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

function diagnostics() {
  const library = getLibrary();
  return {
    library: LIBRARY,
    rgsxData: RGSX_DATA,
    rgsxRuntime: fs.existsSync(RGSX_PYTHON),
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
      webSecurity: true
    }
  });
  mainWindow.center();
  if (captureMode) mainWindow.once('ready-to-show', () => mainWindow.showInactive());
  const captureView = String(process.env.GAMEDECK_CAPTURE_VIEW || '');
  mainWindow.loadFile('src/index.html', captureView ? { query: { captureView } } : undefined);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => {
    addActivity('success', 'GameDeck ready');
    const capturePath = String(process.env.GAMEDECK_CAPTURE_PATH || '');
    if (captureMode && capturePath) {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.mkdirSync(path.dirname(capturePath), { recursive: true });
          fs.writeFileSync(capturePath, image.toPNG());
          addActivity('success', `QA capture saved: ${capturePath}`);
        } catch (error) {
          addActivity('error', `QA capture failed: ${error.message}`);
        } finally {
          app.quit();
        }
      }, 6000);
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
ipcMain.handle('launch', (_, file) => {
  try {
    launchGame(file);
    return { ok: true };
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
ipcMain.handle('artwork', (_, title, systemId, folder) => fetchArtwork(title, systemId, folder));
ipcMain.handle('game-details', (_, title, systemId, context) => fetchGameDetails(title, systemId, context));
ipcMain.handle('diagnostics', () => diagnostics());
ipcMain.handle('arcade-audit', (_, force) => auditArcadeLibrary(Boolean(force)));
ipcMain.handle('settings', () => publicSettings());
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

app.whenReady().then(() => {
  primeFirmwareFolders();
  ensureRetroArchArcadeControllerConfig();
  createWindow();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
