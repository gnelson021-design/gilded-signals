// engine/stages/scoring.js
// Conviction Score, Entry Score and risk class (scoring version in config).
// Deterministic. Conviction = strength of the opportunity. Entry = how
// attractive the CURRENT price is relative to the published zones. They are
// independent: high conviction never implies "buy now".

'use strict';

const cfg = require('../config');

const clamp = (x) => Math.max(0, Math.min(100, x));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function sumTags(obj) {
  return obj ? Object.values(obj).reduce((a, b) => a + b, 0) : 0;
}

// row: a ranked discovery row (has .components from discovery.rank)
function conviction(row) {
  const c = row.components;
  const W = cfg.conviction.weights;
  const news = c.attention != null ? 0.6 * c.attention + 0.4 * (c.catalysts ?? 50) : null;
  const parts = {
    structure: c.trend,
    relStrength: c.relStrength,
    analysts: c.analysts,
    news,
    momentum: c.momentum,
  };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(W)) if (parts[k] != null) { num += parts[k] * w; den += w; }
  if (den < cfg.conviction.minCoverage) return { score: null, parts, reason: 'insufficient_coverage' };
  const negTags = sumTags(row.attention && row.attention.tagsNeg);
  const penalty = Math.min(12, negTags * 3);
  return { score: r1(clamp(num / den - penalty)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(v)])), negTagPenalty: penalty, coverage: den };
}

function entry(row, lv, eventInWeek) {
  const f = row.features;
  const d = lv.zone1DistanceAtr;
  let s = 100 - 30 * Math.max(0, d - 0.25);
  const adj = [];
  const add = (v, why) => { s += v; adj.push(why); };
  if (f.rsi14 > 75) add(-15, 'rsi_extended');
  else if (f.rsi14 > 70) add(-8, 'rsi_elevated');
  else if (f.rsi14 != null && f.rsi14 >= 40 && f.rsi14 <= 55) add(5, 'rsi_reset');
  if (f.posture === 'bear') add(-10, 'downtrend');
  if (lv.riskReward < 1) add(-15, 'rr_below_1');
  else if (lv.riskReward >= 1.5) add(5, 'rr_1_5_plus');
  // Earned-entry earnings discount — applied to EVERY in-week earnings name.
  if (eventInWeek) add(-10, 'earnings_in_week');
  return { score: r1(clamp(s)), adjustments: adj };
}

// s2 CANDIDATE Entry Score — built from the s1 backtest, which showed that
// zones further below price (1–2.5 ATR pullbacks) produced more expected
// return per published setup than zones hugging the price, that R:R 1–1.6
// beat more ambitious targets, and that bullish structure helped. Scored in
// the backtest side by side with s1; selection keeps s1 until s2 validates.
function entryV2(row, lv, eventInWeek) {
  const f = row.features;
  const d = lv.zone1DistanceAtr;
  let s = 50;
  const adj = [];
  const add = (v, why) => { s += v; adj.push(why); };
  if (d < 0.5) add(-15, 'zone_too_close');
  else if (d < 1) add(0, 'zone_shallow');
  else if (d < 1.5) add(10, 'zone_1_1.5atr');
  else if (d <= 2.5) add(15, 'zone_1.5_2.5atr');
  else add(5, 'zone_deep');
  if (f.rsi14 != null) {
    if (f.rsi14 > 70) add(-15, 'rsi_extended');
    else if (f.rsi14 >= 40 && f.rsi14 <= 60) add(10, 'rsi_40_60');
    else if (f.rsi14 < 30) add(-10, 'rsi_broken');
  }
  if (f.posture === 'bull') add(10, 'bull_structure');
  else if (f.posture === 'bear') add(-10, 'bear_structure');
  if (lv.riskReward < 1) add(-15, 'rr_below_1');
  else if (lv.riskReward <= 1.6) add(10, 'rr_1_1.6');
  else if (lv.riskReward > 2) add(-5, 'rr_above_2');
  if (eventInWeek) add(-10, 'earnings_in_week');
  return { score: r1(clamp(s)), adjustments: adj };
}

function riskClass(row, eventInWeek) {
  const f = row.features;
  const levels = ['Low', 'Moderate', 'Elevated', 'High'];
  let i;
  if (f.atrPct > 4 || f.posture === 'bear') i = 3;
  else if (f.atrPct > 2.75 || f.posture === 'lean-bear') i = 2;
  else if (f.atrPct > 1.75 || !(f.posture === 'bull' || f.posture === 'lean-bull')) i = 1;
  else i = 0;
  if (eventInWeek) i = Math.min(3, i + 1);
  return levels[i];
}

module.exports = { conviction, entry, entryV2, riskClass };
