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
  const imageForSystem = id => `../assets/system-themes/${SYSTEM_IMAGES[id] || 'retro'}.webp`;
  const stableNumber = value => {
    let hash = 2166136261;
    for (const character of String(value || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return Math.abs(hash >>> 0);
  };
  const inferRegion = value => {
    const match = String(value || '').match(/\((USA|Europe|Japan|World|Korea|Australia|Brazil|Asia)\)/i);
    return match ? match[1] : '';
  };
  const inferYear = value => {
    const match = String(value || '').match(/(?:19|20)\d{2}/);
    return match ? match[0] : '';
  };

  function normalizedLibrary() {
    const library = parse(invoke('library', '{}'), { systems: [], games: [] });
    const systems = (library.systems || []).map(system => ({
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
    const games = (library.games || []).map(game => {
      const system = byId.get(game.system);
      return {
        ...game,
        metadataTitle: game.metadataTitle || game.title,
        artworkTitle: game.artworkTitle || game.title,
        artworkFolder: game.artworkFolder || game.system,
        region: game.region || inferRegion(game.relativePath || game.title),
        edition: game.edition || '',
        art: game.art || '',
        format: game.format || 'FILE',
        favorite: Boolean(game.favorite),
        lastPlayed: Number(game.lastPlayed || 0),
        classification: game.classification || system?.route || 'blocked'
      };
    });
    return { ...library, systems, games };
  }

  function runtimeStatus() {
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

  function detailsFor(title, systemId, context = {}) {
    const systemName = context.systemName || systemId || 'this system';
    const region = context.region || inferRegion(context.file || title);
    const year = inferYear(context.file || title);
    return {
      title,
      description: `${title} is part of your local ${systemName} collection. GameDeck keeps the game, artwork, saves, and play history on this device.`,
      year,
      genre: '',
      players: '',
      developer: '',
      publisher: '',
      region,
      source: 'GameDeck Android'
    };
  }

  async function diagnostics() {
    const library = normalizedLibrary();
    const runtime = runtimeStatus();
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
      downloads: [],
      activity: [],
      controllers: []
    };
  }

  async function catalogSystems() {
    const library = normalizedLibrary();
    return library.systems.map(system => ({
      id: system.id,
      systemId: system.id,
      folder: system.id,
      gamesFile: system.id,
      name: system.name,
      image: system.image || imageForSystem(system.id),
      count: Number(system.count || 0),
      installedCount: Number(system.installedCount || 0),
      playable: Boolean(system.ready),
      issue: system.issue || ''
    }));
  }

  async function catalogGames(source) {
    const library = normalizedLibrary();
    return library.games
      .filter(game => game.system === source)
      .map(game => ({
        id: stableNumber(game.id || game.file),
        name: game.title,
        fileName: game.relativePath || game.title,
        region: game.region || '',
        tags: [game.format, game.systemName].filter(Boolean),
        art: game.art || '',
        installedFile: game.file,
        installedReady: game.classification !== 'blocked',
        size: Number(game.size || 0)
      }));
  }

  const blocked = (message, reasonCode) => Promise.resolve({ ok: false, blocked: true, message, reasonCode });

  window.deck = Object.freeze({
    library: async () => normalizedLibrary(),
    rescan: async () => parse(invoke('rescan', '{}'), normalizedLibrary()),
    launch: async file => parse(invoke('launch', '{}', typeof file === 'string' ? file : file?.contentUri || file?.file || '', 'application/octet-stream'), { ok: false, message: 'Launch route unavailable.' }),
    favorite: async file => parse(invoke('favorite', '{}', file || ''), { ok: false }),
    prepareGame: async file => ({ ok: true, file }),
    artwork: async () => null,
    gameDetails: async (title, systemId, context) => detailsFor(title, systemId, context || {}),
    refreshGameDetails: async (title, systemId, context) => detailsFor(title, systemId, context || {}),
    chooseGameArtwork: async () => ({ ok: false, canceled: true }),
    deleteGame: async () => blocked('Safe Android removal is not enabled in this preview.', 'android_safe_delete_pending'),

    catalogSystems,
    catalogGames,
    importOwned: async () => blocked('Discover downloads are not enabled in this preview.', 'android_discover_transfer_pending'),
    retryDownload: async () => ({ ok: false }),
    pauseDownload: async () => ({ ok: false }),
    dismissDownload: async () => ({ ok: true }),

    diagnostics,
    runtimeStatus: async () => runtimeStatus(),
    ensureRuntime: async () => runtimeStatus(),
    arcadeAudit: async () => {
      const games = normalizedLibrary().games.filter(game => ['arcade', 'mame'].includes(game.system));
      return { total: games.length, verified: 0, attention: 0, unchecked: games.length, items: games.map(game => ({ file: game.file, status: 'unchecked', message: 'Android archive audit is pending.' })) };
    },

    settings: async () => ({
      platform: 'android', arch: 'arm64', version: '0.3.0-preview',
      libraryRoot: normalizedLibrary().rootName || '', rgsxRoot: 'Automatic',
      retroArchPath: runtimeStatus().externalPackage || '', retroArchCores: '', retroArchSystem: '', mamePath: '', sponsorsEnabled: false
    }),
    inspectSettings: async values => ({
      requiredReady: Boolean(normalizedLibrary().rootConfigured),
      summary: normalizedLibrary().rootConfigured ? 'Android library access is ready.' : 'Choose a game library folder.',
      fields: {
        libraryRoot: { ready: Boolean(normalizedLibrary().rootConfigured), tone: normalizedLibrary().rootConfigured ? 'ok' : 'bad', message: normalizedLibrary().rootConfigured ? 'Secure folder access active.' : 'Choose a folder through Android.' },
        rgsxRoot: { ready: true, tone: 'ok', message: 'Discover is connected automatically.' },
        retroArchPath: { ready: Boolean(runtimeStatus().externalAvailable), tone: runtimeStatus().externalAvailable ? 'ok' : 'muted', message: runtimeStatus().externalAvailable ? 'External RetroArch detected.' : 'Embedded Android engine pending.' },
        retroArchCores: { ready: false, tone: 'muted', message: 'Managed Android cores pending.' },
        retroArchSystem: { ready: false, tone: 'muted', message: 'Managed firmware path pending.' },
        mamePath: { ready: false, tone: 'muted', message: 'Standalone Android MAME pending.' }
      }
    }),
    saveSettings: async values => ({ ok: true, restartRequired: false, settings: values || {} }),
    chooseDirectory: async kind => {
      if (kind === 'libraryRoot' || kind === 'library') invoke('chooseLibrary', null);
      return { ok: true };
    },
    openLibrary: async () => { invoke('chooseLibrary', null); return { ok: true }; },
    sponsors: async () => ({ enabled: false, placements: [] }),
    donations: async () => ({ headline: 'Support GameDeck', message: 'Community support information is available on the desktop project page.', methods: [] }),
    openExternal: async target => { invoke('openExternal', null, target || ''); return { ok: true }; },
    copyText: async value => parse(invoke('copyText', '{"ok":true}', value || ''), { ok: true }),
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
    netplayRelays: async () => [],
    netplayHost: async () => blocked('Synchronized netplay is pending on Android.', 'android_netplay_pending'),
    netplayJoin: async () => blocked('Synchronized netplay is pending on Android.', 'android_netplay_pending'),
    netplayStop: async () => ({ ok: true }),

    onActivity: noopSubscription,
    onArcadeAudit: noopSubscription,
    onRuntime: noopSubscription,
    onLaunch: noopSubscription,
    onDownload: noopSubscription,
    onStream: noopSubscription,
    onRemotePlay: noopSubscription,
    onNetplay: noopSubscription
  });

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
    onStorageChanged() { location.reload(); },
    showMessage(message) { console.info(message); },
    back() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  };
})();
