// netlify/functions/quote.js
// Gilded Signals — unified market quote endpoint
// Stocks:  Alpaca (bars + snapshot) + Finnhub (fundamentals)
// Crypto:  CoinGecko (simple/price + market_chart)
// Usage:   /.netlify/functions/quote?symbol=NVDA
//          /.netlify/functions/quote?symbol=BTC/USD
// No external npm packages. Node 18+ global fetch.

'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const BENCH_TTL_MS = 5 * 60 * 1000; // 5 minutes — SPY/sector-ETF bars change slowly
const FETCH_TIMEOUT_MS = 8000;
const cache = new Map();      // symbol -> { expires, data }  (warm-container only)
const benchCache = new Map(); // benchmark symbol -> { expires, closes }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

// CoinGecko id + display-name map for the symbols Gilded Signals tracks.
const CRYPTO = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  SOL: { id: 'solana', name: 'Solana' },
  XRP: { id: 'ripple', name: 'XRP' },
  ADA: { id: 'cardano', name: 'Cardano' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  MATIC: { id: 'matic-network', name: 'Polygon' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  BNB: { id: 'binancecoin', name: 'BNB' },
};

// Keyword rules mapping Finnhub's `finnhubIndustry` string to a representative
// sector ETF for relative-strength comparison. Unmatched industries return
// null and the sector leg of Relative Strength is simply skipped (never guessed).
const SECTOR_ETF_RULES = [
  [/semiconductor/i, 'SMH'],
  [/software|internet|it services|computer|technology/i, 'XLK'],
  [/bank|financial|insurance|capital markets|asset management/i, 'XLF'],
  [/oil|gas|energy/i, 'XLE'],
  [/biotech|pharma|health|medical/i, 'XLV'],
  [/retail|consumer discretionary|auto|apparel|restaurant|leisure/i, 'XLY'],
  [/consumer defensive|food|beverage|household|tobacco/i, 'XLP'],
  [/industrial|aerospace|defense|machinery|transport|airline/i, 'XLI'],
  [/material|chemical|mining|metal|steel/i, 'XLB'],
  [/utilit/i, 'XLU'],
  [/real estate|reit/i, 'XLRE'],
  [/telecom|communication|media|entertainment/i, 'XLC'],
];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function round(n, dp = 2) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

// Errors are never 500 — always a 200 with { error, symbol }.
function fail(symbol, message) {
  return ok({ error: message, symbol: symbol || null });
}

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Technical indicators (operate on chronological/ascending arrays)
// ---------------------------------------------------------------------------
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

function sectorETFFor(industry) {
  if (!industry) return null;
  for (const [re, etf] of SECTOR_ETF_RULES) {
    if (re.test(industry)) return etf;
  }
  return null;
}

function pctChangeOverN(closes, n) {
  if (!closes || closes.length < n + 1) return null;
  const cur = closes[closes.length - 1];
  const base = closes[closes.length - 1 - n];
  return base ? ((cur - base) / base) * 100 : null;
}

// ---------------------------------------------------------------------------
// RSI condition — describes momentum state ONLY (separate from overall trend).
// A high RSI is NOT inherently bearish; it just means "extended".
// ---------------------------------------------------------------------------
function rsiCondition(rsiVal) {
  if (rsiVal == null) return null;
  if (rsiVal < 30) return 'Oversold / Reversal Watch';
  if (rsiVal < 45) return 'Weak Momentum';
  if (rsiVal < 60) return 'Neutral';
  if (rsiVal < 70) return 'Bullish Momentum';
  return 'Extended / Pullback Risk';
}

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Category sub-scores — each 0..100. These are combined by weight in
// technicalScore() below. Keeping them separate makes the weighting explicit
// and auditable, and lets any single category's data be missing without
// breaking the others.
// ---------------------------------------------------------------------------

// Trend & EMA structure — 30% weight
function scoreTrend(m, posture) {
  const { price, ema20, ema50, ema200 } = m;
  if (price == null || ema20 == null || ema50 == null || ema200 == null) return null;
  let s;
  if (posture === 'bull') s = 90;
  else if (posture === 'bear') s = 10;
  else {
    let partial = 0;
    if (price > ema20) partial++; else partial--;
    if (ema20 > ema50) partial++; else partial--;
    if (ema50 > ema200) partial++; else partial--;
    s = 50 + partial * 13;
  }
  if (ema50 != null && ema200 != null) s += ema50 > ema200 ? 5 : -5;
  if (m.weeklyTrendAligned === true) s += 5;
  else if (m.weeklyTrendAligned === false) s -= 5;
  return clamp(s, 0, 100);
}

// Momentum: RSI + MACD (+ heavily damped daily/weekly price action) — 25% weight
function scoreMomentum(m) {
  let s = 50;
  let touched = false;
  const rsiVal = m.rsi14;
  if (rsiVal != null) {
    touched = true;
    if (rsiVal < 30) s += 15;                // oversold — reversal potential
    else if (rsiVal < 45) s -= 10;            // weak momentum
    else if (rsiVal < 55) s += 0;             // neutral — NOT treated as bullish
    else if (rsiVal <= 68) s += 15;           // healthy bullish momentum, no overbought needed
    else if (rsiVal <= 70) s += 8;            // edging toward extended
    else s += 0;                              // >70: no organic bonus — flagged as a warning, not scored up
  }
  if (m.macdHist != null) {
    touched = true;
    s += m.macdHist > 0 ? 12 : -12;
  }
  // Daily/weekly price action — capped so one hot session can't dominate the score.
  if (m.changePercent != null) { touched = true; s += clamp(m.changePercent * 0.4, -3, 3); }
  if (m.weekChange != null) { touched = true; s += clamp(m.weekChange * 0.2, -4, 4); }
  return touched ? clamp(s, 0, 100) : null;
}

// Volume confirmation — 20% weight
function scoreVolume(m) {
  if (m.rvol == null) return null;
  let s = 50;
  const dirUp = (m.changePercent || 0) >= 0;
  if (m.rvol >= 1.5) s += dirUp ? 18 : -18;       // strong volume confirms direction
  else if (m.rvol >= 1.0) s += dirUp ? 6 : -6;    // mild confirmation
  else if (m.rvol < 0.5) s -= 8;                  // weak participation either way
  return clamp(s, 0, 100);
}

// Relative strength vs SPY and sector ETF — 15% weight
function scoreRelativeStrength(m) {
  if (m.spyRelStrength == null && m.sectorRelStrength == null) return null;
  let s = 50;
  if (m.spyRelStrength != null) s += clamp(m.spyRelStrength * 2, -20, 20);
  if (m.sectorRelStrength != null) s += clamp(m.sectorRelStrength * 2, -20, 20);
  return clamp(s, 0, 100);
}

// Risk & overextension — 10% weight. Higher = healthier (lower risk).
function scoreRisk(m, posture) {
  let s = 100;
  if (m.atr14 != null && m.atr14 > 0 && m.ema20 != null && m.price != null) {
    const distATR = (m.price - m.ema20) / m.atr14;
    if (distATR > 3) s -= 30;
    else if (distATR > 2) s -= 15;
    else if (distATR < -3) s -= 15;
  }
  if (m.chaseRisk) s -= 20;
  if (m.rsi14 != null && m.rsi14 > 70) s -= 10;
  if (m.price != null && m.week52High != null && m.week52Low != null && m.week52High > m.week52Low) {
    const posPct = ((m.price - m.week52Low) / (m.week52High - m.week52Low)) * 100;
    if (posPct >= 95) s -= 5;
    else if (posPct <= 10) s -= 8;
  }
  const macdUp = m.macdHist != null && m.macdHist > 0;
  const macdDown = m.macdHist != null && m.macdHist < 0;
  const trendUp = posture === 'bull' || posture === 'lean-bull';
  const trendDown = posture === 'bear' || posture === 'lean-bear';
  if ((trendUp && macdDown) || (trendDown && macdUp)) s -= 10; // conflicting indicators
  if (m.liquidityWarning) s -= 15;
  if (m.dataQuality && m.dataQuality !== 'ok') s -= 25;
  return clamp(s, 0, 100);
}

// ---------------------------------------------------------------------------
// Technical Strength Score — weighted combination of the five categories
// above, 0..100. Replaces the old flat point-additive "Gilded Score" model.
// Field name in the API response stays `gildedScore` for backward
// compatibility with the client; the user-facing label is "Technical
// Strength Score" (set in assets/js/gs-scanner.js).
// ---------------------------------------------------------------------------
function gildedScore(m) {
  const posture = trendPosture(m);
  const trend = scoreTrend(m, posture);
  const momentum = scoreMomentum(m);
  const volume = scoreVolume(m);
  const relStrength = scoreRelativeStrength(m);
  const risk = scoreRisk(m, posture);

  // Risk is a modifier, not a primary read — it can return a value (100)
  // purely from the absence of red flags, with zero real price data behind
  // it. If none of the four PRIMARY categories have real data, there is
  // nothing to score. Never fabricate a number here — surface "unavailable"
  // exactly as the data-accuracy rule requires.
  const primaryAvailable = [trend, momentum, volume, relStrength].filter((v) => v != null).length;
  if (primaryAvailable === 0) {
    return {
      gildedScore: null,
      gildedBadge: null,
      gildedReasons: ['Data unavailable — not enough price history to calculate a Technical Strength Score'],
      signal: null,
      rsiCondition: null,
      extendedWarning: false,
      chaseRisk: false,
      liquidityWarning: false,
      dataQuality: m.dataQuality || 'incomplete',
      scoreBreakdown: { trend: null, momentum: null, volume: null, relativeStrength: null, risk },
    };
  }

  let wTrend = 0.30, wMomentum = 0.25, wVolume = 0.20, wRS = 0.15, wRisk = 0.10;
  // If a whole category is unavailable, redistribute its weight proportionally
  // across the remaining categories rather than silently assuming a neutral 50.
  const cats = [
    ['trend', trend, wTrend], ['momentum', momentum, wMomentum],
    ['volume', volume, wVolume], ['rs', relStrength, wRS], ['risk', risk, wRisk],
  ];
  const missing = cats.filter(c => c[1] == null);
  const present = cats.filter(c => c[1] != null);
  if (missing.length) {
    const missingWeight = missing.reduce((a, c) => a + c[2], 0);
    const presentWeight = present.reduce((a, c) => a + c[2], 0);
    if (presentWeight > 0) {
      for (const c of present) c[2] += missingWeight * (c[2] / presentWeight);
    }
  }
  const byName = Object.fromEntries(cats.map(c => [c[0], c]));
  let raw = 0;
  for (const c of present) raw += c[1] * c[2];
  let score = present.length ? Math.round(raw) : 50;

  // Safeguard: a 90+ score requires exceptional confirmation across trend,
  // momentum, volume AND relative strength — not just a hot trend alone.
  if (score >= 90) {
    const strongTrend = trend == null || trend >= 85;
    const strongMomentum = momentum == null || momentum >= 75;
    const strongVolume = volume == null || volume >= 65;
    const strongRS = relStrength == null || relStrength >= 65;
    if (!(strongTrend && strongMomentum && strongVolume && strongRS)) score = 89;
  }
  score = clamp(score, 0, 100);

  // --- Reasons (human-readable, feeds the reason-tag UI) ---
  const reasons = [];
  if (m.rsi14 != null) {
    const cond = rsiCondition(m.rsi14);
    if (m.rsi14 < 30) reasons.push(`RSI ${round(m.rsi14, 1)} — oversold, reversal potential`);
    else if (m.rsi14 > 70) reasons.push(`RSI ${round(m.rsi14, 1)} — ${cond.toLowerCase()}`);
    else if (m.rsi14 >= 55) reasons.push(`RSI ${round(m.rsi14, 1)} — healthy bullish momentum`);
    else if (m.rsi14 < 45) reasons.push(`RSI ${round(m.rsi14, 1)} — weak momentum`);
  }
  if (posture === 'bull') reasons.push('EMA stack fully bullish (price > 20 > 50 > 200)');
  else if (posture === 'bear') reasons.push('EMA stack fully bearish (price < 20 < 50 < 200)');
  else if (posture) reasons.push(posture === 'lean-bull' ? 'EMA structure leaning bullish' : 'EMA structure leaning bearish');
  if (m.weeklyTrendAligned === true) reasons.push('Weekly trend confirms the daily trend');
  else if (m.weeklyTrendAligned === false) reasons.push('Weekly trend conflicts with the daily trend');
  if (m.macdHist != null) reasons.push(m.macdHist > 0 ? 'MACD histogram positive — upward momentum' : 'MACD histogram negative — downward momentum');
  if (m.rvol != null && m.rvol > 1.5) {
    reasons.push((m.changePercent || 0) >= 0
      ? `RVOL ${round(m.rvol, 2)}x on an up move — conviction buying`
      : `RVOL ${round(m.rvol, 2)}x on a down move — conviction selling`);
  }
  if (m.spyRelStrength != null) {
    reasons.push(m.spyRelStrength >= 0
      ? `Outperforming SPY by ${round(m.spyRelStrength, 1)}pts over 20 sessions`
      : `Underperforming SPY by ${round(Math.abs(m.spyRelStrength), 1)}pts over 20 sessions`);
  }
  if (m.sectorRelStrength != null && m.sectorETF) {
    reasons.push(m.sectorRelStrength >= 0
      ? `Outperforming ${m.sectorETF} by ${round(m.sectorRelStrength, 1)}pts over 20 sessions`
      : `Underperforming ${m.sectorETF} by ${round(Math.abs(m.sectorRelStrength), 1)}pts over 20 sessions`);
  }
  if (m.chaseRisk) reasons.push('Gap-up into an already-extended price — chase risk');
  if (byName.risk[1] != null && m.atr14 != null && m.ema20 != null && m.price != null) {
    const distATR = (m.price - m.ema20) / m.atr14;
    if (distATR > 2) reasons.push('Extended well above EMA20 relative to normal ATR range');
  }
  if (m.liquidityWarning) reasons.push('Thin average dollar volume — liquidity risk');
  if (m.dataQuality && m.dataQuality !== 'ok') reasons.push('Data quality flag — treat this read with caution');

  // --- Combined professional signal (7 labels) ---
  const extended = m.rsi14 != null && m.rsi14 > 70;
  const oversold = m.rsi14 != null && m.rsi14 < 30;
  const macdUp = m.macdHist != null && m.macdHist > 0;
  const macdDown = m.macdHist != null && m.macdHist < 0;
  const trendIsUp = posture === 'bull' || posture === 'lean-bull';
  const trendIsDown = posture === 'bear' || posture === 'lean-bear';
  let signal;
  if (trendIsUp && macdUp && extended) signal = 'Bullish but Extended';
  else if (posture === 'bull' && macdUp && score >= 72) signal = 'Strong Bullish';
  else if (trendIsUp && (macdUp || score >= 60) && !extended) signal = 'Bullish';
  else if (trendIsDown && macdDown) signal = 'Bearish';
  else if (posture === 'lean-bear' || (trendIsDown && !macdDown) || (m.rsi14 != null && m.rsi14 < 45 && !trendIsUp)) signal = 'Weak';
  else if (oversold && !trendIsDown) signal = 'Watch';
  else if (posture === 'mixed' || (macdUp !== macdDown && !trendIsUp && !trendIsDown)) signal = 'Watch';
  else signal = 'Neutral';

  if (posture == null && m.macdHist == null) {
    if (score >= 72) signal = 'Strong Bullish';
    else if (score >= 58) signal = 'Bullish';
    else if (score >= 45) signal = 'Neutral';
    else if (score >= 30) signal = 'Weak';
    else signal = 'Bearish';
  }

  let badge;
  if (score >= 80) badge = 'Strong Bullish';
  else if (score >= 60) badge = 'Bullish';
  else if (score >= 40) badge = 'Neutral';
  else if (score >= 20) badge = 'Bearish';
  else badge = 'Strong Bearish';

  return {
    gildedScore: score,
    gildedBadge: badge,
    gildedReasons: reasons,
    signal,
    rsiCondition: rsiCondition(m.rsi14),
    extendedWarning: extended,
    chaseRisk: !!m.chaseRisk,
    liquidityWarning: !!m.liquidityWarning,
    dataQuality: m.dataQuality || 'ok',
    scoreBreakdown: {
      trend: trend != null ? Math.round(trend) : null,
      momentum: momentum != null ? Math.round(momentum) : null,
      volume: volume != null ? Math.round(volume) : null,
      relativeStrength: relStrength != null ? Math.round(relStrength) : null,
      risk: risk != null ? Math.round(risk) : null,
    },
  };
}

// Shared derivation of momentum/levels from chronological close/high/low/volume arrays.
function deriveSeries({ closes, highs, lows, volumes, dates }) {
  const n = closes.length;
  const price = closes[n - 1];

  const at = (back) => (n - 1 - back >= 0 ? closes[n - 1 - back] : null);
  const pctFrom = (base) => (base ? ((price - base) / base) * 100 : null);

  const weekChange = pctFrom(at(5));
  const monthChange = pctFrom(at(21));

  // YTD: close of the last bar in the previous calendar year.
  let ytdBase = closes[0];
  if (dates && dates.length === n) {
    const yr = new Date().getUTCFullYear();
    for (let i = 0; i < n; i++) {
      if (new Date(dates[i]).getUTCFullYear() === yr) {
        ytdBase = i > 0 ? closes[i - 1] : closes[i];
        break;
      }
    }
  }

  const win = (arr, k) => arr.slice(Math.max(0, arr.length - k));
  const last20H = highs ? win(highs, 20) : win(closes, 20);
  const last20L = lows ? win(lows, 20) : win(closes, 20);
  const support = Math.min(...last20L);
  const resistance = Math.max(...last20H);

  const yrH = highs ? win(highs, 252) : win(closes, 252);
  const yrL = lows ? win(lows, 252) : win(closes, 252);
  const week52High = Math.max(...yrH);
  const week52Low = Math.min(...yrL);

  let avgVolume = null;
  let rvol = null;
  if (volumes && volumes.length) {
    const v20 = win(volumes, 20);
    avgVolume = v20.reduce((a, b) => a + b, 0) / v20.length;
    const todayVol = volumes[volumes.length - 1];
    rvol = avgVolume ? todayVol / avgVolume : null;
  }

  const mac = macd(closes);
  const posture = trendPosture({
    price, ema20: emaLast(closes, 20), ema50: emaLast(closes, 50), ema200: emaLast(closes, 200),
  });

  return {
    weekChange,
    monthChange,
    ytdChange: pctFrom(ytdBase),
    support,
    resistance,
    week52High,
    week52Low,
    avgVolume,
    rvol,
    rsi14: rsi(closes, 14),
    ema20: emaLast(closes, 20),
    ema50: emaLast(closes, 50),
    ema200: emaLast(closes, 200),
    macd: mac.macd,
    macdSignal: mac.signal,
    macdHist: mac.hist,
    atr14: atr(highs, lows, closes, 14),
    weeklyTrendAligned: weeklyTrendAligned(closes, dates, posture),
  };
}

// Fetch + cache a benchmark's recent closes (SPY or a sector ETF) for
// relative-strength comparisons. Cached separately with a longer TTL since
// these are shared across every stock quote in a warm container.
async function getBenchCloses(symbol, key, secret, feed) {
  const now = Date.now();
  const hit = benchCache.get(symbol);
  if (hit && hit.expires > now) return hit.closes;
  try {
    const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start}&limit=90&adjustment=split&sort=desc&feed=${feed}`;
    const data = await getJSON(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
    const bars = Array.isArray(data.bars) ? data.bars.slice().reverse() : [];
    const closes = bars.map((b) => b.c);
    if (closes.length) benchCache.set(symbol, { expires: now + BENCH_TTL_MS, closes });
    return closes.length ? closes : null;
  } catch (e) {
    return null;
  }
}

function assessDataQuality(closesLen, price, changePercent) {
  if (closesLen < 30) return 'incomplete';
  if (price == null || !isFinite(price) || price <= 0) return 'incomplete';
  if (changePercent != null && Math.abs(changePercent) > 50) return 'implausible';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Stock path — Alpaca bars + snapshot, Finnhub fundamentals (parallel)
// ---------------------------------------------------------------------------
async function getStock(symbol) {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  const fh = process.env.FINNHUB_API_KEY;
  if (!key || !secret) throw new Error('Alpaca credentials not configured');

  const alpHeaders = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  // Free Alpaca plans must use the IEX feed; paid SIP users can change feed below.
  const feed = process.env.ALPACA_FEED || 'iex';

  const start = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const barsUrl =
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars` +
    `?timeframe=1Day&start=${start}&limit=400&adjustment=split&sort=desc&feed=${feed}`;
  const snapUrl =
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=${feed}`;

  const fhUrl = (path) =>
    `https://finnhub.io/api/v1/${path}&token=${fh}`;

  const [barsR, snapR, profR, metR, recR, spyR] = await Promise.allSettled([
    getJSON(barsUrl, { headers: alpHeaders }),
    getJSON(snapUrl, { headers: alpHeaders }),
    fh ? getJSON(fhUrl(`stock/profile2?symbol=${symbol}`)) : Promise.resolve(null),
    fh ? getJSON(fhUrl(`stock/metric?symbol=${symbol}&metric=all`)) : Promise.resolve(null),
    fh ? getJSON(fhUrl(`stock/recommendation?symbol=${symbol}`)) : Promise.resolve(null),
    symbol === 'SPY' ? Promise.resolve(null) : getBenchCloses('SPY', key, secret, feed),
  ]);

  const barsData = barsR.status === 'fulfilled' ? barsR.value : null;
  const rawBars = barsData && Array.isArray(barsData.bars) ? barsData.bars : [];
  if (!rawBars.length) throw new Error('No price data returned from Alpaca');

  // Alpaca returned desc; flip to ascending/chronological for indicators.
  const bars = rawBars.slice().reverse();
  const closes = bars.map((b) => b.c);
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const volumes = bars.map((b) => b.v);
  const dates = bars.map((b) => b.t);
  const n = closes.length;

  const snap = snapR.status === 'fulfilled' ? snapR.value : null;
  const daily = snap && snap.dailyBar ? snap.dailyBar : null;
  const prev = snap && snap.prevDailyBar ? snap.prevDailyBar : null;
  const trade = snap && snap.latestTrade ? snap.latestTrade : null;

  const price = (trade && trade.p) || (daily && daily.c) || closes[n - 1];
  const previousClose = (prev && prev.c) || (n > 1 ? closes[n - 2] : price);
  const open = (daily && daily.o) || bars[n - 1].o;
  const high = (daily && daily.h) || highs[n - 1];
  const low = (daily && daily.l) || lows[n - 1];
  const volume = (daily && daily.v) || volumes[n - 1];
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : null;

  // Use live volume for RVOL rather than the (possibly stale) last historical bar.
  const liveCloses = closes.slice();
  const liveVols = volumes.slice();
  liveCloses[n - 1] = price;
  if (volume) liveVols[n - 1] = volume;

  const d = deriveSeries({ closes: liveCloses, highs, lows, volumes: liveVols, dates });

  // Finnhub fundamentals (kept as raw reference data — NOT fed into the
  // Right Now Technical Score; reserved for Long-Term mode).
  const prof = profR.status === 'fulfilled' ? profR.value : null;
  const met = metR.status === 'fulfilled' && metR.value ? metR.value.metric : null;
  const rec = recR.status === 'fulfilled' && Array.isArray(recR.value) ? recR.value[0] : null;

  const marketCap = prof && prof.marketCapitalization ? prof.marketCapitalization * 1e6 : null;
  const peRatio = met ? (met.peTTM ?? met.peBasicExclExtraTTM ?? null) : null;
  const revenueGrowth = met ? (met.revenueGrowthTTMYoy ?? null) : null;
  const epsGrowth = met ? (met.epsGrowthTTMYoy ?? met.epsGrowth5Y ?? null) : null;
  const sector = prof ? (prof.finnhubIndustry || null) : null;
  const name = prof ? (prof.name || symbol) : symbol;

  let analystRating = null;
  if (rec) {
    const buy = (rec.strongBuy || 0) + (rec.buy || 0);
    const sell = (rec.strongSell || 0) + (rec.sell || 0);
    const hold = rec.hold || 0;
    if (buy > hold && buy > sell) analystRating = 'Buy';
    else if (sell > buy && sell > hold) analystRating = 'Sell';
    else analystRating = 'Hold';
  }

  // Relative strength vs SPY (skip if this symbol IS SPY).
  const spyCloses = spyR.status === 'fulfilled' ? spyR.value : null;
  const stockChg20 = pctChangeOverN(liveCloses, 20);
  const spyChg20 = pctChangeOverN(spyCloses, 20);
  const spyRelStrength = (stockChg20 != null && spyChg20 != null) ? (stockChg20 - spyChg20) : null;

  // Relative strength vs sector ETF (fetched only once sector is known; skip
  // if unmapped or if this symbol IS its own sector ETF).
  let sectorRelStrength = null, sectorETF = null;
  sectorETF = sectorETFFor(sector);
  if (sectorETF && sectorETF !== symbol) {
    const sectorCloses = await getBenchCloses(sectorETF, key, secret, feed);
    const sectorChg20 = pctChangeOverN(sectorCloses, 20);
    if (stockChg20 != null && sectorChg20 != null) sectorRelStrength = stockChg20 - sectorChg20;
  } else {
    sectorETF = null;
  }

  const dataQuality = assessDataQuality(n, price, changePercent);
  const liquidityWarning = d.avgVolume != null && price != null ? (d.avgVolume * price) < 5_000_000 : false;
  const chaseRisk = (() => {
    if (open == null || !previousClose) return false;
    const gapPct = ((open - previousClose) / previousClose) * 100;
    const extAboveEma = (d.ema20 != null && d.ema20 > 0) ? ((price - d.ema20) / d.ema20) * 100 : 0;
    return gapPct > 3 && extAboveEma > 5;
  })();

  const metrics = {
    price, changePercent, weekChange: d.weekChange, rvol: d.rvol,
    rsi14: d.rsi14, ema20: d.ema20, ema50: d.ema50, ema200: d.ema200,
    macdHist: d.macdHist, week52High: d.week52High, week52Low: d.week52Low,
    atr14: d.atr14, weeklyTrendAligned: d.weeklyTrendAligned,
    spyRelStrength, sectorRelStrength, sectorETF,
    liquidityWarning, chaseRisk, dataQuality,
  };
  const gild = gildedScore(metrics);

  const emaStatus = d.ema50 != null ? (price > d.ema50 ? 'above' : 'below') : null;

  return {
    symbol,
    name,
    type: 'stock',
    price: round(price, 2),
    change: round(change, 2),
    changePercent: round(changePercent, 2),
    weekChange: round(d.weekChange, 2),
    monthChange: round(d.monthChange, 2),
    ytdChange: round(d.ytdChange, 2),
    high: round(high, 2),
    low: round(low, 2),
    open: round(open, 2),
    previousClose: round(previousClose, 2),
    volume: volume || null,
    avgVolume: d.avgVolume ? Math.round(d.avgVolume) : null,
    rvol: round(d.rvol, 2),
    rsi14: round(d.rsi14, 2),
    ema20: round(d.ema20, 2),
    ema50: round(d.ema50, 2),
    ema200: round(d.ema200, 2),
    emaStatus,
    macd: round(d.macd, 4),
    macdSignal: round(d.macdSignal, 4),
    macdHist: round(d.macdHist, 4),
    atr14: round(d.atr14, 2),
    support: round(d.support, 2),
    resistance: round(d.resistance, 2),
    week52High: round(d.week52High, 2),
    week52Low: round(d.week52Low, 2),
    spyRelStrength: round(spyRelStrength, 2),
    sectorRelStrength: round(sectorRelStrength, 2),
    sectorETF,
    marketCap,
    peRatio: round(peRatio, 2),
    revenueGrowth: round(revenueGrowth, 2),
    epsGrowth: round(epsGrowth, 2),
    analystRating,
    sector,
    gildedScore: gild.gildedScore,
    gildedBadge: gild.gildedBadge,
    gildedReasons: gild.gildedReasons,
    signal: gild.signal,
    rsiCondition: gild.rsiCondition,
    extendedWarning: gild.extendedWarning,
    chaseRisk: gild.chaseRisk,
    liquidityWarning: gild.liquidityWarning,
    dataQuality: gild.dataQuality,
    scoreBreakdown: gild.scoreBreakdown,
    updatedAt: new Date().toISOString(),
    source: 'Alpaca + Finnhub',
  };
}

// ---------------------------------------------------------------------------
// Crypto path — CoinGecko simple/price + market_chart (parallel)
// ---------------------------------------------------------------------------
async function getCrypto(base, symbol) {
  const meta = CRYPTO[base];
  if (!meta) throw new Error(`Unsupported crypto symbol: ${base}`);

  const priceUrl =
    `https://api.coingecko.com/api/v3/simple/price?ids=${meta.id}` +
    `&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  // Omit interval — CoinGecko auto-returns daily granularity for days > 90.
  const chartUrl =
    `https://api.coingecko.com/api/v3/coins/${meta.id}/market_chart?vs_currency=usd&days=365`;

  const [priceR, chartR] = await Promise.allSettled([
    getJSON(priceUrl),
    getJSON(chartUrl),
  ]);

  const spot = priceR.status === 'fulfilled' ? priceR.value[meta.id] : null;
  const chart = chartR.status === 'fulfilled' ? chartR.value : null;
  if (!chart || !Array.isArray(chart.prices) || !chart.prices.length) {
    throw new Error('No price data returned from CoinGecko');
  }

  const closes = chart.prices.map((p) => p[1]);
  const dates = chart.prices.map((p) => p[0]);
  const volumes = Array.isArray(chart.total_volumes) ? chart.total_volumes.map((v) => v[1]) : null;
  const n = closes.length;

  const price = spot && spot.usd ? spot.usd : closes[n - 1];
  const changePercent = spot && spot.usd_24h_change != null ? spot.usd_24h_change : null;
  const previousClose = changePercent != null ? price / (1 + changePercent / 100) : closes[n - 2];
  const change = previousClose != null ? price - previousClose : null;
  const volume = spot && spot.usd_24h_vol ? spot.usd_24h_vol : (volumes ? volumes[n - 1] : null);
  const marketCap = spot && spot.usd_market_cap ? spot.usd_market_cap : null;

  const liveCloses = closes.slice();
  liveCloses[n - 1] = price;

  // No daily OHLC from market_chart, so derive levels from closes only.
  // (No highs/lows means ATR is unavailable for crypto — that category's
  // weight is redistributed automatically inside gildedScore().)
  const d = deriveSeries({ closes: liveCloses, highs: null, lows: null, volumes, dates });

  const dataQuality = assessDataQuality(n, price, changePercent);
  const liquidityWarning = d.avgVolume != null && price != null ? (d.avgVolume * price) < 1_000_000 : false;

  const metrics = {
    price, changePercent, weekChange: d.weekChange, rvol: d.rvol,
    rsi14: d.rsi14, ema20: d.ema20, ema50: d.ema50, ema200: d.ema200,
    macdHist: d.macdHist, week52High: d.week52High, week52Low: d.week52Low,
    atr14: null, weeklyTrendAligned: d.weeklyTrendAligned,
    spyRelStrength: null, sectorRelStrength: null, sectorETF: null,
    liquidityWarning, chaseRisk: false, dataQuality,
  };
  const gild = gildedScore(metrics);

  const emaStatus = d.ema50 != null ? (price > d.ema50 ? 'above' : 'below') : null;

  return {
    symbol,
    name: meta.name,
    type: 'crypto',
    price: round(price, price < 1 ? 6 : 2),
    change: round(change, price < 1 ? 6 : 2),
    changePercent: round(changePercent, 2),
    weekChange: round(d.weekChange, 2),
    monthChange: round(d.monthChange, 2),
    ytdChange: round(d.ytdChange, 2),
    high: null, // not available from market_chart daily series
    low: null,
    open: round(previousClose, price < 1 ? 6 : 2),
    previousClose: round(previousClose, price < 1 ? 6 : 2),
    volume: volume ? Math.round(volume) : null,
    avgVolume: d.avgVolume ? Math.round(d.avgVolume) : null,
    rvol: round(d.rvol, 2),
    rsi14: round(d.rsi14, 2),
    ema20: round(d.ema20, 2),
    ema50: round(d.ema50, 2),
    ema200: round(d.ema200, 2),
    emaStatus,
    macd: round(d.macd, 4),
    macdSignal: round(d.macdSignal, 4),
    macdHist: round(d.macdHist, 4),
    atr14: null,
    support: round(d.support, 2),
    resistance: round(d.resistance, 2),
    week52High: round(d.week52High, 2),
    week52Low: round(d.week52Low, 2),
    spyRelStrength: null,
    sectorRelStrength: null,
    sectorETF: null,
    marketCap,
    peRatio: null,
    revenueGrowth: null,
    epsGrowth: null,
    analystRating: null,
    sector: 'Cryptocurrency',
    gildedScore: gild.gildedScore,
    gildedBadge: gild.gildedBadge,
    gildedReasons: gild.gildedReasons,
    signal: gild.signal,
    rsiCondition: gild.rsiCondition,
    extendedWarning: gild.extendedWarning,
    chaseRisk: false,
    liquidityWarning: gild.liquidityWarning,
    dataQuality: gild.dataQuality,
    scoreBreakdown: gild.scoreBreakdown,
    updatedAt: new Date().toISOString(),
    source: 'CoinGecko',
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const raw = (event.queryStringParameters && event.queryStringParameters.symbol) || '';
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return fail(symbol, 'Missing required parameter: symbol');

  // Serve from warm-container cache when fresh.
  const cached = cache.get(symbol);
  if (cached && cached.expires > Date.now()) {
    return ok({ ...cached.data, cached: true });
  }

  try {
    const isCrypto = symbol.includes('/') || symbol in CRYPTO;
    const base = symbol.includes('/') ? symbol.split('/')[0] : symbol;

    const data = isCrypto ? await getCrypto(base, symbol) : await getStock(symbol);

    cache.set(symbol, { expires: Date.now() + CACHE_TTL_MS, data });
    return ok({ ...data, cached: false });
  } catch (err) {
    return fail(symbol, err && err.message ? err.message : 'Unknown error');
  }
};
