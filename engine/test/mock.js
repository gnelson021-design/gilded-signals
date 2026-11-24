// engine/test/mock.js — SYNTHETIC fixtures + mocked fetch for offline tests.
// Preload with `node -r ./engine/test/mock.js engine/run.js` for a CLI smoke test.
'use strict';
const assert = require('node:assert');
process.env.ALPACA_API_KEY = 'TESTKEY_SHOULD_NOT_LEAK';
process.env.ALPACA_SECRET_KEY = 'TESTSECRET_SHOULD_NOT_LEAK';
process.env.FINNHUB_API_KEY = 'FHTOKEN_SHOULD_NOT_LEAK';

const http = require('../lib/http');
for (const k of Object.keys(http.HOST_SPACING)) http.HOST_SPACING[k] = 0;

const DAY = 86400000;
const NOW = Date.now();

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

function barsFor(sym, startMs) {
  const r = rng([...sym].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  let p = sym === 'PENY' ? 3 : 20 + r() * 200;
  const out = [];
  for (let t = NOW - 900 * DAY; t < NOW - DAY / 2; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    p *= 1 + (r() - 0.48) * 0.04;
    const v = Math.round(5e5 + r() * 4e6); // draw before the start filter so every window sees the same series
    if (t < startMs) continue;
    out.push({ t: new Date(t).toISOString(), o: p, h: p * 1.01, l: p * 0.99, c: p, v });
  }
  return out;
}

const NEWS = Array.from({ length: 120 }, (_, i) => ({
  id: i, headline: i % 5 === 0 ? `${SYMS[i % 30]} upgraded to buy, analyst raises price target` : `${SYMS[i % 30]} shares move on sector news`,
  created_at: new Date(NOW - (i % 20) * DAY).toISOString(), symbols: [SYMS[i % 30]], source: 'test',
}));

function respond(obj) { return { ok: true, status: 200, headers: { get: () => null }, json: async () => obj }; }

global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.host.endsWith('alpaca.markets')) {
    assert.strictEqual(opts.headers['APCA-API-KEY-ID'], process.env.ALPACA_API_KEY);
  }
  if (u.pathname === '/v2/assets') return respond(ASSETS);
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
  if (u.pathname === '/api/v1/calendar/earnings') return respond({ earningsCalendar: [{ symbol: SYMS[1], date: '2026-12-02', hour: 'amc' }] });
  if (u.pathname === '/api/v1/stock/recommendation') return respond([{ period: '2026-11-01', strongBuy: 5, buy: 10, hold: 4, sell: 1, strongSell: 0 }, {}, {}, { period: '2026-08-01', strongBuy: 3, buy: 8, hold: 7, sell: 2, strongSell: 0 }]);
  if (u.pathname === '/api/v1/stock/profile2') return respond({ finnhubIndustry: SYMS.indexOf(u.searchParams.get('symbol')) % 2 ? 'Semiconductors' : 'Banking' });
  if (u.pathname === '/api/v1/quote') {
    const b = barsFor(u.searchParams.get('symbol'), NOW - 10 * DAY);
    return respond({ c: b[b.length - 1].c, pc: b[b.length - 2].c, t: 0 });
  }
  if (u.host === 'api.anthropic.com') {
    const body = JSON.parse(opts.body);
    const user = body.messages[0].content;
    const facts = JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}', user.indexOf('Write JSON')) + 1));
    const fab = process.env.MOCK_FABRICATE === '1' ? ' Revenue grew 37.3% last quarter.' : '';
    const text = user.includes('whyItQualifies')
      ? JSON.stringify({
        whyItQualifies: `${facts.company} ranks on a ${facts.trendStructure} trend structure with RSI at ${facts.rsi14} and a conviction score of ${facts.convictionScore}.${fab}`,
        biggestRisk: `A close below the ${facts.invalidation} invalidation level would end the setup; buy zone 1 sits at ${facts.buyZone1}.`,
        catalysts: facts.earningsInsidePublishWeek ? `Earnings on ${facts.earningsDate} fall inside the week.` : 'No scheduled earnings this week; news flow is the main driver.',
      })
      : JSON.stringify({ lead: `This week's list holds ${facts.primaryPicks.length} primary names with SPY in a ${facts.spyTrendStructure} structure, and news flow concentrated in the most-covered names.${fab}`, marketCatalyst: facts.earningsInsideWeek.length ? 'Scheduled earnings inside the week are flagged on each affected name.' : 'No scheduled earnings fall inside the week among the picks.' });
    return respond({ model: body.model, content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
};

module.exports = { SYMS };
