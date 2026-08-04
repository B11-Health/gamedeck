'use strict';

(() => {
  const native = window.GameDeckAndroid;
  let appInfo = {};
  try { appInfo = JSON.parse(native?.appInfo?.() || '{}'); } catch {}
  if (!appInfo.debugFixture || !window.deck) return;

  const cover = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#182544"/><stop offset=".55" stop-color="#6d3eb8"/><stop offset="1" stop-color="#c8ff52"/></linearGradient>
      </defs>
      <rect width="600" height="900" rx="38" fill="url(#g)"/>
      <circle cx="448" cy="212" r="122" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="16"/>
      <path d="M72 650 C170 510 290 520 528 355" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" opacity=".68"/>
      <text x="62" y="116" fill="#c8ff52" font-family="sans-serif" font-size="34" font-weight="800">SUPER NINTENDO</text>
      <text x="62" y="710" fill="#fff" font-family="sans-serif" font-size="72" font-weight="900">CHRONO</text>
      <text x="62" y="790" fill="#fff" font-family="sans-serif" font-size="72" font-weight="900">TRIGGER</text>
      <text x="64" y="842" fill="#fff" fill-opacity=".72" font-family="sans-serif" font-size="24">GAMEDECK PARITY FIXTURE</text>
    </svg>
  `)}`;
  let favorite = true;
  const game = {
    id: 'android-parity-chrono-trigger',
    title: 'Chrono Trigger',
    metadataTitle: 'Chrono Trigger',
    artworkTitle: 'Chrono Trigger (USA)',
    artworkFolder: 'snes',
    shortName: 'Chrono Trigger (USA)',
    file: 'content://io.gamedeck.fixture/snes/chrono-trigger.sfc',
    contentUri: 'content://io.gamedeck.fixture/snes/chrono-trigger.sfc',
    relativePath: 'snes/Chrono Trigger (USA).sfc',
    mimeType: 'application/octet-stream',
    system: 'snes',
    systemName: 'Super Nintendo',
    size: 4194304,
    modified: 1785852000000,
    format: 'SFC',
    art: cover,
    favorite: true,
    lastPlayed: 1785852000000,
    classification: 'integrated_external',
    region: 'USA',
    edition: 'USA',
    description: 'A time-traveling role-playing adventure spanning prehistory, the present, and a ruined future, with strategic team techniques and multiple endings.',
    releaseDate: '1995-03-11',
    year: '1995',
    players: '1',
    rating: '9.4',
    genre: 'Role-playing',
    developer: 'Square',
    publisher: 'Square',
    detailsSource: 'Local metadata'
  };
  const system = {
    id: 'snes', systemId: 'snes', name: 'Super Nintendo', short: 'SNES', icon: 'S', color: '#8b5cf6',
    folders: ['snes'], core: 'snes9x_libretro', image: '../assets/system-themes/nintendo-classic.webp',
    count: 1, installedCount: 1, ready: true, route: 'integrated_external', emulatorLabel: 'RetroArch', issue: ''
  };

  const library = () => ({
    rootConfigured: true,
    rootUri: 'content://io.gamedeck.fixture/tree/library',
    rootName: 'GameDeck Parity Fixture',
    truncated: false,
    scanLimit: 5000,
    error: '',
    systems: [{ ...system }],
    games: [{ ...game, favorite }]
  });
  const details = () => ({
    title: game.title,
    description: game.description,
    releaseDate: game.releaseDate,
    year: game.year,
    players: game.players,
    rating: game.rating,
    genre: game.genre,
    developer: game.developer,
    publisher: game.publisher,
    region: game.region,
    source: game.detailsSource
  });
  const base = window.deck;
  window.deck = Object.freeze({
    ...base,
    library: async () => library(),
    rescan: async () => library(),
    favorite: async () => { favorite = !favorite; return library(); },
    artwork: async () => cover,
    gameDetails: async () => details(),
    refreshGameDetails: async () => details(),
    diagnostics: async () => ({
      platform: 'android', arch: 'x86_64', library: 'GameDeck Parity Fixture', libraryExists: true,
      rgsxRuntime: true, retroarch: true, mame: false,
      managedRuntime: { supported: false, ready: false, embeddedReady: false, externalAvailable: true, phase: 'external-detected', progress: 0 },
      systems: [{ ...system }], downloads: [], activity: [], controllers: []
    }),
    catalogSystems: async () => [{ ...system, folder: 'snes', gamesFile: 'snes', playable: true }],
    catalogGames: async () => [{
      id: 1995, name: game.title, fileName: game.artworkTitle, region: game.region,
      tags: [game.genre, game.year], art: cover, installedFile: game.file, installedReady: true, size: game.size
    }],
    settings: async () => ({
      platform: 'android', arch: 'x86_64', version: appInfo.version || 'debug', libraryRoot: 'GameDeck Parity Fixture',
      rgsxRoot: 'Automatic', retroArchPath: 'Detected', retroArchCores: '', retroArchSystem: '', mamePath: '', sponsorsEnabled: false
    })
  });
})();
