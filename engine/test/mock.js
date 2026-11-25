// engine/test/mock.js — SYNTHETIC fixtures + mocked fetch for offline tests.
// Never written anywhere public. Preload with `node -r ./engine/test/mock.js`.
'use strict';
const assert = require('node:assert');

process.env.ALPACA_API_KEY = 'TESTKEY_SHOULD_NOT_LEAK';
process.env.ALPACA_SECRET_KEY = 'TESTSECRET_SHOULD_NOT_LEAK';
process.env.FINNHUB_API_KEY = 'FHTOKEN_SHOULD_NOT_LEAK';

const DAY = 86400000;
const NOW = Date.now();
const HOLIDAYS = new Set(['2026-11-26', '2026-12-25', '2027-01-01']);

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
function symName(i) { let s = ''; i += 26; while (i > 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); } return s.slice(-4); }

const SYMS = Array.from({ length: 360 }, (_, i) => symName(i * 7 + 3));
const ASSETS = [
  ...SYMS.map((s) => ({ symbol: s, name: `${s} Corp`, exchange: 'NASDAQ', status: 'active', tradable: true })),
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'ARCA', status: 'active', tradable: true },
  { symbol: 'QQQX', name: 'Some Leveraged ETF', exchange: 'NASDAQ', status: 'active', tradable: true },
  { symbol: 'WARNT', name: 'Blank Check Warrants', exchange: 'NYSE', status: 'active', tradable: true },
  { symbol: 'PENY', name: 'Penny Co', exchange: 'NYSE', status: 'active', tradable: true },
];

// Daily bars stamped like Alpaca (00:00 ET = 05:00Z), weekdays except holidays,
// through today's date. The random walk drifts up for the first 60 symbols so
// a realistic share of the universe shows bullish momentum.
function barsFor(sym, startMs) {
  const r = rng([...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const up = SYMS.indexOf(sym) >= 0 && SYMS.indexOf(sym) < 60;
  let p = sym === 'PENY' ? 3 : 20 + r() * 200;
  const out = [];
  const today = new Date(NOW).toISOString().slice(0, 10);
  for (let t = Date.parse(today + 'T05:00:00Z') - 900 * DAY; t <= Date.parse(today + 'T05:00:00Z'); t += DAY) {
    const d = new Date(t); const ymd = d.toISOString().slice(0, 10); const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || HOLIDAYS.has(ymd)) continue;
    p *= 1 + (r() - (up ? 0.44 : 0.49)) * 0.04;
    const v = Math.round(5e5 + r() * 4e6);
    if (t < startMs - DAY) continue;
    out.push({ t: d.toISOString().replace('.000', ''), o: p * 0.995, h: p * 1.01, l: p * 0.99, c: p, v });
  }
  return out;
}

const NEWS = Array.from({ length: 140 }, (_, i) => {
  const s = SYMS[i % 30];
  const h = i % 7 === 0 ? `${s} upgraded to buy at Example Securities` : i % 11 === 0 ? `${s} shares fall after analyst downgrade` : `${s} shares active in sector trading`;
  return { id: i, headline: h, created_at: new Date(NOW - (i % 20) * DAY / 2).toISOString(), symbols: [s], source: 'benzinga', url: `https://example.com/${i}` };
});

function respond(obj) { return { ok: true, status: 200, headers: { get: () => null }, json: async () => obj }; }
function sessionsBetween(start, end) {
  const out = [];
  for (let t = Date.parse(start + 'T12:00:00Z'); t <= Date.parse(end + 'T12:00:00Z'); t += DAY) {
    const d = new Date(t); const ymd = d.toISOString().slice(0, 10); const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || HOLIDAYS.has(ymd)) continue;
    out.push({ date: ymd, open: '09:30', close: ymd === '2026-11-27' ? '13:00' : '16:00' });
  }
  return out;
}

global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.host.endsWith('alpaca.markets')) assert.strictEqual(opts.headers['APCA-API-KEY-ID'], process.env.ALPACA_API_KEY);
  if (u.pathname === '/v2/assets') return respond(ASSETS);
  if (u.pathname === '/v2/calendar') return respond(sessionsBetween(u.searchParams.get('start'), u.searchParams.get('end')));
  if (u.pathname === '/v2/stocks/bars') {
    const start = Date.parse(u.searchParams.get('start'));
    const bars = {};
    for (const s of u.searchParams.get('symbols').split(',')) bars[s] = barsFor(s, start);
    return respond({ bars, next_page_token: null });
  }
  if (u.pathname === '/v1beta1/news') {
    const page = Number(u.searchParams.get('page_token') || 0);
    return respond({ news: NEWS.slice(page * 50, page * 50 + 50), next_page_token: page < 2 ? String(page + 1) : null });
  }
  if (u.pathname.includes('most-actives')) return respond({ most_actives: SYMS.slice(0, 10).map((symbol) => ({ symbol })) });
  if (u.pathname.startsWith('/v1beta1/options/snapshots/')) {
    if (process.env.MOCK_NO_OPTIONS === '1') return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) };
    const sym = decodeURIComponent(u.pathname.split('/').pop());
    const { tradingContext } = require('../daily');
    const ctx = await tradingContext(NOW);
    const i = SYMS.indexOf(sym);
    const callV = i % 3 === 0 ? 9000 : 2500, putV = i % 3 === 0 ? 2000 : 2600;
    const bar = (v) => ({ dailyBar: { t: ctx.cutoff.date + 'T05:00:00Z', v } });
    return respond({ snapshots: { [`${sym}261218C00100000`]: bar(callV), [`${sym}261218P00090000`]: bar(putV) }, next_page_token: null });
  }
  if (u.pathname === '/v2/options/contracts') return respond({ option_contracts: [{ type: 'call', open_interest: '40000' }, { type: 'put', open_interest: '30000' }] });
  if (u.pathname === '/api/v1/calendar/earnings') return respond({ earningsCalendar: [{ symbol: SYMS[1], date: new Date(NOW + 4 * DAY).toISOString().slice(0, 10), hour: 'amc' }] });
  if (u.pathname === '/api/v1/stock/profile2') return respond({ finnhubIndustry: SYMS.indexOf(u.searchParams.get('symbol')) % 2 ? 'Semiconductors' : 'Banking' });
  if (u.pathname === '/api/v1/quote') { const b = barsFor(u.searchParams.get('symbol'), NOW - 10 * DAY); return respond({ c: b[b.length - 1].c, pc: b[b.length - 2].c, t: 0 }); }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
};

module.exports = { SYMS, barsFor, sessionsBetween };
