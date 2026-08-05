const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
document.documentElement.dataset.platform = String(window.deck?.platform || '').toLowerCase();

const GAME_SORTS = new Set(['title', 'recent', 'system', 'size']);
const GAMEDECK_LINKS = Object.freeze({
  github: 'https://github.com/B11-Health/gamedeck',
  site: 'https://b11-health.github.io/gamedeck/',
  tutorial: 'https://youtu.be/vY-fFVu2ClM',
  startHere: 'https://www.youtube.com/playlist?list=PLG-ejeCsa-AI',
  shorts: 'https://www.youtube.com/playlist?list=PLCbffYifS8R8',
  discussions: 'https://github.com/B11-Health/gamedeck/discussions',
  players: 'https://github.com/B11-Health/gamedeck/discussions/8',
  issues: 'https://github.com/B11-Health/gamedeck/issues/new/choose',
  releases: 'https://github.com/B11-Health/gamedeck/releases'
});
const GAMEDECK_SHARE_COPY = Object.freeze({
  reddit: `I built GameDeck because my legally owned game library had become a maze of launchers, emulator folders, and inconsistent controller setup. It is an open-source, local-first desktop app that turns the collection into one controller-friendly library and now includes GameDeck Live plus encrypted Remote Play Together.\n\nI would value blunt feedback on setup clarity, controller navigation, and the Remote Play flow—not just stars.\n\nSource, releases, and issue tracker: ${GAMEDECK_LINKS.github}\nStart here: ${GAMEDECK_LINKS.startHere}\n30-second tours: ${GAMEDECK_LINKS.shorts}`,
  short: `POV: your legally owned game collection finally feels like a console again. GameDeck is open source, local first, controller friendly, and supports Couch Co-op, encrypted Remote Play Together, and exact-match netplay. No ROMs included.\n\n${GAMEDECK_LINKS.site}\n\n#GameDeck #OpenSource #RetroGaming #PCGaming #RemotePlay`,
  youtube: `GameDeck is free, open source, and built for the games you legally own. Download: ${GAMEDECK_LINKS.site}\nSource + issues: ${GAMEDECK_LINKS.github}\nFull setup and multiplayer guide: ${GAMEDECK_LINKS.startHere}\n\nWhat should I test next: first-run setup, artwork matching, Couch Co-op, Remote Play, or synchronized netplay? I read every substantive reply.`,
  linkedin: `I am building GameDeck, a free and open-source desktop app that turns legally owned local game collections into one controller-first library. The product now combines a one-install runtime, visible setup diagnostics, artwork recovery, Couch Co-op, encrypted Remote Play Together, and exact-match synchronized netplay across Windows, macOS, and Linux.\n\nThe design goal is simple: remove launcher friction without hiding how the system works or uploading a player's library.\n\nI am looking for practical feedback from players, open-source maintainers, emulator enthusiasts, and product designers—especially on first-run setup and multiplayer clarity.\n\nTry it: ${GAMEDECK_LINKS.site}\nSource: ${GAMEDECK_LINKS.github}`,
  facebook: `Sharing this as the builder: GameDeck is a free, open-source, controller-first home for games you legally own. It organizes a local collection, explains setup problems, and supports Couch Co-op, encrypted Remote Play Together, and synchronized netplay. No ROMs, BIOS files, keys, or commercial artwork are included.\n\nI would love a few real-world testers with different controllers and console libraries. What setup should we test next?\n\nDownload and details: ${GAMEDECK_LINKS.site}\nSource: ${GAMEDECK_LINKS.github}`,
  creator: `Hey [NAME] — your [SPECIFIC VIDEO OR SERIES] made me think GameDeck could be useful to your audience. It is a free, open-source, controller-first launcher for legally owned local game libraries, with a one-install runtime, honest setup diagnostics, and three multiplayer paths. I can send a clean build, a 30-second clip, and direct technical support; no paid talking points or required positive coverage.\n\nPreview: ${GAMEDECK_LINKS.shorts}\nSource: ${GAMEDECK_LINKS.github}`,
  event: `🎮 Remote Play Friday — GameDeck community session\n\nBring one legally owned local multiplayer game and a controller. Hosts can use encrypted Remote Play Together so guests do not need the game, or exact-match synchronized netplay when both players have matching files and cores.\n\nFind players and reply here: ${GAMEDECK_LINKS.players}\nSetup guide: ${GAMEDECK_LINKS.startHere}\n\nReply with your timezone, preferred game, and whether you can host.`
});
const COMMUNITY_LINKS = Object.freeze({
  hub: GAMEDECK_LINKS.discussions,
  players: GAMEDECK_LINKS.players,
  announcements: GAMEDECK_LINKS.releases,
  support: GAMEDECK_LINKS.issues,
  showcase: GAMEDECK_LINKS.discussions
});

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(`gamedeck:${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(`gamedeck:${key}`, value);
  } catch {
    // Preferences are a convenience; the launcher remains fully usable if storage is unavailable.
  }
}

const savedSort = readPreference('sort', 'title');
const HAPTIC_PREFERENCE_ORDER = ['auto', 'enhance', 'off'];
const savedHapticPreference = readPreference('haptics', readPreference('adaptive-haptics', 'on') === 'off' ? 'off' : 'auto');
const requestedCaptureView = new URLSearchParams(window.location.search).get('captureView');

const state = {
  library: { systems: [], games: [] },
  catalog: [],
  catalogGames: [],
  catalogSystem: null,
  catalogCache: new Map(),
  catalogMemory: {},
  selectedSystem: 'all',
  focusedLibrarySystem: 'all',
  focusedGameId: null,
  focusedConsoleId: null,
  focusedCatalogId: null,
  view: 'home',
  libraryZone: 'games',
  discoverZone: 'systems',
  query: '',
  catalogQuery: '',
  catalogFilter: 'all',
  activities: [],
  activityFilter: 'all',
  downloads: [],
  dismissedDownloads: new Set(),
  activeCatalogTasks: new Map(),
  artworkLoading: new Set(),
  gameDetails: new Map(),
  detailLoading: new Set(),
  settings: null,
  settingsBaseline: null,
  sponsors: null,
  donations: null,
  diagnostics: null,
  launchingFile: null,
  launchHandoffTimer: null,
  playSession: { active: false, phase: 'idle', sessionId: '', title: '', mode: 'docked', aspectRatio: 16 / 9, captureReady: false },
  playFile: '',
  playGameId: null,
  inputMode: 'pointer',
  shelfMemory: {},
  setupCoachOpen: requestedCaptureView === 'setup' || readPreference('setup-coach', 'auto') === 'open',
  setupCoachDismissed: readPreference('setup-coach', 'auto') === 'dismissed',
  arcadeAudit: { total: 0, verified: 0, attention: 0, unchecked: 0, items: [] },
  arcadeAuditProgress: { running: false, done: 0, total: 0, current: '' },
  arcadeFilter: 'all',
  artworkFilter: readPreference('artwork-filter', 'all') === 'missing-art' ? 'missing-art' : 'all',
  controllerHints: [],
  sponsorTarget: '',
  transferExpanded: false,
  catalogLimit: 120,
  sort: GAME_SORTS.has(savedSort) ? savedSort : 'title',
  density: 'compact',
  sidebarCollapsed: readPreference('sidebar', 'expanded') === 'collapsed',
  hapticPreference: HAPTIC_PREFERENCE_ORDER.includes(savedHapticPreference) ? savedHapticPreference : 'auto'
};

let playCaptureStream = null;
let playCapturePromise = null;
let playCaptureGeneration = 0;
let playCaptureFallbackPending = false;
let playFrameReady = false;
let playFrameReadySessionId = '';
let playAmbientTimer = null;
let playAmbientCanvas = null;
let playAmbientContext = null;
let playAmbientColorState = Object.create(null);
let launchCurtainTimer = null;
let fullscreenControlsTimer = null;
let playPointerTimer = null;
let playAspectTimer = null;
let reportedPlayAspect = 0;
let playHapticSessionKey = '';
let playHapticStream = null;
let playHapticRenderedMode = '';
let playHapticRenderedPreference = '';
let playHaptics = null;
let uiHapticLastAt = -Infinity;
let uiHapticLastKind = '';
let gameDetailReturnFocus = null;
let gameDetailHideTimer = null;


const SYSTEM_THEME_BACKGROUNDS = {
  all: { key: 'all', image: '../assets/system-themes/nintendo-polygon.webp', accent: '#72e7ff', glow: '#8b5cff', position: '78% center' },
  snes: { key: 'nintendo-classic', image: '../assets/system-themes/nintendo-classic.webp', accent: '#c86cff', glow: '#ff3eb5', position: '76% center' },
  nes: { key: 'nintendo-classic', image: '../assets/system-themes/nintendo-classic.webp', accent: '#ff5a6f', glow: '#b947ff', position: '76% center' },
  fds: { key: 'nintendo-classic', image: '../assets/system-themes/nintendo-classic.webp', accent: '#ff5a6f', glow: '#b947ff', position: '76% center' },
  satellaview: { key: 'nintendo-classic', image: '../assets/system-themes/nintendo-classic.webp', accent: '#a66cff', glow: '#ff3eb5', position: '76% center' },
  sufami: { key: 'nintendo-classic', image: '../assets/system-themes/nintendo-classic.webp', accent: '#d36cff', glow: '#ff3e9f', position: '76% center' },
  n64: { key: 'nintendo-polygon', image: '../assets/system-themes/nintendo-polygon.webp', accent: '#45e6c1', glow: '#6d71ff', position: '80% center' },
  gamecube: { key: 'nintendo-polygon', image: '../assets/system-themes/nintendo-polygon.webp', accent: '#8f72ff', glow: '#36d8ff', position: '80% center' },
  wii: { key: 'nintendo-polygon', image: '../assets/system-themes/nintendo-polygon.webp', accent: '#7de7ff', glow: '#4e9fff', position: '80% center' },
  wiiu: { key: 'nintendo-polygon', image: '../assets/system-themes/nintendo-polygon.webp', accent: '#36c8ff', glow: '#6f62ff', position: '80% center' },
  gb: { key: 'nintendo-handheld', image: '../assets/system-themes/nintendo-handheld.webp', accent: '#a9ef5b', glow: '#5bdcff', position: '82% center' },
  gba: { key: 'nintendo-handheld', image: '../assets/system-themes/nintendo-handheld.webp', accent: '#8d7cff', glow: '#5bdcff', position: '82% center' },
  nds: { key: 'nintendo-handheld', image: '../assets/system-themes/nintendo-handheld.webp', accent: '#75dfff', glow: '#8d68ff', position: '82% center' },
  genesis: { key: 'sega-16bit', image: '../assets/system-themes/sega-16bit.webp', accent: '#48a8ff', glow: '#ff3eb5', position: '80% center' },
  sega32x: { key: 'sega-16bit', image: '../assets/system-themes/sega-16bit.webp', accent: '#ff9a47', glow: '#6b7cff', position: '80% center' },
  mastersystem: { key: 'sega-16bit', image: '../assets/system-themes/sega-16bit.webp', accent: '#ff5a63', glow: '#4f8dff', position: '80% center' },
  gamegear: { key: 'sega-16bit', image: '../assets/system-themes/sega-16bit.webp', accent: '#ef62ff', glow: '#3ccfff', position: '80% center' },
  segacd: { key: 'sega-3d', image: '../assets/system-themes/sega-3d.webp', accent: '#55c8ff', glow: '#ff9c45', position: '80% center' },
  saturn: { key: 'sega-3d', image: '../assets/system-themes/sega-3d.webp', accent: '#7dcfff', glow: '#8c6cff', position: '80% center' },
  dreamcast: { key: 'sega-3d', image: '../assets/system-themes/sega-3d.webp', accent: '#ff9a47', glow: '#5bcfff', position: '80% center' },
  ps1: { key: 'playstation', image: '../assets/system-themes/playstation.webp', accent: '#b7c6dd', glow: '#4d86ff', position: '80% center' },
  ps2: { key: 'playstation', image: '../assets/system-themes/playstation.webp', accent: '#4c8dff', glow: '#825fff', position: '80% center' },
  psp: { key: 'playstation', image: '../assets/system-themes/playstation.webp', accent: '#43d8ff', glow: '#586bff', position: '80% center' },
  arcade: { key: 'arcade', image: '../assets/system-themes/arcade.webp', accent: '#ff49cc', glow: '#36d9ff', position: '82% center' },
  mame: { key: 'arcade', image: '../assets/system-themes/arcade.webp', accent: '#ff49cc', glow: '#36d9ff', position: '82% center' },
  atari2600: { key: 'retro', image: '../assets/system-themes/retro.webp', accent: '#ff9a3d', glow: '#ffc24b', position: '82% center' },
  pce: { key: 'retro', image: '../assets/system-themes/retro.webp', accent: '#ff9a3d', glow: '#ffc24b', position: '82% center' }
};

function systemTheme(systemId) {
  return SYSTEM_THEME_BACKGROUNDS[systemId] || SYSTEM_THEME_BACKGROUNDS.all;
}

function applySystemTheme(systemId) {
  const theme = systemTheme(systemId);
  const root = document.documentElement;
  root.style.setProperty('--system-accent', theme.accent);
  root.style.setProperty('--system-glow', theme.glow);
  document.body.dataset.systemTheme = theme.key;
  const spotlight = $('#spotlight');
  const backdrop = $('#spotlightBackdrop');
  if (!spotlight || !backdrop) return theme;
  spotlight.dataset.systemTheme = theme.key;
  backdrop.style.objectPosition = theme.position;
  if (backdrop.dataset.themeSrc !== theme.image) {
    backdrop.dataset.themeSrc = theme.image;
    backdrop.classList.remove('is-ready');
    backdrop.onload = () => backdrop.classList.add('is-ready');
    backdrop.src = theme.image;
    if (backdrop.complete) backdrop.classList.add('is-ready');
  }
  return theme;
}

const views = ['home', 'discover', 'favorites', 'recent', 'community'];
const CATALOG_PAGE_SIZE = 120;
let toastTimer = null;
let catalogRequest = 0;
let artworkObserver = null;
let artworkActive = 0;
let artworkEnrichmentTimer = null;
let detailTimer = null;
let loadingHideTimer = null;
let transferHideTimer = null;
let settingsInspectTimer = null;
let settingsInspectionRequest = 0;
const artworkQueue = [];
const artworkEnrichmentTried = new Set();
const completionRefreshes = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function toast(message, tone = 'info') {
  const element = $('#toast');
  const text = String(message || '');
  const resolvedTone = tone !== 'info'
    ? tone
    : /could not|failed|error|missing|damaged|attention|required|blocked/i.test(text)
      ? 'warning'
      : /saved|ready|copied|refreshed|finished|complete|installed|launching/i.test(text)
        ? 'success'
        : 'info';
  const icons = { info: 'i', success: '✓', warning: '!', progress: '↻' };
  element.classList.remove('info', 'success', 'warning', 'progress');
  element.classList.add(resolvedTone, 'show');
  element.querySelector('.toast-icon').textContent = icons[resolvedTone] || icons.info;
  element.querySelector('.toast-message').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), resolvedTone === 'warning' ? 3600 : 2800);
}

function applyLayoutPreferences(announce = false) {
  const compact = state.density === 'compact';
  document.body.classList.toggle('density-compact', compact);
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#sidebarToggle').setAttribute('aria-pressed', String(!state.sidebarCollapsed));
  $('#sidebarToggle').setAttribute('aria-label', state.sidebarCollapsed ? 'Expand systems rail' : 'Collapse systems rail');
  $('#sidebarToggle').title = `${state.sidebarCollapsed ? 'Expand' : 'Collapse'} systems rail (Ctrl+B)`;
  if (announce) toast(`${compact ? 'Compact' : 'Comfortable'} layout · systems ${state.sidebarCollapsed ? 'collapsed' : 'expanded'}`);
  requestAnimationFrame(observeVisibleArtwork);
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  writePreference('sidebar', state.sidebarCollapsed ? 'collapsed' : 'expanded');
  applyLayoutPreferences(true);
}

function relative(timestamp) {
  if (!timestamp) return 'Ready to play';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days < 1) return 'Played today';
  if (days === 1) return 'Played yesterday';
  return `Played ${days} days ago`;
}

function sizeLabel(bytes) {
  if (!bytes) return 'Local game';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function transferSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function etaLabel(download) {
  if (download.eta) return `${download.eta} remaining`;
  const seconds = Number(download.etaSeconds || 0);
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s remaining`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m remaining`;
}

function detailKey(title, systemId) {
  return `${systemId}:${String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function fileTaskIdentity(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  return leaf.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fallbackDescription(title, systemName, installed, edition = '') {
  const release = edition ? ` This ${edition.replace(/\s*\/\s*/g, ', ')} edition keeps its original release identity.` : '';
  return installed
    ? `${title} is ready in your ${systemName} collection.${release} Pick up a controller and jump in whenever you are ready.`
    : `${title} is available for ${systemName}.${release} Add it through Discover to bring it into your GameDeck library.`;
}

function cardDescription(game, system) {
  if (game.installedFile && game.installedReady === false) return `Downloaded safely — unpack once to finish setup.`;
  if (game.installedFile) return `Installed and ready on ${system.name}.`;
  const region = game.region || game.tags?.[0] || '';
  return region ? `${region} release for ${system.name}.` : `Catalog release for ${system.name}.`;
}

function factMarkup(items) {
  return items.filter(Boolean).map(item => `<span>${escapeHtml(item)}</span>`).join('');
}

const INPUT_LEGENDS = {
  pointer: [
    ['CLICK', 'Play'], ['i', 'Details'], ['☆', 'Favorite'], ['SCROLL', 'Browse'], ['/', 'Search']
  ],
  keyboard: [
    ['ENTER', 'Play'], ['ESC', 'Back'], ['ARROWS', 'Move'], ['/', 'Search'], ['CTRL+B', 'Systems']
  ],
  controller: [
    ['A', 'Select / play'], ['B', 'Back'], ['X', 'Surprise me'], ['Y', 'Setup'], ['START', 'Multiplayer'], ['D-PAD', 'Move']
  ]
};

function setInputMode(mode) {
  if (!INPUT_LEGENDS[mode]) return;
  if (state.inputMode === mode && document.body.dataset.inputMode === mode) return;
  state.inputMode = mode;
  document.body.dataset.inputMode = mode;
  document.body.classList.toggle('input-controller', mode === 'controller');
  document.body.classList.toggle('input-keyboard', mode === 'keyboard');
  document.body.classList.toggle('input-pointer', mode === 'pointer');
  const legend = $('#controlLegend');
  if (!legend) return;
  legend.dataset.mode = mode;
  legend.innerHTML = INPUT_LEGENDS[mode].map(([key, label]) => `<span><kbd>${key}</kbd> ${label}</span>`).join('');
}

function setLoading(active, title = 'Starting GameDeck', message = 'Checking your library and emulator setup.', progress = 8) {
  const stage = $('#appLoading');
  const steps = [
    $('#loadingStepLibrary'),
    $('#loadingStepLaunchers'),
    $('#loadingStepArtwork'),
    $('#loadingStepControls')
  ];
  const starts = [0, 32, 64, 88];
  clearTimeout(loadingHideTimer);

  const updateProgress = value => {
    const normalized = Math.min(100, Math.max(0, Number(value || 0)));
    const activeIndex = normalized >= 100 ? steps.length - 1 : starts.reduce((index, threshold, candidate) => normalized >= threshold ? candidate : index, 0);
    steps.forEach((step, index) => {
      const done = normalized >= (starts[index + 1] ?? 100);
      step.classList.toggle('done', done || normalized >= 100);
      step.classList.toggle('active', normalized < 100 && index === activeIndex);
    });
    $('#loadingBar').style.width = normalized + '%';
    $('#loadingPercent').textContent = Math.round(normalized) + '%';
    $('#loadingPhase').textContent = normalized >= 100 ? 'READY' : 'STEP ' + (activeIndex + 1) + ' OF ' + steps.length;
    $('#loadingTrack').setAttribute('aria-valuenow', String(Math.round(normalized)));
    $('#loadingTrack').setAttribute('aria-valuetext', normalized >= 100 ? 'GameDeck ready' : title);
  };

  if (!active) {
    updateProgress(100);
    $('#loadingTitle').textContent = 'Your deck is ready';
    const gameCount = Number(state.library?.games?.length || 0);
    $('#loadingMessage').textContent = gameCount
      ? gameCount.toLocaleString() + ' game' + (gameCount === 1 ? '' : 's') + ' organized and ready to browse.'
      : 'Library controls are ready. Add games or open Discover whenever you are ready.';
    stage.classList.add('ready');
    loadingHideTimer = setTimeout(() => {
      stage.classList.add('complete');
      setTimeout(() => {
        stage.classList.add('hidden');
        document.body.classList.remove('is-loading');
      }, 340);
    }, 260);
    return;
  }

  stage.classList.remove('hidden', 'complete', 'ready');
  document.body.classList.add('is-loading');
  $('#loadingTitle').textContent = title;
  $('#loadingMessage').textContent = message;
  updateProgress(progress);
}


function renderCatalogSkeleton(system) {
  $('#catalogGames').setAttribute('aria-busy', 'true');
  $('#catalogGames').innerHTML = Array.from({ length: 8 }, (_, index) => `<article class="catalog-game catalog-skeleton" aria-hidden="true"><div class="catalog-media skeleton-block"><span></span></div><div class="catalog-info"><b class="skeleton-line wide"></b><small class="skeleton-line"></small><p class="skeleton-line short"></p></div></article>`).join('');
  $('#catalogFeature').classList.remove('hidden');
  $('#catalogFeature').classList.add('feature-loading');
  $('#catalogFeatureSystem').textContent = `${system.name.toUpperCase()} / LOADING`;
  $('#catalogFeatureTitle').textContent = 'Opening the catalog…';
  $('#catalogFeatureFacts').innerHTML = factMarkup(['Reading titles', 'Matching artwork']);
  $('#catalogFeatureDescription').textContent = `Preparing the ${system.name} collection and checking which games are already installed.`;
  $('#catalogFeatureMeta').textContent = 'This usually takes only a moment.';
}

function queueGameDetails(title, systemId, context, apply) {
  const key = detailKey(title, systemId);
  const cached = state.gameDetails.get(key);
  if (cached) {
    apply(cached);
    return;
  }
  clearTimeout(detailTimer);
  detailTimer = setTimeout(async () => {
    if (state.detailLoading.has(key)) return;
    state.detailLoading.add(key);
    try {
      const details = await window.deck.gameDetails(title, systemId, context);
      if (!details) return;
      state.gameDetails.set(key, details);
      apply(details);
    } finally {
      state.detailLoading.delete(key);
    }
  }, 260);
}

function downloadForGame(game) {
  const identity = fileTaskIdentity(game?.fileName);
  return state.downloads.find(download => fileTaskIdentity(download.fileName) === identity && ['running', 'paused'].includes(download.status));
}

function transferGame(download) {
  return state.catalogGames.find(item => fileTaskIdentity(item.fileName) === fileTaskIdentity(download.fileName))
    || state.library.games.find(item => item.title === download.title || fileTaskIdentity(item.file) === fileTaskIdentity(download.fileName));
}

function openTransferResult(download) {
  if (!download) return;
  if (download.status === 'error') {
    state.activityFilter = 'issues';
    openConsole(true);
    setTimeout(renderActivity, 80);
    return;
  }
  const game = transferGame(download);
  if (game?.file) {
    state.selectedSystem = game.system;
    changeView('home');
    setFocusedGame(game, { scroll: true });
    toast(`${game.title} is ready in your library`, 'success');
    return;
  }
  window.deck.openLibrary();
}

async function handleTransferControl(action, id) {
  const download = state.downloads.find(item => item.id === id);
  if (!download) return;
  try {
    if (action === 'pause') {
      const result = await window.deck.pauseDownload(id);
      if (!result?.ok) throw Error(result?.error || 'Transfer could not be paused.');
      toast('Download paused. Progress is saved.');
    } else if (action === 'resume') {
      const result = await window.deck.retryDownload(id);
      if (!result?.ok) throw Error(result?.error || 'Transfer could not be resumed.');
      state.transferExpanded = true;
      toast('Resuming from saved progress…', 'progress');
    } else if (action === 'dismiss') {
      const result = await window.deck.dismissDownload(id);
      if (!result?.ok) throw Error(result?.error || 'Transfer could not be dismissed.');
      state.downloads = state.downloads.filter(item => item.id !== id);
      state.dismissedDownloads.delete(id);
      renderDownloads();
    }
  } catch (error) {
    toast(error.message || 'Transfer action failed.', 'warning');
  }
}

function renderDownloads() {
  const now = Date.now();
  const downloads = state.downloads
    .filter(download => {
      if (download.status !== 'running' && state.dismissedDownloads.has(download.id)) return false;
      if (['running', 'paused', 'error'].includes(download.status)) return true;
      return now - Number(download.finishedAt || now) < 14000;
    })
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  const running = downloads.filter(download => download.status === 'running');
  const paused = downloads.filter(download => download.status === 'paused');
  const finished = downloads.filter(download => ['complete', 'error'].includes(download.status));
  const dock = $('#transferDock');
  updateStatusBadge();
  if (!downloads.length) {
    dock.classList.add('hidden');
    $('#transferActions').classList.add('hidden');
    return;
  }

  const primary = running[0] || paused[0] || downloads[0];
  const average = running.length
    ? Math.round(running.reduce((sum, download) => sum + Number(download.progress || 0), 0) / running.length)
    : Math.round(Number(primary.progress || 0));
  const progress = Math.min(100, Math.max(0, average));
  const speed = primary.speed || '';
  const eta = etaLabel(primary);
  const transferred = primary.totalBytes ? `${transferSize(primary.downloadedBytes)} of ${transferSize(primary.totalBytes)}` : '';
  const runningDetail = [transferred, speed, eta].filter(Boolean).join(' · ') || primary.message || 'Preparing transfer.';
  const detail = primary.status === 'complete'
    ? primary.message || 'Added to your library and ready to play.'
    : primary.status === 'paused'
      ? primary.message || 'Progress is saved. Resume whenever you are ready.'
      : primary.status === 'error'
        ? primary.error || primary.message || 'Resume to retry from saved progress.'
        : runningDetail;

  const dockState = primary.status === 'error' ? 'error' : primary.status === 'paused' ? 'paused' : running.length ? 'running' : 'complete';
  dock.classList.remove('running', 'complete', 'error', 'paused');
  dock.classList.add(dockState);
  $('#transferGlyph').textContent = dockState === 'complete' ? '✓' : dockState === 'error' ? '!' : dockState === 'paused' ? 'Ⅱ' : '↓';
  $('#transferKicker').textContent = running.length > 1
    ? `${running.length} ACTIVE DOWNLOADS`
    : primary.status === 'complete'
      ? 'READY FOR YOUR LIBRARY'
      : primary.status === 'paused'
        ? 'DOWNLOAD PAUSED'
        : primary.status === 'error'
          ? 'DOWNLOAD CAN RESUME'
          : String(primary.stage || 'DOWNLOADING').toUpperCase();
  $('#transferTitle').textContent = running.length > 1 ? `${running.length} downloads are active` : primary.title;
  $('#transferDetail').textContent = detail;
  $('#transferPercent').textContent = primary.status === 'error' ? 'RETRY' : primary.status === 'paused' ? 'RESUME' : primary.status === 'complete' ? 'READY' : `${progress}%`;
  $('#transferBar').style.width = `${primary.status === 'complete' ? 100 : progress}%`;
  $('.transfer-meter').classList.toggle('indeterminate', primary.status === 'running' && progress === 0);
  $('#transferSummary').setAttribute('aria-expanded', String(state.transferExpanded));
  $('#transferSummary').setAttribute('aria-label', `${$('#transferKicker').textContent}: ${primary.title}. ${detail}`);
  dock.classList.toggle('expanded', state.transferExpanded);
  dock.classList.remove('hidden');

  $('#transferPanel').innerHTML = downloads.map(download => {
    const game = transferGame(download);
    const art = game?.art || assetFallback(download.title, '#263347', '#10141c', download.systemName || 'TRANSFER');
    const itemProgress = Math.min(100, Math.max(0, Number(download.progress || 0)));
    const itemDetail = [download.systemName, download.speed, etaLabel(download)].filter(Boolean).join(' · ') || download.error || download.message || '';
    const stage = download.status === 'complete' ? 'Ready' : download.status === 'paused' ? 'Paused · progress saved' : download.status === 'error' ? 'Ready to retry' : download.stage || 'Downloading';
    const value = download.status === 'error' ? 'RETRY' : download.status === 'paused' ? 'PAUSED' : download.status === 'complete' ? 'READY' : `${Math.round(itemProgress)}%`;
    const controls = [
      download.status === 'running' ? `<button type="button" class="transfer-control" data-transfer-action="pause" data-download-id="${escapeHtml(download.id)}">Pause</button>` : '',
      ['paused', 'error'].includes(download.status) && download.resumable ? `<button type="button" class="transfer-control primary" data-transfer-action="resume" data-download-id="${escapeHtml(download.id)}">Resume</button>` : '',
      ['complete', 'error'].includes(download.status) ? `<button type="button" class="transfer-control quiet" data-transfer-action="dismiss" data-download-id="${escapeHtml(download.id)}">Dismiss</button>` : ''
    ].filter(Boolean).join('');
    const actionable = download.status === 'complete';
    return `<article class="transfer-item ${escapeHtml(download.status)} ${actionable ? 'actionable' : ''}" data-download-id="${escapeHtml(download.id)}" ${actionable ? 'tabindex="0" role="button"' : ''}><img src="${escapeHtml(art)}" alt=""><div class="transfer-item-copy"><div><b title="${escapeHtml(download.title)}">${escapeHtml(download.title)}</b><span>${escapeHtml(stage)}</span></div><small>${escapeHtml(itemDetail)}</small><div class="transfer-item-track ${download.status === 'running' && itemProgress === 0 ? 'indeterminate' : ''}"><span style="width:${download.status === 'complete' ? 100 : itemProgress}%"></span></div></div><div class="transfer-item-end"><strong>${value}</strong><div class="transfer-item-controls">${controls}</div></div></article>`;
  }).join('');
  $('#transferPanel').classList.toggle('hidden', !state.transferExpanded);
  $('#transferActions').classList.toggle('hidden', !state.transferExpanded || finished.length === 0);
  $('#transferDismissFinished').textContent = finished.length === 1 ? 'Dismiss finished' : `Dismiss ${finished.length} finished`;

  document.querySelectorAll('.transfer-control').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      handleTransferControl(button.dataset.transferAction, button.dataset.downloadId);
    };
  });
  document.querySelectorAll('.transfer-item.actionable').forEach(item => {
    const activate = () => openTransferResult(downloads.find(download => download.id === item.dataset.downloadId));
    item.onclick = activate;
    item.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    };
  });

  clearTimeout(transferHideTimer);
  if (!running.length && !paused.length && !downloads.some(download => download.status === 'error')) {
    transferHideTimer = setTimeout(renderDownloads, 15000);
  }
}

function assetFallback(text, colorA = '#1b2233', colorB = '#0f131a', label = 'GAMEDECK') {
  const raw = String(text || 'GAME').replace(/\s+/g, ' ').trim();
  const words = raw.split(' ');
  const lines = ['', ''];
  for (const word of words) {
    const slot = lines[0].length < 18 ? 0 : 1;
    const candidate = `${lines[slot]} ${word}`.trim();
    if (slot === 0 && candidate.length > 18 && lines[0]) lines[1] = word;
    else lines[slot] = candidate;
  }
  if (!lines[1] && lines[0].length > 18) {
    lines[1] = lines[0].slice(18).trim();
    lines[0] = lines[0].slice(0, 18).trim();
  }
  lines[0] = lines[0].slice(0, 22);
  lines[1] = lines[1].slice(0, 22);
  const xml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lineOne = xml(lines[0] || 'GAME');
  const lineTwo = xml(lines[1]);
  const systemLabel = xml(String(label || 'GAMEDECK').toUpperCase().slice(0, 28));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset=".58" stop-color="${colorB}"/><stop offset="1" stop-color="#070b12"/></linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#72e7ff"/><stop offset="1" stop-color="#c8ff52"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#72e7ff" stop-opacity=".28"/><stop offset="1" stop-color="#72e7ff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="600" height="900" rx="36" fill="url(#bg)"/>
    <circle cx="492" cy="126" r="260" fill="url(#glow)"/>
    <g fill="none" stroke="rgba(255,255,255,.09)"><path d="M-80 605 680 274"/><path d="M-80 655 680 324"/><path d="M-80 705 680 374"/></g>
    <rect x="38" y="38" width="524" height="824" rx="26" fill="none" stroke="rgba(255,255,255,.12)"/>
    <rect x="38" y="38" width="166" height="5" rx="3" fill="url(#edge)"/>
    <g transform="translate(52 78)"><circle cx="28" cy="28" r="27" fill="rgba(6,12,20,.66)" stroke="rgba(114,231,255,.52)"/><path d="M14 30c0-12 8-20 20-20 7 0 13 2 18 7l-8 8c-3-3-6-4-10-4-6 0-10 4-10 10s4 10 11 10c3 0 6-1 8-2v-5h-10v-9h21v20c-5 5-12 8-20 8-12 0-20-8-20-23Z" fill="#dffbff"/></g>
    <text x="126" y="95" fill="rgba(255,255,255,.82)" font-family="Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="4">GAMEDECK ORIGINAL</text>
    <text x="126" y="124" fill="rgba(255,255,255,.45)" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="3">${systemLabel}</text>
    <text x="52" y="684" fill="#f4f8ff" font-family="Arial,sans-serif" font-size="48" font-weight="700">${lineOne}</text>
    ${lineTwo ? `<text x="52" y="744" fill="#f4f8ff" font-family="Arial,sans-serif" font-size="48" font-weight="700">${lineTwo}</text>` : ''}
    <text x="52" y="815" fill="rgba(255,255,255,.52)" font-family="Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="4">LOCAL COLLECTION · PLAYER OWNED</text>
    <circle cx="524" cy="809" r="13" fill="#c8ff52"/><circle cx="490" cy="809" r="13" fill="#72e7ff"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function systemById(id) {
  return state.library.systems.find(system => system.id === id);
}

function systemStatusLabel(system) {
  if (Number(system?.count || 0) === 0) return system?.ready ? 'NO GAMES' : 'SETUP';
  return system?.ready ? 'READY' : 'SETUP';
}

function isArcadeId(id) {
  return id === 'arcade' || id === 'mame';
}

function arcadeSelected() {
  return isArcadeId(state.selectedSystem) && !['discover', 'community'].includes(state.view);
}

function gameLaunchBlocked(game) {
  return Boolean(game && ['damaged', 'incomplete'].includes(game.archiveHealth) && !game.autoRepair);
}

function arcadeHealthLabel(game) {
  if (game.autoRepair && ['damaged', 'incomplete'].includes(game.archiveHealth)) return 'AUTO REPAIR';
  if (game.archiveHealth === 'verified') return game.system === 'mame' ? 'ROM SET VERIFIED' : 'ARCHIVE VERIFIED';
  if (game.archiveHealth === 'damaged') return 'DAMAGED ARCHIVE';
  if (game.archiveHealth === 'incomplete') return 'ROMSET INCOMPLETE';
  if (game.archiveHealth === 'repairable') return 'AUTO SETUP';
  return 'CHECK PENDING';
}

function arcadeHealthClass(game) {
  if (game.autoRepair && ['damaged', 'incomplete'].includes(game.archiveHealth)) return 'repairable';
  if (game.archiveHealth === 'verified') return 'verified';
  if (gameLaunchBlocked(game)) return 'attention';
  if (game.archiveHealth === 'repairable') return 'repairable';
  return 'checking';
}

function gameArt(game) {
  const system = systemById(game.system);
  return game.art || assetFallback(game.title, system?.color || '#24334b', '#101722', system?.short || system?.name || 'GAMEDECK');
}

function systemNeedsFirmware(system) {
  return Boolean(system && !system.ready && String(system.issue || '').toLowerCase().includes('firmware'));
}

function currentGames() {
  let games = [...state.library.games];
  if (state.selectedSystem !== 'all') games = games.filter(game => game.system === state.selectedSystem);
  if (state.view === 'favorites') games = games.filter(game => game.favorite);
  if (state.view === 'recent') games = games.filter(game => game.lastPlayed);
  if (state.query) games = games.filter(game => game.title.toLowerCase().includes(state.query) || String(game.shortName || '').toLowerCase().includes(state.query));
  if (state.artworkFilter === 'missing-art') games = games.filter(game => !game.art);
  if (arcadeSelected() && state.arcadeFilter === 'verified') games = games.filter(game => game.archiveHealth === 'verified');
  if (arcadeSelected() && state.arcadeFilter === 'attention') games = games.filter(game => gameLaunchBlocked(game));

  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  if (state.view === 'recent' || state.sort === 'recent') games.sort((a, b) => Number(b.lastPlayed || 0) - Number(a.lastPlayed || 0) || byTitle(a, b));
  else if (state.sort === 'system') games.sort((a, b) => (systemById(a.system)?.name || '').localeCompare(systemById(b.system)?.name || '') || byTitle(a, b));
  else if (state.sort === 'size') games.sort((a, b) => Number(b.size || 0) - Number(a.size || 0) || byTitle(a, b));
  else games.sort(byTitle);
  return games;
}

function filteredCatalogGames() {
  const query = state.catalogQuery;
  return state.catalogGames.filter(game => {
    const installed = Boolean(game.installedFile);
    const ready = installed && game.installedReady !== false;
    if (state.catalogFilter === 'available' && installed) return false;
    if (state.catalogFilter === 'downloaded' && (!installed || ready)) return false;
    if (state.catalogFilter === 'installed' && !ready) return false;
    if (!query) return true;
    const haystack = [game.name, game.fileName, game.region, ...(game.tags || [])].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function currentCatalogGames() {
  return filteredCatalogGames().slice(0, state.catalogLimit);
}

function focusedGame() {
  return currentGames().find(game => game.id === state.focusedGameId) || null;
}

function focusedCatalogGame() {
  return currentCatalogGames().find(game => game.id === state.focusedCatalogId) || null;
}

function catalogTaskKey(game) {
  return `${state.catalogSystem?.id || 'none'}:${game.id}`;
}

function setControllerStatus() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad = pads[0];
  const paired = !pad && state.controllerHints.length > 0;
  const pill = $('#controllerStatus');
  pill.textContent = pad ? `${String(pad.id || 'Controller').split('(')[0].trim().slice(0, 25)} connected` : paired ? 'Xbox paired · press a button' : 'No controller';
  pill.classList.toggle('connected', Boolean(pad));
  pill.classList.toggle('paired', paired);
  const panel = $('.arcade-controller');
  if (!panel) return;
  panel.classList.toggle('connected', Boolean(pad));
  panel.classList.toggle('paired', paired);
  $('#arcadeControllerState').textContent = pad ? (pad.mapping === 'standard' ? 'Xbox layout ready' : 'Controller detected') : paired ? 'Xbox paired — wake to play' : 'Waiting for controller';
  const controllerCount = pad ? pads.length : paired ? state.controllerHints.length : 0;
  window.GameDeckInputStatus = Object.freeze({ activeControllers: pads.length, pairedControllers: paired ? state.controllerHints.length : 0, effectiveControllers: controllerCount, label: pad ? 'connected' : paired ? 'paired' : 'none' });
  $('#arcadeControllerCount').textContent = `${controllerCount} ${pad ? (controllerCount === 1 ? 'PAD' : 'PADS') : paired ? 'PAIRED' : 'PADS'}`;
  $('#arcadeControllerDetail').textContent = pad
    ? `${String(pad.id || 'Controller').split('(')[0].trim().slice(0, 36)} · D-pad and left stick enabled for arcade movement.`
    : paired
      ? `${state.controllerHints[0]} is available. Press any button so the app can claim the active gamepad slot.`
      : 'Connect an Xbox controller, then use either the D-pad or left stick.';
}

function applyArcadeAudit(snapshot) {
  if (!snapshot) return;
  state.arcadeAudit = snapshot;
  const entries = new Map((snapshot.items || []).map(item => [item.file, item]));
  for (const game of state.library.games) {
    const entry = entries.get(game.file);
    if (!entry) continue;
    game.archiveHealth = entry.status;
    game.archiveHealthMessage = entry.message;
  }
}

function renderArcadeDeck() {
  const deck = $('#arcadeDeck');
  if (!deck) return;
  const visible = arcadeSelected();
  deck.classList.toggle('hidden', !visible);
  if (!visible) return;

  const games = state.library.games.filter(game => game.system === state.selectedSystem);
  const verified = games.filter(game => game.archiveHealth === 'verified').length;
  const attention = games.filter(game => ['damaged', 'incomplete', 'repairable'].includes(game.archiveHealth)).length;
  const unchecked = games.filter(game => !game.archiveHealth || game.archiveHealth === 'unchecked').length;
  const artwork = games.length ? Math.round((games.filter(game => game.art).length / games.length) * 100) : 0;
  const progress = state.arcadeAuditProgress;

  $('#arcadeTotal').textContent = games.length.toLocaleString();
  $('#arcadeVerified').textContent = verified.toLocaleString();
  $('#arcadeAttention').textContent = attention.toLocaleString();
  $('#arcadeArtwork').textContent = `${artwork}%`;
  $('#arcadeHealthState').textContent = progress.running
    ? `Checking ${progress.current || 'your arcade library'}…`
    : attention
      ? `${attention} set${attention === 1 ? '' : 's'} need attention. Launch is blocked only where the archive or ROM set is unsafe.`
      : unchecked
        ? `${unchecked} set${unchecked === 1 ? '' : 's'} still need an integrity check.`
        : games.length
          ? `All ${games.length} set${games.length === 1 ? '' : 's'} passed the available integrity checks.`
          : 'Add legally owned ZIP or 7Z sets to this system folder to begin.';

  const progressPanel = $('#arcadeAuditProgress');
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  progressPanel.classList.toggle('hidden', !progress.running);
  progressPanel.setAttribute('aria-valuenow', String(percent));
  $('#arcadeAuditBar').style.width = `${percent}%`;
  $('#arcadeAuditCopy').textContent = progress.total
    ? `${progress.done} of ${progress.total} archives checked${progress.current ? ` · ${progress.current}` : ''}`
    : 'Reading cached arcade health…';
  $('#arcadeAuditButton').disabled = Boolean(progress.running);
  $('#arcadeAuditButton').textContent = progress.running ? `Scanning ${percent}%` : 'Scan ROM-set health';

  $$('[data-arcade-filter]').forEach(button => {
    const active = button.dataset.arcadeFilter === state.arcadeFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  setControllerStatus();
}

async function refreshArcadeAudit(force = false) {
  const hasArcade = state.library.games.some(game => isArcadeId(game.system));
  if (!hasArcade) return;
  state.arcadeAuditProgress = { running: true, done: 0, total: 0, current: '' };
  renderArcadeDeck();
  try {
    const snapshot = await window.deck.arcadeAudit(force);
    applyArcadeAudit(snapshot);
    state.library.games.filter(game => isArcadeId(game.system) && !game.art).reverse().forEach(game => requestArtwork(game, true));
    state.arcadeAuditProgress = { running: false, done: snapshot.total, total: snapshot.total, current: '' };
    render();
  } catch (error) {
    state.arcadeAuditProgress = { running: false, done: 0, total: 0, current: '' };
    toast(error.message || 'Arcade health scan could not finish');
    renderArcadeDeck();
  }
}

function updateGameArtwork(game, url) {
  if (!url) return;
  game.art = url;
  $$(`[data-game-art="${game.id}"]`).forEach(image => { image.src = url; });
  const card = document.querySelector(`.game[data-id="${game.id}"]`);
  card?.classList.remove('missing-art');
  card?.classList.add('has-art');
  card?.querySelector('.art-status')?.remove();
  if (state.focusedGameId === game.id) {
    applySystemTheme(game.system);
    applySpotlightArtwork(game);
  }
  if (state.artworkFilter === 'missing-art' && !['discover', 'community'].includes(state.view)) renderGames();
  else renderSetupCoach();
  renderDownloads();
  if (arcadeSelected()) renderArcadeDeck();
}

function queueArtwork(key, work, priority = false) {
  if (state.artworkLoading.has(key)) {
    if (priority) {
      const index = artworkQueue.findIndex(item => item.key === key);
      if (index > 0) artworkQueue.unshift(...artworkQueue.splice(index, 1));
    }
    return;
  }
  state.artworkLoading.add(key);
  if (priority) artworkQueue.unshift({ key, work });
  else artworkQueue.push({ key, work });
  pumpArtworkQueue();
}

function pumpArtworkQueue() {
  while (artworkActive < 3 && artworkQueue.length) {
    const item = artworkQueue.shift();
    artworkActive += 1;
    Promise.resolve(item.work()).finally(() => {
      artworkActive -= 1;
      state.artworkLoading.delete(item.key);
      pumpArtworkQueue();
    });
  }
}

function markGeneratedArtwork(game) {
  const card = document.querySelector(`.game[data-id="${game.id}"]`);
  const status = card?.querySelector('.art-status');
  if (status) {
    status.textContent = 'GAMEDECK ART';
    status.classList.remove('matching');
    status.classList.add('generated');
  }
}

function requestArtwork(game, priority = false) {
  if (!game || game.art) return;
  const key = `library:${game.id}`;
  queueArtwork(key, async () => {
    const url = await window.deck.artwork(game.artworkTitle || game.title, game.system, game.artworkFolder || '');
    if (url) updateGameArtwork(game, url);
    else markGeneratedArtwork(game);
  }, priority);
}

function artworkEnrichmentScore(game) {
  let score = 0;
  if (game.system === state.selectedSystem) score += 30;
  if (game.favorite) score += 20;
  if (game.lastPlayed) score += 10;
  if (state.focusedGameId === game.id) score += 40;
  return score;
}

function scheduleArtworkEnrichment(delay = 3200) {
  clearTimeout(artworkEnrichmentTimer);
  if (requestedCaptureView) return;
  artworkEnrichmentTimer = setTimeout(enrichNextArtwork, delay);
}

function enrichNextArtwork() {
  clearTimeout(artworkEnrichmentTimer);
  if (requestedCaptureView) return;
  if (document.hidden || state.downloads.some(download => download.status === 'running')) {
    artworkEnrichmentTimer = setTimeout(enrichNextArtwork, 3500);
    return;
  }
  const game = state.library.games
    .filter(item => !item.art && !artworkEnrichmentTried.has(item.id) && !state.artworkLoading.has(`library:${item.id}`))
    .sort((a, b) => artworkEnrichmentScore(b) - artworkEnrichmentScore(a) || a.title.localeCompare(b.title))[0];
  if (!game) return;
  artworkEnrichmentTried.add(game.id);
  requestArtwork(game);
  artworkEnrichmentTimer = setTimeout(enrichNextArtwork, 1400);
}

function updateCatalogArtwork(game, url) {
  if (!url) return;
  game.art = url;
  $$(`[data-catalog-art="${game.id}"]`).forEach(image => { image.src = url; });
  document.querySelector(`.catalog-game[data-id="${game.id}"]`)?.classList.remove('art-pending');
  document.querySelector(`.catalog-game[data-id="${game.id}"]`)?.classList.add('has-art');
  const isFeatured = state.focusedCatalogId === game.id || (state.focusedCatalogId == null && currentCatalogGames()[0]?.id === game.id);
  if (isFeatured) {
    $('#catalogFeatureArt').innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(game.name)} cover">`;
    $('#catalogFeatureBackdrop').src = url;
  }
  renderDownloads();
}

function requestCatalogArtwork(game) {
  if (!game || game.art || !state.catalogSystem?.systemId) return;
  const key = `catalog:${state.catalogSystem.id}:${game.id}`;
  const system = state.catalogSystem;
  queueArtwork(key, async () => {
    const url = await window.deck.artwork(game.fileName || game.name, system.systemId, system.folder);
    updateCatalogArtwork(game, url);
  });
}

function observeVisibleArtwork() {
  artworkObserver?.disconnect();
  artworkObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      if (image.dataset.gameArt) {
        requestArtwork(state.library.games.find(game => game.id === image.dataset.gameArt));
      } else if (image.dataset.catalogArt) {
        requestCatalogArtwork(state.catalogGames.find(game => game.id === Number(image.dataset.catalogArt)));
      }
      artworkObserver.unobserve(image);
    }
  }, { root: $('.content'), rootMargin: '320px 0px' });
  $$('[data-game-art], [data-catalog-art]').forEach(image => artworkObserver.observe(image));
}

function gameMetadataTitle(game) {
  return game?.metadataTitle || game?.title || game?.artworkTitle || '';
}

function gameDetailsContext(game) {
  const system = systemById(game?.system);
  return { name: game?.title, systemName: system?.name, shortName: game?.shortName, file: game?.file, edition: game?.edition, region: game?.region, installed: true };
}

function setSpotlightActionLabel(id, label) {
  const button = $(id);
  if (!button) return;
  const target = button.querySelector('b');
  if (target) target.textContent = label;
  else button.textContent = label;
}

function applySpotlightArtwork(game) {
  if (!game) return;
  const art = gameArt(game);
  $('#spotlightArt').innerHTML = `<div class="spotlight-art-ambient" aria-hidden="true"><img src="${escapeHtml(art)}" alt=""></div><img class="spotlight-art-main" src="${escapeHtml(art)}" alt="${escapeHtml(game.title)} cover">`;
  const backdrop = $('#spotlightBackdrop');
  if (!backdrop) return;
  backdrop.classList.remove('is-ready');
  backdrop.onload = () => backdrop.classList.add('is-ready');
  backdrop.src = art;
  if (backdrop.complete) backdrop.classList.add('is-ready');
}

function openGameDetails(game) {
  if (!game || state.playSession?.active) return;
  gameDetailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setFocusedGame(game);
  const spotlight = $('#spotlight');
  if (!spotlight) return;
  clearTimeout(gameDetailHideTimer);
  spotlight.classList.remove('hidden');
  spotlight.setAttribute('aria-hidden', 'false');
  document.body.classList.add('game-detail-open', 'modal-open');
  requestAnimationFrame(() => {
    spotlight.classList.add('is-open');
    $('#spotlightPlay')?.focus({ preventScroll: true });
  });
  pulseUiHaptic('confirm', { force: true });
}

function closeGameDetails(options = {}) {
  const spotlight = $('#spotlight');
  if (!spotlight || (!document.body.classList.contains('game-detail-open') && spotlight.classList.contains('hidden'))) return false;
  clearTimeout(gameDetailHideTimer);
  spotlight.classList.remove('is-open');
  spotlight.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('game-detail-open', 'modal-open');
  gameDetailHideTimer = setTimeout(() => spotlight.classList.add('hidden'), options.immediate ? 0 : 220);
  if (options.restoreFocus !== false) {
    const target = gameDetailReturnFocus;
    requestAnimationFrame(() => target?.isConnected && target.focus?.({ preventScroll: true }));
  }
  gameDetailReturnFocus = null;
  return true;
}

async function shareFocusedGame() {
  const game = focusedGame();
  if (!game) return;
  const system = systemById(game.system);
  const text = `${game.title} on ${system?.name || 'GameDeck'} — ready to play in GameDeck.`;
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: game.title, text });
      toast('Share sheet opened', 'success');
      return;
    }
    await window.deck.copyText(text);
    toast('Game share text copied', 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Could not share this game', 'warning');
  }
}

function applyFocusedDetails(game, details) {
  if (!game || state.focusedGameId !== game.id || !details) return;
  const system = systemById(game.system);
  const fallback = fallbackDescription(game.title, system?.name || 'this console', true);
  $('#spotlightDescription').textContent = details.description || fallback;
  $('#spotlightFacts').innerHTML = factMarkup([details.year, details.genre, details.players && (details.players + ' player' + (details.players === '1' ? '' : 's')), details.developer || details.manufacturer, details.publisher]);
  $('#spotlightSource').textContent = String(details.source || 'GameDeck').toUpperCase();
  $('#spotlight').classList.remove('details-loading');
}

function shelfMemoryKey(view = state.view, system = state.selectedSystem) {
  return view === 'home' ? 'home:' + system : view;
}

function rememberShelfPosition() {
  const content = $('.content');
  if (!content || ['discover', 'community'].includes(state.view)) return;
  const key = shelfMemoryKey();
  state.shelfMemory[key] = {
    ...(state.shelfMemory[key] || {}),
    scrollTop: content.scrollTop,
    focusedGameId: state.focusedGameId
  };
}

function prepareRememberedShelf() {
  const remembered = state.shelfMemory[shelfMemoryKey()];
  state.focusedGameId = remembered?.focusedGameId || null;
}

function restoreShelfPosition() {
  const remembered = state.shelfMemory[shelfMemoryKey()];
  requestAnimationFrame(() => {
    const content = $('.content');
    if (!content) return;
    content.scrollTop = Number(remembered?.scrollTop || 0);
    updateScrollChrome(content);
  });
}

function setFocusedGame(game, options = {}) {
  state.focusedGameId = game?.id ?? null;
  if (game && !['discover', 'community'].includes(state.view)) {
    const key = shelfMemoryKey();
    state.shelfMemory[key] = { ...(state.shelfMemory[key] || {}), focusedGameId: game.id };
  }
  state.libraryZone = 'games';
  $$('.game').forEach(card => {
    const active = card.dataset.id === state.focusedGameId;
    card.classList.toggle('active', active);
    card.setAttribute('aria-current', String(active));
  });
  $$('.system').forEach(button => button.classList.remove('controller-focus'));

  const spotlight = $('#spotlight');
  if (!game) {
    closeGameDetails({ restoreFocus: false, immediate: true });
    spotlight?.classList.add('hidden');
    return;
  }

  const system = systemById(game.system);
  const arcade = isArcadeId(game.system);
  const blocked = arcade && gameLaunchBlocked(game);
  const fallback = fallbackDescription(game.title, system?.name || 'this console', true);
  const cached = state.gameDetails.get(detailKey(gameMetadataTitle(game), game.system));
  spotlight.classList.toggle('details-loading', !cached);
  $('#spotlightSource').textContent = cached ? String(cached.source || 'GameDeck').toUpperCase() : 'MATCHING DETAILS';
  $('#spotlightSystem').textContent = system?.name || 'GameDeck';
  $('#spotlightTitle').textContent = game.title;
  $('#spotlightFacts').innerHTML = factMarkup([cached?.year, cached?.genre, cached?.players && `${cached.players} player${cached.players === '1' ? '' : 's'}`, cached?.developer || cached?.manufacturer, cached?.publisher]);
  $('#spotlightDescription').textContent = cached?.description || fallback;
  $('#spotlightMeta').textContent = blocked
    ? 'This game needs attention before it can launch.'
    : game.lastPlayed ? `Last played ${relative(game.lastPlayed)} · Ready to play inside GameDeck.` : 'Ready to play inside GameDeck.';
  $('#spotlightPlay').disabled = blocked;
  setSpotlightActionLabel('#spotlightPlay', blocked ? 'Check game' : 'Play now');
  setSpotlightActionLabel('#spotlightFav', game.favorite ? 'Favorited' : 'Favorite');
  $('#spotlightFav')?.classList.toggle('is-favorite', Boolean(game.favorite));
  applySystemTheme(game.system);
  applySpotlightArtwork(game);
  requestArtwork(game);
  queueGameDetails(gameMetadataTitle(game), game.system, gameDetailsContext(game), details => {
    applyFocusedDetails(game, details);
  });

  if (options.scroll) {
    const card = document.querySelector(`.game[data-id="${game.id}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

async function chooseFocusedArtwork() {
  const game = focusedGame();
  if (!game) return;
  const button = $('#spotlightArtwork');
  const label = button.querySelector('b');
  button.disabled = true;
  label.textContent = 'Choosing…';
  try {
    const result = await window.deck.chooseGameArtwork(game.file);
    if (result?.canceled) return;
    if (!result?.ok || !result.url) throw Error(result?.error || 'Artwork could not be saved');
    updateGameArtwork(game, result.url);
    setFocusedGame(game);
    toast('Custom artwork saved');
  } catch (error) {
    toast(error.message || 'Artwork could not be changed');
  } finally {
    button.disabled = false;
    label.textContent = 'Artwork';
  }
}

async function deleteFocusedGame() {
  const game = focusedGame();
  if (!game) return;
  const button = $('#spotlightDelete');
  const label = button.querySelector('b');
  button.disabled = true;
  label.textContent = 'Removing…';
  try {
    const result = await window.deck.deleteGame(game.file);
    if (result?.canceled) return;
    if (!result?.ok) throw Error(result?.error || 'The game could not be removed.');
    artworkEnrichmentTried.delete(game.id);
    state.focusedGameId = null;
    await loadLibrary(true);
    toast(`${result.title || game.title} moved to Trash`, 'success');
  } catch (error) {
    toast(error.message || 'The game could not be removed.', 'warning');
  } finally {
    button.disabled = false;
    label.textContent = 'Remove';
  }
}

async function refreshFocusedDetails() {
  const game = focusedGame();
  if (!game) return;
  const button = $('#spotlightDetails');
  const label = button.querySelector('b');
  button.disabled = true;
  label.textContent = 'Refreshing…';
  $('#spotlight').classList.add('details-loading');
  $('#spotlightSource').textContent = 'REFRESHING DETAILS';
  const key = detailKey(gameMetadataTitle(game), game.system);
  state.gameDetails.delete(key);
  try {
    const details = await window.deck.refreshGameDetails(gameMetadataTitle(game), game.system, gameDetailsContext(game));
    if (!details) throw Error('No details were returned');
    state.gameDetails.set(key, details);
    applyFocusedDetails(game, details);
    toast(details.source === 'GameDeck' ? 'Using local GameDeck details for now' : 'Details refreshed from ' + (details.source || 'metadata source'));
  } catch (error) {
    toast(error.message || 'Game details could not be refreshed');
  } finally {
    button.disabled = false;
    label.textContent = 'Refresh';
    $('#spotlight').classList.remove('details-loading');
  }
}

function renderSystems() {
  const allFocused = state.libraryZone === 'systems' && state.focusedLibrarySystem === 'all';
  const all = `<button type="button" class="system ${state.selectedSystem === 'all' ? 'active' : ''} ${allFocused ? 'controller-focus' : ''}" data-id="all" title="All games"><span class="sys-icon" style="--c:#c8ff52">ALL</span><span class="sys-copy"><b>All games</b><small>Full collection</small></span><span class="count">${state.library.games.length}</span></button>`;
  const systems = state.library.systems.map(system => {
    const focused = state.libraryZone === 'systems' && state.focusedLibrarySystem === system.id;
    const art = system.image ? `<img src="${escapeHtml(system.image)}" alt="">` : escapeHtml(system.icon);
    const installed = Number(system.installedCount ?? systemById(system.systemId)?.installedCount ?? 0);
    const total = Number(system.count || 0);
    const countLabel = installed > 0 ? `${installed}/${total}` : String(total);
    const title = system.issue ? `${system.name} — ${system.issue}` : system.name;
    const arcadeGames = isArcadeId(system.id) ? state.library.games.filter(game => game.system === system.id) : [];
    const arcadeAttention = arcadeGames.filter(game => ['damaged', 'incomplete', 'repairable'].includes(game.archiveHealth)).length;
    const status = isArcadeId(system.id) && arcadeGames.length
      ? (arcadeAttention ? `${arcadeAttention} SET${arcadeAttention === 1 ? '' : 'S'} TO CHECK` : `${arcadeGames.filter(game => game.archiveHealth === 'verified').length} PREFLIGHT OK`)
      : systemStatusLabel(system);
    return `<button type="button" class="system ${state.selectedSystem === system.id ? 'active' : ''} ${focused ? 'controller-focus' : ''}" data-id="${system.id}" title="${escapeHtml(title)}"><span class="sys-icon" style="--c:${system.color}">${art}</span><span class="sys-copy"><b>${escapeHtml(system.name)}</b><small>${escapeHtml(status)}</small></span><span class="count">${countLabel}</span></button>`;
  }).join('');
  $('#systems').innerHTML = all + systems;

  $$('.system').forEach(button => {
    button.onclick = () => { pulseUiHaptic('confirm', { force: true }); selectLibrarySystem(button.dataset.id); };
    button.onmouseenter = () => { state.focusedLibrarySystem = button.dataset.id; };
  });
}

function configureEmptyAction(button, label, action, hidden = false) {
  button.textContent = label;
  button.dataset.action = action;
  button.classList.toggle('hidden', hidden);
}

function renderEmptyState(games) {
  const empty = $('#empty');
  empty.classList.toggle('hidden', games.length > 0);
  if (games.length) return;

  const query = $('#search').value.trim();
  const selected = systemById(state.selectedSystem);
  let kicker = 'START YOUR COLLECTION';
  let title = 'Your deck is ready';
  let message = 'Add games you legally own to your GameDeck folder, or browse the optional Discover catalog.';
  let primary = ['Browse Discover', 'discover'];
  let secondary = ['Open game folder', 'folder'];

  if (query) {
    kicker = 'NO MATCHES';
    title = `Nothing found for “${query}”`;
    message = 'Try a shorter title, switch consoles, or clear the search to see the full shelf again.';
    primary = ['Clear search', 'clear-search'];
    secondary = ['Browse Discover', 'discover'];
  } else if (state.view === 'favorites') {
    kicker = 'YOUR SAVED SHELF';
    title = 'No favorites yet';
    message = 'Favorite any game from its card or spotlight and it will stay one move away here.';
    primary = ['Browse library', 'library'];
    secondary = ['Browse Discover', 'discover'];
  } else if (state.view === 'recent') {
    kicker = 'PLAY HISTORY';
    title = 'Nothing played yet';
    message = 'Launch a game from your library and GameDeck will keep your quickest route back here.';
    primary = ['Browse library', 'library'];
    secondary = ['Browse Discover', 'discover'];
  } else if (selected) {
    kicker = selected.name.toUpperCase();
    title = `No ${selected.name} games installed`;
    message = 'Add a legally owned title to this console folder, or browse Discover when a provider is connected.';
  }

  $('#emptyKicker').textContent = kicker;
  $('#emptyTitle').textContent = title;
  $('#emptyMessage').textContent = message;
  configureEmptyAction($('#emptyPrimary'), primary[0], primary[1]);
  configureEmptyAction($('#emptySecondary'), secondary[0], secondary[1]);
}

function runEmptyAction(action) {
  if (action === 'clear-search') {
    state.query = '';
    $('#search').value = '';
    render();
    $('#search').focus();
  } else if (action === 'library') {
    state.selectedSystem = 'all';
    changeView('home');
  } else if (action === 'discover') {
    changeView('discover');
  } else if (action === 'folder') {
    window.deck.openLibrary();
  }
}

function gameCardIcon(name) {
  const icons = {
    play: '<path d="M9 6.5 17 12l-8 5.5z"></path>',
    check: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v5M12 16.5v.1"></path>',
    favorite: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.6-.8z"></path>'
  };
  const key = Object.prototype.hasOwnProperty.call(icons, name) ? name : 'play';
  return `<svg class="game-card-icon icon-${key}" viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg>`;
}

function arcadeCardHealthLabel(game) {
  if (game.autoRepair && ['damaged', 'incomplete'].includes(game.archiveHealth)) return 'Auto repair';
  if (game.archiveHealth === 'verified') return 'Verified';
  if (game.archiveHealth === 'damaged') return 'Damaged';
  if (game.archiveHealth === 'incomplete') return 'Incomplete';
  if (game.archiveHealth === 'repairable') return 'Auto setup';
  return 'Checking';
}

function renderGames() {
  const games = currentGames();
  $('#resultCount').textContent = `${games.length.toLocaleString()} ${games.length === 1 ? 'game' : 'games'}`;
  $('#games').innerHTML = games.map((game, index) => {
    const system = systemById(game.system);
    const active = game.id === state.focusedGameId;
    const arcade = isArcadeId(game.system);
    const healthClass = arcadeHealthClass(game);
    const blocked = arcade && healthClass === 'attention';
    const repairable = arcade && healthClass === 'repairable';
    const artMissing = !game.art;
    const playable = Boolean(system?.ready) && !blocked;
    const stateClasses = [artMissing ? 'missing-art' : 'has-art', game.favorite ? 'is-favorite' : '', game.lastPlayed ? 'is-recent' : '', playable ? 'is-playable' : 'needs-setup'].filter(Boolean).join(' ');
    const playLabel = blocked ? 'Check' : 'Play';
    const playIcon = gameCardIcon(blocked ? 'check' : 'play');
    const subtitle = blocked ? 'Needs attention' : (system?.name || 'GameDeck');
    const artwork = escapeHtml(gameArt(game));
    const title = escapeHtml(game.title);
    return `<article class="game ${game.file === state.launchingFile ? 'launching' : ''} ${stateClasses} ${arcade ? 'arcade-card' : ''} ${blocked ? 'health-attention' : ''} ${repairable ? 'health-repairable' : ''} ${active ? 'active' : ''}" style="--delay:${Math.min(index, 14) * 18}ms" tabindex="0" role="button" aria-current="${active}" aria-label="Play ${title} on ${escapeHtml(system?.name || 'GameDeck')}" data-id="${game.id}"><div class="aurora-shell" style="--c:${system?.color || '#8992a3'}"><div class="cover game-card-launch"><div class="cover-ambient" aria-hidden="true"><img src="${artwork}" alt="" loading="lazy" decoding="async"></div><div class="cover-art"><img data-game-art="${game.id}" src="${artwork}" alt="${title} artwork" loading="lazy" decoding="async"></div></div></div><div class="meta"><div class="game-card-heading"><div class="game-title" title="${title}"><span class="game-title-text">${title}</span></div><div class="game-card-tools"><button type="button" class="details" aria-haspopup="dialog" aria-label="View details for ${title}"><span aria-hidden="true">i</span></button><button type="button" class="fav ${game.favorite ? 'on' : ''}" aria-label="${game.favorite ? 'Remove favorite' : 'Add favorite'}">${gameCardIcon('favorite')}</button></div></div><div class="game-card-footer"><span class="game-card-subtitle ${blocked ? 'attention' : ''}"><i style="--system-color:${blocked ? '#ff9b76' : system?.color || '#8992a3'}" aria-hidden="true"></i>${escapeHtml(subtitle)}</span><button type="button" class="play" aria-label="${blocked ? 'Game needs attention before it can play' : `Play ${title}`}" ${blocked ? 'disabled' : ''}>${playIcon}<span>${playLabel}</span></button></div></div></article>`;
  }).join('');

  renderEmptyState(games);
  $$('.game').forEach(card => {
    const game = games.find(item => item.id === card.dataset.id);
    const playGame = event => {
      event?.stopPropagation();
      setFocusedGame(game);
      if (gameLaunchBlocked(game)) {
        toast('This game needs attention before it can play.', 'warning');
        return;
      }
      pulseUiHaptic('confirm', { force: true });
      launch(game.file);
    };
    card.onmouseenter = () => setFocusedGame(game);
    card.onfocus = () => setFocusedGame(game);
    card.onclick = event => {
      if (event.target.closest('.details, .fav, .play')) return;
      playGame(event);
    };
    card.onkeydown = event => {
      if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      playGame(event);
    };
    card.querySelector('.details').onclick = event => {
      event.stopPropagation();
      openGameDetails(game);
    };
    card.querySelector('.play').onclick = playGame;
    card.querySelector('.fav').onclick = async event => {
      event.stopPropagation();
      pulseUiHaptic('favorite', { force: true });
      await toggleFavorite(game);
    };
  });

  if (!games.length) setFocusedGame(null);
  else if (!state.focusedGameId || !games.some(game => game.id === state.focusedGameId)) setFocusedGame(games[0]);
  observeVisibleArtwork();
}

function selectLibrarySystem(id) {
  rememberShelfPosition();
  state.selectedSystem = id;
  state.focusedLibrarySystem = id;
  state.view = 'home';
  applySystemTheme(id);
  state.query = '';
  $('#search').value = '';
  setActiveView('home');
  prepareRememberedShelf();
  render();
  restoreShelfPosition();
  const remembered = focusedGame() || currentGames()[0];
  if (remembered) setFocusedGame(remembered);
}

async function toggleFavorite(game) {
  const wasFavorite = Boolean(game.favorite);
  state.library = await window.deck.favorite(game.file);
  render();
  setFocusedGame(state.library.games.find(item => item.id === game.id) || currentGames()[0] || null);
  toast(wasFavorite ? 'Removed from favorites' : 'Added to favorites', 'success');
}

function updateLaunchHandoff(game, active) {
  const panel = $('#launchHandoff');
  if (!panel) return;
  clearTimeout(state.launchHandoffTimer);
  if (!active || !game) {
    panel.classList.remove('visible');
    state.launchHandoffTimer = setTimeout(() => panel.classList.add('hidden'), 220);
    return;
  }
  const system = systemById(game.system);
  const fullscreen = system?.id === 'openbor' || ['arcade', 'mame', 'ps1', 'ps2', 'gamecube', 'wii', 'wiiu'].includes(system?.id);
  $('#launchHandoffKicker').textContent = fullscreen ? 'OPENING FULLSCREEN' : 'OPENING GAME';
  $('#launchHandoffTitle').textContent = game.title || 'Preparing your game';
  $('#launchHandoffDetail').textContent = system?.id === 'openbor'
    ? 'GameDeck is opening an isolated OpenBOR session, preserving aspect ratio, and handing over controller focus.'
    : `GameDeck is handing controller focus to ${system?.name || 'the selected engine'}.`;
  $('#launchHandoffMode').textContent = fullscreen ? 'FULLSCREEN HANDOFF' : 'CENTERED HANDOFF';
  const art = $('#launchHandoffArt');
  art.replaceChildren();
  const image = document.createElement('img');
  image.src = gameArt(game);
  image.alt = '';
  image.addEventListener('error', () => {
    art.replaceChildren();
    const fallback = document.createElement('span');
    fallback.textContent = system?.icon || '▶';
    art.append(fallback);
  }, { once: true });
  art.append(image);
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('visible'));
}

function setLaunchingState(game, active) {
  state.launchingFile = active && game ? game.file : null;
  updateLaunchHandoff(game, active);
  const card = game ? document.querySelector('.game[data-id="' + game.id + '"]') : null;
  card?.classList.toggle('launching', active);
  card?.setAttribute('aria-busy', String(active));
  const playButton = card?.querySelector('.play');
  if (playButton) {
    playButton.disabled = active || gameLaunchBlocked(game);
    playButton.innerHTML = active ? '<span aria-hidden="true">↻</span> OPENING' : '<span aria-hidden="true">▶</span> PLAY';
  }
  if (game && state.focusedGameId === game.id) {
    $('#spotlight').classList.toggle('launching', active);
    $('#spotlightPlay').disabled = active || gameLaunchBlocked(game);
    $('#spotlightPlay').textContent = active ? 'Opening…' : gameLaunchBlocked(game) ? 'Fix ROM set first' : 'Play now';
  }
}

function showLaunchCurtain(game, title = '', message = '') {
  clearTimeout(launchCurtainTimer);
  launchCurtainTimer = null;
  const curtain = $('#launchCurtain');
  $('#launchCurtainTitle').textContent = title || `Starting ${game?.title || 'your game'}`;
  $('#launchCurtainMessage').textContent = message || 'GameDeck is preparing a seamless play session…';
  curtain.classList.remove('hidden');
}

function hideLaunchCurtain(delay = 0) {
  clearTimeout(launchCurtainTimer);
  const hide = () => {
    launchCurtainTimer = null;
    $('#launchCurtain').classList.add('hidden');
  };
  if (delay > 0) launchCurtainTimer = setTimeout(hide, delay);
  else hide();
}

function playPhaseMessage(status = {}) {
  if (status.message) return status.message;
  return {
    resolving: 'Checking integrated-play compatibility…',
    spawning: 'Starting the game engine behind GameDeck…',
    discovering: 'Connecting the live game window…',
    capture_armed: 'Starting integrated video…',
    playing: 'Playing inside GameDeck.',
    external_playing: 'Playing in the engine window. Press F10 to return.',
    stopping: 'Closing the game…',
    ended: 'Game closed.',
    failed: status.error || 'Integrated play needs attention.'
  }[status.phase] || 'Preparing integrated play…';
}

const LOADING_HAPTIC_PHASES = new Set(['resolving', 'spawning', 'discovering', 'capture_armed']);

function playHapticStatusCopy(status = {}) {
  const name = status.padName ? status.padName.replace(/\s*\([^)]*\)\s*$/, '').trim() : 'your controller';
  const preference = HAPTIC_PREFERENCE_ORDER.includes(status.preference) ? status.preference : state.hapticPreference;
  return {
    loading: `${name} is breathing gently while GameDeck prepares the game.`,
    adaptive: preference === 'enhance'
      ? 'Enhanced haptics follow local sound impacts even on rumble-capable systems.'
      : 'Auto haptics add local-only sound-reactive feedback when native rumble is unavailable.',
    native: 'Native game rumble is preserved. Choose Enhance to add sound-reactive feedback for this session.',
    popout: 'Pop out gives vibration control back to the native game engine.',
    unsupported: 'This controller does not expose vibration to GameDeck.',
    'no-audio': 'GameDeck could not access the local analysis track; game audio and controls remain unchanged.',
    off: 'Haptics are off. Press the button to return to Auto.',
    idle: preference === 'enhance' ? 'Enhanced haptics are ready.' : 'Auto haptics are ready.'
  }[status.mode] || 'GameDeck haptics are ready.';
}

function renderPlayHapticStatus(status = {}) {
  const button = $('#playHapticsToggle');
  const hint = $('#playInputHint');
  const surface = $('#playSurface');
  if (!button) return;
  const preference = HAPTIC_PREFERENCE_ORDER.includes(status.preference) ? status.preference : state.hapticPreference;
  const enabled = preference !== 'off' && status.enabled !== false;
  const mode = String(status.mode || 'idle');
  const label = preference === 'enhance' ? 'Haptics Enhance' : preference === 'off' ? 'Haptics Off' : 'Haptics Auto';
  button.classList.toggle('active', enabled);
  button.classList.toggle('enhance', preference === 'enhance');
  button.classList.toggle('reactive', mode === 'adaptive');
  button.classList.toggle('breathing', mode === 'loading');
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', `${label}. Press to change haptic mode.`);
  button.dataset.hapticPreference = preference;
  button.dataset.hapticMode = mode;
  button.dataset.hapticPulses = String(Number(status.pulses || 0));
  button.dataset.hapticLevel = Number(status.level || 0).toFixed(3);
  button.style.setProperty('--haptic-level', String(Math.max(0, Math.min(1, Number(status.level || 0)))));
  surface?.style.setProperty('--haptic-level', String(Math.max(0, Math.min(1, Number(status.level || 0)))));
  button.title = playHapticStatusCopy({ ...status, preference });
  surface?.classList.toggle('haptics-live', mode === 'adaptive' || mode === 'loading');
  surface?.classList.toggle('haptics-impact', mode === 'adaptive' && Number(status.level || 0) > 0.26);
  if (mode !== playHapticRenderedMode || preference !== playHapticRenderedPreference) {
    playHapticRenderedMode = mode;
    playHapticRenderedPreference = preference;
    const compactLabel = preference === 'enhance' ? 'Boost' : preference === 'off' ? 'Off' : 'Auto';
    button.innerHTML = `<svg class="play-control-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="6" width="8" height="12" rx="3"></rect><path d="M5 8c-1.4 2.7-1.4 5.3 0 8M19 8c1.4 2.7 1.4 5.3 0 8"></path></svg><span class="play-control-copy"><small>Haptics</small><b>${compactLabel}</b></span>`;
    if (hint) hint.textContent = playHapticStatusCopy({ ...status, preference });
  }
}

function ensurePlayHaptics() {
  if (playHaptics) return playHaptics;
  if (!window.GameDeckHaptics?.createController) {
    renderPlayHapticStatus({ enabled: false, mode: 'unsupported' });
    return null;
  }
  playHaptics = window.GameDeckHaptics.createController({
    getGamepads: () => navigator.getGamepads?.() || [],
    AudioContext: window.AudioContext || window.webkitAudioContext,
    preference: state.hapticPreference,
    now: () => performance.now(),
    onStatus: renderPlayHapticStatus
  });
  renderPlayHapticStatus(playHaptics.getStatus());
  return playHaptics;
}

function pulseUiHaptic(kind, options = {}) {
  if (state.playSession?.active || state.hapticPreference === 'off') return false;
  const effect = window.GameDeckHaptics?.uiHapticEffect?.(kind, state.hapticPreference);
  if (!effect) return false;
  const now = performance.now();
  const sameKind = uiHapticLastKind === kind;
  if (!options.force && sameKind && now - uiHapticLastAt < Number(effect.minGap || 80)) return false;
  uiHapticLastAt = now;
  uiHapticLastKind = kind;
  const target = window.GameDeckHaptics?.findHapticPad?.(() => navigator.getGamepads?.() || []);
  if (!target) return false;
  const controller = ensurePlayHaptics();
  if (!controller) return false;
  void controller.pulse(effect);
  return true;
}

function resetPlayHapticBinding(mode = 'idle') {
  playHapticSessionKey = '';
  playHapticStream = null;
  playHaptics?.stopAll(mode);
}

function playHapticPolicy(status = state.playSession, preference = state.hapticPreference) {
  return window.GameDeckHaptics?.hapticPolicyForSystem?.(status?.systemId, preference) || 'off';
}

function shouldCaptureHapticAudio(status = state.playSession, preference = state.hapticPreference) {
  return Boolean(status?.active && status.mode !== 'popout' && playHapticPolicy(status, preference) === 'adaptive');
}

function syncPlayHaptics(status = state.playSession) {
  const controller = ensurePlayHaptics();
  if (!controller) return;
  if (!status?.active) {
    if (playHapticSessionKey || controller.getStatus().mode !== 'idle') resetPlayHapticBinding('idle');
    return;
  }
  if (status.mode === 'popout') {
    if (playHapticSessionKey !== `${status.sessionId}:popout`) {
      resetPlayHapticBinding('popout');
      playHapticSessionKey = `${status.sessionId}:popout`;
    }
    return;
  }
  if (status.phase === 'playing' && playCaptureStream) {
    const key = `${status.sessionId}:reactive:${status.systemId || 'unknown'}`;
    if (key !== playHapticSessionKey || playHapticStream !== playCaptureStream) {
      playHapticSessionKey = key;
      playHapticStream = playCaptureStream;
      controller.startReactive(playCaptureStream, status.systemId, state.hapticPreference);
    }
    return;
  }
  if (LOADING_HAPTIC_PHASES.has(status.phase) || status.phase === 'playing') {
    const loadingIdentity = state.playFile || status.sessionId || status.title || 'session';
    const key = `loading:${loadingIdentity}`;
    if (key !== playHapticSessionKey) {
      playHapticSessionKey = key;
      playHapticStream = null;
      controller.startLoading();
    }
    return;
  }
  resetPlayHapticBinding(status.phase === 'failed' ? 'idle' : 'idle');
}

function clampAmbientChannel(value) {
  return Math.max(8, Math.min(235, Math.round(Number(value) || 0)));
}

function ambientZoneColor(pixels, width, height, x0, y0, x1, y1) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4;
      red += pixels[offset] * pixels[offset];
      green += pixels[offset + 1] * pixels[offset + 1];
      blue += pixels[offset + 2] * pixels[offset + 2];
      count += 1;
    }
  }
  if (!count) return '72 231 255';
  let r = Math.sqrt(red / count);
  let g = Math.sqrt(green / count);
  let b = Math.sqrt(blue / count);
  const average = (r + g + b) / 3;
  const saturation = 1.32;
  r = average + (r - average) * saturation;
  g = average + (g - average) * saturation;
  b = average + (b - average) * saturation;
  const brightness = Math.max(r, g, b);
  if (brightness < 42) {
    const lift = 42 - brightness;
    r += lift * .45;
    g += lift * .55;
    b += lift * .7;
  }
  const peak = Math.max(r, g, b);
  if (peak > 235) {
    const scale = 235 / peak;
    r *= scale;
    g *= scale;
    b *= scale;
  }
  return [clampAmbientChannel(r), clampAmbientChannel(g), clampAmbientChannel(b)];
}

function smoothedAmbientColor(key, next) {
  const previous = playAmbientColorState[key] || next;
  const alpha = .18;
  const value = next.map((channel, index) => previous[index] + ((channel - previous[index]) * alpha));
  playAmbientColorState[key] = value;
  return value.map(clampAmbientChannel).join(' ');
}

function samplePlayAmbientFrame() {
  const surface = $('#playSurface');
  const ambient = $('#playAmbient');
  const video = $('#playVideo');
  if (!surface?.classList.contains('play-ambient-live') || !ambient || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  playAmbientCanvas ||= document.createElement('canvas');
  playAmbientCanvas.width = 12;
  playAmbientCanvas.height = 8;
  playAmbientContext ||= playAmbientCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!playAmbientContext) return;
  try {
    playAmbientContext.drawImage(video, 0, 0, playAmbientCanvas.width, playAmbientCanvas.height);
    const frame = playAmbientContext.getImageData(0, 0, playAmbientCanvas.width, playAmbientCanvas.height);
    const { data, width, height } = frame;
    surface.style.setProperty('--ambient-left', smoothedAmbientColor('left', ambientZoneColor(data, width, height, 0, 1, 3, height - 1)));
    surface.style.setProperty('--ambient-right', smoothedAmbientColor('right', ambientZoneColor(data, width, height, width - 3, 1, width, height - 1)));
    surface.style.setProperty('--ambient-top', smoothedAmbientColor('top', ambientZoneColor(data, width, height, 2, 0, width - 2, 2)));
    surface.style.setProperty('--ambient-bottom', smoothedAmbientColor('bottom', ambientZoneColor(data, width, height, 2, height - 2, width - 2, height)));
  } catch {}
}

function stopPlayAmbient(detach = true) {
  clearInterval(playAmbientTimer);
  playAmbientTimer = null;
  $('#playSurface')?.classList.remove('play-ambient-live');
  const ambientVideo = $('#playAmbientVideo');
  if (!ambientVideo) return;
  ambientVideo.pause();
  if (detach) {
    ambientVideo.srcObject = null;
    playAmbientColorState = Object.create(null);
  }
}

function updatePlayAmbientState() {
  const surface = $('#playSurface');
  const ambientVideo = $('#playAmbientVideo');
  const streamLive = Boolean(playCaptureStream?.getVideoTracks().some(track => track.readyState === 'live'));
  const shouldGlow = Boolean(
    surface
    && ambientVideo
    && state.playSession?.active
    && state.playSession.mode === 'docked'
    && state.playSession.phase === 'playing'
    && streamLive
  );
  if (!shouldGlow) {
    stopPlayAmbient(false);
    return;
  }
  if (ambientVideo.srcObject !== playCaptureStream) ambientVideo.srcObject = playCaptureStream;
  ambientVideo.muted = true;
  ambientVideo.play().catch(() => {});
  surface.classList.add('play-ambient-live');
  samplePlayAmbientFrame();
  if (!playAmbientTimer) playAmbientTimer = setInterval(samplePlayAmbientFrame, 180);
}

function stopPlayCapture() {
  playCaptureGeneration += 1;
  playFrameReady = false;
  playFrameReadySessionId = '';
  stopPlayAmbient(true);
  resetPlayHapticBinding('idle');
  if (playCaptureStream) {
    for (const track of playCaptureStream.getTracks()) track.stop();
  }
  playCaptureStream = null;
  playCapturePromise = null;
  clearTimeout(playAspectTimer);
  playAspectTimer = null;
  reportedPlayAspect = 0;
  const video = $('#playVideo');
  if (video) {
    video.onresize = null;
    video.pause();
    video.srcObject = null;
  }
}

function hideFullscreenControls(force = false) {
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = null;
  const surface = $('#playSurface');
  if (!surface || !state.playSession?.active || state.playSession.mode === 'popout') return;
  if (!playFrameReady || playFrameReadySessionId !== state.playSession.sessionId) return;
  if (!force && surface.querySelector('.play-header:focus-within, .play-footer:focus-within')) return;
  surface.classList.add('play-chrome-hidden');
  surface.classList.remove('fullscreen-controls-visible');
  requestAnimationFrame(applyPlayGeometry);
}

function showFullscreenControls(duration = 2200) {
  const surface = $('#playSurface');
  if (!surface || !state.playSession?.active || state.playSession.mode === 'popout') return;
  surface.classList.remove('play-chrome-hidden');
  surface.classList.toggle('fullscreen-controls-visible', state.playSession.mode === 'fullscreen');
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = null;
  requestAnimationFrame(applyPlayGeometry);
  if (duration > 0 && playFrameReady && playFrameReadySessionId === state.playSession.sessionId) {
    fullscreenControlsTimer = setTimeout(hideFullscreenControls, duration);
  }
}

function resetFullscreenControls() {
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = null;
  const surface = $('#playSurface');
  surface?.classList.remove('fullscreen-controls-visible', 'play-chrome-hidden');
  requestAnimationFrame(applyPlayGeometry);
}

function settlePlayChrome(delay = 720) {
  const surface = $('#playSurface');
  if (!surface || !state.playSession?.active || state.playSession.mode === 'popout') return;
  const active = document.activeElement;
  if (active && surface.contains(active) && typeof active.blur === 'function') active.blur();
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = setTimeout(() => hideFullscreenControls(true), Math.max(240, Number(delay) || 720));
  showPlayPointer(Math.max(500, Number(delay) || 720));
}

function hidePlayPointer() {
  clearTimeout(playPointerTimer);
  playPointerTimer = null;
  const surface = $('#playSurface');
  if (!surface || !state.playSession?.active || state.playSession.mode === 'popout') return;
  if (surface.querySelector('.play-header:hover, .play-header:focus-within')) return;
  surface.classList.add('play-pointer-hidden');
}

function showPlayPointer(duration = 1600) {
  const surface = $('#playSurface');
  if (!surface) return;
  surface.classList.remove('play-pointer-hidden');
  clearTimeout(playPointerTimer);
  playPointerTimer = null;
  if (duration > 0 && state.playSession?.active && state.playSession.mode !== 'popout') {
    playPointerTimer = setTimeout(hidePlayPointer, duration);
  }
}

function normalizedPlayAspect(value) {
  const aspect = Number(value);
  return Number.isFinite(aspect) && aspect > 0.4 && aspect < 3 ? aspect : 16 / 9;
}

async function syncPlaySourceAspect(video, sessionId) {
  if (!video || state.playSession?.sessionId !== sessionId) return;
  const aspect = Number(video.videoWidth) / Math.max(1, Number(video.videoHeight));
  if (!Number.isFinite(aspect) || aspect <= 0.4 || aspect >= 3 || Math.abs(aspect - reportedPlayAspect) < 0.002) return;
  reportedPlayAspect = aspect;
  const result = await window.deck.playSessionSetAspect(sessionId, aspect);
  if (result?.status && state.playSession?.sessionId === sessionId) renderPlaySession(result.status);
}

function schedulePlaySourceAspect(video, sessionId, delay = 120) {
  clearTimeout(playAspectTimer);
  playAspectTimer = setTimeout(() => syncPlaySourceAspect(video, sessionId).catch(() => {}), delay);
}

function applyPlayGeometry() {
  const surface = $('#playSurface');
  const stage = $('#playStage');
  const video = $('#playVideo');
  if (!surface || !stage || !video || !state.playSession?.active || state.playSession.mode === 'popout') return;
  const mode = state.playSession.mode;
  const aspect = normalizedPlayAspect(video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : state.playSession.aspectRatio);
  const stageWidth = stage.clientWidth;
  const stageHeight = stage.clientHeight;
  if (!stageWidth || !stageHeight) return;
  const immersive = surface.classList.contains('play-chrome-hidden') || mode === 'fullscreen';
  const marginX = mode === 'fullscreen' ? 0 : (immersive ? 4 : Math.max(28, Math.min(64, Math.round(stageWidth * 0.04))));
  const marginY = mode === 'fullscreen' ? 0 : (immersive ? 4 : Math.max(20, Math.min(46, Math.round(stageHeight * 0.052))));
  const dpr = Math.max(1, Number(window.devicePixelRatio || 1));
  const stagePixelWidth = Math.max(1, Math.round(stageWidth * dpr));
  const stagePixelHeight = Math.max(1, Math.round(stageHeight * dpr));
  const maxPixelWidth = Math.max(1, Math.floor((stageWidth - marginX * 2) * dpr));
  const maxPixelHeight = Math.max(1, Math.floor((stageHeight - marginY * 2) * dpr));
  const sourcePixelWidth = Math.max(1, Math.round(Number(video.videoWidth) || maxPixelWidth));
  const sourcePixelHeight = Math.max(1, Math.round(Number(video.videoHeight) || (sourcePixelWidth / aspect)));
  const integerScale = Math.floor(Math.min(maxPixelWidth / sourcePixelWidth, maxPixelHeight / sourcePixelHeight));
  let outputPixelWidth;
  let outputPixelHeight;
  let renderScale;
  if (integerScale >= 1) {
    renderScale = integerScale;
    outputPixelWidth = sourcePixelWidth * integerScale;
    outputPixelHeight = sourcePixelHeight * integerScale;
  } else {
    renderScale = Math.min(maxPixelWidth / sourcePixelWidth, maxPixelHeight / sourcePixelHeight);
    outputPixelWidth = Math.max(1, Math.floor(sourcePixelWidth * renderScale));
    outputPixelHeight = Math.max(1, Math.floor(sourcePixelHeight * renderScale));
  }
  const leftPixel = Math.round((stagePixelWidth - outputPixelWidth) / 2);
  const topPixel = Math.round((stagePixelHeight - outputPixelHeight) / 2);
  video.style.setProperty('--game-aspect', String(aspect));
  video.style.width = (outputPixelWidth / dpr) + 'px';
  video.style.height = (outputPixelHeight / dpr) + 'px';
  video.style.maxWidth = 'none';
  video.style.maxHeight = 'none';
  video.style.left = (leftPixel / dpr) + 'px';
  video.style.top = (topPixel / dpr) + 'px';
  video.style.transform = 'none';
  video.style.objectFit = 'fill';
  video.style.imageRendering = integerScale > 1 ? 'pixelated' : 'auto';
  video.dataset.renderScale = String(renderScale);
  video.dataset.renderPixels = outputPixelWidth + 'x' + outputPixelHeight;
  video.dataset.renderMode = integerScale >= 1 ? 'integer' : 'downsample';
}

function markPlayFrameReady(sessionId) {
  const id = String(sessionId || '');
  if (!id || state.playSession?.sessionId !== id || state.playSession?.mode === 'popout') return false;
  playFrameReadySessionId = id;
  playFrameReady = true;
  $('#playLoading')?.classList.add('ready');
  hideLaunchCurtain();
  setLaunchingState(state.library.games.find(item => item.id === state.playGameId || item.file === state.playFile), false);
  requestAnimationFrame(() => { applyPlayGeometry(); updatePlayAmbientState(); showPlayPointer(1400); showFullscreenControls(1800); });
  return true;
}

async function waitForDecodedPlayFrame(video, sessionId) {
  if (!video) throw Error('The integrated game video element is unavailable.');
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    markPlayFrameReady(sessionId);
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('playing', onFrame);
      video.removeEventListener('loadeddata', onFrame);
      video.removeEventListener('timeupdate', onFrame);
      if (error) reject(error); else resolve();
    };
    const onFrame = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const timer = setTimeout(() => finish(new Error('The game produced no decoded video frame in time.')), 5000);
    video.addEventListener('playing', onFrame);
    video.addEventListener('loadeddata', onFrame);
    video.addEventListener('timeupdate', onFrame);
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => finish());
    }
  });
  markPlayFrameReady(sessionId);
}

function renderPlaySession(status = {}) {
  const previousMode = state.playSession?.mode;
  state.playSession = { ...state.playSession, ...status };
  const current = state.playSession;
  const surface = $('#playSurface');
  const active = Boolean(current.active);
  const mode = ['docked', 'fullscreen', 'popout'].includes(current.mode) ? current.mode : 'docked';
  surface.classList.remove('mode-docked', 'mode-fullscreen', 'mode-popout');
  surface.classList.add(`mode-${mode}`);
  $('#playTitle').textContent = current.title || 'GameDeck Play';
  $('#playStatus').textContent = playPhaseMessage(current);
  $('#playLoadingTitle').textContent = current.title ? `Starting ${current.title}` : 'Starting your game';
  $('#playLoadingMessage').textContent = playPhaseMessage(current);
  const playing = Boolean(current.active && mode !== 'popout' && playFrameReady && playFrameReadySessionId === current.sessionId);
  $('#playLoading').classList.toggle('ready', playing);
  if (!playing) {
    resetFullscreenControls();
  } else if (mode === 'fullscreen' && previousMode !== 'fullscreen') {
    requestAnimationFrame(() => showFullscreenControls(2400));
  } else if (previousMode === 'fullscreen' && mode !== 'fullscreen') {
    surface.classList.remove('fullscreen-controls-visible');
  }
  $$('[data-play-mode]').forEach(button => {
    const selected = button.dataset.playMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (active && mode !== 'popout') {
    surface.classList.remove('hidden');
    document.body.classList.add('play-session-open');
    requestAnimationFrame(() => { applyPlayGeometry(); updatePlayAmbientState(); });
  } else {
    surface.classList.add('hidden');
    document.body.classList.remove('play-session-open');
    stopPlayAmbient(false);
  }
  syncPlayHaptics(current);
}

function resetPlaySessionUi() {
  resetFullscreenControls();
  showPlayPointer(0);
  stopPlayCapture();
  $('#playSurface').classList.add('hidden');
  $('#playCaptureError').classList.add('hidden');
  $('#playLoading').classList.remove('ready');
  document.body.classList.remove('play-session-open');
  const game = state.library.games.find(item => item.id === state.playGameId || item.file === state.playFile);
  setLaunchingState(game, false);
  playCaptureFallbackPending = false;
  playFrameReady = false;
  playFrameReadySessionId = '';
  state.playSession = { active: false, phase: 'idle', sessionId: '', title: '', mode: 'docked', aspectRatio: 16 / 9, captureReady: false };
  state.playFile = '';
  state.playGameId = null;
  rearmGamepadInput(420);
}

async function requestPlayCapture(sessionId, includeAudio = false) {
  const armed = await window.deck.playSessionArmCapture(sessionId, includeAudio);
  if (!armed?.ok) throw Error(armed?.error || 'The game window is not ready for capture.');
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: includeAudio });
}

async function acquirePlayCapture(status = state.playSession) {
  if (!status?.active || status.mode === 'popout' || !status.captureReady || !status.sessionId) return null;
  if (playCaptureStream && playCaptureStream.getVideoTracks().some(track => track.readyState === 'live')) return playCaptureStream;
  if (playCapturePromise) return playCapturePromise;
  playCapturePromise = (async () => {
    const sessionId = status.sessionId;
    if (playFrameReadySessionId !== sessionId) { playFrameReady = false; playFrameReadySessionId = ''; }
    $('#playCaptureError').classList.add('hidden');
    $('#playLoading').classList.toggle('ready', playFrameReady && playFrameReadySessionId === sessionId);
    const includeHapticAudio = shouldCaptureHapticAudio(status);
    const stream = await requestPlayCapture(sessionId, includeHapticAudio);
    if (state.playSession.sessionId !== sessionId || state.playSession.mode === 'popout') {
      for (const track of stream.getTracks()) track.stop();
      return null;
    }
    playCaptureStream = stream;
    const captureGeneration = ++playCaptureGeneration;
    const video = $('#playVideo');
    video.srcObject = stream;
    video.muted = true;
    const ambientVideo = $('#playAmbientVideo');
    if (ambientVideo) { ambientVideo.srcObject = stream; ambientVideo.muted = true; }
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      const timer = setTimeout(() => reject(new Error('The game video did not become ready in time.')), 10000);
      video.onloadedmetadata = () => { clearTimeout(timer); applyPlayGeometry(); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('The game video could not be opened.')); };
    });
    await video.play();
    await waitForDecodedPlayFrame(video, sessionId);
    updatePlayAmbientState();
    syncPlayHaptics(state.playSession);
    await syncPlaySourceAspect(video, sessionId);
    video.onresize = () => schedulePlaySourceAspect(video, sessionId);
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (captureGeneration !== playCaptureGeneration) return;
        void fallbackPlayCaptureToPopout('The live game window stopped sharing. Continuing in Pop out.');
      }, { once: true });
    }
    const started = await window.deck.playSessionCaptureStarted(sessionId);
    if (started?.status) renderPlaySession(started.status);
    markPlayFrameReady(sessionId);
    return stream;
  })();
  try {
    return await playCapturePromise;
  } catch (error) {
    stopPlayCapture();
    const current = state.playSession;
    if (!current?.active || current.mode === 'popout') {
      hideLaunchCurtain();
      return null;
    }
    $('#playLoading').classList.add('ready');
    hideLaunchCurtain();
    await fallbackPlayCaptureToPopout(error.message || 'The integrated game video could not start. Continuing in Pop out.');
    return null;
  } finally {
    playCapturePromise = null;
  }
}

async function handlePlaySessionUpdate(status = {}) {
  const previous = state.playSession;
  renderPlaySession(status);
  if (status.active) {
    if (status.mode === 'popout') {
      stopPlayCapture();
      hideLaunchCurtain();
      return;
    }
    if (status.phase === 'playing' && playCaptureStream) hideLaunchCurtain();
    if (status.captureReady) acquirePlayCapture(status);
    return;
  }
  const wasActive = Boolean(previous?.active || state.playFile);
  const failed = status.phase === 'failed';
  const message = status.error || status.message || '';
  resetPlaySessionUi();
  hideLaunchCurtain();
  if (failed && message) toast(message, 'warning');
  else if (wasActive && status.phase === 'ended') toast('Game closed. Welcome back to your library.', 'success');
  if (wasActive) loadLibrary(false);
}

async function fallbackPlayCaptureToPopout(message) {
  const current = state.playSession;
  if (playCaptureFallbackPending || !current?.active || current.mode === 'popout') return false;
  playCaptureFallbackPending = true;
  try {
    $('#playCaptureErrorMessage').textContent = message || 'Integrated video was interrupted. Retry the GameDeck view or choose Window to continue in the native game window.';
    $('#playCaptureError').classList.remove('hidden');
    $('#playLoading').classList.add('ready');
    hideLaunchCurtain();
    toast('Integrated video needs attention. The game is still safely owned by GameDeck.', 'warning');
    return false;
  } finally {
    playCaptureFallbackPending = false;
  }
}

async function setPlayMode(mode) {
  const status = state.playSession;
  if (!status?.active || !status.sessionId) return;
  if (!['docked', 'fullscreen', 'popout'].includes(mode)) return;
  if (mode === 'popout') {
    resetFullscreenControls();
    stopPlayCapture();
    hideLaunchCurtain();
  } else {
    if (mode === 'fullscreen') showFullscreenControls(2400);
    showLaunchCurtain({ title: status.title }, `Returning to ${mode === 'fullscreen' ? 'fullscreen' : 'GameDeck Play'}`, 'Reconnecting the live game window…');
  }
  const result = await window.deck.playSessionSetMode(status.sessionId, mode);
  if (!result?.ok) {
    hideLaunchCurtain();
    toast(result?.error || 'Could not change the play mode.', 'warning');
    return;
  }
  await handlePlaySessionUpdate(result.status);
}

async function stopIntegratedPlay(reason = 'player_closed') {
  const status = state.playSession;
  if (!status?.sessionId) return;
  showLaunchCurtain({ title: status.title }, `Closing ${status.title || 'game'}`, 'Saving session state and returning to your library…');
  const result = await window.deck.playSessionStop(status.sessionId, reason);
  if (result?.status) await handlePlaySessionUpdate(result.status);
}

async function startIntegratedPlay(file, game) {
  const mode = 'docked';
  state.playFile = file;
  state.playGameId = game?.id || null;
  renderPlaySession({
    active: true,
    phase: 'resolving',
    sessionId: '',
    title: game?.title || 'Your game',
    mode,
    aspectRatio: normalizedPlayAspect(game?.aspectRatio || 16 / 9),
    captureReady: false,
    message: 'Checking the integrated GameDeck route…'
  });
  const result = await window.deck.playSessionStart(file, { mode });
  if (result?.queued) {
    resetPlaySessionUi();
    hideLaunchCurtain();
    return result;
  }
  if (!result?.ok) throw Error(result?.error || 'Integrated play could not start.');
  await handlePlaySessionUpdate(result.status);
  return result;
}

async function integratedCapabilitiesFor(file, game) {
  let capabilities = await window.deck.playSessionCapabilities(file);
  if (capabilities?.eligible && capabilities?.presentation?.embedded) return capabilities;

  const runtimeReason = new Set(['engine_unavailable', 'core_unavailable', 'managed_config_unavailable']);
  const reasonCode = capabilities?.fallback?.reasonCode || '';
  let runtime = state.runtime || state.diagnostics?.managedRuntime || await window.deck.runtimeStatus();
  if (runtime?.supported && !runtime.ready && (runtime.bundled || runtimeReason.has(reasonCode))) {
    showLaunchCurtain(game, `Preparing ${game?.title || 'your game'}`, 'Finishing the GameDeck engine setup for seamless in-app play…');
    toast('Preparing the GameDeck play engine…', 'progress');
    runtime = await window.deck.ensureRuntime(false);
    state.runtime = runtime;
    if (!runtime?.ready) throw Error(runtime?.message || 'GameDeck could not prepare its managed play engine.');
    await refreshDiagnostics();
    capabilities = await window.deck.playSessionCapabilities(file);
  }

  if (!capabilities?.eligible || !capabilities?.presentation?.embedded) {
    const message = capabilities?.fallback?.playerMessage || 'This game is not ready for the unified GameDeck player.';
    const action = capabilities?.fallback?.recommendedAction || 'Complete console setup, then try again.';
    throw Error(`${message} ${action}`);
  }
  return capabilities;
}

async function launch(file) {
  if (state.launchingFile || state.playSession?.active) return;
  ensurePlayHaptics()?.primeAudio?.();
  let game = null;
  try {
    game = state.library.games.find(item => item.file === file);
    if (game && gameLaunchBlocked(game)) throw Error(game.archiveHealthMessage || 'This game needs attention before launch.');
    closeGameDetails({ restoreFocus: false, immediate: true });
    setLaunchingState(game, true);
    showLaunchCurtain(game, `Starting ${game?.title || 'your game'}`, 'Opening the unified GameDeck player…');
    toast('Opening ' + (game?.title || 'your game') + ' inside GameDeck…', 'progress');

    await integratedCapabilitiesFor(file, game);
    const integrated = await startIntegratedPlay(file, game);
    if (integrated?.queued) {
      setLaunchingState(game, false);
      state.transferExpanded = true;
      renderDownloads();
      toast(integrated.message || 'GameDeck is preparing the required files. The game will open automatically.', 'progress');
    }
  } catch (error) {
    resetPlaySessionUi();
    hideLaunchCurtain();
    setLaunchingState(game, false);
    toast(error.message || 'The unified GameDeck player could not start.', 'warning');
  }
}


function renderCatalogFeature(game) {
  const feature = $('#catalogFeature');
  if (!game || !state.catalogSystem) {
    feature.classList.add('hidden');
    return;
  }

  const fallback = assetFallback(game.name, '#263347', '#10141c', state.catalogSystem?.name || 'DISCOVER');
  const art = game.art || fallback;
  const downloading = downloadForGame(game) || (state.activeCatalogTasks.has(catalogTaskKey(game)) ? { stage: 'Preparing', progress: 0 } : null);
  const installed = Boolean(game.installedFile);
  const ready = installed && game.installedReady !== false;
  const cached = state.gameDetails.get(detailKey(game.fileName || game.name, state.catalogSystem.systemId));
  feature.classList.toggle('details-loading', !cached);
  $('#catalogFeatureSource').textContent = cached ? String(cached.source || 'GameDeck').toUpperCase() : 'MATCHING DETAILS';
  const description = installed && !ready
    ? `${game.name} has finished downloading for ${state.catalogSystem.name}. GameDeck can unpack the existing archive locally now—there is no need to download it again.`
    : fallbackDescription(game.name, state.catalogSystem.name, ready, game.edition);
  feature.classList.remove('feature-loading');
  $('#catalogFeatureArt').innerHTML = `<img src="${escapeHtml(art)}" alt="${escapeHtml(game.name)} cover">`;
  $('#catalogFeatureBackdrop').src = art;
  $('#catalogFeatureSystem').textContent = `${state.catalogSystem.name.toUpperCase()} / ${ready ? 'IN YOUR LIBRARY' : downloading ? 'FINISHING SETUP' : installed ? 'DOWNLOADED' : 'RGSX CATALOG'}`;
  $('#catalogFeatureTitle').textContent = game.name;
  $('#catalogFeatureFacts').innerHTML = factMarkup([game.region || game.tags?.[0], cached?.year, game.size || 'RGSX managed', ready ? 'Ready' : installed ? 'Downloaded' : 'Available']);
  $('#catalogFeatureDescription').textContent = cached?.description || description;
  $('#catalogFeatureMeta').textContent = !state.catalogSystem.playable
    ? `Console setup needed · ${state.catalogSystem.issue} You can still add this title now.`
    : ready
      ? 'Ready to play · GameDeck will choose the configured emulator automatically.'
      : downloading
        ? `${downloading.stage || 'Downloading'} · ${Math.round(Number(downloading.progress || 0))}% complete`
        : installed
          ? 'Download complete · Unpack locally once to finish setup. The original archive will be kept.'
        : 'One-click RGSX transfer · Progress stays visible while you keep browsing.';
  $('#catalogFeatureAction').textContent = ready ? 'Play now' : downloading ? `${downloading.stage || 'Working'} ${Math.round(Number(downloading.progress || 0))}%` : installed ? 'Finish setup' : 'Add to my deck';
  $('#catalogFeatureAction').disabled = Boolean(downloading);
  $('#catalogSetup').classList.toggle('hidden', state.catalogSystem.playable);
  $('#catalogSetup').textContent = systemNeedsFirmware(state.catalogSystem) ? 'Download firmware' : 'Setup console';
  feature.classList.remove('hidden');

  requestCatalogArtwork(game);
  queueGameDetails(game.fileName || game.name, state.catalogSystem.systemId, {
    name: game.name,
    systemName: state.catalogSystem.name,
    edition: game.edition,
    region: game.region,
    installed: ready
  }, details => {
    const isFeatured = state.focusedCatalogId === game.id || (state.focusedCatalogId == null && currentCatalogGames()[0]?.id === game.id);
    if (!isFeatured) return;
    $('#catalogFeatureDescription').textContent = details.description || description;
    $('#catalogFeatureFacts').innerHTML = factMarkup([game.region || game.tags?.[0], details.year, details.genre, details.players && `${details.players} player${details.players === '1' ? '' : 's'}`, game.size || 'RGSX managed', ready ? 'Ready' : installed ? 'Downloaded' : 'Available']);
    $('#catalogFeatureSource').textContent = String(details.source || 'GameDeck').toUpperCase();
    feature.classList.remove('details-loading');
  });
}

function setFocusedCatalogGame(game, options = {}) {
  state.focusedCatalogId = game?.id ?? null;
  if (state.catalogSystem && game) {
    const memory = state.catalogMemory[state.catalogSystem.id] || {};
    state.catalogMemory[state.catalogSystem.id] = { ...memory, focusedCatalogId: game.id };
  }
  state.discoverZone = 'games';
  $$('.catalog-game').forEach(card => {
    const active = Number(card.dataset.id) === state.focusedCatalogId;
    card.classList.toggle('active', active);
    card.setAttribute('aria-current', String(active));
  });
  $$('.console-card').forEach(card => card.classList.remove('controller-focus'));
  renderCatalogFeature(game);
  if (options.scroll && game) document.querySelector(`.catalog-game[data-id="${game.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderCatalogGames() {
  const games = currentCatalogGames();
  const filteredTotal = filteredCatalogGames().length;
  $('#catalogResultCount').textContent = `${filteredTotal.toLocaleString()} ${filteredTotal === 1 ? 'title' : 'titles'}`;
  $('#catalogGames').removeAttribute('aria-busy');
  $('#catalogGames').innerHTML = games.map((game, index) => {
    const active = game.id === state.focusedCatalogId;
    const downloading = downloadForGame(game) || (state.activeCatalogTasks.has(catalogTaskKey(game)) ? { progress: 0, stage: 'Preparing' } : null);
    const installed = Boolean(game.installedFile);
    const ready = installed && game.installedReady !== false;
    const art = game.art || assetFallback(game.name, '#263347', '#10141c', state.catalogSystem?.name || 'DISCOVER');
    const facts = [game.region || game.tags?.[0] || 'Catalog', game.size || 'RGSX'].filter(Boolean);
    const action = ready ? 'Play' : downloading ? `${Math.round(Number(downloading.progress || 0))}%` : installed ? 'Finish' : 'Add';
    const cardState = ready ? 'IN LIBRARY' : downloading ? escapeHtml(downloading.stage || 'WORKING') : installed ? 'DOWNLOADED' : 'AVAILABLE';
    return `<article class="catalog-game ${game.art ? 'has-art' : 'art-pending'} ${active ? 'active' : ''} ${ready ? 'installed' : ''} ${installed && !ready ? 'downloaded' : ''} ${downloading ? 'downloading' : ''}" tabindex="0" role="listitem" aria-current="${active}" aria-label="Select ${escapeHtml(game.name)} for ${escapeHtml(state.catalogSystem?.name || 'this console')}" style="--delay:${Math.min(index, 14) * 18}ms" data-id="${game.id}"><div class="catalog-media"><img class="catalog-media-backdrop" data-catalog-art="${game.id}" src="${escapeHtml(art)}" alt="" loading="lazy"><img class="catalog-poster" data-catalog-art="${game.id}" src="${escapeHtml(art)}" alt="${escapeHtml(game.name)} artwork" loading="lazy"><span class="catalog-platform">${escapeHtml(state.catalogSystem?.name || 'GAME')}</span><span class="catalog-state">${cardState}</span></div><div class="catalog-info"><b title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</b><small>${facts.map(fact => `<span>${escapeHtml(fact)}</span>`).join('')}</small><p>${escapeHtml(cardDescription(game, state.catalogSystem))}</p><button type="button" class="import" data-id="${game.id}" ${downloading ? 'disabled' : ''}>${action}</button></div></article>`;
  }).join('');

  $$('.catalog-game').forEach(card => {
    const game = games.find(item => item.id === Number(card.dataset.id));
    card.onmouseenter = () => setFocusedCatalogGame(game);
    card.onfocus = () => setFocusedCatalogGame(game);
    card.onclick = event => {
      if (event.target.closest('button')) return;
      setFocusedCatalogGame(game);
    };
    card.ondblclick = event => {
      if (event.target.closest('button')) return;
      setFocusedCatalogGame(game);
      catalogAction(game);
    };
  });
  $$('.import').forEach(button => {
    button.onclick = event => {
      event.stopPropagation();
      const game = games.find(item => item.id === Number(button.dataset.id));
      setFocusedCatalogGame(game);
      catalogAction(game);
    };
  });

  if (!games.length) {
    const emptyMessage = state.catalogQuery
      ? `No titles match “${escapeHtml($('#search').value.trim())}”.`
      : state.catalogFilter === 'installed'
        ? 'No ready-to-play titles from this console are in your library yet.'
        : state.catalogFilter === 'downloaded'
          ? 'No downloaded titles are waiting for setup.'
          : state.catalogFilter === 'available'
            ? 'Every title in this catalog is already on your deck.'
            : 'No titles are available in this console catalog.';
    $('#catalogGames').innerHTML = `<div class="catalog-empty"><b>Nothing here yet</b><span>${emptyMessage}</span></div>`;
    renderCatalogFeature(null);
  } else if (state.focusedCatalogId == null || !games.some(game => game.id === state.focusedCatalogId)) {
    if (state.discoverZone === 'games') setFocusedCatalogGame(games[0]);
    else renderCatalogFeature(games[0]);
  } else {
    renderCatalogFeature(focusedCatalogGame());
  }
  renderCatalogProgress();
  observeVisibleArtwork();
}

function renderCatalogProgress() {
  const total = filteredCatalogGames().length;
  const shown = Math.min(total, currentCatalogGames().length);
  $('#catalogPager').classList.toggle('hidden', total === 0);
  $('#catalogProgress').textContent = `${shown.toLocaleString()} of ${total.toLocaleString()} titles ready to browse`;
  $('#catalogPager').style.setProperty('--catalog-progress', `${total ? (shown / total) * 100 : 0}%`);
  if (state.catalogSystem) {
    const memory = state.catalogMemory[state.catalogSystem.id] || {};
    state.catalogMemory[state.catalogSystem.id] = { ...memory, query: state.catalogQuery, filter: state.catalogFilter, limit: state.catalogLimit, focusedCatalogId: state.focusedCatalogId };
  }
  $('#catalogMore').textContent = `Load ${Math.min(CATALOG_PAGE_SIZE, Math.max(0, total - shown)).toLocaleString()} more`;
  $('#catalogMore').classList.toggle('hidden', shown >= total);
}

function showMoreCatalog(focusNext = false) {
  const allGames = filteredCatalogGames();
  const previousCount = currentCatalogGames().length;
  if (previousCount >= allGames.length) return false;
  state.catalogLimit = Math.min(allGames.length, state.catalogLimit + CATALOG_PAGE_SIZE);
  renderCatalogGames();
  if (focusNext) setFocusedCatalogGame(allGames[previousCount], { scroll: true });
  return true;
}

async function catalogAction(game) {
  if (!game || !state.catalogSystem) return;
  if (game.installedFile) {
    if (game.installedReady !== false) {
      await launch(game.installedFile);
      return;
    }
    try {
      toast(`Finishing ${game.name} locally — no re-download needed`);
      state.transferExpanded = true;
      const result = await window.deck.prepareGame(game.installedFile);
      if (!result.ok) throw Error(result.error || 'GameDeck could not unpack this download');
      if (result.queued) {
        renderDownloads();
        return;
      }
      game.installedFile = result.file;
      game.installedReady = true;
      await loadLibrary(false);
      renderCatalogGames();
      toast(`${game.name} is ready to play`);
      await launch(result.file);
    } catch (error) {
      toast(error.message || 'Could not finish preparing this game');
      openConsole(true);
    }
    return;
  }
  if (state.activeCatalogTasks.has(catalogTaskKey(game))) {
    state.transferExpanded = true;
    renderDownloads();
    return;
  }

  try {
    toast(`Sending ${game.name} to RGSX...`);
    const result = await window.deck.importOwned(state.catalogSystem.source, state.catalogSystem.folder, game.name, game.fileName);
    if (!result.ok) throw Error(result.error || 'RGSX could not start the download');
    if (result.installedFile) {
      game.installedFile = result.installedFile;
      game.installedReady = result.installedReady !== false;
      renderCatalogGames();
      await catalogAction(game);
      return;
    }
    state.activeCatalogTasks.set(catalogTaskKey(game), result.taskId);
    renderCatalogGames();
    state.transferExpanded = true;
    renderDownloads();
    toast('Download started — keep browsing while RGSX works');
  } catch (error) {
    toast(error.message || 'RGSX download failed');
    openConsole(true);
  }
}

function rememberCatalogContext() {
  if (!state.catalogSystem) return;
  const content = $('.content');
  state.catalogMemory[state.catalogSystem.id] = {
    query: state.catalogQuery,
    filter: state.catalogFilter,
    limit: state.catalogLimit,
    focusedCatalogId: state.focusedCatalogId,
    scrollTop: Number(content?.scrollTop || 0)
  };
}

function restoreCatalogContext(systemId) {
  const memory = state.catalogMemory[systemId];
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const content = $('.content');
    if (!content) return;
    content.scrollTop = Number(memory?.scrollTop || 0);
    updateScrollChrome(content);
    const focused = memory?.focusedCatalogId && document.querySelector(`.catalog-game[data-id="${memory.focusedCatalogId}"]`);
    focused?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }));
}

function applyCatalogCollection(system, games, enterGames = false) {
  state.catalogGames = games;
  system.count = games.length;
  system.installedCount = games.filter(game => game.installedFile).length;
  $('#catalogCount').textContent = `${system.installedCount.toLocaleString()} installed · ${games.length.toLocaleString()} available · ${system.playable ? 'emulator ready' : 'setup needed'}`;
  renderConsoleRail();
  if (enterGames && games.length && !state.focusedCatalogId) {
    state.discoverZone = 'games';
    state.focusedCatalogId = filteredCatalogGames()[0]?.id || games[0].id;
  }
  renderCatalogGames();
  restoreCatalogContext(system.id);
}

async function selectCatalog(id, enterGames = false) {
  const system = state.catalog.find(item => item.id === id);
  if (!system) return;
  if (state.catalogSystem?.id && state.catalogSystem.id !== id) rememberCatalogContext();
  const memory = state.catalogMemory[id] || {};
  const request = ++catalogRequest;
  state.catalogSystem = system;
  state.focusedConsoleId = id;
  state.focusedCatalogId = memory.focusedCatalogId || null;
  state.catalogQuery = memory.query || '';
  state.catalogFilter = ['all', 'available', 'downloaded', 'installed'].includes(memory.filter) ? memory.filter : 'all';
  state.catalogLimit = Math.max(CATALOG_PAGE_SIZE, Number(memory.limit || CATALOG_PAGE_SIZE));
  state.catalogGames = [];
  $('#search').value = state.catalogQuery;
  $('#catalogFilter').value = state.catalogFilter;
  renderConsoleRail();
  requestAnimationFrame(() => document.querySelector(`.console-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  $('#catalogTitle').textContent = system.name;
  $('#catalogCount').textContent = `${system.count.toLocaleString()} titles · ${system.playable ? 'ready to play' : 'setup needed'}`;

  const cached = state.catalogCache.get(system.gamesFile);
  if (cached) {
    applyCatalogCollection(system, cached, enterGames);
    return;
  }

  renderCatalogSkeleton(system);
  const games = await window.deck.catalogGames(system.gamesFile);
  if (request !== catalogRequest) return;
  state.catalogCache.set(system.gamesFile, games);
  applyCatalogCollection(system, games, enterGames);
}

function renderConsoleRail() {
  $('#consoleRail').innerHTML = state.catalog.map(system => {
    const active = state.catalogSystem?.id === system.id;
    const focused = state.discoverZone === 'systems' && state.focusedConsoleId === system.id;
    const installed = Number(system.installedCount || 0);
    return `<button type="button" class="console-card ${system.playable ? 'playable' : 'needs-setup'} ${active ? 'active' : ''} ${focused ? 'controller-focus' : ''}" data-id="${escapeHtml(system.id)}" title="${escapeHtml(system.issue || '')}"><span class="console-state">${system.playable ? 'READY' : 'SETUP'}</span><b>${escapeHtml(system.name)}</b><small><span>${system.count.toLocaleString()} TITLES</span>${installed ? `<span>${installed.toLocaleString()} ON DECK</span>` : ''}</small><img src="${escapeHtml(system.image)}" alt=""></button>`;
  }).join('');
  $$('.console-card').forEach(card => {
    card.onclick = () => { pulseUiHaptic('confirm', { force: true }); selectCatalog(card.dataset.id, true); };
    card.onmouseenter = () => {
      state.focusedConsoleId = card.dataset.id;
      state.discoverZone = 'systems';
      $$('.console-card').forEach(item => item.classList.toggle('controller-focus', item === card));
    };
  });
}

async function renderDiscover() {
  if (!state.catalog.length) state.catalog = await window.deck.catalogSystems();
  if (state.view !== 'discover') return;
  if (!state.focusedConsoleId && state.catalog.length) state.focusedConsoleId = state.catalog.find(system => system.id === 'snes')?.id || state.catalog[0].id;
  renderConsoleRail();
  if (!state.catalogSystem && state.focusedConsoleId) await selectCatalog(state.focusedConsoleId, false);
  else if (state.catalogSystem) {
    $('#catalogTitle').textContent = state.catalogSystem.name;
    $('#catalogCount').textContent = `${Number(state.catalogSystem.installedCount || 0).toLocaleString()} installed · ${state.catalogSystem.count.toLocaleString()} available · ${state.catalogSystem.playable ? 'emulator ready' : 'setup needed'}`;
    renderCatalogGames();
  }
}

function shortAddress(value) {
  const address = String(value || '');
  return address.length > 24 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

function readSettingsForm() {
  return {
    libraryRoot: $('#settingLibrary').value.trim(),
    rgsxRoot: $('#settingRgsx').value.trim(),
    retroArchPath: $('#settingRetroArch').value.trim(),
    retroArchCores: $('#settingCores').value.trim(),
    retroArchSystem: $('#settingSystem').value.trim(),
    mamePath: $('#settingMame').value.trim(),
    sponsorsEnabled: $('#settingSponsors').checked
  };
}

function settingsSignature(value) {
  const source = value || {};
  return JSON.stringify({
    libraryRoot: String(source.libraryRoot || '').trim(),
    rgsxRoot: String(source.rgsxRoot || '').trim(),
    retroArchPath: String(source.retroArchPath || '').trim(),
    retroArchCores: String(source.retroArchCores || '').trim(),
    retroArchSystem: String(source.retroArchSystem || '').trim(),
    mamePath: String(source.mamePath || '').trim(),
    sponsorsEnabled: source.sponsorsEnabled !== false
  });
}

function renderSettingsInspection(inspection) {
  if (!inspection?.fields) return;
  const fieldTargets = {
    libraryRoot: '#settingLibraryState',
    rgsxRoot: '#settingRgsxState',
    retroArchPath: '#settingRetroArchState',
    retroArchCores: '#settingCoresState',
    retroArchSystem: '#settingSystemState',
    mamePath: '#settingMameState'
  };
  for (const [key, selector] of Object.entries(fieldTargets)) {
    const element = $(selector);
    const field = inspection.fields[key];
    if (!element || !field) continue;
    element.textContent = field.message;
    element.classList.remove('ok', 'bad', 'muted');
    element.classList.add(field.tone || 'muted');
    element.closest('.setting-field')?.classList.toggle('path-ready', Boolean(field.ready));
  }
  const readiness = $('#settingsReadiness');
  readiness.classList.toggle('ready', Boolean(inspection.requiredReady));
  readiness.classList.toggle('attention', !inspection.requiredReady);
  $('#settingsReadinessIcon').textContent = inspection.requiredReady ? '✓' : '!';
  $('#settingsReadinessTitle').textContent = inspection.requiredReady ? inspection.summary : 'Library setup needs attention';
  $('#settingsReadinessMessage').textContent = inspection.requiredReady
    ? 'Optional emulator paths can be added as your collection grows.'
    : inspection.summary;
}

async function inspectSettingsForm() {
  const request = ++settingsInspectionRequest;
  try {
    const inspection = await window.deck.inspectSettings(readSettingsForm());
    if (request !== settingsInspectionRequest) return;
    renderSettingsInspection(inspection);
  } catch (error) {
    $('#settingsReadinessTitle').textContent = 'Could not validate paths';
    $('#settingsReadinessMessage').textContent = error.message || 'Path validation is temporarily unavailable.';
  }
}

function updateSettingsDirtyState(options = {}) {
  if (!state.settingsBaseline) return;
  const dirty = settingsSignature(readSettingsForm()) !== settingsSignature(state.settingsBaseline);
  $('#saveSettings').disabled = !dirty;
  $('#communitySettings').classList.toggle('has-unsaved', dirty);
  if (!options.preserveStatus) {
    $('#settingsStatus').textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  }
  clearTimeout(settingsInspectTimer);
  settingsInspectTimer = setTimeout(inspectSettingsForm, options.immediate ? 0 : 240);
}

function populateCommunity() {
  const settings = state.settings || {};
  $('#settingLibrary').value = settings.libraryRoot || '';
  $('#settingRgsx').value = settings.rgsxRoot || '';
  $('#settingRetroArch').value = settings.retroArchPath || '';
  $('#settingCores').value = settings.retroArchCores || '';
  $('#settingSystem').value = settings.retroArchSystem || '';
  $('#settingMame').value = settings.mamePath || '';
  $('#settingSponsors').checked = settings.sponsorsEnabled !== false;
  $('#runtimeBadge').textContent = `${String(settings.platform || 'desktop').toUpperCase()} · ${String(settings.arch || '')} · v${settings.version || 'dev'}`;
  state.settingsBaseline = readSettingsForm();
  updateSettingsDirtyState({ immediate: true });

  const sponsor = state.sponsors?.placements?.[0];
  const sponsorCard = $('#sponsorCard');
  if (state.sponsors?.enabled === false) {
    $('#sponsorEyebrow').textContent = 'SPONSOR PLACEMENTS OFF';
    $('#sponsorTitle').textContent = 'Your privacy choice is active';
    $('#sponsorBody').textContent = 'Community sponsor cards are hidden. You can turn them back on below at any time.';
    $('#sponsorAction').textContent = 'Review privacy setting';
    state.sponsorTarget = '';
  } else if (sponsor) {
    $('#sponsorEyebrow').textContent = sponsor.eyebrow || 'SPONSORED';
    $('#sponsorTitle').textContent = sponsor.title;
    $('#sponsorBody').textContent = sponsor.body;
    $('#sponsorAction').textContent = sponsor.cta || 'Learn more';
    state.sponsorTarget = sponsor.url || '';
    sponsorCard.style.setProperty('--sponsor-accent', sponsor.accent || '#72e7ff');
  }

  const donations = state.donations || {};
  const primaryDonation = (donations.methods || [])[0];
  $('#copyDonationAddress').disabled = !primaryDonation?.address;
  $('#copyDonationAddress').textContent = primaryDonation?.address ? `Copy ${primaryDonation.network || 'donation'} address` : 'Donation address coming soon';
  $('#donationHeadline').textContent = donations.headline || 'Fuel the next build';
  $('#donationMessage').textContent = donations.message || 'Public donation methods are being configured. Wallet secrets never ship with GameDeck.';
  $('#donationMethods').innerHTML = (donations.methods || []).map(method => `
    <button type="button" class="donation-method" data-address="${escapeHtml(method.address)}" title="Copy ${escapeHtml(method.label)} address">
      <b>${escapeHtml(method.label)}<small>${escapeHtml(method.network || 'Public receiving address')}</small></b>
      <code>${escapeHtml(shortAddress(method.address))}</code><span>COPY</span>
    </button>`).join('');
  $$('.donation-method').forEach(button => {
    button.onclick = async () => {
      await window.deck.copyText(button.dataset.address);
      button.querySelector('span').textContent = 'COPIED';
      toast('Donation address copied');
      setTimeout(() => { if (button.isConnected) button.querySelector('span').textContent = 'COPY'; }, 1600);
    };
  });
}

async function renderCommunity(force = false) {
  if (force || !state.settings || !state.sponsors || !state.donations) {
    const [settings, sponsors, donations] = await Promise.all([
      window.deck.settings(),
      window.deck.sponsors(),
      window.deck.donations()
    ]);
    state.settings = settings;
    state.sponsors = sponsors;
    state.donations = donations;
  }
  if (state.view === 'community') populateCommunity();
}

async function openCommunityLink(target) {
  const result = await window.deck.openExternal(target);
  if (!result?.ok) toast(result?.error || 'Could not open that link');
}

function setActiveView(view) {
  $$('.nav').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function setupReadiness() {
  const diagnostics = state.diagnostics || {};
  const runtime = state.runtime || diagnostics.managedRuntime || {};
  const games = state.library.games || [];
  const systems = state.library.systems || [];
  const installedSystems = systems.filter(system => Number(system.installedCount || system.count || 0) > 0);
  const readyInstalled = installedSystems.filter(system => system.ready);
  const readySystems = systems.filter(system => system.ready);
  const firmwareIssues = installedSystems.filter(system => String(system.issue || '').toLowerCase().includes('firmware'));
  const artworkCount = games.filter(game => Boolean(game.art)).length;
  const artworkCoverage = games.length ? Math.round((artworkCount / games.length) * 1000) / 10 : 0;
  const generatedArtworkCount = Math.max(0, games.length - artworkCount);
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const controllerReady = pads.length > 0 || state.controllerHints.length > 0;
  const runtimeReady = Boolean(runtime.ready || (!runtime.supported && diagnostics.retroarch));
  const libraryReady = games.length > 0;
  const launcherReady = games.length ? readyInstalled.length > 0 : readySystems.length > 0;
  const artworkReady = games.length > 0;
  const steps = [
    {
      id: 'runtime',
      label: 'Game engines',
      ready: runtimeReady,
      detail: runtimeReady
        ? `Included runtime ready${runtime.retroArchVersion ? ` · RetroArch ${runtime.retroArchVersion}` : ''}`
        : runtime.installing
          ? `${runtime.message || 'Installing included game engines'} ${Math.round(Number(runtime.progress || 0))}%`
          : runtime.supported
            ? 'Included with GameDeck. Finish setup once—no separate emulator installation.'
            : diagnostics.retroarch
              ? 'Compatible local RetroArch installation detected.'
              : 'No managed runtime is available for this device.'
    },
    {
      id: 'library',
      label: 'Your games',
      ready: libraryReady,
      detail: libraryReady
        ? `${games.length.toLocaleString()} title${games.length === 1 ? '' : 's'} found and organized.`
        : diagnostics.libraryExists
          ? 'Game folder is ready. Add games you legally own.'
          : 'GameDeck will create and manage a local game folder.'
    },
    {
      id: 'launchers',
      label: 'One-click play routes',
      ready: runtimeReady && launcherReady,
      detail: runtimeReady && launcherReady
        ? `${games.length ? readyInstalled.length : readySystems.length} compatible system route${(games.length ? readyInstalled.length : readySystems.length) === 1 ? '' : 's'} ready.`
        : runtimeReady
          ? 'Routes appear automatically as supported games are added.'
          : 'Game routes will activate after the included engines are installed.'
    },
    {
      id: 'firmware',
      label: 'Console firmware',
      ready: firmwareIssues.length === 0,
      detail: firmwareIssues.length
        ? `${firmwareIssues.length} installed system${firmwareIssues.length === 1 ? '' : 's'} need firmware you legally own. GameDeck will show the exact files.`
        : 'No missing firmware is blocking the installed collection.'
    },
    {
      id: 'controls',
      label: 'Controls',
      ready: true,
      detail: controllerReady ? 'Controller detected and couch mode is ready.' : 'Keyboard and mouse are ready; connect a controller anytime.'
    },
    {
      id: 'artwork',
      label: 'Artwork',
      ready: artworkReady,
      detail: games.length
        ? generatedArtworkCount
          ? `${Number.isInteger(artworkCoverage) ? artworkCoverage.toFixed(0) : artworkCoverage.toFixed(1)}% source matched · remaining titles use GameDeck artwork.`
          : '100% matched · every title has source artwork.'
        : 'Artwork matching starts automatically when games are added.'
    }
  ];
  return {
    steps,
    score: Math.round((steps.filter(step => step.ready).length / steps.length) * 100),
    runtimeReady,
    runtimeInstalling: Boolean(runtime.installing),
    libraryReady,
    launcherReady,
    firmwareIssues,
    artworkCoverage,
    generatedArtworkCount,
    coreReady: runtimeReady && libraryReady && launcherReady && firmwareIssues.length === 0
  };
}

function renderSetupCoach() {
  const coach = $('#setupCoach');
  if (!coach) return;
  const readiness = setupReadiness();
  const libraryView = !['discover', 'community'].includes(state.view);
  const needsHelp = !readiness.coreReady;
  const visible = libraryView && (state.setupCoachOpen || (!state.setupCoachDismissed && needsHelp));
  coach.classList.toggle('hidden', !visible);
  $('#setupToggle').classList.toggle('active', visible);
  $('#setupToggle').classList.toggle('attention', needsHelp);
  $('#setupToggle').setAttribute('aria-pressed', String(visible));
  if (!visible) return;

  $('#setupScore').textContent = `${readiness.score}%`;
  $('#setupCoachTitle').textContent = readiness.coreReady ? 'Your deck is ready to play.' : readiness.runtimeInstalling ? 'Installing everything GameDeck needs.' : 'One install. Then just play.';
  $('#setupCoachMessage').textContent = readiness.runtimeInstalling
    ? 'GameDeck is installing its included engines and will continue automatically.'
    : !readiness.runtimeReady
      ? 'The full emulator stack is included. Finish setup once—there are no separate emulator installers.'
      : !readiness.libraryReady
        ? 'The engines are ready. Add games you legally own to your GameDeck folder.'
        : readiness.firmwareIssues.length
          ? 'Most games are ready. A few consoles require firmware that must come from hardware or files you legally own.'
          : !readiness.launcherReady
            ? 'GameDeck is matching the installed collection to compatible play routes.'
            : readiness.artworkCoverage < 80
              ? 'Launching is ready. Artwork will continue filling in quietly.'
              : 'Engines, games, play routes, and controls are lined up.';
  $('#setupSteps').innerHTML = readiness.steps.map(step => `
    <div class="setup-step ${step.ready ? 'ready' : 'pending'}">
      <span class="setup-step-icon" aria-hidden="true">${step.ready ? '✓' : '·'}</span>
      <span><b>${escapeHtml(step.label)}</b><small>${escapeHtml(step.detail)}</small></span>
    </div>`).join('');
  const primary = $('#setupPrimary');
  if (!readiness.runtimeReady) {
    primary.textContent = readiness.runtimeInstalling ? 'Installing…' : 'Finish one-click setup';
    primary.dataset.action = 'install';
    primary.disabled = readiness.runtimeInstalling;
  } else if (!readiness.libraryReady) {
    primary.textContent = 'Open game folder';
    primary.dataset.action = 'folder';
    primary.disabled = false;
  } else {
    primary.textContent = readiness.coreReady ? 'Review settings' : 'Review what needs attention';
    primary.dataset.action = 'settings';
    primary.disabled = false;
  }
}

function surpriseMe() {
  if (['discover', 'community'].includes(state.view)) changeView('home');
  const candidates = currentGames().filter(game => {
    const system = systemById(game.system);
    return system?.ready && !gameLaunchBlocked(game);
  });
  if (!candidates.length) {
    state.setupCoachOpen = true;
    state.setupCoachDismissed = false;
    writePreference('setup-coach', 'open');
    renderSetupCoach();
    toast('Finish setup to unlock Surprise me');
    return;
  }
  const alternatives = candidates.filter(game => game.id !== state.focusedGameId);
  const pool = alternatives.length ? alternatives : candidates;
  const game = pool[Math.floor(Math.random() * pool.length)];
  setFocusedGame(game, { scroll: true });
  toast(`Tonight's pick: ${game.title}`);
}

async function runReadyCheck() {
  const button = $('#setupCheck');
  button.disabled = true;
  button.textContent = 'Checking…';
  setLoading(true, 'Running the ready check', 'Scanning games, launchers, artwork, and controller support.', 34);
  try {
    const runtime = state.runtime || state.diagnostics?.managedRuntime || await window.deck.runtimeStatus();
    if (runtime?.supported && !runtime.ready) state.runtime = await window.deck.ensureRuntime(false);
    state.library = await window.deck.rescan();
    await refreshDiagnostics();
    render();
    toast(setupReadiness().coreReady ? 'GameDeck is ready to play' : 'Ready check complete');
  } finally {
    button.disabled = false;
    button.textContent = 'Run ready check';
    setLoading(false);
  }
}

function openSetupSettings() {
  changeView('community');
  setTimeout(() => $('#communitySettings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function renderHeroActions(selected) {
  const button = $('#heroResume');
  const label = $('#heroResumeLabel');
  const icon = button.querySelector('span');
  const candidates = state.library.games.filter(game => {
    const system = systemById(game.system);
    if (!system?.ready || gameLaunchBlocked(game)) return false;
    if (selected && game.system !== selected.id) return false;
    if (state.view === 'favorites' && !game.favorite) return false;
    return true;
  });
  const recent = [...candidates].filter(game => game.lastPlayed).sort((a, b) => Number(b.lastPlayed) - Number(a.lastPlayed))[0];
  if (recent) {
    button.dataset.gameId = recent.id;
    icon.textContent = '▶';
    label.textContent = 'Continue ' + recent.title;
    button.title = 'Launch ' + recent.title;
  } else {
    delete button.dataset.gameId;
    icon.textContent = '✦';
    label.textContent = candidates.length ? 'Surprise me' : 'Finish setup';
    button.title = candidates.length ? 'Choose a playable game' : 'Open the ready check';
  }
  button.classList.toggle('needs-setup', !candidates.length);
  $('#heroDiscover').textContent = selected ? 'Discover more ' + (selected.short || selected.name) : 'Browse Discover';
}

function render() {
  renderSystems();
  window.renderHeaderOps?.();
  setActiveView(state.view);
  const discover = state.view === 'discover';
  const community = state.view === 'community';
  $('#discover').classList.toggle('hidden', !discover);
  $('#community').classList.toggle('hidden', !community);
  $('#games').classList.toggle('hidden', discover || community);
  $('.hero').classList.toggle('hidden', discover || community);
  renderSetupCoach();
  $('#spotlight').classList.toggle('hidden', discover || community || !focusedGame());
  renderArcadeDeck();
  $('.control-legend').classList.toggle('hidden', community);
  $('.toolbar').classList.toggle('hidden', community);
  $('#libraryTools').classList.toggle('hidden', discover || community);
  $('#discoverTools').classList.toggle('hidden', !discover || community);
  $('#catalogFilter').value = state.catalogFilter;
  $('#toolbarContext').textContent = discover ? 'DOWNLOADS STAY VISIBLE WHILE YOU BROWSE' : arcadeSelected() ? 'ARCHIVES ARE CHECKED BEFORE LAUNCH' : 'CLICK OR PRESS A TO LAUNCH';
  $('#search').placeholder = discover ? 'Search this console catalog' : 'Search your collection';
  updateSearchChrome();
  $('#gameSort').value = state.view === 'recent' ? 'recent' : state.sort;
  $('#gameSort').disabled = state.view === 'recent';

  if (community) {
    $('#empty').classList.add('hidden');
    renderCommunity().catch(error => toast(error.message || 'Community data is unavailable'));
    return;
  }

  if (discover) {
    $('#empty').classList.add('hidden');
    renderDiscover();
    return;
  }

  const selected = systemById(state.selectedSystem);
  $('#context').textContent = state.view === 'favorites' ? 'YOUR FAVORITES' : state.view === 'recent' ? 'RECENTLY PLAYED' : selected ? selected.name.toUpperCase() : 'ALL SYSTEMS';
  $('#headline').innerHTML = state.view === 'favorites'
    ? 'Saved for<br> <em>the next run.</em>'
    : state.view === 'recent'
      ? 'Jump straight<br> <em>back in.</em>'
      : selected?.id === 'arcade'
        ? 'Arcade legends.<br> <em>Checked before launch.</em>'
        : selected?.id === 'mame'
          ? 'The full cabinet.<br> <em>One clean launch.</em>'
          : selected ? `${escapeHtml(selected.name)}<br> <em>collection.</em>` : 'Your games.<br> <em>One move away.</em>';
  $('#subhead').textContent = selected?.id === 'arcade'
    ? 'FinalBurn Neo, full game names, matched artwork, and Xbox-ready controls.'
    : selected?.id === 'mame'
      ? 'Standalone MAME takes priority, validates ROM sets, and launches with couch controls.'
      : 'Pick a title and GameDeck chooses the right emulator automatically.';
  renderHeroActions(selected);
  $('#gameCount').textContent = currentGames().length;
  $('#systemCount').textContent = state.library.systems.filter(system => system.count).length;
  $('#readyCount').textContent = state.library.systems.filter(system => system.ready).length;
  renderGames();
}

function gridColumns(selector) {
  const items = $$(selector);
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  const columns = items.findIndex(item => item.offsetTop !== top);
  return columns === -1 ? items.length : columns;
}

function enterSystemZone() {
  state.libraryZone = 'systems';
  state.focusedLibrarySystem = state.selectedSystem;
  renderSystems();
  document.querySelector(`.system[data-id="${state.focusedLibrarySystem}"]`)?.scrollIntoView({ block: 'nearest' });
}

function communityControls() {
  const root = $('#community');
  if (!root || root.classList.contains('hidden')) return [];
  return [...root.querySelectorAll('button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')].filter(control => {
    const rect = control.getBoundingClientRect();
    for (let element = control; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.hidden
        || element.hasAttribute('hidden')
        || element.hasAttribute('inert')
        || element.getAttribute('aria-hidden') === 'true'
        || style.display === 'none'
        || style.visibility === 'hidden'
        || Number.parseFloat(style.opacity) === 0) return false;
    }
    return control.tabIndex >= 0
      && control.getAttribute('aria-disabled') !== 'true'
      && rect.width > 0
      && rect.height > 0;
  });
}

function moveCommunity(direction) {
  const controls = communityControls();
  if (!controls.length) return;
  const delta = direction === 'up' || direction === 'left' ? -1 : 1;
  const current = controls.indexOf(document.activeElement);
  const index = current === -1
    ? (delta > 0 ? 0 : controls.length - 1)
    : (current + delta + controls.length) % controls.length;
  const target = controls[index];
  controls.forEach(control => control.classList.toggle('controller-focus', control === target));
  target.focus({ preventScroll: true });
  const content = target.closest('.content');
  if (!content) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const edgePadding = 16;
  let nextTop = content.scrollTop;
  let nextLeft = content.scrollLeft;
  if (targetRect.top < contentRect.top + edgePadding) {
    nextTop += targetRect.top - contentRect.top - edgePadding;
  } else if (targetRect.bottom > contentRect.bottom - edgePadding) {
    nextTop += targetRect.bottom - contentRect.bottom + edgePadding;
  }
  if (targetRect.left < contentRect.left + edgePadding) {
    nextLeft += targetRect.left - contentRect.left - edgePadding;
  } else if (targetRect.right > contentRect.right - edgePadding) {
    nextLeft += targetRect.right - contentRect.right + edgePadding;
  }
  if (nextTop !== content.scrollTop || nextLeft !== content.scrollLeft) {
    content.scrollTo({ top: nextTop, left: nextLeft, behavior: 'instant' });
  }
}

function moveLibrary(direction) {
  if (state.view === 'community') {
    moveCommunity(direction);
    return;
  }
  if (state.libraryZone === 'systems') {
    const ids = ['all', ...state.library.systems.map(system => system.id)];
    let index = Math.max(0, ids.indexOf(state.focusedLibrarySystem));
    if (direction === 'up') index = (index - 1 + ids.length) % ids.length;
    if (direction === 'down') index = (index + 1) % ids.length;
    if (direction === 'right') {
      const first = currentGames()[0];
      if (first) { setFocusedGame(first, { scroll: true }); pulseUiHaptic('navigate'); }
      return;
    }
    state.focusedLibrarySystem = ids[index];
    pulseUiHaptic('navigate');
    renderSystems();
    document.querySelector(`.system[data-id="${state.focusedLibrarySystem}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }

  const games = currentGames();
  if (!games.length) {
    if (direction === 'left') enterSystemZone();
    return;
  }
  const columns = gridColumns('.game');
  let index = Math.max(0, games.findIndex(game => game.id === state.focusedGameId));
  if (direction === 'left' && index % columns === 0) {
    enterSystemZone();
    return;
  }
  if (direction === 'left') index -= 1;
  if (direction === 'right') index += 1;
  if (direction === 'up') index -= columns;
  if (direction === 'down') index += columns;
  index = Math.max(0, Math.min(games.length - 1, index));
  setFocusedGame(games[index], { scroll: true });
  pulseUiHaptic('navigate');
}

function moveDiscover(direction) {
  if (state.discoverZone === 'systems') {
    const ids = state.catalog.map(system => system.id);
    let index = Math.max(0, ids.indexOf(state.focusedConsoleId));
    if (direction === 'left') index = (index - 1 + ids.length) % ids.length;
    if (direction === 'right') index = (index + 1) % ids.length;
    if (direction === 'down') {
      const game = currentCatalogGames()[0];
      if (game) { setFocusedCatalogGame(game, { scroll: true }); pulseUiHaptic('navigate'); }
      return;
    }
    state.focusedConsoleId = ids[index];
    pulseUiHaptic('navigate');
    renderConsoleRail();
    document.querySelector(`.console-card[data-id="${state.focusedConsoleId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    return;
  }

  const games = currentCatalogGames();
  if (!games.length) return;
  const columns = gridColumns('.catalog-game');
  let index = Math.max(0, games.findIndex(game => game.id === state.focusedCatalogId));
  if (direction === 'up' && index < columns) {
    state.discoverZone = 'systems';
    renderConsoleRail();
    $$('.catalog-game').forEach(card => card.classList.remove('active'));
    return;
  }
  if (direction === 'left') index -= 1;
  if (direction === 'right') index += 1;
  if (direction === 'up') index -= columns;
  if (direction === 'down') index += columns;
  if (index >= games.length && (direction === 'right' || direction === 'down')) {
    const target = index;
    if (showMoreCatalog()) {
      const expandedGames = currentCatalogGames();
      setFocusedCatalogGame(expandedGames[Math.min(target, expandedGames.length - 1)], { scroll: true });
      pulseUiHaptic('navigate');
      return;
    }
  }
  index = Math.max(0, Math.min(games.length - 1, index));
  setFocusedCatalogGame(games[index], { scroll: true });
  pulseUiHaptic('navigate');
}

function activateFocused() {
  pulseUiHaptic('confirm', { force: true });
  if (state.view === 'community') {
    const target = document.activeElement;
    if (!$('#community')?.contains(target) || !communityControls().includes(target)) return;
    if (target.matches('input[type="checkbox"], input[type="radio"], button, a[href], input[type="button"], input[type="submit"], input[type="reset"]')) {
      target.click();
    } else {
      target.focus({ preventScroll: true });
    }
    return;
  }
  if (state.view === 'discover') {
    if (state.discoverZone === 'systems') {
      selectCatalog(state.focusedConsoleId, true);
    } else {
      catalogAction(focusedCatalogGame());
    }
    return;
  }
  if (state.libraryZone === 'systems') {
    selectLibrarySystem(state.focusedLibrarySystem);
    return;
  }
  const game = focusedGame() || currentGames()[0];
  if (game) launch(game.file);
}

function backAction() {
  pulseUiHaptic('back', { force: true });
  if (document.body.classList.contains('game-detail-open')) {
    closeGameDetails();
    return;
  }
  if (!$('#debugConsole').classList.contains('hidden')) {
    openConsole(false);
    return;
  }
  if (state.view === 'discover' && state.discoverZone === 'games') {
    state.discoverZone = 'systems';
    renderConsoleRail();
    return;
  }
  if (state.view !== 'home') changeView('home');
  else if (state.libraryZone === 'games') enterSystemZone();
}

async function setupFocusedSystem() {
  if (state.view === 'community') {
    toast('Choose a console from Library or Discover');
    return;
  }
  const systemId = state.view === 'discover'
    ? state.catalogSystem?.systemId || state.catalog.find(system => system.id === state.focusedConsoleId)?.systemId
    : state.focusedGameId
      ? focusedGame()?.system
      : state.focusedLibrarySystem === 'all' ? null : state.focusedLibrarySystem;
  if (!systemId) {
    toast('Choose a console to configure');
    return;
  }
  const result = await window.deck.setupSystem(systemId);
  if (!result.ok) {
    toast(result.error || 'Could not open console setup');
    openConsole(true);
    return;
  }
  if (result.queued) {
    toast('Firmware download started through RGSX');
    state.transferExpanded = true;
    renderDownloads();
  } else toast(result.issue || 'Console is already configured');
}

function updateSearchChrome() {
  const search = $('#search');
  const clear = $('#searchClear');
  if (!search || !clear) return;
  const hasQuery = Boolean(search.value.trim());
  clear.classList.toggle('hidden', !hasQuery);
  clear.setAttribute('aria-hidden', String(!hasQuery));
  search.closest('.search')?.classList.toggle('has-query', hasQuery);
}

function clearSearch(options = {}) {
  $('#search').value = '';
  if (state.view === 'discover') {
    state.catalogQuery = '';
    state.focusedCatalogId = null;
    state.catalogLimit = CATALOG_PAGE_SIZE;
    if (state.catalogSystem) {
      const memory = state.catalogMemory[state.catalogSystem.id] || {};
      state.catalogMemory[state.catalogSystem.id] = { ...memory, query: '', limit: state.catalogLimit, focusedCatalogId: null };
    }
  } else {
    state.query = '';
  }
  updateSearchChrome();
  render();
  if (options.focus) $('#search').focus();
}

function setRescanBusy(active) {
  const button = $('#rescan');
  button.disabled = active;
  button.classList.toggle('scanning', active);
  button.setAttribute('aria-busy', String(active));
  $('#rescanLabel').textContent = active ? 'Scanning' : 'Refresh';
}

function updateScrollChrome(content = $('.content')) {
  const scrolled = Number(content?.scrollTop || 0) > 24;
  $('#libraryToolbar')?.classList.toggle('is-stuck', scrolled);
  document.body.classList.toggle('content-scrolled', scrolled);
}

function changeView(view) {
  rememberShelfPosition();
  if (state.view === 'discover' && view !== 'discover') rememberCatalogContext();
  state.view = view;
  state.query = '';
  $('#search').value = view === 'discover' ? state.catalogQuery : '';
  if (view === 'discover') state.discoverZone = 'systems';
  else state.libraryZone = 'games';
  prepareRememberedShelf();
  render();
  restoreShelfPosition();
}

function cycleView(delta = 1) {
  pulseUiHaptic('navigate');
  const index = views.indexOf(state.view);
  changeView(views[(index + delta + views.length) % views.length]);
}

const gamepadState = { buttons: [], direction: null, nextRepeat: 0, initialized: false, armed: false, acceptAfter: performance.now() + 1500 };

function gamepadButtons(pad) {
  return [...(pad?.buttons || [])].map(button => Boolean(button?.pressed));
}

function gamepadDirection(pad) {
  if (pad.buttons[12]?.pressed || (pad.axes[1] || 0) < -0.7) return 'up';
  if (pad.buttons[13]?.pressed || (pad.axes[1] || 0) > 0.7) return 'down';
  if (pad.buttons[14]?.pressed || (pad.axes[0] || 0) < -0.7) return 'left';
  if (pad.buttons[15]?.pressed || (pad.axes[0] || 0) > 0.7) return 'right';
  return null;
}

function gamepadNeutral(pad) {
  return !gamepadDirection(pad) && !gamepadButtons(pad).some(Boolean);
}

function rearmGamepadInput(delay = 320) {
  gamepadState.buttons = [];
  gamepadState.direction = null;
  gamepadState.nextRepeat = 0;
  gamepadState.initialized = false;
  gamepadState.armed = false;
  gamepadState.acceptAfter = performance.now() + Math.max(0, Number(delay || 0));
}

function handleGamepad() {
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  setControllerStatus();
  if (!pad) {
    gamepadState.initialized = false;
    gamepadState.armed = false;
    return;
  }

  const buttons = gamepadButtons(pad);
  const direction = gamepadDirection(pad);
  const snapshot = () => {
    gamepadState.buttons = buttons;
    gamepadState.direction = direction;
    gamepadState.nextRepeat = direction ? Number.POSITIVE_INFINITY : 0;
    gamepadState.initialized = true;
  };

  if (state.playSession?.active) {
    const changed = direction !== gamepadState.direction
      || buttons.some((pressed, index) => pressed && !gamepadState.buttons[index]);
    if (changed) setInputMode('controller');
    snapshot();
    gamepadState.armed = false;
    return;
  }

  if (document.body.classList.contains('game-detail-open')) {
    const pressed = index => Boolean(buttons[index] && !gamepadState.buttons[index]);
    if (pressed(1)) backAction();
    if (pressed(0)) {
      closeGameDetails({ restoreFocus: false });
      activateFocused();
    }
    snapshot();
    return;
  }

  if (document.body.classList.contains('modal-open')) {
    snapshot();
    gamepadState.armed = false;
    return;
  }

  const now = performance.now();
  if (!gamepadState.initialized || now < gamepadState.acceptAfter || !gamepadState.armed) {
    snapshot();
    if (now >= gamepadState.acceptAfter && gamepadNeutral(pad)) {
      gamepadState.armed = true;
      gamepadState.nextRepeat = 0;
    }
    return;
  }

  if (direction && (direction !== gamepadState.direction || now >= gamepadState.nextRepeat)) {
    if (state.view === 'discover') moveDiscover(direction);
    else moveLibrary(direction);
    gamepadState.nextRepeat = now + (direction === gamepadState.direction ? 145 : 330);
  }
  if (!direction) gamepadState.nextRepeat = 0;
  gamepadState.direction = direction;

  const pressed = index => Boolean(buttons[index] && !gamepadState.buttons[index]);
  const startIndex = pad.mapping === 'standard' ? 9 : 7;
  const actions = {
    select: pressed(0), back: pressed(1), surprise: pressed(2), setup: pressed(3),
    previous: pressed(4), next: pressed(5), activity: pressed(8), start: pressed(startIndex)
  };
  if (direction || Object.values(actions).some(Boolean)) setInputMode('controller');
  if (actions.select) activateFocused();
  if (actions.back) backAction();
  if (actions.surprise && !['discover', 'community'].includes(state.view)) surpriseMe();
  if (actions.setup) setupFocusedSystem();
  if (actions.previous) cycleView(-1);
  if (actions.next) cycleView(1);
  if (actions.activity) openConsole($('#debugConsole').classList.contains('hidden'));
  if (actions.start) window.GameDeckMultiplayer?.open?.();
  gamepadState.buttons = buttons;
}


function formatActivity(entry) {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `[${time}] ${entry.level.toUpperCase().padEnd(7)} ${entry.message}`;
}

function activityCategory(entry) {
  if (entry.level === 'error' || entry.level === 'warning') return 'issues';
  if (entry.level === 'success') return 'success';
  return 'info';
}

function activityGlyph(category) {
  return category === 'issues' ? '!' : category === 'success' ? '✓' : 'i';
}

function groupedActivities(entries) {
  const groups = [];
  const byKey = new Map();
  for (const entry of [...entries].reverse()) {
    const key = `${entry.level}:${entry.message}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const group = { ...entry, count: 1 };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups.slice(0, 120);
}

function updateStatusBadge() {
  const badge = $('#activityCount');
  const button = $('#consoleToggle');
  if (!badge || !button) return;
  const recentThreshold = Date.now() - (10 * 60 * 1000);
  const issues = state.activities.filter(entry => activityCategory(entry) === 'issues' && Number(entry.at || 0) >= recentThreshold).length;
  const running = state.downloads.filter(download => download.status === 'running').length;
  const value = issues || running;
  badge.textContent = String(value);
  badge.classList.toggle('hidden', value === 0);
  badge.classList.toggle('issue', issues > 0);
  button.classList.toggle('has-issue', issues > 0);
  button.classList.toggle('has-transfer', issues === 0 && running > 0);
  button.title = issues
    ? `${issues} recent issue${issues === 1 ? '' : 's'} · open status center`
    : running
      ? `${running} active transfer${running === 1 ? '' : 's'} · open status center`
      : 'Open status center';
}

function renderActivity() {
  const output = $('#debugOutput');
  const issueCount = state.activities.filter(entry => activityCategory(entry) === 'issues').length;
  const successCount = state.activities.filter(entry => activityCategory(entry) === 'success').length;
  const running = state.downloads.filter(download => download.status === 'running').length;
  $('#statusAllCount').textContent = String(state.activities.length);
  $('#statusIssueCount').textContent = String(issueCount);
  $('#statusSuccessCount').textContent = String(successCount);

  const title = issueCount
    ? `${issueCount} issue${issueCount === 1 ? '' : 's'} need attention`
    : running
      ? `${running} transfer${running === 1 ? '' : 's'} in progress`
      : state.activities.length
        ? 'Everything looks healthy'
        : 'Everything looks quiet';
  const message = issueCount
    ? 'Open an issue below for the exact launcher, file, or network detail.'
    : running
      ? 'Transfers continue in the dock while you browse.'
      : state.activities.length
        ? 'Recent checks and actions completed without a blocking problem.'
        : 'No recent issues or transfers.';
  $('#statusSummaryTitle').textContent = title;
  $('#statusSummaryMessage').textContent = message;
  $('.status-summary').classList.toggle('attention', issueCount > 0);
  $('.status-summary').classList.toggle('active', issueCount === 0 && running > 0);

  document.querySelectorAll('[data-activity-filter]').forEach(button => {
    const active = button.dataset.activityFilter === state.activityFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const filtered = state.activities.filter(entry => {
    if (state.activityFilter === 'issues') return activityCategory(entry) === 'issues';
    if (state.activityFilter === 'success') return activityCategory(entry) === 'success';
    return true;
  });
  const groups = groupedActivities(filtered);
  if (!groups.length) {
    const copy = state.activityFilter === 'issues'
      ? 'No issues are recorded.'
      : state.activityFilter === 'success'
        ? 'No completed actions are recorded yet.'
        : 'Waiting for activity…';
    output.innerHTML = `<div class="activity-empty"><span aria-hidden="true">${state.activityFilter === 'issues' ? '✓' : '·'}</span><b>${escapeHtml(copy)}</b><small>GameDeck will add launcher, transfer, and setup events here.</small></div>`;
  } else {
    output.innerHTML = groups.map(entry => {
      const category = activityCategory(entry);
      const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const count = entry.count > 1 ? `<span class="activity-repeat">×${entry.count}</span>` : '';
      return `<article class="activity-row ${category}"><span class="activity-glyph" aria-hidden="true">${activityGlyph(category)}</span><div><b>${escapeHtml(entry.message)}</b><small>${time} · ${escapeHtml(String(entry.level || 'info').toUpperCase())}</small></div>${count}</article>`;
    }).join('');
  }
  output.scrollTop = 0;
  updateStatusBadge();
}

function diagnosticReport() {
  const diagnostics = state.diagnostics || {};
  const systems = (diagnostics.systems || []).map(system => `${system.ready ? 'READY' : 'SETUP'}  ${system.name}${system.issue ? ` — ${system.issue}` : ''}`).join('\n');
  const activity = state.activities.slice(-80).map(formatActivity).join('\n');
  return [
    'GAMEDECK STATUS REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    `Version: ${diagnostics.settings?.version || state.settings?.version || 'development'}`,
    `Platform: ${diagnostics.platform || state.settings?.platform || 'desktop'} ${diagnostics.arch || state.settings?.arch || ''}`.trim(),
    `Library: ${diagnostics.library || state.settings?.libraryRoot || 'not configured'}`,
    `Discover provider: ${diagnostics.rgsxRuntime ? 'connected' : 'optional / not connected'}`,
    `RetroArch: ${diagnostics.retroarch ? 'ready' : 'missing'}`,
    `MAME: ${diagnostics.mame ? 'ready' : 'missing'}`,
    '',
    'SYSTEMS',
    systems || 'No system diagnostics available.',
    '',
    'RECENT ACTIVITY',
    activity || 'No activity recorded.'
  ].join('\n');
}

async function refreshDiagnostics(includeLibrary = false) {
  const diagnostics = await window.deck.diagnostics(includeLibrary);
  state.diagnostics = diagnostics;
  state.controllerHints = diagnostics.controllers || [];
  state.activities = diagnostics.activity || [];
  state.downloads = diagnostics.downloads || [];
  $('#debugHealth').innerHTML = `<span class="${diagnostics.rgsxRuntime ? 'ok' : ''}">DISCOVER ${diagnostics.rgsxRuntime ? 'CONNECTED' : 'OPTIONAL'}</span><span class="${diagnostics.retroarch ? 'ok' : 'bad'}">RETROARCH ${diagnostics.retroarch ? 'READY' : 'MISSING'}</span><span class="${diagnostics.mame ? 'ok' : 'bad'}">MAME ${diagnostics.mame ? 'READY' : 'MISSING'}</span><span>${state.arcadeAudit?.verified || diagnostics.arcade?.verified || 0}/${state.arcadeAudit?.total || diagnostics.arcade?.total || 0} ARCADE VERIFIED</span><span>${diagnostics.systems.filter(system => system.ready).length} EMULATORS</span><span>${diagnostics.downloads.filter(download => download.status === 'running').length} ACTIVE</span>`;
  renderActivity();
  renderDownloads();
}

let consoleReturnFocus = null;

function openConsole(show) {
  const console = $('#debugConsole');
  const wasHidden = console.classList.contains('hidden');
  if (show && wasHidden) consoleReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  console.classList.toggle('hidden', !show);
  $('#consoleToggle').classList.toggle('active', show);
  if (show) {
    refreshDiagnostics();
    setTimeout(() => $('#consoleClose')?.focus(), 0);
  } else if (!wasHidden) {
    const target = consoleReturnFocus;
    consoleReturnFocus = null;
    setTimeout(() => {
      const visible = target && target.isConnected && !target.closest('.hidden') && getComputedStyle(target).visibility !== 'hidden';
      (visible ? target : $('#headerMenuToggle'))?.focus?.({ preventScroll: true });
    }, 0);
  }
}

async function loadLibrary(shouldRender = true) {
  state.library = await window.deck.library();
  if (shouldRender) render();
  else {
    renderSystems();
    if (state.view !== 'discover') renderGames();
  }
  renderDownloads();
  scheduleArtworkEnrichment();
}

async function refreshCatalogAfterDownload(taskId) {
  if (!taskId || completionRefreshes.has(taskId)) return;
  completionRefreshes.add(taskId);
  const gameKey = [...state.activeCatalogTasks.entries()].find(([, id]) => id === taskId)?.[0];
  if (gameKey != null) state.activeCatalogTasks.delete(gameKey);
  await loadLibrary(state.view !== 'discover');
  if (state.view === 'discover' && state.catalogSystem) {
    const games = await window.deck.catalogGames(state.catalogSystem.gamesFile);
    state.catalogGames = games;
    state.catalogCache.set(state.catalogSystem.gamesFile, games);
    state.catalogSystem.count = games.length;
    state.catalogSystem.installedCount = games.filter(game => game.installedFile).length;
    renderCatalogGames();
  }
}

for (const button of document.querySelectorAll('.nav')) button.onclick = () => changeView(button.dataset.view);
$('#heroResume').onclick = () => {
  const gameId = $('#heroResume').dataset.gameId;
  if (gameId) {
    const game = state.library.games.find(item => item.id === gameId);
    if (game) {
      setFocusedGame(game, { scroll: true });
      launch(game.file);
      return;
    }
  }
  if ($('#heroResume').classList.contains('needs-setup')) {
    state.setupCoachOpen = true;
    state.setupCoachDismissed = false;
    renderSetupCoach();
    $('#setupCoach').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  surpriseMe();
};
$('#heroDiscover').onclick = () => changeView('discover');
$('#setupToggle').onclick = () => {
  const currentlyVisible = !$('#setupCoach').classList.contains('hidden');
  state.setupCoachOpen = !currentlyVisible;
  state.setupCoachDismissed = false;
  writePreference('setup-coach', state.setupCoachOpen ? 'open' : 'auto');
  if (state.setupCoachOpen && ['discover', 'community'].includes(state.view)) changeView('home');
  else renderSetupCoach();
};
$('#setupDismiss').onclick = () => {
  state.setupCoachOpen = false;
  state.setupCoachDismissed = true;
  writePreference('setup-coach', 'dismissed');
  renderSetupCoach();
};
$('#setupPrimary').onclick = async event => {
  const action = event.currentTarget.dataset.action;
  if (action === 'install') {
    event.currentTarget.disabled = true;
    setLoading(true, 'Finishing one-click setup', 'Installing the complete GameDeck runtime from the included verified packages.', 12);
    const result = await window.deck.ensureRuntime(false);
    state.runtime = result;
    await refreshDiagnostics();
    render();
    if (result?.ready) toast('GameDeck setup complete', 'success');
    else {
      state.setupCoachOpen = true;
      toast(result?.message || 'Setup needs attention.', 'warning');
    }
    return;
  }
  if (action === 'folder') {
    await window.deck.openLibrary();
    return;
  }
  openSetupSettings();
};
$('#setupCheck').onclick = () => runReadyCheck();
$('#surpriseMe').onclick = () => surpriseMe();
$('#sidebarToggle').onclick = toggleSidebar;
$('#tutorialOpen').onclick = () => window.deck.openExternal('https://youtu.be/vY-fFVu2ClM');
const headerMenuToggle = $('#headerMenuToggle');
const headerMenu = $('#headerMenu');
function closeHeaderMenu() {
  if (!headerMenu || !headerMenuToggle) return;
  headerMenu.classList.add('hidden');
  headerMenuToggle.setAttribute('aria-expanded', 'false');
}
function toggleHeaderMenu() {
  if (!headerMenu || !headerMenuToggle) return;
  const opening = headerMenu.classList.contains('hidden');
  headerMenu.classList.toggle('hidden', !opening);
  headerMenuToggle.setAttribute('aria-expanded', String(opening));
  if (opening) headerMenu.querySelector('button')?.focus({ preventScroll: true });
}
headerMenuToggle.onclick = event => {
  event.stopPropagation();
  toggleHeaderMenu();
};
headerMenu.addEventListener('click', event => {
  if (event.target.closest('button')) closeHeaderMenu();
});
document.addEventListener('pointerdown', event => {
  if (!headerMenu.classList.contains('hidden') && !event.target.closest('.head-actions')) closeHeaderMenu();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !headerMenu.classList.contains('hidden')) {
    closeHeaderMenu();
    headerMenuToggle.focus({ preventScroll: true });
  }
});

$('#artworkFilter').value = state.artworkFilter;
$('#artworkFilter').onchange = event => {
  state.artworkFilter = event.target.value === 'missing-art' ? 'missing-art' : 'all';
  state.focusedGameId = null;
  writePreference('artwork-filter', state.artworkFilter);
  render();
};
$('#catalogFilter').onchange = event => {
  state.catalogFilter = ['available', 'downloaded', 'installed'].includes(event.target.value) ? event.target.value : 'all';
  state.focusedCatalogId = null;
  state.catalogLimit = CATALOG_PAGE_SIZE;
  renderCatalogGames();
};
$('#gameSort').onchange = event => {
  if (!GAME_SORTS.has(event.target.value)) return;
  state.sort = event.target.value;
  writePreference('sort', state.sort);
  render();
};
$('#search').oninput = event => {
  if (state.view === 'discover') {
    state.catalogQuery = event.target.value.toLowerCase();
    state.focusedCatalogId = null;
    state.catalogLimit = CATALOG_PAGE_SIZE;
    if (state.catalogSystem) {
      const memory = state.catalogMemory[state.catalogSystem.id] || {};
      state.catalogMemory[state.catalogSystem.id] = { ...memory, query: state.catalogQuery, filter: state.catalogFilter, limit: state.catalogLimit, focusedCatalogId: null };
    }
    renderCatalogGames();
  } else {
    state.query = event.target.value.toLowerCase();
    render();
  }
};

$('#searchClear').onclick = () => clearSearch({ focus: true });

$$('[data-play-mode]').forEach(button => {
  button.onclick = async () => {
    await setPlayMode(button.dataset.playMode);
    settlePlayChrome(720);
  };
});
const playCloseButton = $('#playClose');
playCloseButton.onpointerdown = event => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  stopIntegratedPlay('player_closed');
};
playCloseButton.onclick = event => {
  if (event.detail !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  stopIntegratedPlay('player_closed');
};
$('#playCapturePopout').onclick = () => setPlayMode('popout');
$('#playHapticsToggle').onclick = async () => {
  const previousPreference = state.hapticPreference;
  const nextIndex = (HAPTIC_PREFERENCE_ORDER.indexOf(previousPreference) + 1) % HAPTIC_PREFERENCE_ORDER.length;
  state.hapticPreference = HAPTIC_PREFERENCE_ORDER[nextIndex];
  writePreference('haptics', state.hapticPreference);
  const controller = ensurePlayHaptics();
  controller?.setPreference(state.hapticPreference);
  playHapticSessionKey = '';
  playHapticStream = null;
  const status = state.playSession;
  const audioRequirementChanged = shouldCaptureHapticAudio(status, previousPreference) !== shouldCaptureHapticAudio(status, state.hapticPreference);
  if (status?.active && status.mode !== 'popout' && status.captureReady && audioRequirementChanged) {
    stopPlayCapture();
    await acquirePlayCapture(status).catch(() => {});
  } else {
    syncPlayHaptics(status);
  }
  settlePlayChrome(720);
};
$('#playCaptureRetry').onclick = () => {
  $('#playCaptureError').classList.add('hidden');
  stopPlayCapture();
  acquirePlayCapture(state.playSession);
};

const playSurface = $('#playSurface');
const playHeader = playSurface.querySelector('.play-header');
const playFooter = playSurface.querySelector('.play-footer');
const playStageObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => applyPlayGeometry()) : null;
playStageObserver?.observe($('#playStage'));
window.addEventListener('resize', () => requestAnimationFrame(applyPlayGeometry));
playSurface.addEventListener('mousemove', () => {
  showPlayPointer(1800);
  showFullscreenControls(2200);
});
for (const chrome of [playHeader, playFooter]) {
  chrome?.addEventListener('focusin', () => { showPlayPointer(0); showFullscreenControls(0); });
  chrome?.addEventListener('focusout', () => settlePlayChrome(600));
}

document.onkeydown = event => {
  setInputMode('keyboard');
  if (state.playSession?.active) {
    if (event.key === 'F11') {
      event.preventDefault();
      setPlayMode(state.playSession.mode === 'fullscreen' ? 'docked' : 'fullscreen');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const surface = $('#playSurface');
      if (surface?.classList.contains('play-chrome-hidden')) {
        showPlayPointer(2200);
        showFullscreenControls(2200);
      } else {
        hideFullscreenControls(true);
        hidePlayPointer();
      }
    }
    return;
  }
  if (document.body.classList.contains('game-detail-open')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      backAction();
    }
    return;
  }
  if (document.body.classList.contains('modal-open')) return;
  if (event.key.toLowerCase() === 'm' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    window.GameDeckMultiplayer?.open?.();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleSidebar();
    return;
  }
  if (event.key === '/' && document.activeElement !== $('#search')) {
    event.preventDefault();
    $('#search').focus();
    return;
  }
  if (event.key === '`') {
    event.preventDefault();
    openConsole($('#debugConsole').classList.contains('hidden'));
    return;
  }
  if (event.key === 'Escape' && document.activeElement === $('#search')) {
    event.preventDefault();
    if ($('#search').value) clearSearch({ focus: true });
    else $('#search').blur();
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(document.activeElement?.tagName) && event.key !== 'Escape') return;
  if (event.key === 'Escape') { event.preventDefault(); backAction(); return; }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateFocused(); return; }
  const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key];
  if (direction) {
    event.preventDefault();
    if (state.view === 'discover') moveDiscover(direction);
    else moveLibrary(direction);
  }
};

$('#rescan').onclick = async () => {
  setRescanBusy(true);
  setLoading(true, 'Refreshing your deck', 'Scanning installed games and matching each title to its console.', 28);
  try {
    state.library = await window.deck.rescan();
    state.catalogCache.clear();
    setLoading(true, 'Finishing the refresh', 'Updating artwork, favorites, and recent activity.', 86);
    await refreshDiagnostics();
    render();
    artworkEnrichmentTried.clear();
    scheduleArtworkEnrichment(1800);
    refreshArcadeAudit(false);
    toast('RGSX library refreshed');
  } finally {
    setLoading(false);
    setRescanBusy(false);
  }
};
$('#arcadeAuditButton').onclick = () => refreshArcadeAudit(true);
$$('[data-arcade-filter]').forEach(button => {
  button.onclick = () => {
    state.arcadeFilter = button.dataset.arcadeFilter;
    state.focusedGameId = null;
    render();
  };
});
$('#folder').onclick = () => window.deck.openLibrary();
$('#emptyPrimary').onclick = event => runEmptyAction(event.currentTarget.dataset.action);
$('#emptySecondary').onclick = event => runEmptyAction(event.currentTarget.dataset.action);
$('#spotlightPlay').onclick = () => {
  closeGameDetails({ restoreFocus: false });
  activateFocused();
};
$('#spotlightFav').onclick = () => {
  const game = focusedGame();
  if (game) {
    pulseUiHaptic('favorite', { force: true });
    toggleFavorite(game);
  }
};
$('#spotlightShare').onclick = () => shareFocusedGame();
$('#spotlightClose').onclick = () => closeGameDetails();
$('#spotlightDismiss').onclick = () => closeGameDetails();
$('#spotlightArtwork').onclick = () => chooseFocusedArtwork();
$('#spotlightDetails').onclick = () => refreshFocusedDetails();
$('#spotlightDelete').onclick = () => deleteFocusedGame();
$('#catalogFeatureAction').onclick = () => catalogAction(focusedCatalogGame() || currentCatalogGames()[0]);
$('#catalogSetup').onclick = () => setupFocusedSystem();
$('#catalogMore').onclick = () => showMoreCatalog(true);
$('#consoleToggle').onclick = () => openConsole($('#debugConsole').classList.contains('hidden'));
$('#consoleClose').onclick = () => openConsole(false);
$('#consoleCopy').onclick = async () => {
  await window.deck.copyText(diagnosticReport());
  toast('Status report copied', 'success');
};
document.querySelectorAll('[data-activity-filter]').forEach(button => {
  button.onclick = () => {
    state.activityFilter = button.dataset.activityFilter;
    renderActivity();
  };
});
$('#consoleClear').onclick = async () => {
  await window.deck.clearActivity();
  state.activities = [];
  renderActivity();
};
$('#transferSummary').onclick = () => {
  state.transferExpanded = !state.transferExpanded;
  renderDownloads();
};
$('#transferOpenLibrary').onclick = () => window.deck.openLibrary();
$('#transferDismissFinished').onclick = async () => {
  const finished = state.downloads.filter(download => ['complete', 'error'].includes(download.status));
  await Promise.all(finished.map(download => window.deck.dismissDownload(download.id)));
  const ids = new Set(finished.map(download => download.id));
  state.downloads = state.downloads.filter(download => !ids.has(download.id));
  if (!state.downloads.some(download => ['running', 'paused'].includes(download.status))) state.transferExpanded = false;
  renderDownloads();
  toast('Finished transfers dismissed');
};

$('#openGithub').onclick = () => openCommunityLink(GAMEDECK_LINKS.github);
$('#openDiscussions').onclick = () => openCommunityLink(COMMUNITY_LINKS.hub);
$('#openPlayerDiscussion').onclick = () => openCommunityLink(COMMUNITY_LINKS.players);
$('#openReleases').onclick = () => openCommunityLink(COMMUNITY_LINKS.announcements);
$('#openSupport').onclick = () => openCommunityLink(COMMUNITY_LINKS.support);
$('#openShowcase').onclick = () => openCommunityLink(COMMUNITY_LINKS.showcase);
$('#copyPlayerDiscussion').onclick = async () => {
  await window.deck.copyText(COMMUNITY_LINKS.players);
  $('#copyPlayerDiscussion').textContent = 'Tester link copied';
  toast('GameDeck player discussion copied');
  setTimeout(() => { if ($('#copyPlayerDiscussion')) $('#copyPlayerDiscussion').textContent = 'Copy tester link'; }, 1800);
};
function playTonightCopy() {
  const game = focusedGame();
  const title = game?.title || '[GAME TITLE]';
  return `🎮 Looking for players tonight: ${title}\n\nMode: Remote Play Together or synchronized netplay\nPlayers needed: 1–3\nTimezone: [YOUR TIMEZONE]\nStart window: [TIME]\n\nOnly the host needs the game for Remote Play. For synchronized netplay, both players need matching game and core IDs.\n\nJoin GameDeck matchmaking: ${COMMUNITY_LINKS.players}\nDownload: ${GAMEDECK_LINKS.site}`;
}

async function copyShareText(button, value, successLabel, toastLabel) {
  await window.deck.copyText(value);
  const label = button.querySelector('b');
  const original = label?.textContent || button.textContent;
  if (label) label.textContent = successLabel;
  else button.textContent = successLabel;
  toast(toastLabel);
  setTimeout(() => {
    if (!button.isConnected) return;
    const currentLabel = button.querySelector('b');
    if (currentLabel) currentLabel.textContent = original;
    else button.textContent = original;
  }, 1800);
}
$('#copyRedditLaunch').onclick = () => copyShareText($('#copyRedditLaunch'), GAMEDECK_SHARE_COPY.reddit, 'Reddit post copied', 'Feedback-first Reddit launch copied');
$('#copyShortCaption').onclick = () => copyShareText($('#copyShortCaption'), GAMEDECK_SHARE_COPY.short, 'Caption copied', 'Short-form caption copied');
$('#copyYoutubeComment').onclick = () => copyShareText($('#copyYoutubeComment'), GAMEDECK_SHARE_COPY.youtube, 'YouTube comment copied', 'Useful YouTube comment copied');
$('#copyLinkedInLaunch').onclick = () => copyShareText($('#copyLinkedInLaunch'), GAMEDECK_SHARE_COPY.linkedin, 'LinkedIn post copied', 'LinkedIn launch post copied');
$('#copyFacebookLaunch').onclick = () => copyShareText($('#copyFacebookLaunch'), GAMEDECK_SHARE_COPY.facebook, 'Facebook post copied', 'Facebook group post copied');
$('#copyPlayTonight').onclick = () => copyShareText($('#copyPlayTonight'), playTonightCopy(), 'Player call copied', 'Looking-for-players post copied');
$('#copyCreatorPitch').onclick = () => copyShareText($('#copyCreatorPitch'), GAMEDECK_SHARE_COPY.creator, 'Creator pitch copied', 'Personalized creator pitch copied');
$('#copyCommunityEvent').onclick = () => copyShareText($('#copyCommunityEvent'), GAMEDECK_SHARE_COPY.event, 'Event post copied', 'Remote Play Friday post copied');
$('#openShortsPlaylist').onclick = () => openCommunityLink(GAMEDECK_LINKS.shorts);
$('#openGithubStar').onclick = () => openCommunityLink(GAMEDECK_LINKS.github);
$('#openContributing').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/blob/main/CONTRIBUTING.md');
$('#openArcadeGuide').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/blob/main/docs/ARCADE.md');
$('#openArcadeFeedback').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/issues/new/choose');
$('#openFunding').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/blob/main/FUNDING.md');
$('#supportTransparency').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/blob/main/FUNDING.md');
$('#sponsorPrimary').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/issues/new?template=sponsorship.yml');
$('#copyDonationAddress').onclick = async () => {
  const method = (state.donations?.methods || [])[0];
  if (!method?.address) return;
  await window.deck.copyText(method.address);
  $('#copyDonationAddress').textContent = 'Address copied';
  toast('Donation address copied');
  setTimeout(() => { if ($('#copyDonationAddress')) $('#copyDonationAddress').textContent = `Copy ${method.network || 'donation'} address`; }, 1800);
};
$('#sponsorAction').onclick = () => {
  if (state.sponsorTarget) openCommunityLink(state.sponsorTarget);
  else $('#settingSponsors').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

$$('[data-browse]').forEach(button => {
  button.onclick = async () => {
    const setting = button.dataset.browse;
    const result = await window.deck.chooseDirectory(setting);
    if (result?.canceled || !result?.path) return;
    const input = {
      libraryRoot: '#settingLibrary',
      rgsxRoot: '#settingRgsx',
      retroArchPath: '#settingRetroArch',
      retroArchCores: '#settingCores',
      retroArchSystem: '#settingSystem',
      mamePath: '#settingMame'
    }[setting];
    if (input) {
      $(input).value = result.path;
      updateSettingsDirtyState({ immediate: true });
    }
  };
});

const settingInputs = ['#settingLibrary', '#settingRgsx', '#settingRetroArch', '#settingCores', '#settingSystem', '#settingMame'];
for (const selector of settingInputs) {
  $(selector).addEventListener('input', () => updateSettingsDirtyState());
  $(selector).addEventListener('change', () => updateSettingsDirtyState({ immediate: true }));
}
$('#settingSponsors').addEventListener('change', () => updateSettingsDirtyState({ immediate: true }));


$('#saveSettings').onclick = async () => {
  const changes = readSettingsForm();
  $('#saveSettings').disabled = true;
  $('#saveSettings').textContent = 'Saving…';
  try {
    const result = await window.deck.saveSettings(changes);
    if (!result?.ok) throw Error(result?.error || 'Settings could not be saved');
    state.settings = result.settings;
    state.sponsors = await window.deck.sponsors();
    populateCommunity();
    $('#settingsStatus').textContent = result.restartRequired ? 'Saved. Restart to apply path changes.' : 'Saved. Privacy changes are active.';
    $('#restartApp').classList.toggle('hidden', !result.restartRequired);
    toast('GameDeck settings saved');
  } catch (error) {
    $('#settingsStatus').textContent = error.message;
    toast(error.message);
  } finally {
    $('#saveSettings').textContent = 'Save settings';
    updateSettingsDirtyState({ preserveStatus: true, immediate: true });
  }
};
$('#restartApp').onclick = () => window.deck.restartApp();

$('.content').addEventListener('wheel', () => {
  pulseUiHaptic('scroll');
}, { passive: true });

$('.content').addEventListener('scroll', event => {
  const content = event.currentTarget;
  updateScrollChrome(content);
  if (!['discover', 'community'].includes(state.view)) {
    const key = shelfMemoryKey();
    state.shelfMemory[key] = { ...(state.shelfMemory[key] || {}), scrollTop: content.scrollTop };
  } else if (state.view === 'discover' && state.catalogSystem) {
    const memory = state.catalogMemory[state.catalogSystem.id] || {};
    state.catalogMemory[state.catalogSystem.id] = { ...memory, scrollTop: content.scrollTop };
  }
  if (state.view === 'discover' && content.scrollHeight - content.scrollTop - content.clientHeight < 500) showMoreCatalog();
}, { passive: true });

window.addEventListener('pointermove', event => {
  if (event.pointerType !== 'touch' && (Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0) > 0)) setInputMode('pointer');
}, { passive: true });
window.addEventListener('pointerdown', () => setInputMode('pointer'), { passive: true });

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleArtworkEnrichment(1000);
});

window.addEventListener('gamepadconnected', () => {
  gamepadState.initialized = false;
  gamepadState.acceptAfter = performance.now() + 1200;
  setControllerStatus();
  playHapticSessionKey = '';
  syncPlayHaptics(state.playSession);
});
window.addEventListener('gamepaddisconnected', () => {
  gamepadState.initialized = false;
  setControllerStatus();
  renderPlayHapticStatus(ensurePlayHaptics()?.getStatus() || { enabled: false, mode: 'unsupported' });
});
window.deck.onActivity(entry => {
  state.activities = [...state.activities.slice(-399), entry];
  renderActivity();
  if (entry.message.startsWith('RGSX finished:')) refreshCatalogAfterDownload(entry.taskId);
});
window.deck.onArcadeAudit(progress => {
  state.arcadeAuditProgress = {
    running: Boolean(progress.running),
    done: Number(progress.done || 0),
    total: Number(progress.total || 0),
    current: progress.current || ''
  };
  if (progress.items) applyArcadeAudit(progress);
  renderArcadeDeck();
});
window.deck.onPlaySession(update => {
  handlePlaySessionUpdate(update);
});

window.deck.onRuntime(update => {
  state.runtime = update;
  if (['downloading', 'retrying', 'verifying', 'installing', 'preparing'].includes(update.phase)) {
    const progress = Math.max(8, Math.min(92, Number(update.progress || 0)));
    setLoading(true, 'Preparing game engines', update.message || 'Installing the components GameDeck needs.', progress);
  } else if (update.phase === 'ready') {
    setLoading(false);
    toast(update.message || 'Game engines are ready.', 'success');
  } else if (update.phase === 'error') {
    setLoading(false);
    toast(update.message || 'Game engine setup failed.', 'warning');
  }
});

window.deck.onLaunch(update => {
  const game = state.library.games.find(item => item.file === update.file);
  if (update.status === 'repairing') {
    setLaunchingState(game, false);
    state.transferExpanded = true;
    renderDownloads();
    toast(update.message || 'GameDeck is preparing this game automatically.', 'progress');
    return;
  }
  if (update.status === 'launched') {
    setLaunchingState(game, false);
    toast(update.message || ((game?.title || 'Your game') + ' is opening.'), 'success');
    loadLibrary(false);
    return;
  }
  if (update.status === 'failed') {
    setLaunchingState(game, false);
    toast(update.message || 'Automatic game setup could not be completed.', 'warning');
    openConsole(true);
  }
});

window.deck.onDownload(download => {
  if (download.status === 'running') state.dismissedDownloads.delete(download.id);
  const index = state.downloads.findIndex(item => item.id === download.id);
  if (index === -1) state.downloads = [download, ...state.downloads];
  else state.downloads[index] = download;
  renderDownloads();
  if (!$('#debugConsole').classList.contains('hidden')) renderActivity();

  const game = state.catalogGames.find(item => fileTaskIdentity(item.fileName) === fileTaskIdentity(download.fileName));
  if (game) {
    const button = document.querySelector(`.import[data-id="${game.id}"]`);
    if (button && download.status === 'running') {
      button.disabled = true;
      button.textContent = `${Math.round(Number(download.progress || 0))}%`;
      button.closest('.catalog-game')?.classList.add('downloading');
    }
    if (state.focusedCatalogId === game.id && download.status === 'running') {
      $('#catalogFeatureAction').disabled = true;
      $('#catalogFeatureAction').textContent = `${download.stage || 'Downloading'} ${Math.round(Number(download.progress || 0))}%`;
      $('#catalogFeatureMeta').textContent = `${download.stage || 'Downloading'} · ${Math.round(Number(download.progress || 0))}% complete · You can keep browsing.`;
    }
  }
  if (download.status === 'complete') refreshCatalogAfterDownload(download.id);
  if (download.status === 'error') {
    const key = [...state.activeCatalogTasks.entries()].find(([, id]) => id === download.id)?.[0];
    if (key) state.activeCatalogTasks.delete(key);
    if (state.view === 'discover') renderCatalogGames();
  }
});

async function init() {
  applyLayoutPreferences();
  setInputMode('pointer');
  $('#gameSort').value = state.sort;
  setLoading(true, 'Opening your deck', 'Checking local launchers and active transfers.', 10);
  await refreshDiagnostics();
  state.runtime = state.diagnostics?.managedRuntime || await window.deck.runtimeStatus();
  if (state.runtime?.supported && !state.runtime.ready && (state.runtime.bundled || !state.diagnostics?.retroarch)) {
    setLoading(true, 'Installing the complete GameDeck runtime', 'Preparing the included RetroArch engine and compatible cores. No separate installers are needed.', 14);
    const runtimeResult = await window.deck.ensureRuntime(false);
    state.runtime = runtimeResult;
    await refreshDiagnostics();
    if (!runtimeResult?.ready) toast(runtimeResult?.message || 'Game engines need attention.', 'warning');
  }
  setLoading(true, 'Reading your library', 'Organizing installed games, favorites, and recent plays.', 38);
  await loadLibrary(true);
  setLoading(true, 'Building the shelves', 'Preparing cover art, descriptions, and console groups.', 72);
  setControllerStatus();
  setLoading(true, 'Couch mode ready', 'Keyboard and controller navigation are lined up.', 94);
  ensurePlayHaptics();
  const existingPlaySession = await window.deck.playSessionStatus().catch(() => null);
  if (existingPlaySession?.active) await handlePlaySessionUpdate(existingPlaySession);
  setInterval(handleGamepad, 90);
  setLoading(false);
  refreshArcadeAudit(false);
  const captureView = requestedCaptureView;
  if (captureView && views.includes(captureView)) changeView(captureView);
  else if (captureView === 'cinematic') {
    state.density = 'cinematic';
    applyLayoutPreferences();
    changeView('home');
  } else if (captureView === 'empty-search') {
    changeView('home');
    $('#search').value = 'Definitely not installed';
    state.query = $('#search').value.toLowerCase();
    render();
  } else if (captureView === 'collapsed') {
    state.sidebarCollapsed = true;
    applyLayoutPreferences();
    changeView('home');
  } else if (captureView === 'generated-art') {
    changeView('home');
    state.library.games.filter(game => !game.art).forEach(game => artworkEnrichmentTried.add(game.id));
    render();
  } else if (captureView === 'transfer-ready') {
    changeView('home');
    const now = Date.now();
    state.transferExpanded = true;
    state.downloads = [{
      id: 'qa-ready-transfer', source: 'RGSX QA', folder: 'snes', systemId: 'snes', systemName: 'Super Nintendo',
      title: 'Chrono Trigger', fileName: 'Chrono Trigger (USA).sfc', status: 'complete', stage: 'Complete',
      message: 'Added to your library and ready to play.', progress: 100, startedAt: now - 42000, finishedAt: now
    }];
    renderDownloads();
  } else if (captureView === 'status') {
    changeView('home');
    const now = Date.now();
    state.activities = [
      { id: 'qa-ready', at: now - 8000, level: 'info', message: 'GameDeck ready' },
      { id: 'qa-issue-1', at: now - 6200, level: 'error', message: 'RetroArch core is missing for Super Nintendo.' },
      { id: 'qa-issue-2', at: now - 5600, level: 'error', message: 'RetroArch core is missing for Super Nintendo.' },
      { id: 'qa-success', at: now - 2400, level: 'success', message: 'Custom artwork saved for Chrono Trigger.' }
    ];
    state.downloads = [{ id: 'qa-download', status: 'running', title: 'Super Metroid', progress: 44, startedAt: now - 12000 }];
    state.diagnostics = {
      platform: 'win32', arch: 'x64', library: 'C:\\Games\\GameDeck', rgsxRuntime: true, retroarch: true, mame: false,
      settings: { version: '1.1.0' }, systems: [{ name: 'Super Nintendo', ready: false, issue: 'Core missing' }]
    };
    $('#debugHealth').innerHTML = '<span class="ok">RGSX READY</span><span class="ok">RETROARCH READY</span><span class="bad">MAME MISSING</span><span>1 ACTIVE</span>';
    $('#debugConsole').classList.remove('hidden');
    $('#consoleToggle').classList.add('active');
    renderActivity();
    renderDownloads();
  } else if (captureView === 'transfers') {
    changeView('discover');
    state.transferExpanded = true;
    state.downloads = [{
      id: 'qa-transfer',
      source: 'RGSX QA',
      folder: 'ps2',
      systemId: 'ps2',
      systemName: 'PlayStation 2',
      title: 'NBA Street Vol 2',
      fileName: 'NBA Street Vol. 2 (USA).zip',
      status: 'running',
      stage: 'Installing',
      message: 'Unpacking the downloaded game. The original archive will be kept.',
      progress: 68,
      downloadedBytes: 1107296256,
      totalBytes: 1614356831,
      speed: '12.4 MB/s',
      etaSeconds: 41,
      startedAt: Date.now()
    }];
    renderDownloads();
  } else if (captureView === 'loading') {
    setLoading(true, 'Matching artwork', 'Building the visual shelves without interrupting your library.', 72);
  } else if (captureView === 'setup') {
    state.setupCoachOpen = true;
    state.setupCoachDismissed = false;
    changeView('home');
    renderSetupCoach();
  } else if (captureView === 'arcade') {
    selectLibrarySystem('arcade');
  } else if (captureView === 'arcade-attention') {
    state.arcadeFilter = 'attention';
    selectLibrarySystem('arcade');
  } else if (captureView === 'launch-handoff') {
    changeView('home');
    const game = state.library.games.find(item => item.system === 'openbor') || state.library.games[0];
    if (game) {
      setFocusedGame(game);
      setLaunchingState(game, true);
    }
  }
  if (captureView) document.body.dataset.captureReady = 'true';
}

init().catch(error => {
  setLoading(false);
  toast(error.message || 'GameDeck could not start');
  openConsole(true);
});
