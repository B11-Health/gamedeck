import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = file => readFile(path.join(root, file), 'utf8');
const fail = message => {
  console.error(`Smoke test failed: ${message}`);
  process.exitCode = 1;
};

const [main, preload, renderer, html, styles, pkgText, donations, runtimeManager, runtimeManifest, runtimeCacheBuilder, streamServer, streamingRenderer, netplayManager, netplayRenderer, mobileReceiver, androidActivity, iosContent, iosInfo] = await Promise.all([
  read('main.js'),
  read('preload.js'),
  read('src/app.js'),
  read('src/index.html'),
  read('src/styles.css'),
  read('package.json'),
  read('config/donations.json'),
  read('runtime-manager.js'),
  read('config/runtime-manifest.json'),
  read('scripts/prepare-runtime-cache.mjs'),
  read('stream-server.js'),
  read('src/streaming.js'),
  read('netplay-manager.js'),
  read('src/netplay.js'),
  read('mobile/web/app.js'),
  read('mobile/android/app/src/main/java/io/gamedeck/mobile/MainActivity.java'),
  read('mobile/ios/GameDeckMobile/ContentView.swift'),
  read('mobile/ios/GameDeckMobile/Info.plist')
]);
const pkg = JSON.parse(pkgText);
const donationConfig = JSON.parse(donations);
const managedRuntimeManifest = JSON.parse(runtimeManifest);

for (const id of [
  'games',
  'discover',
  'community',
  'sponsorCard',
  'donationMethods',
  'settingLibrary',
  'spotlightDelete',
  'mainContent',
  'sidebarToggle',
  'headerGameInfo',
  'headerEngineInfoText',
  'headerTransferInfoText',
  'headerInfoBar',
  'headerMenuToggle',
  'headerMenu',
  'tutorialOpen',
  'streamToggle',
  'streamStudio',
  'streamSource',
  'streamStart',
  'streamStop',
  'streamPairCode',
  'streamViewerCount',
  'netplayToggle',
  'netplayStudio',
  'netplayHost',
  'netplayJoin',
  'netplayInviteValue',
  'netplayMaxPlayers',
  'netplayQuality',
  'netplayPlayerSlot',
  'netplayHostTools',
  'netplayCreateInvite',
  'netplayAnswerInput',
  'netplayAcceptAnswer',
  'netplayJoinResponse',
  'netplayJoinResponseValue',
  'netplayRemoteVideo',
  'netplayPlayerCount',
  'spotlightOnline',
  'libraryToolbar',
  'transferDismissFinished',
  'transferOpenLibrary',
  'transferActions',
  'transferGlyph',
  'statusSuccessCount',
  'statusIssueCount',
  'statusAllCount',
  'statusSummaryMessage',
  'statusSummaryTitle',
  'consoleCopy',
  'rescanLabel',
  'searchClear',
  'settingMameState',
  'settingSystemState',
  'settingCoresState',
  'settingRetroArchState',
  'settingRgsxState',
  'settingLibraryState',
  'settingsReadinessMessage',
  'settingsReadinessTitle',
  'settingsReadiness',
  'controlLegend',
  'discoverTools',
  'catalogResultCount',
  'catalogFilter',
  'catalogFeatureSource',
  'heroResume',
  'heroDiscover',
  'spotlightSource',
  'heroDiscover',
  'spotlightSource',
  'heroResumeLabel',
  'heroResume',
  'loadingPhase',
  'loadingStepLibrary',
  'loadingStepLaunchers',
  'loadingStepArtwork',
  'loadingStepControls',
  'setupToggle',
  'setupCoach',
  'setupSteps',
  'surpriseMe',
  'communitySettings',
  'openDiscord',
  'discordCommunityHub',
  'openDiscordPlayers',
  'copyDiscordInvite',
  'openDiscordAnnouncements',
  'openDiscordSupport',
  'openDiscordShowcase',
  'netplayShareInvite',
  'netplayShareResponse',
  'gameSort',
  'resultCount',
  'emptyTitle',
  'arcadeDeck',
  'arcadeAuditButton',
  'openArcadeGuide',
  'openArcadeFeedback',
  'spotlightArtwork',
  'spotlightDetails',
  'arcadeControllerState',
  'settingMame'
]) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
  if (matches.length !== 1) fail(`expected one #${id}, found ${matches.length}`);
}

for (const channel of ['settings', 'save-settings', 'sponsors', 'donations', 'open-external', 'arcade-audit', 'refresh-game-details', 'choose-game-artwork', 'inspect-settings', 'stream-status', 'stream-sources', 'stream-start', 'stream-stop', 'stream-host-pull', 'stream-host-send', 'remote-play-code-encode', 'remote-play-code-decode', 'remote-play-status', 'remote-play-start', 'remote-play-stop', 'remote-play-input', 'netplay-status', 'netplay-game-info', 'netplay-relays', 'netplay-host', 'netplay-join', 'netplay-stop']) {
  if (!main.includes(`'${channel}'`)) fail(`main process is missing ${channel}`);
  const preloadName = channel.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (!preload.includes(preloadName)) fail(`preload bridge is missing ${preloadName}`);
}

if (!html.includes('class="app-shell-header"') || !html.includes('class="header-info-bar"')) fail('two-tier operational header is missing');
if (!html.includes('id="headerMenu"') || !html.includes('id="headerMenuToggle"')) fail('secondary header controls must live in an overflow menu');
if (!renderer.includes('function toggleHeaderMenu') || !renderer.includes('function closeHeaderMenu')) fail('header overflow accessibility behavior is missing');
if (!renderer.includes('https://discord.gg/eS7d4VqTT') || !html.includes('id="openDiscord"')) fail('official Discord community link is missing');
if (!renderer.includes('DISCORD_COMMUNITY') || !renderer.includes('1533539469372821555')) fail('Discord channel routing is missing');
if (!netplayRenderer.includes('DISCORD_REMOTE_PLAY_URL') || !netplayRenderer.includes('message.length <= 2000')) fail('Discord-safe Remote Play sharing is missing');
if (!html.includes('class="discord-community-hub"') || !styles.includes('.discord-channel-card')) fail('Discord community hub UI is missing');

if (!renderer.includes('https://youtu.be/vY-fFVu2ClM')) fail('published GameDeck tutorial link is missing');
if (renderer.includes("'Cinematic'")) fail('retired Cinematic header language must not return');
if (!main.includes('configuredEmulator') || !main.includes("launchMode: 'mame'") || !main.includes("'-nowindow'")) fail('standalone MAME routing is missing');
if (!main.includes("'.bs'")) fail('Satellaview .bs ROM support is missing');
if (!main.includes('catalogFileIdentities') || !main.includes('installedCatalogFile')) fail('catalog path identity matching is missing');
if (!main.includes('inspectArcadeArchive') || !renderer.includes('renderArcadeDeck')) fail('arcade health diagnostics are missing');
if (!preload.includes('onArcadeAudit')) fail('arcade audit progress bridge is missing');
if (!main.includes('createRuntimeManager') || !main.includes('queueManagedRuntimeLaunch')) fail('managed runtime launch recovery is missing');
if (!preload.includes('ensureRuntime') || !preload.includes('onRuntime')) fail('managed runtime preload bridge is missing');
if (!renderer.includes('Preparing game engines') || !renderer.includes('window.deck.ensureRuntime')) fail('first-run runtime setup UI is missing');
if (!runtimeManager.includes('AbortSignal.timeout') || !runtimeManager.includes('content-range') || !runtimeManager.includes('SHA-256')) fail('managed runtime download safety or resume support is missing');
if (!managedRuntimeManifest.platforms?.['win32-x64'] || !managedRuntimeManifest.platforms?.['linux-x64'] || !managedRuntimeManifest.platforms?.['darwin-arm64']) fail('runtime manifest is missing a supported desktop platform');
if (!pkg.build?.files?.includes('runtime-manager.js') || !pkg.build?.asarUnpack?.some(value => value.includes('7zip-bin'))) fail('managed runtime packaging configuration is missing');


if (/C:\\\\Users\\\\[^'"\s]+/i.test(main)) fail('main.js contains a personal Windows user path');
if (!renderer.includes("'community'")) fail('renderer view cycle is missing Community');
if (!renderer.includes("setAttribute('aria-current', 'page')")) fail('main navigation must expose the active view accessibly');
if (!renderer.includes('GAME_SORTS')) fail('renderer is missing persistent library sorting');
if (!renderer.includes('sidebar-collapsed')) fail('renderer is missing the collapsible systems rail');
if (!html.includes('toast-message') || !renderer.includes('updateScrollChrome')) fail('polished feedback and sticky toolbar behavior are missing');
if (!renderer.includes('missing-art') || !renderer.includes('art-status')) fail('library artwork quality states are missing');
if (!renderer.includes('renderSetupCoach') || !renderer.includes('setupReadiness')) fail('renderer is missing the zero-hassle ready check');
if (!renderer.includes('loadingStepLibrary') || !renderer.includes('loadingPhase')) fail('renderer is missing staged startup progress');
if (html.includes('loading-orbit') || html.includes('loading-console') || styles.includes('loadingSpin') || styles.includes('bootSweep')) fail('legacy animated loading spinner styles must stay removed');
if (!html.includes('boot-panel') || !styles.includes('.loading-steps')) fail('premium status-driven boot panel is missing');
if (!renderer.includes('surpriseMe')) fail('renderer is missing the random playable game action');
if (!renderer.includes('renderHeroActions')) fail('renderer is missing context-aware hero actions');
if (!renderer.includes('setLaunchingState') || !styles.includes('.game.launching')) fail('launch feedback states are missing');
if (!main.includes('pendingLaunches') || !main.includes('queueLaunchDependency') || !main.includes('completePendingLaunch')) fail('one-click dependency repair and automatic relaunch are missing');
if (!main.includes('queueManagedGameRepair') || !main.includes('options.repair')) fail('managed repair-on-play is missing');
if (!main.includes('verifyMameLaunchRoute') || !main.includes('verified set')) fail('arcade route verification is missing');
if (!preload.includes('onLaunch: callback') || !renderer.includes('window.deck.onLaunch')) fail('launch progress handoff is missing');
if (!renderer.includes('gameLaunchBlocked') || !renderer.includes('AUTO REPAIR')) fail('repairable arcade sets must remain one-click playable');
if (!renderer.includes('spotlightSource') || !styles.includes('.feature-source')) fail('metadata source feedback is missing');
if (!renderer.includes('artworkFilter') || !html.includes('id="artworkFilter"')) fail('library artwork quality filter is missing');
if (!renderer.includes('chooseFocusedArtwork') || !renderer.includes('refreshFocusedDetails')) fail('renderer is missing manual artwork or detail repair controls');
if (!main.includes('artworkCoverage')) fail('diagnostics are missing artwork coverage');
if (!renderer.includes('dataset.captureReady') || !main.includes('rendererReady')) fail('UI capture readiness handshake is missing');
if (!preload.includes('includeLibrary = false')) fail('startup diagnostics must avoid a duplicate library scan');
if (!main.includes('environmentOverrides') || !main.includes('GAMEDECK_LIBRARY')) fail('explicit environment overrides must take precedence over saved settings');
if (!pkg.build?.win || !pkg.build?.mac || !pkg.build?.linux) fail('package metadata must configure Windows, macOS, and Linux');
if (pkg.build?.nsis?.oneClick !== true || pkg.build?.nsis?.runAfterFinish !== true) fail('Windows must ship as a one-click installer that launches GameDeck');
if (!pkg.build?.extraResources?.some(item => item?.to === 'runtime-cache')) fail('release packages must include the verified runtime cache');
if (!String(pkg.scripts?.['dist:win'] || '').includes('runtime:cache') || !String(pkg.scripts?.['dist:mac'] || '').includes('runtime:cache') || !String(pkg.scripts?.['dist:linux'] || '').includes('runtime:cache')) fail('all platform release builds must prepare their complete runtime');
if (!runtimeCacheBuilder.includes('cache-index.json') || !runtimeCacheBuilder.includes('darwin-universal') || !runtimeCacheBuilder.includes('.part')) fail('cross-platform resumable runtime cache builder is missing');
if (!runtimeManager.includes('bundledCacheRoot') || !runtimeManager.includes("phase: 'retrying'") || !runtimeManager.includes('.part')) fail('managed runtime must prefer bundled assets and resume interrupted transfers');
if (!main.includes('BUNDLED_RUNTIME_AVAILABLE') || !main.includes('MANAGED_RUNTIME_PATHS.retroArch')) fail('clean installs must target the managed runtime before extraction');
if (!main.includes('DOWNLOADS_FILE') || !main.includes('restorePersistedDownloads') || !main.includes('retryDownload') || !main.includes('pauseActiveDownloads')) fail('game transfer resume persistence is missing');
if (!main.includes('shell.trashItem') || !main.includes("'delete-game'")) fail('safe operating-system Trash removal is missing');
if (!main.includes('bundledSevenZip') || !String(pkg.build?.asarUnpack || []).includes('node_modules/7zip-bin/**/*')) fail('bundled archive extraction dependency is missing');
if (!preload.includes('retryDownload') || !preload.includes('pauseDownload') || !preload.includes('deleteGame')) fail('resume and delete actions are missing from the secure preload bridge');
if (!renderer.includes('handleTransferControl') || !renderer.includes('deleteFocusedGame') || !renderer.includes('Finish one-click setup')) fail('one-click setup, resume controls, or game removal UI is missing');
if (!html.includes('id="spotlightDelete"') || !html.includes('Included and verified')) fail('visible safe removal or included-runtime first-run copy is missing');
if (html.includes('id="densityToggle"') || html.includes('>Cinematic<')) fail('obsolete cinematic header control must stay removed');
if (!html.includes('id="headerOps"') || !html.includes('id="streamStudio"')) fail('operational header or GameDeck Live studio is missing');
if (!main.includes('setDisplayMediaRequestHandler') || !main.includes('desktopCapturer.getSources') || !main.includes('createStreamServer')) fail('native Electron capture broker is missing');
if (!streamServer.includes("require('http')") || !streamServer.includes('crypto.randomInt') || !streamServer.includes('/api/pair') || !streamServer.includes('/api/signal')) fail('dependency-free LAN signaling server is incomplete');
if (!streamingRenderer.includes('RTCPeerConnection') || !streamingRenderer.includes('getDisplayMedia') || !streamingRenderer.includes('streamHostPull')) fail('WebRTC host renderer is incomplete');
if (!mobileReceiver.includes('RTCPeerConnection') || !mobileReceiver.includes('/api/pair') || !mobileReceiver.includes('srcObject')) fail('mobile WebRTC receiver is incomplete');
if (!androidActivity.includes('WebView') || !androidActivity.includes('setMediaPlaybackRequiresUserGesture(false)')) fail('native Android receiver shell is missing');
if (!iosContent.includes('WKWebView') || !iosContent.includes('allowsInlineMediaPlayback')) fail('native iOS receiver shell is missing');
if (!iosInfo.includes('NSLocalNetworkUsageDescription') || !iosInfo.includes('NSAllowsLocalNetworking')) fail('iOS local-network permissions are missing');
if (!pkg.build?.files?.includes('stream-server.js') || !pkg.build?.files?.includes('mobile/web/**/*')) fail('desktop packages must include GameDeck Live server and receiver');
if (!pkg.build?.files?.includes('netplay-manager.js')) fail('release packages must include GameDeck multiplayer services');
if (!String(pkg.scripts?.check || '').includes('netplay-manager.js') || !String(pkg.scripts?.check || '').includes('src/netplay.js')) fail('multiplayer syntax checks are missing');
if (!main.includes('startRemotePlay') || !main.includes('remoteInputPacket') || !main.includes('network_remote_enable_user_p')) fail('native RetroPad Remote Play host routing is missing');
if (!preload.includes('remotePlayCodeEncode') || !preload.includes('remotePlayCodeDecode') || !preload.includes('remotePlayStart') || !preload.includes('remotePlayInput') || !preload.includes('onRemotePlay')) fail('secure Remote Play preload bridge is missing');
if (!streamingRenderer.includes('GameDeckLive') || !streamingRenderer.includes('startForRemote')) fail('Remote Play must reuse the native GameDeck Live capture pipeline');
if (!netplayRenderer.includes('GDREMOTE2') || !netplayRenderer.includes('GDREMOTEANSWER2') || !netplayRenderer.includes('RTCPeerConnection')) fail('compressed encrypted peer-to-peer Remote Play invitation flow is missing');
if (!main.includes('brotliCompressSync') || !main.includes('brotliDecompressSync')) fail('Discord-sized Brotli Remote Play codes are missing');
if (!netplayRenderer.includes('remotePlayInput') || !netplayRenderer.includes('navigator.getGamepads')) fail('remote gamepad forwarding is missing');
if (!html.includes('Only the host needs the game') || !html.includes('NO ROM TRANSFER') || !html.includes('NATIVE RETROPAD INPUT')) fail('Remote Play ownership and privacy guidance are missing');
if (Object.keys(pkg.dependencies || {}).some(name => /(^|[-_])(obs|webrtc|websocket|ws)([-_]|$)/i.test(name))) fail('GameDeck Live must not add OBS, WebRTC, or WebSocket runtime dependencies');
if (!Array.isArray(donationConfig.methods)) fail('donation methods must be an array');
if (donationConfig.enabled && donationConfig.methods.length === 0) fail('enabled donations require at least one public method');

const forbiddenWalletFields = new Set(['privatekey', 'mnemonic', 'seed', 'recoveryphrase', 'keystore', 'password']);
const inspectDonationFields = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenWalletFields.has(key.toLowerCase())) fail(`donation config contains forbidden wallet field: ${key}`);
    inspectDonationFields(nested);
  }
};
inspectDonationFields(donationConfig);

for (const method of donationConfig.methods) {
  if (!method?.label || !method?.address) fail('each donation method requires a label and public address');
  if (method.id === 'evm' && !/^0x[0-9a-fA-F]{40}$/.test(method.address)) fail('EVM donation address is malformed');
}

for (const asset of [
  'assets/branding/gamedeck-mark-source.png',
  'assets/branding/gamedeck-hero.png',
  'docs/ARCADE.md',
  'docs/COMMUNITY_LAUNCH.md',
  'docs/REMOTE_PLAY.md',
  'docs/E2E_REPORT_1.2.0.md',
  'docs/e2e-results/GameDeck-1.2.0-2026-08-02.json',
  'docs/images/gamedeck-ready-check.png',
  'docs/images/gamedeck-startup.png',
  'build/icon.ico',
  'build/icon.icns',
  'build/icons/512x512.png'
]) {
  try {
    await access(path.join(root, asset));
  } catch {
    fail(`missing required asset: ${asset}`);
  }
}


const libraryRenderStart = renderer.indexOf('function renderGames()');
const libraryClickStart = renderer.indexOf('card.onclick = event => {', libraryRenderStart);
const libraryDoubleStart = renderer.indexOf('card.ondblclick = event => {', libraryClickStart);
const libraryClickBody = renderer.slice(libraryClickStart, libraryDoubleStart);
if (libraryClickStart < 0 || libraryDoubleStart < 0 || libraryClickBody.includes('launch(game.file)')) fail('single library card click must only preview');
const catalogRenderStart = renderer.indexOf('function renderCatalogGames()');
const catalogClickStart = renderer.indexOf('card.onclick = event => {', catalogRenderStart);
const catalogDoubleStart = renderer.indexOf('card.ondblclick = event => {', catalogClickStart);
const catalogClickBody = renderer.slice(catalogClickStart, catalogDoubleStart);
if (catalogClickStart < 0 || catalogDoubleStart < 0 || catalogClickBody.includes('catalogAction(game)')) fail('single Discover card click must only preview');
if (!renderer.includes('role="listitem"') || !html.includes('role="list" aria-label="Game library"')) fail('game cards must use non-nested list semantics');


if (!main.includes("artworkTitle: isArcadeSystem(system) ? title : shortName") || !main.includes('metadataTitle: title')) fail('library games must separate exact artwork identity from clean metadata identity');
if (!main.includes('thumbnailCdnRepository') || !main.includes('thumbnails.libretro.com')) fail('official Libretro CDN artwork source is missing');
if (!main.includes("const detailTitle = lookupTitleName(title);")) fail('artwork fallback lookup title must be defined');
if (!main.includes('revisionNumeric') || !main.includes('inferredRegions')) fail('artwork candidate normalization is missing');
if (!renderer.includes('function gameMetadataTitle') || !renderer.includes('function scheduleArtworkEnrichment')) fail('background artwork enrichment is missing');


if (!main.includes('thumbnailIndexRequests') || !main.includes('fetchIndexedLibretroArtwork') || !main.includes('thumbnailIdentity')) fail('indexed fuzzy artwork matching is missing');
if (!main.includes("systemId === 'gamegear'") || !main.includes("systemId === 'gamecube'")) fail('safe cross-repository artwork fallback is missing');


if (!main.includes("extension !== '.m3u'") || !main.includes("value.startsWith('#')")) fail('Saturn M3U validation is missing');
if (!main.includes('AUTOMATION_MODE') || !main.includes("mainWindow.hide()")) fail('automation-mode hide-on-close behavior is missing');


if (!renderer.includes('GAMEDECK ORIGINAL') || !renderer.includes('function markGeneratedArtwork')) fail('premium generated artwork fallback is missing');
if (renderer.includes('ART NEEDED')) fail('unmatched titles must use a finished GameDeck-original poster state');
if (!renderer.includes('generatedArtworkCount')) fail('matched and generated artwork readiness must be reported separately');
const catalogArtworkUpdate = renderer.slice(renderer.indexOf('function updateCatalogArtwork'), renderer.indexOf('function requestCatalogArtwork'));
if (!catalogArtworkUpdate.includes('$(`[data-catalog-art=\"${game.id}\"]`).forEach')) fail('catalog artwork updates must use the multi-selector helper');
if (!renderer.includes('$(`[data-catalog-art=\"${game.id}\"]`).forEach')) fail('catalog artwork updates must use the multi-selector helper');
if (!main.includes('thumbnailTokens') || !main.includes('tokens.every')) fail('ordered token artwork matching is missing');

if (!process.exitCode) console.log('GameDeck smoke test passed.');
