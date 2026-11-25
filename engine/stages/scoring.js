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

// Entry Score s3 = estimated likelihood (0–100) that buy zone 1 is reached
// inside the publish week. Calibrated on the s1 backtest (20,263 setups):
// actual trigger rate was 75% at 0–0.5 ATR, 59% at 0.5–1 ATR, 46% at 1–1.5 ATR
// from the last close → linear fit 82.6 − 29.6 × distance(ATR).
// Methodology rule kept from the hand-authored era: earnings inside the
// publish week get the earned-entry discount (−10) on EVERY such name.
function entry(row, lv, eventInWeek) {
  const d = lv.zone1DistanceAtr;
  const adj = [];
  let s = 82.6 - 29.6 * Math.max(0, d);
  if (eventInWeek) { s -= 10; adj.push('earnings_in_week'); }
  return { score: r1(Math.max(5, Math.min(95, s))), adjustments: adj, meaning: 'est. % chance buy zone 1 is reached this week' };
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

module.exports = { conviction, entry, riskClass };
