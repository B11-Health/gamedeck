'use strict';

(() => {
  const native = window.GameDeckAndroid;
  const noopSubscription = () => () => {};
  const parse = (value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };
  const invoke = (name, fallback, ...args) => {
    if (!native || typeof native[name] !== 'function') return fallback;
    try { return native[name](...args); } catch { return fallback; }
  };

  const SYSTEM_IMAGES = Object.freeze({
    snes: 'nintendo-classic', nes: 'nintendo-classic', fds: 'nintendo-classic', satellaview: 'nintendo-classic', sufami: 'nintendo-classic',
    n64: 'nintendo-polygon', gamecube: 'nintendo-polygon', wii: 'nintendo-polygon', wiiu: 'nintendo-polygon',
    gb: 'nintendo-handheld', gba: 'nintendo-handheld', nds: 'nintendo-handheld',
    genesis: 'sega-16bit', sega32x: 'sega-16bit', mastersystem: 'sega-16bit', gamegear: 'sega-16bit',
    segacd: 'sega-3d', saturn: 'sega-3d', dreamcast: 'sega-3d',
    ps1: 'playstation', ps2: 'playstation', psp: 'playstation',
    arcade: 'arcade', mame: 'arcade', atari2600: 'retro', pce: 'retro', openbor: 'retro'
  });
  const THUMBNAIL_REPOS = Object.freeze({
    snes: 'Nintendo_-_Super_Nintendo_Entertainment_System', satellaview: 'Nintendo_-_Satellaview', sufami: 'Nintendo_-_Sufami_Turbo',
    nes: 'Nintendo_-_Nintendo_Entertainment_System', fds: 'Nintendo_-_Family_Computer_Disk_System',
    n64: 'Nintendo_-_Nintendo_64', n64dd: 'Nintendo_-_Nintendo_64DD',
    gb: 'Nintendo_-_Game_Boy', gbc: 'Nintendo_-_Game_Boy_Color', gba: 'Nintendo_-_Game_Boy_Advance', nds: 'Nintendo_-_Nintendo_DS',
    genesis: 'Sega_-_Mega_Drive_-_Genesis', megadrive: 'Sega_-_Mega_Drive_-_Genesis', sega32x: 'Sega_-_32X',
    mastersystem: 'Sega_-_Master_System_-_Mark_III', gamegear: 'Sega_-_Game_Gear', segacd: 'Sega_-_Mega-CD_-_Sega_CD', megacd: 'Sega_-_Mega-CD_-_Sega_CD',
    pce: 'NEC_-_PC_Engine_-_TurboGrafx_16', pcengine: 'NEC_-_PC_Engine_-_TurboGrafx_16', supergrafx: 'NEC_-_PC_Engine_SuperGrafx',
    saturn: 'Sega_-_Saturn', dreamcast: 'Sega_-_Dreamcast', atari2600: 'Atari_-_2600',
    arcade: 'FBNeo_-_Arcade_Games', fbneo: 'FBNeo_-_Arcade_Games', mame: 'MAME', neogeo: 'SNK_-_Neo_Geo',
    ps1: 'Sony_-_PlayStation', psx: 'Sony_-_PlayStation', ps2: 'Sony_-_PlayStation_2', psp: 'Sony_-_PlayStation_Portable',
    gamecube: 'Nintendo_-_GameCube', wii: 'Nintendo_-_Wii', wiiu: 'Nintendo_-_Wii_U'
  });

  const imageForSystem = id => `../assets/system-themes/${SYSTEM_IMAGES[id] || 'retro'}.webp`;
  const stableNumber = value => {
    let hash = 2166136261;
    for (const character of String(value || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return Math.abs(hash >>> 0);
  };
  const normalizedIdentity = value => String(value || '')
    .replace(/\\/g, '/')
    .split('/').pop()
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const rawTitle = value => String(value || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').trim();
  const cleanTitle = value => rawTitle(value)
    .replace(/[_.]/g, ' ')
    .replace(/^Sega\s*-\s*32X\s*/i, '')
    .replace(/\s*\[[^\]]*\]|\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const inferRegion = value => {
    const match = String(value || '').match(/\((USA|Europe|Japan|World|Korea|Australia|Brazil|Asia|Canada|France|Germany|Italy|Spain|Sweden|Taiwan)(?:[^)]*)\)/i);
    return match ? match[1] : '';
  };
  const inferYear = value => String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
  const blocked = (message, reasonCode) => Promise.resolve({ ok: false, blocked: true, message, reasonCode });

  let libraryCache = null;
  const artworkCache = new Map();
  const catalogCache = new Map();

  function normalizeLibrary(library) {
    const source = library && typeof library === 'object' ? library : { systems: [], games: [] };
    const systems = (source.systems || []).map(system => ({
      ...system,
      icon: system.icon || system.short || String(system.name || '?').slice(0, 3).toUpperCase(),
      short: system.short || system.name,
      image: system.image || imageForSystem(system.id),
      installedCount: Number(system.installedCount ?? system.count ?? 0),
      ready: Boolean(system.ready || system.route === 'integrated_external'),
      emulatorLabel: system.route === 'integrated_external' ? 'RetroArch' : 'GameDeck Android',
      issue: system.issue || (system.route === 'integrated_external' ? '' : 'Android game engine setup is still required.')
    }));
    const byId = new Map(systems.map(system => [system.id, system]));
    const games = (source.games || []).map(game => {
      const system = byId.get(game.system);
      return {
        ...game,
        title: game.title || cleanTitle(game.relativePath || game.file),
        metadataTitle: game.metadataTitle || game.title || cleanTitle(game.relativePath || game.file),
        artworkTitle: game.artworkTitle || rawTitle(game.relativePath || game.title),
        artworkFolder: game.artworkFolder || game.system,
        region: game.region || inferRegion(game.relativePath || game.title),
        edition: game.edition || '',
        art: game.art || '',
        format: game.format || 'FILE',
        favorite: Boolean(game.favorite),
        lastPlayed: Number(game.lastPlayed || 0),
        classification: game.classification || system?.route || 'blocked',
        detailsSource: game.detailsSource || 'GameDeck'
      };
    });
    return { ...source, systems, games };
  }

  async function getLibrary(force = false) {
    if (!force && libraryCache) return libraryCache;
    const method = force ? 'rescan' : 'library';
    libraryCache = normalizeLibrary(parse(invoke(method, '{}'), { systems: [], games: [] }));
    return libraryCache;
  }

  function getRuntimeStatus() {
    return parse(invoke('runtimeStatus', '{}'), {
      supported: false,
      ready: false,
      embeddedReady: false,
      externalAvailable: false,
      phase: 'adapter-pending',
      progress: 0,
      reasonCode: 'android_runtime_status_unknown',
      message: 'Android runtime status is unavailable.'
    });
  }

  async function findLibraryGame(title, systemId, context = {}) {
    const library = await getLibrary();
    const file = String(context.file || '');
    if (file) {
      const exact = library.games.find(game => game.file === file || game.contentUri === file);
      if (exact) return exact;
    }
    const identity = normalizedIdentity(context.name || title);
    return library.games.find(game => game.system === systemId && [game.title, game.metadataTitle, game.artworkTitle, game.relativePath]
      .some(value => normalizedIdentity(value) === identity)) || null;
  }

  async function detailsFor(title, systemId, context = {}) {
    const game = await findLibraryGame(title, systemId, context);
    const systemName = context.systemName || game?.systemName || systemId || 'this system';
    const region = game?.region || context.region || inferRegion(context.file || title);
    const year = game?.year || inferYear(context.file || title);
    return {
      title: game?.metadataTitle || title,
      description: game?.description || `${cleanTitle(title)} is part of the ${systemName} collection${region ? ` (${region})` : ''}. GameDeck keeps the game, artwork, saves, favorites, and play history on this device.`,
      releaseDate: game?.releaseDate || '',
      year,
      genre: game?.genre || '',
      players: game?.players || '',
      rating: game?.rating || '',
      developer: game?.developer || '',
      publisher: game?.publisher || '',
      region,
      source: game?.detailsSource || 'GameDeck Android'
    };
  }

  function thumbnailRepo(systemId, folder = '') {
    return THUMBNAIL_REPOS[folder] || THUMBNAIL_REPOS[systemId] || '';
  }

  function thumbnailNames(value) {
    const original = rawTitle(value);
    return [...new Set([
      original,
      original.replace(/\s*\[[^\]]*\]/g, '').trim(),
      original.replace(/\s*\(Rev[^)]*\)/ig, '').trim(),
      original.replace(/\s*\([^)]*\)/g, '').trim()
    ].filter(Boolean))];
  }

  async function remoteArtwork(title, systemId, folder = '') {
    const repo = thumbnailRepo(systemId, folder);
    if (!repo) return '';
    const key = `${repo}:${rawTitle(title)}`;
    if (artworkCache.has(key)) return artworkCache.get(key);
    const request = (async () => {
      for (const candidate of thumbnailNames(title)) {
        const url = `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/${encodeURIComponent(candidate + '.png')}`;
        try {
          const response = await fetch(url, { cache: 'force-cache' });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!blob.type.startsWith('image/') || blob.size < 128) continue;
          return URL.createObjectURL(blob);
        } catch {}
      }
      return '';
    })();
    artworkCache.set(key, request);
    return request;
  }

  async function artworkFor(title, systemId, folder = '') {
    const game = await findLibraryGame(title, systemId, {});
    if (game?.art) return game.art;
    return remoteArtwork(game?.artworkTitle || title, systemId, game?.artworkFolder || folder);
  }

  async function diagnostics() {
    const library = await getLibrary();
    const runtime = getRuntimeStatus();
    return {
      platform: 'android',
      arch: 'arm64',
      library: library.rootName || 'Android document tree',
      libraryExists: Boolean(library.rootConfigured),
      rgsxRuntime: true,
      retroarch: Boolean(runtime.externalAvailable || runtime.embeddedReady),
      mame: false,
      managedRuntime: runtime,
      systems: library.systems,
      downloads: nativeDownloads(),
      activity: [],
      controllers: []
    };
  }

  function nativeDownloads() {
    const rows = parse(invoke('downloads', '[]'), []);
    return Array.isArray(rows) ? rows : [];
  }

  async function catalogSystems() {
    const rows = parse(invoke('catalogSystems', '[]'), []);
    return Array.isArray(rows) ? rows : [];
  }

  async function remoteCatalog(systemId) {
    const repo = thumbnailRepo(systemId, systemId);
    if (!repo) return [];
    if (catalogCache.has(repo)) return catalogCache.get(repo);
    const request = (async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/contents/Named_Boxarts?per_page=1000`, {
          headers: { Accept: 'application/vnd.github+json' },
          cache: 'force-cache'
        });
        if (!response.ok) return [];
        const rows = await response.json();
        if (!Array.isArray(rows)) return [];
        return rows
          .filter(row => row?.type === 'file' && /\.png$/i.test(row.name || '') && row.download_url)
          .map(row => {
            const title = rawTitle(row.name);
            return {
              id: stableNumber(`${systemId}:${title}`),
              name: cleanTitle(title),
              fileName: title,
              region: inferRegion(title),
              tags: [systemId.toUpperCase(), 'Cover catalog'],
              art: row.download_url,
              installedFile: '',
              installedReady: false,
              size: 0
            };
          });
      } catch {
        return [];
      }
    })();
    catalogCache.set(repo, request);
    return request;
  }

  async function catalogGames(source) {
    const rows = parse(invoke('catalogGames', '[]', source || ''), []);
    return Array.isArray(rows) ? rows : [];
  }

  function subscribeDownloads(callback) {
    if (typeof callback !== 'function') return () => {};
    let stopped = false;
    let timer = 0;
    const previous = new Map();
    const poll = () => {
      if (stopped) return;
      const rows = nativeDownloads();
      let active = false;
      rows.forEach(row => {
        const id = String(row?.id || row?.taskId || '');
        if (!id) return;
        const signature = JSON.stringify(row);
        if (previous.get(id) !== signature) callback(row);
        previous.set(id, signature);
        if (['queued', 'running', 'pausing'].includes(String(row?.status || ''))) active = true;
      });
      timer = window.setTimeout(poll, active ? 120 : 700);
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }

  async function settingsSnapshot() {
    const library = await getLibrary();
    const runtime = getRuntimeStatus();
    return {
      platform: 'android', arch: 'arm64', version: '0.4.1-controls',
      libraryRoot: library.rootName || '', rgsxRoot: 'Automatic',
      retroArchPath: runtime.externalPackage || '', retroArchCores: '', retroArchSystem: '', mamePath: '', sponsorsEnabled: false
    };
  }

  window.deck = Object.freeze({
    library: () => getLibrary(),
    rescan: () => getLibrary(true),
    launch: async file => {
      const target = typeof file === 'string' ? file : file?.contentUri || file?.file || '';
      const game = (await getLibrary()).games.find(item => item.file === target || item.contentUri === target);
      const result = parse(invoke('launch', '{}', target, game?.mimeType || 'application/octet-stream'), { ok: false, message: 'Launch route unavailable.' });
      if (result.ok) libraryCache = null;
      return result;
    },
    setupSystem: async () => blocked('Android engine provisioning is not complete in this preview.', 'android_runtime_provisioning_pending'),
    favorite: async file => {
      invoke('favorite', '{}', file || '');
      return getLibrary(true);
    },
    prepareGame: async file => ({ ok: true, file }),
    artwork: artworkFor,
    gameDetails: detailsFor,
    refreshGameDetails: detailsFor,
    chooseGameArtwork: async () => ({ ok: false, canceled: true }),
    deleteGame: async () => blocked('Safe Android removal is not enabled in this preview.', 'android_safe_delete_pending'),

    catalogSystems,
    catalogGames,
    importOwned: async (source, folder, title, fileName) => {
      const result = parse(invoke('importOwned', '{}', source || '', folder || '', title || '', fileName || ''), {
        ok: false,
        error: 'Android could not start this managed transfer.'
      });
      if (result?.ok) libraryCache = null;
      return result;
    },
    retryDownload: async taskId => parse(invoke('retryDownload', '{}', taskId || ''), { ok: false }),
    pauseDownload: async taskId => parse(invoke('pauseDownload', '{}', taskId || ''), { ok: false }),
    dismissDownload: async taskId => parse(invoke('dismissDownload', '{}', taskId || ''), { ok: false }),

    diagnostics,
    runtimeStatus: async () => getRuntimeStatus(),
    ensureRuntime: async () => getRuntimeStatus(),
    playSessionCapabilities: async () => ({ supported: false, reasonCode: 'android_play_session_pending' }),
    playSessionStatus: async () => ({ active: false, supported: false }),
    arcadeAudit: async () => {
      const games = (await getLibrary()).games.filter(game => ['arcade', 'mame'].includes(game.system));
      return { total: games.length, verified: 0, attention: 0, unchecked: games.length, items: games.map(game => ({ file: game.file, status: 'unchecked', message: 'Android archive audit is pending.' })) };
    },

    settings: settingsSnapshot,
    inspectSettings: async () => {
      const library = await getLibrary();
      const runtime = getRuntimeStatus();
      return {
        requiredReady: Boolean(library.rootConfigured),
        summary: library.rootConfigured ? 'Android library access is ready.' : 'Choose a game library folder.',
        fields: {
          libraryRoot: { ready: Boolean(library.rootConfigured), tone: library.rootConfigured ? 'ok' : 'bad', message: library.rootConfigured ? 'Secure folder access active.' : 'Choose a folder through Android.' },
          rgsxRoot: { ready: true, tone: 'ok', message: 'Discover is connected automatically.' },
          retroArchPath: { ready: Boolean(runtime.externalAvailable), tone: runtime.externalAvailable ? 'ok' : 'muted', message: runtime.externalAvailable ? 'External RetroArch detected.' : 'Embedded Android engine pending.' },
          retroArchCores: { ready: false, tone: 'muted', message: 'Managed Android cores pending.' },
          retroArchSystem: { ready: false, tone: 'muted', message: 'Managed firmware path pending.' },
          mamePath: { ready: false, tone: 'muted', message: 'Standalone Android MAME pending.' }
        }
      };
    },
    saveSettings: async values => ({ ok: true, restartRequired: false, settings: values || {} }),
    chooseDirectory: async kind => {
      if (kind === 'libraryRoot' || kind === 'library') invoke('chooseLibrary', null);
      return { ok: true, canceled: false };
    },
    openLibrary: async () => { invoke('chooseLibrary', null); return { ok: true }; },
    sponsors: async () => ({ enabled: false, placements: [] }),
    donations: async () => ({ headline: 'Support GameDeck', message: 'Community support information is available on the project page.', methods: [] }),
    openExternal: async target => { invoke('openExternal', null, target || ''); return { ok: true }; },
    copyText: async value => parse(invoke('copyText', '{"ok":true}', value || ''), { ok: true }),
    readClipboard: async () => '',
    restartApp: async () => { location.reload(); return { ok: true }; },
    clearActivity: async () => ({ ok: true }),

    streamStatus: async () => ({ active: false, supported: false, message: 'Hosting GameDeck Live remains a desktop capability.' }),
    streamSources: async () => [],
    streamStart: async () => blocked('Android cannot host GameDeck Live in this preview.', 'android_stream_host_pending'),
    streamStop: async () => ({ ok: true }),
    streamHostPull: async () => [],
    streamHostSend: async () => ({ ok: false }),

    remotePlayCodeEncode: async () => blocked('Remote Play invitation creation is unavailable.', 'android_remote_play_host_pending'),
    remotePlayCodeDecode: async () => blocked('Direct Remote Play guest support is pending.', 'android_remote_play_guest_pending'),
    remotePlayStatus: async () => ({ active: false, supported: false }),
    remotePlayStart: async () => blocked('Direct Remote Play guest support is pending.', 'android_remote_play_guest_pending'),
    remotePlayStop: async () => ({ ok: true }),
    remotePlayInput: () => {},

    netplayStatus: async () => ({ active: false, supported: false }),
    netplayGameInfo: async () => ({ supported: false }),
    netplayMatchInfo: async () => ({ supported: false }),
    netplayRelays: async () => [],
    netplayHost: async () => blocked('Synchronized netplay is pending on Android.', 'android_netplay_pending'),
    netplayJoin: async () => blocked('Synchronized netplay is pending on Android.', 'android_netplay_pending'),
    netplayStop: async () => ({ ok: true }),

    onActivity: noopSubscription,
    onArcadeAudit: noopSubscription,
    onRuntime: noopSubscription,
    onLaunch: noopSubscription,
    onDownload: subscribeDownloads,
    onStream: noopSubscription,
    onRemotePlay: noopSubscription,
    onNetplay: noopSubscription
  });

  function installAndroidPresentationGuard() {
    const apply = () => {
      document.documentElement.classList.add('gamedeck-android');
      const legend = document.querySelector('#controlLegend, .control-legend');
      if (legend) {
        legend.classList.add('hidden');
        legend.setAttribute('aria-hidden', 'true');
      }

      const replacements = [
        ['#setupCoachTitle', 'Connect your library and play route.'],
        ['#setupCoachMessage', 'Choose games you legally own. GameDeck keeps them local; a compatible Android runtime is still required to play.'],
        ['#setupPrimary', 'Review Android setup']
      ];
      replacements.forEach(([selector, value]) => {
        const element = document.querySelector(selector);
        if (element && element.textContent !== value) element.textContent = value;
      });

      document.querySelectorAll('#setupSteps small, #setupCoach p, .runtime-copy, .settings-field p').forEach(element => {
        const text = String(element.textContent || '');
        let next = text;
        if (/full emulator stack is included/i.test(text) || /no separate emulator installation/i.test(text)) {
          next = 'GameDeck manages the local library and catalog. A compatible Android runtime is still required to launch games.';
        } else if (/keyboard and mouse are ready/i.test(text)) {
          next = 'Touch controls are ready; connect a gamepad at any time.';
        } else if (/included with gamedeck\. finish setup once/i.test(text)) {
          next = 'Managed library support is ready. Install a compatible Android runtime to launch this system.';
        }
        if (next !== text) element.textContent = next;
      });
    };

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        apply();
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
    else schedule();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  installAndroidPresentationGuard();

  const keyMap = Object.freeze({ UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', A: 'Enter', B: 'Escape' });
  window.GameDeckInput = {
    handle(input, pressed) {
      if (!pressed) return;
      if (input === 'START') return window.GameDeckMultiplayer?.open?.();
      const key = keyMap[input];
      if (key) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
  };
  window.GameDeckNative = {
    onStorageChanged() { libraryCache = null; location.reload(); },
    showMessage(message) { console.info(message); },
    back() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
  };
})();
