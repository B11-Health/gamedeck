const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

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
  sponsorTarget: '',
  transferExpanded: false,
  catalogLimit: 120
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

function gameArt(game) {
  const system = systemById(game.system);
  return game.art || assetFallback(game.title, system?.color || '#24334b', '#101722');
}

function systemNeedsFirmware(system) {
  return Boolean(system && !system.ready && String(system.issue || '').toLowerCase().includes('firmware'));
}

function currentGames() {
  let games = state.library.games;
  if (state.selectedSystem !== 'all') games = games.filter(game => game.system === state.selectedSystem);
  if (state.view === 'favorites') games = games.filter(game => game.favorite);
  if (state.view === 'recent') games = games.filter(game => game.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  if (state.query) games = games.filter(game => game.title.toLowerCase().includes(state.query));
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
  const pill = $('#controllerStatus');
  pill.textContent = pad ? `${String(pad.id || 'Controller').split('(')[0].trim().slice(0, 25)} connected` : 'No controller';
  pill.classList.toggle('connected', Boolean(pad));
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
}

function queueArtwork(key, work) {
  if (state.artworkLoading.has(key)) return;
  state.artworkLoading.add(key);
  artworkQueue.push({ key, work });
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

function requestArtwork(game) {
  if (!game || game.art) return;
  const key = `library:${game.id}`;
  queueArtwork(key, async () => {
    const url = await window.deck.artwork(game.artworkTitle || game.title, game.system, game.artworkFolder || '');
    updateGameArtwork(game, url);
  });
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
  const launcher = system?.core ? 'RetroArch' : system?.name || 'your configured emulator';
  const fallback = fallbackDescription(game.title, system?.name || 'this console', true);
  const cached = state.gameDetails.get(detailKey(game.artworkTitle || game.title, game.system));
  $('#spotlightSystem').textContent = `${system?.name || 'Game'} / ${system?.ready ? 'READY TO PLAY' : 'SETUP NEEDED'}`;
  $('#spotlightTitle').textContent = game.title;
  $('#spotlightFacts').innerHTML = factMarkup([system?.short || system?.name, cached?.year, cached?.players && `${cached.players} player${cached.players === '1' ? '' : 's'}`, sizeLabel(game.size)]);
  $('#spotlightDescription').textContent = cached?.description || fallback;
  $('#spotlightMeta').textContent = `${relative(game.lastPlayed)} · Opens with ${launcher}`;
  $('#spotlightFav').textContent = game.favorite ? 'Remove save' : 'Save game';
  $('#spotlightArt').innerHTML = `<img src="${escapeHtml(art)}" alt="${escapeHtml(game.title)} cover">`;
  $('#spotlightBackdrop').src = art;
  spotlight.classList.remove('hidden');
  requestArtwork(game);
  queueGameDetails(game.artworkTitle || game.title, game.system, {
    name: game.title,
    systemName: system?.name,
    installed: true
  }, details => {
    if (state.focusedGameId !== game.id) return;
    $('#spotlightDescription').textContent = details.description || fallback;
    $('#spotlightFacts').innerHTML = factMarkup([system?.short || system?.name, details.year, details.players && `${details.players} player${details.players === '1' ? '' : 's'}`, sizeLabel(game.size)]);
  });

  if (options.scroll) {
    const card = document.querySelector(`.game[data-id="${game.id}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function renderSystems() {
  const allFocused = state.libraryZone === 'systems' && state.focusedLibrarySystem === 'all';
  const all = `<button class="system ${state.selectedSystem === 'all' ? 'active' : ''} ${allFocused ? 'controller-focus' : ''}" data-id="all"><span class="sys-icon" style="--c:#c8ff52">ALL</span><span class="sys-copy"><b>All games</b><small>Full collection</small></span><span class="count">${state.library.games.length}</span></button>`;
  const systems = state.library.systems.map(system => {
    const focused = state.libraryZone === 'systems' && state.focusedLibrarySystem === system.id;
    const art = system.image ? `<img src="${escapeHtml(system.image)}" alt="">` : escapeHtml(system.icon);
    const installed = Number(system.installedCount || 0);
    const total = Number(system.count || 0);
    const countLabel = installed > 0 ? `${installed}/${total}` : String(total);
    return `<button class="system ${state.selectedSystem === system.id ? 'active' : ''} ${focused ? 'controller-focus' : ''}" data-id="${system.id}" title="${escapeHtml(system.issue || '')}"><span class="sys-icon" style="--c:${system.color}">${art}</span><span class="sys-copy"><b>${escapeHtml(system.name)}</b><small>${systemStatusLabel(system)}</small></span><span class="count">${countLabel}</span></button>`;
  }).join('');
  $('#systems').innerHTML = all + systems;

  $$('.system').forEach(button => {
    button.onclick = () => selectLibrarySystem(button.dataset.id);
    button.onmouseenter = () => { state.focusedLibrarySystem = button.dataset.id; };
  });
}

function renderGames() {
  const games = currentGames();
  $('#games').innerHTML = games.map(game => {
    const system = systemById(game.system);
    const active = game.id === state.focusedGameId;
    return `<article class="game ${active ? 'active' : ''}" tabindex="0" role="button" aria-label="Play ${escapeHtml(game.title)} on ${escapeHtml(system?.name || 'GameDeck')}" data-id="${game.id}"><div class="cover" style="--c:${system?.color || '#8992a3'}"><div class="cover-art"><img data-game-art="${game.id}" src="${escapeHtml(gameArt(game))}" alt="${escapeHtml(game.title)} artwork" loading="lazy"></div><span class="cover-system">${escapeHtml(system?.short || 'GAME')}</span><button class="fav ${game.favorite ? 'on' : ''}" aria-label="${game.favorite ? 'Remove favorite' : 'Favorite'}">${game.favorite ? 'SAVED' : 'SAVE'}</button><div class="cover-logo">${escapeHtml(system?.icon || 'G')}</div><div class="cover-title">${escapeHtml(game.title)}</div><button class="play" aria-label="Play ${escapeHtml(game.title)}"><span aria-hidden="true">▶</span> PLAY</button></div><div class="meta"><b title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</b><div class="game-card-facts"><span>${escapeHtml(system?.name || 'Game')}</span><span>${escapeHtml(sizeLabel(game.size))}</span></div><small><span class="ready-dot"></span>${escapeHtml(relative(game.lastPlayed))}</small></div></article>`;
  }).join('');

  $('#empty').classList.toggle('hidden', games.length > 0);
  $$('.game').forEach(card => {
    const game = games.find(item => item.id === card.dataset.id);
    card.onmouseenter = () => setFocusedGame(game);
    card.onfocus = () => setFocusedGame(game);
    card.onclick = event => {
      if (event.target.closest('button')) return;
      setFocusedGame(game);
      launch(game.file);
    };
    card.querySelector('.play').onclick = event => {
      event.stopPropagation();
      setFocusedGame(game);
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
  $('#settingSponsors').checked = settings.sponsorsEnabled !== false;
  $('#runtimeBadge').textContent = `${String(settings.platform || 'desktop').toUpperCase()} · ${String(settings.arch || '')} · v${settings.version || '1.0.0'}`;

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
  $('#donationHeadline').textContent = donations.headline || 'Fuel the next build';
  $('#donationMessage').textContent = donations.message || 'Public donation methods are being configured. Wallet secrets never ship with GameDeck.';
  $('#donationMethods').innerHTML = (donations.methods || []).map(method => `
    <button type="button" class="donation-method" data-address="${escapeHtml(method.address)}" title="Copy ${escapeHtml(method.label)} address">
      <b>${escapeHtml(method.label)}</b><code>${escapeHtml(shortAddress(method.address))}</code><span>COPY</span>
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
  $$('.nav').forEach(button => button.classList.toggle('active', button.dataset.view === view));
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
  $('#spotlight').classList.toggle('hidden', discover || community || !focusedGame());
  $('.control-legend').classList.toggle('hidden', community);
  $('.toolbar').classList.toggle('hidden', community);
  $('#toolbarContext').textContent = discover ? 'DOWNLOADS STAY VISIBLE WHILE YOU BROWSE' : 'CLICK OR PRESS A TO LAUNCH';
  $('#search').placeholder = discover ? 'Search this console catalog' : 'Search your collection';

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
  $('#headline').innerHTML = state.view === 'favorites' ? 'Saved for<br><em>the next run.</em>' : state.view === 'recent' ? 'Jump straight<br><em>back in.</em>' : selected ? `${escapeHtml(selected.name)}<br><em>collection.</em>` : 'Your games.<br><em>One move away.</em>';
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

async function refreshDiagnostics() {
  const diagnostics = await window.deck.diagnostics();
  state.activities = diagnostics.activity || [];
  state.downloads = diagnostics.downloads || [];
  $('#debugHealth').innerHTML = `<span class="${diagnostics.rgsxRuntime ? 'ok' : 'bad'}">RGSX ${diagnostics.rgsxRuntime ? 'READY' : 'MISSING'}</span><span class="${diagnostics.retroarch ? 'ok' : 'bad'}">RETROARCH ${diagnostics.retroarch ? 'READY' : 'MISSING'}</span><span>${diagnostics.systems.filter(system => system.ready).length} EMULATORS</span><span>${diagnostics.downloads.filter(download => download.status === 'running').length} ACTIVE</span>`;
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

$$('.nav').forEach(button => button.onclick = () => changeView(button.dataset.view));
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
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && event.key !== 'Escape') return;
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
    render();
    toast('RGSX library refreshed');
  } finally {
    setLoading(false);
  }
};
$('#folder').onclick = $('#emptyFolder').onclick = () => window.deck.openLibrary();
$('#emptyDiscover').onclick = () => changeView('discover');
$('#spotlightPlay').onclick = () => activateFocused();
$('#spotlightFav').onclick = () => {
  const game = focusedGame();
  if (game) toggleFavorite(game);
};
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
$('#openFunding').onclick = () => openCommunityLink('https://github.com/B11-Health/gamedeck/blob/main/FUNDING.md');
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
      retroArchSystem: '#settingSystem'
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
  setLoading(true, 'Starting GameDeck', 'Checking RGSX, your emulators, and active transfers.', 12);
  await refreshDiagnostics();
  setLoading(true, 'Reading your library', 'Organizing installed games, favorites, and recent plays.', 48);
  await loadLibrary(true);
  setLoading(true, 'Polishing the shelves', 'Preparing artwork and controller navigation.', 88);
  setControllerStatus();
  setInterval(handleGamepad, 90);
  setLoading(false);
  const captureView = new URLSearchParams(window.location.search).get('captureView');
  if (captureView && views.includes(captureView)) changeView(captureView);
  else if (captureView === 'transfers') {
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
  }
}

init().catch(error => {
  setLoading(false);
  toast(error.message || 'GameDeck could not start');
  openConsole(true);
});
