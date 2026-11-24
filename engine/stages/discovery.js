// engine/stages/discovery.js
// d0 discovery rank (SHADOW ONLY). Combines attention, catalysts, trend,
// momentum, relative strength and analysts into a 0–100 ranking used to
// decide which names get researched further. This is NOT the published
// Conviction or Entry Score — those are Phase 2 (versioned, backtested).

'use strict';

const cfg = require('../config');

function percentileMap(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
  const n = vals.length;
  return (v) => {
    if (v == null || !isFinite(v) || !n) return null;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    let eq = lo;
    while (eq < n && vals[eq] === v) eq++;
    return ((lo + eq) / 2 / n) * 100; // mid-rank percentile
  };
}

function trendScore(f) {
  const base = { bull: 90, 'lean-bull': 70, mixed: 50, 'lean-bear': 30, bear: 10 }[f.posture];
  if (base == null) return null;
  const adj = f.weeklyAligned === true ? 10 : f.weeklyAligned === false ? -10 : 0;
  return Math.max(0, Math.min(100, base + adj));
}

// RSI regime: healthy momentum scores best; extended and broken score low.
function momentumScore(f) {
  if (f.rsi14 == null) return null;
  const x = f.rsi14;
  let s;
  if (x >= 50 && x <= 68) s = 85;
  else if (x > 68 && x <= 75) s = 65;
  else if (x > 75) s = 35;
  else if (x >= 40) s = 55;
  else if (x >= 30) s = 35;
  else s = 25;
  if (f.macdHist != null) s += f.macdHist > 0 ? 10 : -10;
  return Math.max(0, Math.min(100, s));
}

// Analyst consensus level (latest month) and drift vs ~3 months earlier.
function analystScore(recs) {
  if (!recs || !recs.length) return null;
  const lvl = (r) => {
    const n = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
    if (!n) return null;
    return { n, v: (2 * r.strongBuy + r.buy - r.sell - 2 * r.strongSell) / n }; // −2..+2
  };
  const now = lvl(recs[0]);
  if (!now || now.n < 3) return null; // too few analysts to mean anything
  const then = recs[3] ? lvl(recs[3]) : null;
  const drift = then ? now.v - then.v : 0;
  const s = 50 + now.v * 20 + Math.max(-1, Math.min(1, drift)) * 15;
  return { score: Math.max(0, Math.min(100, s)), analysts: now.n, consensus: Math.round(now.v * 100) / 100, drift3m: Math.round(drift * 100) / 100 };
}

function catalystScore(att, earnings) {
  const pos = att ? Object.values(att.tagsPos).reduce((a, b) => a + b, 0) : 0;
  const neg = att ? Object.values(att.tagsNeg).reduce((a, b) => a + b, 0) : 0;
  let s = 50 + Math.min(30, pos * 8) - Math.min(40, neg * 10);
  if (earnings) s += 5; // a dated catalyst; also flagged as an event risk
  return Math.max(0, Math.min(100, s));
}

// rows: [{symbol, features, attention, analysts, earnings, mostActive}]
function rank(rows) {
  const W = cfg.weights;
  const prepped = rows.map((r) => ({
    ...r,
    _att: r.attention ? Math.log1p(r.attention.weighted7) * Math.min(3, r.attention.surge) + (r.mostActive ? 0.5 : 0) : 0,
    _rs: r.features.relStrength63,
  }));
  const pAtt = percentileMap(prepped, '_att');
  const pRs = percentileMap(prepped, '_rs');

  const scored = prepped.map((r) => {
    const an = analystScore(r.analysts);
    const comp = {
      attention: pAtt(r._att),
      catalysts: catalystScore(r.attention, r.earnings),
      trend: trendScore(r.features),
      momentum: momentumScore(r.features),
      relStrength: pRs(r._rs),
      analysts: an ? an.score : null,
    };
    let num = 0, den = 0;
    for (const [k, w] of Object.entries(W)) {
      if (comp[k] != null) { num += comp[k] * w; den += w; }
    }
    const score = den ? num / den : null;
    const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
    const { _att, _rs, ...rest } = r;
    return {
      ...rest,
      analystSummary: an,
      components: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, round1(v)])),
      coverage: Math.round(den),
      discoveryScore: round1(score),
    };
  });
  scored.sort((a, b) => (b.discoveryScore ?? -1) - (a.discoveryScore ?? -1) || a.symbol.localeCompare(b.symbol));
  scored.forEach((r, i) => { r.discoveryRank = i + 1; });
  return scored;
}

module.exports = { rank, analystScore, momentumScore, trendScore, catalystScore, percentileMap };
