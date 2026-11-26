// engine/test/daily.test.js — Daily Top 20 engine, publishing, and the
// retirement of the weekly cycle. Offline: synthetic fixtures + mocked fetch.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./mock');
const http = require('../lib/http'); for (const k of Object.keys(http.HOST_SPACING)) http.HOST_SPACING[k] = 0;
const daily = require('../daily');
const dailyRank = require('../stages/daily-rank');
const options = require('../stages/options');
const cfg = require('../config');
const { RunLog } = require('../lib/runlog');

const ROOT = path.join(__dirname, '..', '..');
const T = (iso) => Date.parse(iso);
const LEAKS = ['TESTKEY_SHOULD_NOT_LEAK', 'TESTSECRET_SHOULD_NOT_LEAK', 'FHTOKEN_SHOULD_NOT_LEAK'];

let BUILT;
async function built() {
  if (!BUILT) { const log = new RunLog('t'); const r = await daily.build({}, log); BUILT = { ...r, log, doc: daily.listDoc(r.meta, r.top) }; }
  return BUILT;
}

test('build: one dated list of up to 20 bullish-momentum stocks, cutoff = previous session', async () => {
  const { doc, meta } = await built();
  const ctx = await daily.tradingContext(Date.now());
  assert.strictEqual(doc.tradingDate, ctx.tradingDate);
  assert.strictEqual(doc.dataCutoff.pricesThroughSession, ctx.cutoff.date, 'prices end at the prior session close — no intraday data');
  assert.ok(doc.entries.length > 0 && doc.entries.length <= 20);
  assert.deepStrictEqual(doc.entries.map((e) => e.rank), doc.entries.map((_, i) => i + 1));
  assert.strictEqual(new Set(doc.entries.map((e) => e.ticker)).size, doc.entries.length);
  for (const e of doc.entries) {
    assert.ok(e.stats.ret5 > 0 && e.stats.rsi14 >= 50, `${e.ticker} meets momentum eligibility`);
    assert.ok(e.drivers.length >= 7 && e.drivers.every((d) => d.text && d.points != null), 'every rank explained');
    assert.ok(e.catalysts.none ? /No verified catalyst/.test(e.catalysts.noneText) : (e.catalysts.confirmed.length + e.catalysts.reported.length) > 0);
    for (const h of e.headlines) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.source, 'headlines are dated and attributed');
  }
  assert.ok(meta.eligibleCount < meta.universeSize, 'eligibility filters the universe');
  const blob = JSON.stringify(BUILT);
  for (const s of LEAKS) assert.ok(!blob.includes(s), 'no credentials in output');
  assert.ok(!/buy zone|buy plan|target price|strong buy|my position|we bought/i.test(JSON.stringify(doc)), 'factual research wording only');
});

test('ranking is reproducible from saved inputs (replay hash)', async () => {
  const { rows, meta, doc } = await built();
  const again = dailyRank.rank(JSON.parse(JSON.stringify(rows)), meta.tradingDate).scored.slice(0, 20).map((x, i) => dailyRank.entry(x, i + 1));
  assert.strictEqual(daily.listHash(daily.listDoc(meta, again)), daily.listHash(doc));
});

test('eligibility excludes stocks without bullish momentum', () => {
  const f = { price: 90, ema20: 95, ema50: 100, ret5: -2, rsi14: 41 };
  assert.ok(dailyRank.eligible(f).length >= 3);
  assert.deepStrictEqual(dailyRank.eligible({ price: 110, ema20: 105, ema50: 100, ret5: 3, rsi14: 62 }), []);
});

test('catalysts: confirmed earnings, dated headline events, cautions, or an explicit none', () => {
  const none = dailyRank.catalysts({ attention: null, earnings: null }, '2026-11-30');
  assert.ok(none.none && /No verified catalyst/.test(none.noneText));
  const c = dailyRank.catalysts({ earnings: { date: '2026-12-02', hour: 'amc' }, attention: { headlines: [
    { headline: 'XYZ upgraded to buy', createdAt: '2026-11-28T14:00:00Z', source: 'benzinga', url: 'https://x', tagsPos: ['upgrade'], tagsNeg: [] },
    { headline: 'XYZ faces SEC probe', createdAt: '2026-11-27T14:00:00Z', source: 'benzinga', url: 'https://y', tagsPos: [], tagsNeg: ['legal'] }] } }, '2026-11-30');
  assert.strictEqual(c.confirmed[0].source, 'Finnhub earnings calendar');
  assert.strictEqual(c.reported[0].date, '2026-11-28');
  assert.strictEqual(c.cautions[0].type, 'legal');
  assert.strictEqual(c.none, false);
  const past = dailyRank.catalysts({ earnings: { date: '2026-11-20' }, attention: null }, '2026-11-30');
  assert.ok(past.none, 'past earnings are not an upcoming catalyst');
});

test('options: verified prior-session volume only; unavailable data drops the component', async () => {
  const c = cfg.options;
  const puts = options.summarize({ 'X261218C00010000': { dailyBar: { t: '2026-11-27T05:00:00Z', v: 500 } }, 'X261218P00010000': { dailyBar: { t: '2026-11-27T05:00:00Z', v: 3000 } } }, [], '2026-11-27', c);
  assert.strictEqual(puts.unusual, 'puts');
  const stale = options.summarize({ 'X261218C00010000': { dailyBar: { t: '2026-11-20T05:00:00Z', v: 9000 } } }, [], '2026-11-27', c);
  assert.strictEqual(stale.available, false, 'bars from another session are never used');
  process.env.MOCK_NO_OPTIONS = '1';
  try {
    const log = new RunLog('t');
    const r = await daily.build({}, log);
    assert.ok(r.top.every((e) => e.options.available === false && e.drivers.every((d) => d.factor !== 'options')));
    assert.ok(r.top.every((e) => e.coveragePct === 95), 'weights re-normalised without options');
    assert.ok(log.doc.warnings.some((w) => /options data unavailable/.test(w.msg)));
  } finally { delete process.env.MOCK_NO_OPTIONS; }
});

function runDir(tradingDate, cutoff) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-daily-run-'));
  const doc = { product: 'x', tradingDate, methodologyVersion: cfg.METHODOLOGY_VERSION, dataCutoff: { pricesThroughSession: cutoff }, freeRanks: [11, 20],
    entries: Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, ticker: 'T' + i, score: 90 - i, drivers: [{ factor: 'priceMomentum', points: 10 }] })) };
  fs.writeFileSync(path.join(d, 'top20.json'), JSON.stringify(doc));
  fs.writeFileSync(path.join(d, 'run-log.json'), JSON.stringify({ status: 'ok' }));
  return d;
}
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gs-daily-root-'));

test('publish: one fixed morning list per trading day, written once', async () => {
  const root = tmpRoot();
  const preOpen = T('2026-11-30T13:00:00Z'); // Mon 08:00 ET
  assert.strictEqual((await daily.gate(preOpen, { root })).run, true);
  const r = await daily.publish(runDir('2026-11-30', '2026-11-27'), preOpen, { root, branch: 'automation/dev' });
  assert.strictEqual(r.published, true);
  assert.deepStrictEqual(r.files, ['data/daily/2026-11-30.json', 'data/daily/index.json']);
  const first = fs.readFileSync(path.join(root, 'data/daily/2026-11-30.json'), 'utf8');
  // No re-ranking later the same day — before or after the open, with or without the recovery flag.
  for (const t of [T('2026-11-30T13:30:00Z'), T('2026-11-30T17:00:00Z')]) {
    const again = await daily.publish(runDir('2026-11-30', '2026-11-27'), t, { root, branch: 'automation/dev', allowLate: true });
    assert.strictEqual(again.published, false);
  }
  assert.strictEqual(fs.readFileSync(path.join(root, 'data/daily/2026-11-30.json'), 'utf8'), first, 'never overwritten');
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'data/daily/index.json')));
  assert.strictEqual(idx.days.length, 1);
});

test('publish refuses: after the open (unless recovery), non-trading days, stale data, wrong day, unapproved production', async () => {
  const root = tmpRoot();
  assert.strictEqual((await daily.gate(T('2026-11-30T15:00:00Z'), { root })).run, false, 'after 09:30 ET');
  assert.strictEqual((await daily.gate(T('2026-11-30T15:00:00Z'), { root, allowLate: true })).run, true, 'recovery publish allowed');
  assert.strictEqual((await daily.gate(T('2026-11-26T13:00:00Z'), { root })).run, false, 'Thanksgiving');
  assert.strictEqual((await daily.gate(T('2026-11-29T13:00:00Z'), { root })).run, false, 'Sunday');
  await assert.rejects(daily.publish(runDir('2026-11-30', '2026-11-25'), T('2026-11-30T13:00:00Z'), { root, branch: 'automation/dev' }), /stale data/);
  await assert.rejects(daily.publish(runDir('2026-12-01', '2026-11-30'), T('2026-11-30T13:00:00Z'), { root, branch: 'automation/dev' }), /different day/);
  delete process.env.GS_PRODUCTION_APPROVED;
  await assert.rejects(daily.publish(runDir('2026-11-30', '2026-11-27'), T('2026-11-30T13:00:00Z'), { root, branch: 'main' }), /GS_PRODUCTION_APPROVED/);
  assert.ok(!fs.existsSync(path.join(root, 'data/daily/2026-11-30.json')), 'nothing written by refused runs');
});

test('schedule: built from 6:45 a.m. CT, released to readers at 7:30 a.m. CT, once per trading day (CST and CDT)', async () => {
  const root = tmpRoot();
  assert.deepStrictEqual([cfg.PUBLISH.timeZone, cfg.PUBLISH.buildTime, cfg.PUBLISH.time], ['America/Chicago', '06:45', '07:30']);
  // Release instant is 7:30 Chicago time in winter and summer.
  assert.strictEqual(daily.releaseUtc('2026-11-30'), '2026-11-30T13:30:00.000Z', 'CST: 7:30 CT = 13:30 UTC');
  assert.strictEqual(daily.releaseUtc('2027-06-14'), '2027-06-14T12:30:00.000Z', 'CDT: 7:30 CT = 12:30 UTC');
  assert.strictEqual(daily.releaseUtc('2027-03-15'), '2027-03-15T12:30:00.000Z', 'first trading day after the March DST change');
  assert.strictEqual(daily.releaseUtc('2026-11-02'), '2026-11-02T13:30:00.000Z', 'first trading day after the November DST change');
  // Winter (CST): 11:45 UTC = 5:45 CT → too early; 12:45 UTC = 6:45 CT → builds; 13:15 = backup.
  const early = await daily.gate(T('2026-11-30T11:45:00Z'), { root, scheduled: true });
  assert.strictEqual(early.run, false); assert.match(early.reason, /before the 06:45 CT build window/);
  assert.strictEqual((await daily.gate(T('2026-11-30T12:45:00Z'), { root, scheduled: true })).run, true);
  assert.strictEqual((await daily.gate(T('2026-11-30T13:15:00Z'), { root, scheduled: true })).run, true, 'backup slot runs only if nothing published yet');
  assert.strictEqual((await daily.gate(T('2026-11-30T14:31:00Z'), { root, scheduled: true })).run, false, 'never after the 8:30 CT open');
  // Summer (CDT): 11:45 UTC = 6:45 CT → builds; 12:45 and 13:15 are before the 8:30 CT open (backups).
  assert.strictEqual((await daily.gate(T('2027-06-14T11:45:00Z'), { root, scheduled: true })).run, true);
  assert.strictEqual((await daily.gate(T('2027-06-14T13:31:00Z'), { root, scheduled: true })).run, false, 'never after the open');
  // Scheduled runs ignore the recovery flag, and skip holidays and weekends.
  assert.strictEqual((await daily.gate(T('2026-11-30T15:00:00Z'), { root, scheduled: true, allowLate: true })).run, false);
  assert.strictEqual((await daily.gate(T('2026-11-26T12:45:00Z'), { root, scheduled: true })).run, false, 'Thanksgiving');
  assert.strictEqual((await daily.gate(T('2026-11-28T12:45:00Z'), { root, scheduled: true })).run, false, 'Saturday');
  // Early-close day (Fri after Thanksgiving, 1 p.m. ET close) still publishes, released 7:30 CT.
  assert.strictEqual((await daily.gate(T('2026-11-27T12:45:00Z'), { root, scheduled: true })).run, true);
  assert.strictEqual(daily.releaseUtc('2026-11-27'), '2026-11-27T13:30:00.000Z');
  // Publish at 6:51 CT: stored with visibleFrom = 7:30 CT; every later slot is a no-op.
  const r = await daily.publish(runDir('2026-11-30', '2026-11-27'), T('2026-11-30T12:51:00Z'), { root, branch: 'automation/dev', scheduled: true });
  assert.strictEqual(r.published, true);
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'data/daily/2026-11-30.json')));
  assert.strictEqual(doc.visibleFrom, '2026-11-30T13:30:00.000Z');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/daily/index.json'))).days[0].visibleFrom, '2026-11-30T13:30:00.000Z');
  for (const t of ['2026-11-30T13:15:00Z', '2026-11-30T14:00:00Z']) {
    const again = await daily.gate(T(t), { root, scheduled: true });
    assert.strictEqual(again.run, false); assert.match(again.reason, /already published/);
  }
});

test('first-run fixes: confirmed buyout excluded and replaced; rumours and acquirers kept; law-firm releases dropped; names cleaned', async () => {
  const { doc, rows, log } = await built();
  const { SYMS } = require('./mock');
  const deals = require('../stages/deals');
  // 1. The build's deal stage flags the fixture's signed-deal target (date-independent).
  const T0 = SYMS[26];
  const target = rows.find((r) => r.symbol === T0);
  assert.ok(target.pendingBuyout && /to acquire/.test(target.pendingBuyout.headline), 'signed deal detected for the target');
  assert.ok(!doc.entries.some((e) => e.ticker === T0), 'buyout target not listed');
  assert.deepStrictEqual(doc.excludedPendingBuyouts.map((x) => x.ticker), dailyRank.eligible(target.features).length ? [] : [T0], 'exclusion disclosed when it would otherwise qualify');
  assert.strictEqual(doc.entries.length, 20);
  assert.strictEqual(new Set(doc.entries.map((e) => e.ticker)).size, 20, '20 unique tickers');
  assert.deepStrictEqual(doc.entries.map((e) => e.rank), Array.from({ length: 20 }, (_, k) => k + 1));
  // 2. Replacement: whatever stock ranks #1 today, a signed deal for it removes it and #21 moves up.
  const clean = rows.map((r) => ({ ...r, pendingBuyout: null }));
  const base = dailyRank.rank(clean, doc.tradingDate).scored;
  const top = base[0].r, next = base[20].r;
  const at = new Date(Date.parse(doc.tradingDate) - 86400000).toISOString();
  const hit = deals.pendingBuyouts([{ headline: `Megacorp to acquire ${top.symbol} for $9 billion in cash`, createdAt: at, symbols: [top.symbol] }], clean);
  assert.ok(hit[top.symbol], 'deal headline confirms the target');
  const withDeal = dailyRank.rank(clean.map((r) => ({ ...r, pendingBuyout: hit[r.symbol] || null })), doc.tradingDate).scored.slice(0, 20).map((x) => x.r.symbol);
  assert.ok(!withDeal.includes(top.symbol), 'former #1 excluded');
  assert.ok(withDeal.includes(next.symbol), 'former #21 fills the open spot');
  assert.strictEqual(new Set(withDeal).size, 20);
  // 3. A rumour about the same stock does not exclude it.
  const rumour = deals.pendingBuyouts([{ headline: `Megacorp in talks to acquire ${top.symbol}, sources say`, createdAt: at, symbols: [top.symbol] }], clean);
  assert.ok(!rumour[top.symbol], 'rumour keeps the stock eligible');
  assert.ok(!rows.find((r) => r.symbol === SYMS[2]).pendingBuyout, 'rumour only — stays eligible');
  assert.ok(!rows.find((r) => r.symbol === SYMS[3]).pendingBuyout, 'acquirer — stays eligible');
  const allHeadlines = rows.flatMap((r) => (r.attention ? r.attention.headlines : []).map((h) => h.headline));
  assert.ok(!allHeadlines.some((h) => /Ademi LLP Investigates/.test(h)), 'law-firm solicitation dropped');
  assert.ok(allHeadlines.some((h) => /SEC charges/.test(h)), 'substantive regulatory news kept');
  const newsStage = log.doc.stages.find((x) => x.name === 'news');
  assert.ok(newsStage.lawFirmSolicitationsDropped >= 1);
  assert.strictEqual(dailyRank.displayName('Insmed Incorporated Common Stock'), 'Insmed Incorporated');
  assert.strictEqual(dailyRank.displayName('Alphabet Inc. Class A Common Stock'), 'Alphabet Inc. Class A', 'share class kept');
  assert.strictEqual(dailyRank.displayName('Berkshire Hathaway Inc. Class B'), 'Berkshire Hathaway Inc. Class B');
  for (const e of doc.entries) assert.ok(!/Common Stock\s*$/.test(e.company || ''), 'no trailing Common Stock');
  assert.strictEqual(doc.methodologyVersion, 'm2-shadow');
});

test('paper-account keys: calendar works on the live host, assets do not — the run switches to paper once and stays', async () => {
  const alpaca = require('../providers/alpaca');
  const httpLib = require('../lib/http');
  process.env.MOCK_PAPER_KEYS = '1';
  alpaca._resetTradingBase();
  const count = (h) => httpLib.stats.byHost[h] || 0;
  const live0 = count('api.alpaca.markets'), paper0 = count('paper-api.alpaca.markets');
  try {
    // Same order as a real build: calendar (trading context) first, then assets, then option contracts.
    await alpaca.calendar('2026-11-30', '2026-11-30');
    const assets = await alpaca.listAssets();
    assert.ok(Array.isArray(assets) && assets.length > 0, 'stock list received from the paper host');
    for (let i = 0; i < 10; i++) await alpaca.optionContracts('TEST', '2027-01-15');
    await alpaca.calendar('2026-12-01', '2026-12-01');
    const live = count('api.alpaca.markets') - live0, paper = count('paper-api.alpaca.markets') - paper0;
    assert.strictEqual(live, 2, 'live host: the calendar call plus exactly one refused request');
    assert.strictEqual(paper, 12, 'everything after the first refusal goes straight to paper');
  } finally { delete process.env.MOCK_PAPER_KEYS; alpaca._resetTradingBase(); }
  // And a full build with paper keys completes (this is what failed in dry run #3).
  process.env.MOCK_PAPER_KEYS = '1';
  try {
    const { RunLog } = require('../lib/runlog');
    const r = await daily.build({}, new RunLog('paper'));
    assert.strictEqual(r.top.length, 20);
  } finally { delete process.env.MOCK_PAPER_KEYS; alpaca._resetTradingBase(); }
});

test('trading context: early close and holidays from the official calendar', async () => {
  const fri = await daily.tradingContext(T('2026-11-27T12:00:00Z'));
  assert.strictEqual(fri.tradingDate, '2026-11-27');
  assert.strictEqual(fri.cutoff.date, '2026-11-25', 'Thanksgiving skipped');
  const sat = await daily.tradingContext(T('2026-11-28T15:00:00Z'));
  assert.strictEqual(sat.tradingDate, '2026-11-30');
  assert.strictEqual(sat.cutoff.date, '2026-11-27');
  assert.strictEqual(sat.cutoff.closeUtc, '2026-11-27T18:00:00.000Z', '1 PM ET early close');
});

test('health flags a missing list after the open', async () => {
  const root = tmpRoot();
  const cwd = process.cwd(); process.chdir(root);
  try {
    const r = await daily.health(T('2026-11-30T16:00:00Z'));
    assert.ok(r.issues.some((i) => /no Daily Top 20 was published for 2026-11-30/.test(i)));
  } finally { process.chdir(cwd); }
});

test('configuration: the retired weekly cycle cannot run; only the daily 7:30 CT schedule exists, behind an off switch', () => {
  const wf = path.join(ROOT, '.github', 'workflows');
  const files = fs.readdirSync(wf);
  assert.ok(!files.includes('gs-schedule.yml'), 'weekly schedule workflow removed');
  for (const f of files) {
    const y = fs.readFileSync(path.join(wf, f), 'utf8');
    assert.ok(!/sunday-publish|sunday-validate|friday-close|saturday|engine\/schedule\.js|engine\/run\.js|backtest/i.test(y), `${f}: no weekly job`);
    const crons = [...y.matchAll(/^\s*-\s*cron\s*:\s*"([^"]+)"/gm)].map((m) => m[1]);
    if (f === 'gs-daily.yml') {
      assert.deepStrictEqual(crons, ['45 11 * * 1-5', '45 12 * * 1-5', '15 13 * * 1-5'], 'only the three weekday slots (6:45 CT build in CDT/CST + backup)');
      assert.match(y, /if: github\.event_name != 'schedule' \|\| vars\.GS_DAILY_SCHEDULE == 'on'/, 'schedule stays off until GS_DAILY_SCHEDULE = on');
      assert.match(y, /github\.event_name == 'schedule' && '--scheduled'/, 'scheduled runs use the 7:30 CT gate');
    } else {
      assert.ok(!/^\s*schedule\s*:/m.test(y) && crons.length === 0, `${f}: no cron schedule`);
    }
  }
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.ok(!/^\s*schedule\s*=/m.test(toml), 'no scheduled Netlify function (weekly trigger capture retired)');
  for (const gone of ['engine/schedule.js', 'engine/run.js', 'engine/backtest.js', 'netlify/functions/auto-week.js', 'assets/js/gs-auto-pages.js']) {
    assert.ok(!fs.existsSync(path.join(ROOT, gone)), `${gone} removed`);
  }
  const checklist = fs.readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');
  assert.ok(!/git checkout automation\/dev -- \.github\/workflows\/gs-schedule\.yml/.test(checklist), 'checklist cannot re-activate the weekly workflow');
  assert.match(checklist, /GS_DAILY_SCHEDULE/, 'checklist explains the daily off switch');
});
