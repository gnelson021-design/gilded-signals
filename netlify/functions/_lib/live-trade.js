// netlify/functions/_lib/live-trade.js
// Shared consolidated-tape price fetcher for Gilded Signals.
//
// WHY THIS EXISTS (2026-07-28 premarket-trigger fix):
// quote.js and scorecard.js were both defaulting to Alpaca's IEX feed
// (process.env.ALPACA_FEED || 'iex'). IEX is a single exchange — it can
// legitimately show zero trades for a symbol for long stretches of
// premarket/after-hours trading that DID happen on other venues (e.g. a
// Robinhood order routed through a wholesaler). When that happened, the
// old code fell back to yesterday's daily-bar close and displayed it as
// if it were the live price, and the scorecard's trigger detection only
// ever looked at Alpaca's *daily* bar low, so a premarket dip into a
// published buy zone could be invisible until, at best, that day's daily
// bar caught up (and even then, only if IEX itself saw the trade).
//
// This module fixes both problems in one place:
//   1. getLiveTrade()          — the single "current price" for display.
//   2. getIntradayLowSeries()  — the full-resolution price history used
//                                  to decide whether a buy zone was
//                                  actually touched.
//
// Provider order (per the standing rule: SIP first, Finnhub fallback,
// IEX last-resort-and-never-authoritative-for-triggers):
//   Live trade:     Alpaca SIP snapshot -> Finnhub /quote -> Alpaca IEX
//                    snapshot (flagged non-authoritative).
//   Intraday series: Alpaca SIP 1-min bars -> Finnhub 1-min candles ->
//                    (caller falls back to its own daily-bar detection
//                    and must flag the result as degraded).
//
// Every resolution is logged (provider, feed, exchange, timestamp,
// price) via console.log so Netlify function logs are auditable per
// pick, per the "log every trigger's data source" requirement.
//
// No external npm packages. Node 18+ global fetch.

'use strict';

const FETCH_TIMEOUT_MS = 10000;
const MAX_BAR_PAGES = 8; // safety valve against runaway pagination

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} for ${url.split('?')[0]}${body ? ' — ' + body.slice(0, 200) : ''}`);
      err.httpStatus = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function alpHeaders(creds) {
  return { 'APCA-API-KEY-ID': creds.alpacaKey, 'APCA-API-SECRET-KEY': creds.alpacaSecret };
}

// ---------------------------------------------------------------------------
// Single latest trade ("what's the current price right now").
// ---------------------------------------------------------------------------
async function getLiveTrade(symbol, creds) {
  // Tier 1: Alpaca SIP snapshot — consolidated tape, authoritative.
  if (creds.alpacaKey && creds.alpacaSecret) {
    try {
      const snap = await getJSON(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=sip`,
        { headers: alpHeaders(creds) }
      );
      const trade = snap && snap.latestTrade;
      if (trade && trade.p != null) {
        console.log(`[live-trade] ${symbol}: SIP $${trade.p} @ ${trade.t} exch=${trade.x || '?'}`);
        return {
          price: trade.p, ts: trade.t, provider: 'alpaca', feed: 'sip',
          exchange: trade.x || null, authoritative: true, snapshot: snap,
        };
      }
    } catch (e) {
      console.log(`[live-trade] ${symbol}: SIP snapshot unavailable (${e.message})`);
    }
  }

  // Tier 2: Finnhub real-time consolidated quote.
  if (creds.finnhubKey) {
    try {
      const q = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${creds.finnhubKey}`);
      if (q && q.c) {
        const ts = q.t ? new Date(q.t * 1000).toISOString() : new Date().toISOString();
        console.log(`[live-trade] ${symbol}: Finnhub $${q.c} @ ${ts}`);
        return {
          price: q.c, ts, provider: 'finnhub', feed: 'consolidated',
          exchange: null, authoritative: true, prevClose: q.pc || null,
        };
      }
    } catch (e) {
      console.log(`[live-trade] ${symbol}: Finnhub quote unavailable (${e.message})`);
    }
  }

  // Tier 3: Alpaca IEX snapshot — last resort. Single exchange; explicitly
  // marked non-authoritative so callers (esp. trigger detection) don't
  // treat it as a confirmed consolidated-tape read.
  if (creds.alpacaKey && creds.alpacaSecret) {
    try {
      const snap = await getJSON(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=iex`,
        { headers: alpHeaders(creds) }
      );
      const trade = snap && snap.latestTrade;
      if (trade && trade.p != null) {
        console.log(`[live-trade] ${symbol}: IEX-only fallback $${trade.p} @ ${trade.t} (not authoritative)`);
        return {
          price: trade.p, ts: trade.t, provider: 'alpaca', feed: 'iex',
          exchange: trade.x || null, authoritative: false, snapshot: snap,
        };
      }
    } catch (e) {
      console.log(`[live-trade] ${symbol}: IEX snapshot unavailable (${e.message})`);
    }
  }

  console.log(`[live-trade] ${symbol}: no live trade available from any provider`);
  return { price: null, ts: null, provider: null, feed: null, authoritative: false };
}

// ---------------------------------------------------------------------------
// Intraday low series for trigger detection — 1-minute bars covering the
// full requested window (e.g. Monday 4:00 AM ET through now).
// ---------------------------------------------------------------------------
async function fetchAlpacaMinuteBars(symbol, startISO, endISO, feed, creds) {
  let bars = [];
  let pageToken = null;
  let page = 0;
  do {
    let url =
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars` +
      `?timeframe=1Min&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}` +
      `&limit=10000&adjustment=split&sort=asc&feed=${feed}`;
    if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
    const data = await getJSON(url, { headers: alpHeaders(creds) });
    const pageBars = Array.isArray(data.bars) ? data.bars : [];
    bars = bars.concat(pageBars);
    pageToken = data.next_page_token || null;
    page++;
  } while (pageToken && page < MAX_BAR_PAGES);

  if (pageToken) {
    console.log(`[intraday] ${symbol}: hit ${MAX_BAR_PAGES}-page safety limit on feed=${feed}; some early-week bars may be missing`);
  }

  return bars.map((b) => ({ t: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}

async function fetchFinnhubMinuteCandles(symbol, startISO, endISO, finnhubKey) {
  const from = Math.floor(new Date(startISO).getTime() / 1000);
  const to = Math.floor(new Date(endISO).getTime() / 1000);
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=1&from=${from}&to=${to}&token=${finnhubKey}`;
  const data = await getJSON(url);
  if (!data || data.s !== 'ok' || !Array.isArray(data.c) || !data.c.length) return [];
  const bars = [];
  for (let i = 0; i < data.c.length; i++) {
    bars.push({
      t: new Date(data.t[i] * 1000).toISOString(),
      open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i],
      volume: Array.isArray(data.v) ? data.v[i] : null,
    });
  }
  return bars;
}

// Returns { bars, provider, feed, authoritative }. bars is [] and
// authoritative is false if no consolidated intraday source was
// reachable — callers MUST treat that as "fall back to daily bars and
// flag the result as degraded," never as "no trigger occurred."
async function getIntradayLowSeries(symbol, startISO, endISO, creds) {
  if (creds.alpacaKey && creds.alpacaSecret) {
    try {
      const bars = await fetchAlpacaMinuteBars(symbol, startISO, endISO, 'sip', creds);
      if (bars.length) {
        console.log(`[intraday] ${symbol}: SIP minute bars (${bars.length}) covering ${startISO} -> ${endISO}`);
        return { bars, provider: 'alpaca', feed: 'sip', authoritative: true };
      }
      console.log(`[intraday] ${symbol}: SIP returned 0 minute bars`);
    } catch (e) {
      console.log(`[intraday] ${symbol}: SIP minute bars failed (${e.message})`);
    }
  }

  if (creds.finnhubKey) {
    try {
      const bars = await fetchFinnhubMinuteCandles(symbol, startISO, endISO, creds.finnhubKey);
      if (bars.length) {
        console.log(`[intraday] ${symbol}: Finnhub 1-min candles (${bars.length}) covering ${startISO} -> ${endISO}`);
        return { bars, provider: 'finnhub', feed: 'consolidated', authoritative: true };
      }
      console.log(`[intraday] ${symbol}: Finnhub candles returned no data`);
    } catch (e) {
      console.log(`[intraday] ${symbol}: Finnhub minute candles failed (${e.message})`);
    }
  }

  console.log(`[intraday] ${symbol}: no authoritative consolidated intraday source — caller must degrade to daily bars`);
  return { bars: [], provider: null, feed: null, authoritative: false };
}

module.exports = { getLiveTrade, getIntradayLowSeries };
