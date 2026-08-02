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
  artwork: (title, systemId, folder) => ipcRenderer.invoke('artwork', title, systemId, folder),
  gameDetails: (title, systemId, context) => ipcRenderer.invoke('game-details', title, systemId, context),
  refreshGameDetails: (title, systemId, context) => ipcRenderer.invoke('refresh-game-details', title, systemId, context),
  chooseGameArtwork: file => ipcRenderer.invoke('choose-game-artwork', file),
  diagnostics: (includeLibrary = false) => ipcRenderer.invoke('diagnostics', includeLibrary),
  runtimeStatus: () => ipcRenderer.invoke('runtime-status'),
  ensureRuntime: force => ipcRenderer.invoke('ensure-runtime', Boolean(force)),
  arcadeAudit: force => ipcRenderer.invoke('arcade-audit', Boolean(force)),
  settings: () => ipcRenderer.invoke('settings'),
  inspectSettings: changes => ipcRenderer.invoke('inspect-settings', changes),
  saveSettings: changes => ipcRenderer.invoke('save-settings', changes),
  chooseDirectory: kind => ipcRenderer.invoke('choose-directory', kind),
  sponsors: () => ipcRenderer.invoke('sponsors'),
  donations: () => ipcRenderer.invoke('donations'),
  copyText: value => ipcRenderer.invoke('copy-text', value),
  openExternal: target => ipcRenderer.invoke('open-external', target),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  clearActivity: () => ipcRenderer.invoke('clear-activity'),
  onRuntime: callback => {
    const listener = (_, update) => callback(update);
    ipcRenderer.on('runtime-update', listener);
    return () => ipcRenderer.removeListener('runtime-update', listener);
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
