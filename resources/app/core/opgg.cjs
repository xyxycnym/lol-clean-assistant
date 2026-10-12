'use strict';
const https = require('https');

// The only outside host this program talks to. Requests are built from validated parts, never from free text.
const HOST = 'lol-api-champion.op.gg';
const REGIONS = ['global', 'kr', 'na', 'euw', 'eune', 'jp', 'br', 'lan', 'las', 'oce', 'tr', 'ru', 'sg', 'tw', 'vn', 'th', 'ph'];
const TIERS = ['all', 'gold_plus', 'platinum_plus', 'emerald_plus', 'diamond_plus', 'master_plus'];
const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const ROLE_TO_POSITION = { top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', utility: 'SUPPORT' };
const POSITION_TO_ROLE = Object.fromEntries(Object.entries(ROLE_TO_POSITION).map(([role, position]) => [position, role]));
const TTL = 3 * 3600 * 1000;

function fetchJson(pathname, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: HOST, path: pathname, agent: false, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 LeagueLocalAssistant' } }, response => {
      const status = response.statusCode || 0;
      if (status !== 200) { response.resume(); reject(new Error(status === 404 ? 'OP.GG 暂无这项数据' : 'OP.GG 暂不可用（' + status + '）')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 6291456) { response.destroy(); reject(new Error('OP.GG 响应过大')); } else chunks.push(chunk); });
      response.on('error', () => reject(new Error('OP.GG 响应中断')));
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('OP.GG 返回的数据格式不正确')); } });
    });
    request.setTimeout(timeout, () => request.destroy(new Error('OP.GG 响应超时')));
    request.on('error', error => reject(new Error(error.message === 'OP.GG 响应超时' ? error.message : '无法连接 OP.GG，请检查网络')));
  });
}

function options(value = {}) {
  const region = REGIONS.includes(value.region) ? value.region : 'global';
  const tier = TIERS.includes(value.tier) ? value.tier : 'emerald_plus';
  const mode = value.mode === 'aram' ? 'aram' : 'ranked';
  return { region, tier, mode };
}
function rate(win, play) { return play > 0 ? win / play : null; }
function entry(item) { return { ids: (item.ids || []).map(Number).filter(Number.isFinite), play: Number(item.play) || 0, winRate: rate(Number(item.win) || 0, Number(item.play) || 0), pickRate: Number(item.pick_rate) || 0 }; }
function positionStats(position) { const s = position.stats || {}; return { name: position.name, play: Number(s.play) || 0, winRate: Number(s.win_rate) || null, roleRate: Number(s.role_rate) || 0, tier: s.tier_data && s.tier_data.tier, rank: s.tier_data && s.tier_data.rank }; }

function normalizeBuild(data, championId, position, opts, version) {
  const summary = data.summary || {}; const average = summary.average_stats || {};
  const positions = (summary.positions || []).map(positionStats);
  const current = positions.find(item => item.name === position);
  const runes = (data.runes || []).slice(0, 3).map(page => ({
    primaryStyleId: Number(page.primary_page_id), subStyleId: Number(page.secondary_page_id),
    selectedPerkIds: [...(page.primary_rune_ids || []), ...(page.secondary_rune_ids || []), ...(page.stat_mod_ids || [])].map(Number),
    play: Number(page.play) || 0, winRate: rate(Number(page.win) || 0, Number(page.play) || 0), pickRate: Number(page.pick_rate) || 0
  })).filter(page => page.selectedPerkIds.length === 9);
  const masteries = (data.skill_masteries || [])[0];
  const skill = (data.skills || [])[0];
  return {
    championId, position, ...opts, version,
    stats: { play: current ? current.play : Number(average.play) || 0, winRate: current ? current.winRate : Number(average.win_rate) || null,
      pickRate: Number(average.pick_rate) || 0, banRate: Number(average.ban_rate) || 0, kda: Number(average.kda) || 0,
      tier: current ? current.tier : average.tier_data && average.tier_data.tier, rank: current ? current.rank : average.tier_data && average.tier_data.rank },
    positions, runes,
    spells: (data.summoner_spells || []).slice(0, 3).map(entry),
    starter: (data.starter_items || []).slice(0, 2).map(entry),
    core: (data.core_items || []).slice(0, 3).map(entry),
    boots: (data.boots || []).slice(0, 2).map(entry),
    last: (data.last_items || []).slice(0, 8).map(entry),
    skills: { masteries: masteries ? masteries.ids : [], order: skill ? skill.order : [], winRate: skill ? rate(Number(skill.win) || 0, Number(skill.play) || 0) : null, pickRate: skill ? Number(skill.pick_rate) || 0 : 0 },
    counters: (data.counters || []).map(item => ({ championId: Number(item.champion_id), play: Number(item.play) || 0, win: Number(item.win) || 0 }))
  };
}

function normalizeMeta(list, opts, version) {
  const champions = {};
  for (const item of Array.isArray(list) ? list : []) {
    const average = item.average_stats || {};
    champions[item.id] = { play: Number(average.play) || 0, winRate: Number(average.win_rate) || null, positions: Object.fromEntries((item.positions || []).map(position => [position.name, positionStats(position)])) };
  }
  return { ...opts, version, champions };
}

class OpggClient {
  constructor(options = {}) { this.fetch = options.fetch || fetchJson; this.cache = new Map(); this.pending = new Map(); }
  cached(key, loader) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = loader().then(value => {
      this.cache.set(key, { at: Date.now(), value });
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise); return promise;
  }
  build(championId, position, value) {
    const id = Number(championId); if (!Number.isSafeInteger(id) || id <= 0 || id > 100000) return Promise.reject(new Error('无效的英雄'));
    const opts = options(value);
    const pos = opts.mode === 'aram' ? 'none' : POSITIONS.includes(position) ? position : '';
    if (!pos) return Promise.reject(new Error('无效的分路'));
    const path = opts.mode === 'aram' ? `/api/${opts.region}/champions/aram/${id}/none` : `/api/${opts.region}/champions/ranked/${id}/${pos}?tier=${opts.tier}`;
    return this.cached('build:' + path, async () => { const result = await this.fetch(path); return normalizeBuild(result.data || {}, id, pos, opts, result.meta && result.meta.version || ''); });
  }
  meta(value) {
    const opts = options(value);
    const path = opts.mode === 'aram' ? `/api/${opts.region}/champions/aram?tier=all` : `/api/${opts.region}/champions/ranked?tier=${opts.tier}`;
    return this.cached('meta:' + path, async () => { const result = await this.fetch(path); return normalizeMeta(result.data, opts, result.meta && result.meta.version || ''); });
  }
}

module.exports = { OpggClient, normalizeBuild, normalizeMeta, options, REGIONS, TIERS, POSITIONS, ROLE_TO_POSITION, POSITION_TO_ROLE, HOST };
