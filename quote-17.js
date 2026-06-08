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
const FETCH_TIMEOUT_MS = 8000;
const cache = new Map(); // symbol -> { expires, data }  (warm-container only)

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

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function round(n, dp = 2) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
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
  return 'Overbought / Extended';
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
// Gilded Score — starts at 50, capped 0..100.
// Now also produces a professional combined `signal` label that separates
// RSI condition from overall trend (RSI 70+ never auto-bearish).
// ---------------------------------------------------------------------------
function gildedScore(m) {
  let score = 50;
  const reasons = [];

  const posture = trendPosture(m);
  const trendIsUp = posture === 'bull' || posture === 'lean-bull';
  const trendIsDown = posture === 'bear' || posture === 'lean-bear';
  const macdUp = m.macdHist != null && m.macdHist > 0;
  const macdDown = m.macdHist != null && m.macdHist < 0;

  // --- RSI: condition is separate from trend ---
  // Oversold => reversal bonus. Overbought is only penalized when the trend is
  // NOT up (genuine exhaustion); in an uptrend it's confirmation, not a warning.
  if (m.rsi14 != null) {
    if (m.rsi14 < 30) {
      score += 8;
      reasons.push(`RSI ${round(m.rsi14, 1)} — oversold, reversal potential`);
    } else if (m.rsi14 > 70) {
      if (trendIsUp && macdUp) {
        score += 4; // strength confirmation, not a penalty
        reasons.push(`RSI ${round(m.rsi14, 1)} — extended, but trend & MACD confirm strength`);
      } else if (trendIsDown) {
        score -= 8;
        reasons.push(`RSI ${round(m.rsi14, 1)} — overbought into a weak trend (exhaustion risk)`);
      } else {
        reasons.push(`RSI ${round(m.rsi14, 1)} — extended; watch for cooling`);
      }
    } else if (m.rsi14 >= 60) {
      score += 4;
      reasons.push(`RSI ${round(m.rsi14, 1)} — healthy bullish momentum`);
    } else if (m.rsi14 < 45) {
      score -= 3;
      reasons.push(`RSI ${round(m.rsi14, 1)} — weak momentum`);
    }
  }

  // EMA alignment (price > 20 > 50 > 200 = textbook uptrend)
  const { price, ema20, ema50, ema200 } = m;
  if (price != null && ema20 != null && ema50 != null && ema200 != null) {
    const bullStack = price > ema20 && ema20 > ema50 && ema50 > ema200;
    const bearStack = price < ema20 && ema20 < ema50 && ema50 < ema200;
    if (bullStack) { score += 15; reasons.push('EMA stack fully bullish (price > 20 > 50 > 200)'); }
    else if (bearStack) { score -= 15; reasons.push('EMA stack fully bearish (price < 20 < 50 < 200)'); }
    else {
      let partial = 0;
      if (price > ema20) partial += 1; else partial -= 1;
      if (ema20 > ema50) partial += 1; else partial -= 1;
      if (ema50 > ema200) partial += 1; else partial -= 1;
      score += partial * 3;
      reasons.push(partial >= 0 ? 'EMA structure leaning bullish' : 'EMA structure leaning bearish');
    }
  }

  // MACD histogram
  if (m.macdHist != null) {
    if (m.macdHist > 0) { score += 8; reasons.push('MACD histogram positive — upward momentum'); }
    else { score -= 8; reasons.push('MACD histogram negative — downward momentum'); }
  }

  // Relative volume + direction
  if (m.rvol != null && m.rvol > 1.5) {
    if ((m.changePercent || 0) >= 0) { score += 6; reasons.push(`RVOL ${round(m.rvol, 2)}x on an up move — conviction buying`); }
    else { score -= 6; reasons.push(`RVOL ${round(m.rvol, 2)}x on a down move — conviction selling`); }
  }

  // Daily momentum
  if (m.changePercent != null) {
    if (m.changePercent > 0) { score += 5; reasons.push(`Up ${round(m.changePercent, 2)}% on the day`); }
    else if (m.changePercent < 0) { score -= 5; reasons.push(`Down ${round(m.changePercent, 2)}% on the day`); }
  }

  // Weekly momentum
  if (m.weekChange != null) {
    if (m.weekChange > 0) { score += 5; reasons.push(`Up ${round(m.weekChange, 2)}% over the week`); }
    else if (m.weekChange < 0) { score -= 5; reasons.push(`Down ${round(m.weekChange, 2)}% over the week`); }
  }

  // Position inside 52-week range (momentum/context)
  if (m.price != null && m.week52High != null && m.week52Low != null && m.week52High > m.week52Low) {
    const posPct = ((m.price - m.week52Low) / (m.week52High - m.week52Low)) * 100;
    if (posPct >= 85) { score += 4; reasons.push('Trading near 52-week highs'); }
    else if (posPct <= 15) { score -= 4; reasons.push('Trading near 52-week lows'); }
  }

  // Analyst rating (stocks; null for crypto)
  if (m.analystRating === 'Buy') { score += 5; reasons.push('Analyst consensus: Buy'); }
  else if (m.analystRating === 'Sell') { score -= 5; reasons.push('Analyst consensus: Sell'); }

  // Valuation (stocks only)
  if (m.peRatio != null && m.peRatio > 0 && m.peRatio < 25) {
    score += 5;
    reasons.push(`P/E ${round(m.peRatio, 1)} — reasonable valuation`);
  }

  // Golden vs death cross (50 vs 200)
  if (ema50 != null && ema200 != null) {
    if (ema50 > ema200) { score += 8; reasons.push('Golden cross structure (EMA50 > EMA200)'); }
    else { score -= 8; reasons.push('Death cross structure (EMA50 < EMA200)'); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- Combined professional signal (7 labels) ---
  // Built from trend + MACD + RSI condition + score. RSI 70+ in an uptrend
  // becomes "Bullish but Extended", never bearish.
  const rsiVal = m.rsi14;
  const extended = rsiVal != null && rsiVal > 70;
  const oversold = rsiVal != null && rsiVal < 30;
  let signal;

  if (trendIsUp && macdUp && extended) {
    signal = 'Bullish but Extended';
  } else if ((posture === 'bull') && macdUp && score >= 72) {
    signal = 'Strong Bullish';
  } else if (trendIsUp && (macdUp || score >= 60) && !extended) {
    signal = 'Bullish';
  } else if (trendIsDown && macdDown) {
    signal = 'Bearish';
  } else if (posture === 'lean-bear' || (trendIsDown && !macdDown) || (rsiVal != null && rsiVal < 45 && !trendIsUp)) {
    signal = 'Weak';
  } else if (oversold && !trendIsDown) {
    signal = 'Watch';
  } else if (posture === 'mixed' || (macdUp !== macdDown && !trendIsUp && !trendIsDown)) {
    signal = 'Watch';
  } else {
    signal = 'Neutral';
  }

  // Fallback for thin data (e.g. some crypto): lean on score alone.
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
    rsiCondition: rsiCondition(rsiVal),
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
  };
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

  const [barsR, snapR, profR, metR, recR] = await Promise.allSettled([
    getJSON(barsUrl, { headers: alpHeaders }),
    getJSON(snapUrl, { headers: alpHeaders }),
    fh ? getJSON(fhUrl(`stock/profile2?symbol=${symbol}`)) : Promise.resolve(null),
    fh ? getJSON(fhUrl(`stock/metric?symbol=${symbol}&metric=all`)) : Promise.resolve(null),
    fh ? getJSON(fhUrl(`stock/recommendation?symbol=${symbol}`)) : Promise.resolve(null),
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

  // Finnhub fundamentals
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

  const metrics = {
    price, changePercent, weekChange: d.weekChange, rvol: d.rvol,
    rsi14: d.rsi14, ema20: d.ema20, ema50: d.ema50, ema200: d.ema200,
    macdHist: d.macdHist, peRatio,
    week52High: d.week52High, week52Low: d.week52Low, analystRating,
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
    support: round(d.support, 2),
    resistance: round(d.resistance, 2),
    week52High: round(d.week52High, 2),
    week52Low: round(d.week52Low, 2),
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
  const d = deriveSeries({ closes: liveCloses, highs: null, lows: null, volumes, dates });

  const metrics = {
    price, changePercent, weekChange: d.weekChange, rvol: d.rvol,
    rsi14: d.rsi14, ema20: d.ema20, ema50: d.ema50, ema200: d.ema200,
    macdHist: d.macdHist, peRatio: null,
    week52High: d.week52High, week52Low: d.week52Low, analystRating: null,
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
    support: round(d.support, 2),
    resistance: round(d.resistance, 2),
    week52High: round(d.week52High, 2),
    week52Low: round(d.week52Low, 2),
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
