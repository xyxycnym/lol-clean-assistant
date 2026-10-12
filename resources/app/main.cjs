'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog, Menu, session, screen } = require('electron');
const { Assistant } = require('./core/assistant.cjs');
const I18N = require('./renderer/i18n.js');

const portable = path.resolve(__dirname, '..', '..');
const smoke = process.argv.includes('--smoke-test');
const smokeDataArgument = smoke && process.argv.find(value => value.startsWith('--smoke-data-dir='));
let dataDirectory = path.join(portable, 'clean-data');
if (smokeDataArgument) dataDirectory = path.resolve(smokeDataArgument.slice('--smoke-data-dir='.length));
try { fs.mkdirSync(dataDirectory, { recursive: true }); fs.accessSync(dataDirectory, fs.constants.W_OK); }
catch (_) { dataDirectory = path.join(app.getPath('appData'), 'LeagueLocalCleanAssistant'); fs.mkdirSync(dataDirectory, { recursive: true }); }
let window = null; let assistant = null;
// Interface language: the user's choice, otherwise the system language (Chinese, English or Korean).
function systemLanguage() { let locale = ''; try { locale = app.isReady() ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale; } catch (_) {} return I18N.normalize(locale) || 'en'; }
function tr(text) { return I18N.translate(text, assistant ? assistant.language() : systemLanguage()); }
function smokeTrace(message) { if (smoke) fs.appendFileSync(path.join(dataDirectory, 'main-trace.log'), new Date().toISOString() + ' ' + message + '\n'); }
smokeTrace('main-loaded');
process.on('uncaughtException', error => {
  try { fs.writeFileSync(path.join(dataDirectory, 'startup-error.txt'), String(error.stack || error), 'utf8'); } catch (_) {}
  if (!smoke) dialog.showErrorBox(tr('程序运行未完成'), tr('请查看 clean-data 中的错误记录，重新打开完整的纯净版文件夹。'));
  app.exit(1);
});
app.setName('联盟助手纯净版');
if (smoke) app.disableHardwareAcceleration();
fs.mkdirSync(path.join(dataDirectory, 'window'), { recursive: true });
fs.mkdirSync(path.join(dataDirectory, 'session'), { recursive: true });
app.setPath('userData', path.join(dataDirectory, 'window'));
// Electron 19 stores its session under userData; sessionData is a newer path key.
try { app.setPath('sessionData', path.join(dataDirectory, 'session')); } catch (_) {}
// Chromium has no reason to contact background services in this local-file app.
for (const name of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-breakpad', 'disable-client-side-phishing-detection', 'disable-sync', 'no-pings']) app.commandLine.appendSwitch(name);
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,CertificateTransparencyComponentUpdater');
app.commandLine.appendSwitch('proxy-server', 'direct://');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');

smokeTrace('waiting-for-ready');
const rendererFile = path.join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(rendererFile).href;
// Window position, size, maximized state and page zoom are restored from the last session.
const windowStateFile = path.join(dataDirectory, 'window-state.json');
const MIN_WIDTH = 1040; const MIN_HEIGHT = 700;
function readWindowState() {
  const fallback = { width: 1280, height: 840, maximized: false, zoom: 1 };
  try {
    const saved = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    const width = Math.round(Number(saved.width)); const height = Math.round(Number(saved.height));
    if (!(width >= 600 && width <= 10000 && height >= 400 && height <= 10000)) return fallback;
    const state = { width, height, content: saved.content === true, maximized: saved.maximized === true, zoom: Number(saved.zoom) >= 0.5 && Number(saved.zoom) <= 3 ? Number(saved.zoom) : 1 };
    const x = Math.round(Number(saved.x)); const y = Math.round(Number(saved.y));
    // Keep the saved position only if the title bar still lands on a connected display.
    const visible = Number.isFinite(x) && Number.isFinite(y) && screen.getAllDisplays().some(({ workArea: area }) => x + 100 > area.x && x + 100 < area.x + area.width && y >= area.y && y + 30 < area.y + area.height);
    return visible ? { ...state, x, y } : state;
  } catch (_) { return fallback; }
}
// Electron 19 rounds window geometry inconsistently at 125%/150% display scaling, so a restored window comes back a few
// pixels larger and offset. Differences that small are treated as unchanged, which keeps the size stable across launches.
const DRIFT = 12;
let restoredState = null;
function saveWindowState(target) {
  if (smoke || !target || target.isDestroyed()) return;
  try {
    // Content size, not outer size: at non-100% display scaling the frame is rounded differently on every restore.
    const normal = target.isMaximized() || target.isMinimized() || target.isFullScreen();
    const bounds = normal ? target.getNormalBounds() : target.getBounds();
    const content = normal ? null : target.getContentBounds();
    const frameWidth = content ? bounds.width - content.width : 0, frameHeight = content ? bounds.height - content.height : 0;
    const value = { x: bounds.x, y: bounds.y, width: bounds.width - frameWidth, height: bounds.height - frameHeight, content: !!content, maximized: target.isMaximized(), zoom: target.webContents.isDestroyed() ? 1 : target.webContents.getZoomFactor() };
    const base = restoredState;
    if (base && base.content === value.content && base.x != null && ['x', 'y', 'width', 'height'].every(key => Math.abs(value[key] - base[key]) <= DRIFT)) Object.assign(value, { x: base.x, y: base.y, width: base.width, height: base.height });
    const temporary = windowStateFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, windowStateFile);
  } catch (_) {}
}
function result(method) {
  return async (event, ...args) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== rendererUrl) return { ok: false, error: '来源不明的操作已拒绝' };
    try { return { ok: true, data: await method(...args) }; }
    catch (error) { return { ok: false, error: String(error.message || '操作未完成').slice(0, 300) }; }
  };
}
function register() {
  const methods = {
    getState: () => assistant.snapshot(), refresh: () => assistant.refresh(true),
    getCatalog: kind => assistant.getCatalog(kind), searchSummoner: query => assistant.searchSummoner(query),
    getHistory: (id, begin) => assistant.getHistory(id, begin), getMatch: id => assistant.getMatch(id),
    saveSettings: value => assistant.saveSettings(value), applyRune: value => assistant.applyRune(value),
    applySpells: value => assistant.applySpells(value), applyItemSet: value => assistant.applyItemSet(value),
    createLobby: id => assistant.createLobby(id), setProfile: value => assistant.setProfile(value),
    getClientSettings: () => assistant.getClientSettings(), saveClientSettings: value => assistant.saveClientSettings(value),
    getBuild: (championId, position, mode) => assistant.getBuild(championId, position, mode), getMayhemAugments: championId => assistant.getMayhemAugments(championId), applyBuildItems: value => assistant.applyBuildItems(value),
    syncGameData: () => assistant.syncGameData(), getRuneLayout: () => assistant.getRuneLayout(),
    chooseLockfile: async () => {
      const selected = await dialog.showOpenDialog(window, { title: tr('选择英雄联盟客户端目录内的 lockfile'), properties: ['openFile'], filters: [{ name: tr('客户端 lockfile'), extensions: ['*'] }] });
      if (selected.canceled) return { canceled: true };
      return assistant.chooseLockfile(selected.filePaths[0]);
    },
    exportConfig: async () => {
      const selected = await dialog.showSaveDialog(window, { title: tr('导出本地设置与预设'), defaultPath: tr('联盟助手本地配置.json'), filters: [{ name: tr('JSON 配置'), extensions: ['json'] }] });
      if (selected.canceled) return { canceled: true };
      fs.writeFileSync(selected.filePath, JSON.stringify(assistant.store.export(), null, 2), 'utf8'); return { exported: true };
    },
    importConfig: async () => {
      const selected = await dialog.showOpenDialog(window, { title: tr('导入本地设置与预设'), properties: ['openFile'], filters: [{ name: tr('JSON 配置'), extensions: ['json'] }] });
      if (selected.canceled) return { canceled: true };
      if (fs.statSync(selected.filePaths[0]).size > 1048576) throw new Error('配置文件过大');
      assistant.importConfig(JSON.parse(fs.readFileSync(selected.filePaths[0], 'utf8')));
      return { imported: true, settings: assistant.state.settings };
    }
  };
  for (const [name, handler] of Object.entries(methods)) ipcMain.handle('clean:' + name, result(handler));
}

app.whenReady().then(async () => {
  smokeTrace('app-ready');
  const ownSession = session.fromPartition('clean-local');
  ownSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ownSession.setPermissionCheckHandler(() => false);
  ownSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_details, callback) => callback({ cancel: true }));
  ownSession.on('will-download', event => event.preventDefault());
  Menu.setApplicationMenu(null);
  assistant = new Assistant({ assets: path.join(__dirname, 'renderer', 'assets'), dataDirectory, systemLanguage: systemLanguage() });
  smokeTrace('assistant-created');
  const windowState = readWindowState(); restoredState = windowState;
  window = new BrowserWindow({ title: tr('联盟助手纯净版'), width: windowState.width, height: windowState.height, useContentSize: windowState.content === true, ...(windowState.x != null ? { x: windowState.x, y: windowState.y } : { center: true }),
    minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT, backgroundColor: '#0a0e15', show: false,
    icon: path.join(__dirname, 'renderer', 'assets', 'images', 'app.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: ownSession, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false, offscreen: smoke, backgroundThrottling: !smoke }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (target.split('#')[0] !== rendererUrl) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  register();
  smokeTrace('window-created');
  assistant.on('state', state => { if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('clean:state', state); });
  window.once('ready-to-show', () => { if (smoke) return; if (windowState.maximized) window.maximize(); window.show(); });
  let saveTimer = null;
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(window), 800); };
  for (const name of ['resize', 'move', 'maximize', 'unmaximize']) window.on(name, scheduleSave);
  window.webContents.on('zoom-changed', scheduleSave);
  window.on('close', () => { clearTimeout(saveTimer); saveWindowState(window); });
  window.on('closed', () => { if (assistant) assistant.stop(); window = null; });
  window.webContents.on('did-finish-load', () => { if (windowState.zoom !== 1) window.webContents.setZoomFactor(windowState.zoom); });
  await window.loadFile(rendererFile);
  smokeTrace('renderer-loaded');
  await assistant.start();
}).catch(error => {
  try { fs.writeFileSync(path.join(dataDirectory, 'startup-error.txt'), String(error.stack || error), 'utf8'); } catch (_) {}
  dialog.showErrorBox(tr('启动未完成'), tr('请确认整个纯净版文件夹已完整解压。错误信息已保存到 clean-data。')); app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (assistant) assistant.stop(); });
