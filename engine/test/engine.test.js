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

test('levels are ordered, rounded, and R:R is consistent', () => {
  const levels = require('../stages/levels');
  const f = { price: 100, atr14: 2, ema20: 98.6, ema50: 95, support10: 97.9, support20: 96, resistance20: 104, high52: 110 };
  const l = levels.compute(f);
  assert.ok(l.zones[0].price < 100 && l.zones[1].price < l.zones[0].price && l.invalidationLevel < l.zones[1].price);
  assert.ok(l.firstTarget > 100 && l.secondTarget > l.firstTarget);
  for (const x of [l.zones[0].price, l.zones[1].price, l.firstTarget, l.invalidationLevel]) assert.strictEqual(Math.round(x / 0.5) * 0.5, x);
  const avg = 0.6 * l.zones[0].price + 0.4 * l.zones[1].price;
  assert.ok(Math.abs(l.riskReward - (l.firstTarget - avg) / (avg - l.invalidationLevel)) < 0.01);
});

test('backtest simulator: no trigger, target, invalidation, same-bar rule', () => {
  const { simulate } = require('../backtest');
  const lv = { zones: [{ price: 98, weight: 0.6 }, { price: 95, weight: 0.4 }], firstTarget: 103, invalidationLevel: 92 };
  const bar = (o, h, l, c) => ({ o, h, l, c });
  assert.strictEqual(simulate(lv, [bar(100, 101, 99, 100), bar(100, 102, 99, 101)]).kind, 'no_trigger');
  const win = simulate(lv, [bar(100, 104, 97.5, 99), bar(99, 103.5, 98.5, 103)]);
  assert.strictEqual(win.kind, 'target'); // target on the entry bar did not count; next bar did
  assert.ok(win.ret > 0);
  const loss = simulate(lv, [bar(100, 100, 97, 97.5), bar(97, 104, 91, 95)]);
  assert.strictEqual(loss.kind, 'invalidated'); // same bar touched both → invalidation wins
  assert.ok(loss.ret < 0);
});

test('entry score applies the earnings discount consistently', () => {
  const scoring = require('../stages/scoring');
  const row = { features: { rsi14: 50, posture: 'bull' } };
  const lv = { zone1DistanceAtr: 1, riskReward: 1.6 };
  assert.strictEqual(scoring.entry(row, lv, false).score - scoring.entry(row, lv, true).score, 10);
});

test('selection never exceeds limits, respects sector cap, never forces picks', () => {
  const { select } = require('../stages/select');
  const mk = (s, conv, sector, lane = 'leader') => ({ symbol: s, industry: sector, lane, conviction: conv, entry: 80, riskClass: 'Moderate', levels: { riskReward: 1.5 }, closes63: null });
  const many = Array.from({ length: 30 }, (_, i) => mk('S' + i, 90 - i, 'Sec' + (i % 4)));
  const r = select(many, 'bull');
  assert.ok(r.picks.filter((p) => p.tier === 1).length <= 5);
  assert.ok(r.picks.filter((p) => p.tier === 2).length <= 10);
  const perSec = {}; r.picks.filter((p) => p.tier === 1).forEach((p) => { perSec[p.industry] = (perSec[p.industry] || 0) + 1; });
  assert.ok(Object.values(perSec).every((n) => n <= 2));
  assert.strictEqual(select([mk('X', 40, 'A'), mk('Y', 50, 'B')], 'bull').picks.length, 0);
  assert.ok(select(many, 'bear').picks.filter((p) => p.tier === 1).length <= 3);
});

test('s3 entry = trigger likelihood: falls with distance; validator checks order and calibration', () => {
  const scoring = require('../stages/scoring');
  const { validateTrigger } = require('../backtest');
  const e = (d) => scoring.entry({ features: {} }, { zone1DistanceAtr: d, riskReward: 1.4 }, false).score;
  assert.ok(e(0.25) > e(0.75) && e(0.75) > e(1.25));
  assert.ok(Math.abs(e(0.25) - 75.2) < 3 && Math.abs(e(1.25) - 45.6) < 3, 'matches s1 backtest trigger rates');
  const mk = (score, trig, n) => Array.from({ length: n }, (_, i) => ({ entryScore: score, kind: i < trig * n ? 'target' : 'no_trigger' }));
  const good = [...mk(40, 0.42, 300), ...mk(60, 0.6, 300), ...mk(80, 0.78, 300)];
  assert.strictEqual(validateTrigger(good, [0, 45, 55, 65, 75, 101]).verdict, 'PASS');
  const bad = [...mk(40, 0.8, 300), ...mk(60, 0.5, 300), ...mk(80, 0.3, 300)];
  assert.strictEqual(validateTrigger(bad, [0, 45, 55, 65, 75, 101]).verdict, 'FAIL');
});

test('narrative gates: verified numbers pass, invented numbers and personal-trade language fail', () => {
  const g = require('../stages/gates');
  const facts = { rsi14: 58.2, invalidation: 164, ret21: -4.3, earningsDate: '2026-12-02', untrustedHeadlines: ['Sales up 99%'] };
  assert.deepStrictEqual(g.unverifiedNumbers('RSI 58.2, down 4.3% on the month, earnings December 2, 2026; invalidation $164.', facts), []);
  assert.deepStrictEqual(g.unverifiedNumbers('Sales grew 99% and margins hit 41.5%.', facts), ['99%', '41.5%']);
  assert.ok(g.narrativeGates('X', 'We bought shares here because the setup looks great for the week ahead.', facts).some((c) => !c.pass));
  assert.ok(g.narrativeGates('X', 'This setup is guaranteed to work and carries little downside for holders.', facts).some((c) => !c.pass));
});

test('brief is READY with clean write-ups and HELD when a number is invented', async () => {
  const { RunLog } = require('../lib/runlog');
  const { research } = require('../stages/research');
  const { narrate } = require('../stages/narrate');
  const gates = require('../stages/gates');
  process.env.ANTHROPIC_API_KEY = 'ANTHROPIC_SHOULD_NOT_LEAK';
  const log = new RunLog('test');
  const { rows, meta } = await liveRun({}, log);
  const res = research(discovery.rank(rows), meta, Date.now());
  assert.ok(res.preview.picks.length > 0);
  const run = async () => {
    const checks = gates.dataGates(res.preview, meta, Date.now());
    checks.push(...await gates.priceCrossCheck(res.preview, require('../providers/finnhub')));
    const n = await narrate(res, meta, log);
    checks.push(...n.checks);
    return { n, failed: checks.filter((c) => !c.pass) };
  };
  delete process.env.MOCK_FABRICATE;
  const clean = await run();
  assert.deepStrictEqual(clean.failed.map((c) => c.name), []);
  const t = res.preview.picks[0].ticker;
  assert.ok(clean.n.brief.picks[t].whyILikeIt && clean.n.brief.lead);
  assert.ok(!JSON.stringify(clean.n.brief).includes('SHOULD_NOT_LEAK'));
  process.env.MOCK_FABRICATE = '1';
  const dirty = await run();
  delete process.env.MOCK_FABRICATE;
  assert.ok(dirty.failed.some((c) => c.name.startsWith('narrative_numbers_verified')), 'invented number caught');
  assert.strictEqual(dirty.n.brief.picks[t].whyILikeIt, null, 'failed write-up is not kept');
  delete process.env.ANTHROPIC_API_KEY;
});

