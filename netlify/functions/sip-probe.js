// netlify/functions/sip-probe.js
// Gilded Signals — TEMPORARY DIAGNOSTIC. Safe to delete after use.
//
// Purpose: verify whether this Alpaca account (Basic plan) can query
// HISTORICAL SIP 5-minute bars. Per Alpaca's docs, Basic accounts may
// query SIP historical data when the requested end time is at least
// 15 minutes in the past; real-time SIP requires a paid plan.
//
// This function NEVER returns, logs, or echoes credentials. It reports
// only: whether the env vars exist (true/false), HTTP status codes,
// bar counts, first/last bar OHLC, and Alpaca's own error message text.
//
// Usage: /.netlify/functions/sip-probe   (or /api/sip-probe)

'use strict';

const FETCH_TIMEOUT_MS = 10000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body, null, 2) };
}

function isoNoMs(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function pickBar(b) {
  return b ? { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v } : null;
}

async function probe(name, symbol, startISO, endISO, key, secret) {
  const url =
    'https://data.alpaca.markets/v2/stocks/' + encodeURIComponent(symbol) + '/bars' +
    '?timeframe=5Min&feed=sip&adjustment=split&sort=asc&limit=100' +
    '&start=' + encodeURIComponent(startISO) +
    '&end=' + encodeURIComponent(endISO);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      signal: ctrl.signal,
    });
    const text = await res.text();

    let barsCount = null;
    let firstBar = null;
    let lastBar = null;
    let alpacaMessage = null;

    try {
      const j = JSON.parse(text);
      if (j && Array.isArray(j.bars)) {
        barsCount = j.bars.length;
        firstBar = pickBar(j.bars[0]);
        lastBar = pickBar(j.bars[j.bars.length - 1]);
      }
      if (j && j.message) alpacaMessage = j.message;
    } catch (_) {
      // Non-JSON body (rare) — show a short slice of it. Error bodies
      // from Alpaca never contain credentials.
      alpacaMessage = text.slice(0, 300);
    }

    return {
      test: name,
      symbol,
      requestedWindow: { start: startISO, end: endISO },
      httpStatus: res.status,
      passed: res.ok,
      barsCount,
      firstBar,
      lastBar,
      alpacaMessage,
    };
  } catch (e) {
    return {
      test: name,
      symbol,
      requestedWindow: { start: startISO, end: endISO },
      httpStatus: null,
      passed: false,
      error: String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;

  if (!key || !secret) {
    return ok({
      verdict: 'CREDENTIALS_MISSING',
      credentialsPresent: { ALPACA_API_KEY: !!key, ALPACA_SECRET_KEY: !!secret },
      note: 'Alpaca env vars are not both set for this site. Nothing was queried.',
    });
  }

  // Test 1 + 2: a window that ended days ago — unambiguously allowed
  // for Basic-plan historical SIP if the capability exists at all.
  // Mon 2026-08-10 09:30 ET = 13:30Z, Tue 2026-08-11 16:00 ET = 20:00Z (EDT).
  const oldStart = '2026-08-10T13:30:00Z';
  const oldEnd = '2026-08-11T20:00:00Z';

  // Test 3: the exact pattern the repaired engine will use — a window
  // whose end is clamped to now minus 16 minutes, safely past the
  // Basic-plan 15-minute boundary.
  const now = Date.now();
  const clampEnd = isoNoMs(new Date(now - 16 * 60 * 1000));
  const clampStart = isoNoMs(new Date(now - 90 * 60 * 1000));

  const results = [];
  results.push(await probe('old_window_SPY', 'SPY', oldStart, oldEnd, key, secret));
  results.push(await probe('old_window_thin_name_ALOY', 'ALOY', oldStart, oldEnd, key, secret));
  results.push(await probe('clamped_recent_SPY', 'SPY', clampStart, clampEnd, key, secret));

  const t1 = results[0];
  const t3 = results[2];

  let verdict;
  if (t1.passed && t3.passed) {
    verdict = 'SIP_HISTORICAL_AVAILABLE';
  } else if (!t1.passed && t1.httpStatus === 403) {
    verdict = 'SIP_BLOCKED_BY_SUBSCRIPTION';
  } else {
    verdict = 'INCONCLUSIVE_SEE_DETAILS';
  }

  return ok({
    verdict,
    meaning: {
      SIP_HISTORICAL_AVAILABLE:
        'Basic account can query delayed historical SIP 5Min bars. Proceed with the planned repair — no new provider or paid upgrade needed.',
      SIP_BLOCKED_BY_SUBSCRIPTION:
        'Alpaca rejected historical SIP for this account. Stop; review the alpacaMessage fields before changing anything.',
      INCONCLUSIVE_SEE_DETAILS:
        'Mixed or unexpected results. Review each test below before proceeding.',
    }[verdict],
    credentialsPresent: { ALPACA_API_KEY: true, ALPACA_SECRET_KEY: true },
    probedAt: isoNoMs(new Date(now)),
    note: 'Outside market hours the clamped_recent test may return 0 bars — the HTTP status is the pass signal, not the bar count.',
    results,
  });
};
