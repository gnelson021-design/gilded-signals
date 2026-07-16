// netlify/functions/scorecard.js
// Gilded Signals — standardized weekly scorecard engine
// Reads a week's picks data (published entry zones), pulls Alpaca daily
// bars, detects entry triggers, and computes the objective scorecard:
// model return, S&P 500 benchmark, win rate, and per-pick status.
//
// Usage: /.netlify/functions/scorecard?week=2026-07-13
//
// DATA PROVIDER — confirmed against the live site's actual codebase
// (audited 2026-07-13, not assumed):
//  - All price/OHLC history used in every calculation below comes from
//    Alpaca's daily bars endpoint — the same source quote.js already
//    uses for the live scanner, the weekly brief's live current-price
//    marker, and the top-of-page ticker bar. This keeps scorecard
//    returns consistent with the prices subscribers already see on
//    the page.
//  - Finnhub is NOT called anywhere in this file. It stays scoped to
//    news.js (news feed) and quote.js's fundamentals fields, per
//    existing site convention. Nothing here migrates or touches that.
//  - Analyst min/avg/max target figures are not used in any scorecard
//    math — those are the manually-researched numbers in the weekly
//    brief copy and were never live-fetched by any function.
//  - CoinGecko is not called — this week's 15 picks are all stocks;
//    a crypto pick would need its own branch (not built yet, since
//    nothing in the current picks data requires it).
//
// Methodology (v2-staged-entry):
//  - dip_zone picks trigger when a session's LOW (Alpaca daily bar)
//    touches/crosses a published zone price. Entry price = the zone's
//    own published price, never the session low itself (no hindsight
//    low-picking).
//  - If multiple zones trigger, the standardized entry is a weighted
//    average using the pick's predetermined weights, renormalized across
//    whichever zones actually triggered.
//  - breakout picks trigger on the first session whose CLOSE (Alpaca
//    daily bar) crosses the published level. Entry price = that
//    session's actual close.
//  - no_entry picks never enter the return/win-rate calculation.
//  - Missing/incomplete Alpaca data for a ticker is flagged as
//    "data_unavailable" and excluded from every aggregate calculation —
//    never substituted or estimated.
//
// No external npm packages. Node 18+ global fetch.

'use strict';

const FETCH_TIMEOUT_MS = 12000;
const BARS_LOOKBACK_DAYS = 14; // plenty of buffer before/after a single scored week

// Warm-container cache, same convention as quote.js: a full computed
// response is reused for CACHE_TTL_MS before recomputing. This is the fix
// for the 2026-07-13 incident — without it, every single page load fired
// 13 fresh Alpaca calls simultaneously (12 picks + SPY), stacked on top of
// the ticker tape's own ~14 calls, which could exhaust rate limits or time
// out under repeated reloads. A response is only cached if every ticker's
// data came back clean (see the dataUnavailable check near the bottom) —
// a transient Alpaca failure retries fresh on the very next request rather
// than getting locked in as the answer for everyone for two minutes.
const CACHE_TTL_MS = 2 * 60 * 1000;
const scorecardCache = new Map(); // week -> { expires, data }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

// Errors are never 500 — always a 200 with an explicit error field, same
// convention as quote.js, so the front end can render a clear message
// instead of a broken fetch.
function fail(message, extra = {}) {
  return ok({ error: message, ...extra });
}

function round(n, dp = 2) {
  if (n == null || !isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
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
// Load the week's published picks data from the site's own static file.
// This lives at repo root (data/picks-{week}.json) and is served publicly
// by Netlify's static file host — the function fetches it the same way a
// browser would, rather than reading the filesystem, so there's exactly
// one copy of the data and it's independently auditable at that URL.
// ---------------------------------------------------------------------------
async function loadPicksData(week) {
  const site = process.env.URL || 'https://gildedsignals.com';
  const url = `${site}/data/picks-${week}.json`;
  try {
    return await getJSON(url);
  } catch (e) {
    throw new Error(`Could not load ${url}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Alpaca daily bars for one symbol, ascending chronological order.
// ---------------------------------------------------------------------------
async function getDailyBars(symbol, startDateStr) {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error('Alpaca credentials not configured');
  const feed = process.env.ALPACA_FEED || 'iex';

  const url =
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars` +
    `?timeframe=1Day&start=${startDateStr}&limit=${BARS_LOOKBACK_DAYS}` +
    `&adjustment=split&sort=asc&feed=${feed}`;

  const data = await getJSON(url, {
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
  });
  const bars = Array.isArray(data.bars) ? data.bars : [];
  if (!bars.length) throw new Error(`No bars returned for ${symbol}`);
  // { t, o, h, l, c, v } per bar, already ascending since sort=asc.
  return bars.map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c }));
}

// ---------------------------------------------------------------------------
// Entry detection
// ---------------------------------------------------------------------------
function detectDipZoneEntry(bars, zones) {
  const triggered = []; // { price, weight, date }
  const remaining = zones.map((z) => ({ ...z, hit: false }));

  for (const bar of bars) {
    for (const z of remaining) {
      if (!z.hit && bar.low <= z.price) {
        z.hit = true;
        triggered.push({ price: z.price, weight: z.weight, date: bar.date });
      }
    }
  }

  if (!triggered.length) {
    return { status: 'waiting_for_entry', entryPrice: null, entryDate: null, triggeredZones: [] };
  }

  const totalWeight = triggered.reduce((s, t) => s + t.weight, 0);
  const entryPrice = triggered.reduce((s, t) => s + t.price * (t.weight / totalWeight), 0);
  const entryDate = triggered[triggered.length - 1].date; // last zone to trigger = when entry was completed

  return {
    status: 'triggered',
    entryPrice: round(entryPrice, 4),
    entryDate,
    triggeredZones: triggered.map((t) => ({ price: t.price, date: t.date })),
  };
}

function detectBreakoutEntry(bars, zone) {
  for (const bar of bars) {
    if (bar.close > zone.price) {
      return {
        status: 'triggered',
        entryPrice: round(bar.close, 4),
        entryDate: bar.date,
        triggeredZones: [{ price: zone.price, date: bar.date, note: 'confirmed_daily_close_above' }],
      };
    }
  }
  return { status: 'waiting_for_entry', entryPrice: null, entryDate: null, triggeredZones: [] };
}

// ---------------------------------------------------------------------------
// Purely observational "approaching the published zone" flag for picks that
// are still waiting_for_entry. Read-only -- never changes status, never
// touches grading. Deterministic and derived only from already-published
// data: the pick's own zone prices and the same daily bar already fetched
// for grading. Watch band = one zone-width above the top published zone
// price, where zone width comes from the pick's own levels (not a fixed
// global percentage). A single-level zone has no width, so it gets no
// watch band -- there's nothing published to derive one from.
// ---------------------------------------------------------------------------
function buildWatchInfo(pick, bars) {
  if (pick.entryType !== 'dip_zone' || !Array.isArray(pick.zones) || !pick.zones.length || !bars || !bars.length) {
    return {};
  }
  const prices = pick.zones.map((z) => z.price);
  const zoneHigh = Math.max(...prices);
  const zoneLow = Math.min(...prices);
  const zoneWidth = zoneHigh - zoneLow;
  const markPrice = bars[bars.length - 1].close;
  const watchClose = zoneWidth > 0 && markPrice > zoneHigh && markPrice <= zoneHigh + zoneWidth;
  return { markPrice, zoneHigh, zoneLow, watchClose };
}

// ---------------------------------------------------------------------------
// Grade a single pick against its bars.
// ---------------------------------------------------------------------------
function gradePick(pick, bars, gradingComplete) {
  const base = {
    rank: pick.rank,
    ticker: pick.ticker,
    company: pick.company,
    tier: pick.tier,
    entryType: pick.entryType,
    priceAtPublish: pick.priceAtPublish,
  };

  if (pick.entryType === 'no_entry') {
    return { ...base, status: 'no_entry_this_week', note: pick.note || null };
  }

  if (!bars || !bars.length) {
    return { ...base, status: 'data_unavailable', note: 'No market data returned for this ticker.' };
  }

  const detection =
    pick.entryType === 'dip_zone'
      ? detectDipZoneEntry(bars, pick.zones)
      : pick.entryType === 'breakout'
      ? detectBreakoutEntry(bars, pick.zones[0])
      : { status: 'unsupported_entry_type', entryPrice: null, entryDate: null, triggeredZones: [] };

  if (detection.status === 'waiting_for_entry' || detection.status === 'unsupported_entry_type') {
    return { ...base, status: 'waiting_for_entry', triggeredZones: [], ...buildWatchInfo(pick, bars) };
  }

  const lastBar = bars[bars.length - 1];
  const markPrice = lastBar.close;
  const returnPct = round(((markPrice - detection.entryPrice) / detection.entryPrice) * 100, 2);

  return {
    ...base,
    status: gradingComplete ? (returnPct > 0 ? 'closed_win' : 'closed_loss') : 'active',
    entryPrice: detection.entryPrice,
    entryDate: detection.entryDate,
    triggeredZones: detection.triggeredZones,
    markPrice,
    markDate: lastBar.date,
    returnPct,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const week = ((event.queryStringParameters && event.queryStringParameters.week) || '').trim();
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return fail('Missing or invalid required parameter: week (expected YYYY-MM-DD)');
  }

  // Serve from warm-container cache when fresh — skips the picks-data fetch
  // and every Alpaca call entirely.
  const cachedEntry = scorecardCache.get(week);
  if (cachedEntry && cachedEntry.expires > Date.now()) {
    return ok({ ...cachedEntry.data, cached: true });
  }

  let picksData;
  try {
    picksData = await loadPicksData(week);
  } catch (e) {
    return fail(e.message, { week });
  }

  const today = new Date().toISOString().slice(0, 10);
  const gradingComplete = today >= picksData.resultsGradeDate;
  const startDateStr = picksData.briefPublishedAt.slice(0, 10);

  const gradable = picksData.picks.filter((p) => p.entryType !== 'no_entry');

  const barsResults = await Promise.allSettled(
    gradable.map((p) => getDailyBars(p.ticker, startDateStr))
  );
  const spyResult = await Promise.allSettled([getDailyBars('SPY', startDateStr)]);

  const barsByTicker = {};
  gradable.forEach((p, i) => {
    barsByTicker[p.ticker] = barsResults[i].status === 'fulfilled' ? barsResults[i].value : null;
  });

  const gradedPicks = picksData.picks.map((p) =>
    gradePick(p, barsByTicker[p.ticker] || null, gradingComplete)
  );

  // Benchmark: SPY change from the first session on/after publish through
  // the most recent available session (or grading day, once final).
  let benchmarkReturn = null;
  const spyBars = spyResult[0].status === 'fulfilled' ? spyResult[0].value : null;
  if (spyBars && spyBars.length) {
    const first = spyBars[0];
    const last = spyBars[spyBars.length - 1];
    benchmarkReturn = round(((last.close - first.open) / first.open) * 100, 2);
  }

  const completed = gradedPicks.filter((p) => p.status === 'closed_win' || p.status === 'closed_loss');
  const profitable = gradedPicks.filter((p) => p.status === 'closed_win').length;
  const unprofitable = gradedPicks.filter((p) => p.status === 'closed_loss').length;
  const active = gradedPicks.filter((p) => p.status === 'active').length;
  const waitingForEntry = gradedPicks.filter((p) => p.status === 'waiting_for_entry').length;
  const dataUnavailable = gradedPicks.filter((p) => p.status === 'data_unavailable').length;
  const noEntryThisWeek = gradedPicks.filter((p) => p.status === 'no_entry_this_week').length;

  const modelReturn =
    completed.length > 0
      ? round(completed.reduce((s, p) => s + p.returnPct, 0) / completed.length, 2)
      : null;

  const winRate =
    completed.length > 0 ? round((profitable / completed.length) * 100, 1) : null;

  const vsBenchmark =
    modelReturn != null && benchmarkReturn != null ? round(modelReturn - benchmarkReturn, 2) : null;

  const responseBody = {
    week,
    methodologyVersion: picksData.methodologyVersion,
    dataSource: 'Alpaca (' + (process.env.ALPACA_FEED || 'iex') + ' feed)',
    dataTimestamp: new Date().toISOString(),
    gradingComplete,
    resultsGradeDate: picksData.resultsGradeDate,
    benchmark: { index: picksData.benchmarkIndex || 'SPY', returnPct: benchmarkReturn },
    summary: {
      totalPublished: picksData.picks.length,
      waitingForEntry,
      active,
      profitable,
      unprofitable,
      noEntryThisWeek,
      dataUnavailable,
      completedTriggered: completed.length,
      winRatePct: winRate,
      modelReturnPct: modelReturn,
      vsBenchmarkPct: vsBenchmark,
    },
    picks: gradedPicks,
  };

  // Only cache a clean result. If any ticker came back data_unavailable,
  // that's exactly the kind of transient failure that should retry fresh
  // next time, not get locked in as the cached answer for two minutes.
  if (dataUnavailable === 0) {
    scorecardCache.set(week, { expires: Date.now() + CACHE_TTL_MS, data: responseBody });
  }

  return ok({ ...responseBody, cached: false });
};

// Exported alongside the handler so the pure entry/grading logic can be
// unit-tested with synthetic bar data, without needing live Alpaca calls.
exports._internal = { detectDipZoneEntry, detectBreakoutEntry, gradePick, round };
