// engine/test/engine.test.js — offline end-to-end test of the discovery run.
// Uses a mocked fetch with SYNTHETIC test fixtures (never written anywhere
// public). Verifies: no hand-supplied tickers needed, filters work, ranking
// is deterministic and replayable, secrets never appear in output.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SYMS } = require('./mock');
const http = require('../lib/http');
const { liveRun, rankingHash } = require('../run');
const discovery = require('../stages/discovery');
const { RunLog } = require('../lib/runlog');

test('discovery runs end-to-end with zero hand-supplied tickers', async () => {
  const log = new RunLog('test');
  const { rows, meta } = await liveRun({}, log);
  const syms = rows.map((r) => r.symbol);
  assert.ok(rows.length >= 300, 'universe built automatically');
  for (const bad of ['SPY', 'QQQX', 'WARNT', 'PENY']) assert.ok(!syms.includes(bad), `${bad} excluded`);
  const ranked = discovery.rank(rows);
  assert.strictEqual(ranked[0].discoveryRank, 1);
  for (const r of ranked) {
    if (r.discoveryScore != null) assert.ok(r.discoveryScore >= 0 && r.discoveryScore <= 100);
  }
  // News-heavy names should surface: most of the top 20 have recent news.
  const withNews = ranked.slice(0, 20).filter((r) => r.attention && r.attention.news7 > 0).length;
  assert.ok(withNews >= 10, `news drives the board (${withNews}/20)`);
  // Deterministic + replayable from saved inputs.
  const roundTrip = JSON.parse(JSON.stringify(rows));
  assert.strictEqual(rankingHash(discovery.rank(roundTrip)), rankingHash(ranked));
  // No secret in any output.
  const blob = JSON.stringify({ rows, meta, log: log.doc, http: http.stats });
  for (const s of ['TESTKEY_SHOULD_NOT_LEAK', 'TESTSECRET_SHOULD_NOT_LEAK', 'FHTOKEN_SHOULD_NOT_LEAK']) assert.ok(!blob.includes(s));
  assert.ok(rows.find((r) => r.symbol === SYMS[1]).earnings, 'earnings attached');
});

test('analyst score ignores thin coverage and rewards upward drift', () => {
  assert.strictEqual(discovery.analystScore([{ strongBuy: 1, buy: 1, hold: 0, sell: 0, strongSell: 0 }]), null);
  const up = discovery.analystScore([{ strongBuy: 5, buy: 10, hold: 3, sell: 0, strongSell: 0 }, {}, {}, { strongBuy: 1, buy: 5, hold: 10, sell: 2, strongSell: 0 }]);
  const flat = discovery.analystScore([{ strongBuy: 5, buy: 10, hold: 3, sell: 0, strongSell: 0 }]);
  assert.ok(up.score > flat.score);
});

test('RSI regime: extended and broken names score below healthy momentum', () => {
  const m = (rsi14) => discovery.momentumScore({ rsi14, macdHist: null });
  assert.ok(m(60) > m(80));
  assert.ok(m(60) > m(25));
});

test('retry then give up on persistent 429 without leaking the token', async () => {
  let calls = 0;
  const f = async () => { calls++; return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({}) }; };
  await assert.rejects(http.getJSON('https://finnhub.io/api/v1/x?token=SECRET123', { fetchImpl: f, retries: 2, backoffMs: 1 }), (e) => !String(e.message + e.url).includes('SECRET123'));
  assert.strictEqual(calls, 3);
});

test('board has a Leader lane and an In Focus lane with no duplicates', async () => {
  const { RunLog } = require('../lib/runlog');
  const { rows } = await liveRun({}, new RunLog('test'));
  const b = discovery.board(discovery.rank(rows));
  const cfg = require('../config');
  assert.strictEqual(b.filter((r) => r.lane === 'leader').length, cfg.board.leaders);
  assert.ok(b.filter((r) => r.lane === 'in_focus').length > 0);
  assert.strictEqual(new Set(b.map((r) => r.symbol)).size, b.length);
});

