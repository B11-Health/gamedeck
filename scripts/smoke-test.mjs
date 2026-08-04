import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);
const read = file => readFile(path.join(root, file), 'utf8');
const fail = message => {
  console.error(`Smoke test failed: ${message}`);
  process.exitCode = 1;
};

const [main, preload, renderer, html, styles, pkgText, donations, runtimeManager, runtimeManifest, runtimeCacheBuilder, streamServer, streamingRenderer, netplayManager, netplayRenderer, mobileReceiver, mobileManifestText, mobileSw, androidActivity, iosContent, iosInfo, siteHtml, siteStyles, siteApp] = await Promise.all([
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
  read('mobile/web/manifest.webmanifest'),
  read('mobile/web/sw.js'),
  read('mobile/android/app/src/main/java/io/gamedeck/mobile/MainActivity.java'),
  read('mobile/ios/GameDeckMobile/ContentView.swift'),
  read('mobile/ios/GameDeckMobile/Info.plist'),
  read('site/index.html'),
  read('site/styles.css'),
  read('site/app.js')
]);
const pkg = JSON.parse(pkgText);
const donationConfig = JSON.parse(donations);
const managedRuntimeManifest = JSON.parse(runtimeManifest);
const mobileManifest = JSON.parse(mobileManifestText);
const [e2eReportText, e2eResultText] = await Promise.all([
  read('docs/E2E_REPORT_1.2.0.md'),
  read('docs/e2e-results/GameDeck-1.2.0-2026-08-02.json')
]);
const e2eResult = JSON.parse(e2eResultText);

const systemThemeAssets = [
  'assets/system-themes/nintendo-classic.webp',
  'assets/system-themes/nintendo-polygon.webp',
  'assets/system-themes/nintendo-handheld.webp',
  'assets/system-themes/sega-16bit.webp',
  'assets/system-themes/sega-3d.webp',
  'assets/system-themes/playstation.webp',
  'assets/system-themes/arcade.webp',
  'assets/system-themes/retro.webp'
];
for (const asset of systemThemeAssets) {
  try { await access(path.join(root, asset)); }
  catch { fail(`console theme asset is missing: ${asset}`); }
}
if (!renderer.includes('SYSTEM_THEME_BACKGROUNDS') || !renderer.includes('applySystemTheme(game.system)')) fail('console-aware spotlight theme routing is missing');
if (!styles.includes('--system-accent') || !styles.includes('.spotlight .feature-backdrop img.is-ready')) fail('console theme styling is missing');

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
  'multiplayerReadiness',
  'netplayGameArt',
  'multiplayerMatchId',
  'multiplayerCouchPanel',
  'multiplayerControllers',
  'multiplayerCouchLaunch',
  'multiplayerRemotePanel',
  'multiplayerSyncPanel',
  'syncHost',
  'syncJoin',
  'syncRelay',
  'syncMaxPlayers',
  'syncInviteValue',
  'syncJoinInvite',
  'syncNickname',
  'syncProgress',
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
  'multiplayerPasteInvite',
  'multiplayerCopyMatch',
  'multiplayerPlayerRail',
  'multiplayerActivePlayerRail',
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
  'openDiscussions',
  'communityResourceHub',
  'openPlayerDiscussion',
  'copyPlayerDiscussion',
  'openReleases',
  'openSupport',
  'openShowcase',
  'shareGameDeck',
  'copyRedditLaunch',
  'copyShortCaption',
  'copyYoutubeComment',
  'copyLinkedInLaunch',
  'copyFacebookLaunch',
  'copyPlayTonight',
  'copyCreatorPitch',
  'copyCommunityEvent',
  'openShortsPlaylist',
  'openGithubStar',
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
  'playSurface',
  'playVideo',
  'playLoading',
  'playDocked',
  'playFullscreen',
  'playPopout',
  'playClose',
  'playCaptureRetry',
  'playCapturePopout',
  'launchCurtain',
  'arcadeControllerState',
  'settingMame'
]) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) || [];
  if (matches.length !== 1) fail(`expected one #${id}, found ${matches.length}`);
}

for (const channel of ['settings', 'save-settings', 'sponsors', 'donations', 'read-clipboard', 'open-external', 'arcade-audit', 'refresh-game-details', 'choose-game-artwork', 'inspect-settings', 'stream-status', 'stream-sources', 'stream-start', 'stream-stop', 'stream-host-pull', 'stream-host-send', 'remote-play-code-encode', 'remote-play-code-decode', 'remote-play-status', 'remote-play-start', 'remote-play-stop', 'remote-play-input', 'netplay-status', 'netplay-game-info', 'netplay-match-info', 'netplay-relays', 'netplay-host', 'netplay-join', 'netplay-stop']) {
  if (!main.includes(`'${channel}'`)) fail(`main process is missing ${channel}`);
  const preloadName = channel.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (!preload.includes(preloadName)) fail(`preload bridge is missing ${preloadName}`);
}

if (!html.includes('class="app-shell-header"') || !html.includes('class="header-info-bar"')) fail('two-tier operational header is missing');
if (!preload.includes('platform: process.platform') || !renderer.includes('document.documentElement.dataset.platform')) fail('renderer platform contract for native caption-safe layout is missing');
if (!styles.includes('Keep GameDeck play controls clear of Windows caption buttons') || !styles.includes('padding-right: 174px')) fail('Windows caption-button safe area is missing from GameDeck Play');
if (!main.includes('GetClientRect') || !main.includes('GetMenu') || !main.includes('SetMenu') || !main.includes('DrawMenuBar')) fail('native game client geometry and menu suppression are incomplete');
if (!styles.includes('.play-surface.play-pointer-hidden') || !renderer.includes('function hidePlayPointer')) fail('idle play pointer concealment is missing');
if (!html.includes('id="headerMenu"') || !html.includes('id="headerMenuToggle"')) fail('secondary header controls must live in an overflow menu');
if (!renderer.includes('function toggleHeaderMenu') || !renderer.includes('function closeHeaderMenu')) fail('header overflow accessibility behavior is missing');
if (!renderer.includes('GAMEDECK_LINKS.discussions') || !renderer.includes('GAMEDECK_LINKS.players') || !html.includes('id="openDiscussions"')) fail('GitHub community routing is missing');
if (!renderer.includes('COMMUNITY_LINKS') || !renderer.includes('discussions/8')) fail('GitHub player-discussion routing is missing');
if (!netplayRenderer.includes('PLAYER_DISCUSSION_URL') || !netplayRenderer.includes('send it privately')) fail('private Remote Play sharing guidance is missing');
if (!html.includes('class="community-resource-hub"') || !styles.includes('.community-resource-card')) fail('GitHub community resource hub is missing');
if (!html.includes('class="community-share"') || !renderer.includes('GAMEDECK_SHARE_COPY') || !styles.includes('.community-share-actions')) fail('community share loop is missing');
const retiredChatBrand = ['dis', 'cord'].join('');
for (const [label, content] of [['desktop renderer', renderer], ['desktop HTML', html], ['multiplayer renderer', netplayRenderer], ['desktop styles', styles], ['public site', siteHtml]]) {
  if (new RegExp(retiredChatBrand, 'i').test(content)) fail(`${label} still contains a retired chat-platform dependency`);
}
if (!renderer.includes('Feedback-first Reddit launch copied') || !renderer.includes('#GameDeck #OpenSource')) fail('platform-ready share copy is missing');
if (!renderer.includes('LinkedIn launch post copied') || !renderer.includes('Facebook group post copied') || !renderer.includes('Looking-for-players post copied') || !renderer.includes('function playTonightCopy')) fail('cross-platform player acquisition copy is missing');
if (!pkg.build?.mac?.x64ArchFiles?.includes('node_modules/7zip-bin')) fail('macOS universal 7zip merge rule is missing');
if (!siteHtml.includes('GameDeck Live') || !siteHtml.includes('Couch Co-op') || !siteHtml.includes('Remote Play Together') || !siteHtml.includes('Synchronized Netplay') || !siteHtml.includes('docs/MULTIPLAYER.md') || !siteHtml.includes('data-platform="windows"')) fail('public growth site is missing GameDeck 1.2 conversion paths');
if (!siteHtml.includes('Find players tonight') || !siteHtml.includes('multiplayer_session.yml') || !siteStyles.includes('.matchmaking') || !siteStyles.includes('.session-report')) fail('above-the-fold player activation and session reporting are missing');
if (!siteHtml.includes('id="liveEvent"') || !siteHtml.includes('github.com/B11-Health/gamedeck/discussions/8') || !siteHtml.includes('data-end="2026-08-03T00:00:00-04:00"') || !siteApp.includes('function hydrateLiveEvent') || !siteApp.includes('now>=end') || !siteStyles.includes('.live-event[hidden]')) fail('self-expiring playtest event strip is missing');
if (!siteApp.includes('api.github.com/repos/') || !siteApp.includes('releases/latest')) fail('public growth site must resolve current release assets dynamically');
if (!main.includes('sandbox: true') || !main.includes('contextIsolation: true') || !main.includes('nodeIntegration: false') || !main.includes('webSecurity: true')) fail('Electron renderer security hardening is missing');
if (!styles.includes('Accessibility readability floor') || !styles.includes('font-size: 9px') || !styles.includes('readiness-chip b { font-size: 10px; }') || !styles.includes('.art-status { font-size: 9px; }')) fail('app readability floor is missing');
if (/sendBeacon|\/events/.test(siteApp)) fail('public growth site must not add behavioral click telemetry');
if (!siteStyles.includes('.multiplayer') || !siteStyles.includes('.mode-card') || !siteStyles.includes('@media(max-width:760px)')) fail('public growth site responsive product sections are missing');
if (!siteHtml.includes('tiktok.com/@playgamedeck') || !siteHtml.includes('\"sameAs\"')) fail('public social discovery links are missing');
if (!siteHtml.includes('ndETcPuCOyE') || !siteHtml.includes('dOEuy8g8Bmw') || !siteStyles.includes('.shorts-section') || !siteStyles.includes('.short-card')) fail('public Shorts discovery gallery is missing');
if (!siteHtml.includes('PLCbffYifS8R8') || !siteHtml.includes('PLG-ejeCsa-AI')) fail('public YouTube playlist funnel is missing');
if (e2eResult.releaseCommit !== '250bbd7bc3b929fe49205ee6c0695654426f49b2' || e2eResult.results?.windowsArtifacts?.setup?.sha256 !== '6677c63e871915d1dc001866d36255e126963bb3cc057be0c9c847af28ad0654' || !e2eReportText.includes('GameDeck-1.2.0-mac-universal.dmg')) fail('official v1.2.0 evidence is stale');
if (e2eResult.results?.youtubeChannel?.branding?.watermark !== 'entire_video' || !e2eResult.results?.youtubeChannel?.publicShorts?.includes('https://youtube.com/shorts/dOEuy8g8Bmw')) fail('verified YouTube channel evidence is stale');

if (!renderer.includes('https://youtu.be/vY-fFVu2ClM')) fail('published GameDeck tutorial link is missing');
if (!renderer.includes('PLCbffYifS8R8') || !renderer.includes('PLG-ejeCsa-AI') || !renderer.includes('openShortsPlaylist')) fail('in-app YouTube playlist funnel is missing');
if (renderer.includes("'Cinematic'")) fail('retired Cinematic header language must not return');
if (!main.includes('configuredEmulator') || !main.includes("launchMode: 'mame'") || !main.includes("'-nowindow'")) fail('standalone MAME routing is missing');
if (!main.includes("'.bs'")) fail('Satellaview .bs ROM support is missing');
if (!main.includes('catalogFileIdentities') || !main.includes('installedCatalogFile')) fail('catalog path identity matching is missing');
if (!main.includes('inspectArcadeArchive') || !renderer.includes('renderArcadeDeck')) fail('arcade health diagnostics are missing');
if (!preload.includes('onArcadeAudit')) fail('arcade audit progress bridge is missing');
if (!main.includes('createRuntimeManager') || !main.includes('queueManagedRuntimeLaunch')) fail('managed runtime launch recovery is missing');
if (!main.includes('MANAGED_RUNTIME_PREFERRED') || !main.includes('managedRuntimeInstalled')) fail('an already installed managed runtime must take precedence over an unverified external core set');
if (!main.includes("ARCADE_SUPPORT_ARCHIVES = new Set(['neogeo.zip'])") || !main.includes('isArcadeSupportArchive(file, system)')) fail('arcade BIOS support archives must stay out of the playable library');
if (!styles.includes('body.density-compact .spotlight-primary-actions button') || !styles.includes('min-width: 0; flex: 1 1 0;')) fail('spotlight action rows must shrink without clipping Favorite or Remove');
if (!preload.includes('ensureRuntime') || !preload.includes('onRuntime')) fail('managed runtime preload bridge is missing');
if (!renderer.includes('Preparing game engines') || !renderer.includes('window.deck.ensureRuntime')) fail('first-run runtime setup UI is missing');
if (!runtimeManager.includes('AbortSignal.timeout') || !runtimeManager.includes('content-range') || !runtimeManager.includes('SHA-256')) fail('managed runtime download safety or resume support is missing');
if (!managedRuntimeManifest.platforms?.['win32-x64'] || !managedRuntimeManifest.platforms?.['linux-x64'] || !managedRuntimeManifest.platforms?.['darwin-arm64']) fail('runtime manifest is missing a supported desktop platform');
if (!pkg.build?.files?.includes('runtime-manager.js') || !pkg.build?.asarUnpack?.some(value => value.includes('7zip-bin'))) fail('managed runtime packaging configuration is missing');
for (const runtimeFile of ['native-window-presenter.js', 'openbor-launch.js']) {
  if (!pkg.build?.files?.includes(runtimeFile)) fail(`desktop package is missing native launch runtime: ${runtimeFile}`);
}
if (!pkg.build?.files?.includes('!assets/branding/brand-kit/**/*')) fail('desktop package must exclude the web-only social brand kit');


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
if (!main.includes('libraryFolderSystems') || !main.includes('archiveContentExtensions') || !main.includes('discSystemForFile')) fail('shared-folder system classification is missing');
if (!main.includes("id: 'sega32x'") || !main.includes("coreFile('picodrive_libretro')")) fail('Sega 32X library support is missing');
if (!main.includes("id: 'fds'") || !main.includes("id: 'satellaview'") || !main.includes("id: 'sufami'") || !main.includes("bios: ['disksys.rom']") || !main.includes("bios: ['BS-X.bin']") || !main.includes("bios: ['STBIOS.bin']")) fail('firmware-backed add-on systems are not classified independently');
if (!main.includes('playableArchiveIntegrity') || !main.includes('Unexpected end of archive') || !main.includes("biosMode: 'all'")) fail('game archive integrity or complete regional firmware checks are missing');
if (!pkg.build?.files?.includes('library-system-classifier.js')) fail('library classifier must ship in desktop packages');
for (const [platformKey, platformSpec] of Object.entries(managedRuntimeManifest.platforms || {})) {
  const cores = (platformSpec.components || []).find(component => component.id === 'cores');
  if (!cores?.expected?.some(value => value.includes('picodrive_libretro'))) fail(`${platformKey} runtime is missing the PicoDrive core`);
}
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
if (!mobileReceiver.includes('function pairingError') || !mobileReceiver.includes('GameDeck host not found')) fail('mobile pairing errors must be player-friendly');
if (!mobileManifest.icons?.some(icon => icon.sizes === '192x192' && icon.purpose === 'any') || !mobileManifest.icons?.some(icon => icon.sizes === '512x512' && icon.purpose === 'any') || !mobileManifest.icons?.some(icon => icon.sizes === '192x192' && icon.purpose === 'maskable') || !mobileManifest.icons?.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable')) fail('mobile PWA any and maskable icons are missing');
if (!mobileSw.includes('gamedeck-live-v') || !mobileSw.includes('/icons/icon-192.png') || !mobileSw.includes('/icons/icon-512.png')) fail('mobile PWA cache is missing install icons');
if (!androidActivity.includes('WebView') || !androidActivity.includes('setMediaPlaybackRequiresUserGesture(false)')) fail('native Android receiver shell is missing');
if (!iosContent.includes('WKWebView') || !iosContent.includes('allowsInlineMediaPlayback')) fail('native iOS receiver shell is missing');
if (!iosInfo.includes('NSLocalNetworkUsageDescription') || !iosInfo.includes('NSAllowsLocalNetworking')) fail('iOS local-network permissions are missing');
if (!pkg.build?.files?.includes('stream-server.js') || !pkg.build?.files?.includes('mobile/web/**/*')) fail('desktop packages must include GameDeck Live server and receiver');
if (!pkg.build?.files?.includes('netplay-manager.js')) fail('release packages must include GameDeck multiplayer services');
if (!String(pkg.scripts?.check || '').includes('netplay-manager.js') || !String(pkg.scripts?.check || '').includes('src/netplay.js')) fail('multiplayer syntax checks are missing');
if (!String(pkg.scripts?.check || '').includes('scripts/repo-audit.mjs') || pkg.scripts?.['audit:repo'] !== 'node scripts/repo-audit.mjs') fail('repository integrity audit is not wired into tests');
if (!main.includes('startRemotePlay') || !main.includes('remoteInputPacket') || !main.includes('network_remote_enable_user_p')) fail('native RetroPad Remote Play host routing is missing');
if (!preload.includes('remotePlayCodeEncode') || !preload.includes('remotePlayCodeDecode') || !preload.includes('remotePlayStart') || !preload.includes('remotePlayInput') || !preload.includes('onRemotePlay')) fail('secure Remote Play preload bridge is missing');
if (!streamingRenderer.includes('GameDeckLive') || !streamingRenderer.includes('startForRemote')) fail('Remote Play must reuse the native GameDeck Live capture pipeline');
if (!netplayRenderer.includes('GDREMOTE2') || !netplayRenderer.includes('GDREMOTEANSWER2') || !netplayRenderer.includes('RTCPeerConnection')) fail('compressed encrypted peer-to-peer Remote Play invitation flow is missing');
if (!html.includes('data-play-style="couch"') || !html.includes('data-play-style="remote"') || !html.includes('data-play-style="sync"')) fail('three-mode multiplayer command center is missing');
if (!netplayRenderer.includes('startSyncHost') || !netplayRenderer.includes('joinSyncRoom') || !netplayRenderer.includes('launchCouchCoop')) fail('multiplayer mode launch flows are incomplete');
if (!main.includes('netplayMatchInfo') || !main.includes('coreMatchId')) fail('local ROM/core match verification is missing');
if (!styles.includes('.multiplayer-style-grid') || !styles.includes('.multiplayer-readiness')) fail('multiplayer command center visual system is missing');
if (!netplayRenderer.includes('displaySlots: 4') || !netplayRenderer.includes("state = 'LOCKED'") || !netplayRenderer.includes("class=\"multiplayer-player-slot ${!available ? 'locked'")) fail('four-slot lobby and native game-limit states are missing');
if (!html.includes('id="multiplayerLobbyCard"') || !netplayRenderer.includes('Math.min(4, Number(maxPlayers || 2))')) fail('four-player lobby or selection cap is missing');
if (!styles.includes('.multiplayer-player-slot.locked') || !styles.includes('@media (max-height: 950px)')) fail('four-slot locked state or laptop-height layout is missing');
if (!netplayRenderer.includes('commandWindow.scrollTop = 0') || !styles.includes('.session-active .multiplayer-selected-card') || !styles.includes('.multiplayer-active-player-rail')) fail('live multiplayer must reset scroll and replace the setup card with the active player rail');
if (!html.includes('class="multiplayer-advanced"') || html.includes('id="multiplayerCoachAction"') || !styles.includes('.multiplayer-match-pill:hover button')) fail('simplified multiplayer action hierarchy is missing');
if (!netplayRenderer.includes('renderAcceptAnswerAction') || !html.includes('class="netplay-primary hidden" id="netplayAcceptAnswer"')) fail('Remote Play response action must stay hidden until usable');
if (!netplayRenderer.includes('recommendationForSetup') || !netplayRenderer.includes('renderPlayerRail') || !netplayRenderer.includes('routeClipboardInvite')) fail('guided multiplayer recommendation or invite routing is missing');
if (!styles.includes('.multiplayer-coach') || !styles.includes('.multiplayer-player-rail') || !styles.includes('.multiplayer-style-badge')) fail('guided multiplayer lobby styling is missing');
if (!html.includes('class="multiplayer-setup-flow"') || !html.includes('class="multiplayer-lobby-card"') || !styles.includes('.multiplayer-player-slots') || !netplayRenderer.includes('PLAY_STYLE_DETAILS')) fail('calm game, mode, and lobby flow is missing');
if (!main.includes('brotliCompressSync') || !main.includes('brotliDecompressSync')) fail('compact Brotli Remote Play codes are missing');
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
  'docs/MULTIPLAYER.md',
  'docs/E2E_REPORT_1.2.0.md',
  'docs/E2E_MULTIPLAYER_4_PLAYER_2026-08-02.md',
  'docs/e2e-results/GameDeck-Multiplayer-4-Player-2026-08-02.json',
  'docs/e2e-results/GameDeck-1.2.0-2026-08-02.json',
  'docs/images/gamedeck-ready-check.png',
  'docs/images/gamedeck-startup.png',
  'build/icon.ico',
  'build/icon.icns',
  'build/icons/512x512.png',
  'mobile/web/icons/icon-192.png',
  'mobile/web/icons/icon-512.png',
  'mobile/web/icons/icon-maskable-192.png',
  'mobile/web/icons/icon-maskable-512.png',
  'scripts/repo-audit.mjs'
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

if (pkg.scripts?.['video:campaign'] !== 'node scripts/generate-social-campaign.cjs') fail('social campaign script is missing');
if (!renderer.includes('GAMEDECK_SHARE_COPY') || !renderer.includes('copyRedditLaunch') || !renderer.includes('copyShortCaption')) fail('in-app share loop is missing');

const { createStreamServer } = require(path.join(root, 'stream-server.js'));
const streamSecurityServer = createStreamServer({ mobileRoot: path.join(root, 'mobile', 'web') });
try {
  const started = await streamSecurityServer.start({ port: 0, title: 'Security smoke test' });
  const base = `http://127.0.0.1:${started.port}`;
  const requestJson = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, options);
    const body = await response.json();
    return { response, body };
  };
  const publicStatus = await requestJson('/api/status');
  if (!publicStatus.body?.stream?.active) fail('GameDeck Live public status must report an active stream');
  for (const secret of ['code', 'urls', 'primaryUrl', 'viewers']) {
    if (secret in (publicStatus.body?.stream || {})) fail(`GameDeck Live public status exposes ${secret}`);
  }
  const paired = await requestJson('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: started.code, label: 'Security smoke viewer' })
  });
  if (!paired.response.ok || !paired.body?.viewerId) fail('GameDeck Live valid pairing failed');
  if ('code' in (paired.body?.stream || {}) || 'viewers' in (paired.body?.stream || {})) fail('paired receiver status exposes host secrets');
  const unauthorizedLeave = await requestJson('/api/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewerId: paired.body.viewerId })
  });
  if (unauthorizedLeave.response.status !== 403 || streamSecurityServer.status().viewerCount !== 1) fail('unauthenticated viewer removal must be rejected');
  const authorizedLeave = await requestJson('/api/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: started.code, viewerId: paired.body.viewerId })
  });
  if (!authorizedLeave.response.ok || streamSecurityServer.status().viewerCount !== 0) fail('authenticated viewer removal failed');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rejected = await requestJson('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000', label: 'Rate limit test' })
    });
    if (rejected.response.status !== 403) fail('pairing failures must be rejected before rate limiting');
  }
  const rateLimited = await requestJson('/api/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '000000', label: 'Rate limit test' })
  });
  if (rateLimited.response.status !== 429) fail('pairing attempts must be rate limited');
} catch (error) {
  fail(`GameDeck Live security regression: ${error.message}`);
} finally {
  await streamSecurityServer.close().catch(() => {});
}

if (!process.exitCode) console.log('GameDeck smoke test passed.');
