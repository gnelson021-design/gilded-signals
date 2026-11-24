// engine/lib/indicators.js
// Technical indicators for the GS Research Engine.
// COPIED VERBATIM from netlify/functions/quote.js (origin/main @ 6940463) so the
// engine and the live site compute identical values. quote.js is not modified.
// If quote.js indicator math changes, re-copy and bump the engine's version.

'use strict';

function emaSeries(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function emaLast(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes) {
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  if (!e26.length) return { macd: null, signal: null, hist: null };
  const line = [];
  for (let i = 0; i < closes.length; i++) {
    if (e12[i] != null && e26[i] != null) line.push(e12[i] - e26[i]);
  }
  if (!line.length) return { macd: null, signal: null, hist: null };
  const sig = emaSeries(line, 9);
  const macdVal = line[line.length - 1];
  const signalVal = sig.length ? sig[sig.length - 1] : null;
  const hist = signalVal != null ? macdVal - signalVal : null;
  return { macd: macdVal, signal: signalVal, hist };
}

// Wilder-smoothed Average True Range — used for overextension risk.
function atr(highs, lows, closes, period = 14) {
  if (!highs || !lows || !closes || closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    val = (val * (period - 1) + trs[i]) / period;
  }
  return val;
}

// ISO year-week key, used to resample daily closes into weekly closes.
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return date.getUTCFullYear() + '-W' + week;
}

// Multi-timeframe confirmation: does the weekly trend (price vs weekly EMA10)
// agree with the daily trend posture? Returns true/false, or null if there
// isn't enough history to resample a reliable weekly series.
function weeklyTrendAligned(closes, dates, dailyPosture) {
  if (!dates || dates.length !== closes.length || closes.length < 60) return null;
  const weeklyCloses = [];
  let curWeek = null, last = null;
  for (let i = 0; i < closes.length; i++) {
    const wk = isoWeekKey(new Date(dates[i]));
    if (wk !== curWeek) {
      if (last != null) weeklyCloses.push(last);
      curWeek = wk;
    }
    last = closes[i];
  }
  if (last != null) weeklyCloses.push(last);
  if (weeklyCloses.length < 15) return null;
  const wEma10 = emaLast(weeklyCloses, 10);
  if (wEma10 == null) return null;
  const weeklyBull = weeklyCloses[weeklyCloses.length - 1] > wEma10;
  const dailyBull = dailyPosture === 'bull' || dailyPosture === 'lean-bull';
  const dailyBear = dailyPosture === 'bear' || dailyPosture === 'lean-bear';
  if (dailyBull) return weeklyBull;
  if (dailyBear) return !weeklyBull;
  return null; // daily itself is mixed — no confirmation signal either way
}

function pctChangeOverN(closes, n) {
  if (!closes || closes.length < n + 1) return null;
  const cur = closes[closes.length - 1];
  const base = closes[closes.length - 1 - n];
  return base ? ((cur - base) / base) * 100 : null;
}

function rsiCondition(rsiVal) {
  if (rsiVal == null) return null;
  if (rsiVal < 30) return 'Oversold / Reversal Watch';
  if (rsiVal < 45) return 'Weak Momentum';
  if (rsiVal < 60) return 'Neutral';
  if (rsiVal < 70) return 'Bullish Momentum';
  return 'Extended / Pullback Risk';
}

// Trend posture from EMA stack — used to decide whether a high RSI means
// "strong & extended" (uptrend) vs "exhausted" (weak/downtrend).
// Returns: 'bull' | 'lean-bull' | 'mixed' | 'lean-bear' | 'bear' | null
// ---------------------------------------------------------------------------
function trendPosture(m) {
  const { price, ema20, ema50, ema200 } = m;
  if (price == null || ema20 == null || ema50 == null || ema200 == null) return null;
  if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'bull';
  if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'bear';
  let s = 0;
  if (price > ema20) s++; else s--;
  if (ema20 > ema50) s++; else s--;
  if (ema50 > ema200) s++; else s--;
  if (s >= 2) return 'lean-bull';
  if (s <= -2) return 'lean-bear';
  return 'mixed';
}

module.exports = { rsiCondition, trendPosture, emaSeries, emaLast, rsi, macd, atr, isoWeekKey, weeklyTrendAligned, pctChangeOverN };
