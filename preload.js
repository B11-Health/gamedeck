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
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: changes => ipcRenderer.invoke('save-settings', changes),
  chooseDirectory: kind => ipcRenderer.invoke('choose-directory', kind),
  sponsors: () => ipcRenderer.invoke('sponsors'),
  donations: () => ipcRenderer.invoke('donations'),
  copyText: value => ipcRenderer.invoke('copy-text', value),
  openExternal: target => ipcRenderer.invoke('open-external', target),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  clearActivity: () => ipcRenderer.invoke('clear-activity'),
  onActivity: callback => {
    const listener = (_, entry) => callback(entry);
    ipcRenderer.on('activity', listener);
    return () => ipcRenderer.removeListener('activity', listener);
  },
  onDownload: callback => {
    const listener = (_, download) => callback(download);
    ipcRenderer.on('download-update', listener);
    return () => ipcRenderer.removeListener('download-update', listener);
  }
});
