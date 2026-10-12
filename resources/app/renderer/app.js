'use strict';

(() => {
  const api = window.cleanAssistant;
  const content = document.getElementById('content');
  const dialog = document.getElementById('detail-dialog');
  const catalogKinds = [
    ['heroes', '英雄'], ['items', '装备'], ['runes', '符文'], ['spells', '召唤师技能'],
    ['augments', '海克斯'], ['chess', '云顶棋子'], ['equip', '云顶装备'], ['races', '种族'], ['jobs', '职业']
  ];
  const roles = [['default', '通用'], ['top', '上路'], ['jungle', '打野'], ['middle', '中路'], ['bottom', '下路'], ['utility', '辅助'], ['aram', '大乱斗']];
  let paths = [[8000, '精密'], [8100, '主宰'], [8200, '巫术'], [8400, '坚决'], [8300, '启迪']];
  let shardGroups = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
  let runeGroups = {
    8000: [[8005, 8008, 8021, 8010], [9101, 9111, 8009], [9104, 9105, 9103], [8014, 8017, 8299]],
    8100: [[8112, 8128, 9923], [8126, 8139, 8143], [8140, 8137, 8141], [8135, 8105, 8106]],
    8200: [[8214, 8229, 8230], [8224, 8226, 8275], [8210, 8234, 8233], [8237, 8232, 8236]],
    8400: [[8437, 8439, 8465], [8446, 8463, 8401], [8429, 8444, 8473], [8451, 8453, 8242]],
    8300: [[8351, 8360, 8369], [8306, 8304, 8321], [8313, 8352, 8345], [8347, 8410, 8316]]
  };
  const spellNames = {1: '净化', 3: '虚弱', 4: '闪现', 6: '幽灵疾步', 7: '治疗术', 11: '惩戒', 12: '传送', 13: '清晰术', 14: '引燃', 21: '屏障', 30: '魄罗投掷', 31: '魄罗冲刺', 32: '标记', 39: '冲刺', 54: '占位技能', 55: '占位技能'};
  const phaseNames = {None: '客户端空闲', Lobby: '游戏房间', Matchmaking: '正在匹配', ReadyCheck: '等待确认', ChampSelect: '英雄选择', GameStart: '游戏启动', InProgress: '对局进行中', WaitingForStats: '等待结算', PreEndOfGame: '对局结束', EndOfGame: '赛后结算', Reconnect: '等待重连', TerminatedInError: '游戏异常退出'};
  const queueNames = {0: '自定义', 400: '征召匹配', 420: '单双排位', 430: '匹配', 440: '灵活排位', 450: '极地大乱斗', 480: '快速模式', 490: '快速匹配', 700: '冠军杯赛', 830: '人机入门', 840: '人机简单', 850: '人机一般', 900: '无限乱斗', 1020: '克隆大作战', 1090: '云顶匹配', 1100: '云顶排位', 1130: '云顶狂暴', 1160: '云顶双人', 1700: '斗魂竞技场', 1900: '无限火力', 2400: '海克斯大乱斗'};
  const tierNames = {CHALLENGER: '最强王者', GRANDMASTER: '傲世宗师', MASTER: '超凡大师', DIAMOND: '钻石', EMERALD: '翡翠', PLATINUM: '铂金', GOLD: '黄金', SILVER: '白银', BRONZE: '黄铜', IRON: '黑铁', NONE: '未定级'};
  const defaults = {
    autoAccept: false, acceptDelaySec: 0, autoStart: false, startDelaySec: 8,
    autoAgain: false, againDelaySec: 8, autoPick: false, autoBan: false,
    pickHoverOnly: true, pickAtLastSecond: false, banAtLastSecond: false, avoidTeamHover: true,
    picks: Object.fromEntries(roles.map(([key]) => [key, []])), bans: Object.fromEntries(roles.map(([key]) => [key, []])), runePresets: [], itemSets: []
  };
  let state = {connection: {connected: false, message: '正在读取客户端状态', phase: ''}, me: null, teams: {myTeam: [], enemyTeam: []}, settings: clone(defaults), actions: [], catalogCounts: {}};
  let page = 'dashboard';
  let ready = false;
  let loadError = '';
  const catalogs = new Map();
  const catalogPromises = new Map();
  let catalogKind = 'heroes';
  let catalogQuery = '';
  let catalogPage = 0;
  let catalogSelectedId = '';
  let autoDraft = null;
  let autoDirty = false;
  let autoType = 'picks';
  let autoRole = 'default';
  let autoBusy = false;
  let autoPending = null;
  let autoFeedback = '';
  const autoSwitches = ['autoAccept', 'autoStart', 'autoAgain', 'autoPick', 'autoBan', 'pickHoverOnly', 'pickAtLastSecond', 'banAtLastSecond', 'avoidTeamHover'];
  let boardSignature = '';
  let activitySignature = '';
  let presetKind = 'rune';
  let runeDraft = null;
  let itemDraft = null;
  let itemQuery = '';
  let history = {summoner: null, rankedInfo: null, games: [], begin: 0, end: 0, loading: false, searched: false, query: '', error: ''};
  let historyFilters = {result: 'all', queue: 'all', hero: 'all'};
  let clientDraft = {game: '', input: ''};
  let clientKind = 'game';
  let clientRead = false;
  let clientDirty = false;
  let clientAdvancedOpen = false;
  let buildPage = {championId: '', position: '', mode: 'ranked', build: null, loading: false, error: ''};
  let dataVersion = '';
  const positionNames = {TOP: '上路', JUNGLE: '打野', MID: '中路', ADC: '下路', SUPPORT: '辅助', none: '大乱斗'};
  const roleToPosition = {top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', utility: 'SUPPORT'};
  const tierOptions = [['all', '全部段位'], ['gold_plus', '黄金+'], ['platinum_plus', '铂金+'], ['emerald_plus', '翡翠+'], ['diamond_plus', '钻石+'], ['master_plus', '大师+']];
  const regionOptions = [['global', '全球'], ['kr', '韩服'], ['na', '北美'], ['euw', '西欧'], ['eune', '北欧东欧'], ['jp', '日服'], ['tw', '台服'], ['vn', '越南'], ['sg', '新加坡'], ['br', '巴西'], ['tr', '土耳其'], ['ru', '俄罗斯'], ['oce', '大洋洲'], ['lan', '拉美北'], ['las', '拉美南'], ['th', '泰国'], ['ph', '菲律宾']];
  let unsubscribe;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char])); }
  function plain(value) { return String(value == null ? '' : value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }
  function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
  function formatNumber(value) { return Math.round(number(value)).toLocaleString('zh-CN'); }
  function checked(value) { return value ? ' checked' : ''; }
  function connected() { return !!state.connection.connected; }
  function disabledClient() { return ` data-requires-client="true"${connected() ? '' : ' disabled title="连接游戏客户端后可使用"'}`; }
  function labelOf(kind) { return (catalogKinds.find(item => item[0] === kind) || ['', kind])[1]; }
  function imagePath(value) {
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value || ''))) return String(value);
    const path = String(value || '').replace(/\\/g, '/');
    return /^(?:\.\/)?assets\/images\/[A-Za-z0-9_./ -]+\.(?:png|jpe?g|webp|svg)$/i.test(path) && !path.split('/').includes('..') ? path : './assets/images/none.png';
  }
  function imageTag(src, alt = '', className = 'portrait') { return `<img src="${esc(imagePath(src))}" alt="${esc(alt)}" class="${className}" loading="lazy">`; }
  function catalogId(item) { return item.id != null ? item.id : item.championId != null ? item.championId : item.chessId != null ? item.chessId : item.equipId != null ? item.equipId : item.raceId != null ? item.raceId : item.jobId; }
  function itemName(item) { return item.displayName || item.name || item.title || `编号 ${catalogId(item)}`; }
  function findCatalog(kind, id) { return (catalogs.get(kind) || []).find(item => String(catalogId(item)) === String(id)); }
  function heroName(id) { return id == -1 ? '空禁用' : itemName(findCatalog('heroes', id) || {id, name: id ? `英雄 ${id}` : '待选择英雄'}); }
  function heroImage(id) { return (findCatalog('heroes', id) || {}).image; }
  function heroArt(id) { const hero = findCatalog('heroes', id); return hero && /^\d+\/\d+\.jpg$/.test(String(hero.skinLoadScreenPath || '')) ? `./assets/images/skins/${hero.skinLoadScreenPath}` : ''; }
  function artTag(id, className) { const art = heroArt(id); return art ? `<img src="${esc(imagePath(art))}" alt="" class="${className}" data-art="true" aria-hidden="true" loading="lazy">` : ''; }
  function kdaClass(value) { return value == null ? '' : value >= 4 ? ' kda-high' : value < 2 ? ' kda-low' : ''; }
  function playerName(player) {
    if (!player) return '匿名玩家';
    if (player.displayName) return player.displayName;
    const name = player.gameName || player.summonerName || player.name;
    return name ? `${name}${player.tagLine ? `#${player.tagLine}` : ''}` : '匿名玩家';
  }
  function rankText(info) {
    if (!info) return '暂无段位信息';
    const queues = Array.isArray(info.queues) ? info.queues : info.queues && typeof info.queues === 'object' ? Object.entries(info.queues).map(([queueType, item]) => ({...item, queueType})) : [];
    const rank = info.rankedSolo5x5 || info.RANKED_SOLO_5x5 || queues.find(entry => entry.queueType === 'RANKED_SOLO_5x5') || (info.tier ? info : null);
    if (!rank || !rank.tier || rank.tier === 'NONE') return '单双排未定级';
    return `${tierNames[rank.tier] || rank.tier}${rank.division || rank.rank ? ` ${rank.division || rank.rank}` : ''}${rank.leaguePoints != null ? ` · ${rank.leaguePoints} LP` : ''}`;
  }
  function queueName(id) { return queueNames[id] || (id ? `游戏队列 ${id}` : '未知模式'); }
  function duration(value) { const seconds = Math.max(0, Math.floor(number(value))); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  function dateText(value, short = false) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', short ? {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false} : {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
  }
  function settingsValue() { return Object.assign(clone(defaults), state.settings || {}); }
  function hydrateClientDraft() {
    const profiles = state.settings && state.settings.clientProfiles;
    if (!profiles || typeof profiles !== 'object') return;
    for (const kind of ['game', 'input']) {
      if (profiles[kind] && typeof profiles[kind] === 'object' && !Array.isArray(profiles[kind])) {
        clientDraft[kind] = JSON.stringify(profiles[kind], null, 2);
        clientRead = true;
      }
    }
  }
  function icon(name, className = '') {
    const shapes = {table:'M4 5h16v14H4zM4 10h16M10 10v9', book:'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', preset:'m12 3 8 9-8 9-8-9zM8 12h8M12 8v8', settings:'M4 7h16M4 17h16M8 4v6M16 14v6', up:'m6 14 6-6 6 6', down:'m6 10 6 6 6-6', close:'m6 6 12 12M6 18 18 6'};
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="${className}"><path d="${shapes[name] || shapes.table}"/></svg>`;
  }
  function heading(title, eyebrow, text, action = '') { return `<div class="page-heading${page === 'dashboard' ? ' board-heading' : ''}"><div><h1>${esc(title)}</h1>${text?`<p>${esc(text)}</p>`:''}</div>${action}</div>`; }
  function empty(title, text) { return `<div class="empty-state">${icon('table', 'empty-icon')}<strong>${esc(title)}</strong>${text?`<p>${esc(text)}</p>`:''}</div>`; }
  function offlineNotice() { return connected() ? '' : `<div class="notice"><strong>尚未连接英雄联盟客户端</strong><p>${esc(state.connection.message || '请先打开并登录游戏客户端。')}</p></div>`; }
  function toast(message, error = false) {
    const node = document.createElement('div');
    node.className = `toast${error ? ' error' : ''}`;
    node.textContent = String(message || '操作完成').slice(0, 350);
    document.getElementById('toast-region').append(node);
    setTimeout(() => node.remove(), error ? 6500 : 3500);
  }
  async function invoke(method, ...args) {
    if (!api || typeof api[method] !== 'function') throw new Error('请通过纯净版桌面启动器打开本地助手。');
    const result = await api[method](...args);
    if (!result || result.ok !== true) throw new Error(typeof (result && result.error) === 'string' ? result.error : (result && result.error && result.error.message) || '操作未能完成，请稍后重试。');
    return result.data;
  }
  async function buttonTask(button, callback) {
    const wasDisabled = button && button.disabled;
    if (button) { button.disabled = true; button.dataset.busy = 'true'; }
    try { return await callback(); } catch (error) { toast(error.message || '操作失败', true); } finally {
      if (button) delete button.dataset.busy;
      if (button && button.isConnected) button.disabled = button.dataset.requiresClient ? !connected() || (button.dataset.action === 'client-save' && !clientRead) : wasDisabled;
    }
  }
  function ingest(next) {
    if (next && next.ok === true) next = next.data;
    if (!next || !next.connection) return;
    state = Object.assign({}, state, next);
    state.connection = Object.assign({connected: false, message: '', phase: ''}, next.connection);
    state.teams = next.teams || {myTeam: [], enemyTeam: []};
    state.settings = next.settings || state.settings;
    const version = state.gameData && state.gameData.version || '';
    if (dataVersion && version && version !== dataVersion) reloadGameData();
    dataVersion = version || dataVersion;
    ready = true;
    loadError = '';
    updateHeader();
    if (page === 'dashboard') updateDashboard();
    if (page === 'automation') updateAutoState();
  }
  function updateHeader() {
    document.getElementById('connection-dot').classList.toggle('connected', connected());
    document.getElementById('connection-label').textContent = connected() ? '已连接本机客户端' : '未连接游戏客户端';
    document.getElementById('connection-label').title = state.connection.message || '';
    document.getElementById('phase-label').textContent = connected() && state.connection.phase ? phaseNames[state.connection.phase] || '客户端已连接' : '';
    document.querySelectorAll('[data-requires-client]').forEach(button => {
      if (!button.dataset.busy) button.disabled = !connected() || (button.dataset.action === 'client-save' && !clientRead) || (button.type === 'submit' && button.closest('#history-form') && history.loading);
      if (connected()) button.removeAttribute('title'); else button.title = '连接游戏客户端后可使用';
    });
  }
  async function reloadState() { ingest(await invoke('getState')); }
  async function loadRuneLayout() {
    const layout = await invoke('getRuneLayout').catch(() => null);
    if (!layout || !layout.groups || !Array.isArray(layout.shards) || !Array.isArray(layout.styles)) return;
    runeGroups = layout.groups; shardGroups = layout.shards; paths = layout.styles.map(([id, name]) => [number(id), name]);
  }
  async function reloadGameData() {
    catalogs.clear(); runeDraft = null;
    try { await Promise.all([loadRuneLayout(), ...['heroes', 'items', 'runes', 'spells'].map(getCatalog)]); renderPage(); } catch (error) { toast(error.message, true); }
  }
  async function refreshState() { const result = await invoke('refresh'); ingest(result); if (!result || !result.connection) await reloadState(); }
  async function getCatalog(kind) {
    if (catalogs.has(kind)) return catalogs.get(kind);
    if (!catalogPromises.has(kind)) catalogPromises.set(kind, invoke('getCatalog', kind).then(data => {
      const list = Array.isArray(data) ? data : [];
      catalogs.set(kind, list);
      return list;
    }).finally(() => catalogPromises.delete(kind)));
    return catalogPromises.get(kind);
  }
  function showDialog(title, body) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = body;
    if (!dialog.open) dialog.showModal();
  }
  function normalMatch(game, puuid) {
    const participants = game.participants || [];
    const identities = game.participantIdentities || [];
    const identity = identities.find(item => item.player && item.player.puuid === puuid);
    const participant = (identity && participants.find(item => item.participantId === identity.participantId)) || participants[0] || {};
    const stats = participant.stats || game.stats || {};
    let win = game.win != null ? game.win : stats.win;
    if (typeof win === 'string') win = win.toLowerCase() === 'win' || win.toLowerCase() === 'true';
    return {
      id: game.gameId || game.id, championId: game.championId || participant.championId || stats.championId,
      kills: game.kills != null ? game.kills : stats.kills, deaths: game.deaths != null ? game.deaths : stats.deaths,
      assists: game.assists != null ? game.assists : stats.assists, win: win === true, knownResult: typeof win === 'boolean',
      queueId: game.queueId || game.queue, duration: game.duration || game.gameDuration,
      date: game.gameCreation || game.gameCreationDate || game.gameStartTimestamp,
      damage: stats.totalDamageDealtToChampions, cs: stats.totalMinionsKilled != null || stats.neutralMinionsKilled != null ? number(stats.totalMinionsKilled) + number(stats.neutralMinionsKilled) : null, gold: stats.goldEarned
    };
  }
  const boardRoles = [['top', '上路'], ['jungle', '打野'], ['middle', '中路'], ['bottom', '下路'], ['utility', '辅助']];
  function normalizedRole(player) {
    const value = String(player.position || player.currentPosition || player.assignedPosition || '').toLowerCase();
    return ({top:'top',jungle:'jungle',jug:'jungle',middle:'middle',mid:'middle',bottom:'bottom',bot:'bottom',adc:'bottom',utility:'utility',support:'utility',sup:'utility'})[value] || '';
  }
  function playerAggregate(player) {
    const records = (player.matchHistory || []).map(game => normalMatch(game, player.puuid));
    const known = records.filter(game => game.knownResult);
    const wins = known.filter(game => game.win).length;
    const sum = key => records.reduce((total, game) => total + number(game[key]), 0);
    const average = key => { const entries = records.filter(game => game[key] != null); return entries.length ? entries.reduce((total, game) => total + number(game[key]), 0) / entries.length : null; };
    return {records, count:records.length, wins, losses:known.length-wins, rate:known.length ? Math.round(wins/known.length*100) : null, kda:records.length ? (sum('kills')+sum('assists'))/Math.max(1,sum('deaths')) : null, cs:average('cs'), damage:average('damage')};
  }
  function lanePlayer(player, team, index, slotRole = '') {
    const semantic=`data-team="${team==='myTeam'?'mine':'enemy'}" data-role="${esc(slotRole||player&&normalizedRole(player)||'unknown')}"`;
    if (!player) return `<article class="lane-player empty-lane" ${semantic}><span>暂无信息</span></article>`;
    const aggregate = playerAggregate(player);
    const own = state.me && player.puuid && player.puuid === state.me.puuid;
    const scores = player.scores;
    const currentKda = scores ? `${number(scores.kills)} / ${number(scores.deaths)} / ${number(scores.assists)}` : null;
    return `<article class="lane-player${own ? ' my-player' : ''}" ${semantic}>${artTag(player.championId, 'lane-art')}<div class="player-identity">${imageTag(heroImage(player.championId))}<div class="identity-text"><button type="button" class="text-button player-name" data-action="player-detail" data-team="${team}" data-index="${index}" title="${esc(playerName(player))}">${esc(playerName(player))}</button><div class="player-meta">${esc(heroName(player.championId))}${own ? ' · 自己' : ''}</div></div></div><div class="player-rank" title="${esc(rankText(player.rankedInfo))}">${esc(rankText(player.rankedInfo))}</div><div class="lane-metrics"><div><strong class="metric num${aggregate.rate != null && aggregate.rate >= 60 ? ' positive' : ''}">${aggregate.rate != null ? `${aggregate.rate}%` : '—'}</strong><span class="metric-note">${aggregate.count ? `${aggregate.wins}胜 ${aggregate.losses}负` : '近期胜率'}</span></div><div><strong class="metric num${kdaClass(aggregate.kda)}">${aggregate.kda != null ? aggregate.kda.toFixed(2) : '—'}</strong><span class="metric-note">近期 KDA</span></div></div><progress class="rate-bar${aggregate.rate == null ? ' unknown' : ''}" max="100" value="${aggregate.rate != null ? aggregate.rate : 0}" aria-label="近期胜率"></progress>${aggregate.records.length ? `<table class="recent-table"><thead><tr><th>英雄</th><th>结果</th><th>K / D / A</th></tr></thead><tbody>${aggregate.records.slice(0,5).map(match=>`<tr><td>${imageTag(heroImage(match.championId),'','')}</td><td><span class="mini-result${match.knownResult ? match.win ? ' win' : ' loss' : ''}">${match.knownResult ? match.win ? '胜' : '负' : '—'}</span></td><td>${number(match.kills)} / ${number(match.deaths)} / ${number(match.assists)}</td></tr>`).join('')}${Array.from({length:Math.max(0,5-aggregate.records.length)},()=>'<tr><td></td><td></td><td class="muted">—</td></tr>').join('')}</tbody></table>` : `<div class="lane-empty-history">${currentKda ? `本局 ${esc(currentKda)}` : player.puuid || player.summonerId ? '近期记录尚未返回' : '身份未公开，无法查询'}</div>`}<div class="lane-footer"><span class="num">${aggregate.cs != null ? `场均补刀 ${Math.round(aggregate.cs)}` : '仅显示公开数据'}</span>${player.puuid ? `<button type="button" class="link-button" data-action="player-history" data-puuid="${esc(player.puuid)}" data-name="${esc(playerName(player))}">战绩</button>` : ''}</div></article>`;
  }
  function boardTeamHtml(players, name, team) {
    if ([450,900,1020,1090,1100,1130,1160,1700,1710,1900,2400].includes(number(state.queueId))) {
      return `<section class="board-team${team==='enemyTeam'?' enemy':''}"><div class="team-heading"><strong>${esc(name)}</strong><small>${players.length} 位玩家</small></div><div class="lane-grid">${Array.from({length:5},(_,index)=>lanePlayer(players[index],team,index)).join('')}</div></section>${players.length>5?`<details class="unknown-players" data-remember="${team}"><summary>更多玩家（${players.length-5}）</summary><div class="unknown-list">${players.slice(5).map((player,index)=>lanePlayer(player,team,index+5)).join('')}</div></details>`:''}`;
    }
    const placed = new Map();
    const unknown = [];
    const guess = player => { const side = team === 'enemyTeam' ? 'enemy' : 'mine'; const lane = state.prediction && state.prediction.lanes && state.prediction.lanes.find(item => item[side].championId === number(player.championId)); return lane ? (Object.entries(roleToPosition).find(([, position]) => position === lane.position) || [''])[0] : ''; };
    players.forEach((player,index) => { const role=normalizedRole(player)||guess(player); if(role&&!placed.has(role))placed.set(role,{player,index});else unknown.push({player,index}); });
    return `<section class="board-team${team === 'enemyTeam' ? ' enemy' : ''}"><div class="team-heading"><strong>${esc(name)}</strong><small>${players.length} 位玩家</small></div><div class="lane-grid">${boardRoles.map(([role])=>{const entry=placed.get(role);return lanePlayer(entry&&entry.player,team,entry&&entry.index,role);}).join('')}</div></section>${unknown.length ? `<details class="unknown-players" data-remember="${team}"><summary>${esc(name)} · 位置未公开 / 重复位置（${unknown.length}）</summary><div class="unknown-list">${unknown.map(({player,index})=>lanePlayer(player,team,index)).join('')}</div></details>` : ''}`;
  }
  function activityHtml() {
    return state.actions && state.actions.length ? `<ul class="activity-list">${state.actions.slice(-8).reverse().map(action=>`<li><time>${esc(dateText(action.at,true))}</time><span>${esc(action.message)}</span></li>`).join('')}</ul>` : '<p class="subtle">尚无操作记录。</p>';
  }
  function boardStateSignature() { return JSON.stringify({connected:connected(),phase:state.connection.phase,queueId:state.queueId,message:connected()?'':state.connection.message,me:state.me,teams:state.teams,recommendation:state.recommendation,prediction:state.prediction,dataVersion}); }
  function updateDashboard() {
    const signature=boardStateSignature();
    if(signature!==boardSignature){
      const scroll=window.scrollY;
      const opened=[...content.querySelectorAll('details[open][data-remember]')].map(node=>node.dataset.remember);
      const active=document.activeElement;
      const focus=active&&active.dataset ? {action:active.dataset.action,team:active.dataset.team,index:active.dataset.index,puuid:active.dataset.puuid} : null;
      renderPage();
      content.querySelectorAll('details[data-remember]').forEach(node=>{if(opened.includes(node.dataset.remember))node.open=true;});
      if(focus&&focus.action){const target=[...content.querySelectorAll('button[data-action]')].find(node=>node.dataset.action===focus.action&&node.dataset.team===focus.team&&node.dataset.index===focus.index&&node.dataset.puuid===focus.puuid);if(target)target.focus({preventScroll:true});}
      window.scrollTo(0,scroll);
    }
    const clock=document.getElementById('board-clock'); if(clock)clock.textContent=state.live&&state.live.gameData ? duration(state.live.gameData.gameTime) : '—';
    const enabled=document.getElementById('board-enabled');if(enabled)enabled.textContent=`${['autoAccept','autoStart','autoAgain','autoPick','autoBan'].filter(key=>state.settings[key]).length} 项自动化开启`;
    const nextActions=JSON.stringify(state.actions||[]);const list=document.getElementById('dashboard-log-list');if(list&&nextActions!==activitySignature){list.innerHTML=activityHtml();activitySignature=nextActions;}
  }
  function dashboardHtml() {
    const mine=state.teams.myTeam||[],enemy=state.teams.enemyTeam||[];
    const hasPlayers=mine.length||enemy.length;
    const noLanes=[450,900,1020,1090,1100,1130,1160,1700,1710,1900,2400].includes(number(state.queueId));
    const start=heading('对局看板','','');
    const shortcuts=`<div class="local-shortcuts"><button type="button" class="shortcut" data-page="catalog">${icon('book')}<span><strong>浏览本地资料</strong></span></button><button type="button" class="shortcut" data-page="presets">${icon('preset')}<span><strong>管理符文与出装</strong></span></button><button type="button" class="shortcut" data-page="automation">${icon('settings')}<span><strong>配置自动化</strong></span></button></div>`;
    if(!connected())return start+`<section class="offline-start"><h2>未连接游戏客户端</h2><p>${esc(state.connection.message||'请先打开并登录游戏客户端。')}</p><div class="row"><button type="button" class="button" data-action="refresh">刷新连接</button><button type="button" class="button ghost" data-action="choose-lockfile">手动连接</button></div>${shortcuts}</section>`;
    const ownPlayer=state.me&&mine.find(player=>player.puuid&&player.puuid===state.me.puuid);
    const summary=`<div class="board-summary">${ownPlayer&&ownPlayer.championId?imageTag(heroImage(ownPlayer.championId),'','summary-avatar'):''}<strong title="${esc(playerName(state.me))}">${esc(playerName(state.me))}</strong><span class="summary-meta">${esc(phaseNames[state.connection.phase]||'客户端已连接')}</span><div class="summary-right"><span>对局 <b class="num" id="board-clock">${state.live&&state.live.gameData?duration(state.live.gameData.gameTime):'—'}</b></span><span id="board-enabled">${['autoAccept','autoStart','autoAgain','autoPick','autoBan'].filter(key=>state.settings[key]).length} 项自动化开启</span></div></div>`;
    return start+summary+forecastHtml()+(hasPlayers?`<div class="lane-labels">${boardRoles.map(([role,label],index)=>`<span>${noLanes?`玩家 ${index+1}`:label}${noLanes?'':laneForecast(role)}</span>`).join('')}</div>${boardTeamHtml(mine,'我方队伍','myTeam')}${boardTeamHtml(enemy,'敌方队伍','enemyTeam')}${recommendationHtml()}`:`<section class="offline-start"><h2>等待进入英雄选择</h2><button type="button" class="button" data-page="history">查询本区战绩</button>${shortcuts}</section>`)+`<details class="activity-section" data-remember="activity"><summary>最近操作</summary><div id="dashboard-log-list">${activityHtml()}</div></details>`;
  }
  function filteredHistory() {
    return history.games.filter(game=>{const match=normalMatch(game,history.summoner&&history.summoner.puuid);return (historyFilters.result==='all'||(historyFilters.result==='win'?match.win:!match.win))&&(historyFilters.queue==='all'||String(match.queueId)===historyFilters.queue)&&(historyFilters.hero==='all'||String(match.championId)===historyFilters.hero);});
  }
  function matchRow(game, playerPuuid) {
    const match=normalMatch(game, typeof playerPuuid==='string'?playerPuuid:history.summoner&&history.summoner.puuid);
    return `<tr class="${match.knownResult?match.win?'row-win':'row-loss':''}"><td class="history-date num">${esc(dateText(match.date,true)||'日期未提供')}</td><td>${esc(queueName(match.queueId))}</td><td><div class="identity-cell">${imageTag(heroImage(match.championId))}<span>${esc(heroName(match.championId))}</span></div></td><td><span class="outcome-tag ${match.knownResult?match.win?'win':'loss':''}">${match.knownResult?match.win?'胜利':'失败':'结束'}</span></td><td class="num"><strong>${number(match.kills)} / ${number(match.deaths)} / ${number(match.assists)}</strong></td><td class="num">${duration(match.duration)}</td><td class="num col-performance">${match.cs!=null?formatNumber(match.cs):'—'}</td><td><button type="button" class="link-button" data-action="match-detail" data-game="${esc(match.id)}">详情</button></td></tr>`;
  }
  function historyResultsHtml() {
    const list=filteredHistory();
    return list.length?`<div class="table-wrap"><table class="data-table history-table"><thead><tr><th>日期</th><th>模式</th><th>英雄</th><th>结果</th><th>K / D / A</th><th>时长</th><th class="col-performance">补刀</th><th>操作</th></tr></thead><tbody>${list.map(matchRow).join('')}</tbody></table></div>`:empty('没有符合筛选的记录','调整胜负、模式或英雄筛选后再试。');
  }
  function historyHtml() {
    const results=history.games.map(game=>normalMatch(game,history.summoner&&history.summoner.puuid));
    const wins=results.filter(match=>match.win).length;
    const queues=[...new Set(results.map(match=>match.queueId))],heroes=[...new Set(results.map(match=>match.championId))];
    return heading('本区战绩','','')+offlineNotice()+`<section class="panel history-search"><form id="history-form" class="search-form"><input id="history-query" name="query" value="${esc(history.query)}" placeholder="召唤师名称 / 名称#标签" aria-label="召唤师名称或 Riot ID" maxlength="100"><button type="submit" class="button"${disabledClient()}${history.loading?' disabled':''}>${history.loading?'查询中…':'查询'}</button><button type="button" class="button secondary" data-action="my-history"${disabledClient()}>查自己</button></form></section>`+(history.error?`<div class="notice warning">${esc(history.error)}</div>`:'')+(history.loading?'<div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在读取战绩…</div>':history.summoner?`<section class="panel"><div class="history-identity"><div><h2>${esc(playerName(history.summoner))}</h2><small>等级 ${formatNumber(history.summoner.summonerLevel)} · ${esc(rankText(history.rankedInfo||history.summoner.rankedInfo))}</small></div><div class="history-summary num">本页 ${results.length} 场 · <span class="positive">${wins} 胜</span> / <span class="negative">${results.length-wins} 负</span></div></div>${history.games.length?`<div class="history-filters"><span>筛选</span><select data-history-filter="result" aria-label="筛选胜负"><option value="all">全部结果</option><option value="win"${historyFilters.result==='win'?' selected':''}>胜利</option><option value="loss"${historyFilters.result==='loss'?' selected':''}>失败</option></select><select data-history-filter="queue" aria-label="筛选模式"><option value="all">全部模式</option>${queues.map(id=>`<option value="${id}"${String(id)===historyFilters.queue?' selected':''}>${esc(queueName(id))}</option>`).join('')}</select><select data-history-filter="hero" aria-label="筛选英雄"><option value="all">全部英雄</option>${heroes.map(id=>`<option value="${id}"${String(id)===historyFilters.hero?' selected':''}>${esc(heroName(id))}</option>`).join('')}</select></div><div id="history-results">${historyResultsHtml()}</div><div class="pagination"><button type="button" class="button ghost compact" data-action="history-prev"${history.begin>0?'':' disabled'}>上一页</button><span>第 ${Math.floor(history.begin/20)+1} 页</span><button type="button" class="button ghost compact" data-action="history-next"${history.games.length>=20?'':' disabled'}>下一页</button></div>`:empty('暂无近期战绩','客户端没有返回这位玩家的近期记录。')}</section>`:`<section class="panel">${empty(history.searched?'未查询到玩家':'输入玩家名称开始查询',history.searched?'检查名称和标签是否正确。':'')}</section>`);
  }
  function toggle(name, label, note, delayName) {
    const value=autoPending&&autoPending.name===name?autoPending.value:settingsValue()[name];
    return `<div class="toggle-row"><label for="auto-${name}"><span>${esc(label)}${note?`<small>${esc(note)}</small>`:''}</span><input class="switch" type="checkbox" id="auto-${name}" name="${name}"${checked(value)}${autoBusy?' disabled':''}></label>${delayName?`<div class="delay-control"><label for="auto-${delayName}">延迟</label><input type="number" id="auto-${delayName}" name="${delayName}" min="0" max="30" step="1" value="${number(autoDraft[delayName])}"><span>秒</span></div>`:''}</div>`;
  }
  function updateAutoState() {
    const saved=settingsValue();
    if(autoDraft)autoSwitches.forEach(key=>{autoDraft[key]=saved[key];});
    content.querySelectorAll('#automation-form input[type="checkbox"]').forEach(input=>{input.checked=autoPending&&autoPending.name===input.name?autoPending.value:!!saved[input.name];input.disabled=autoBusy;});
    const message=document.getElementById('auto-status');
    if(message){message.classList.toggle('saving',autoBusy);message.textContent=autoBusy?'正在保存…':autoFeedback;}
  }
  async function setAutoToggle(name, value) {
    if(autoBusy||!autoSwitches.includes(name))return;
    autoBusy=true;autoPending={name,value};updateAutoState();
    try{await persistSettings(Object.assign({},settingsValue(),{[name]:value}));autoFeedback='开关已保存并生效。';}
    catch(error){try{await reloadState();}catch(_){}autoFeedback='开关未能保存，已恢复当前实际状态。';toast(error.message,true);}
    finally{autoBusy=false;autoPending=null;if(page==='automation')updateAutoState();}
  }
  function heroOptions(selected, withUniversal = false, withEmptyBan = false) {
    let html = withUniversal ? `<option value="0"${selected == 0 ? ' selected' : ''}>通用方案</option>` : '<option value="">选择英雄…</option>';
    if (withEmptyBan) html += '<option value="-1">空禁用</option>';
    return html + (catalogs.get('heroes') || []).filter(hero => number(catalogId(hero)) < 60000 && number(catalogId(hero)) > 0).sort((a, b) => itemName(a).localeCompare(itemName(b), 'zh-CN')).map(hero => `<option value="${esc(catalogId(hero))}"${String(catalogId(hero)) === String(selected) ? ' selected' : ''}>${esc(itemName(hero))}${hero.alias ? ` · ${esc(hero.alias)}` : ''}</option>`).join('');
  }
  function priorityBox(type, role, label) {
    const ids=(autoDraft[type]&&autoDraft[type][role])||[];
    return `<div class="priority-box"><div class="priority-title"><strong>${esc(label)} · ${type==='picks'?'选用':'禁用'}优先级</strong><small>${ids.length} / 20</small></div><div class="priority-items">${ids.map((id,index)=>`<div class="priority-chip"><span class="priority-order num">${index+1}</span>${imageTag(heroImage(id),'','')}<span class="chip-name">${esc(heroName(id))}</span><button type="button" class="icon-button" data-action="priority-move" data-type="${type}" data-role="${role}" data-index="${index}" data-direction="-1" aria-label="提高优先级"${index===0?' disabled':''}>${icon('up')}</button><button type="button" class="icon-button" data-action="priority-move" data-type="${type}" data-role="${role}" data-index="${index}" data-direction="1" aria-label="降低优先级"${index===ids.length-1?' disabled':''}>${icon('down')}</button><button type="button" class="icon-button" data-action="priority-remove" data-type="${type}" data-role="${role}" data-index="${index}" aria-label="移除 ${esc(heroName(id))}">${icon('close')}</button></div>`).join('')}</div>${ids.length?'':'<p class="priority-empty">列表为空</p>'}<div class="priority-add"><select id="priority-${type}-${role}" aria-label="添加优先英雄">${heroOptions('',false,type==='bans')}</select><button type="button" class="button secondary" data-action="priority-add" data-type="${type}" data-role="${role}">添加</button></div></div>`;
  }
  function automationHtml() {
    if(!autoDraft){autoDraft=settingsValue();autoDraft.picks=Object.assign(clone(defaults.picks),autoDraft.picks);autoDraft.bans=Object.assign(clone(defaults.bans),autoDraft.bans);}
    if(autoType==='bans'&&autoRole==='aram')autoRole='default';
    const roleLabel=(roles.find(([key])=>key===autoRole)||roles[0])[1];
    return heading('自动化设置','','')+`<div id="auto-status" class="auto-status${autoBusy?' saving':''}">${autoBusy?'正在保存…':esc(autoFeedback)}</div><form id="automation-form"><div class="auto-layout"><div><section class="panel"><div class="panel-heading"><h2>匹配与赛后</h2></div>${toggle('autoAccept','自动接受匹配','','acceptDelaySec')}${toggle('autoStart','自动开始匹配','','startDelaySec')}${toggle('autoAgain','赛后再来一局','','againDelaySec')}</section><section class="panel"><div class="panel-heading"><h2>选人与禁用</h2></div>${toggle('autoPick','自动选用英雄','')}${toggle('pickHoverOnly','只预选，不锁定','')}${toggle('pickAtLastSecond','选用阶段最后再操作','')}${toggle('autoBan','自动禁用英雄','')}${toggle('avoidTeamHover','避开队友预选','')}${toggle('banAtLastSecond','禁用阶段最后再操作','')}</section></div><section class="panel"><div class="panel-heading"><h2>英雄优先级</h2></div><div class="priority-controls"><label for="priority-type">操作</label><select id="priority-type"><option value="picks"${autoType==='picks'?' selected':''}>选用英雄</option><option value="bans"${autoType==='bans'?' selected':''}>禁用英雄</option></select><label for="priority-role">分路</label><select id="priority-role">${roles.filter(([role])=>autoType!=='bans'||role!=='aram').map(([role,label])=>`<option value="${role}"${role===autoRole?' selected':''}>${esc(label)}</option>`).join('')}</select></div>${priorityBox(autoType,autoRole,roleLabel)}</section></div><div class="sticky-save"><p id="automation-dirty" class="${autoDirty?'unsaved':''}">${autoDirty?'有未保存的修改':'已保存'}</p><div class="row"><button type="button" class="button ghost" data-action="automation-revert">撤销修改</button><button type="submit" class="button"${autoBusy?' disabled':''}>保存</button></div></div></form>`;
  }
  function filteredCatalog() {
    const query = catalogQuery.trim().toLowerCase();
    return (catalogs.get(catalogKind) || []).filter(item => !query || [itemName(item), item.alias, item.title, catalogId(item), item.englishName, item.chessName].some(value => String(value || '').toLowerCase().includes(query)));
  }
  function catalogGridHtml() {
    const list=filteredCatalog();const pages=Math.max(1,Math.ceil(list.length/36));catalogPage=Math.min(Math.max(0,catalogPage),pages-1);
    if(!catalogs.has(catalogKind))return '<div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在读取本地资料…</div>';
    if(!list.length)return empty('没有找到匹配资料','试试名称、英文名称或编号。');
    if(!catalogSelectedId)catalogSelectedId=String(catalogId(list[0]));
    return `<div class="catalog-grid">${list.slice(catalogPage*36,(catalogPage+1)*36).map(item=>`<button type="button" class="catalog-card${String(catalogId(item))===catalogSelectedId?' selected':''}" data-action="catalog-detail" data-id="${esc(catalogId(item))}">${imageTag(item.image,'','')}<span class="catalog-card-text"><strong>${esc(itemName(item))}</strong><span>${esc(catalogKind==='heroes'?item.title||'':catalogKind==='items'?`${formatNumber(item.priceTotal||item.price)} 金币`:catalogKind==='chess'?`${item.price||'—'} 费`:plain(item.description||item.desc||'').slice(0,35))}</span></span></button>`).join('')}</div><div class="pagination"><button type="button" class="button ghost compact" data-action="catalog-prev"${catalogPage===0?' disabled':''}>上一页</button><span>${catalogPage+1} / ${pages}</span><button type="button" class="button ghost compact" data-action="catalog-next"${catalogPage>=pages-1?' disabled':''}>下一页</button></div>`;
  }
  function catalogHtml() {
    const grid=catalogGridHtml();
    return heading('本地资料','','')+`<div class="tabs" role="tablist" aria-label="资料分类">${catalogKinds.map(([kind,label])=>`<button type="button" class="tab${kind===catalogKind?' active':''}" data-action="catalog-kind" data-kind="${kind}" role="tab" aria-selected="${kind===catalogKind}">${esc(label)}</button>`).join('')}</div><div class="catalog-toolbar"><input id="catalog-search" value="${esc(catalogQuery)}" placeholder="搜索${esc(labelOf(catalogKind))}名称 / 编号" aria-label="搜索本地资料"><small id="catalog-count">${filteredCatalog().length} 项资料</small></div><div class="catalog-explorer"><div id="catalog-results">${grid}</div><aside id="catalog-detail" class="catalog-detail-panel" aria-label="资料详情">${catalogDetailBody(findCatalog(catalogKind,catalogSelectedId),catalogKind)}</aside></div>`;
  }
  function updateCatalogResults() {
    const node=document.getElementById('catalog-results');if(node)node.innerHTML=catalogGridHtml();
    const count=document.getElementById('catalog-count');if(count)count.textContent=`${filteredCatalog().length} 项资料`;
    const detail=document.getElementById('catalog-detail');if(detail)detail.innerHTML=catalogDetailBody(findCatalog(catalogKind,catalogSelectedId),catalogKind);
  }
  function catalogDetailBody(item, kind) {
    if(!item)return '<p class="subtle">选择一项查看详情</p>';
    const banner=kind==='heroes'?artTag(catalogId(item),''):'';
    let body=`${banner?`<div class="catalog-banner">${banner}</div>`:''}<div class="catalog-info">${imageTag(item.image,'','')}<div><h2>${esc(itemName(item))}</h2><p>${esc(item.title||`编号 ${catalogId(item)}`)}</p></div></div>`;
    if(kind==='heroes')body+=['p','q','w','e','r'].map(key=>item[key]?`<section class="skill-description"><h3>${key==='p'?'被动':key.toUpperCase()} · ${esc(item[key].name)}</h3><p>${esc(plain(item[key].description))}</p>${item[key].cooldownburn||item[key].costburn?`<div class="detail-meta"><span>冷却 ${esc(item[key].cooldownburn||'—')}</span><span>消耗 ${esc(item[key].costburn||'—')}</span></div>`:''}</section>`:'').join('');
    else{
      const description=plain(item.description||item.desc||item.introduce||item.skillIntroduce||item.skillDetail||item.effect||'此条资料没有附加说明。');
      if(kind==='items')body+=`<div class="detail-meta"><span>总价 ${formatNumber(item.priceTotal||item.price)} 金币</span></div>`;
      if(kind==='chess')body+=`<div class="detail-meta"><span>${esc(item.price||'—')} 费</span><span>生命 ${esc(item.life||'—')}</span><span>攻击 ${esc(item.attack||'—')}</span></div><h3>${esc(item.skillName||'技能')}</h3>`;
      body+=`<p class="catalog-description">${esc(description)}</p>`;
      if(item.to&&item.to.length)body+=`<section class="skill-description"><h3>可合成装备</h3><p>${esc(item.to.map(id=>itemName(findCatalog('items',id)||{id})).join('、'))}</p></section>`;
      if(item.level&&typeof item.level==='object')body+=Object.entries(item.level).map(([level,text])=>`<section class="skill-description"><h3>${esc(level)} 单位</h3><p>${esc(plain(text))}</p></section>`).join('');
    }
    return body;
  }
  function catalogDetail(id) {catalogSelectedId=String(id);updateCatalogResults();}
  function pct(value, digits = 1) { return value == null ? '—' : `${(value * 100).toFixed(digits)}%`; }
  function games(value) { return value >= 10000 ? `${(value / 10000).toFixed(1)}万场` : `${formatNumber(value)} 场`; }
  function iconOf(kind, id) { const item = findCatalog(kind, id); return imageTag(item && item.image, item ? itemName(item) : String(id), 'build-icon'); }
  function iconRow(kind, ids, separator = '') { return `<div class="icon-row">${ids.map(id => `<span class="icon-cell" title="${esc(itemName(findCatalog(kind, id) || {id}))}">${iconOf(kind, id)}</span>`).join(separator)}</div>`; }
  function statLine(entry) { return `<span class="build-stat"><b class="num">${pct(entry.winRate)}</b> 胜率<i>·</i><span class="num">${pct(entry.pickRate, 0)}</span> 选取<i>·</i>${games(entry.play)}</span>`; }
  function itemBlocks(build) {
    const blocks = [['出门装', build.starter[0]], ['核心装备', build.core[0]], ['鞋子', build.boots[0]], ['后期装备', {ids: [...new Set(build.last.flatMap(entry => entry.ids))].filter(id => !(build.core[0] || {ids: []}).ids.includes(id)).slice(0, 6)}]];
    return blocks.filter(([, entry]) => entry && entry.ids && entry.ids.length);
  }
  function buildHtml(build, source, compact = false) {
    const hero = findCatalog('heroes', build.championId);
    const tier = build.stats.tier ? `<span class="tier-badge tier-${esc(build.stats.tier)}">T${esc(build.stats.tier)}</span>` : '';
    const header = `<div class="build-header">${imageTag(hero && hero.image, '', 'build-portrait')}<div class="build-title"><h2>${esc(heroName(build.championId))}${tier}</h2><p>${esc(positionNames[build.position] || build.position)} · <b class="num">${pct(build.stats.winRate)}</b> 胜率 · ${pct(build.stats.pickRate)} 选取 · ${pct(build.stats.banRate)} 禁用 · ${games(build.stats.play)}</p></div><span class="build-source">OP.GG ${esc(build.version)}</span></div>`;
    const runes = build.runes.slice(0, compact ? 2 : 3).map((page, index) => `<div class="rune-page"><div class="rune-icons"><span class="keystone">${iconOf('runes', page.selectedPerkIds[0])}</span>${iconRow('runes', page.selectedPerkIds.slice(1, 4))}<span class="rune-divider"></span>${iconRow('runes', [page.subStyleId, ...page.selectedPerkIds.slice(4, 6)])}<span class="rune-divider"></span><span class="shards">${iconRow('runes', page.selectedPerkIds.slice(6))}</span></div><div class="rune-meta">${statLine(page)}<button type="button" class="button secondary compact" data-action="build-rune" data-source="${source}" data-index="${index}"${disabledClient()}>应用符文</button></div></div>`).join('');
    const spells = build.spells.slice(0, 2).map((entry, index) => `<div class="build-row">${iconRow('spells', entry.ids)}${statLine(entry)}<button type="button" class="button ghost compact" data-action="build-spells" data-source="${source}" data-index="${index}"${disabledClient()}>应用</button></div>`).join('');
    const items = itemBlocks(build).map(([label, entry]) => `<div class="build-row"><span class="row-label">${label}</span>${iconRow('items', entry.ids, '<i class="arrow"></i>')}${entry.winRate != null ? statLine(entry) : ''}</div>`).join('');
    const order = build.skills.order.length ? `<div class="skill-order">${build.skills.order.slice(0, compact ? 9 : 15).map((key, index) => `<span class="skill-key key-${esc(key.toLowerCase())}"><small>${index + 1}</small>${esc(key)}</span>`).join('')}</div>` : '';
    const masteries = build.skills.masteries.length ? `<div class="skill-masteries">${build.skills.masteries.map(key => `<span class="skill-key key-${esc(key.toLowerCase())}">${esc(key)}</span>`).join('<i class="arrow"></i>')}<span class="build-stat">主升顺序 · ${pct(build.skills.winRate)} 胜率</span></div>` : '';
    const sections = [
      `<section class="build-section"><div class="build-section-head"><h3>符文</h3></div>${runes || '<p class="subtle">暂无数据</p>'}</section>`,
      `<section class="build-section"><div class="build-section-head"><h3>召唤师技能</h3></div>${spells || '<p class="subtle">暂无数据</p>'}</section>`,
      `<section class="build-section"><div class="build-section-head"><h3>出装</h3><button type="button" class="button secondary compact" data-action="build-items" data-source="${source}"${disabledClient()}>导入出装</button></div>${items || '<p class="subtle">暂无数据</p>'}</section>`,
      `<section class="build-section"><div class="build-section-head"><h3>技能加点</h3></div>${masteries}${order || '<p class="subtle">暂无数据</p>'}</section>`
    ];
    if (!compact && build.counters.length) {
      const list = build.counters.filter(item => item.play >= 50).map(item => ({...item, rate: item.win / item.play}));
      const row = item => `<li>${imageTag(heroImage(item.championId), '', 'build-icon')}<span>${esc(heroName(item.championId))}</span><b class="num ${item.rate >= 0.5 ? 'positive' : 'negative'}">${pct(item.rate)}</b><small class="num">${games(item.play)}</small></li>`;
      const strong = list.slice().sort((a, b) => b.rate - a.rate).slice(0, 5); const weak = list.slice().sort((a, b) => a.rate - b.rate).slice(0, 5);
      sections.push(`<section class="build-section counters"><div><h3>优势对位</h3><ul>${strong.map(row).join('')}</ul></div><div><h3>劣势对位</h3><ul>${weak.map(row).join('')}</ul></div></section>`);
    }
    return header + `<div class="build-grid${compact ? ' compact' : ''}">${sections.join('')}</div>`;
  }
  function buildFor(source) { return source === 'dash' ? state.recommendation && state.recommendation.build : buildPage.build; }
  function recommendationHtml() {
    const rec = state.recommendation;
    if (!rec) return '';
    const body = rec.build ? buildHtml(rec.build, 'dash', true) : rec.error ? `<div class="notice warning"><strong>推荐出装未能获取</strong><p>${esc(rec.error)}</p></div>` : '<div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在获取推荐出装…</div>';
    return `<details class="recommend-panel" data-remember="recommend" open><summary><span>推荐出装</span><small>${esc(heroName(rec.championId))}</small></summary><div class="recommend-body">${body}</div></details>`;
  }
  function forecastHtml() {
    const prediction = state.prediction;
    if (!prediction) return '';
    if (prediction.loading) return '<section class="forecast"><div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在计算阵容胜率…</div></section>';
    if (prediction.error) return `<section class="forecast"><p class="subtle">阵容胜率未能计算：${esc(prediction.error)}</p></section>`;
    const mine = prediction.probability, tierName = (tierOptions.find(([key]) => key === prediction.tier) || ['', ''])[1];
    return `<section class="forecast"><div class="forecast-side mine"><small>我方</small><strong class="num">${pct(mine)}</strong></div><div class="forecast-track"><progress class="forecast-bar" max="1000" value="${Math.round(mine * 1000)}" aria-label="我方胜率预测"></progress><small>阵容胜率预测 · OP.GG ${esc(prediction.version)}${prediction.mode === 'aram' ? ' · 大乱斗' : tierName ? ` · ${esc(tierName)}` : ''}</small></div><div class="forecast-side enemy"><small>敌方</small><strong class="num">${pct(1 - mine)}</strong></div></section>`;
  }
  function laneForecast(role) {
    const lane = state.prediction && state.prediction.lanes && state.prediction.lanes.find(item => item.position === roleToPosition[role]);
    if (!lane) return '';
    const rate = lane.laneWinRate;
    return `<small class="duel ${rate >= 0.52 ? 'good' : rate <= 0.48 ? 'bad' : ''}" title="${lane.source === 'matchup' ? `对位 ${formatNumber(lane.games)} 场` : '按英雄胜率估算'}">${pct(rate)}</small>`;
  }
  function buildsHtml() {
    const settings = settingsValue();
    const positions = buildPage.mode === 'aram' ? [] : ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
    const controls = `<div class="build-controls"><select id="build-hero" aria-label="选择英雄">${heroOptions(buildPage.championId)}</select><div class="tabs" role="tablist" aria-label="分路">${positions.map(position => `<button type="button" class="tab${buildPage.position === position ? ' active' : ''}" data-action="build-position" data-position="${position}" role="tab" aria-selected="${buildPage.position === position}">${positionNames[position]}</button>`).join('')}<button type="button" class="tab${buildPage.mode === 'aram' ? ' active' : ''}" data-action="build-position" data-position="none" role="tab" aria-selected="${buildPage.mode === 'aram'}">大乱斗</button></div><div class="build-filters"><select id="opgg-region" aria-label="数据区域">${regionOptions.map(([key, label]) => `<option value="${key}"${settings.opggRegion === key ? ' selected' : ''}>${label}</option>`).join('')}</select><select id="opgg-tier" aria-label="段位范围">${tierOptions.map(([key, label]) => `<option value="${key}"${settings.opggTier === key ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>`;
    let body;
    if (!settings.onlineData) body = `<section class="panel">${empty('在线数据已关闭', '在工具箱中开启后可查看推荐出装')}</section>`;
    else if (!buildPage.championId) body = `<section class="panel">${empty('选择一个英雄', '')}</section>`;
    else if (buildPage.loading) body = '<section class="panel"><div class="loading-state"><span class="spinner" aria-hidden="true"></span>正在读取 OP.GG 数据…</div></section>';
    else if (buildPage.error) body = `<div class="notice warning"><strong>未能获取数据</strong><p>${esc(buildPage.error)}</p></div>`;
    else body = buildPage.build ? `<section class="panel build-panel">${buildHtml(buildPage.build, 'page')}</section>` : '';
    return heading('英雄推荐', '', '') + controls + body;
  }
  async function loadBuild() {
    if (!buildPage.championId || !settingsValue().onlineData) { renderPage(); return; }
    const request = {...buildPage};
    buildPage.loading = true; buildPage.error = ''; renderPage();
    try {
      const build = await invoke('getBuild', number(request.championId), request.mode === 'aram' ? 'none' : request.position, request.mode);
      if (buildPage.championId !== request.championId || buildPage.mode !== request.mode || (request.position && buildPage.position !== request.position)) return;
      buildPage.build = build; if (request.mode !== 'aram') buildPage.position = build.position;
    } catch (error) { buildPage.error = error.message; buildPage.build = null; }
    finally { if (buildPage.championId === request.championId) buildPage.loading = false; if (page === 'builds') renderPage(); }
  }
  function availableRunes(ids) { return ids.filter(id => findCatalog('runes', id)); }
  function runeLabel(id) { return itemName(findCatalog('runes', id) || {id}); }
  function initialRune() {
    const draft = {id: '', name: '', championId: 0, primaryStyleId: 8000, subStyleId: 8400, selectedPerkIds: [8005, 9111, 9104, 8014, 8473, 8453, 5005, 5008, 5001], spell1Id: 4, spell2Id: 14};
    adjustRune(draft, true, true);
    return draft;
  }
  function adjustRune(draft, resetPrimary, resetSecondary) {
    if (!Array.isArray(draft.selectedPerkIds)) draft.selectedPerkIds = [];
    if (number(draft.primaryStyleId) === number(draft.subStyleId)) draft.subStyleId = paths.find(([id]) => id !== number(draft.primaryStyleId))[0];
    const primary = runeGroups[draft.primaryStyleId] || runeGroups[8000];
    primary.forEach((group, index) => { const available = availableRunes(group); if (resetPrimary || !available.includes(number(draft.selectedPerkIds[index]))) draft.selectedPerkIds[index] = available[0] || group[0]; });
    const secondary = runeGroups[draft.subStyleId] || runeGroups[8400];
    const all = secondary.slice(1).flat();
    for (let index = 4; index < 6; index++) if (resetSecondary || !all.includes(number(draft.selectedPerkIds[index]))) draft.selectedPerkIds[index] = availableRunes(secondary[index - 3])[0] || secondary[index - 3][0];
    const firstGroup = secondary.findIndex(group => group.includes(number(draft.selectedPerkIds[4])));
    const secondGroup = secondary.findIndex(group => group.includes(number(draft.selectedPerkIds[5])));
    if (firstGroup === secondGroup) draft.selectedPerkIds[5] = availableRunes(secondary.find((group, index) => index > 0 && index !== firstGroup))[0] || 0;
    shardGroups.forEach((group, index) => { if (!group.includes(number(draft.selectedPerkIds[index + 6]))) draft.selectedPerkIds[index + 6] = group[0]; });
  }
  function options(values, selected, label) { return values.map(value => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label(value))}</option>`).join(''); }
  function spellOptions(selected) {
    const list = (catalogs.get('spells') || []).filter(item => spellNames[catalogId(item)] && number(catalogId(item)) < 54);
    return options(list.map(catalogId), selected, id => spellNames[id] || itemName(findCatalog('spells', id) || {id}));
  }
  function runeSlot(index, values, title) { return `<div class="rune-slot"><label for="perk-${index}">${esc(title)}</label><select id="perk-${index}" name="perk${index}" required>${options(availableRunes(values), runeDraft.selectedPerkIds[index], runeLabel)}</select></div>`; }
  function presetCardsHtml() {
    const list = presetKind === 'rune' ? state.settings.runePresets || [] : state.settings.itemSets || [];
    const draft = presetKind === 'rune' ? runeDraft : itemDraft;
    if (!list.length) return empty('还没有方案', '');
    return `<div class="preset-list">${list.map(preset => `<article class="preset-card${draft && draft.id === preset.id ? ' selected' : ''}"><h3>${esc(preset.name)}</h3><small>${preset.championId ? esc(heroName(preset.championId)) : '通用方案'}</small><div class="preset-icons">${(presetKind === 'rune' ? preset.selectedPerkIds || [] : preset.items || []).map(id => imageTag((findCatalog(presetKind === 'rune' ? 'runes' : 'items', id) || {}).image, '', '')).join('')}</div><div class="row wrap"><button type="button" class="button secondary" data-action="preset-edit" data-id="${esc(preset.id)}">编辑</button><button type="button" class="button" data-action="preset-apply" data-id="${esc(preset.id)}"${disabledClient()}>${presetKind === 'rune' ? '应用到当前符文页' : '导入商店'}</button>${presetKind === 'rune' && preset.spell1Id && preset.spell2Id ? `<button type="button" class="button ghost" data-action="preset-spells" data-id="${esc(preset.id)}"${disabledClient()}>应用技能</button>` : ''}<button type="button" class="button ghost" data-action="preset-delete" data-id="${esc(preset.id)}">删除</button></div></article>`).join('')}</div>`;
  }
  function runeEditorHtml() {
    if (!runeDraft) runeDraft = initialRune();
    const primary = runeGroups[runeDraft.primaryStyleId] || runeGroups[8000];
    const secondary = runeGroups[runeDraft.subStyleId] || runeGroups[8400];
    const firstRow = secondary.findIndex(group => group.includes(number(runeDraft.selectedPerkIds[4])));
    const secondRow = secondary.findIndex(group => group.includes(number(runeDraft.selectedPerkIds[5])));
    const secondaryOptions = (selected, excluded) => secondary.slice(1).map((group, index) => availableRunes(group).map(id => `<option value="${id}"${id == selected ? ' selected' : ''}${index + 1 === excluded ? ' disabled' : ''}>${index + 1} 行 · ${esc(runeLabel(id))}</option>`).join('')).join('');
    return `<form id="rune-form"><div class="section-form"><div class="field"><label for="rune-name">方案名称</label><input id="rune-name" name="name" maxlength="60" value="${esc(runeDraft.name)}" placeholder="例如：安妮中路" required></div><div class="field"><label for="rune-champion">关联英雄</label><select id="rune-champion" name="championId">${heroOptions(runeDraft.championId, true)}</select></div></div><div class="rune-editor"><div class="rune-column"><h3>主系</h3><select name="primaryStyleId" aria-label="主系符文">${options(paths.map(([id]) => id), runeDraft.primaryStyleId, id => paths.find(item => item[0] === id)[1])}</select>${primary.map((group, index) => runeSlot(index, group, ['基石', '第一行', '第二行', '第三行'][index])).join('')}</div><div class="rune-column"><h3>副系</h3><select name="subStyleId" aria-label="副系符文">${options(paths.filter(([id]) => id !== number(runeDraft.primaryStyleId)).map(([id]) => id), runeDraft.subStyleId, id => paths.find(item => item[0] === id)[1])}</select><div class="rune-slot"><label for="perk-4">第一枚副系符文</label><select id="perk-4" name="perk4">${secondaryOptions(runeDraft.selectedPerkIds[4], secondRow)}</select></div><div class="rune-slot"><label for="perk-5">第二枚副系符文</label><select id="perk-5" name="perk5">${secondaryOptions(runeDraft.selectedPerkIds[5], firstRow)}</select></div></div></div><div class="shard-row">${runeSlot(6, shardGroups[0], '进攻碎片')}${runeSlot(7, shardGroups[1], '灵活碎片')}${runeSlot(8, shardGroups[2], '防御碎片')}</div><div class="spell-fields"><div class="field"><label for="spell-one">D 键技能</label><select id="spell-one" name="spell1Id">${spellOptions(runeDraft.spell1Id)}</select></div><div class="field"><label for="spell-two">F 键技能</label><select id="spell-two" name="spell2Id">${spellOptions(runeDraft.spell2Id)}</select></div></div><div class="preset-footer"><button type="button" class="button ghost" data-action="preset-new">新建方案</button><button type="submit" class="button">保存方案</button></div></form>`;
  }
  function itemPickerHtml() {
    const query = itemQuery.trim().toLowerCase();
    const list = (catalogs.get('items') || []).filter(item => !query || itemName(item).toLowerCase().includes(query) || String(catalogId(item)).includes(query)).slice(0, 16);
    return list.length ? list.map(item => `<button type="button" data-action="item-add" data-id="${esc(catalogId(item))}">${imageTag(item.image, '', '')}<span>${esc(itemName(item))}</span></button>`).join('') : '<p class="subtle">没有找到装备。</p>';
  }
  function itemEditorHtml() {
    if (!itemDraft) itemDraft = {id: '', name: '', championId: 0, items: []};
    return `<form id="item-form"><div class="section-form"><div class="field"><label for="item-name">方案名称</label><input id="item-name" name="name" maxlength="60" value="${esc(itemDraft.name)}" placeholder="例如：法师常用装备" required></div><div class="field"><label for="item-champion">关联英雄</label><select id="item-champion" name="championId">${heroOptions(itemDraft.championId, true)}</select></div></div><input id="item-search" class="item-search" value="${esc(itemQuery)}" placeholder="搜索装备名称 / 编号" aria-label="搜索可添加的装备"><div id="item-picker" class="item-picker">${itemPickerHtml()}</div><div class="form-divider"></div><h3>出装顺序</h3><div class="selected-items">${itemDraft.items.length ? itemDraft.items.map((id, index) => `<div class="priority-chip">${imageTag((findCatalog('items', id) || {}).image, '', '')}<span class="chip-name">${index + 1}. ${esc(itemName(findCatalog('items', id) || {id}))}</span><button type="button" class="icon-button" data-action="item-move" data-index="${index}" data-direction="-1" aria-label="装备上移"${index === 0 ? ' disabled' : ''}>${icon('up')}</button><button type="button" class="icon-button" data-action="item-move" data-index="${index}" data-direction="1" aria-label="装备下移"${index === itemDraft.items.length - 1 ? ' disabled' : ''}>${icon('down')}</button><button type="button" class="icon-button" data-action="item-remove" data-index="${index}" aria-label="移除装备">${icon('close')}</button></div>`).join('') : '<p class="subtle">点击上方装备添加</p>'}</div><div class="preset-footer"><button type="button" class="button ghost" data-action="preset-new">新建方案</button><button type="submit" class="button">保存方案</button></div></form>`;
  }
  function presetsHtml() {
    return heading('符文与出装', '', '') + offlineNotice() +
      `<div class="tabs" role="tablist" aria-label="方案类型"><button type="button" class="tab${presetKind === 'rune' ? ' active' : ''}" data-action="preset-kind" data-kind="rune" role="tab" aria-selected="${presetKind === 'rune'}">符文与技能</button><button type="button" class="tab${presetKind === 'item' ? ' active' : ''}" data-action="preset-kind" data-kind="item" role="tab" aria-selected="${presetKind === 'item'}">商店出装</button></div><div class="presets-layout"><section class="panel"><div class="panel-heading"><h2>已保存方案</h2><button type="button" class="button ghost compact" data-action="preset-new">新建</button></div>${presetCardsHtml()}</section><section class="panel"><div class="panel-heading"><h2>${presetKind === 'rune' ? '符文编辑器' : '出装编辑器'}</h2></div>${presetKind === 'rune' ? runeEditorHtml() : itemEditorHtml()}</section></div>`;
  }
  const gameFieldGroups = [
    ['操作与鼠标',[['General','AutoAcquireTarget','自动攻击','flag'],['General','EnableTargetedAttackMove','只攻击指定目标','flag'],['General','TargetChampionsOnlyAsToggle','只以英雄为目标切换','flag'],['General','ClampCastTargetLocationWithinMaxRange','限制施法目标范围','flag'],['General','PredictMovement','预判移动','flag'],['General','CursorScale','鼠标指针大小'],['General','GameMouseSpeed','游戏鼠标速度'],['General','ShowTurretRangeIndicators','显示防御塔范围','flag']]],
    ['镜头与界面',[['HUD','CameraLockMode','镜头锁定方式'],['HUD','SmartCastOnKeyRelease','松开按键施法','flag'],['HUD','FlipMiniMap','翻转小地图','flag'],['HUD','MinimapScale','小地图大小'],['HUD','MapScrollSpeed','地图滚动速度'],['HUD','GlobalScale','界面大小'],['HUD','ChatScale','聊天文字大小'],['HUD','ShowAttackRadius','显示攻击范围','flag'],['HUD','NumericCooldownFormat','冷却时间格式'],['HUD','WindowMode','窗口模式']]],
    ['音量',[['Volume','MasterVolume','主音量'],['Volume','MasterMute','主音量静音','flag'],['Volume','MusicVolume','音乐音量'],['Volume','MusicMute','音乐静音','flag'],['Volume','SfxVolume','音效音量'],['Volume','SfxMute','音效静音','flag'],['Volume','VoiceVolume','语音音量'],['Volume','PingsVolume','信号音量'],['Volume','AnnouncerVolume','播报音量']]],
    ['聊天与显示',[['HUD','ShowAlliedChat','显示友方聊天','flag'],['HUD','ShowAllChannelChat','显示所有人聊天','flag'],['HUD','HidePlayerNames','隐藏玩家名字','flag'],['HUD','ShowTimestamps','显示聊天时间戳','flag'],['HUD','ShowSpellCosts','显示技能消耗','flag'],['HUD','HideEnemySummonerEmotes','隐藏敌方表情','flag'],['HUD','ShowNeutralCamps','显示野怪营地','flag'],['HUD','ShowSummonerNames','显示召唤师名字','flag'],['HUD','FlashScreenWhenDamaged','受伤闪屏','flag'],['HUD','FlashScreenWhenStunned','受控闪屏','flag']]],
    ['性能与提示',[['Performance','EnableHUDAnimations','界面动画','flag'],['General','WaitForVerticalSync','垂直同步','flag'],['General','HideEyeCandy','隐藏装饰特效','flag'],['LossOfControl','LossOfControlEnabled','显示失控提示','flag'],['LossOfControl','ShowSlows','显示减速','flag'],['Voice','ShowVoiceChatHalos','显示语音光环','flag']]]
  ];
  const inputFieldGroups = [
    ['技能与召唤师技能',[['GameEvents','evtCastSpell1','Q 技能'],['GameEvents','evtCastSpell2','W 技能'],['GameEvents','evtCastSpell3','E 技能'],['GameEvents','evtCastSpell4','R 技能'],['GameEvents','evtCastAvatarSpell1','D 召唤师技能'],['GameEvents','evtCastAvatarSpell2','F 召唤师技能'],['GameEvents','evtCastRoleBound','额外技能']]],
    ['移动与镜头',[['GameEvents','evtPlayerMoveClick','移动'],['GameEvents','evtPlayerAttackMove','攻击移动'],['GameEvents','evtPlayerAttackMoveClick','攻击移动点击'],['GameEvents','evtPlayerStopPosition','停止'],['GameEvents','evtPlayerHoldPosition','原地不动'],['GameEvents','evtCameraSnap','镜头回到自己'],['GameEvents','evtCameraLockToggle','切换镜头锁定'],['GameEvents','evtChampionOnly','只以英雄为目标']]],
    ['物品与商店',[['GameEvents','evtUseItem1','物品 1'],['GameEvents','evtUseItem2','物品 2'],['GameEvents','evtUseItem3','物品 3'],['GameEvents','evtUseItem4','物品 4'],['GameEvents','evtUseItem5','物品 5'],['GameEvents','evtUseItem6','物品 6'],['GameEvents','evtUseVisionItem','饰品'],['GameEvents','evtOpenShop','打开商店'],['ShopEvents','evtShopFocusSearch','搜索商品']]],
    ['升级与自身施法',[['GameEvents','evtLevelSpell1','升级 Q'],['GameEvents','evtLevelSpell2','升级 W'],['GameEvents','evtLevelSpell3','升级 E'],['GameEvents','evtLevelSpell4','升级 R'],['GameEvents','evtSelfCastSpell1','对自身施放 Q'],['GameEvents','evtSelfCastSpell2','对自身施放 W'],['GameEvents','evtSelfCastSpell3','对自身施放 E'],['GameEvents','evtSelfCastSpell4','对自身施放 R']]],
    ['常用界面与信号',[['GameEvents','evtShowScoreBoard','显示计分板'],['GameEvents','evtSysMenu','系统菜单'],['GameEvents','evtChatHistory','聊天记录'],['GameEvents','evtPushToTalk','按键说话'],['GameEvents','evntPlayerPing','普通信号'],['GameEvents','evntPlayerPingDanger','危险信号']]],
    ['智能施法',[['Quickbinds','evtCastSpell1smart','Q 智能施法','flag'],['Quickbinds','evtCastSpell2smart','W 智能施法','flag'],['Quickbinds','evtCastSpell3smart','E 智能施法','flag'],['Quickbinds','evtCastSpell4smart','R 智能施法','flag'],['Quickbinds','evtCastAvatarSpell1smart','D 智能施法','flag'],['Quickbinds','evtCastAvatarSpell2smart','F 智能施法','flag']]]
  ];
  function clientDocument() { try{return JSON.parse(clientDraft[clientKind]);}catch(_){return null;} }
  function clientFieldPath(data,group,key) {
    if(!data||typeof data!=='object')return null;
    const actualGroup=Object.keys(data).find(value=>value.toLowerCase()===group.toLowerCase());
    if(!actualGroup||!data[actualGroup]||typeof data[actualGroup]!=='object')return null;
    const actualKey=Object.keys(data[actualGroup]).find(value=>value.toLowerCase()===key.toLowerCase());
    return actualKey?[actualGroup,actualKey]:null;
  }
  function clientGroupsHtml() {
    const data=clientDocument();
    if(!data)return '<div class="notice">尚未读取客户端配置</div>';
    let counter=0;
    const groups=(clientKind==='game'?gameFieldGroups:inputFieldGroups).map(([name,fields])=>{
      const visible=fields.map(spec=>{const path=clientFieldPath(data,spec[0],spec[1]);if(!path)return '';const value=data[path[0]][path[1]];if(value==null||typeof value==='object')return '';const id=`client-field-${counter++}`;const flag=spec[3]==='flag'&&(typeof value==='boolean'||['0','1'].includes(String(value)));const numeric=typeof value==='number'||/^[-+]?\d+(?:\.\d+)?$/.test(String(value));return `<div class="client-field"><label for="${id}">${esc(spec[2])}</label><input id="${id}" data-client-path="${esc(JSON.stringify(path))}" type="${flag?'checkbox':numeric?'number':'text'}"${flag?checked(value===true||String(value)==='1'):` value="${esc(value)}"${numeric?' step="any"':''}`}></div>`;}).join('');
      return visible?`<section class="client-group"><h3>${esc(name)}</h3>${visible}</section>`:'';
    }).join('');
    return groups?`<div class="client-groups">${groups}</div>`:'<div class="notice">没有可识别的常用项，可在高级选项中查看</div>';
  }
  function updateClientField(input) {
    const data=clientDocument();if(!data)return;
    let path;try{path=JSON.parse(input.dataset.clientPath);}catch(_){return;}
    if(!Array.isArray(path)||path.length!==2||path.some(key=>['__proto__','constructor','prototype'].includes(key)))return;
    const original=data[path[0]]&&data[path[0]][path[1]];
    if(original===undefined)return;
    const next=input.type==='checkbox'?typeof original==='boolean'?input.checked:typeof original==='string'?input.checked?'1':'0':input.checked?1:0:input.type==='number'?typeof original==='number'?number(input.value):input.value:input.value;
    data[path[0]][path[1]]=next;clientDraft[clientKind]=JSON.stringify(data,null,2);clientDirty=true;
    const advanced=document.getElementById('client-json');if(advanced)advanced.value=clientDraft[clientKind];
    const status=document.getElementById('client-dirty');if(status){status.textContent='有未保存的修改';status.classList.add('unsaved');}
  }
  function dataSourceHtml() {
    const info = state.gameData || {}, settings = settingsValue();
    return `<section class="panel data-sources"><div class="panel-heading"><h2>数据来源</h2></div><div class="toggle-row"><div class="data-label"><span>游戏数据</span><small>${info.source === 'client' ? `客户端 ${esc(info.version)} · ${esc(dateText(info.syncedAt, true))} 同步` : `离线快照 ${esc(info.version || '')}`}</small></div><button type="button" class="button ghost compact" data-action="sync-gamedata"${disabledClient()}>立即同步</button></div><div class="toggle-row"><label for="online-data"><span>OP.GG 在线数据<small>推荐出装与阵容胜率预测</small></span><input class="switch" type="checkbox" id="online-data"${checked(settings.onlineData)}></label></div></section>`;
  }
  function toolsHtml() {
    return heading('工具箱','','')+offlineNotice()+dataSourceHtml()+`<section class="panel client-settings"><div class="panel-heading"><h2>游戏与按键设置</h2></div><div class="tool-actions"><select id="client-kind" aria-label="设置类型"><option value="game"${clientKind==='game'?' selected':''}>游戏设置</option><option value="input"${clientKind==='input'?' selected':''}>按键设置</option></select><button type="button" class="button secondary" data-action="client-read"${disabledClient()}>读取当前设置</button><button type="button" class="button" data-action="client-save"${disabledClient()}${clientRead?'':' disabled'}>应用当前设置</button><span id="client-dirty" class="client-form-status${clientDirty?' unsaved':''}">${clientDirty?'有未保存的修改':clientRead?'已载入':'尚未读取'}</span></div><div id="client-fields">${clientGroupsHtml()}</div><details id="client-advanced" class="advanced-settings"${clientAdvancedOpen?' open':''}><summary>高级选项 · 原始 JSON</summary><textarea id="client-json" class="json-editor" spellcheck="false" aria-label="高级 JSON 配置" placeholder="读取或导入配置后可在这里查看原始字段。">${esc(clientDraft[clientKind])}</textarea><button type="button" class="button ghost compact" data-action="client-sync-json">更新上方表单</button></details></section><div class="tools-grid"><section class="panel tool-section"><h2>状态与签名</h2><form id="profile-form" class="section-form"><div class="field"><label for="profile-status">在线状态</label><select id="profile-status" name="availability"><option value="">保持当前状态</option><option value="chat">在线</option><option value="away">离开</option><option value="dnd">请勿打扰</option><option value="offline">离线</option></select></div><div class="field"><label for="profile-message">个人签名</label><input id="profile-message" name="statusMessage" maxlength="50" placeholder="输入签名；留空会清除"></div><button type="submit" class="button"${disabledClient()}>应用状态与签名</button></form></section><section class="panel tool-section"><h2>创建游戏房间</h2><form id="lobby-form" class="section-form"><div class="field"><label for="lobby-queue">游戏模式</label><select id="lobby-queue" name="queueId" required><option value="">选择游戏模式…</option>${[430,420,440,450,490,1090,1100,1130,1160].map(id=>`<option value="${id}">${esc(queueName(id))}</option>`).join('')}</select></div><button type="submit" class="button"${disabledClient()}>创建房间</button></form></section></div>`;
  }
  function renderPage() {
    document.querySelectorAll('.nav-button').forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (loadError && !ready) { content.innerHTML = heading('本地助手', '', '') + `<div class="notice warning"><strong>无法打开助手</strong><p>${esc(loadError)}</p></div>`; return; }
    const renderers = {dashboard: dashboardHtml, history: historyHtml, builds: buildsHtml, automation: automationHtml, catalog: catalogHtml, presets: presetsHtml, tools: toolsHtml};
    content.innerHTML = renderers[page]();
    if(page==='dashboard'){boardSignature=boardStateSignature();activitySignature=JSON.stringify(state.actions||[]);}
    updateHeader();
  }
  async function navigate(next) {
    if (!['dashboard', 'history', 'builds', 'automation', 'catalog', 'presets', 'tools'].includes(next)) return;
    page = next;
    renderPage();
    window.scrollTo(0, 0);
    try {
      if (page === 'catalog') { await getCatalog(catalogKind); if (page === 'catalog') updateCatalogResults(); }
      if (page === 'automation') { await getCatalog('heroes'); if (page === 'automation') renderPage(); }
      if (page === 'presets') { await Promise.all(['heroes', 'runes', 'spells', 'items'].map(getCatalog)); if (page === 'presets') renderPage(); }
      if (page === 'builds') {
        await Promise.all(['heroes', 'runes', 'spells', 'items'].map(getCatalog));
        const rec = state.recommendation;
        if (!buildPage.championId && rec && rec.championId) { buildPage.championId = String(rec.championId); buildPage.mode = rec.mode === 'aram' ? 'aram' : 'ranked'; buildPage.position = rec.position === 'none' ? '' : rec.position || ''; }
        if (page === 'builds') { if (buildPage.championId && !buildPage.build && !buildPage.loading) await loadBuild(); else renderPage(); }
      }
    } catch (error) { toast(error.message, true); }
  }
  function captureAuto() {
    const form = document.getElementById('automation-form');
    if (!form || !autoDraft) return;
    form.querySelectorAll('input[type="number"][name]').forEach(input => { const value=Math.min(30,Math.max(0,number(input.value)));if(value!==autoDraft[input.name])autoDirty=true;autoDraft[input.name]=value; });
    const node = document.getElementById('automation-dirty');
    if (node&&autoDirty) {node.textContent = '有未保存的修改';node.classList.add('unsaved');}
  }
  function capturePreset() {
    const form = document.getElementById(presetKind === 'rune' ? 'rune-form' : 'item-form');
    const draft = presetKind === 'rune' ? runeDraft : itemDraft;
    if (!form || !draft) return;
    for (const [key, value] of new FormData(form)) {
      if (/^perk[0-8]$/.test(key)) draft.selectedPerkIds[number(key.slice(4))] = number(value);
      else draft[key] = key === 'name' ? value : number(value);
    }
  }
  async function persistSettings(settings) {
    const result = await invoke('saveSettings', settings);
    if (result && result.connection) ingest(result);
    else state.settings = result && result.runePresets ? result : settings;
    await reloadState();
  }
  function findPreset(id) { return (presetKind === 'rune' ? state.settings.runePresets || [] : state.settings.itemSets || []).find(preset => String(preset.id) === String(id)); }
  async function loadHistory(puuid, begin = 0) {
    historyFilters={result:'all',queue:'all',hero:'all'};
    history.loading = true; history.error = ''; history.searched = true;
    if (page === 'history') renderPage();
    try {
      const data = await invoke('getHistory', puuid, begin);
      history.games = data.games || [];
      history.begin = data.begin != null ? data.begin : begin;
      history.end = data.end != null ? data.end : begin + history.games.length;
      if (data.summoner) history.summoner = Object.assign({}, history.summoner || {}, data.summoner);
    } catch (error) { history.error = error.message; history.games = []; } finally { history.loading = false; if (page === 'history') renderPage(); }
  }
  async function searchHistory(query) {
    historyFilters={result:'all',queue:'all',hero:'all'};
    history.query = query.trim(); history.loading = true; history.error = ''; history.searched = true; history.summoner = null; history.games = [];
    if (page === 'history') renderPage();
    try {
      const data = await invoke('searchSummoner', history.query);
      history.summoner = data.summoner;
      history.rankedInfo = data.rankedInfo;
      if (data.history) {
        history.games = Array.isArray(data.history) ? data.history : data.history.games || [];
        if (!Array.isArray(history.games)) history.games = history.games.games || [];
        history.begin = 0; history.end = history.games.length;
      }
      if (history.summoner && history.summoner.puuid && !history.games.length) {
        const records = await invoke('getHistory', history.summoner.puuid, 0);
        history.games = records.games || []; history.begin = records.begin || 0; history.end = records.end || history.games.length;
      }
    } catch (error) { history.error = error.message; } finally { history.loading = false; if (page === 'history') renderPage(); }
  }
  function matchDetailHtml(game) {
    const identities = new Map((game.participantIdentities || []).map(item => [item.participantId, item.player || {}]));
    const participants = game.participants || [];
    const teams = [...new Set(participants.map(item => item.teamId || 100))].sort();
    return `<p class="dialog-game-meta">${esc(queueName(game.queueId))} · ${duration(game.gameDuration || game.duration)} · ${esc(dateText(game.gameCreation || game.gameCreationDate || game.gameStartTimestamp))}</p>${participants.length ? `<div class="table-wrap"><table class="match-detail-table"><thead><tr><th>召唤师 / 英雄</th><th>K / D / A</th><th>伤害</th><th>补刀</th><th>金币</th></tr></thead><tbody>${teams.map(teamId => `<tr><td colspan="5" class="team-divider">${teamId === 100 ? '蓝色方' : teamId === 200 ? '红色方' : `队伍 ${teamId}`}</td></tr>${participants.filter(item => (item.teamId || 100) === teamId).map(participant => {
      const stats = participant.stats || {};
      const identity = identities.get(participant.participantId) || participant;
      return `<tr><td>${imageTag(heroImage(participant.championId))}${esc(playerName(identity))}<small class="muted"> · ${esc(heroName(participant.championId))}</small></td><td>${number(stats.kills)} / ${number(stats.deaths)} / ${number(stats.assists)}</td><td>${formatNumber(stats.totalDamageDealtToChampions)}</td><td>${formatNumber(number(stats.totalMinionsKilled) + number(stats.neutralMinionsKilled))}</td><td>${formatNumber(stats.goldEarned)}</td></tr>`;
    }).join('')}`).join('')}</tbody></table></div>` : empty('没有完整参赛数据', '客户端未返回此对局的参赛者详情。')}`;
  }

  document.addEventListener('error', event => {
    if (event.target && event.target.tagName === 'IMG' && event.target.dataset.art) { event.target.remove(); return; }
    if (event.target && event.target.tagName === 'IMG' && !event.target.dataset.fallback) {
      event.target.dataset.fallback = 'true';
      event.target.src = './assets/images/none.png';
    }
  }, true);
  document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.page) { await navigate(button.dataset.page); return; }
    const action = button.dataset.action;
    if (!action) return;
    await buttonTask(button, async () => {
      if (action === 'close-dialog') { dialog.close(); return; }
      if (action === 'refresh') { await refreshState(); renderPage(); toast(connected() ? '已刷新客户端连接' : state.connection.message || '客户端尚未连接'); return; }
      if (action === 'choose-lockfile') { const data = await invoke('chooseLockfile'); if (data && data.cancelled) return; await reloadState(); renderPage(); return; }
      if (action === 'export-config') { const data = await invoke('exportConfig'); if (!(data && data.cancelled)) toast('本地配置已导出'); return; }
      if (action === 'import-config') {
        const data = await invoke('importConfig'); if (data && data.cancelled) return;
        await reloadState(); hydrateClientDraft(); clientDirty=false; autoDraft = null; autoDirty = false; runeDraft = null; itemDraft = null; renderPage(); toast('本地配置已导入'); return;
      }
      if (action === 'my-history') {
        if (!state.me || !state.me.puuid) throw new Error('客户端还未返回当前召唤师信息，请刷新连接。');
        history.summoner = state.me; history.rankedInfo = state.me.rankedInfo; history.query = playerName(state.me); await loadHistory(state.me.puuid); return;
      }
      if (action === 'player-history') {
        history.summoner = [...(state.teams.myTeam || []), ...(state.teams.enemyTeam || [])].find(player => player.puuid === button.dataset.puuid) || {puuid: button.dataset.puuid, displayName: button.dataset.name};
        history.rankedInfo = history.summoner.rankedInfo; history.query = playerName(history.summoner); await navigate('history'); await loadHistory(button.dataset.puuid); return;
      }
      if (action === 'history-prev' || action === 'history-next') { await loadHistory(history.summoner.puuid, Math.max(0, history.begin + (action === 'history-next' ? 20 : -20))); return; }
      if (action === 'match-detail') { const game = await invoke('getMatch', number(button.dataset.game)); showDialog('对局详情', matchDetailHtml(game)); return; }
      if (action === 'player-detail') {
        const player=(state.teams[button.dataset.team]||[])[number(button.dataset.index)];if(!player)return;
        const aggregate=playerAggregate(player),role=boardRoles.find(([key])=>key===normalizedRole(player));
        showDialog(playerName(player),`<div class="catalog-info">${imageTag(heroImage(player.championId),'','')}<div><h2>${esc(heroName(player.championId))}</h2><p>${esc(role?role[1]:'位置未公开')} · ${esc(rankText(player.rankedInfo))}</p></div></div><div class="player-detail-summary"><div><small>近期胜率</small><strong class="num">${aggregate.rate!=null?`${aggregate.rate}%`:'—'}</strong></div><div><small>近期 KDA</small><strong class="num">${aggregate.kda!=null?aggregate.kda.toFixed(2):'—'}</strong></div><div><small>场均补刀</small><strong class="num">${aggregate.cs!=null?Math.round(aggregate.cs):'—'}</strong></div><div><small>场均伤害</small><strong class="num">${aggregate.damage!=null?formatNumber(aggregate.damage):'—'}</strong></div></div>${aggregate.records.length?`<div class="table-wrap"><table class="data-table history-table"><thead><tr><th>日期</th><th>模式</th><th>英雄</th><th>结果</th><th>K / D / A</th><th>时长</th><th class="col-performance">补刀</th><th>操作</th></tr></thead><tbody>${(player.matchHistory||[]).slice(0,10).map(game=>matchRow(game,player.puuid)).join('')}</tbody></table></div>`:empty('暂无公开的近期战绩','客户端尚未返回记录，或玩家身份未公开。')}`);return;
      }
      if (action === 'build-position') {
        const position = button.dataset.position;
        buildPage.mode = position === 'none' ? 'aram' : 'ranked'; buildPage.position = position === 'none' ? '' : position; buildPage.build = null;
        await loadBuild(); return;
      }
      if (action === 'build-rune' || action === 'build-spells' || action === 'build-items') {
        const build = buildFor(button.dataset.source); if (!build) throw new Error('推荐数据已更新，请重试。');
        const name = `OP.GG ${heroName(build.championId)}${build.position !== 'none' ? ` ${positionNames[build.position] || ''}` : ' 大乱斗'}`;
        if (action === 'build-rune') {
          const runePage = build.runes[number(button.dataset.index)]; if (!runePage) throw new Error('未找到这套符文。');
          await invoke('applyRune', {name, championId: build.championId, primaryStyleId: runePage.primaryStyleId, subStyleId: runePage.subStyleId, selectedPerkIds: runePage.selectedPerkIds});
          toast('符文已应用到客户端');
        } else if (action === 'build-spells') {
          const entry = build.spells[number(button.dataset.index)]; if (!entry || entry.ids.length !== 2) throw new Error('未找到这组召唤师技能。');
          await invoke('applySpells', {spell1Id: entry.ids[0], spell2Id: entry.ids[1]}); toast('召唤师技能已应用');
        } else {
          await invoke('applyBuildItems', {championId: build.championId, title: name, blocks: itemBlocks(build).map(([type, entry]) => ({type, items: entry.ids}))});
          toast('出装已导入客户端商店');
        }
        return;
      }
      if (action === 'sync-gamedata') {
        const info = await invoke('syncGameData'); state.gameData = info;
        if (info.version !== dataVersion) { dataVersion = info.version; await reloadGameData(); } else renderPage();
        toast(`游戏数据已是 ${info.version}`); return;
      }
      if (action === 'automation-revert') { autoDraft = null; autoDirty = false; renderPage(); return; }
      if (action.startsWith('priority-')) {
        captureAuto();
        const type = button.dataset.type, role = button.dataset.role;
        const ids = autoDraft[type][role];
        const index = number(button.dataset.index);
        if (action === 'priority-add') {
          const select = document.getElementById(`priority-${type}-${role}`);
          if (!select.value) return;
          const id = number(select.value);
          if (ids.includes(id)) { toast('此英雄已在列表中'); return; }
          if (ids.length >= 20) throw new Error('每个分路最多设置 20 个英雄。');
          ids.push(id);
        } else if (action === 'priority-remove') ids.splice(index, 1);
        else { const next = index + number(button.dataset.direction); if (next >= 0 && next < ids.length) [ids[index], ids[next]] = [ids[next], ids[index]]; }
        autoDirty=true;
        renderPage(); return;
      }
      if (action === 'catalog-kind') {
        catalogKind = button.dataset.kind; catalogPage = 0; catalogQuery = ''; catalogSelectedId=''; renderPage(); await getCatalog(catalogKind); if (page === 'catalog') updateCatalogResults(); return;
      }
      if (action === 'catalog-prev' || action === 'catalog-next') { catalogPage += action === 'catalog-next' ? 1 : -1; updateCatalogResults(); return; }
      if (action === 'catalog-detail') { catalogDetail(button.dataset.id); return; }
      if (action === 'preset-kind') { capturePreset(); presetKind = button.dataset.kind; renderPage(); return; }
      if (action === 'preset-new') { if (presetKind === 'rune') runeDraft = initialRune(); else {itemDraft = null; itemQuery = '';} renderPage(); return; }
      if (action === 'preset-edit') { const preset = findPreset(button.dataset.id); if (!preset) return; if (presetKind === 'rune') { runeDraft = clone(preset); adjustRune(runeDraft, false, false); } else itemDraft = clone(preset); renderPage(); return; }
      if (action === 'preset-delete') {
        const key = presetKind === 'rune' ? 'runePresets' : 'itemSets';
        await persistSettings(Object.assign({}, settingsValue(), {[key]: (state.settings[key] || []).filter(preset => String(preset.id) !== String(button.dataset.id))}));
        if (presetKind === 'rune' && runeDraft && runeDraft.id === button.dataset.id) runeDraft = null;
        if (presetKind === 'item' && itemDraft && itemDraft.id === button.dataset.id) itemDraft = null;
        renderPage(); toast('本地方案已删除'); return;
      }
      if (action === 'preset-apply' || action === 'preset-spells') {
        const preset = findPreset(button.dataset.id); if (!preset) throw new Error('未找到已保存的方案。');
        if (action === 'preset-spells') { await invoke('applySpells', {spell1Id: preset.spell1Id, spell2Id: preset.spell2Id}); toast('召唤师技能已应用'); }
        else if (presetKind === 'rune') { await invoke('applyRune', preset); toast('符文方案已应用到客户端'); }
        else { await invoke('applyItemSet', preset); toast('出装方案已导入客户端商店'); }
        return;
      }
      if (action.startsWith('item-')) {
        capturePreset();
        if (action === 'item-add') { if (itemDraft.items.length >= 30) throw new Error('每份出装最多添加 30 项装备。'); itemDraft.items.push(number(button.dataset.id)); }
        else if (action === 'item-remove') itemDraft.items.splice(number(button.dataset.index), 1);
        else if (action === 'item-move') { const index = number(button.dataset.index), next = index + number(button.dataset.direction); if (next >= 0 && next < itemDraft.items.length) [itemDraft.items[index], itemDraft.items[next]] = [itemDraft.items[next], itemDraft.items[index]]; }
        renderPage(); return;
      }
      if (action === 'client-read') {
        const data = await invoke('getClientSettings');
        clientDraft.game = JSON.stringify(data.game || {}, null, 2); clientDraft.input = JSON.stringify(data.input || {}, null, 2); clientRead = true; clientDirty=false; renderPage(); toast('已读取客户端配置'); return;
      }
      if (action === 'client-save') {
        clientDraft[clientKind] = document.getElementById('client-json').value;
        let data;
        try { data = JSON.parse(clientDraft[clientKind]); } catch { throw new Error('JSON 格式无效，请检查逗号、引号和括号。'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('配置的最外层必须是 JSON 对象。');
        await invoke('saveClientSettings', {kind: clientKind, data}); clientDirty=false; renderPage(); toast('配置已保存到客户端'); return;
      }
      if(action==='client-sync-json'){
        const data=clientDocument();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('JSON 格式无效，请检查逗号、引号和括号。');
        const fields=document.getElementById('client-fields');if(fields)fields.innerHTML=clientGroupsHtml();toast('上方表单已更新，尚未写入客户端');return;
      }
    });
  });
  document.addEventListener('input', event => {
    if (event.target.closest('#automation-form')&&event.target.type==='number') captureAuto();
    if (event.target.id === 'catalog-search') { catalogQuery = event.target.value; catalogPage = 0; updateCatalogResults(); }
    if (event.target.id === 'item-search') { itemQuery = event.target.value; const picker = document.getElementById('item-picker'); if (picker) picker.innerHTML = itemPickerHtml(); }
    if (event.target.closest('#rune-form') || event.target.closest('#item-form')) capturePreset();
    if(event.target.dataset.clientPath)updateClientField(event.target);
    if (event.target.id === 'client-json') {clientDraft[clientKind] = event.target.value;clientDirty=true;const status=document.getElementById('client-dirty');if(status){status.textContent='有未保存的修改';status.classList.add('unsaved');}}
  });
  document.addEventListener('change', async event => {
    if(event.target.closest('#automation-form')&&event.target.type==='checkbox'){await setAutoToggle(event.target.name,event.target.checked);return;}
    if(event.target.id==='priority-type'||event.target.id==='priority-role'){captureAuto();if(event.target.id==='priority-type')autoType=event.target.value;else autoRole=event.target.value;renderPage();return;}
    if(event.target.dataset.historyFilter){historyFilters[event.target.dataset.historyFilter]=event.target.value;const results=document.getElementById('history-results');if(results)results.innerHTML=historyResultsHtml();return;}
    if (event.target.id === 'client-kind') { clientKind = event.target.value; renderPage(); return; }
    if (event.target.id === 'build-hero') { buildPage.championId = event.target.value; buildPage.build = null; if (buildPage.mode !== 'aram') buildPage.position = ''; await loadBuild(); return; }
    if (event.target.id === 'opgg-region' || event.target.id === 'opgg-tier' || event.target.id === 'online-data') {
      const key = event.target.id === 'opgg-region' ? 'opggRegion' : event.target.id === 'opgg-tier' ? 'opggTier' : 'onlineData';
      const value = key === 'onlineData' ? event.target.checked : event.target.value;
      try { await persistSettings(Object.assign({}, settingsValue(), {[key]: value})); } catch (error) { toast(error.message, true); renderPage(); return; }
      if (page === 'builds') { buildPage.build = null; await loadBuild(); } else renderPage();
      return;
    }
    if (event.target.closest('#rune-form')) {
      capturePreset();
      const key = event.target.name;
      if (key === 'primaryStyleId' || key === 'subStyleId') { adjustRune(runeDraft, key === 'primaryStyleId', true); renderPage(); }
      else if (key === 'perk4' || key === 'perk5') renderPage();
    }
  });
  document.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    await buttonTask(button, async () => {
      if (form.id === 'history-form') { const query = new FormData(form).get('query'); if (!String(query).trim()) throw new Error('请输入召唤师名称或 Riot ID。'); await searchHistory(String(query)); }
      else if (form.id === 'automation-form') {
        if(autoBusy)throw new Error('开关正在保存，请稍后再保存列表。');
        captureAuto();await persistSettings(Object.assign({},settingsValue(),{acceptDelaySec:autoDraft.acceptDelaySec,startDelaySec:autoDraft.startDelaySec,againDelaySec:autoDraft.againDelaySec,picks:autoDraft.picks,bans:autoDraft.bans}));
        autoDraft = null; autoDirty = false; renderPage(); toast('延迟与英雄列表已保存');
      } else if (form.id === 'rune-form' || form.id === 'item-form') {
        capturePreset();
        const draft = clone(presetKind === 'rune' ? runeDraft : itemDraft);
        draft.name = String(draft.name || '').trim();
        if (!draft.name) throw new Error('请为方案填写名称。');
        if (presetKind === 'rune') {
          if (draft.selectedPerkIds.length !== 9 || draft.selectedPerkIds.some(id => !findCatalog('runes', id))) throw new Error('请完成 4 枚主系符文、2 枚副系符文与 3 枚属性碎片。');
          if (draft.primaryStyleId === draft.subStyleId) throw new Error('主系与副系必须不同。');
          const primary = runeGroups[draft.primaryStyleId];
          const secondary = runeGroups[draft.subStyleId];
          if (!primary || !secondary || primary.some((group, index) => !group.includes(draft.selectedPerkIds[index]))) throw new Error('请按主系每行各选一枚符文。');
          const firstRow = secondary.findIndex(group => group.includes(draft.selectedPerkIds[4]));
          const secondRow = secondary.findIndex(group => group.includes(draft.selectedPerkIds[5]));
          if (firstRow < 1 || secondRow < 1 || firstRow === secondRow) throw new Error('副系符文必须来自不同的两行。');
          if (draft.spell1Id === draft.spell2Id) throw new Error('D 键与 F 键的召唤师技能必须不同。');
        } else if (!draft.items.length) throw new Error('请至少添加一件装备。');
        if (!draft.id) draft.id = `${presetKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const key = presetKind === 'rune' ? 'runePresets' : 'itemSets';
        const list = (state.settings[key] || []).filter(preset => preset.id !== draft.id);
        list.push(draft);
        await persistSettings(Object.assign({}, settingsValue(), {[key]: list}));
        if (presetKind === 'rune') runeDraft = draft; else itemDraft = draft;
        renderPage(); toast('方案已保存到本机');
      } else if (form.id === 'profile-form') {
        const values = new FormData(form);
        const payload = {availability:String(values.get('availability')||''),statusMessage: String(values.get('statusMessage') || '')};
        await invoke('setProfile', payload); toast('状态与签名已应用');
      } else if (form.id === 'lobby-form') { await invoke('createLobby', number(new FormData(form).get('queueId'))); toast('游戏房间已创建'); }
    });
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
  document.addEventListener('toggle',event=>{if(event.target.id==='client-advanced')clientAdvancedOpen=event.target.open;},true);
  window.addEventListener('beforeunload', () => { if (typeof unsubscribe === 'function') unsubscribe(); });

  (async () => {
    try {
      if (api && typeof api.onState === 'function') unsubscribe = api.onState(ingest);
      await reloadState();
      await loadRuneLayout();
      hydrateClientDraft();
      renderPage();
      await Promise.all(['heroes', 'items', 'runes', 'spells'].map(getCatalog));
      if (page === 'dashboard') renderPage();
    } catch (error) {
      if (!ready) { loadError = error.message; updateHeader(); renderPage(); }
      else toast('部分本地资料未能读取，请重新打开该分类。', true);
    }
  })();
})();




