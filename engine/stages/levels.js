// engine/stages/levels.js
// Deterministic price levels for a dip-zone setup: primary and secondary buy
// zones, first and second targets, invalidation, and risk-to-reward.
// Inputs are verified daily-bar features only. Rules are versioned in
// config.SCORING_VERSION and documented in SCORING_METHODOLOGY.md.

'use strict';

// Price increment used for published levels (keeps numbers clean, like the
// hand-authored briefs: 222, 212, 235 ...).
function tick(price) {
  if (price < 20) return 0.05;
  if (price < 100) return 0.25;
  if (price < 500) return 0.5;
  return 1;
}
const roundTo = (x, t) => Math.round(x / t) * t;
const fix = (x) => Math.round(x * 100) / 100;

function compute(f) {
  const p = f.price;
  const a = f.atr14;
  if (!(p > 0) || !(a > 0)) return { reject: 'no_price_or_atr' };
  const t = tick(p);

  // Primary zone: the highest real support at least 0.25 ATR below price,
  // no deeper than 2 ATR. Falls back to price − 1 ATR.
  const c1 = [f.ema20, f.support10, p - 1.0 * a].filter((x) => x != null && x <= p - 0.25 * a && x >= p - 2 * a);
  let z1 = c1.length ? Math.max(...c1) : p - 1.0 * a;

  // Secondary zone: the next real support at least 0.75 ATR below zone 1,
  // no deeper than 4 ATR below price. Falls back to zone 1 − 1.5 ATR.
  const c2 = [f.ema50, f.support20, z1 - 1.5 * a].filter((x) => x != null && x <= z1 - 0.75 * a && x >= p - 4 * a);
  let z2 = c2.length ? Math.max(...c2) : z1 - 1.5 * a;

  let inv = z2 - 1.0 * a;

  // First target: the 20-day high if it is a meaningful level above price,
  // otherwise price + 1.5 ATR; clamped to [0.75, 2.5] ATR above price.
  // s3: tighter first target — the s1 backtest showed R:R 1–1.5 setups hit
  // target 48% of the time vs 18% for R:R > 2, with the best expected return.
  const res = f.resistance20 != null && f.resistance20 >= p + 0.5 * a ? f.resistance20 : p + 1.25 * a;
  // Weekly horizon: never more than +12% for target 1, +25% for target 2.
  let t1 = Math.min(Math.max(res, p + 0.75 * a), p + 1.75 * a, p * 1.12);
  // Second target: 52-week high if beyond target 1, else +1.5 ATR; clamped.
  const hi = f.high52 != null && f.high52 >= t1 + 0.5 * a ? f.high52 : t1 + 1.5 * a;
  let t2 = Math.min(Math.max(hi, t1 + 1.0 * a), p + 5 * a, p * 1.25);
  if (t2 <= t1) t2 = t1 + tick(p);

  // Round: zones and invalidation DOWN (never shallower than computed),
  // targets DOWN (never more ambitious than computed).
  z1 = fix(Math.floor(z1 / t) * t);
  z2 = fix(Math.floor(z2 / t) * t);
  inv = fix(Math.floor(inv / t) * t);
  t1 = fix(Math.floor(t1 / t) * t);
  t2 = fix(Math.floor(t2 / t) * t);
  if (!(z1 < p && z2 < z1 && inv < z2 && t1 > p && t2 > t1 && inv > 0)) return { reject: 'level_order' };

  const w1 = 0.6;
  const w2 = 0.4;
  const avgEntry = w1 * z1 + w2 * z2;
  const rr = (t1 - avgEntry) / (avgEntry - inv);

  return {
    entryType: 'dip_zone',
    zones: [{ price: z1, weight: w1 }, { price: z2, weight: w2 }],
    firstTarget: t1,
    secondTarget: t2,
    invalidationLevel: inv,
    avgEntry: fix(avgEntry),
    riskReward: Math.round(rr * 100) / 100,
    zone1DistanceAtr: Math.round(((p - z1) / a) * 100) / 100,
    zone1DistancePct: Math.round(((p - z1) / p) * 10000) / 100,
  };
}

module.exports = { compute, tick, roundTo };
