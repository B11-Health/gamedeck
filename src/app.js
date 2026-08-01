const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const GAME_SORTS = new Set(['title', 'recent', 'system', 'size']);

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
const requestedCaptureView = new URLSearchParams(window.location.search).get('captureView');

const state = {
  library: { systems: [], games: [] },
  catalog: [],
  catalogGames: [],
  catalogSystem: null,
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
  activities: [],
  downloads: [],
  activeCatalogTasks: new Map(),
  artworkLoading: new Set(),
  gameDetails: new Map(),
  detailLoading: new Set(),
  settings: null,
  sponsors: null,
  donations: null,
  diagnostics: null,
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
  density: readPreference('density', 'compact') === 'cinematic' ? 'cinematic' : 'compact',
  sidebarCollapsed: readPreference('sidebar', 'expanded') === 'collapsed'
};

const views = ['home', 'discover', 'favorites', 'recent', 'community'];
const CATALOG_PAGE_SIZE = 120;
let toastTimer = null;
let catalogRequest = 0;
let artworkObserver = null;
let artworkActive = 0;
let detailTimer = null;
let loadingHideTimer = null;
let transferHideTimer = null;
const artworkQueue = [];
const completionRefreshes = new Set();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function applyLayoutPreferences(announce = false) {
  const compact = state.density === 'compact';
  document.body.classList.toggle('density-compact', compact);
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#densityLabel').textContent = 'Cinematic';
  $('#densityToggle').setAttribute('aria-pressed', String(!compact));
  $('#densityToggle').setAttribute('aria-label', compact ? 'Enable cinematic view' : 'Disable cinematic view');
  $('#densityToggle').title = `${compact ? 'Enable' : 'Disable'} cinematic view (Ctrl+Shift+D)`;
  $('#sidebarToggle').setAttribute('aria-pressed', String(!state.sidebarCollapsed));
  $('#sidebarToggle').setAttribute('aria-label', state.sidebarCollapsed ? 'Expand systems rail' : 'Collapse systems rail');
  $('#sidebarToggle').title = `${state.sidebarCollapsed ? 'Expand' : 'Collapse'} systems rail (Ctrl+B)`;
  if (announce) toast(`${compact ? 'Compact' : 'Cinematic'} view · systems ${state.sidebarCollapsed ? 'collapsed' : 'expanded'}`);
  requestAnimationFrame(observeVisibleArtwork);
}

function toggleDensity() {
  state.density = state.density === 'compact' ? 'cinematic' : 'compact';
  writePreference('density', state.density);
  applyLayoutPreferences(true);
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
  const release = edition ? ` This ${edition.replace(/\s*\/\s*/g, ', ')} edition is shown with its original catalog details.` : '';
  return installed
    ? `${title} is installed in your ${systemName} collection and ready to play.${release} GameDeck will open it with the emulator already configured for this system.`
    : `${title} is available for ${systemName}.${release} Add it through RGSX and GameDeck will place it in your library, match the artwork, and route it to the right emulator.`;
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

function setLoading(active, title = 'Starting GameDeck', message = 'Checking your library and emulator setup.', progress = 8) {
  const stage = $('#appLoading');
  clearTimeout(loadingHideTimer);
  if (!active) {
    $('#loadingBar').style.width = '100%';
    $('#loadingPercent').textContent = '100%';
    $('#loadingTrack').setAttribute('aria-valuenow', '100');
    stage.classList.add('complete');
    loadingHideTimer = setTimeout(() => {
      stage.classList.add('hidden');
      document.body.classList.remove('is-loading');
    }, 260);
    return;
  }
  stage.classList.remove('hidden', 'complete');
  document.body.classList.add('is-loading');
  $('#loadingTitle').textContent = title;
  $('#loadingMessage').textContent = message;
  const value = Math.min(100, Math.max(0, Number(progress || 0)));
  $('#loadingBar').style.width = `${value}%`;
  $('#loadingPercent').textContent = `${Math.round(value)}%`;
  $('#loadingTrack').setAttribute('aria-valuenow', String(Math.round(value)));
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
  return state.downloads.find(download => fileTaskIdentity(download.fileName) === identity && download.status === 'running');
}

function renderDownloads() {
  const now = Date.now();
  const downloads = state.downloads
    .filter(download => download.status === 'running' || now - Number(download.finishedAt || now) < (download.status === 'error' ? 60000 : 14000))
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
  const running = downloads.filter(download => download.status === 'running');
  const dock = $('#transferDock');
  const badge = $('#activityCount');
  badge.textContent = String(running.length);
  badge.classList.toggle('hidden', running.length === 0);
  if (!downloads.length) {
    dock.classList.add('hidden');
    return;
  }

  const primary = running[0] || downloads[0];
  const average = running.length
    ? Math.round(running.reduce((sum, download) => sum + Number(download.progress || 0), 0) / running.length)
    : Math.round(Number(primary.progress || 0));
  const progress = Math.min(100, Math.max(0, average));
  const speed = primary.speed || '';
  const eta = etaLabel(primary);
  const transferred = primary.totalBytes ? `${transferSize(primary.downloadedBytes)} of ${transferSize(primary.totalBytes)}` : '';
  const detail = [transferred, speed, eta].filter(Boolean).join(' · ') || primary.message || 'RGSX is preparing the transfer.';

  $('#transferKicker').textContent = running.length > 1 ? `${running.length} ACTIVE DOWNLOADS` : primary.status === 'complete' ? 'DOWNLOAD COMPLETE' : primary.status === 'error' ? 'DOWNLOAD NEEDS ATTENTION' : String(primary.stage || 'DOWNLOADING').toUpperCase();
  $('#transferTitle').textContent = running.length > 1 ? `${running.length} games are joining your deck` : primary.title;
  $('#transferDetail').textContent = detail;
  $('#transferPercent').textContent = primary.status === 'error' ? '!' : `${progress}%`;
  $('#transferBar').style.width = `${progress}%`;
  $('.transfer-meter').classList.toggle('indeterminate', primary.status === 'running' && progress === 0);
  $('#transferSummary').setAttribute('aria-expanded', String(state.transferExpanded));
  dock.classList.toggle('expanded', state.transferExpanded);
  dock.classList.remove('hidden');

  $('#transferPanel').innerHTML = downloads.map(download => {
    const game = state.catalogGames.find(item => fileTaskIdentity(item.fileName) === fileTaskIdentity(download.fileName)) || state.library.games.find(item => item.title === download.title);
    const art = game?.art || assetFallback(download.title, '#263347', '#10141c');
    const itemProgress = Math.min(100, Math.max(0, Number(download.progress || 0)));
    const itemDetail = [download.systemName, download.speed, etaLabel(download)].filter(Boolean).join(' · ') || download.message || '';
    return `<article class="transfer-item ${escapeHtml(download.status)}"><img src="${escapeHtml(art)}" alt=""><div class="transfer-item-copy"><div><b title="${escapeHtml(download.title)}">${escapeHtml(download.title)}</b><span>${escapeHtml(download.stage || download.status)}</span></div><small>${escapeHtml(itemDetail)}</small><div class="transfer-item-track ${download.status === 'running' && itemProgress === 0 ? 'indeterminate' : ''}"><span style="width:${itemProgress}%"></span></div></div><strong>${download.status === 'error' ? '!' : `${Math.round(itemProgress)}%`}</strong></article>`;
  }).join('');
  $('#transferPanel').classList.toggle('hidden', !state.transferExpanded);

  clearTimeout(transferHideTimer);
  if (!running.length) transferHideTimer = setTimeout(renderDownloads, primary.status === 'error' ? 61000 : 15000);
}

function assetFallback(text, colorA = '#1b2233', colorB = '#0f131a') {
  const safeText = String(text || 'GAME').replace(/[<>&]/g, '').slice(0, 20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset="1" stop-color="${colorB}"/></linearGradient></defs><rect width="600" height="900" rx="34" fill="url(#g)"/><circle cx="455" cy="155" r="190" fill="rgba(255,255,255,.06)"/><path d="M-80 610 680 300v180L-80 790Z" fill="rgba(255,255,255,.05)"/><text x="52" y="720" fill="rgba(255,255,255,.94)" font-family="sans-serif" font-size="52" font-weight="700">${safeText}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function systemById(id) {
  return state.library.systems.find(system => system.id === id);
}

function systemStatusLabel(system) {
  return system?.ready ? 'READY' : 'SETUP';
}

function isArcadeId(id) {
  return id === 'arcade' || id === 'mame';
}

function arcadeSelected() {
  return isArcadeId(state.selectedSystem) && !['discover', 'community'].includes(state.view);
}

function arcadeHealthLabel(game) {
  if (game.archiveHealth === 'verified') return game.system === 'mame' ? 'ROM SET VERIFIED' : 'ARCHIVE VERIFIED';
  if (game.archiveHealth === 'damaged') return 'DAMAGED ARCHIVE';
  if (game.archiveHealth === 'incomplete') return 'ROMSET INCOMPLETE';
  return 'CHECK PENDING';
}

function arcadeHealthClass(game) {
  if (game.archiveHealth === 'verified') return 'verified';
  if (['damaged', 'incomplete'].includes(game.archiveHealth)) return 'attention';
  return 'checking';
}

function gameArt(game) {
  const system = systemById(game.system);
  return game.art || assetFallback(game.title, system?.color || '#24334b', '#101722');
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
  if (arcadeSelected() && state.arcadeFilter === 'attention') games = games.filter(game => ['damaged', 'incomplete'].includes(game.archiveHealth));

  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  if (state.view === 'recent' || state.sort === 'recent') games.sort((a, b) => Number(b.lastPlayed || 0) - Number(a.lastPlayed || 0) || byTitle(a, b));
  else if (state.sort === 'system') games.sort((a, b) => (systemById(a.system)?.name || '').localeCompare(systemById(b.system)?.name || '') || byTitle(a, b));
  else if (state.sort === 'size') games.sort((a, b) => Number(b.size || 0) - Number(a.size || 0) || byTitle(a, b));
  else games.sort(byTitle);
  return games;
}

function filteredCatalogGames() {
  const query = state.catalogQuery;
  return state.catalogGames.filter(game => !query || game.name.toLowerCase().includes(query));
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
  const attention = games.filter(game => ['damaged', 'incomplete'].includes(game.archiveHealth)).length;
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

  $('[data-arcade-filter]').forEach(button => {
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
  if (state.focusedGameId === game.id) {
    $('#spotlightArt').innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(game.title)} cover">`;
    $('#spotlightBackdrop').src = url;
  }
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

function requestArtwork(game, priority = false) {
  if (!game || game.art) return;
  const key = `library:${game.id}`;
  queueArtwork(key, async () => {
    const url = await window.deck.artwork(game.artworkTitle || game.title, game.system, game.artworkFolder || '');
    updateGameArtwork(game, url);
  }, priority);
}

function updateCatalogArtwork(game, url) {
  if (!url) return;
  game.art = url;
  $$(`[data-catalog-art="${game.id}"]`).forEach(image => { image.src = url; });
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

function gameDetailsContext(game) {
  const system = systemById(game?.system);
  return { name: game?.title, systemName: system?.name, shortName: game?.shortName, file: game?.file, edition: game?.edition, region: game?.region, installed: true };
}

function applyFocusedDetails(game, details) {
  if (!game || state.focusedGameId !== game.id || !details) return;
  const system = systemById(game.system);
  const arcade = isArcadeId(game.system);
  const fallback = fallbackDescription(game.title, system?.name || 'this console', true);
  $('#spotlightDescription').textContent = details.description || fallback;
  $('#spotlightFacts').innerHTML = factMarkup([arcade && game.shortName?.toUpperCase(), system?.short || system?.name, details.year, details.genre, details.players && (details.players + ' player' + (details.players === '1' ? '' : 's')), details.buttons && (details.buttons + ' buttons'), details.developer || details.manufacturer, details.publisher, game.region, game.format, sizeLabel(game.size)]);
}

function setFocusedGame(game, options = {}) {
  state.focusedGameId = game?.id ?? null;
  state.libraryZone = 'games';
  $$('.game').forEach(card => card.classList.toggle('active', card.dataset.id === state.focusedGameId));
  $$('.system').forEach(button => button.classList.remove('controller-focus'));

  const spotlight = $('#spotlight');
  if (!game) {
    spotlight.classList.add('hidden');
    return;
  }

  const system = systemById(game.system);
  const art = gameArt(game);
  const launcher = system?.emulatorLabel || (system?.core ? 'RetroArch' : system?.name || 'your configured emulator');
  const arcade = isArcadeId(game.system);
  const blocked = arcade && ['damaged', 'incomplete'].includes(game.archiveHealth);
  const fallback = fallbackDescription(game.title, system?.name || 'this console', true);
  const cached = state.gameDetails.get(detailKey(game.artworkTitle || game.title, game.system));
  $('#spotlightSystem').textContent = `${system?.name || 'Game'} / ${blocked ? arcadeHealthLabel(game) : system?.ready ? 'READY TO PLAY' : 'SETUP NEEDED'}`;
  $('#spotlightTitle').textContent = game.title;
  $('#spotlightFacts').innerHTML = factMarkup([arcade && game.shortName?.toUpperCase(), system?.short || system?.name, cached?.year, cached?.players && `${cached.players} player${cached.players === '1' ? '' : 's'}`, cached?.buttons && `${cached.buttons} buttons`, game.format, sizeLabel(game.size)]);
  $('#spotlightDescription').textContent = cached?.description || fallback;
  $('#spotlightMeta').textContent = blocked
    ? game.archiveHealthMessage || 'This ROM set needs attention before it can launch.'
    : `${relative(game.lastPlayed)} · Opens with ${launcher}${arcade && game.archiveHealth === 'verified' ? ' · Archive verified' : ''}`;
  $('#spotlightPlay').disabled = blocked;
  $('#spotlightPlay').textContent = blocked ? 'Fix ROM set first' : 'Play now';
  $('#spotlightFav').textContent = game.favorite ? 'Remove save' : 'Save game';
  $('#spotlightArt').innerHTML = `<img src="${escapeHtml(art)}" alt="${escapeHtml(game.title)} cover">`;
  $('#spotlightBackdrop').src = art;
  spotlight.classList.remove('hidden');
  requestArtwork(game);
  queueGameDetails(game.artworkTitle || game.title, game.system, gameDetailsContext(game), details => {
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
  button.disabled = true;
  button.textContent = 'Choosing…';
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
    button.textContent = 'Change art';
  }
}

async function refreshFocusedDetails() {
  const game = focusedGame();
  if (!game) return;
  const button = $('#spotlightDetails');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  const key = detailKey(game.artworkTitle || game.title, game.system);
  state.gameDetails.delete(key);
  try {
    const details = await window.deck.refreshGameDetails(game.artworkTitle || game.title, game.system, gameDetailsContext(game));
    if (!details) throw Error('No details were returned');
    state.gameDetails.set(key, details);
    applyFocusedDetails(game, details);
    toast(details.source === 'GameDeck' ? 'Using local GameDeck details for now' : 'Details refreshed from ' + (details.source || 'metadata source'));
  } catch (error) {
    toast(error.message || 'Game details could not be refreshed');
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh details';
  }
}

function renderSystems() {
  const allFocused = state.libraryZone === 'systems' && state.focusedLibrarySystem === 'all';
  const all = `<button class="system ${state.selectedSystem === 'all' ? 'active' : ''} ${allFocused ? 'controller-focus' : ''}" data-id="all" title="All games"><span class="sys-icon" style="--c:#c8ff52">ALL</span><span class="sys-copy"><b>All games</b><small>Full collection</small></span><span class="count">${state.library.games.length}</span></button>`;
  const systems = state.library.systems.map(system => {
    const focused = state.libraryZone === 'systems' && state.focusedLibrarySystem === system.id;
    const art = system.image ? `<img src="${escapeHtml(system.image)}" alt="">` : escapeHtml(system.icon);
    const installed = Number(system.installedCount || 0);
    const total = Number(system.count || 0);
    const countLabel = installed > 0 ? `${installed}/${total}` : String(total);
    const title = system.issue ? `${system.name} — ${system.issue}` : system.name;
    const arcadeGames = isArcadeId(system.id) ? state.library.games.filter(game => game.system === system.id) : [];
    const arcadeAttention = arcadeGames.filter(game => ['damaged', 'incomplete'].includes(game.archiveHealth)).length;
    const status = isArcadeId(system.id) && arcadeGames.length
      ? (arcadeAttention ? `${arcadeAttention} SET${arcadeAttention === 1 ? '' : 'S'} TO CHECK` : `${arcadeGames.filter(game => game.archiveHealth === 'verified').length} PREFLIGHT OK`)
      : systemStatusLabel(system);
    return `<button class="system ${state.selectedSystem === system.id ? 'active' : ''} ${focused ? 'controller-focus' : ''}" data-id="${system.id}" title="${escapeHtml(title)}"><span class="sys-icon" style="--c:${system.color}">${art}</span><span class="sys-copy"><b>${escapeHtml(system.name)}</b><small>${escapeHtml(status)}</small></span><span class="count">${countLabel}</span></button>`;
  }).join('');
  $('#systems').innerHTML = all + systems;

  $$('.system').forEach(button => {
    button.onclick = () => selectLibrarySystem(button.dataset.id);
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
  let message = 'Browse RGSX or add a legally owned game to your configured library folder.';
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
    message = 'Save any game from its card or spotlight and it will stay one move away here.';
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
    message = 'Browse the RGSX catalog for this console or add a legally owned title to its game folder.';
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

function renderGames() {
  const games = currentGames();
  $('#resultCount').textContent = `${games.length.toLocaleString()} ${games.length === 1 ? 'game' : 'games'}`;
  $('#games').innerHTML = games.map(game => {
    const system = systemById(game.system);
    const active = game.id === state.focusedGameId;
    const arcade = isArcadeId(game.system);
    const healthClass = arcadeHealthClass(game);
    const blocked = arcade && healthClass === 'attention';
    const badge = arcade ? `<span class="archive-badge ${healthClass}">${escapeHtml(arcadeHealthLabel(game))}</span>` : '';
    const facts = arcade
      ? `<span class="game-shortname">${escapeHtml(game.shortName || 'ROM SET')}</span><span>${escapeHtml(game.format || 'ARCHIVE')}</span>`
      : `<span>${escapeHtml(system?.name || 'Game')}</span><span>${escapeHtml(sizeLabel(game.size))}</span>`;
    const status = arcade
      ? (game.archiveHealth === 'verified' ? 'Archive verified' : game.archiveHealthMessage || 'Health check pending')
      : relative(game.lastPlayed);
    return `<article class="game ${arcade ? 'arcade-card' : ''} ${blocked ? 'health-attention' : ''} ${active ? 'active' : ''}" tabindex="0" role="button" aria-label="${blocked ? 'Review' : 'Play'} ${escapeHtml(game.title)} on ${escapeHtml(system?.name || 'GameDeck')}" data-id="${game.id}"><div class="cover" style="--c:${system?.color || '#8992a3'}"><div class="cover-art"><img data-game-art="${game.id}" src="${escapeHtml(gameArt(game))}" alt="${escapeHtml(game.title)} artwork" loading="lazy"></div><span class="cover-system">${escapeHtml(system?.short || 'GAME')}</span>${badge}<button class="fav ${game.favorite ? 'on' : ''}" aria-label="${game.favorite ? 'Remove favorite' : 'Favorite'}">${game.favorite ? 'SAVED' : 'SAVE'}</button><div class="cover-logo">${escapeHtml(system?.icon || 'G')}</div><div class="cover-title">${escapeHtml(game.title)}</div><button class="play" aria-label="${blocked ? 'ROM set needs attention' : `Play ${escapeHtml(game.title)}`}" ${blocked ? 'disabled' : ''}><span aria-hidden="true">${blocked ? '!' : '▶'}</span> ${blocked ? 'CHECK' : 'PLAY'}</button></div><div class="meta"><b title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</b><div class="game-card-facts">${facts}</div><small><span class="ready-dot"></span>${escapeHtml(status)}</small></div></article>`;
  }).join('');

  renderEmptyState(games);
  $$('.game').forEach(card => {
    const game = games.find(item => item.id === card.dataset.id);
    card.onmouseenter = () => setFocusedGame(game);
    card.onfocus = () => setFocusedGame(game);
    card.onclick = event => {
      if (event.target.closest('button')) return;
      setFocusedGame(game);
      if (['damaged', 'incomplete'].includes(game.archiveHealth)) {
        toast(game.archiveHealthMessage || 'This ROM set needs attention');
        return;
      }
      launch(game.file);
    };
    card.querySelector('.play').onclick = event => {
      event.stopPropagation();
      setFocusedGame(game);
      if (['damaged', 'incomplete'].includes(game.archiveHealth)) return;
      launch(game.file);
    };
    card.querySelector('.fav').onclick = async event => {
      event.stopPropagation();
      await toggleFavorite(game);
    };
  });

  if (!games.length) setFocusedGame(null);
  else if (!state.focusedGameId || !games.some(game => game.id === state.focusedGameId)) setFocusedGame(games[0]);
  observeVisibleArtwork();
}

function selectLibrarySystem(id) {
  state.selectedSystem = id;
  state.focusedLibrarySystem = id;
  state.view = 'home';
  state.query = '';
  $('#search').value = '';
  setActiveView('home');
  render();
  const first = currentGames()[0];
  if (first) setFocusedGame(first);
}

async function toggleFavorite(game) {
  state.library = await window.deck.favorite(game.file);
  render();
  setFocusedGame(state.library.games.find(item => item.id === game.id) || currentGames()[0] || null);
}

async function launch(file) {
  try {
    const game = state.library.games.find(item => item.file === file);
    const system = game ? systemById(game.system) : null;
    if (game && ['damaged', 'incomplete'].includes(game.archiveHealth)) throw Error(game.archiveHealthMessage || 'This ROM set needs attention before launch');
    if (system && !system.ready && (system.issue || '').toLowerCase().includes('firmware')) {
      const result = await window.deck.setupSystem(system.id);
      if (result?.queued) {
        toast(`${system.name} firmware is downloading through RGSX`);
        state.transferExpanded = true;
        renderDownloads();
        return;
      }
      if (result?.ready) {
        toast(`${system.name} firmware is already installed`);
      } else {
        toast(result?.error || system.issue || 'Firmware setup required');
        openConsole(true);
        return;
      }
    }
    toast('Launching with the correct emulator...');
    const result = await window.deck.launch(file);
    if (!result?.ok) throw Error(result?.error || 'Could not launch this game');
    setTimeout(() => loadLibrary(false), 500);
  } catch (error) {
    toast(error.message || 'Could not launch this game');
    openConsole(true);
  }
}

function renderCatalogFeature(game) {
  const feature = $('#catalogFeature');
  if (!game || !state.catalogSystem) {
    feature.classList.add('hidden');
    return;
  }

  const fallback = assetFallback(game.name);
  const art = game.art || fallback;
  const downloading = downloadForGame(game) || (state.activeCatalogTasks.has(catalogTaskKey(game)) ? { stage: 'Preparing', progress: 0 } : null);
  const installed = Boolean(game.installedFile);
  const ready = installed && game.installedReady !== false;
  const cached = state.gameDetails.get(detailKey(game.fileName || game.name, state.catalogSystem.systemId));
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
    $('#catalogFeatureFacts').innerHTML = factMarkup([game.region || game.tags?.[0], details.year, details.players && `${details.players} player${details.players === '1' ? '' : 's'}`, game.size || 'RGSX managed', ready ? 'Ready' : installed ? 'Downloaded' : 'Available']);
  });
}

function setFocusedCatalogGame(game, options = {}) {
  state.focusedCatalogId = game?.id ?? null;
  state.discoverZone = 'games';
  $$('.catalog-game').forEach(card => card.classList.toggle('active', Number(card.dataset.id) === state.focusedCatalogId));
  $$('.console-card').forEach(card => card.classList.remove('controller-focus'));
  renderCatalogFeature(game);
  if (options.scroll && game) document.querySelector(`.catalog-game[data-id="${game.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderCatalogGames() {
  const games = currentCatalogGames();
  $('#catalogGames').removeAttribute('aria-busy');
  $('#catalogGames').innerHTML = games.map(game => {
    const active = game.id === state.focusedCatalogId;
    const downloading = downloadForGame(game) || (state.activeCatalogTasks.has(catalogTaskKey(game)) ? { progress: 0, stage: 'Preparing' } : null);
    const installed = Boolean(game.installedFile);
    const ready = installed && game.installedReady !== false;
    const art = game.art || assetFallback(game.name);
    const facts = [game.region || game.tags?.[0] || 'Catalog', game.size || 'RGSX'].filter(Boolean);
    const action = ready ? 'Play' : downloading ? `${Math.round(Number(downloading.progress || 0))}%` : installed ? 'Install' : 'Add';
    const cardState = ready ? 'IN LIBRARY' : downloading ? escapeHtml(downloading.stage || 'WORKING') : installed ? 'DOWNLOADED' : 'AVAILABLE';
    return `<article class="catalog-game ${active ? 'active' : ''} ${ready ? 'installed' : ''} ${installed && !ready ? 'downloaded' : ''} ${downloading ? 'downloading' : ''}" tabindex="0" role="button" aria-label="${escapeHtml(game.name)} for ${escapeHtml(state.catalogSystem?.name || 'this console')}" data-id="${game.id}"><div class="catalog-media"><img class="catalog-media-backdrop" data-catalog-art="${game.id}" src="${escapeHtml(art)}" alt="" loading="lazy"><img class="catalog-poster" data-catalog-art="${game.id}" src="${escapeHtml(art)}" alt="${escapeHtml(game.name)} artwork" loading="lazy"><span class="catalog-platform">${escapeHtml(state.catalogSystem?.name || 'GAME')}</span><span class="catalog-state">${cardState}</span></div><div class="catalog-info"><b title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</b><small>${facts.map(fact => `<span>${escapeHtml(fact)}</span>`).join('')}</small><p>${escapeHtml(cardDescription(game, state.catalogSystem))}</p><button class="import" data-id="${game.id}" ${downloading ? 'disabled' : ''}>${action}</button></div></article>`;
  }).join('');

  $$('.catalog-game').forEach(card => {
    const game = games.find(item => item.id === Number(card.dataset.id));
    card.onmouseenter = () => setFocusedCatalogGame(game);
    card.onfocus = () => setFocusedCatalogGame(game);
    card.onclick = event => {
      setFocusedCatalogGame(game);
      if (game.installedFile && !event.target.closest('.import')) catalogAction(game);
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
    $('#catalogGames').innerHTML = '<div class="catalog-empty">No matching titles in this console catalog.</div>';
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

async function selectCatalog(id, enterGames = false) {
  const system = state.catalog.find(item => item.id === id);
  if (!system) return;
  const request = ++catalogRequest;
  state.catalogSystem = system;
  state.focusedConsoleId = id;
  state.focusedCatalogId = null;
  state.catalogQuery = '';
  state.catalogLimit = CATALOG_PAGE_SIZE;
  state.catalogGames = [];
  $('#search').value = '';
  renderConsoleRail();
  requestAnimationFrame(() => document.querySelector(`.console-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  $('#catalogTitle').textContent = system.name;
  $('#catalogCount').textContent = `${system.count.toLocaleString()} titles · ${system.playable ? 'ready to play' : 'setup needed'}`;
  renderCatalogSkeleton(system);

  const games = await window.deck.catalogGames(system.gamesFile);
  if (request !== catalogRequest) return;
  state.catalogGames = games;
  system.count = games.length;
  system.installedCount = games.filter(game => game.installedFile).length;
  $('#catalogCount').textContent = `${system.installedCount.toLocaleString()} installed · ${games.length.toLocaleString()} available · ${system.playable ? 'emulator ready' : 'setup needed'}`;
  renderConsoleRail();
  if (enterGames && games.length) {
    state.discoverZone = 'games';
    state.focusedCatalogId = games[0].id;
  }
  renderCatalogGames();
}

function renderConsoleRail() {
  $('#consoleRail').innerHTML = state.catalog.map(system => {
    const active = state.catalogSystem?.id === system.id;
    const focused = state.discoverZone === 'systems' && state.focusedConsoleId === system.id;
    return `<button type="button" class="console-card ${active ? 'active' : ''} ${focused ? 'controller-focus' : ''}" data-id="${escapeHtml(system.id)}" title="${escapeHtml(system.issue || '')}"><span class="console-state">${system.playable ? 'READY' : 'SETUP'}</span><b>${escapeHtml(system.name)}</b><small>${system.count.toLocaleString()} TITLES</small><img src="${escapeHtml(system.image)}" alt=""></button>`;
  }).join('');
  $$('.console-card').forEach(card => {
    card.onclick = () => selectCatalog(card.dataset.id, true);
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
  const games = state.library.games || [];
  const systems = state.library.systems || [];
  const installedSystems = systems.filter(system => Number(system.installedCount || system.count || 0) > 0);
  const readyInstalled = installedSystems.filter(system => system.ready);
  const readySystems = systems.filter(system => system.ready);
  const artworkCount = games.filter(game => Boolean(game.art)).length;
  const artworkCoverage = games.length ? Math.round((artworkCount / games.length) * 100) : 0;
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const controllerReady = pads.length > 0 || state.controllerHints.length > 0;
  const libraryReady = games.length > 0;
  const launcherReady = games.length ? readyInstalled.length > 0 : readySystems.length > 0;
  const artworkReady = games.length > 0 && artworkCount > 0;
  const steps = [
    {
      id: 'library',
      label: 'Game library',
      ready: libraryReady,
      detail: libraryReady
        ? `${games.length.toLocaleString()} title${games.length === 1 ? '' : 's'} found and organized.`
        : diagnostics.libraryExists
          ? 'Library folder is ready. Add owned games or browse Discover.'
          : 'Choose a library folder to begin.'
    },
    {
      id: 'launchers',
      label: 'Launchers',
      ready: launcherReady,
      detail: launcherReady
        ? `${games.length ? readyInstalled.length : readySystems.length} emulator route${(games.length ? readyInstalled.length : readySystems.length) === 1 ? '' : 's'} ready.`
        : 'No launcher is ready for the installed collection yet.'
    },
    {
      id: 'artwork',
      label: 'Artwork',
      ready: artworkReady,
      detail: games.length ? `${artworkCoverage}% matched · ${artworkCount.toLocaleString()} covers ready.` : 'Artwork matching starts as soon as games are found.'
    },
    {
      id: 'controls',
      label: 'Controls',
      ready: true,
      detail: controllerReady ? 'Controller detected and couch mode is ready.' : 'Keyboard and mouse are ready; connect a controller anytime.'
    }
  ];
  return {
    steps,
    score: Math.round((steps.filter(step => step.ready).length / steps.length) * 100),
    libraryReady,
    launcherReady,
    artworkCoverage,
    coreReady: libraryReady && launcherReady
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
  $('#setupCoachTitle').textContent = readiness.coreReady ? 'Your deck is ready to play.' : 'Your easiest route to play.';
  $('#setupCoachMessage').textContent = !readiness.libraryReady
    ? 'Add legally owned games or browse Discover. GameDeck will organize the rest.'
    : !readiness.launcherReady
      ? 'Your games are here. Connect one compatible emulator to unlock one-click play.'
      : readiness.artworkCoverage < 80
        ? 'Launching is ready. Artwork will continue filling in quietly as you browse.'
        : 'Library, launchers, artwork, and controls are lined up for couch play.';
  $('#setupSteps').innerHTML = readiness.steps.map(step => `
    <div class="setup-step ${step.ready ? 'ready' : 'pending'}">
      <span class="setup-step-icon" aria-hidden="true">${step.ready ? '✓' : '·'}</span>
      <span><b>${escapeHtml(step.label)}</b><small>${escapeHtml(step.detail)}</small></span>
    </div>`).join('');
  const primary = $('#setupPrimary');
  primary.textContent = !readiness.libraryReady ? 'Browse Discover' : !readiness.launcherReady ? 'Open launcher setup' : 'Review settings';
  primary.dataset.action = !readiness.libraryReady ? 'discover' : 'settings';
}

function surpriseMe() {
  if (['discover', 'community'].includes(state.view)) changeView('home');
  const candidates = currentGames().filter(game => {
    const system = systemById(game.system);
    return system?.ready && !['damaged', 'incomplete'].includes(game.archiveHealth);
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

function render() {
  renderSystems();
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
  $('#toolbarContext').textContent = discover ? 'DOWNLOADS STAY VISIBLE WHILE YOU BROWSE' : arcadeSelected() ? 'ARCHIVES ARE CHECKED BEFORE LAUNCH' : 'CLICK OR PRESS A TO LAUNCH';
  $('#search').placeholder = discover ? 'Search this console catalog' : 'Search your collection';
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

function moveLibrary(direction) {
  if (state.view === 'community') return;
  if (state.libraryZone === 'systems') {
    const ids = ['all', ...state.library.systems.map(system => system.id)];
    let index = Math.max(0, ids.indexOf(state.focusedLibrarySystem));
    if (direction === 'up') index = (index - 1 + ids.length) % ids.length;
    if (direction === 'down') index = (index + 1) % ids.length;
    if (direction === 'right') {
      const first = currentGames()[0];
      if (first) setFocusedGame(first, { scroll: true });
      return;
    }
    state.focusedLibrarySystem = ids[index];
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
}

function moveDiscover(direction) {
  if (state.discoverZone === 'systems') {
    const ids = state.catalog.map(system => system.id);
    let index = Math.max(0, ids.indexOf(state.focusedConsoleId));
    if (direction === 'left') index = (index - 1 + ids.length) % ids.length;
    if (direction === 'right') index = (index + 1) % ids.length;
    if (direction === 'down') {
      const game = currentCatalogGames()[0];
      if (game) setFocusedCatalogGame(game, { scroll: true });
      return;
    }
    state.focusedConsoleId = ids[index];
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
      return;
    }
  }
  index = Math.max(0, Math.min(games.length - 1, index));
  setFocusedCatalogGame(games[index], { scroll: true });
}

function activateFocused() {
  if (state.view === 'community') return;
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

function changeView(view) {
  state.view = view;
  state.query = '';
  state.catalogQuery = '';
  $('#search').value = '';
  if (view === 'discover') state.discoverZone = 'systems';
  else state.libraryZone = 'games';
  $('.content').scrollTop = 0;
  render();
}

function cycleView(delta = 1) {
  const index = views.indexOf(state.view);
  changeView(views[(index + delta + views.length) % views.length]);
}

const gamepadState = { buttons: [], direction: null, nextRepeat: 0, initialized: false, acceptAfter: performance.now() + 1500 };

function gamepadDirection(pad) {
  if (pad.buttons[12]?.pressed || (pad.axes[1] || 0) < -0.7) return 'up';
  if (pad.buttons[13]?.pressed || (pad.axes[1] || 0) > 0.7) return 'down';
  if (pad.buttons[14]?.pressed || (pad.axes[0] || 0) < -0.7) return 'left';
  if (pad.buttons[15]?.pressed || (pad.axes[0] || 0) > 0.7) return 'right';
  return null;
}

function handleGamepad() {
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  setControllerStatus();
  if (!pad) {
    gamepadState.initialized = false;
    return;
  }

  if (!gamepadState.initialized || performance.now() < gamepadState.acceptAfter) {
    gamepadState.buttons = [...pad.buttons].map(button => button.pressed);
    gamepadState.direction = gamepadDirection(pad);
    gamepadState.nextRepeat = gamepadState.direction ? Number.POSITIVE_INFINITY : 0;
    gamepadState.initialized = true;
    return;
  }

  const now = performance.now();
  const direction = gamepadDirection(pad);
  if (direction && (direction !== gamepadState.direction || now >= gamepadState.nextRepeat)) {
    if (state.view === 'discover') moveDiscover(direction);
    else moveLibrary(direction);
    gamepadState.nextRepeat = now + (direction === gamepadState.direction ? 145 : 330);
  }
  if (!direction) gamepadState.nextRepeat = 0;
  gamepadState.direction = direction;

  const pressed = index => Boolean(pad.buttons[index]?.pressed && !gamepadState.buttons[index]);
  const startIndex = pad.mapping === 'standard' ? 9 : 7;
  if (pressed(0)) activateFocused();
  if (pressed(1)) backAction();
  if (pressed(2) && !['discover', 'community'].includes(state.view)) surpriseMe();
  if (pressed(3)) setupFocusedSystem();
  if (pressed(4)) cycleView(-1);
  if (pressed(5)) cycleView(1);
  if (pressed(8)) openConsole($('#debugConsole').classList.contains('hidden'));
  if (pressed(startIndex)) cycleView(1);
  gamepadState.buttons = [...pad.buttons].map(button => button.pressed);
}

function formatActivity(entry) {
  const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `[${time}] ${entry.level.toUpperCase().padEnd(7)} ${entry.message}`;
}

function renderActivity() {
  const output = $('#debugOutput');
  output.textContent = state.activities.length ? state.activities.map(formatActivity).join('\n') : 'Waiting for activity...';
  output.scrollTop = output.scrollHeight;
}

async function refreshDiagnostics(includeLibrary = false) {
  const diagnostics = await window.deck.diagnostics(includeLibrary);
  state.diagnostics = diagnostics;
  state.controllerHints = diagnostics.controllers || [];
  state.activities = diagnostics.activity || [];
  state.downloads = diagnostics.downloads || [];
  $('#debugHealth').innerHTML = `<span class="${diagnostics.rgsxRuntime ? 'ok' : 'bad'}">RGSX ${diagnostics.rgsxRuntime ? 'READY' : 'MISSING'}</span><span class="${diagnostics.retroarch ? 'ok' : 'bad'}">RETROARCH ${diagnostics.retroarch ? 'READY' : 'MISSING'}</span><span class="${diagnostics.mame ? 'ok' : 'bad'}">MAME ${diagnostics.mame ? 'READY' : 'MISSING'}</span><span>${state.arcadeAudit?.verified || diagnostics.arcade?.verified || 0}/${state.arcadeAudit?.total || diagnostics.arcade?.total || 0} ARCADE VERIFIED</span><span>${diagnostics.systems.filter(system => system.ready).length} EMULATORS</span><span>${diagnostics.downloads.filter(download => download.status === 'running').length} ACTIVE</span>`;
  renderActivity();
  renderDownloads();
}

function openConsole(show) {
  $('#debugConsole').classList.toggle('hidden', !show);
  $('#consoleToggle').classList.toggle('active', show);
  if (show) refreshDiagnostics();
}

async function loadLibrary(shouldRender = true) {
  state.library = await window.deck.library();
  if (shouldRender) render();
  else {
    renderSystems();
    if (state.view !== 'discover') renderGames();
  }
  renderDownloads();
}

async function refreshCatalogAfterDownload(taskId) {
  if (!taskId || completionRefreshes.has(taskId)) return;
  completionRefreshes.add(taskId);
  const gameKey = [...state.activeCatalogTasks.entries()].find(([, id]) => id === taskId)?.[0];
  if (gameKey != null) state.activeCatalogTasks.delete(gameKey);
  await loadLibrary(state.view !== 'discover');
  if (state.view === 'discover' && state.catalogSystem) {
    state.catalogGames = await window.deck.catalogGames(state.catalogSystem.gamesFile);
    renderCatalogGames();
  }
}

for (const button of document.querySelectorAll('.nav')) button.onclick = () => changeView(button.dataset.view);
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
$('#setupPrimary').onclick = event => {
  if (event.currentTarget.dataset.action === 'discover') changeView('discover');
  else openSetupSettings();
};
$('#setupCheck').onclick = () => runReadyCheck();
$('#surpriseMe').onclick = () => surpriseMe();
$('#sidebarToggle').onclick = toggleSidebar;
$('#densityToggle').onclick = toggleDensity;
$('#artworkFilter').value = state.artworkFilter;
$('#artworkFilter').onchange = event => {
  state.artworkFilter = event.target.value === 'missing-art' ? 'missing-art' : 'all';
  state.focusedGameId = null;
  writePreference('artwork-filter', state.artworkFilter);
  render();
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
    renderCatalogGames();
  } else {
    state.query = event.target.value.toLowerCase();
    render();
  }
};

document.onkeydown = event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleSidebar();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    toggleDensity();
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
    if ($('#search').value) {
      $('#search').value = '';
      state.query = '';
      state.catalogQuery = '';
      render();
    } else {
      $('#search').blur();
    }
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
  setLoading(true, 'Refreshing your deck', 'Scanning installed games and matching each title to its console.', 28);
  try {
    state.library = await window.deck.rescan();
    setLoading(true, 'Finishing the refresh', 'Updating artwork, favorites, and recent activity.', 86);
    await refreshDiagnostics();
    render();
    refreshArcadeAudit(false);
    toast('RGSX library refreshed');
  } finally {
    setLoading(false);
  }
};
$('#arcadeAuditButton').onclick = () => refreshArcadeAudit(true);
$('[data-arcade-filter]').forEach(button => {
  button.onclick = () => {
    state.arcadeFilter = button.dataset.arcadeFilter;
    state.focusedGameId = null;
    render();
  };
});
$('#folder').onclick = () => window.deck.openLibrary();
$('#emptyPrimary').onclick = event => runEmptyAction(event.currentTarget.dataset.action);
$('#emptySecondary').onclick = event => runEmptyAction(event.currentTarget.dataset.action);
$('#spotlightPlay').onclick = () => activateFocused();
$('#spotlightFav').onclick = () => {
  const game = focusedGame();
  if (game) toggleFavorite(game);
};
$('#spotlightArtwork').onclick = () => chooseFocusedArtwork();
$('#spotlightDetails').onclick = () => refreshFocusedDetails();
$('#catalogFeatureAction').onclick = () => catalogAction(focusedCatalogGame() || currentCatalogGames()[0]);
$('#catalogSetup').onclick = () => setupFocusedSystem();
$('#catalogMore').onclick = () => showMoreCatalog(true);
$('#consoleToggle').onclick = () => openConsole($('#debugConsole').classList.contains('hidden'));
$('#consoleClose').onclick = () => openConsole(false);
$('#consoleClear').onclick = async () => {
  await window.deck.clearActivity();
  state.activities = [];
  renderActivity();
};
$('#transferSummary').onclick = () => {
  state.transferExpanded = !state.transferExpanded;
  renderDownloads();
};

$('#openGithub').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck');
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
    if (input) $(input).value = result.path;
  };
});

$('#saveSettings').onclick = async () => {
  const changes = {
    libraryRoot: $('#settingLibrary').value,
    rgsxRoot: $('#settingRgsx').value,
    retroArchPath: $('#settingRetroArch').value,
    retroArchCores: $('#settingCores').value,
    retroArchSystem: $('#settingSystem').value,
    mamePath: $('#settingMame').value,
    sponsorsEnabled: $('#settingSponsors').checked
  };
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
    $('#saveSettings').disabled = false;
    $('#saveSettings').textContent = 'Save settings';
  }
};
$('#restartApp').onclick = () => window.deck.restartApp();

$('.content').addEventListener('scroll', event => {
  if (state.view !== 'discover') return;
  const content = event.currentTarget;
  if (content.scrollHeight - content.scrollTop - content.clientHeight < 500) showMoreCatalog();
}, { passive: true });

window.addEventListener('gamepadconnected', () => {
  gamepadState.initialized = false;
  gamepadState.acceptAfter = performance.now() + 1200;
  setControllerStatus();
});
window.addEventListener('gamepaddisconnected', () => {
  gamepadState.initialized = false;
  setControllerStatus();
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
window.deck.onDownload(download => {
  const index = state.downloads.findIndex(item => item.id === download.id);
  if (index === -1) state.downloads = [download, ...state.downloads];
  else state.downloads[index] = download;
  renderDownloads();

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
  $('#gameSort').value = state.sort;
  setLoading(true, 'Starting GameDeck', 'Checking RGSX, your emulators, and active transfers.', 12);
  await refreshDiagnostics();
  setLoading(true, 'Reading your library', 'Organizing installed games, favorites, and recent plays.', 48);
  await loadLibrary(true);
  setLoading(true, 'Polishing the shelves', 'Preparing artwork and controller navigation.', 88);
  setControllerStatus();
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
  }
  if (captureView) document.body.dataset.captureReady = 'true';
}

init().catch(error => {
  setLoading(false);
  toast(error.message || 'GameDeck could not start');
  openConsole(true);
});
