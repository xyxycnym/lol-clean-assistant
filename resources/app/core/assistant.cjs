'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { LcuClient, liveRequest, parseLockfile } = require('./lcu.cjs');
const { LocalStore, normalizeRune, normalizeItemSet, safeDocument, clone } = require('./store.cjs');
const { GameData } = require('./gamedata.cjs');
const { OpggClient, ROLE_TO_POSITION } = require('./opgg.cjs');
const { predict, assignPositions } = require('./predict.cjs');
const { translate } = require('../renderer/i18n.js');

const ARAM_QUEUES = [450, 2400];
const RIFT_QUEUES = [0, 400, 420, 430, 440, 480, 490, 830, 840, 850];
function analysisMode(queueId) { const id = Number(queueId); return ARAM_QUEUES.includes(id) ? 'aram' : RIFT_QUEUES.includes(id) ? 'ranked' : ''; }

function summonerView(value) {
  if (!value) return null;
  const gameName = value.gameName || value.summonerName || value.displayName || value.name || '';
  const tagLine = value.tagLine || value.gameTag || '';
  return { ...value, gameName, tagLine, displayName: gameName ? gameName + (tagLine ? '#' + tagLine : '') : '匿名玩家' };
}
function normalizeGames(value, puuid) {
  const games = Array.isArray(value) ? value : Array.isArray(value && value.games) ? value.games : value && value.games && Array.isArray(value.games.games) ? value.games.games : [];
  return games.map(game => {
    const identities = game.participantIdentities || [];
    const identity = identities.find(item => item.player && item.player.puuid === puuid);
    const participant = (game.participants || []).find(item => identity && item.participantId === identity.participantId) || (game.participants || [])[0] || {};
    const stats = participant.stats || game.stats || {};
    const rawWin = stats.win === undefined ? game.win : stats.win;
    const hasResult = typeof rawWin === 'boolean' || typeof rawWin === 'string' && ['win', 'true', 'loss', 'lose', 'fail', 'false'].includes(rawWin.toLowerCase());
    return { ...game, championId: participant.championId || game.championId || 0, kills: Number(stats.kills) || 0, deaths: Number(stats.deaths) || 0, assists: Number(stats.assists) || 0,
      win: hasResult ? rawWin === true || typeof rawWin === 'string' && ['win', 'true'].includes(rawWin.toLowerCase()) : undefined, knownResult: hasResult, kda: ((Number(stats.kills) || 0) + (Number(stats.assists) || 0)) / Math.max(1, Number(stats.deaths) || 0),
      duration: Number(game.gameDuration || game.duration) || 0, queueId: Number(game.queueId) || 0, gameId: game.gameId || game.id, stats };
  });
}
function validPuuid(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{2,150}$/.test(value)) throw new Error('该玩家未提供可查询的本区身份'); return value; }
function validId(value) { const id = Number(value); if (!Number.isSafeInteger(id) || id < 0) throw new Error('无效的编号'); return id; }
function rankedView(value) { if (value && value.queues && !Array.isArray(value.queues) && typeof value.queues === 'object') return { ...value, queues: Object.entries(value.queues).map(([queueType, info]) => ({ ...info, queueType: info.queueType || queueType })) }; return value; }
function roleOf(player) {
  const names = { top: 'top', 上: 'top', 上单: 'top', jungle: 'jungle', jug: 'jungle', 打野: 'jungle', 野: 'jungle', middle: 'middle', mid: 'middle', 中: 'middle', 中单: 'middle', bottom: 'bottom', bot: 'bottom', adc: 'bottom', 下: 'bottom', 下路: 'bottom', utility: 'utility', support: 'utility', sup: 'utility', 辅: 'utility', 辅助: 'utility' };
  for (const value of [player.assignedPosition, player.position, player.currentPosition, player.teamPosition]) { const found = names[String(value || '').toLowerCase()]; if (found) return found; }
  return '';
}

class Assistant extends EventEmitter {
  constructor(options) {
    super(); this.assets = options.assets; this.store = new LocalStore(options.dataDirectory);
    this.lcu = options.lcu || new LcuClient({ lockfile: this.store.lockfile }); this.liveReader = options.liveReader || liveRequest;
    this.gameData = options.gameData || new GameData({ assets: this.assets, dataDirectory: options.dataDirectory }); this.opgg = options.opgg || new OpggClient();
    this.syncAttempt = 0; this.analysisKey = ''; this.predictionKey = ''; this.systemLanguage = options.systemLanguage || 'zh-CN';
    this.catalogs = new Map(); this.cache = new Map(); this.running = false; this.stopped = false; this.settingsRevision = 0; this.pollPromise = null; this.phaseSince = Date.now(); this.actionsDone = new Set(); this.lastLive = 0;
    this.state = { connection: { connected: false, phase: 'None', message: '请先打开并登录英雄联盟客户端' }, queueId: null, me: null, teams: { myTeam: [], enemyTeam: [] }, live: null, settings: clone(this.store.settings), actions: [], catalogCounts: {}, gameData: null, systemLanguage: this.systemLanguage, recommendation: null, prediction: null };
    this.state.gameData = this.gameData.info(this.language());
    for (const kind of ['heroes', 'items', 'runes', 'augments', 'chess', 'equip', 'jobs', 'races', 'spells']) { try { this.state.catalogCounts[kind] = this.getCatalog(kind).length; } catch (_) { this.state.catalogCounts[kind] = 0; } }
    if (this.store.message) this.action(this.store.message);
  }
  getCatalog(kind) {
    if (!['heroes', 'items', 'runes', 'augments', 'chess', 'equip', 'jobs', 'races', 'spells'].includes(kind)) throw new Error('无效的资料分类');
    const key = this.language() + ':' + kind;
    if (!this.catalogs.has(key)) {
      const localized = this.gameData.catalog(kind, this.language());
      if (localized) this.catalogs.set(key, localized);
      else { const file = path.join(this.assets, 'json', kind + '.json'); const value = JSON.parse(fs.readFileSync(file, 'utf8')); this.catalogs.set(key, Array.isArray(value) ? value : []); }
    }
    return this.catalogs.get(key);
  }
  snapshot() { return clone(this.state); }
  language() { const chosen = this.state && this.state.settings && this.state.settings.language || (this.store && this.store.settings.language); return chosen || this.systemLanguage; }
  tr(text) { return translate(text, this.language()); }
  getRuneLayout() { return this.gameData.layout(); }
  syncInBackground(force = false) {
    if (this.gameData.syncing) return this.gameData.syncing;
    if (!force && Date.now() - this.syncAttempt < 10 * 60000) return Promise.resolve(false);
    this.syncAttempt = Date.now();
    return this.gameData.sync(this.lcu, force).then(changed => {
      if (changed) {
        this.catalogs.clear(); this.state.gameData = this.gameData.info(this.language());
        for (const kind of Object.keys(this.state.catalogCounts)) { try { this.state.catalogCounts[kind] = this.getCatalog(kind).length; } catch (_) {} }
        this.action('游戏数据已更新到 ' + this.state.gameData.version); this.emit('state', this.snapshot());
      }
      return changed;
    }).catch(error => { if (force) throw error; this.action('游戏数据同步未完成：' + error.message); return false; });
  }
  async syncGameData() { await this.syncInBackground(true); return this.gameData.info(this.language()); }
  opggOptions(mode) { const settings = this.state.settings; return { region: settings.opggRegion, tier: settings.opggTier, mode }; }
  async mainPosition(championId, mode) {
    if (mode === 'aram') return 'none';
    const meta = await this.opgg.meta(this.opggOptions(mode)); const champion = meta.champions[championId];
    return champion && Object.values(champion.positions).sort((a, b) => b.play - a.play).map(item => item.name)[0] || 'MID';
  }
  async getBuild(championId, position, mode) {
    if (!this.state.settings.onlineData) throw new Error('在线数据已关闭，可在工具箱中开启');
    mode = mode === 'aram' ? 'aram' : 'ranked';
    return this.opgg.build(championId, position || await this.mainPosition(Number(championId), mode), this.opggOptions(mode));
  }
  // Recommendation for my own champion, and a draft estimate once both line-ups are complete; both run off the poll loop.
  analyzeInBackground(phase, session) {
    const settings = this.state.settings; const mode = analysisMode(this.state.queueId);
    const active = ['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(phase);
    if (!settings.onlineData || !mode || !active) { this.state.recommendation = null; this.state.prediction = null; this.analysisKey = ''; this.predictionKey = ''; return; }
    const mine = this.state.teams.myTeam || []; const enemy = this.state.teams.enemyTeam || [];
    const local = session ? (session.myTeam || []).find(player => player.cellId === session.localPlayerCellId) : null;
    const own = local || mine.find(player => this.state.me && player.puuid && player.puuid === this.state.me.puuid);
    const ownChampion = own && Number(own.championId || own.championPickIntent) || 0;
    if (ownChampion > 0) {
      const position = mode === 'aram' ? 'none' : ROLE_TO_POSITION[roleOf(own)] || '';
      const key = [mode, ownChampion, position, settings.opggRegion, settings.opggTier].join(':');
      if (key !== this.analysisKey) {
        this.analysisKey = key; this.state.recommendation = { championId: ownChampion, position, mode, loading: true };
        (async () => {
          // Position not assigned (normal draft, custom): use the champion's most played role.
          return this.opgg.build(ownChampion, position || await this.mainPosition(ownChampion, mode), this.opggOptions(mode));
        })().then(build => { if (this.analysisKey === key) { this.state.recommendation = { championId: ownChampion, position: build.position, mode, build }; this.emit('state', this.snapshot()); } })
          .catch(error => { if (this.analysisKey === key) { this.state.recommendation = { championId: ownChampion, position, mode, error: error.message }; this.emit('state', this.snapshot()); } });
      }
    }
    const complete = team => team.length === 5 && team.every(player => Number(player.championId) > 0);
    if (!complete(mine) || !complete(enemy)) { this.state.prediction = null; this.predictionKey = ''; return; }
    const view = player => ({ championId: Number(player.championId), position: mode === 'aram' ? '' : ROLE_TO_POSITION[roleOf(player)] || '', recent: (player.matchHistory || []).slice(0, 10).map(game => game.knownResult ? game.win === true : null) });
    const draft = { mine: mine.map(view), enemy: enemy.map(view) };
    const key = JSON.stringify([mode, settings.opggRegion, settings.opggTier, draft.mine, draft.enemy]);
    if (key === this.predictionKey) return;
    this.predictionKey = key; if (!this.state.prediction || this.state.prediction.error) this.state.prediction = { loading: true };
    (async () => {
      const meta = await this.opgg.meta(this.opggOptions(mode));
      const counters = {};
      if (mode !== 'aram') {
        const positions = assignPositions(draft.mine, meta);
        const builds = await Promise.all(draft.mine.map((player, index) => positions[index] ? this.opgg.build(player.championId, positions[index], this.opggOptions(mode)).catch(() => null) : null));
        builds.forEach((build, index) => { if (build) counters[draft.mine[index].championId] = build.counters; });
      }
      return predict({ ...draft, meta, counters, lanes: mode !== 'aram' });
    })().then(result => { if (this.predictionKey === key) { this.state.prediction = result; this.emit('state', this.snapshot()); } })
      .catch(error => { if (this.predictionKey === key) { this.state.prediction = { error: error.message }; this.emit('state', this.snapshot()); } });
  }
  action(message) { this.state.actions.unshift({ at: new Date().toISOString(), message: String(message).slice(0, 240) }); this.state.actions = this.state.actions.slice(0, 30); }
  saveSettings(value) {
    const before = this.language();
    this.state.settings = this.store.save(value); this.settingsRevision++;
    if (this.language() !== before) { this.state.gameData = this.gameData.info(this.language()); this.analysisKey = ''; }
    this.emit('state', this.snapshot()); return clone(this.state.settings);
  }
  importConfig(value) { this.state.settings = this.store.import(value); this.settingsRevision++; this.emit('state', this.snapshot()); return clone(this.state.settings); }
  chooseLockfile(file) { parseLockfile(file); this.store.setLockfile(file); this.lcu.lockfile = file; this.settingsRevision++; this.lcu.disconnect(); return this.refresh(); }
  async start() { if (this.running) return; this.running = true; this.stopped = false; await this.refresh(); if (!this.running || this.stopped) return; this.timer = setInterval(() => this.refresh().catch(() => {}), 1000); }
  stop() { this.running = false; this.stopped = true; this.settingsRevision++; clearInterval(this.timer); }
  async refresh(force = false) {
    if (this.pollPromise) return this.pollPromise;
    this.pollPromise = this.poll(force).finally(() => { this.pollPromise = null; }); return this.pollPromise;
  }
  async poll(force) {
    try {
      const credentials = await this.lcu.connect(force);
      if (!credentials) {
        this.state.connection = { connected: false, phase: 'None', message: '未发现英雄联盟客户端；打开并登录后会自动连接，也可手动选择 lockfile' };
        this.state.me = null; this.state.teams = { myTeam: [], enemyTeam: [] }; this.state.live = null; this.state.queueId = null;
        this.emit('state', this.snapshot()); return this.snapshot();
      }
      const phase = await this.lcu.request('/lol-gameflow/v1/gameflow-phase');
      if (typeof phase !== 'string') throw new Error('客户端尚未进入可读取状态');
      if (phase !== this.state.connection.phase) { this.phaseSince = Date.now(); this.actionsDone.clear(); }
      this.state.connection = { connected: true, phase, message: '已连接本机英雄联盟客户端' };
      this.syncInBackground();
      const me = await this.lcu.optional('/lol-summoner/v1/current-summoner');
      this.state.me = summonerView(me);
      const ownCache = me && this.cache.get('player:' + (me.puuid || me.summonerId));
      if (this.state.me && ownCache && ownCache.value.rankedInfo) this.state.me.rankedInfo = ownCache.value.rankedInfo;
      let session = null; let flow = null;
      if (phase === 'ChampSelect') [session, flow] = await Promise.all([this.lcu.optional('/lol-champ-select/v1/session'), this.lcu.optional('/lol-gameflow/v1/session')]);
      if (['InProgress', 'GameStart', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].includes(phase)) flow = await this.lcu.optional('/lol-gameflow/v1/session');
      this.state.queueId = (flow && flow.gameData && flow.gameData.queue && flow.gameData.queue.id) ?? (session && session.queueId) ?? null;
      await this.automate(phase, session, flow);
      if (session) {
        this.state.teams = { myTeam: (session.myTeam || []).map(player => this.cachedPlayer(player)), enemyTeam: (session.theirTeam || []).map(player => this.cachedPlayer(player)) };
      } else if (flow && flow.gameData) {
        const first = flow.gameData.teamOne || [], second = flow.gameData.teamTwo || [];
        const ownFirst = first.some(player => player.puuid && me && player.puuid === me.puuid || player.summonerId && me && player.summonerId === me.summonerId);
        this.state.teams = { myTeam: (ownFirst ? first : second).map(player => this.cachedPlayer(player)), enemyTeam: (ownFirst ? second : first).map(player => this.cachedPlayer(player)) };
      } else { this.state.teams = { myTeam: [], enemyTeam: [] }; }
      this.enrichInBackground();
      this.analyzeInBackground(phase, session);
      if (phase === 'InProgress' && Date.now() - this.lastLive > 5000) {
        this.lastLive = Date.now(); try { this.state.live = await this.liveReader(); } catch (_) { this.state.live = null; }
        if (this.state.live && Array.isArray(this.state.live.allPlayers)) { if (!this.state.teams.myTeam.length) this.liveTeams(); else this.mergeLivePlayers(); }
      } else if (phase !== 'InProgress') { this.state.live = null; }
      this.emit('state', this.snapshot()); return this.snapshot();
    } catch (error) {
      this.lcu.disconnect(); this.state.connection = { connected: false, phase: 'None', message: error.message };
      this.state.me = null; this.state.teams = { myTeam: [], enemyTeam: [] }; this.state.live = null; this.state.queueId = null;
      this.emit('state', this.snapshot()); return this.snapshot();
    }
  }
  async enrichTeam(players) {
    // A bounded batch reads only identities that the client itself exposes.
    const output = [];
    for (let index = 0; index < players.length; index += 3) output.push(...await Promise.all(players.slice(index, index + 3).map(player => this.enrichPlayer(player))));
    return output;
  }
  cachedPlayer(player) {
    const id = player.puuid || player.summonerId; const entry = id && this.cache.get('player:' + id); const details = entry && entry.value || {};
    return summonerView({ ...details, ...player, gameName: details.gameName || player.gameName || player.summonerName, tagLine: details.tagLine || player.tagLine,
      position: roleOf(player), rankedInfo: details.rankedInfo || player.rankedInfo, matchHistory: details.matchHistory || player.matchHistory || [] });
  }
  enrichInBackground() {
    if (this.enrichPromise || this.stopped || !this.state.teams.myTeam.length && !this.state.teams.enemyTeam.length) return;
    const teams = this.state.teams; const phase = this.state.connection.phase; const since = this.phaseSince;
    const need = [...teams.myTeam, ...teams.enemyTeam].some(player => { const id = player.puuid || player.summonerId; const cached = id && this.cache.get('player:' + id); return id && (!cached || Date.now() - cached.at > 60000); });
    if (!need) return;
    this.enrichPromise = Promise.all([this.enrichTeam(teams.myTeam), this.enrichTeam(teams.enemyTeam)]).then(() => {
      if (this.stopped || this.state.connection.phase !== phase || this.phaseSince !== since) return;
      this.state.teams = { myTeam: this.state.teams.myTeam.map(player => this.cachedPlayer(player)), enemyTeam: this.state.teams.enemyTeam.map(player => this.cachedPlayer(player)) };
      const own = this.state.me && this.state.teams.myTeam.find(player => player.puuid === this.state.me.puuid);
      if (own && own.rankedInfo) this.state.me.rankedInfo = own.rankedInfo;
      this.emit('state', this.snapshot());
    }).catch(() => {}).finally(() => { this.enrichPromise = null; });
  }
  async enrichPlayer(player) {
    const id = player.puuid || player.summonerId;
    const previous = id && this.cache.get('player:' + id);
    let details = previous && Date.now() - previous.at < 60000 ? previous.value : null;
    if (!details && id) {
      const info = player.puuid ? await this.lcu.optional('/lol-summoner/v2/summoners/puuid/' + encodeURIComponent(player.puuid)) : await this.lcu.optional('/lol-summoner/v1/summoners/' + validId(player.summonerId));
      details = summonerView(info || player);
      if (details.puuid) {
        const [rank, history] = await Promise.all([this.lcu.optional('/lol-ranked/v1/ranked-stats/' + encodeURIComponent(details.puuid)), this.lcu.optional('/lol-match-history/v1/products/lol/' + encodeURIComponent(details.puuid) + '/matches?begIndex=0&endIndex=9')]);
        details.rankedInfo = rankedView(rank); details.matchHistory = history ? normalizeGames(history, details.puuid) : [];
      }
      this.cache.set('player:' + id, { at: Date.now(), value: details });
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
    }
    return summonerView({ ...(details || {}), ...player, gameName: details && details.gameName || player.gameName || player.summonerName,
      tagLine: details && details.tagLine || player.tagLine, position: roleOf(player), rankedInfo: details && details.rankedInfo, matchHistory: details && details.matchHistory || [] });
  }
  liveTeams() {
    const heroes = this.getCatalog('heroes'); const currentName = this.state.live.activePlayer && this.state.live.activePlayer.summonerName;
    const own = this.state.live.allPlayers.find(player => player.summonerName === currentName);
    const view = player => summonerView({ gameName: player.riotIdGameName || player.summonerName, tagLine: player.riotIdTagLine || '', championId: (heroes.find(hero => hero.name === player.championName || hero.alias === player.championName) || {}).id || 0, position: roleOf(player), scores: player.scores, championName: player.championName, live: true, matchHistory: [] });
    this.state.teams = { myTeam: this.state.live.allPlayers.filter(player => player.team === (own && own.team || 'ORDER')).map(view), enemyTeam: this.state.live.allPlayers.filter(player => player.team !== (own && own.team || 'ORDER')).map(view) };
  }
  mergeLivePlayers() {
    const players = this.state.live.allPlayers;
    const merge = player => {
      const riotId = (player.gameName || player.summonerName || '') + (player.tagLine ? '#' + player.tagLine : '');
      const matches = players.filter(live => (live.riotId || (live.riotIdGameName ? live.riotIdGameName + (live.riotIdTagLine ? '#' + live.riotIdTagLine : '') : live.summonerName)) === riotId);
      if (matches.length !== 1) return player;
      const live = matches[0]; return { ...player, position: roleOf(live) || player.position, scores: live.scores, championName: live.championName };
    };
    this.state.teams = { myTeam: this.state.teams.myTeam.map(merge), enemyTeam: this.state.teams.enemyTeam.map(merge) };
  }
  async getHistory(puuid, begin = 0) {
    validPuuid(puuid); begin = Math.max(0, Math.min(990, Math.floor(Number(begin) || 0)));
    const raw = await this.lcu.request('/lol-match-history/v1/products/lol/' + encodeURIComponent(puuid) + '/matches?begIndex=' + begin + '&endIndex=' + (begin + 19));
    return { games: normalizeGames(raw, puuid), begin, end: begin + 19, summoner: summonerView(await this.lcu.optional('/lol-summoner/v2/summoners/puuid/' + encodeURIComponent(puuid))) };
  }
  async searchSummoner(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100) throw new Error('请输入本区玩家名称或名称#标签');
    const summoner = summonerView(await this.lcu.request('/lol-summoner/v1/summoners?name=' + encodeURIComponent(query.trim())));
    if (!summoner || !summoner.puuid) throw new Error('本区客户端没有返回该玩家，请检查名称和标签');
    const [rankedInfo, history] = await Promise.all([this.lcu.optional('/lol-ranked/v1/ranked-stats/' + encodeURIComponent(summoner.puuid)), this.getHistory(summoner.puuid)]);
    return { summoner, rankedInfo: rankedView(rankedInfo), history };
  }
  async getMatch(id) { return this.lcu.request('/lol-match-history/v1/games/' + validId(id)); }
  async automate(phase, session, flow) {
    const settings = this.state.settings; const elapsed = (Date.now() - this.phaseSince) / 1000;
    const revision = this.settingsRevision;
    const stillEnabled = () => !this.stopped && revision === this.settingsRevision;
    const once = async (key, task, message) => {
      if (this.actionsDone.has(key) || !stillEnabled()) return;
      try {
        if (await this.lcu.request('/lol-gameflow/v1/gameflow-phase') !== phase || !stillEnabled()) return;
        if (await task() === false || !stillEnabled()) return;
        this.actionsDone.add(key); this.action(message);
      }
      catch (error) { const errKey = 'error:' + key; if (!this.actionsDone.has(errKey)) { this.actionsDone.add(errKey); this.action(message + '未完成：' + error.message); } }
    };
    if (phase === 'ReadyCheck' && settings.autoAccept && elapsed >= settings.acceptDelaySec) await once('accept', () => this.lcu.request('/lol-matchmaking/v1/ready-check/accept', 'POST'), '已接受匹配确认');
    if (phase === 'Lobby' && settings.autoStart && elapsed >= settings.startDelaySec) {
      const lobby = await this.lcu.optional('/lol-lobby/v2/lobby');
      if (lobby && lobby.localMember && lobby.localMember.isLeader === true) await once('start', () => this.lcu.request('/lol-lobby/v2/lobby/matchmaking/search', 'POST'), '已开始匹配');
    }
    if (phase === 'EndOfGame' && settings.autoAgain && elapsed >= settings.againDelaySec) await once('again', () => this.lcu.request('/lol-lobby/v2/play-again', 'POST'), '已返回再来一局房间');
    if (phase !== 'ChampSelect' || !session || (!settings.autoPick && !settings.autoBan)) return;
    const me = (session.myTeam || []).find(player => player.cellId === session.localPlayerCellId);
    if (!me) return;
    const role = roleOf(me);
    const gameFlow = flow || await this.lcu.optional('/lol-gameflow/v1/session');
    const queueId = gameFlow && gameFlow.gameData && gameFlow.gameData.queue && gameFlow.gameData.queue.id;
    const key = Number(queueId) === 450 ? 'aram' : role;
    const actions = (session.actions || []).flat().filter(action => action.actorCellId === session.localPlayerCellId && action.isInProgress && !action.completed);
    for (const action of actions) {
      const isBan = action.type === 'ban'; if (isBan ? !settings.autoBan : !settings.autoPick) continue;
      const timer = session.timer || {};
      if ((isBan ? settings.banAtLastSecond : settings.pickAtLastSecond) && Number(timer.adjustedTimeLeftInPhase) > 2200) continue;
      const list = (isBan ? settings.bans : settings.picks)[key] || [];
      const candidates = list.length ? list : (isBan ? settings.bans : settings.picks).default;
      if (!candidates.length) continue;
      const available = await this.lcu.optional('/lol-champ-select/v1/' + (isBan ? 'bannable' : 'pickable') + '-champion-ids');
      if (!Array.isArray(available)) continue;
      const hovered = new Set((session.myTeam || []).filter(player => player.cellId !== session.localPlayerCellId).map(player => player.championPickIntent || player.championId).filter(Boolean));
      const id = candidates.find(id => (id === -1 && isBan || available.includes(id)) && !(isBan && settings.avoidTeamHover && hovered.has(id)));
      if (id === undefined) continue;
      const completed = isBan || !settings.pickHoverOnly;
      await once((isBan ? 'ban:' : 'pick:') + action.id + ':' + id + ':' + completed, async () => {
        const fresh = await this.lcu.request('/lol-champ-select/v1/session');
        const currentAction = (fresh.actions || []).flat().find(item => item.id === action.id && item.actorCellId === fresh.localPlayerCellId && item.isInProgress && !item.completed);
        if (!currentAction || !stillEnabled()) return false;
        if ((isBan ? settings.banAtLastSecond : settings.pickAtLastSecond) && Number((fresh.timer || {}).adjustedTimeLeftInPhase) > 2200) return false;
        return this.lcu.request('/lol-champ-select/v1/session/actions/' + validId(action.id), 'PATCH', { championId: id, completed });
      }, (isBan ? '已禁用 ' : completed ? '已选用 ' : '已预选 ') + (id === -1 ? '空禁用' : (this.getCatalog('heroes').find(hero => hero.id === id) || {}).name || id));
    }
  }
  async applyRune(value) {
    const preset = normalizeRune(value);
    const body = { name: preset.name, primaryStyleId: preset.primaryStyleId, subStyleId: preset.subStyleId, selectedPerkIds: preset.selectedPerkIds, current: true };
    const current = await this.lcu.optional('/lol-perks/v1/currentpage');
    if (current && current.isEditable === true && current.id > 0) await this.lcu.request('/lol-perks/v1/pages/' + validId(current.id), 'PUT', { ...body, id: current.id });
    else await this.lcu.request('/lol-perks/v1/pages', 'POST', body);
    this.action('已应用本地符文：' + preset.name); return { applied: true, name: preset.name };
  }
  async applySpells(value) {
    safeDocument(value); const allowed = new Set(this.getCatalog('spells').map(spell => Number(spell.id)));
    if (!allowed.has(Number(value.spell1Id)) || !allowed.has(Number(value.spell2Id)) || Number(value.spell1Id) === Number(value.spell2Id)) throw new Error('请选择两项不同的召唤师技能');
    if (this.state.connection.phase !== 'ChampSelect') throw new Error('召唤师技能需要在选人界面应用');
    await this.lcu.request('/lol-champ-select/v1/session/my-selection', 'PATCH', { spell1Id: Number(value.spell1Id), spell2Id: Number(value.spell2Id) });
    this.action('已设置召唤师技能'); return { applied: true };
  }
  async applyItemSet(value) {
    const preset = normalizeItemSet(value); const allowed = new Set(this.getCatalog('items').map(item => Number(item.id)));
    if (preset.items.some(id => !allowed.has(id))) throw new Error('配装包含本地资料中不存在的装备');
    const me = this.state.me || summonerView(await this.lcu.request('/lol-summoner/v1/current-summoner'));
    const endpoint = '/lol-item-sets/v1/item-sets/' + validId(me.summonerId) + '/sets';
    const existing = await this.lcu.request(endpoint);
    if (!existing || !Array.isArray(existing.itemSets)) throw new Error('客户端出装数据格式不匹配，已保留原配装');
    const uid = 'clean-local-' + preset.id;
    const itemSet = { uid, title: preset.name, type: 'custom', map: 'any', mode: 'any', associatedChampions: preset.championId ? [preset.championId] : [], associatedMaps: [], blocks: [{ type: this.tr('本地配装'), items: preset.items.map(id => ({ id: String(id), count: 1 })) }] };
    const sets = existing.itemSets.filter(item => item.uid !== uid); sets.push(itemSet);
    await this.lcu.request(endpoint, 'PUT', { ...existing, itemSets: sets });
    this.action('已应用本地配装：' + preset.name); return { applied: true };
  }
  async applyBuildItems(value) {
    safeDocument(value);
    const championId = Number(value.championId); if (!Number.isSafeInteger(championId) || championId < 0 || championId > 100000) throw new Error('无效的英雄');
    const blocks = (Array.isArray(value.blocks) ? value.blocks : []).slice(0, 8)
      .map(block => ({ type: String(block.type || '装备').slice(0, 40), items: (Array.isArray(block.items) ? block.items : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && id < 1000000).slice(0, 12) }))
      .filter(block => block.items.length);
    if (!blocks.length) throw new Error('推荐出装为空');
    const me = this.state.me || summonerView(await this.lcu.request('/lol-summoner/v1/current-summoner'));
    const endpoint = '/lol-item-sets/v1/item-sets/' + validId(me.summonerId) + '/sets';
    const existing = await this.lcu.request(endpoint);
    if (!existing || !Array.isArray(existing.itemSets)) throw new Error('客户端出装数据格式不匹配，已保留原配装');
    const uid = 'clean-opgg-' + championId; const title = String(value.title || 'OP.GG 推荐').slice(0, 60);
    const itemSet = { uid, title, type: 'custom', map: 'any', mode: 'any', associatedChampions: championId ? [championId] : [], associatedMaps: [], blocks: blocks.map(block => ({ type: block.type, items: block.items.map(id => ({ id: String(id), count: 1 })) })) };
    await this.lcu.request(endpoint, 'PUT', { ...existing, itemSets: [...existing.itemSets.filter(item => item.uid !== uid), itemSet] });
    this.action('已导入推荐出装：' + title); return { applied: true };
  }
  async createLobby(queueId) {
    const id = Number(queueId); if (![400, 420, 430, 440, 450, 490, 700, 900, 1020, 1090, 1100, 1130, 1160, 1300].includes(id)) throw new Error('暂不支持这个房间类型');
    await this.lcu.request('/lol-lobby/v2/lobby', 'POST', { queueId: id }); this.action('已创建客户端房间'); return { created: true };
  }
  async setProfile(value) {
    safeDocument(value);
    if (!['', 'chat', 'away', 'dnd', 'offline'].includes(value.availability)) throw new Error('无效的在线状态');
    if (typeof value.statusMessage !== 'string' || value.statusMessage.length > 200) throw new Error('签名最多 200 字');
    let availability = value.availability;
    if (!availability) { const current = await this.lcu.request('/lol-chat/v1/me'); availability = current && current.availability; if (!['chat', 'away', 'dnd', 'offline'].includes(availability)) throw new Error('无法读取当前在线状态，请手动选择状态'); }
    await this.lcu.request('/lol-chat/v1/me', 'PUT', { availability, statusMessage: value.statusMessage }); this.action('已更新客户端在线状态与签名'); return { applied: true };
  }
  async getClientSettings() {
    const game = await this.lcu.request('/lol-game-settings/v1/game-settings');
    const input = await this.lcu.request('/lol-game-settings/v1/input-settings');
    this.saveSettings({ clientProfiles: { game, input } }); return { game, input };
  }
  async saveClientSettings(value) {
    if (!value || !['game', 'input'].includes(value.kind) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('请选择游戏或按键配置，并提供 JSON 对象');
    safeDocument(value.data); if (Buffer.byteLength(JSON.stringify(value.data)) > 200000) throw new Error('配置内容过大');
    await this.lcu.request('/lol-game-settings/v1/' + (value.kind === 'game' ? 'game-settings' : 'input-settings'), 'PATCH', value.data); this.action('已保存客户端' + (value.kind === 'game' ? '游戏' : '按键') + '配置'); return { applied: true };
  }
}
module.exports = { Assistant, summonerView, normalizeGames, validPuuid, roleOf, rankedView };
