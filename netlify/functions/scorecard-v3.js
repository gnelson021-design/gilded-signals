// netlify/functions/scorecard-v3.js
// Gilded Signals — methodology v3 scorecard engine (target / invalidation)
// v3.1: OFFICIAL trigger verification now runs on Alpaca HISTORICAL SIP
// 5-minute bars (consolidated tape), regular session only, instead of
// IEX daily bars. Triggers are persisted to a Netlify Blobs ledger and
// can never revert. Runs alongside scorecard.js WITHOUT modifying it.
//
// Usage: /.netlify/functions/scorecard-v3?week=2026-08-10
//        /.netlify/functions/scorecard-v3?week=2026-08-10&audit=1
//
// Methodology (v3-target-invalidation), unchanged in substance:
//  - A pick is only graded once its published Buy Zone trigger price
//    (zones[0]) — or its optional Accumulation Zone (zones[1]) — is
//    actually touched during a REGULAR U.S. market session (09:30–16:00
//    ET) between the briefing week's Monday open and Friday close.
//  - Buy 1 and Buy 2 are detected independently. Either can trigger
//    without the other. Once a zone has triggered it stays triggered.
//  - Premarket, after-hours, and weekend/overnight prints NEVER count.
//  - A pick that never reaches a published zone is "watching_no_trade"
//    — never a win or a loss.
//  - After entry, every subsequent 5-minute regular-session bar is
//    checked chronologically for invalidation (bar.low <= level) and
//    first target (bar.high >= target). Within a single bar, the
//    invalidation check runs first — same conservative tie rule as
//    before, now at 5-minute resolution. Targets that print BEFORE the
//    entry actually triggered never count.
//  - Outcome monitoring and marks continue past Friday for positions
//    that remain open (carry-forward rule) — entries, however, can only
//    trigger inside the briefing week itself.
//
// Data: Alpaca historical SIP 5Min bars. Basic-plan rule: the requested
// end time must be at least 15 minutes old, so every request clamps its
// end to now minus 16 minutes. Official status therefore confirms with
// a ~15-minute delay — accepted by design. The site's live-quote system
// is separate and untouched.
//
// Persistence: Netlify Blobs store "gs-trigger-ledger", one JSON doc
// per week. First write of any event is immutable; recomputation merges
// and can only ADD events, never remove or alter them. If Blobs is
// unavailable the engine still grades correctly from historical bars
// (which are themselves durable) and reports ledger: "unavailable".

'use strict';

const FETCH_TIMEOUT_MS = 12000;
const MAX_BAR_PAGES = 6; // 6 x 10000 bars — far beyond any real week
const DATA_DELAY_MS = 16 * 60 * 1000; // Basic-plan SIP: end >= 15 min old
const SESSION_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const SESSION_CLOSE_MIN = 16 * 60;    // 16:00 ET

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map(); // week -> { expires, data }

// Guarded require: if @netlify/blobs ever fails to bundle, the engine
// still runs — it just reports the ledger as unavailable.
let blobsMod = null;
try { blobsMod = require('@netlify/blobs'); } catch (_) { blobsMod = null; }

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
function isoNoMs(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
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
    return await getJSON(url, { headers: { 'x-gs-internal': process.env.GS_INTERNAL_SECRET || '' } });
  } catch (e) {
    throw new Error(`Could not load ${url}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Eastern-time conversion. Every bar timestamp is converted to ET once;
// all session filtering, week windows, and audit fields use ET so DST is
// handled by the runtime, never by hand-coded offsets.
// ---------------------------------------------------------------------------
const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function etParts(isoOrDate) {
  const parts = ET_FMT.formatToParts(new Date(isoOrDate));
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  let h = parseInt(m.hour, 10);
  if (h === 24) h = 0;
  const min = parseInt(m.minute, 10);
  return {
    date: m.year + '-' + m.month + '-' + m.day,
    minutes: h * 60 + min,
    time: String(h).padStart(2, '0') + ':' + m.minute,
  };
}

// ---------------------------------------------------------------------------
// Historical SIP 5-minute bars, paginated, filtered to REGULAR SESSION
// (09:30–16:00 ET) only. Bar timestamps are bar START times, so a bar
// starting 15:55 ET (ends 16:00) is the last eligible bar of a session
// and a 09:25 premarket bar is excluded.
// ---------------------------------------------------------------------------
async function getIntradayBars(symbol, startISO, endISO) {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error('Alpaca credentials not configured');
  const feed = process.env.GS_SCORECARD_FEED || 'sip';

  const base =
    `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars` +
    `?timeframe=5Min&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}` +
    `&limit=10000&adjustment=split&sort=asc&feed=${feed}`;

  let all = [];
  let pageToken = null;
  let pages = 0;
  do {
    const url = pageToken ? base + '&page_token=' + encodeURIComponent(pageToken) : base;
    const data = await getJSON(url, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
    });
    const bars = Array.isArray(data.bars) ? data.bars : [];
    all = all.concat(bars);
    pageToken = data.next_page_token || null;
    pages++;
  } while (pageToken && pages < MAX_BAR_PAGES);

  if (!all.length) throw new Error(`No bars returned for ${symbol}`);

  return filterRegularSession(
    all.map((b) => ({ t: b.t, open: b.o, high: b.h, low: b.l, close: b.c }))
  );
}

// Split out so the session filter itself is unit-testable offline.
function filterRegularSession(rawBars) {
  return rawBars
    .map((b) => {
      const et = etParts(b.t);
      return { t: b.t, etDate: et.date, etTime: et.time, etMinutes: et.minutes, open: b.open, high: b.high, low: b.low, close: b.close };
    })
    .filter((b) => b.etMinutes >= SESSION_OPEN_MIN && b.etMinutes < SESSION_CLOSE_MIN);
}

// ---------------------------------------------------------------------------
// Zone-touch candidates. Independent per zone; first regular-session bar
// inside the briefing week (Monday..Friday ET) whose low reaches the
// published trigger price. Returns full audit detail per event.
// ---------------------------------------------------------------------------
function computeZoneTouchCandidates(pick, bars, weekMonday, weekFriday, feed) {
  const events = [];
  (pick.zones || []).forEach((z, idx) => {
    for (const bar of bars) {
      if (bar.etDate < weekMonday) continue;
      if (bar.etDate > weekFriday) break; // bars are ascending
      if (bar.low <= z.price) {
        events.push({
          ticker: pick.ticker,
          zoneIndex: idx,
          zoneLabel: 'Buy ' + (idx + 1),
          publishedZonePrice: z.price,
          weight: z.weight != null ? z.weight : 1,
          dateET: bar.etDate,
          timeET: bar.etTime,
          barT: bar.t,
          barLow: bar.low,
          barHigh: bar.high,
          barClose: bar.close,
          session: 'regular',
          feed: feed,
        });
        break;
      }
    }
  });
  return events;
}

// Breakout mechanic (e.g. MSTR in past weeks): a confirmed REGULAR-SESSION
// daily close above the published level, derived from the last 5Min bar of
// each completed session inside the briefing week.
function computeBreakoutCandidates(pick, bars, weekMonday, weekFriday, feed, todayET, nowMs) {
  const zone = pick.zones && pick.zones[0];
  if (!zone) return [];
  const lastBarByDay = new Map();
  for (const bar of bars) {
    if (bar.etDate < weekMonday || bar.etDate > weekFriday) continue;
    lastBarByDay.set(bar.etDate, bar); // ascending — last write wins
  }
  for (const [day, bar] of lastBarByDay) {
    const dayComplete = day < todayET || nowMs - new Date(bar.t).getTime() > 30 * 60 * 1000 && bar.etMinutes >= SESSION_CLOSE_MIN - 5;
    if (!dayComplete) continue;
    if (bar.close > zone.price) {
      return [{
        ticker: pick.ticker,
        zoneIndex: 0,
        zoneLabel: 'Breakout',
        publishedZonePrice: zone.price,
        weight: 1,
        dateET: day,
        timeET: bar.etTime,
        barT: bar.t,
        barLow: bar.low,
        barHigh: bar.high,
        barClose: bar.close,
        session: 'regular',
        feed: feed,
        note: 'confirmed_regular_session_close_above',
      }];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Post-entry outcome, chronological on 5Min regular-session bars. Scanning
// starts AT the first entry-trigger bar; within any single bar the
// invalidation check runs first (conservative tie rule). Targets printing
// before the entry triggered can never be reached by this scan.
// ---------------------------------------------------------------------------
function detectOutcomeIntraday(bars, firstEventT, firstTarget, invalidationLevel) {
  if (firstTarget == null && invalidationLevel == null) return null;
  for (const bar of bars) {
    if (bar.t < firstEventT) continue;
    if (invalidationLevel != null && bar.low <= invalidationLevel) {
      return { type: 'stopped_out', level: invalidationLevel, dateET: bar.etDate, timeET: bar.etTime, barT: bar.t };
    }
    if (firstTarget != null && bar.high >= firstTarget) {
      return { type: 'target_reached', level: firstTarget, dateET: bar.etDate, timeET: bar.etTime, barT: bar.t };
    }
  }
  return null;
}

function isGradingComplete(resultsGradeDate) {
  const nowET = etParts(new Date());
  if (nowET.date > resultsGradeDate) return true;
  if (nowET.date < resultsGradeDate) return false;
  return nowET.minutes >= SESSION_CLOSE_MIN;
}

// ---------------------------------------------------------------------------
// Grade a single pick from its merged (ledger + fresh) event set.
// Response shape is a superset of the previous engine's — every field the
// frontend already reads is preserved with the same name and meaning.
// ---------------------------------------------------------------------------
function gradePickV31(pick, bars, zoneEvents, outcome, todayET) {
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

  const events = (zoneEvents || []).slice().sort((a, b) => (a.barT < b.barT ? -1 : a.barT > b.barT ? 1 : 0));

  if (!events.length) {
    return { ...base, status: 'watching_no_trade', triggeredZones: [], triggerEvents: [] };
  }

  // Entry blend: zones that triggered at/before the outcome event (all of
  // them if the position is still open) — chronology can never let a zone
  // that touched after a stop/target retroactively change the entry.
  const eligible = outcome && outcome.barT
    ? events.filter((e) => e.barT <= outcome.barT)
    : events;
  const blendSet = eligible.length ? eligible : events;

  const totalWeight = blendSet.reduce((s, e) => s + e.weight, 0);
  const entryPrice = round(
    blendSet.reduce((s, e) => s + e.publishedZonePrice * (e.weight / totalWeight), 0),
    4
  );
  const lastBlend = blendSet[blendSet.length - 1];
  const entryDate = lastBlend.dateET;
  const entryTime = lastBlend.timeET;

  const common = {
    ...base,
    entryPrice,
    entryDate,
    entryTime,
    triggeredZones: blendSet.map((e) => ({ price: e.publishedZonePrice, date: e.dateET })),
    triggerEvents: events, // full audit trail, both zones, chronological
  };

  if (pick.firstTarget == null || pick.invalidationLevel == null) {
    return {
      ...common,
      status: 'buy_zone_triggered',
      note: 'Missing published firstTarget/invalidationLevel for this pick.',
    };
  }

  const lastBar = bars[bars.length - 1];

  if (outcome) {
    const status = outcome.type; // 'stopped_out' | 'target_reached'
    return {
      ...common,
      status,
      markPrice: lastBar.close,
      markDate: lastBar.etDate,
      markTime: lastBar.etTime,
      // Resolved trades are measured at their actual published exit level
      // (invalidation or first target), not wherever price drifted after.
      returnPct: round(((outcome.level - entryPrice) / entryPrice) * 100, 2),
      outcomeDate: outcome.dateET,
      outcomeTime: outcome.timeET,
      outcomePrice: outcome.level,
    };
  }

  const status = entryDate === todayET ? 'buy_zone_triggered' : 'active_position';
  return {
    ...common,
    status,
    markPrice: lastBar.close,
    markDate: lastBar.etDate,
    markTime: lastBar.etTime,
    returnPct: round(((lastBar.close - entryPrice) / entryPrice) * 100, 2),
    outcomeDate: null,
    outcomeTime: null,
  };
}

// ---------------------------------------------------------------------------
// Trigger ledger — Netlify Blobs, one JSON doc per week, append-only.
// Keys: "TICKER|zoneN" for entries, "TICKER|outcome" for stop/target.
// First write wins; merges can only ADD.
// ---------------------------------------------------------------------------
function getLedgerStore(event) {
  if (!blobsMod) return null;
  try {
    if (typeof blobsMod.connectLambda === 'function') blobsMod.connectLambda(event);
    return blobsMod.getStore('gs-trigger-ledger');
  } catch (_) {
    return null;
  }
}

function mergeLedger(ledger, week, candidatesByKey) {
  const doc = ledger && ledger.events ? ledger : { week, createdAt: isoNoMs(new Date()), events: {} };
  let dirty = false;
  for (const [k, ev] of Object.entries(candidatesByKey)) {
    if (!doc.events[k]) {
      doc.events[k] = { ...ev, recordedAt: isoNoMs(new Date()) };
      dirty = true;
    }
  }
  return { doc, dirty };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const qs = event.queryStringParameters || {};
  const week = (qs.week || '').trim();
  const audit = qs.audit === '1';
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return fail('Missing or invalid required parameter: week (expected YYYY-MM-DD)');
  }

  if (!audit) {
    const cached = cache.get(week);
    if (cached && cached.expires > Date.now()) {
      return ok({ ...cached.data, cached: true });
    }
  }

  let picksData;
  try {
    picksData = await loadPicksData(week);
  } catch (e) {
    return fail(e.message, { week });
  }

  const feed = process.env.GS_SCORECARD_FEED || 'sip';
  const weekMonday = picksData.weekOf || week;
  const weekFriday = picksData.resultsGradeDate;
  const gradingComplete = isGradingComplete(weekFriday);
  const nowMs = Date.now();
  const todayET = etParts(new Date(nowMs)).date;

  // Basic-plan SIP rule: requested end must be at least 15 minutes old.
  const startISO = weekMonday + 'T09:00:00Z'; // pre-session UTC, filtered later
  const endISO = isoNoMs(new Date(nowMs - DATA_DELAY_MS));

  const gradable = picksData.picks.filter((p) => p.entryType !== 'no_entry');

  const barsResults = await Promise.allSettled(
    gradable.map((p) => getIntradayBars(p.ticker, startISO, endISO))
  );
  const spyResult = await Promise.allSettled([getIntradayBars('SPY', startISO, endISO)]);

  const barsByTicker = {};
  gradable.forEach((p, i) => {
    barsByTicker[p.ticker] = barsResults[i].status === 'fulfilled' ? barsResults[i].value : null;
  });

  // --- Ledger: load, merge fresh candidates, persist any new events ------
  const store = getLedgerStore(event);
  let ledgerDoc = null;
  let ledgerStatus = 'unavailable';
  if (store) {
    try {
      ledgerDoc = await store.get('week-' + week, { type: 'json' });
      ledgerStatus = 'ok';
    } catch (_) {
      ledgerStatus = 'unavailable';
    }
  }

  const candidatesByKey = {};
  const eventsByTicker = {};
  const outcomeByTicker = {};

  for (const p of gradable) {
    const bars = barsByTicker[p.ticker];
    if (!bars || !bars.length) continue;

    const candidates =
      p.entryType === 'dip_zone'
        ? computeZoneTouchCandidates(p, bars, weekMonday, weekFriday, feed)
        : p.entryType === 'breakout'
        ? computeBreakoutCandidates(p, bars, weekMonday, weekFriday, feed, todayET, nowMs)
        : [];

    candidates.forEach((ev) => {
      candidatesByKey[p.ticker + '|zone' + ev.zoneIndex] = ev;
    });
  }

  let mergedDoc = { week, events: {} };
  if (ledgerStatus === 'ok') {
    const { doc, dirty } = mergeLedger(ledgerDoc, week, candidatesByKey);
    mergedDoc = doc;
    if (dirty) {
      try {
        mergedDoc.updatedAt = isoNoMs(new Date());
        await store.setJSON('week-' + week, mergedDoc);
      } catch (_) {
        ledgerStatus = 'write_failed';
      }
    }
  } else {
    // No ledger — grade from fresh candidates alone (historical bars are
    // themselves durable, so correctness is preserved).
    const { doc } = mergeLedger(null, week, candidatesByKey);
    mergedDoc = doc;
  }

  // Split merged events back out per ticker (entries only, sorted).
  for (const [k, ev] of Object.entries(mergedDoc.events)) {
    if (k.indexOf('|zone') === -1) continue;
    if (!eventsByTicker[ev.ticker]) eventsByTicker[ev.ticker] = [];
    eventsByTicker[ev.ticker].push(ev);
  }

  // Outcomes: honor a previously persisted outcome; otherwise scan, and
  // persist any newly resolved outcome (data is already >=15 min old, so
  // a detected outcome is final, never provisional).
  const outcomeCandidates = {};
  for (const p of gradable) {
    const bars = barsByTicker[p.ticker];
    const evs = (eventsByTicker[p.ticker] || []).slice().sort((a, b) => (a.barT < b.barT ? -1 : 1));
    if (!bars || !bars.length || !evs.length) continue;

    const persisted = mergedDoc.events[p.ticker + '|outcome'] || null;
    if (persisted) {
      outcomeByTicker[p.ticker] = persisted;
      continue;
    }
    const found = detectOutcomeIntraday(
      bars,
      evs[0].barT,
      p.firstTarget != null ? p.firstTarget : null,
      p.invalidationLevel != null ? p.invalidationLevel : null
    );
    if (found) {
      outcomeByTicker[p.ticker] = { ticker: p.ticker, ...found, session: 'regular', feed };
      outcomeCandidates[p.ticker + '|outcome'] = outcomeByTicker[p.ticker];
    }
  }
  if (Object.keys(outcomeCandidates).length && ledgerStatus === 'ok') {
    const { doc, dirty } = mergeLedger(mergedDoc, week, outcomeCandidates);
    mergedDoc = doc;
    if (dirty) {
      try {
        mergedDoc.updatedAt = isoNoMs(new Date());
        await store.setJSON('week-' + week, mergedDoc);
      } catch (_) {
        ledgerStatus = 'write_failed';
      }
    }
  }

  const gradedPicks = picksData.picks.map((p) =>
    gradePickV31(
      p,
      barsByTicker[p.ticker] || null,
      eventsByTicker[p.ticker] || [],
      outcomeByTicker[p.ticker] || null,
      todayET
    )
  );

  // Benchmark: SPY over the OFFICIAL week window only (Monday 09:30 ET
  // open to Friday 16:00 ET close), so archived weeks stop drifting.
  let benchmarkReturn = null;
  const spyBars = spyResult[0].status === 'fulfilled' ? spyResult[0].value : null;
  if (spyBars && spyBars.length) {
    const inWeek = spyBars.filter((b) => b.etDate >= weekMonday && b.etDate <= weekFriday);
    if (inWeek.length) {
      benchmarkReturn = round(((inWeek[inWeek.length - 1].close - inWeek[0].open) / inWeek[0].open) * 100, 2);
    }
  }

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
    dataSource: 'Alpaca historical ' + feed.toUpperCase() + ' 5Min bars, regular session 09:30\u201316:00 ET only',
    dataDelayNote: 'Official trigger verification uses data at least 15 minutes old (Alpaca Basic historical-SIP rule). Live quotes elsewhere on the site may be more current than official status.',
    officialWindow: { open: weekMonday + ' 09:30 ET', close: weekFriday + ' 16:00 ET' },
    dataTimestamp: isoNoMs(new Date()),
    dataEndClamp: endISO,
    ledger: ledgerStatus,
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

  if (audit) {
    responseBody.auditTable = gradedPicks.map((gp) => {
      const src = picksData.picks.find((x) => x.ticker === gp.ticker && x.rank === gp.rank) || {};
      const zones = src.zones || [];
      const evs = gp.triggerEvents || [];
      function zoneRow(idx) {
        const published = zones[idx] ? zones[idx].price : null;
        if (published == null) return null;
        const ev = evs.find((e) => e.zoneIndex === idx) || null;
        return ev
          ? { zone: published, status: 'TRIGGERED', dateET: ev.dateET, timeET: ev.timeET, barLow: ev.barLow, session: ev.session }
          : { zone: published, status: gp.status === 'data_unavailable' ? 'DATA UNAVAILABLE' : 'WAITING' };
      }
      return {
        ticker: gp.ticker,
        entryType: gp.entryType,
        buy1: zoneRow(0),
        buy2: zoneRow(1),
        entryPrice: gp.entryPrice != null ? gp.entryPrice : null,
        invalidation: gp.invalidationLevel,
        target: gp.firstTarget,
        outcome: gp.outcomeDate
          ? { type: gp.status, dateET: gp.outcomeDate, timeET: gp.outcomeTime || null }
          : 'NONE',
        status: gp.status,
      };
    });
  }

  if (dataUnavailable === 0 && !audit) {
    cache.set(week, { expires: Date.now() + CACHE_TTL_MS, data: responseBody });
  }

  return ok({ ...responseBody, cached: false });
};

exports._internal = {
  filterRegularSession,
  computeZoneTouchCandidates,
  computeBreakoutCandidates,
  detectOutcomeIntraday,
  gradePickV31,
  mergeLedger,
  etParts,
  round,
};
