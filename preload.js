const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  library: () => ipcRenderer.invoke('library'),
  launch: file => ipcRenderer.invoke('launch', file),
  setupSystem: systemId => ipcRenderer.invoke('setup-system', systemId),
  favorite: file => ipcRenderer.invoke('favorite', file),
  rescan: () => ipcRenderer.invoke('rescan'),
  openLibrary: () => ipcRenderer.invoke('open-library'),
  catalogSystems: () => ipcRenderer.invoke('catalog-systems'),
  catalogGames: source => ipcRenderer.invoke('catalog-games', source),
  importOwned: (source, folder, title, fileName) => ipcRenderer.invoke('import-owned', source, folder, title, fileName),
  prepareGame: file => ipcRenderer.invoke('prepare-game', file),
  retryDownload: id => ipcRenderer.invoke('retry-download', id),
  pauseDownload: id => ipcRenderer.invoke('pause-download', id),
  dismissDownload: id => ipcRenderer.invoke('dismiss-download', id),
  artwork: (title, systemId, folder) => ipcRenderer.invoke('artwork', title, systemId, folder),
  gameDetails: (title, systemId, context) => ipcRenderer.invoke('game-details', title, systemId, context),
  refreshGameDetails: (title, systemId, context) => ipcRenderer.invoke('refresh-game-details', title, systemId, context),
  chooseGameArtwork: file => ipcRenderer.invoke('choose-game-artwork', file),
  deleteGame: file => ipcRenderer.invoke('delete-game', file),
  diagnostics: (includeLibrary = false) => ipcRenderer.invoke('diagnostics', includeLibrary),
  runtimeStatus: () => ipcRenderer.invoke('runtime-status'),
  playSessionCapabilities: file => ipcRenderer.invoke('play-session-capabilities', file),
  playSessionStatus: () => ipcRenderer.invoke('play-session-status'),
  playSessionStart: (file, options) => ipcRenderer.invoke('play-session-start', file, options || {}),
  playSessionSetMode: (sessionId, mode) => ipcRenderer.invoke('play-session-set-mode', sessionId, mode),
  playSessionArmCapture: (sessionId, includeAudio = true) => ipcRenderer.invoke('play-session-arm-capture', sessionId, includeAudio !== false),
  playSessionCaptureStarted: sessionId => ipcRenderer.invoke('play-session-capture-started', sessionId),
  playSessionStop: (sessionId, reason) => ipcRenderer.invoke('play-session-stop', sessionId, reason || 'requested'),
  ensureRuntime: force => ipcRenderer.invoke('ensure-runtime', Boolean(force)),
  streamStatus: () => ipcRenderer.invoke('stream-status'),
  streamSources: () => ipcRenderer.invoke('stream-sources'),
  streamStart: config => ipcRenderer.invoke('stream-start', config || {}),
  streamStop: () => ipcRenderer.invoke('stream-stop'),
  streamHostPull: () => ipcRenderer.invoke('stream-host-pull'),
  streamHostSend: (viewerId, payload) => ipcRenderer.invoke('stream-host-send', viewerId, payload),
  remotePlayCodeEncode: (prefix, payload) => ipcRenderer.invoke('remote-play-code-encode', prefix, payload),
  remotePlayCodeDecode: (value, acceptedPrefixes) => ipcRenderer.invoke('remote-play-code-decode', value, acceptedPrefixes),
  remotePlayStatus: () => ipcRenderer.invoke('remote-play-status'),
  remotePlayStart: (file, config) => ipcRenderer.invoke('remote-play-start', file, config || {}),
  remotePlayStop: () => ipcRenderer.invoke('remote-play-stop'),
  remotePlayInput: payload => ipcRenderer.send('remote-play-input', payload || {}),
  netplayStatus: () => ipcRenderer.invoke('netplay-status'),
  netplayGameInfo: file => ipcRenderer.invoke('netplay-game-info', file),
  netplayMatchInfo: file => ipcRenderer.invoke('netplay-match-info', file),
  netplayRelays: () => ipcRenderer.invoke('netplay-relays'),
  netplayHost: (file, config) => ipcRenderer.invoke('netplay-host', file, config || {}),
  netplayJoin: (invite, preferredFile, config) => ipcRenderer.invoke('netplay-join', invite, preferredFile || '', config || {}),
  netplayStop: () => ipcRenderer.invoke('netplay-stop'),
  arcadeAudit: force => ipcRenderer.invoke('arcade-audit', Boolean(force)),
  settings: () => ipcRenderer.invoke('settings'),
  inspectSettings: changes => ipcRenderer.invoke('inspect-settings', changes),
  saveSettings: changes => ipcRenderer.invoke('save-settings', changes),
  chooseDirectory: kind => ipcRenderer.invoke('choose-directory', kind),
  sponsors: () => ipcRenderer.invoke('sponsors'),
  donations: () => ipcRenderer.invoke('donations'),
  copyText: value => ipcRenderer.invoke('copy-text', value),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  openExternal: target => ipcRenderer.invoke('open-external', target),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  clearActivity: () => ipcRenderer.invoke('clear-activity'),
  onPlaySession: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('play-session-update', listener);
    return () => ipcRenderer.removeListener('play-session-update', listener);
  },
  onRuntime: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('runtime-update', listener);
    return () => ipcRenderer.removeListener('runtime-update', listener);
  },
  onStream: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('stream-update', listener);
    return () => ipcRenderer.removeListener('stream-update', listener);
  },
  onRemotePlay: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('remote-play-update', listener);
    return () => ipcRenderer.removeListener('remote-play-update', listener);
  },
  onNetplay: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('netplay-update', listener);
    return () => ipcRenderer.removeListener('netplay-update', listener);
  },
  onLaunch: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('launch-update', listener);
    return () => ipcRenderer.removeListener('launch-update', listener);
  },
  onActivity: callback => {
    const listener = (_, entry) => callback(entry);
    ipcRenderer.on('activity', listener);
    return () => ipcRenderer.removeListener('activity', listener);
  },
  onDownload: callback => {
    const listener = (_, download) => callback(download);
    ipcRenderer.on('download-update', listener);
    return () => ipcRenderer.removeListener('download-update', listener);
  },
  onArcadeAudit: callback => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on('arcade-audit-progress', listener);
    return () => ipcRenderer.removeListener('arcade-audit-progress', listener);
  }
});
