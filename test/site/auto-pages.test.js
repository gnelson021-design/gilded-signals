// test/site/auto-pages.test.js — offline tests for Build 3 (automated pages).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../../assets/js/gs-auto-pages.js');
const auto = require('../../netlify/functions/auto-week.js')._test;

const balanced = (h) => (h.match(/<div\b/g) || []).length === (h.match(/<\/div>/g) || []).length;
const FIRST_PERSON = /\bI[’']m\b|\bI&rsquo;m\b|My Buy Plan|Why I like it|\bmy own\b|\bI am\b|where I&rsquo;m|My Targets/i;

function picksDoc() {
  const mk = (rank, ticker, tier) => ({
    rank, ticker, company: ticker + ' Inc', tier, tierName: tier === 1 ? 'Primary Picks' : 'Secondary Watchlist',
    priceAtPublish: 100, zones: [{ price: 98, weight: 0.6 }, { price: 95, weight: 0.4 }], firstTarget: 103, secondTarget: 106,
    invalidationLevel: 92, convictionScore: 86.2, entryScore: 61.3, riskReward: 1.4, eventGated: false, earningsDate: null,
  });
  return { weekOf: '2026-11-30', scoringVersion: 's3-shadow', methodologyVersion: 'v3-target-invalidation',
    picks: [mk(1, 'AAA', 1), mk(2, 'BBB', 1), mk(3, 'CCC', 1), mk(4, 'DDD', 1), mk(5, 'EEE', 1), mk(6, 'SECRT', 2), mk(7, 'HIDDN', 2)] };
}
function briefDoc() {
  const e = (t) => ({ convictionLabel: 'Strong Buy', convictionClass: 'strong', riskLabel: 'Medium Risk', riskClass: 'medium',
    whyILikeIt: `${t} ranks on a bull structure.`, biggestRisk: 'A close below 92 ends the setup.', catalystHtml: 'No scheduled earnings this week.', chart: { asOfDate: '11/27' } });
  const picks = {}; for (const t of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'SECRT', 'HIDDN']) picks[t] = e(t);
  picks.AAA.whyILikeIt = 'Solid <script>alert(1)</script> setup.';
  return { dateline: 'x', lead: 'This week’s list holds 5 primary names.', weekAtGlance: { marketCatalyst: 'No scheduled earnings fall inside the week.' }, disclosure: 'Automated model research.', picks };
}

test('briefing panel: balanced markup, neutral wording, escaped text', () => {
  const html = R.renderBriefPanel(auto.shapeBrief(picksDoc(), briefDoc(), true));
  assert.ok(balanced(html), 'div balance');
  assert.ok(!FIRST_PERSON.test(html), 'no first-person / personal-trade wording');
  assert.ok(!html.includes('<script>'), 'script tag escaped');
  assert.ok(html.includes('data-live="true"') && html.includes('id="gb-week-2026-11-30"'));
  assert.ok(html.includes('Model Buy Plan') && html.includes('Why it qualifies'));
  assert.ok(html.includes('November 30&ndash;December 4, 2026'));
});

test('premium ranks 6–15 never reach a locked reader', () => {
  const shaped = auto.shapeBrief(picksDoc(), briefDoc(), false);
  const json = JSON.stringify(shaped);
  assert.ok(!json.includes('SECRT') && !json.includes('HIDDN'), 'premium tickers withheld server-side');
  assert.ok(shaped.picks.filter((p) => p.locked).length === 2);
  const html = R.renderBriefPanel(shaped);
  assert.ok(balanced(html) && html.includes('gb-lock-overlay') && !html.includes('SECRT'));
  const open = R.renderBriefPanel(auto.shapeBrief(picksDoc(), briefDoc(), true));
  assert.ok(open.includes('SECRT') && !open.includes('gb-lock-overlay'));
});

test('results panel: balanced, every pick listed including losers, labels the home card reads', () => {
  const sc = { methodologyVersion: 'v3-target-invalidation', dataSource: 'Alpaca SIP', benchmark: { returnPct: 0.47 },
    summary: { totalPublished: 3, tradesEntered: 2, targetsReached: 1, stoppedOut: 1, stillActive: 0, neverTriggered: 1 },
    picks: [
      { rank: 1, ticker: 'WIN', status: 'target_reached', returnPct: 3.1, entryPrice: 98, entryDate: '2026-12-01', outcomePrice: 103, outcomeDate: '2026-12-02' },
      { rank: 2, ticker: 'LOSS', status: 'stopped_out', returnPct: -5.2, entryPrice: 98, entryDate: '2026-12-01', outcomePrice: 92, outcomeDate: '2026-12-03' },
      { rank: 3, ticker: 'WAIT', status: 'watching_no_trade', returnPct: null }] };
  const html = R.renderResultsPanel({ weekOf: '2026-11-30', scorecard: sc });
  assert.ok(balanced(html));
  for (const t of ['WIN', 'LOSS', 'WAIT', 'Invalidation Hit', '&minus;5.20%']) assert.ok(html.includes(t), t);
  for (const lbl of ['Average Return', 'S&amp;P 500', 'Winners', 'Losers']) assert.ok(html.includes(lbl), lbl);
  assert.ok(html.includes('id="gr-week-2026-12-04"') && html.includes('data-week="2026-12-04"'));
  assert.ok(!FIRST_PERSON.test(html));
});

test('auto-week endpoint is dormant until the publish job writes data/weeks.json', async () => {
  const none = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.deepStrictEqual(await auto.handle({ queryStringParameters: { kind: 'brief' } }, none), { available: false, kind: 'brief' });
  assert.deepStrictEqual(await auto.handle({ queryStringParameters: { kind: 'results' } }, none), { available: false, kind: 'results' });
  const files = { 'weeks.json': { weeks: [{ weekOf: '2026-11-23', briefPublishedAt: 'x' }, { weekOf: '2026-11-30', briefPublishedAt: 'y' }] }, 'picks-2026-11-30.json': picksDoc(), 'brief-2026-11-30.json': briefDoc() };
  const fake = async (url, init) => {
    assert.ok(init.headers['x-gs-internal'] !== undefined, 'internal header sent');
    const f = url.split('/data/')[1];
    return files[f] ? { ok: true, json: async () => files[f] } : { ok: false, json: async () => ({}) };
  };
  const out = await auto.handle({ queryStringParameters: { kind: 'brief' }, headers: {} }, fake);
  assert.strictEqual(out.available, true);
  assert.strictEqual(out.weekOf, '2026-11-30', 'newest published week chosen');
  assert.strictEqual(out.unlocked, false);
  const res = await auto.handle({ queryStringParameters: { kind: 'results' } }, fake);
  assert.strictEqual(res.available, false, 'no frozen results yet');
});

test('index.html: exactly two additions, no layout change', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  assert.strictEqual((html.match(/<script src="\/assets\/js\/gs-auto-pages\.js"><\/script>/g) || []).length, 1);
  assert.strictEqual((html.match(/window\.gsSyncHomeCards=init;/g) || []).length, 1);
  assert.ok(html.indexOf('<script src="/assets/js/gs-auto-pages.js">') > html.indexOf('window.gsSyncHomeCards=init;'), 'loads after the home-card sync is defined');
});

test('end-to-end: engine preview → endpoint shape → rendered panel', async () => {
  require('../../engine/test/mock.js');
  process.env.ANTHROPIC_API_KEY = 'x';
  const http = require('../../engine/lib/http'); for (const k of Object.keys(http.HOST_SPACING)) http.HOST_SPACING[k] = 0;
  const { liveRun } = require('../../engine/run');
  const { RunLog } = require('../../engine/lib/runlog');
  const discovery = require('../../engine/stages/discovery');
  const { research } = require('../../engine/stages/research');
  const { narrate } = require('../../engine/stages/narrate');
  const log = new RunLog('t');
  const { rows, meta } = await liveRun({}, log);
  const res = research(discovery.rank(rows), meta, Date.now());
  const nar = await narrate(res, meta, log);
  const shaped = auto.shapeBrief(res.preview, nar.brief, false);
  const html = R.renderBriefPanel(shaped);
  assert.ok(balanced(html));
  assert.ok(html.includes(res.preview.picks[0].ticker));
  for (const p of res.preview.picks.filter((x) => x.rank > 5)) assert.ok(!html.includes(`>${p.ticker}<`), `premium ${p.ticker} hidden`);
  delete process.env.ANTHROPIC_API_KEY;
});
