'use strict';
// Draft win-rate estimate from public champion statistics.
// Each lane contributes a log-odds score: the head-to-head record when OP.GG has enough games for that pairing,
// otherwise the gap between the two champions' own win rates. Small samples are pulled toward the expected value,
// and the total is damped because a draft explains only a small part of a game's result.
const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const CHAMPION_PRIOR = 1500; // games of 50% blended into each champion's win rate
const MATCHUP_PRIOR = 300;   // games of the expected result blended into each head-to-head record
const FORM_PRIOR = 10;       // games of 50% blended into a player's recent record
const FORM_WEIGHT = 0.08;
const DAMPING = 0.6;
const LIMIT = 0.75;

const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function championRate(meta, championId, position) {
  const champion = meta && meta.champions && meta.champions[championId];
  if (!champion) return { winRate: null, play: 0 };
  const stats = position && champion.positions[position] && champion.positions[position].play ? champion.positions[position] : champion;
  return { winRate: stats.winRate, play: stats.play || 0 };
}
function strength(meta, championId, position) {
  const { winRate, play } = championRate(meta, championId, position);
  if (winRate == null) return { score: 0, winRate: null, play: 0 };
  const smoothed = (winRate * play + 0.5 * CHAMPION_PRIOR) / (play + CHAMPION_PRIOR);
  return { score: logit(clamp(smoothed, 0.01, 0.99)), winRate, play };
}

// Fill unknown positions with the arrangement that best matches how often each champion plays each role.
function assignPositions(players, meta) {
  const fixed = new Map(); const open = [];
  players.forEach((player, index) => { if (POSITIONS.includes(player.position) && ![...fixed.values()].includes(player.position)) fixed.set(index, player.position); else open.push(index); });
  const free = POSITIONS.filter(position => ![...fixed.values()].includes(position));
  const fit = (index, position) => {
    const champion = meta && meta.champions && meta.champions[players[index].championId];
    const stats = champion && champion.positions[position];
    return Math.log((stats && stats.roleRate || 0) + 0.01);
  };
  let best = null; let bestScore = -Infinity;
  const permute = (left, chosen) => {
    if (chosen.length === Math.min(open.length, free.length)) {
      const score = chosen.reduce((total, position, k) => total + fit(open[k], position), 0);
      if (score > bestScore) { bestScore = score; best = chosen.slice(); }
      return;
    }
    left.forEach((position, k) => permute(left.filter((_, j) => j !== k), [...chosen, position]));
  };
  if (open.length <= 6) permute(free, []);
  const result = players.map((player, index) => fixed.get(index) || '');
  (best || []).forEach((position, k) => { result[open[k]] = position; });
  return result;
}

function headToHead(counters, enemyId) {
  const record = (counters || []).find(item => item.championId === enemyId);
  return record && record.play > 0 ? record : null;
}
function form(player) {
  const games = (player.recent || []).filter(game => typeof game === 'boolean');
  if (!games.length) return 0;
  const wins = games.filter(Boolean).length;
  return logit((wins + 0.5 * FORM_PRIOR) / (games.length + FORM_PRIOR));
}

// mine/enemy: [{championId, position?, recent?: boolean[]}], meta: OpggClient.meta(), counters: {championId: counters[]} for my champions.
function predict({ mine, enemy, meta, counters = {}, lanes = true }) {
  if (!Array.isArray(mine) || !Array.isArray(enemy) || !mine.length || !enemy.length) return null;
  let total = 0; const details = [];
  if (lanes && mine.length === 5 && enemy.length === 5) {
    const myPositions = assignPositions(mine, meta); const enemyPositions = assignPositions(enemy, meta);
    for (const position of POSITIONS) {
      const a = mine[myPositions.indexOf(position)]; const b = enemy[enemyPositions.indexOf(position)];
      if (!a || !b) continue;
      const sa = strength(meta, a.championId, position); const sb = strength(meta, b.championId, position);
      const expected = sigmoid(sa.score - sb.score);
      const record = headToHead(counters[a.championId], b.championId);
      const laneRate = record ? (record.win + expected * MATCHUP_PRIOR) / (record.play + MATCHUP_PRIOR) : expected;
      const score = logit(clamp(laneRate, 0.01, 0.99));
      total += score;
      details.push({ position, mine: { championId: a.championId, winRate: sa.winRate, play: sa.play }, enemy: { championId: b.championId, winRate: sb.winRate, play: sb.play }, laneWinRate: laneRate, games: record ? record.play : 0, source: record ? 'matchup' : 'champion' });
    }
  } else {
    for (const player of mine) total += strength(meta, player.championId, '').score;
    for (const player of enemy) total -= strength(meta, player.championId, '').score;
  }
  const formScore = FORM_WEIGHT * (mine.reduce((sum, player) => sum + form(player), 0) - enemy.reduce((sum, player) => sum + form(player), 0));
  const probability = clamp(sigmoid(DAMPING * (total + formScore)), 1 - LIMIT, LIMIT);
  return { probability, lanes: details, formScore, version: meta && meta.version || '', tier: meta && meta.tier, region: meta && meta.region, mode: meta && meta.mode };
}

module.exports = { predict, assignPositions, strength, POSITIONS };
