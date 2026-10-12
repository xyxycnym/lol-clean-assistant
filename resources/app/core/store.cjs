'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES = ['default', 'top', 'jungle', 'middle', 'bottom', 'utility', 'aram'];
const BOOLS = ['autoAccept', 'autoStart', 'autoAgain', 'autoPick', 'autoBan', 'pickHoverOnly', 'pickAtLastSecond', 'banAtLastSecond', 'avoidTeamHover', 'onlineData'];
const { REGIONS, TIERS } = require('./opgg.cjs');
const DEFAULTS = {
  schemaVersion: 1, autoAccept: false, acceptDelaySec: 0,
  autoStart: false, startDelaySec: 8, autoAgain: false, againDelaySec: 8,
  autoPick: false, autoBan: false, pickHoverOnly: true,
  pickAtLastSecond: false, banAtLastSecond: false, avoidTeamHover: true,
  onlineData: true, opggRegion: 'global', opggTier: 'emerald_plus',
  picks: Object.fromEntries(ROLES.map(role => [role, []])),
  bans: Object.fromEntries(ROLES.map(role => [role, []])), runePresets: [], itemSets: [], clientProfiles: { game: null, input: null }
};
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeDocument(value, depth = 0) {
  if (depth > 14) throw new Error('配置层级过深');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { if (value.length > 4000) throw new Error('配置列表过长'); value.forEach(item => safeDocument(item, depth + 1)); return; }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('配置格式错误');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('配置包含无效字段');
    safeDocument(item, depth + 1);
  }
}
function integer(value, min, max, fallback) { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; }
function text(value, max = 80) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function normalizeRune(value) {
  safeDocument(value);
  const primary = integer(value.primaryStyleId, 8000, 8400, 8000);
  const secondary = integer(value.subStyleId, 8000, 8400, 8100);
  if (![8000, 8100, 8200, 8300, 8400].includes(primary) || ![8000, 8100, 8200, 8300, 8400].includes(secondary) || primary === secondary) throw new Error('请选择不同的主系和副系');
  const ids = Array.isArray(value.selectedPerkIds) ? value.selectedPerkIds.map(n => integer(n, 1, 100000, 0)) : [];
  if (ids.length !== 9 || ids.some(id => id === 0)) throw new Error('符文需要主系 4 项、副系 2 项和属性碎片 3 项');
  return { id: text(value.id) || crypto.randomUUID(), name: text(value.name) || '本地符文', championId: integer(value.championId, 0, 100000, 0), primaryStyleId: primary, subStyleId: secondary, selectedPerkIds: ids, spell1Id: integer(value.spell1Id, 0, 10000, 4), spell2Id: integer(value.spell2Id, 0, 10000, 14) };
}
function normalizeItemSet(value) {
  safeDocument(value);
  const items = Array.isArray(value.items) ? value.items.map(n => integer(n, 1, 1000000, 0)).filter(Boolean).slice(0, 24) : [];
  if (!items.length) throw new Error('配装至少需要一件装备');
  return { id: text(value.id) || crypto.randomUUID(), name: text(value.name) || '本地配装', championId: integer(value.championId, 0, 100000, 0), items };
}
function normalizeSettings(value, current = DEFAULTS) {
  safeDocument(value);
  const next = clone(current);
  for (const key of BOOLS) if (key in value) { if (typeof value[key] !== 'boolean') throw new Error('开关设置格式错误'); next[key] = value[key]; }
  for (const key of ['acceptDelaySec', 'startDelaySec', 'againDelaySec']) if (key in value) next[key] = integer(value[key], 0, 30, next[key]);
  if ('opggRegion' in value) { if (!REGIONS.includes(value.opggRegion)) throw new Error('无效的数据区域'); next.opggRegion = value.opggRegion; }
  if ('opggTier' in value) { if (!TIERS.includes(value.opggTier)) throw new Error('无效的段位范围'); next.opggTier = value.opggTier; }
  for (const kind of ['picks', 'bans']) if (kind in value) {
    if (!value[kind] || typeof value[kind] !== 'object' || Array.isArray(value[kind])) throw new Error('英雄优先级格式错误');
    for (const role of ROLES) if (role in value[kind]) {
      if (!Array.isArray(value[kind][role])) throw new Error('英雄优先级需要列表');
      next[kind][role] = [...new Set(value[kind][role].map(n => integer(n, kind === 'bans' ? -1 : 1, 100000, 0)).filter(n => n !== 0))].slice(0, 10);
    }
  }
  if ('runePresets' in value) { if (!Array.isArray(value.runePresets) || value.runePresets.length > 100) throw new Error('符文预设数量超限'); next.runePresets = value.runePresets.map(normalizeRune); }
  if ('itemSets' in value) { if (!Array.isArray(value.itemSets) || value.itemSets.length > 100) throw new Error('出装预设数量超限'); next.itemSets = value.itemSets.map(normalizeItemSet); }
  if ('clientProfiles' in value) {
    if (!value.clientProfiles || typeof value.clientProfiles !== 'object' || Array.isArray(value.clientProfiles)) throw new Error('客户端配置备份格式错误');
    next.clientProfiles = next.clientProfiles || { game: null, input: null };
    for (const key of ['game', 'input']) if (key in value.clientProfiles) {
      const document = value.clientProfiles[key];
      if (document !== null && (typeof document !== 'object' || Array.isArray(document) || Buffer.byteLength(JSON.stringify(document)) > 200000)) throw new Error('客户端配置备份过大或格式错误');
      next.clientProfiles[key] = clone(document);
    }
  }
  next.schemaVersion = 1;
  return next;
}
class LocalStore {
  constructor(directory) {
    this.directory = directory; this.file = path.join(directory, 'settings.json'); this.message = '';
    fs.mkdirSync(directory, { recursive: true });
    this.settings = clone(DEFAULTS);
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 1048576) throw new Error('配置文件过大');
        this.settings = normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')), DEFAULTS);
      }
    } catch (error) {
      this.message = '原配置无法读取，已保留原文件并使用默认设置';
      fs.copyFileSync(this.file, path.join(directory, 'settings-recovery-' + Date.now() + '.json'));
    }
    this.privateFile = path.join(directory, 'client-path.json');
    this.lockfile = '';
    try { const data = JSON.parse(fs.readFileSync(this.privateFile, 'utf8')); if (typeof data.lockfile === 'string') this.lockfile = data.lockfile; } catch (_) {}
  }
  write(file, value) {
    const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  save(value) { const settings = normalizeSettings(value, this.settings); this.write(this.file, settings); this.settings = settings; return clone(settings); }
  setLockfile(file) { this.write(this.privateFile, { lockfile: file }); this.lockfile = file; }
  export() { return { format: 'league-local-clean-assistant', version: 1, settings: clone(this.settings) }; }
  import(value) {
    safeDocument(value);
    if (value.format !== 'league-local-clean-assistant' || value.version !== 1) throw new Error('不是本程序导出的配置文件');
    // Imported automation never becomes active merely by opening a file.
    const settings = normalizeSettings(value.settings, DEFAULTS);
    for (const flag of ['autoAccept', 'autoStart', 'autoAgain', 'autoPick', 'autoBan']) settings[flag] = false;
    return this.save(settings);
  }
}
module.exports = { LocalStore, DEFAULTS, normalizeSettings, normalizeRune, normalizeItemSet, safeDocument, clone };
