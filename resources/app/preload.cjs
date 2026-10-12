'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (method, ...args) => ipcRenderer.invoke('clean:' + method, ...args);
contextBridge.exposeInMainWorld('cleanAssistant', Object.freeze({
  getState: () => call('getState'), refresh: () => call('refresh'), chooseLockfile: () => call('chooseLockfile'),
  getCatalog: kind => call('getCatalog', kind), searchSummoner: query => call('searchSummoner', query),
  getHistory: (puuid, begin) => call('getHistory', puuid, begin), getMatch: id => call('getMatch', id),
  saveSettings: value => call('saveSettings', value), applyRune: value => call('applyRune', value),
  applySpells: value => call('applySpells', value), applyItemSet: value => call('applyItemSet', value),
  createLobby: id => call('createLobby', id), setProfile: value => call('setProfile', value),
  getClientSettings: () => call('getClientSettings'), saveClientSettings: value => call('saveClientSettings', value),
  exportConfig: () => call('exportConfig'), importConfig: () => call('importConfig'),
  getBuild: (championId, position, mode) => call('getBuild', championId, position, mode), getMayhemAugments: championId => call('getMayhemAugments', championId), applyBuildItems: value => call('applyBuildItems', value),
  syncGameData: () => call('syncGameData'), getRuneLayout: () => call('getRuneLayout'),
  onState: callback => { if (typeof callback !== 'function') return () => {}; const listener = (_event, value) => callback(value); ipcRenderer.on('clean:state', listener); return () => ipcRenderer.removeListener('clean:state', listener); }
}));
