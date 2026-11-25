#!/usr/bin/env node
// engine/daily.js — Gilded Signals Daily Top 20.
//
//   node engine/daily.js build --out DIR [--max-universe N]   build today's list (writes nothing public)
//   node engine/daily.js replay DIR                           re-rank saved inputs; hash must match
//   node engine/daily.js gate [--allow-late|--scheduled]      should a publish run now? (run=true|false)
//                                                            --scheduled: only at/after 07:30 CT, never after the open
//   node engine/daily.js publish --run DIR [--allow-late]     write-once data/daily/{date}.json + index
//   node engine/daily.js health                               data sources + missed-list check
//   node engine/daily.js alert "<subject>" "<text>"
//
// One list per U.S. trading day, built from the PREVIOUS session's completed
// bars plus news up to the run time. Published once (write-once) and fixed for
// the whole trading day — no intraday re-ranking. Publishing to production
// (main) also requires GS_PRODUCTION_APPROVED=yes.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = require('./config');
const alpaca = require('./providers/alpaca');
const finnhub = require('./providers/finnhub');
const universe = require('./stages/universe');
const features = require('./stages/features');
const newsStage = require('./stages/news');
const optionsStage = require('./stages/options');
const dailyRank = require('./stages/daily-rank');
const calendar = require('./lib/calendar');
const clock = require('./lib/clock');
const alert = require('./lib/alert');
const http = require('./lib/http');
const { RunLog } = require('./lib/runlog');

const DAY = 86400000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

// ---------- trading date + cutoff ----------
// The list is FOR the trading date: today if today is a session that has not
// closed yet, otherwise the next session. Its data cutoff is the close of the
// session before it.
async function tradingContext(now) {
  const today = clock.parts(now, 'America/New_York').date;
  const cal = await calendar.sessions(clock.addDays(today, -10), clock.addDays(today, 10));
  const upcoming = cal.sessions.find((s) => s.date > today || (s.date === today && now < Date.parse(s.closeUtc)));
  if (!upcoming) throw new Error('no upcoming trading session found in the calendar');
  const prior = cal.sessions.filter((s) => s.date < upcoming.date).slice(-1)[0];
  if (!prior) throw new Error('no prior trading session found in the calendar');
  const openUtc = clock.zonedToUtc(upcoming.date, upcoming.open);
  return { tradingDate: upcoming.date, openUtc, closeUtc: upcoming.closeUtc, cutoff: prior, calendarOfficial: cal.official, isToday: upcoming.date === today };
}

// ---------- build ----------
async function build(opts, log) {
  const now = opts.now || Date.now();
  if (opts.maxUniverse) cfg.universe.maxSymbols = Number(opts.maxUniverse);
  const ctx = await tradingContext(now);
  log.stage('trading_date', { tradingDate: ctx.tradingDate, cutoffSession: ctx.cutoff.date, cutoffClose: ctx.cutoff.closeUtc, calendarOfficial: ctx.calendarOfficial });
  const end = new Date(now - 16 * 60 * 1000).toISOString();

  const assets = await alpaca.listAssets();
  const fa = universe.filterAssets(assets);
  log.stage('assets', { total: assets.length, kept: fa.kept.length, rejected: fa.rejected });

  const recent = await alpaca.dailyBars(fa.kept.map((a) => a.symbol), { start: ymd(now - 35 * DAY), end, batch: 200 });
  const liq = universe.liquidity(fa.kept, recent);
  log.stage('liquidity', { kept: liq.kept.length, rejected: liq.rejected });
  if (liq.kept.length < 300) throw new Error(`Universe too small (${liq.kept.length}) — data problem, aborting`);

  const hist = await alpaca.dailyBars(Array.from(new Set([...liq.kept.map((a) => a.symbol), 'SPY'])), { start: ymd(now - 400 * DAY), end, batch: 100 });
  // No intraday data: keep only bars up to and including the cutoff session.
  let trimmed = 0;
  for (const bars of Object.values(hist)) {
    while (bars.length && ET_DATE.format(new Date(bars[bars.length - 1].t)) > ctx.cutoff.date) { bars.pop(); trimmed++; }
  }
  const spyBars = hist.SPY || [];
  if (spyBars.length < 200) throw new Error('SPY benchmark history unavailable — aborting');
  const barsThrough = ET_DATE.format(new Date(spyBars[spyBars.length - 1].t));
  if (barsThrough !== ctx.cutoff.date) throw new Error(`stale data: bars through ${barsThrough}, expected ${ctx.cutoff.date}`);
  const spy = spyBars.map((b) => b.c);
  const featNow = Date.parse(ctx.cutoff.closeUtc) + DAY;

  const rows = [];
  const featRejected = {};
  for (const a of liq.kept) {
    const f = features.computeOne(hist[a.symbol], spy, featNow);
    if (f.reject) { featRejected[f.reject] = (featRejected[f.reject] || 0) + 1; continue; }
    if (ET_DATE.format(new Date(f.lastBar)) !== ctx.cutoff.date) { featRejected.not_traded_on_cutoff_session = (featRejected.not_traded_on_cutoff_session || 0) + 1; continue; }
    rows.push({ symbol: a.symbol, name: a.name, exchange: a.exchange, features: f });
  }
  log.stage('features', { kept: rows.length, rejected: featRejected, barsThrough, trimmedLaterBars: trimmed });

  const nw = await alpaca.news({ start: new Date(now - cfg.news.windowDays * DAY).toISOString(), end: new Date(now).toISOString(), maxPages: cfg.news.maxPages });
  if (nw.truncated) log.warn(`News sweep hit maxPages (${cfg.news.maxPages}); baseline window is partial`);
  const att = newsStage.attention(nw.articles, rows.map((r) => r.symbol), now);
  log.stage('news', { articles: nw.articles.length, pages: nw.pages, truncated: nw.truncated, symbolsWithNews: Object.keys(att).length, newsThrough: new Date(now).toISOString() });

  const active = new Set();
  for (const by of ['volume', 'trades']) {
    try { (await alpaca.mostActives({ by, top: 100 })).list.forEach((x) => active.add(x.symbol)); } catch (e) { log.warn(`most-actives (${by}) unavailable: ${e.message}`); }
  }
  const earnMap = {};
  try {
    const cal = await finnhub.earningsCalendar(ctx.tradingDate, clock.addDays(ctx.tradingDate, cfg.earnings.lookaheadDays));
    for (const e of cal) if (e.symbol && !earnMap[e.symbol]) earnMap[e.symbol] = { date: e.date, hour: e.hour || null };
    log.stage('earnings', { events: cal.length });
  } catch (e) { log.warn(`earnings calendar unavailable: ${e.message}`); }

  for (const r of rows) { r.attention = att[r.symbol] || null; r.mostActive = active.has(r.symbol); r.earnings = earnMap[r.symbol] || null; r.options = null; }

  // Options activity for the strongest candidates only (rate limits).
  const pre = dailyRank.rank(rows, ctx.tradingDate);
  const optTargets = pre.scored.slice(0, cfg.options.topK).map((x) => x.r.symbol);
  const expLte = clock.addDays(ctx.tradingDate, 60);
  let optOk = 0, optFail = 0, optFirstError = null;
  for (const sym of optTargets) {
    try {
      const snaps = await alpaca.optionSnapshots(sym);
      let contracts = [];
      try { contracts = await alpaca.optionContracts(sym, expLte); } catch (e) { /* open interest optional */ }
      const row = rows.find((r) => r.symbol === sym);
      row.options = optionsStage.summarize(snaps, contracts, ctx.cutoff.date, cfg.options);
      if (row.options.available) optOk++;
    } catch (e) {
      optFail++;
      optFirstError = optFirstError || e.message;
      const row = rows.find((r) => r.symbol === sym);
      row.options = { available: false, reason: 'options data not available from the current data plan or provider' };
    }
  }
  log.stage('options', { requested: optTargets.length, available: optOk, failed: optFail, firstError: optFirstError });
  if (optFail === optTargets.length && optTargets.length) log.warn(`options data unavailable for every candidate (${optFirstError}) — options component dropped and weights re-normalised`);

  const ranked = dailyRank.rank(rows, ctx.tradingDate);
  const top = ranked.scored.slice(0, cfg.LIST_SIZE);
  for (const x of top) {
    try { const p = await finnhub.profile(x.r.symbol); x.r.industry = p.finnhubIndustry || null; } catch (e) { x.r.industry = null; }
  }
  log.stage('rank', { eligible: ranked.eligibleCount, excluded: ranked.excluded, listed: top.length });

  const meta = { tradingDate: ctx.tradingDate, cutoff: ctx.cutoff, newsThrough: new Date(now).toISOString(), calendarOfficial: ctx.calendarOfficial, universeSize: rows.length, eligibleCount: ranked.eligibleCount, generatedAt: new Date(now).toISOString() };
  return { rows, meta, top: top.map((x, i) => dailyRank.entry(x, i + 1)) };
}

function listDoc(meta, top) {
  return {
    product: 'Gilded Signals Daily Top 20',
    tradingDate: meta.tradingDate,
    methodologyVersion: cfg.METHODOLOGY_VERSION,
    dataCutoff: {
      pricesThroughSession: meta.cutoff.date,
      pricesThroughCloseEt: meta.cutoff.close,
      pricesThroughCloseUtc: meta.cutoff.closeUtc,
      newsThrough: meta.newsThrough,
    },
    generatedAt: meta.generatedAt,
    universeSize: meta.universeSize,
    eligibleCount: meta.eligibleCount,
    freeRanks: cfg.FREE_RANKS,
    sources: ['Alpaca SIP daily bars (completed sessions only)', 'Alpaca news (Benzinga)', 'Alpaca most-active screeners', 'Alpaca options snapshots + contracts (when available)', 'Finnhub earnings calendar', 'Finnhub company profile'],
    disclosure: 'Factual momentum research generated automatically from verified market data. Rankings describe recent price, volume and news activity; they are not recommendations to buy or sell and not personal trades.',
    entries: top,
  };
}

function listHash(doc) {
  const core = doc.entries.map((e) => [e.rank, e.ticker, e.score, e.drivers.map((d) => [d.factor, d.points])]);
  return crypto.createHash('sha256').update(JSON.stringify([doc.methodologyVersion, doc.tradingDate, core])).digest('hex').slice(0, 16);
}

// ---------- publish (write-once) ----------
function dataDir(opts) { return path.join(opts.root || process.cwd(), 'data', 'daily'); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function loadIndex(opts) { return readJSON(path.join(dataDir(opts), 'index.json')) || { days: [] }; }
function targetAllowed(branch) {
  if (!branch || branch === 'main' || branch === 'master') return process.env.GS_PRODUCTION_APPROVED === 'yes';
  return true;
}

async function gate(now, opts = {}) {
  const today = clock.parts(now, 'America/New_York').date;
  const cal = await calendar.sessions(today, today);
  const s = cal.sessions[0];
  if (!s || s.date !== today) return { run: false, reason: `${today} is not a U.S. trading day` };
  if (loadIndex(opts).days.some((d) => d.tradingDate === today)) return { run: false, reason: `list for ${today} already published (fixed for the day)` };
  const openUtc = Date.parse(clock.zonedToUtc(today, s.open));
  if (now >= Date.parse(s.closeUtc)) return { run: false, reason: 'session already closed' };
  if (opts.scheduled) {
    const [ph, pm] = cfg.PUBLISH.time.split(':').map(Number);
    const ct = clock.parts(now, cfg.PUBLISH.timeZone);
    if (ct.minutes < ph * 60 + pm) return { run: false, reason: `before the ${cfg.PUBLISH.label} publication time — the later slot publishes` };
    if (now >= openUtc) return { run: false, reason: 'market already open — a scheduled run never publishes after the open' };
  }
  if (now >= openUtc && !opts.allowLate) return { run: false, reason: 'market already open — the morning list must publish before the open (use --allow-late for a recovery publish built from the same prior-close data)' };
  return { run: true, reason: now >= openUtc ? 'late recovery publish (prior-close data)' : 'pre-open publish window' };
}

async function publish(runDir, now, opts = {}) {
  if (!targetAllowed(opts.branch)) throw new Error(`publishing to ${opts.branch} requires GS_PRODUCTION_APPROVED=yes`);
  const doc = readJSON(path.join(runDir, 'top20.json'));
  const log = readJSON(path.join(runDir, 'run-log.json'));
  if (!doc || !log || log.status !== 'ok') throw new Error('build output missing or failed — nothing published');
  const g = await gate(now, opts);
  if (!g.run) return { published: false, tradingDate: doc.tradingDate, reason: g.reason };
  const today = clock.parts(now, 'America/New_York').date;
  if (doc.tradingDate !== today) throw new Error(`list is for ${doc.tradingDate}, but today is ${today} — refusing to publish a different day's list`);
  const prior = await calendar.lastSessionBefore(today);
  if (prior.last && doc.dataCutoff.pricesThroughSession !== prior.last.date) throw new Error(`stale data: prices through ${doc.dataCutoff.pricesThroughSession}, expected ${prior.last.date}`);
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) return { published: false, tradingDate: today, reason: 'no stock met the bullish-momentum criteria — nothing published today' };
  const ranks = doc.entries.map((e) => e.rank).join(',');
  const want = doc.entries.map((_, i) => i + 1).join(',');
  if (ranks !== want || new Set(doc.entries.map((e) => e.ticker)).size !== doc.entries.length) throw new Error('ranks are not 1..N or tickers repeat — refusing to publish');

  const dir = dataDir(opts);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today}.json`);
  if (fs.existsSync(file)) return { published: false, tradingDate: today, reason: 'already published (write-once)' };
  const stamp = new Date(now).toISOString();
  fs.writeFileSync(file, JSON.stringify({ ...doc, status: 'published', publishedAt: stamp, listHash: listHash(doc) }, null, 1) + '\n', { flag: 'wx' });
  const idx = loadIndex(opts);
  idx.days.push({ tradingDate: today, publishedAt: stamp, count: doc.entries.length, methodologyVersion: doc.methodologyVersion, pricesThroughSession: doc.dataCutoff.pricesThroughSession });
  idx.days.sort((a, b) => (a.tradingDate < b.tradingDate ? -1 : 1));
  idx.updatedAt = stamp;
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 1) + '\n');
  return { published: true, tradingDate: today, files: [`data/daily/${today}.json`, 'data/daily/index.json'], count: doc.entries.length };
}

async function health(now, opts = {}) {
  const issues = [], ok = [];
  const today = clock.parts(now, 'America/New_York').date;
  const cal = await calendar.sessions(today, today);
  if (cal.official) ok.push('trading calendar reachable'); else issues.push(`trading calendar unreachable (${cal.error})`);
  try { const q = await finnhub.quote('SPY'); if (q && q.c > 0) ok.push('Finnhub reachable'); else issues.push('Finnhub returned no SPY quote'); } catch (e) { issues.push(`Finnhub unreachable: ${e.message}`); }
  const s = cal.sessions[0];
  if (s && s.date === today) {
    const openUtc = Date.parse(clock.zonedToUtc(today, s.open));
    if (now > openUtc && !loadIndex(opts).days.some((d) => d.tradingDate === today)) {
      const last = loadIndex(opts).days.slice(-1)[0];
      issues.push(`no Daily Top 20 was published for ${today}; the most recent list (${last ? last.tradingDate : 'none'}) remains, clearly dated`);
    }
  }
  return { ok, issues };
}

// ---------- CLI ----------
function output(k, v) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(`${k}=${v}`);
}

function summaryMd(doc, log) {
  const L = [`# Daily Top 20 — ${doc.tradingDate} (${doc.methodologyVersion})`, '',
    `Prices through the ${doc.dataCutoff.pricesThroughSession} close · news through ${doc.dataCutoff.newsThrough} · ${doc.eligibleCount} of ${doc.universeSize} stocks met the bullish-momentum criteria · hash \`${log.listHash}\``, '',
    '| # | Ticker | Score | 5d | 21d | RSI | RVOL | ATR% | Top drivers | Catalyst |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const e of doc.entries) {
    const c = e.catalysts;
    const cat = c.none ? 'none verified' : [...c.confirmed.map((x) => `earnings ${x.date}`), ...c.reported.slice(0, 1).map((x) => `${x.label} (${x.date})`)].join('; ');
    L.push(`| ${e.rank} | ${e.ticker} | ${e.score} | ${e.stats.ret5} | ${e.stats.ret21} | ${e.stats.rsi14} | ${e.stats.rvol} | ${e.stats.atrPct} | ${e.topDrivers.join(' · ')} | ${cat} |`);
  }
  L.push('', `Free ranks: #${doc.freeRanks[0]}–${doc.freeRanks[1]}. ${doc.disclosure}`);
  return L.join('\n') + '\n';
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
  const now = process.env.GS_NOW ? Date.parse(process.env.GS_NOW) : Date.now();
  const branch = process.env.GS_PUBLISH_BRANCH || 'automation/dev';
  const scheduled = rest.includes('--scheduled');
  const allowLate = rest.includes('--allow-late') && !scheduled;
  const runUrl = process.env.GITHUB_RUN_URL || '';
  try {
    if (cmd === 'build') {
      const log = new RunLog('daily-build');
      const outDir = arg('--out') || path.join('engine-out', 'daily');
      fs.mkdirSync(outDir, { recursive: true });
      try {
        const { rows, meta, top } = await build({ now, maxUniverse: arg('--max-universe') }, log);
        const doc = listDoc(meta, top);
        const d = log.finish('ok', { tradingDate: meta.tradingDate, methodologyVersion: cfg.METHODOLOGY_VERSION, listHash: listHash(doc), http: http.stats });
        fs.writeFileSync(path.join(outDir, 'inputs.json'), JSON.stringify({ meta, rows }));
        fs.writeFileSync(path.join(outDir, 'top20.json'), JSON.stringify(doc, null, 1));
        fs.writeFileSync(path.join(outDir, 'run-log.json'), JSON.stringify(d, null, 1));
        fs.writeFileSync(path.join(outDir, 'summary.md'), summaryMd(doc, d));
        console.log(`\nDone → ${outDir} (${doc.entries.length} listed for ${doc.tradingDate}, hash ${d.listHash})`);
      } catch (e) {
        log.error(e.message);
        fs.writeFileSync(path.join(outDir, 'run-log.json'), JSON.stringify(log.finish('failed', { http: http.stats }), null, 1));
        throw e;
      }
    } else if (cmd === 'replay') {
      const dir = rest[0];
      const saved = readJSON(path.join(dir, 'inputs.json'));
      const prior = readJSON(path.join(dir, 'run-log.json'));
      const ranked = dailyRank.rank(saved.rows, saved.meta.tradingDate);
      const top = ranked.scored.slice(0, cfg.LIST_SIZE);
      const doc = listDoc(saved.meta, top.map((x, i) => dailyRank.entry(x, i + 1)));
      const h = listHash(doc);
      console.log(`replay hash ${h} · original ${prior.listHash} · ${h === prior.listHash ? 'MATCH' : 'MISMATCH'}`);
      process.exit(h === prior.listHash ? 0 : 2);
    } else if (cmd === 'gate') {
      const g = await gate(now, { allowLate, scheduled });
      output('run', g.run ? 'true' : 'false');
      console.log(`gate: ${g.reason}`);
    } else if (cmd === 'publish') {
      const r = await publish(arg('--run'), now, { branch, allowLate, scheduled });
      console.log(JSON.stringify(r));
      output('files', r.published ? r.files.join(' ') : '');
      output('tradingDate', r.tradingDate || '');
      if (!r.published && !/already published/.test(r.reason)) await alert.send(`Daily Top 20 NOT published — ${r.tradingDate}`, `Reason: ${r.reason}\nThe most recent published list stays on the site with its own date.\n${runUrl}`);
    } else if (cmd === 'health') {
      const r = await health(now);
      console.log(JSON.stringify(r, null, 1));
      if (r.issues.length) await alert.send(`Health check: ${r.issues.length} issue(s)`, r.issues.map((x) => `- ${x}`).join('\n') + `\n${runUrl}`);
    } else if (cmd === 'alert') {
      await alert.send(rest[0] || 'Automation alert', rest[1] || runUrl);
    } else {
      console.error('usage: daily.js build|replay|gate|publish|health|alert');
      process.exit(2);
    }
  } catch (e) {
    console.error(`[daily] ${cmd} failed: ${e.message}`);
    if (cmd !== 'build' || process.env.GITHUB_ACTIONS) await alert.send(`Daily Top 20 step failed: ${cmd}`, `${e.message}\nNothing was published or overwritten.\n${runUrl}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { build, listDoc, listHash, gate, publish, health, tradingContext, targetAllowed };
