// test/site/daily-page.test.js — Daily Top 20 access rules, page rendering,
// and the site changes that retire the weekly product.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const R = require('../../assets/js/gs-daily.js');
const fn = require('../../netlify/functions/daily-top20.js')._test;
const ROOT = path.join(__dirname, '..', '..');
const balanced = (h) => (h.match(/<div\b/g) || []).length === (h.match(/<\/div>/g) || []).length;
const PICK_LANGUAGE = /buy zone|buy plan|strong buy|price target|my screen|my position|currently buying|we bought|I bought|\bpicks?\b|entry zone/i;

function entry(rank, extra = {}) {
  return {
    rank, ticker: 'TK' + rank, company: `Company ${rank}`, sector: 'Semiconductors', score: 80 - rank, coveragePct: 100, lastClose: 100 + rank,
    stats: { ret1: 1.2, ret5: 4.5, ret21: 12.1, rsi14: 63.2, rvol: 1.8, atrPct: 2.4, relStrength63: 9.3, pctFromHigh52: -2, trend: 'bull' },
    drivers: [{ factor: 'priceMomentum', points: 20.1, text: 'Up +4.5% over 5 sessions and +12.1% over 21 sessions' }, { factor: 'relVolume', points: 12, text: 'Last session volume 1.8× its 20-day average' }],
    topDrivers: ['Up +4.5% over 5 sessions and +12.1% over 21 sessions'],
    catalysts: rank % 2 ? { confirmed: [], reported: [], cautions: [], none: true, noneText: 'No verified catalyst: no earnings date in the next 14 days and no catalyst-type headline in the last 3 days.' }
      : { confirmed: [{ type: 'earnings', date: '2026-12-02', timing: 'amc', source: 'Finnhub earnings calendar' }], reported: [{ type: 'upgrade', label: 'analyst upgrade / price-target raise', date: '2026-11-27', source: 'benzinga', headline: 'TK upgraded <script>x</script>', url: 'javascript:alert(1)' }], cautions: [], none: false, noneText: null },
    headlines: [{ date: '2026-11-27', source: 'benzinga', headline: `TK${rank} shares rise on volume`, url: 'https://example.com/a' }],
    news: { recentCount: 4, surge: 2.1, windowDays: 3 },
    options: rank === 12 ? { available: true, sessionDate: '2026-11-27', callVolume: 9000, putVolume: 2000, callPutRatio: 4.5, callVolToOI: 0.3, unusual: 'calls' } : { available: false, reason: 'options data not available from the current data plan or provider' },
    ...extra,
  };
}
function doc() {
  return { product: 'Gilded Signals Daily Top 20', tradingDate: '2026-11-30', methodologyVersion: 'm1-shadow', freeRanks: [11, 20],
    dataCutoff: { pricesThroughSession: '2026-11-27', pricesThroughCloseEt: '13:00', pricesThroughCloseUtc: '2026-11-27T18:00:00.000Z', newsThrough: '2026-11-30T13:05:00.000Z' },
    publishedAt: '2026-11-30T13:06:00.000Z', universeSize: 1478, eligibleCount: 212, sources: ['Alpaca SIP daily bars'], disclosure: 'Factual momentum research.',
    entries: Array.from({ length: 20 }, (_, i) => entry(i + 1)) };
}

test('free readers: ranks #11–20 in full, #1–10 withheld server-side', () => {
  const s = fn.shape(doc(), false);
  const free = s.entries.filter((e) => e.rank >= 11);
  const paid = s.entries.filter((e) => e.rank <= 10);
  assert.strictEqual(free.length, 10);
  assert.ok(free.every((e) => !e.locked && e.ticker && e.drivers.length && e.headlines.length), 'free ranks include data and explanations');
  assert.strictEqual(paid.length, 10);
  assert.ok(paid.every((e) => e.locked && Object.keys(e).sort().join() === 'locked,rank'), 'locked ranks carry nothing but the rank');
  const json = JSON.stringify(s);
  for (let r = 1; r <= 10; r++) assert.ok(!json.includes(`"TK${r}"`) && !json.includes(`Company ${r}"`), `rank ${r} data absent`);
});

test('subscribers: the full Top 20', () => {
  const s = fn.shape(doc(), true);
  assert.ok(s.unlocked && s.entries.length === 20 && s.entries.every((e) => !e.locked && e.ticker));
});

test('endpoint: no list yet, latest day, archive day, invalid date', async () => {
  const files = { 'index.json': { days: [{ tradingDate: '2026-11-27' }, { tradingDate: '2026-11-30' }] }, '2026-11-30.json': doc(), '2026-11-27.json': { ...doc(), tradingDate: '2026-11-27' } };
  const fake = async (url) => { const f = url.split('/data/daily/')[1]; return files[f] ? { ok: true, json: async () => files[f] } : { ok: false, json: async () => ({}) }; };
  const none = async () => ({ ok: false, json: async () => ({}) });
  assert.strictEqual((await fn.handle({ queryStringParameters: {} }, none)).available, false);
  const latest = await fn.handle({ queryStringParameters: {}, headers: {} }, fake);
  assert.strictEqual(latest.tradingDate, '2026-11-30');
  assert.deepStrictEqual(latest.days, ['2026-11-27', '2026-11-30']);
  assert.ok(latest.entries.slice(0, 10).every((e) => e.locked), 'no cookie → locked');
  assert.strictEqual((await fn.handle({ queryStringParameters: { date: '2026-11-27' }, headers: {} }, fake)).tradingDate, '2026-11-27');
  assert.strictEqual((await fn.handle({ queryStringParameters: { date: '../../x' } }, fake)).error, 'invalid date');
  const forged = await fn.handle({ queryStringParameters: {}, headers: { cookie: 'gs_access=forged.token' } }, fake);
  assert.ok(forged.entries.slice(0, 10).every((e) => e.locked), 'forged cookie stays locked');
});

test('release: a published list stays hidden from everyone until 7:30 a.m. CT, then the previous day is replaced', async () => {
  const v30 = '2026-11-30T13:30:00.000Z'; // 7:30 a.m. CST
  const files = { 'index.json': { days: [{ tradingDate: '2026-11-27', visibleFrom: '2026-11-27T13:30:00.000Z' }, { tradingDate: '2026-11-30', visibleFrom: v30 }] },
    '2026-11-30.json': { ...doc(), visibleFrom: v30 }, '2026-11-27.json': { ...doc(), tradingDate: '2026-11-27', visibleFrom: '2026-11-27T13:30:00.000Z' } };
  const fake = async (url) => { const f = url.split('/data/daily/')[1]; return files[f] ? { ok: true, json: async () => files[f] } : { ok: false, json: async () => ({}) }; };
  const at = (iso, q = {}) => fn.handle({ queryStringParameters: q, headers: {} }, fake, Date.parse(iso));
  const before = await at('2026-11-30T13:29:00Z');
  assert.strictEqual(before.tradingDate, '2026-11-27', '7:29 CT: still the previous trading day');
  assert.deepStrictEqual(before.days, ['2026-11-27'], 'not even listed in the archive yet');
  assert.strictEqual((await at('2026-11-30T13:29:00Z', { date: '2026-11-30' })).available, false, 'direct date request refused before release');
  const after = await at('2026-11-30T13:30:00Z');
  assert.strictEqual(after.tradingDate, '2026-11-30', '7:30 CT: today\'s list');
  assert.strictEqual(after.visibleFrom, v30);
  assert.ok(after.entries.slice(10).every((e) => !e.locked && e.ticker) && after.entries.slice(0, 10).every((e) => e.locked && !e.ticker), 'free: #11–20 open, #1–10 withheld');
  // Summer: 7:30 CDT = 12:30 UTC.
  const sFiles = { 'index.json': { days: [{ tradingDate: '2027-06-14', visibleFrom: '2027-06-14T12:30:00.000Z' }] }, '2027-06-14.json': { ...doc(), tradingDate: '2027-06-14', visibleFrom: '2027-06-14T12:30:00.000Z' } };
  const sFake = async (url) => { const f = url.split('/data/daily/')[1]; return sFiles[f] ? { ok: true, json: async () => sFiles[f] } : { ok: false, json: async () => ({}) }; };
  assert.strictEqual((await fn.handle({ queryStringParameters: {}, headers: {} }, sFake, Date.parse('2027-06-14T12:29:00Z'))).available, false);
  assert.strictEqual((await fn.handle({ queryStringParameters: {}, headers: {} }, sFake, Date.parse('2027-06-14T12:30:00Z'))).tradingDate, '2027-06-14');
});

test('page: free view shows dated, explained ranks #11–20 and a lock over #1–10', () => {
  const html = R.render({ ...fn.shape(doc(), false), days: ['2026-11-27', '2026-11-30'] });
  assert.ok(balanced(html));
  assert.ok(html.includes('Monday, November 30, 2026'), 'trading date');
  assert.ok(html.includes('Prices through the Nov 27 close (13:00 ET)'), 'data cutoff');
  assert.ok(html.includes('gb-lock-overlay') && html.includes('Subscribers Only'));
  assert.ok(html.includes('TK11') && html.includes('TK20') && !html.includes('>TK1<') && !html.includes('>TK9<'));
  assert.ok(html.includes('What drove the rank') && html.includes('No verified catalyst'), 'drivers and explicit no-catalyst text');
  assert.ok(html.includes('Earnings scheduled') && html.includes('Finnhub earnings calendar'), 'confirmed catalyst');
  assert.ok(html.includes('Unusual call activity') && html.includes('Not available:'), 'options shown or marked unavailable');
  assert.ok(!html.includes('<script>x</script>') && !html.includes('javascript:alert'), 'headline text escaped, unsafe links dropped');
  assert.ok(!PICK_LANGUAGE.test(html.replace(/<[^>]+>/g, ' ')), 'no buy-pick language in visible text');
});

test('page: subscriber view unlocks all twenty; empty state is explicit', () => {
  const html = R.render(fn.shape(doc(), true));
  assert.ok(balanced(html) && html.includes('>TK1<') && !html.includes('gb-lock-overlay'));
  assert.ok(R.render({ available: false }).includes('No list has been published yet'));
  const home = R.homeCard(fn.shape(doc(), false));
  assert.ok(/ranks 11&ndash;15/.test(home.label) && home.list.includes('TK11') && !home.list.includes('>TK1<'));
});

test('index.html: daily page wired in; weekly product retired from live pages; records kept', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.strictEqual((html.match(/<div id="page-daily" class="page">/g) || []).length, 1);
  assert.strictEqual((html.match(/<script src="\/assets\/js\/gs-daily\.js"><\/script>/g) || []).length, 1);
  assert.ok(html.includes(`id="nav-daily" onclick="showPage('daily')">Daily Top 20`));
  assert.ok(!html.includes('gs-auto-pages.js') && !html.includes('gsSyncHomeCards') && !html.includes('syncBriefCard'));
  for (const gone of ['Five of Fifteen on My Screen', 'Buy zone &amp; trigger signals', 'Weekly premium briefings', 'Free Weekly Brief', '>Briefings</a>', 'Buy Zone Signals']) {
    assert.ok(!html.includes(gone), `removed: ${gone}`);
  }
  assert.ok(html.includes('id="page-brief"') && html.includes('id="page-results"') && html.includes('id="page-performance"'), 'weekly records preserved');
  assert.strictEqual((html.match(/The weekly format was retired in November 2026/g) || []).length, 2, 'archive notes on both weekly pages');
  assert.strictEqual(html.split('<div').length - html.split('</div>').length, -1, 'div balance unchanged (pre-existing −1)');
});

test('pricing and news access copy match the access rules', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const pricing = html.slice(html.indexOf('<div class="pricing-cards">'), html.indexOf('</table>', html.indexOf('compare-table')));
  assert.match(pricing, /5 free scanner comparisons/);
  assert.match(pricing, /Market-news headlines &amp; source links/);
  assert.match(pricing, /<li>World news<\/li>/);
  assert.match(pricing, /<tr><td>Scanner Comparisons<\/td><td>5<\/td>/);
  assert.ok(!/Full news dashboard|Stock Comparison<\/td><td class="no">/.test(pricing), 'news headlines and 5 compares are not shown as premium-only');
  assert.match(html, /Published each U\.S\. trading day at 7:30 a\.m\. CT/);
  assert.ok(!/Published each U\.S\. trading morning/.test(html));
  const news = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify', 'functions', 'news.js'), 'utf8');
  assert.ok(!/access-token|COOKIE_NAME/.test(news), 'headline feed stays open to everyone');
});
