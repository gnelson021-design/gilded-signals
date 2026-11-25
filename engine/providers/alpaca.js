// engine/providers/alpaca.js
// Alpaca market-data + reference endpoints used by the GS Research Engine.
// Market data only — this module has no order/trading calls and never will.

'use strict';

const { getJSON } = require('../lib/http');

const DATA = 'https://data.alpaca.markets';
const TRADING_BASES = ['https://api.alpaca.markets', 'https://paper-api.alpaca.markets'];

function headers() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error('ALPACA_API_KEY / ALPACA_SECRET_KEY not set');
  return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
}

// Reference endpoints (assets, calendar, option contracts) live on the trading
// host, which differs for live vs paper keys. The first call finds the host
// that accepts these keys (paper keys are refused by the live host with
// 401/403) and every later call in the run goes straight to it, so a paper
// key costs one refused request per run instead of one per call.
// ALPACA_TRADING_BASE, if set, skips the probe entirely.
let resolvedBase = null;
async function trading(path, opts) {
  const bases = process.env.ALPACA_TRADING_BASE ? [process.env.ALPACA_TRADING_BASE] : resolvedBase ? [resolvedBase] : TRADING_BASES;
  let lastErr;
  for (const base of bases) {
    try {
      const res = await getJSON(base + path, { headers: headers(), retries: 1, ...opts });
      if (!process.env.ALPACA_TRADING_BASE) resolvedBase = base;
      return res;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status !== 401 && e.status !== 403) throw e;
    }
  }
  throw lastErr;
}
function _resetTradingBase() { resolvedBase = null; }

async function listAssets(opts) {
  return trading('/v2/assets?status=active&asset_class=us_equity', opts);
}

async function calendar(start, end, opts) {
  return trading(`/v2/calendar?start=${start}&end=${end}`, opts);
}

// Multi-symbol daily bars. Returns { SYM: [{t,o,h,l,c,v,vw,n}, ...asc] }.
async function dailyBars(symbols, { start, end, feed = 'sip', batch = 100, onBatch, fetchImpl } = {}) {
  const out = {};
  for (let i = 0; i < symbols.length; i += batch) {
    const chunk = symbols.slice(i, i + batch);
    let token = null;
    let pages = 0;
    do {
      const qs = new URLSearchParams({
        symbols: chunk.join(','), timeframe: '1Day', start, end,
        limit: '10000', adjustment: 'split', feed, sort: 'asc',
      });
      if (token) qs.set('page_token', token);
      const res = await getJSON(`${DATA}/v2/stocks/bars?${qs}`, { headers: headers(), fetchImpl });
      for (const [sym, bars] of Object.entries(res.bars || {})) {
        (out[sym] = out[sym] || []).push(...bars);
      }
      token = res.next_page_token || null;
      pages++;
    } while (token && pages < 50);
    if (onBatch) onBatch(Math.min(i + batch, symbols.length), symbols.length);
  }
  return out;
}

// All news in a window (newest first), paged. Every article lists the
// tickers it covers in `symbols`, so one sweep covers the whole universe.
async function news({ start, end, maxPages = 400, fetchImpl } = {}) {
  const articles = [];
  let token = null;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ start, end, limit: '50', sort: 'desc', include_content: 'false' });
    if (token) qs.set('page_token', token);
    const res = await getJSON(`${DATA}/v1beta1/news?${qs}`, { headers: headers(), fetchImpl });
    for (const a of res.news || []) {
      articles.push({
        id: a.id,
        headline: a.headline || '',
        summary: (a.summary || '').slice(0, 400),
        source: a.source || null,
        url: a.url || null,
        createdAt: a.created_at || a.updated_at || null,
        symbols: Array.isArray(a.symbols) ? a.symbols : [],
      });
    }
    token = res.next_page_token || null;
    pages++;
  } while (token && pages < maxPages);
  return { articles, pages, truncated: Boolean(token) };
}

async function mostActives({ by = 'volume', top = 100, fetchImpl } = {}) {
  const res = await getJSON(`${DATA}/v1beta1/screener/stocks/most-actives?by=${by}&top=${top}`, { headers: headers(), fetchImpl });
  return { list: res.most_actives || [], lastUpdated: res.last_updated || null };
}

// Option snapshots for one underlying (indicative feed unless configured).
// Returns { CONTRACT_SYMBOL: { dailyBar, prevDailyBar, ... } }.
async function optionSnapshots(underlying, { feed = process.env.GS_OPTIONS_FEED || 'indicative', maxPages = 10, fetchImpl } = {}) {
  const out = {};
  let token = null;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ feed, limit: '1000' });
    if (token) qs.set('page_token', token);
    const res = await getJSON(`${DATA}/v1beta1/options/snapshots/${encodeURIComponent(underlying)}?${qs}`, { headers: headers(), fetchImpl, retries: 1 });
    Object.assign(out, res.snapshots || {});
    token = res.next_page_token || null;
    pages++;
  } while (token && pages < maxPages);
  return out;
}

// Active option contracts (with open interest) expiring on or before expLte.
async function optionContracts(underlying, expLte, { maxPages = 10, fetchImpl } = {}) {
  const out = [];
  let token = null;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ underlying_symbols: underlying, status: 'active', expiration_date_lte: expLte, limit: '10000' });
    if (token) qs.set('page_token', token);
    const res = await trading(`/v2/options/contracts?${qs}`, { fetchImpl });
    out.push(...(res.option_contracts || []));
    token = res.next_page_token || null;
    pages++;
  } while (token && pages < maxPages);
  return out;
}

module.exports = { listAssets, calendar, dailyBars, news, mostActives, optionSnapshots, optionContracts, _resetTradingBase };
