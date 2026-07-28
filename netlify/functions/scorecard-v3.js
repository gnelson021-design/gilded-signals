// netlify/functions/scorecard-v3.js
// Gilded Signals — methodology v3 scorecard engine (target / invalidation)
//
// Runs alongside scorecard.js WITHOUT modifying it, requiring it, or
// sharing any state with it. scorecard.js stays exactly as it is, so
// every week already graded under it stays exactly as archived.
//
// Usage: /.netlify/functions/scorecard-v3?week=2026-08-03
//
// Methodology (v3-target-invalidation):
//  - A pick is only graded once its published Buy Zone (zones[0]) --
//    or, if it triggers, its optional Accumulation Zone (zones[1]) --
//    is actually touched. Entry detection is identical to scorecard.js's
//    dip-zone/breakout logic (duplicated below, not imported, so this
//    file has zero dependency on the locked one).
//  - A pick that never reaches its Buy Zone is graded as
//    "watching_no_trade" -- never counted as a win or a loss.
//  - Once triggered, each subsequent session is checked for:
//      * bar.low <= invalidationLevel  -> "stopped_out"
//      * bar.high >= firstTarget       -> "target_reached"
//    If a single session's range crosses both, invalidation is checked
//    first -- daily bars have no intraday sequencing, so ties resolve
//    toward the more conservative, risk-first read rather than the
//    more flattering one.
//  - Neither hit yet -> "active_position" (the day of entry itself is
//    "buy_zone_triggered"; every day after that it's "active_position").
//  - No published invalidation/target level, or missing market data,
//    is flagged explicitly rather than guessed.
//
// Same data provider as scorecard.js: Alpaca daily bars only. No
// external npm packages. Node 18+ global fetch.

'use strict';

const FETCH_TIMEOUT_MS = 12000;
const BARS_LOOKBACK_DAYS = 14;

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map(); // week -> { expires, data }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}
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

// Same convention as scorecard.js: fetch the site's own public data file
// rather than reading the filesystem, so there's exactly one copy of the
// data and it's independently auditable at that URL.
async function loadPicksData(week) {
  const site = process.env.URL || 'https://gildedsignals.com';
  const url = `${site}/data/picks-${week}.json`;
  try {
    return await getJSON(url);
  } catch (e) {
    throw new Error(`Could not load ${url}: ${e.message}`);
  }
}

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
  return bars.map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c }));
}

// ---------------------------------------------------------------------------
// Entry detection -- identical rules to scorecard.js, duplicated on purpose.
// ---------------------------------------------------------------------------
function detectDipZoneEntry(bars, zones) {
  const triggered = [];
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
    return { triggered: false, entryPrice: null, entryDate: null, triggeredZones: [] };
  }

  const totalWeight = triggered.reduce((s, t) => s + t.weight, 0);
  const entryPrice = triggered.reduce((s, t) => s + t.price * (t.weight / totalWeight), 0);
  const entryDate = triggered[triggered.length - 1].date;

  return {
    triggered: true,
    entryPrice: round(entryPrice, 4),
    entryDate,
    triggeredZones: triggered.map((t) => ({ price: t.price, date: t.date })),
  };
}

function detectBreakoutEntry(bars, zone) {
  for (const bar of bars) {
    if (bar.close > zone.price) {
      return {
        triggered: true,
        entryPrice: round(bar.close, 4),
        entryDate: bar.date,
        triggeredZones: [{ price: zone.price, date: bar.date, note: 'confirmed_daily_close_above' }],
      };
    }
  }
  return { triggered: false, entryPrice: null, entryDate: null, triggeredZones: [] };
}

// ---------------------------------------------------------------------------
// Post-entry outcome: did the published target or invalidation level hit
// first? Only looks at sessions on/after the entry date.
// ---------------------------------------------------------------------------
function detectOutcome(bars, entryDate, firstTarget, invalidationLevel) {
  const sessions = bars.filter((b) => b.date >= entryDate);
  for (const bar of sessions) {
    if (invalidationLevel != null && bar.low <= invalidationLevel) {
      return { outcome: 'stopped_out', outcomeDate: bar.date, outcomePrice: invalidationLevel };
    }
    if (firstTarget != null && bar.high >= firstTarget) {
      return { outcome: 'target_reached', outcomeDate: bar.date, outcomePrice: firstTarget };
    }
  }
  return { outcome: null, outcomeDate: null, outcomePrice: null };
}

function isGradingComplete(resultsGradeDate) {
  const MARKET_CLOSE_MINUTES = 16 * 60;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const etDate = map.year + '-' + map.month + '-' + map.day;
  let etHour = parseInt(map.hour, 10);
  if (etHour === 24) etHour = 0;
  const etMinutes = etHour * 60 + parseInt(map.minute, 10);
  if (etDate > resultsGradeDate) return true;
  if (etDate < resultsGradeDate) return false;
  return etMinutes >= MARKET_CLOSE_MINUTES;
}

// ---------------------------------------------------------------------------
// Grade a single pick.
// ---------------------------------------------------------------------------
function gradePick(pick, bars, todayStr) {
  const base = {
    rank: pick.rank,
    ticker: pick.ticker,
    company: pick.company,
    tier: pick.tier,
    entryType: pick.entryType,
    priceAtPublish: pick.priceAtPublish,
    firstTarget: pick.firstTarget != null ? pick.firstTarget : null,
    invalidationLevel: pick.invalidationLevel != null ? pick.invalidationLevel : null,
    actionStatus: pick.actionStatus || null,
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
      : { triggered: false, entryPrice: null, entryDate: null, triggeredZones: [] };

  if (!detection.triggered) {
    return { ...base, status: 'watching_no_trade', triggeredZones: [] };
  }

  if (pick.firstTarget == null || pick.invalidationLevel == null) {
    // Triggered, but the week wasn't published with the fields this
    // methodology requires -- surfaced explicitly rather than guessed.
    return {
      ...base,
      status: 'buy_zone_triggered',
      entryPrice: detection.entryPrice,
      entryDate: detection.entryDate,
      triggeredZones: detection.triggeredZones,
      note: 'Missing published firstTarget/invalidationLevel for this pick.',
    };
  }

  const outcome = detectOutcome(bars, detection.entryDate, pick.firstTarget, pick.invalidationLevel);
  const lastBar = bars[bars.length - 1];

  let status;
  if (outcome.outcome === 'stopped_out') status = 'stopped_out';
  else if (outcome.outcome === 'target_reached') status = 'target_reached';
  else status = detection.entryDate === todayStr ? 'buy_zone_triggered' : 'active_position';

  return {
    ...base,
    status,
    entryPrice: detection.entryPrice,
    entryDate: detection.entryDate,
    triggeredZones: detection.triggeredZones,
    markPrice: lastBar.close,
    markDate: lastBar.date,
    returnPct: round(((lastBar.close - detection.entryPrice) / detection.entryPrice) * 100, 2),
    outcomeDate: outcome.outcomeDate,
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

  const cached = cache.get(week);
  if (cached && cached.expires > Date.now()) {
    return ok({ ...cached.data, cached: true });
  }

  let picksData;
  try {
    picksData = await loadPicksData(week);
  } catch (e) {
    return fail(e.message, { week });
  }

  const gradingComplete = isGradingComplete(picksData.resultsGradeDate);
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

  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const gradedPicks = picksData.picks.map((p) =>
    gradePick(p, barsByTicker[p.ticker] || null, todayParts)
  );

  let benchmarkReturn = null;
  const spyBars = spyResult[0].status === 'fulfilled' ? spyResult[0].value : null;
  if (spyBars && spyBars.length) {
    const first = spyBars[0];
    const last = spyBars[spyBars.length - 1];
    benchmarkReturn = round(((last.close - first.open) / first.open) * 100, 2);
  }

  // Process metrics -- this is the point of v3: measuring how the
  // strategy executed, not just how many names were green by Friday.
  const totalPublished = gradedPicks.length;
  const enteredStatuses = ['buy_zone_triggered', 'active_position', 'target_reached', 'stopped_out'];
  const tradesEntered = gradedPicks.filter((p) => enteredStatuses.includes(p.status)).length;
  const targetsReached = gradedPicks.filter((p) => p.status === 'target_reached').length;
  const stillActive = gradedPicks.filter((p) => p.status === 'buy_zone_triggered' || p.status === 'active_position').length;
  const stoppedOut = gradedPicks.filter((p) => p.status === 'stopped_out').length;
  const neverTriggered = gradedPicks.filter((p) => p.status === 'watching_no_trade' || p.status === 'no_entry_this_week').length;
  const dataUnavailable = gradedPicks.filter((p) => p.status === 'data_unavailable').length;

  const resolved = gradedPicks.filter((p) => p.status === 'target_reached' || p.status === 'stopped_out');
  const modelReturn =
    resolved.length > 0 ? round(resolved.reduce((s, p) => s + p.returnPct, 0) / resolved.length, 2) : null;
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
      totalPublished,
      buyZonesTriggered: tradesEntered,
      tradesEntered,
      targetsReached,
      stillActive,
      neverTriggered,
      stoppedOut,
      dataUnavailable,
      modelReturnPct: modelReturn,
      vsBenchmarkPct: vsBenchmark,
    },
    picks: gradedPicks,
  };

  if (dataUnavailable === 0) {
    cache.set(week, { expires: Date.now() + CACHE_TTL_MS, data: responseBody });
  }

  return ok({ ...responseBody, cached: false });
};

exports._internal = { detectDipZoneEntry, detectBreakoutEntry, detectOutcome, gradePick, round };
