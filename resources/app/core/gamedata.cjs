'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Champions, items, runes and summoner spells copied from the running client, so they always match its patch.
// Icons already shipped with the offline snapshot are reused; only missing ones are copied in as data URIs.
const KINDS = ['heroes', 'items', 'runes', 'spells'];
// Catalogs the client does not provide; English / Korean versions ship with the app.
const BUNDLED_ONLY = ['augments', 'chess', 'equip', 'races', 'jobs'];
const { normalize } = require('../renderer/i18n.js');
const IMAGE_LIMIT = 400 * 1024;

function plain(value) { return String(value == null ? '' : value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+\n/g, '\n').trim(); }
function burn(values, levels) {
  const list = (Array.isArray(values) ? values : []).slice(0, levels || 5).map(value => Math.round(Number(value) * 100) / 100).filter(Number.isFinite);
  if (!list.length || list.every(value => value === 0)) return '';
  return list.every(value => value === list[0]) ? String(list[0]) : list.join('/');
}
function write(file, value) {
  const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function runeLayout(perkstyles) {
  const styles = Array.isArray(perkstyles && perkstyles.styles) ? perkstyles.styles : [];
  const groups = {}; let shards = null;
  for (const style of styles) {
    const slots = Array.isArray(style.slots) ? style.slots : [];
    const rows = slots.filter(slot => slot.type !== 'kStatMod').map(slot => (slot.perks || []).map(Number));
    if (rows.length === 4 && rows.every(row => row.length)) groups[style.id] = rows;
    const statRows = slots.filter(slot => slot.type === 'kStatMod').map(slot => (slot.perks || []).map(Number));
    if (!shards && statRows.length === 3) shards = statRows;
  }
  return Object.keys(groups).length && shards ? { groups, shards, styles: styles.filter(style => groups[style.id]).map(style => [Number(style.id), String(style.name || style.id)]) } : null;
}

class GameData {
  constructor({ assets, dataDirectory }) {
    this.assets = assets; this.directory = path.join(dataDirectory, 'gamedata'); this.metaFile = path.join(this.directory, 'meta.json');
    this.meta = null; this.syncing = null;
    try { const meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')); if (meta && typeof meta.version === 'string' && KINDS.every(kind => fs.existsSync(path.join(this.directory, kind + '.json')))) this.meta = meta; } catch (_) {}
    try { const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'), 'utf8')); this.offlineVersion = manifest.localDataVersion || ''; this.localeVersions = manifest.localeDataVersions || {}; } catch (_) { this.offlineVersion = ''; this.localeVersions = {}; }
  }
  // Client data is used only when it is in the interface language; otherwise the bundled snapshot for that language.
  matches(language) { return !!this.meta && (this.meta.locale || 'zh-CN') === language; }
  offlineVersionFor(language) { return language !== 'zh-CN' && this.localeVersions[language] || this.offlineVersion; }
  info(language = 'zh-CN') { return this.matches(language) ? { source: 'client', version: this.meta.version, syncedAt: this.meta.syncedAt, offlineVersion: this.offlineVersionFor(language) } : { source: 'offline', version: this.offlineVersionFor(language), syncedAt: null, offlineVersion: this.offlineVersionFor(language) }; }
  layout() { return this.meta && this.meta.runeLayout || null; }
  catalog(kind, language = 'zh-CN') {
    if (!KINDS.includes(kind) && !BUNDLED_ONLY.includes(kind)) return null;
    if (!this.matches(language) || BUNDLED_ONLY.includes(kind)) {
      if (language === 'zh-CN') return null;
      try { const value = JSON.parse(fs.readFileSync(path.join(this.assets, 'json', language, kind + '.json'), 'utf8')); return Array.isArray(value) ? value : null; } catch (_) { return null; }
    }
    try { const value = JSON.parse(fs.readFileSync(path.join(this.directory, kind + '.json'), 'utf8')); return Array.isArray(value) ? value : null; } catch (_) { return null; }
  }
  offline(kind) { try { return JSON.parse(fs.readFileSync(path.join(this.assets, 'json', kind + '.json'), 'utf8')); } catch (_) { return []; } }
  localImage(folder, name) {
    if (!/^[A-Za-z0-9_. -]+\.(?:png|jpe?g|webp)$/i.test(name)) return '';
    return fs.existsSync(path.join(this.assets, 'images', folder, name)) ? `./assets/images/${folder}/${name}` : '';
  }
  async remoteImage(lcu, iconPath) {
    if (typeof iconPath !== 'string' || !iconPath.startsWith('/lol-game-data/assets/')) return '';
    try {
      const raw = await lcu.binary(encodeURI(iconPath).replace(/%25/g, '%'));
      if (!Buffer.isBuffer(raw) || !raw.length || raw.length > IMAGE_LIMIT) return '';
      const type = raw[0] === 0x89 ? 'png' : raw[0] === 0xff ? 'jpeg' : raw.slice(8, 12).toString() === 'WEBP' ? 'webp' : '';
      return type ? `data:image/${type};base64,${raw.toString('base64')}` : '';
    } catch (_) { return ''; }
  }
  async image(lcu, folder, name, iconPath) { return this.localImage(folder, name) || await this.remoteImage(lcu, iconPath) || './assets/images/none.png'; }

  // Returns true when new data was written. Repeated calls share one run.
  sync(lcu, force = false) {
    if (!this.syncing) this.syncing = this.run(lcu, force).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async run(lcu, force) {
    const fullVersion = await lcu.request('/lol-patch/v1/game-version');
    if (typeof fullVersion !== 'string' || !fullVersion) throw new Error('客户端没有返回游戏版本');
    const version = fullVersion.split('.').slice(0, 2).join('.');
    if (!force && this.meta && this.meta.fullVersion === fullVersion) return false;
    const base = '/lol-game-data/assets/v1/';
    const [summary, items, perks, perkstyles, spells] = await Promise.all(['champion-summary.json', 'items.json', 'perks.json', 'perkstyles.json', 'summoner-spells.json'].map(file => lcu.request(base + file)));
    if (![summary, items, perks, spells].every(Array.isArray)) throw new Error('客户端游戏数据格式不匹配');
    const layout = runeLayout(perkstyles);
    const region = await lcu.request('/riotclient/region-locale').catch(() => null);
    const locale = normalize(region && region.locale) || (summary.some(item => /[\uac00-\ud7a3]/.test(item.name)) ? 'ko' : summary.some(item => /[\u4e00-\u9fff]/.test(item.name)) ? 'zh-CN' : 'en');
    const offlineHeroes = new Map(this.offline('heroes').map(hero => [Number(hero.id), hero]));

    const heroes = [];
    const ids = summary.map(item => Number(item.id)).filter(id => id > 0 && id < 60000);
    for (let index = 0; index < ids.length; index += 4) {
      const batch = await Promise.all(ids.slice(index, index + 4).map(id => lcu.request(base + 'champions/' + id + '.json').catch(() => null)));
      for (const detail of batch) if (detail && detail.id) heroes.push(await this.hero(lcu, detail, offlineHeroes.get(Number(detail.id))));
    }
    if (heroes.length < ids.length * 0.9) throw new Error('英雄资料读取不完整，请稍后重试');
    // Special variants (IDs 60000+) only need a name in the client's language; art and icons come from the offline entry.
    const variants = new Map(summary.map(item => [Number(item.id), item]));
    for (const [id, hero] of offlineHeroes) {
      if (id > 0 && id < 60000) continue;
      const variant = variants.get(id);
      heroes.push(variant && locale !== 'zh-CN' ? { ...hero, name: variant.name, title: '', description: '', alias: variant.alias || hero.alias } : hero);
    }

    const itemList = [];
    for (const item of items) {
      if (!item || !item.id || !item.name) continue;
      itemList.push({ id: item.id, name: plain(item.name), price: item.price, priceTotal: item.priceTotal, description: item.description, from: item.from || [], to: item.to || [], categories: item.categories || [], inStore: item.inStore, iconPath: item.iconPath,
        image: await this.image(lcu, 'items', item.id + '.png', item.iconPath) });
    }
    const runeList = [];
    for (const style of (perkstyles && perkstyles.styles) || []) runeList.push({ id: style.id, name: style.name, description: plain(style.tooltip), iconPath: style.iconPath, image: await this.image(lcu, 'runes', style.id + '.png', style.iconPath) });
    for (const perk of perks) if (perk && perk.id && perk.name) runeList.push({ id: perk.id, name: perk.name, description: plain(perk.longDesc || perk.shortDesc), iconPath: perk.iconPath, image: await this.image(lcu, 'runes', perk.id + '.png', perk.iconPath) });
    const spellList = [];
    for (const spell of spells) if (spell && spell.id != null && spell.name) spellList.push({ id: spell.id, name: spell.name, description: plain(spell.description), gameModes: spell.gameModes || [], iconPath: spell.iconPath, image: await this.image(lcu, 'summoner_spells', spell.id + '.png', spell.iconPath) });

    fs.mkdirSync(this.directory, { recursive: true });
    write(path.join(this.directory, 'heroes.json'), heroes);
    write(path.join(this.directory, 'items.json'), itemList);
    write(path.join(this.directory, 'runes.json'), runeList);
    write(path.join(this.directory, 'spells.json'), spellList);
    const meta = { version, fullVersion, locale, syncedAt: new Date().toISOString(), runeLayout: layout, counts: { heroes: heroes.length, items: itemList.length, runes: runeList.length, spells: spellList.length } };
    write(this.metaFile, meta); this.meta = meta;
    return true;
  }
  async hero(lcu, detail, offline) {
    // zh_CN client data names the champion by epithet; the offline catalog keeps the familiar name first.
    const id = Number(detail.id);
    const skill = async (spell, key) => {
      if (!spell) return null;
      const iconName = path.posix.basename(String(spell.abilityIconPath || ''));
      const levels = key === 'r' ? 3 : 5;
      return { spellKey: key, name: spell.name, description: plain(spell.description), iconName, iconPath: spell.abilityIconPath,
        ...(key === 'p' ? {} : { range: burn(spell.range, 1), costburn: burn(spell.costCoefficients, levels), cooldownburn: burn(spell.cooldownCoefficients, levels) }),
        image: await this.image(lcu, key === 'p' ? 'passive' : 'spells', iconName, spell.abilityIconPath) };
    };
    const spells = Array.isArray(detail.spells) ? detail.spells : [];
    const find = key => spells.find(spell => String(spell.spellKey).toLowerCase() === key);
    const chinese = /[一-鿿]/.test(String(detail.name || ''));
    const name = chinese ? detail.title || detail.name : detail.name;
    const title = chinese ? detail.name : detail.title || '';
    return {
      id, name, title, description: title, alias: detail.alias,
      skinLoadScreenPath: offline && offline.skinLoadScreenPath || '', roles: detail.roles || [],
      p: await skill(detail.passive, 'p'), q: await skill(find('q'), 'q'), w: await skill(find('w'), 'w'), e: await skill(find('e'), 'e'), r: await skill(find('r'), 'r'),
      image: await this.image(lcu, 'champions', id + '.png', detail.squarePortraitPath)
    };
  }
}

module.exports = { GameData, runeLayout, burn, plain };
