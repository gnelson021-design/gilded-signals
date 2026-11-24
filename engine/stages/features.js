// engine/stages/features.js
// Per-stock technical features from verified daily bars. Deterministic.

'use strict';

const ind = require('../lib/indicators');
const cfg = require('../config').universe;

const DAY = 86400000;

function computeOne(bars, spyCloses, now = Date.now()) {
  if (!bars || bars.length < cfg.minHistoryBars) {
    return { reject: 'insufficient_history', bars: bars ? bars.length : 0 };
  }
  const last = bars[bars.length - 1];
  const lastAt = new Date(last.t).getTime();
  if (!isFinite(lastAt) || now - lastAt > cfg.maxStaleDays * DAY) {
    return { reject: 'stale_data', lastBar: last.t };
  }
  const closes = bars.map((b) => b.c);
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const vols = bars.map((b) => b.v);
  const dates = bars.map((b) => b.t);
  if (closes.some((c) => !(c > 0))) return { reject: 'invalid_price' };

  const price = closes[closes.length - 1];
  const ema20 = ind.emaLast(closes, 20);
  const ema50 = ind.emaLast(closes, 50);
  const ema200 = ind.emaLast(closes, 200);
  const posture = ind.trendPosture({ price, ema20, ema50, ema200 });
  const mac = ind.macd(closes);
  const atr14 = ind.atr(highs, lows, closes, 14);
  const v20 = vols.slice(-20);
  const avgVol20 = v20.reduce((a, b) => a + b, 0) / v20.length;
  const yr = bars.slice(-252);
  const high52 = Math.max(...yr.map((b) => b.h));
  const low52 = Math.min(...yr.map((b) => b.l));
  const ret63 = ind.pctChangeOverN(closes, 63);
  const spy63 = spyCloses ? ind.pctChangeOverN(spyCloses, 63) : null;

  const r = (n, dp = 2) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);
  return {
    lastBar: last.t,
    price: r(price),
    ema20: r(ema20), ema50: r(ema50), ema200: r(ema200),
    posture,
    weeklyAligned: ind.weeklyTrendAligned(closes, dates, posture),
    rsi14: r(ind.rsi(closes, 14), 1),
    rsiCondition: ind.rsiCondition(ind.rsi(closes, 14)),
    macdHist: r(mac.hist, 3),
    atr14: r(atr14),
    atrPct: r(atr14 && price ? (atr14 / price) * 100 : null),
    ret5: r(ind.pctChangeOverN(closes, 5)),
    ret21: r(ind.pctChangeOverN(closes, 21)),
    ret63: r(ret63),
    relStrength63: r(ret63 != null && spy63 != null ? ret63 - spy63 : null),
    rvol: r(avgVol20 ? vols[vols.length - 1] / avgVol20 : null),
    support10: r(Math.min(...lows.slice(-10))),
    support20: r(Math.min(...lows.slice(-20))),
    resistance20: r(Math.max(...highs.slice(-20))),
    high52: r(high52),
    low52: r(low52),
    pctFromHigh52: r(((price - high52) / high52) * 100),
  };
}

module.exports = { computeOne };
