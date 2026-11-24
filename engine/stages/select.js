// engine/stages/select.js
// Weekly selection (preview in shadow mode): up to 5 Primary Picks and up to
// 10 Secondary Watchlist names. Quality over quantity — never fills slots
// with names that miss the bar. Caps sector concentration and skips names
// highly correlated with ones already selected.

'use strict';

const cfg = require('../config');

function returns(closes) {
  const out = [];
  for (let i = 1; i < (closes || []).length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return 0;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// cands: [{symbol, industry, conviction, entry, levels, closes63}]
function select(cands, marketPosture) {
  const S = cfg.selection;
  const maxPrimary = marketPosture === 'bear' ? S.maxPrimaryInWeakMarket : S.maxPrimary;
  const pool = cands
    .filter((c) => c.conviction != null && c.entry != null && c.levels)
    .map((c) => ({ ...c, _rank: S.convictionWeight * c.conviction + (1 - S.convictionWeight) * c.entry, _ret: returns(c.closes63) }))
    .sort((a, b) => b._rank - a._rank || a.symbol.localeCompare(b.symbol));

  const chosen = [];
  const skipped = [];
  const sectorCount = {};
  const tryAdd = (c, tier, cap) => {
    const sec = c.industry || 'Unknown';
    if ((sectorCount[sec] || 0) >= cap) { skipped.push({ symbol: c.symbol, reason: `sector_cap:${sec}` }); return false; }
    const twin = chosen.find((x) => corr(x._ret, c._ret) > S.maxCorrelation);
    if (twin) { skipped.push({ symbol: c.symbol, reason: `correlated_with:${twin.symbol}` }); return false; }
    chosen.push({ ...c, tier });
    sectorCount[sec] = (sectorCount[sec] || 0) + 1;
    return true;
  };

  const byConviction = pool.slice().sort((a, b) => b.conviction - a.conviction || a.symbol.localeCompare(b.symbol));
  for (const c of byConviction) {
    if (chosen.filter((x) => x.tier === 1).length >= maxPrimary) break;
    if (c.conviction >= S.primaryMinConviction && c.entry >= S.primaryMinEntry && c.levels.riskReward >= S.primaryMinRR && !S.primaryExcludeRisk.includes(c.riskClass)) {
      tryAdd(c, 1, S.primarySectorCap);
    }
  }
  let focusAdded = 0;
  for (const c of pool) {
    if (focusAdded >= S.inFocusWatchSlots) break;
    if (c.lane !== 'in_focus' || chosen.some((x) => x.symbol === c.symbol)) continue;
    if (c.conviction >= S.inFocusMinConviction && c.levels.riskReward >= S.watchMinRR && tryAdd(c, 2, S.totalSectorCap)) focusAdded++;
  }
  for (const c of pool) {
    if (chosen.filter((x) => x.tier === 2).length >= S.maxWatchlist) break;
    if (chosen.some((x) => x.symbol === c.symbol)) continue;
    if (c.conviction >= S.watchMinConviction && c.levels.riskReward >= S.watchMinRR) tryAdd(c, 2, S.totalSectorCap);
  }
  const strip = ({ _rank, _ret, closes63, ...rest }) => rest;
  return { picks: chosen.map(strip), skipped, maxPrimary };
}

module.exports = { select, corr };
