// engine/stages/daily-rank.js
// Daily Top 20 — bullish-momentum ranking (methodology in config).
// Deterministic: every number comes from verified market data; every
// explanation is generated from those numbers. Headlines are untrusted
// third-party text: they are shown as dated, attributed quotes, never
// rewritten into claims.
'use strict';

const cfg = require('../config');
const optionsStage = require('./options');

const clamp = (x) => Math.max(0, Math.min(100, x));
const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1) + '%';
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const etDate = (iso) => (iso ? ET_DATE.format(new Date(iso)) : null);

const TAG_LABEL = {
  upgrade: 'analyst upgrade / price-target raise', guidanceRaise: 'guidance raise', beat: 'results above estimates',
  contract: 'contract or partnership win', buyback: 'buyback', approval: 'regulatory approval', ma: 'merger or acquisition',
  downgrade: 'analyst downgrade / price-target cut', guidanceCut: 'guidance cut or warning', miss: 'results below estimates',
  offering: 'share offering / dilution', legal: 'lawsuit or investigation',
};

// Display name: drop only a trailing "Common Stock" label. Share-class wording
// ("Alphabet Inc. Class A") and the ticker are kept exactly.
function displayName(name) {
  if (name == null) return name;
  const s = String(name).replace(/\s+Common Stock\s*$/i, '').trim();
  return s || String(name);
}

function eligible(f) {
  const E = cfg.eligibility;
  const reasons = [];
  if (E.aboveEma20 && !(f.price > f.ema20)) reasons.push('below 20-day average');
  if (E.ema20AboveEma50 && !(f.ema20 > f.ema50)) reasons.push('20-day average below 50-day');
  if (!(f.ret5 > E.minRet5)) reasons.push('5-day return not positive');
  if (!(f.rsi14 >= E.minRsi && f.rsi14 <= E.maxRsi)) reasons.push('RSI outside momentum range');
  return reasons;
}

function percentileMap(values) {
  const vals = values.filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
  const n = vals.length;
  return (v) => {
    if (v == null || !isFinite(v) || !n) return null;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    let eq = lo; while (eq < n && vals[eq] === v) eq++;
    return ((lo + eq) / 2 / n) * 100;
  };
}

function rsiScore(x) {
  if (x == null) return null;
  if (x >= 55 && x <= 70) return 100;
  if (x > 70 && x <= 75) return 70;
  if (x > 75) return 40;
  return 65; // 50–55
}

function trendScore(f) {
  const base = { bull: 90, 'lean-bull': 70, mixed: 50, 'lean-bear': 30, bear: 10 }[f.posture];
  if (base == null) return null;
  return clamp(base + (f.weeklyAligned === true ? 10 : f.weeklyAligned === false ? -10 : 0));
}

// Catalysts: confirmed (earnings calendar) vs headline-reported (tagged,
// dated, attributed). Negative headlines are listed as cautions.
function catalysts(row, tradingDate) {
  const confirmed = [];
  if (row.earnings && row.earnings.date >= tradingDate) {
    confirmed.push({ type: 'earnings', date: row.earnings.date, timing: row.earnings.hour || null, source: 'Finnhub earnings calendar' });
  }
  const reported = [];
  const cautions = [];
  for (const h of (row.attention && row.attention.headlines) || []) {
    for (const t of h.tagsPos || []) reported.push({ type: t, label: TAG_LABEL[t] || t, date: etDate(h.createdAt), source: h.source, headline: h.headline, url: h.url });
    for (const t of h.tagsNeg || []) cautions.push({ type: t, label: TAG_LABEL[t] || t, date: etDate(h.createdAt), source: h.source, headline: h.headline, url: h.url });
  }
  const none = !confirmed.length && !reported.length;
  return {
    confirmed, reported: reported.slice(0, 4), cautions: cautions.slice(0, 3), none,
    noneText: none ? `No verified catalyst: no earnings date in the next ${cfg.earnings.lookaheadDays} days and no catalyst-type headline in the last ${cfg.news.recentDays} days.` : null,
  };
}

function catalystScore(cat) {
  let s = 50 + Math.min(30, cat.reported.length * 10) - Math.min(40, cat.cautions.length * 12);
  if (cat.confirmed.length) s += 10;
  return clamp(s);
}

function driverText(k, row, cat) {
  const f = row.features, a = row.attention, o = row.options;
  switch (k) {
    case 'priceMomentum': return `Up ${sgn(f.ret5)} over 5 sessions and ${sgn(f.ret21)} over 21 sessions`;
    case 'relVolume': return `Last session volume ${f.rvol}× its 20-day average`;
    case 'attention': return a ? `${a.recentCount} article${a.recentCount === 1 ? '' : 's'} in the last ${cfg.news.recentDays} days (${a.surge}× its prior pace)${row.mostActive ? '; on Alpaca most-active lists' : ''}` : `No articles in the last ${cfg.news.recentDays} days${row.mostActive ? '; on Alpaca most-active lists' : ''}`;
    case 'relStrength': return `${f.relStrength63 >= 0 ? 'Outperformed' : 'Underperformed'} SPY by ${Math.abs(f.relStrength63).toFixed(1)} points over 63 sessions`;
    case 'rsi': return `RSI(14) ${f.rsi14}`;
    case 'trend': return f.posture === 'bull' ? 'Price above its 20-, 50- and 200-day averages, stacked in order' : `Price above its 20-day average (trend structure: ${f.posture})`;
    case 'catalysts': {
      const parts = [];
      if (cat.confirmed.length) parts.push(`earnings scheduled ${cat.confirmed[0].date}${cat.confirmed[0].timing ? ` (${cat.confirmed[0].timing})` : ''}`);
      if (cat.reported.length) parts.push(`${cat.reported.length} catalyst-type headline${cat.reported.length > 1 ? 's' : ''}`);
      if (cat.cautions.length) parts.push(`${cat.cautions.length} negative headline${cat.cautions.length > 1 ? 's' : ''}`);
      return parts.length ? parts.join('; ') : 'No verified catalyst';
    }
    case 'options': return o && o.available ? `Prior-session call volume ${o.callPutRatio}× put volume${o.unusual === 'calls' ? ' (unusual call activity)' : o.unusual === 'puts' ? ' (unusual put activity)' : ''}` : 'Options activity not available';
    default: return k;
  }
}

// rows: [{symbol, name, industry, features, attention, mostActive, earnings, options}]
function rank(rows, tradingDate) {
  const elig = [];
  const excluded = {};
  for (const r of rows) {
    const why = eligible(r.features);
    if (r.pendingBuyout) why.push('confirmed pending buyout');
    if (why.length) { for (const w of why) excluded[w] = (excluded[w] || 0) + 1; continue; }
    elig.push(r);
  }
  const mom = (f) => (f.ret5 != null && f.ret21 != null ? 0.5 * f.ret5 + 0.5 * f.ret21 : null);
  const att = (r) => (r.attention ? Math.log1p(r.attention.recentWeighted) * Math.min(3, r.attention.surge) : 0) + (r.mostActive ? 0.5 : 0);
  const pMom = percentileMap(elig.map((r) => mom(r.features)));
  const pVol = percentileMap(elig.map((r) => r.features.rvol));
  const pAtt = percentileMap(elig.map(att));
  const pRs = percentileMap(elig.map((r) => r.features.relStrength63));
  const W = cfg.weights;

  const scored = elig.map((r) => {
    const cat = catalysts(r, tradingDate);
    const comp = {
      priceMomentum: pMom(mom(r.features)), relVolume: pVol(r.features.rvol), attention: pAtt(att(r)),
      relStrength: pRs(r.features.relStrength63), rsi: rsiScore(r.features.rsi14), trend: trendScore(r.features),
      catalysts: catalystScore(cat), options: optionsStage.score(r.options),
    };
    let den = 0;
    for (const [k, w] of Object.entries(W)) if (comp[k] != null) den += w;
    const drivers = Object.entries(W).filter(([k]) => comp[k] != null).map(([k, w]) => ({
      factor: k, points: r1((w / den) * comp[k]), componentScore: r1(comp[k]), weightPct: r1((w / den) * 100), text: driverText(k, r, cat),
    })).sort((a, b) => b.points - a.points);
    const score = r1(drivers.reduce((s, d) => s + d.points, 0));
    return { r, cat, comp, drivers, score, coveragePct: r1(den) };
  });
  scored.sort((a, b) => b.score - a.score || a.r.symbol.localeCompare(b.r.symbol));
  return { eligibleCount: elig.length, excluded, scored };
}

// Published entry for one ranked stock.
function entry(x, rankNo) {
  const f = x.r.features;
  const hl = ((x.r.attention && x.r.attention.headlines) || []).slice(0, cfg.news.showHeadlines).map((h) => ({ date: etDate(h.createdAt), publishedAt: h.createdAt, source: h.source, headline: h.headline, url: h.url }));
  return {
    rank: rankNo,
    ticker: x.r.symbol,
    company: displayName(x.r.name),
    sector: x.r.industry || null,
    score: x.score,
    coveragePct: x.coveragePct,
    lastClose: f.price,
    stats: { ret1: f.ret1, ret5: f.ret5, ret21: f.ret21, rsi14: f.rsi14, rvol: f.rvol, atrPct: f.atrPct, relStrength63: f.relStrength63, pctFromHigh52: f.pctFromHigh52, trend: f.posture },
    drivers: x.drivers,
    topDrivers: x.drivers.slice(0, 3).map((d) => d.text),
    catalysts: x.cat,
    headlines: hl,
    news: x.r.attention ? { recentCount: x.r.attention.recentCount, surge: x.r.attention.surge, windowDays: cfg.news.recentDays } : { recentCount: 0, surge: null, windowDays: cfg.news.recentDays },
    options: x.r.options || { available: false, reason: 'not requested' },
    mostActive: Boolean(x.r.mostActive),
  };
}

module.exports = { rank, entry, eligible, catalysts, rsiScore, trendScore, percentileMap, displayName, TAG_LABEL };
