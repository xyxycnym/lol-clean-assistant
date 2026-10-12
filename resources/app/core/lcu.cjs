'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const READ_PATHS = new Set([
  '/lol-summoner/v1/current-summoner', '/lol-gameflow/v1/gameflow-phase', '/lol-gameflow/v1/session',
  '/lol-champ-select/v1/session', '/lol-lobby/v2/lobby', '/lol-matchmaking/v1/ready-check',
  '/lol-ranked/v1/current-ranked-stats', '/lol-perks/v1/pages', '/lol-perks/v1/currentpage',
  '/lol-perks/v1/styles', '/lol-perks/v1/perks', '/lol-chat/v1/me',
  '/lol-game-settings/v1/game-settings', '/lol-game-settings/v1/input-settings',
  '/lol-game-queues/v1/queues', '/lol-champ-select/v1/pickable-champion-ids',
  '/lol-champ-select/v1/bannable-champion-ids', '/lol-champions/v1/owned-champions-minimal', '/lol-patch/v1/game-version', '/riotclient/region-locale'
]);
// Read-only game data shipped with the client (champions, items, runes, icons) for the installed patch.
const GAME_DATA = /^\/lol-game-data\/assets\/(?:v1\/[a-z0-9-]+\.json|v1\/champions\/\d{1,6}\.json|[A-Za-z0-9_./%-]+\.(?:png|jpg|jpeg|webp))$/;
const WRITE_PATHS = {
  POST: new Set(['/lol-matchmaking/v1/ready-check/accept', '/lol-lobby/v2/lobby/matchmaking/search', '/lol-lobby/v2/play-again', '/lol-perks/v1/pages', '/lol-lobby/v2/lobby']),
  PATCH: new Set(['/lol-champ-select/v1/session/my-selection', '/lol-game-settings/v1/game-settings', '/lol-game-settings/v1/input-settings']),
  PUT: new Set(['/lol-chat/v1/me'])
};
function approvedPath(raw, method = 'GET') {
  if (typeof raw !== 'string' || raw.length > 1024 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20]/.test(raw)) return false;
  if (raw.includes('#')) return false;
  let url;
  try { const decoded = decodeURIComponent(raw.split('?')[0]); if (decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('//')) return false; url = new URL(raw, 'https://127.0.0.1'); if (url.hostname !== '127.0.0.1' || url.pathname !== raw.split('?')[0]) return false; } catch (_) { return false; }
  const p = url.pathname;
  if (method === 'GET') {
    if (READ_PATHS.has(p) && !url.search) return true;
    if (GAME_DATA.test(p) && !url.search) return true;
    if (/^\/lol-summoner\/v1\/summoners\/\d+$/.test(p) && !url.search) return true;
    if (/^\/lol-summoner\/v2\/summoners\/puuid\/[a-zA-Z0-9_-]{2,150}$/.test(p) && !url.search) return true;
    if (p === '/lol-summoner/v1/summoners') return [...url.searchParams.keys()].every(key => key === 'name') && !!url.searchParams.get('name') && url.searchParams.get('name').length <= 100;
    if (/^\/lol-ranked\/v1\/ranked-stats\/[a-zA-Z0-9_-]{2,150}$/.test(p) && !url.search) return true;
    if (/^\/lol-match-history\/v1\/products\/lol\/[a-zA-Z0-9_-]{2,150}\/matches$/.test(p)) {
      return [...url.searchParams.keys()].every(key => ['begIndex', 'endIndex'].includes(key)) && ['begIndex', 'endIndex'].every(key => /^\d{1,4}$/.test(url.searchParams.get(key) || ''));
    }
    if (/^\/lol-match-history\/v1\/games\/\d+$/.test(p) && !url.search) return true;
    if (/^\/lol-item-sets\/v1\/item-sets\/\d+\/sets$/.test(p) && !url.search) return true;
    return false;
  }
  if (url.search) return false;
  if (WRITE_PATHS[method] && WRITE_PATHS[method].has(p)) return true;
  if (method === 'PATCH' && /^\/lol-champ-select\/v1\/session\/actions\/\d+$/.test(p)) return true;
  if (method === 'PUT' && /^\/lol-perks\/v1\/pages\/\d+$/.test(p)) return true;
  if (method === 'PUT' && /^\/lol-item-sets\/v1\/item-sets\/\d+\/sets$/.test(p)) return true;
  return false;
}
function validateConnection(value) {
  if (!value || !Number.isInteger(Number(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535 || typeof value.password !== 'string' || !value.password || value.password.length > 512 || /[\r\n:]/.test(value.password)) throw new Error('本机客户端连接信息无效');
  return { port: Number(value.port), password: value.password, pid: Number(value.pid) || 0 };
}
function parseLockfile(file) {
  if (fs.statSync(file).size > 16384) throw new Error('请选择英雄联盟客户端目录内的 lockfile');
  const parts = fs.readFileSync(file, 'utf8').trim().split(':');
  if (parts.length !== 5 || parts[4] !== 'https' || !/^LeagueClient/i.test(parts[0])) throw new Error('不是有效的英雄联盟 lockfile');
  return validateConnection({ pid: Number(parts[1]), port: Number(parts[2]), password: parts[3] });
}
function parseCommandLine(line) {
  if (typeof line !== 'string') return null;
  const value = name => { const m = line.match(new RegExp('(?:^|\\s)"?--' + name + '=(?:"([^\"]*)"|([^\\s\"]+))')); return m && (m[1] || m[2]); };
  const port = value('app-port'), password = value('remoting-auth-token');
  if (!port || !password) return null;
  return validateConnection({ port: Number(port), password, pid: Number(value('app-pid')) });
}
function processList() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); @(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" -ErrorAction SilentlyContinue | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress";
  return new Promise(resolve => execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 262144, encoding: 'utf8' }, (error, stdout) => {
    if (error || !stdout.trim()) return resolve([]);
    try { const value = JSON.parse(stdout.replace(/^\uFEFF/, '')); resolve(Array.isArray(value) ? value : value ? [value] : []); } catch (_) { resolve([]); }
  }));
}
async function discover(lockfile = '') {
  if (lockfile) { try { return { ...parseLockfile(lockfile), source: 'lockfile' }; } catch (_) {} }
  const processes = await processList();
  for (const item of processes) {
    try { const info = parseCommandLine(item.CommandLine); if (info) return { ...info, pid: Number(item.ProcessId) || info.pid, source: 'process' }; } catch (_) {}
    if (item.ExecutablePath) { try { return { ...parseLockfile(path.join(path.dirname(item.ExecutablePath), 'lockfile')), source: 'lockfile' }; } catch (_) {} }
  }
  return null;
}
function localRequest(connection, raw, method = 'GET', body, timeout = 5000, binary = false) {
  if (!approvedPath(raw, method)) return Promise.reject(new Error('该操作不属于允许的本机客户端功能'));
  const info = validateConnection(connection);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  if (payload && payload.length > 524288) return Promise.reject(new Error('操作数据过大'));
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port: info.port, path: raw, method,
      rejectUnauthorized: false, agent: false, headers: { Authorization: 'Basic ' + Buffer.from('riot:' + info.password).toString('base64'), Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) }
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) { response.resume(); reject(new Error('客户端重定向已拒绝')); return; }
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 8388608) { response.destroy(); reject(new Error('客户端响应过大')); } else chunks.push(chunk); });
      response.on('error', () => reject(new Error('客户端响应中断')));
      response.on('end', () => {
        if (status < 200 || status >= 300) { const error = new Error(status === 404 ? '当前客户端未提供这项数据或接口' : status === 401 ? '客户端登录信息已变化，请刷新连接' : '本机客户端未完成操作（' + status + '）'); error.status = status; reject(error); return; }
        if (binary) return resolve(Buffer.concat(chunks));
        const data = Buffer.concat(chunks).toString('utf8');
        if (!data) return resolve(null);
        try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('客户端返回的数据格式不正确')); }
      });
    });
    request.setTimeout(timeout, () => request.destroy(new Error('本机客户端响应超时')));
    request.on('error', error => reject(new Error(error.code === 'ECONNREFUSED' ? '本机客户端暂不可用，请确认已登录游戏客户端' : error.message === '本机客户端响应超时' ? error.message : '无法连接本机客户端，请刷新或重新选择 lockfile')));
    if (payload) request.write(payload);
    request.end();
  });
}
function liveRequest() {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata', rejectUnauthorized: false, agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('对局实况暂不可用')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 2097152) { response.destroy(); reject(new Error('实况响应过大')); } else chunks.push(chunk); });
      response.on('error', () => reject(new Error('实况响应中断')));
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('实况数据格式不正确')); } });
    });
    request.setTimeout(1500, () => request.destroy()); request.on('error', () => reject(new Error('当前没有可读取的本机对局')));
  });
}
class LcuClient {
  constructor(options = {}) { this.connection = null; this.lastDiscovery = 0; this.discoverer = options.discoverer || discover; this.transport = options.transport || localRequest; this.lockfile = options.lockfile || ''; }
  async connect(force = false) {
    if (this.connection && !force) return this.connection;
    if (!force && Date.now() - this.lastDiscovery < 5000) return null;
    this.lastDiscovery = Date.now(); const result = await this.discoverer(this.lockfile);
    this.connection = result ? { ...validateConnection(result), source: result.source } : null; return this.connection;
  }
  async request(raw, method = 'GET', body) {
    if (!approvedPath(raw, method)) throw new Error('该操作不属于允许的本机客户端功能');
    const connection = await this.connect(); if (!connection) throw new Error('尚未连接英雄联盟客户端，请先打开并登录客户端');
    return this.transport(connection, raw, method, body);
  }
  async optional(raw) { try { return await this.request(raw); } catch (_) { return null; } }
  async binary(raw) {
    if (!approvedPath(raw, 'GET')) throw new Error('该操作不属于允许的本机客户端功能');
    const connection = await this.connect(); if (!connection) throw new Error('尚未连接英雄联盟客户端，请先打开并登录客户端');
    return this.transport(connection, raw, 'GET', undefined, 8000, true);
  }
  disconnect() { this.connection = null; }
}
module.exports = { LcuClient, approvedPath, validateConnection, parseLockfile, parseCommandLine, discover, localRequest, liveRequest };
