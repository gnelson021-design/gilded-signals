#!/usr/bin/env node
// engine/run.js — GS Research Engine, Phase 1 discovery run (SHADOW ONLY).
//
//   node engine/run.js                      full live run → engine-out/<stamp>/
//   node engine/run.js --out DIR            choose output folder
//   node engine/run.js --replay DIR         re-rank DIR/inputs.json offline and
//                                           confirm the ranking hash matches
//   node engine/run.js --max-universe 300   smaller test run
//
// Writes nothing to data/, index.html or any published location. Output is
// for review only. Needs ALPACA_API_KEY, ALPACA_SECRET_KEY, FINNHUB_API_KEY.

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
const discovery = require('./stages/discovery');
const { RunLog } = require('./lib/runlog');
const http = require('./lib/http');

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function args() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  return { out: get('--out'), replay: get('--replay'), maxUniverse: get('--max-universe') };
}

function rankingHash(ranked) {
  const core = ranked.map((r) => [r.symbol, r.discoveryScore, r.components]);
  return crypto.createHash('sha256').update(JSON.stringify([cfg.DISCOVERY_VERSION, core])).digest('hex').slice(0, 16);
}

function writeJSON(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 1));
}

function summaryMarkdown(meta, ranked) {
  const L = [];
  L.push(`# GS Research Engine — discovery board (SHADOW, not published)`);
  L.push('');
  L.push(`Run: ${meta.startedAt} · version ${cfg.DISCOVERY_VERSION} · universe ${meta.universeSize} · ranking hash \`${meta.rankingHash}\``);
  L.push(`Data: Alpaca SIP daily bars through ${meta.barsThrough}; Alpaca news ${meta.newsArticles} articles (${meta.newsWindow}); Finnhub analysts/earnings.`);
  L.push('');
  L.push('| # | Ticker | Score | Attn | Cat | Trend | Mom | RS | Anl | Price | RSI | 7d news | Surge | Earnings | Sector |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of ranked.slice(0, cfg.board.size)) {
    const c = r.components;
    const f = r.features;
    const v = (x) => (x == null ? '—' : x);
    L.push(`| ${r.discoveryRank} | ${r.symbol} | ${v(r.discoveryScore)} | ${v(c.attention)} | ${v(c.catalysts)} | ${v(c.trend)} | ${v(c.momentum)} | ${v(c.relStrength)} | ${v(c.analysts)} | ${v(f.price)} | ${v(f.rsi14)} | ${r.attention ? r.attention.news7 : 0} | ${r.attention ? r.attention.surge : '—'} | ${r.earnings ? r.earnings.date : '—'} | ${r.industry || '—'} |`);
  }
  L.push('');
  L.push('Components are 0–100. Missing components are excluded and the remaining weights re-normalised.');
  L.push('This board decides what gets researched. It is not a published pick list and carries no buy zones.');
  return L.join('\n') + '\n';
}

async function liveRun(opts, log) {
  const now = Date.now();
  if (opts.maxUniverse) cfg.universe.maxSymbols = Number(opts.maxUniverse);
  const end = new Date(now - 16 * 60 * 1000).toISOString(); // Basic-plan SIP: end ≥ 15 min old

  // 1 — assets
  const assets = await alpaca.listAssets();
  const fa = universe.filterAssets(assets);
  log.stage('assets', { total: assets.length, kept: fa.kept.length, rejected: fa.rejected });

  // 2 — liquidity screen on ~30 days of bars for every candidate symbol
  const recent = await alpaca.dailyBars(fa.kept.map((a) => a.symbol), {
    start: ymd(now - 35 * DAY), end, batch: 200,
  });
  const liq = universe.liquidity(fa.kept, recent);
  log.stage('liquidity', { kept: liq.kept.length, rejected: liq.rejected });
  if (liq.kept.length < 300) throw new Error(`Universe too small (${liq.kept.length}) — data problem, aborting`);

  // 3 — full history for the universe + SPY benchmark
  const syms = liq.kept.map((a) => a.symbol);
  const hist = await alpaca.dailyBars(Array.from(new Set([...syms, 'SPY'])), {
    start: ymd(now - 400 * DAY), end, batch: 100,
  });
  const spy = (hist.SPY || []).map((b) => b.c);
  if (spy.length < 200) throw new Error('SPY benchmark history unavailable — aborting');
  const barsThrough = hist.SPY[hist.SPY.length - 1].t;

  const featRows = [];
  const featRejected = {};
  for (const a of liq.kept) {
    const f = features.computeOne(hist[a.symbol], spy, now);
    if (f.reject) { featRejected[f.reject] = (featRejected[f.reject] || 0) + 1; continue; }
    featRows.push({ symbol: a.symbol, name: a.name, exchange: a.exchange, avgDollarVolume: Math.round(a.avgDollarVolume), features: f });
  }
  log.stage('features', { kept: featRows.length, rejected: featRejected, barsThrough });

  // 4 — news attention across the whole universe in one sweep
  const nw = await alpaca.news({ start: new Date(now - cfg.news.windowDays * DAY).toISOString(), end: new Date(now).toISOString(), maxPages: cfg.news.maxPages });
  if (nw.truncated) log.warn(`News sweep hit maxPages (${cfg.news.maxPages}); baseline window is partial`);
  const att = newsStage.attention(nw.articles, featRows.map((r) => r.symbol), now);
  log.stage('news', { articles: nw.articles.length, pages: nw.pages, truncated: nw.truncated, symbolsWithNews: Object.keys(att).length });

  // 5 — most-active screener (trending by volume and by trade count)
  const active = new Set();
  for (const by of ['volume', 'trades']) {
    try {
      const ma = await alpaca.mostActives({ by, top: 100 });
      ma.list.forEach((x) => active.add(x.symbol));
    } catch (e) { log.warn(`most-actives (${by}) unavailable: ${e.message}`); }
  }
  log.stage('most_actives', { symbols: active.size });

  // 6 — earnings calendar (one call)
  const earnMap = {};
  try {
    const cal = await finnhub.earningsCalendar(ymd(now), ymd(now + cfg.earnings.lookaheadDays * DAY));
    for (const e of cal) if (e.symbol && !earnMap[e.symbol]) earnMap[e.symbol] = { date: e.date, hour: e.hour || null, epsEstimate: e.epsEstimate ?? null };
    log.stage('earnings', { events: cal.length });
  } catch (e) { log.warn(`earnings calendar unavailable: ${e.message}`); }

  let rows = featRows.map((r) => ({ ...r, attention: att[r.symbol] || null, mostActive: active.has(r.symbol), earnings: earnMap[r.symbol] || null, analysts: null }));

  // 7 — analysts + industry for the strongest pre-ranked names only (rate limits)
  const pre = discovery.rank(rows).slice(0, cfg.analysts.topK).map((r) => r.symbol);
  const anMap = {};
  const indMap = {};
  let anFail = 0;
  for (const s of pre) {
    try { anMap[s] = await finnhub.recommendations(s); } catch (e) { anFail++; }
    try { const p = await finnhub.profile(s); indMap[s] = p.finnhubIndustry || null; } catch (e) { /* optional */ }
  }
  if (anFail) log.warn(`analyst data failed for ${anFail}/${pre.length} symbols`);
  log.stage('analysts', { requested: pre.length, ok: pre.length - anFail });
  rows = rows.map((r) => ({ ...r, analysts: anMap[r.symbol] || null, industry: indMap[r.symbol] || null }));

  return { rows, meta: { barsThrough, newsArticles: nw.articles.length, newsWindow: `${cfg.news.windowDays}d`, universeSize: featRows.length } };
}

async function main() {
  const opts = args();
  const log = new RunLog(opts.replay ? 'discovery-replay' : 'discovery');
  let rows, meta, outDir;

  try {
    if (opts.replay) {
      outDir = opts.replay;
      const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'inputs.json'), 'utf8'));
      const ranked = discovery.rank(saved.rows);
      const h = rankingHash(ranked);
      const prior = JSON.parse(fs.readFileSync(path.join(outDir, 'run-log.json'), 'utf8')).rankingHash;
      console.log(`replay hash ${h} · original ${prior} · ${h === prior ? 'MATCH' : 'MISMATCH'}`);
      process.exit(h === prior ? 0 : 2);
    }

    const r = await liveRun(opts, log);
    rows = r.rows;
    meta = r.meta;
    const ranked = discovery.rank(rows);
    const stamp = new Date().toISOString().replace(/[:]/g, '').slice(0, 15);
    outDir = opts.out || path.join('engine-out', stamp);
    fs.mkdirSync(outDir, { recursive: true });

    const doc = log.finish('ok', {
      discoveryVersion: cfg.DISCOVERY_VERSION,
      rankingHash: rankingHash(ranked),
      http: http.stats,
      ...meta,
    });
    writeJSON(outDir, 'inputs.json', { discoveryVersion: cfg.DISCOVERY_VERSION, rows });
    writeJSON(outDir, 'board.json', ranked.slice(0, cfg.board.size));
    writeJSON(outDir, 'run-log.json', doc);
    fs.writeFileSync(path.join(outDir, 'summary.md'), summaryMarkdown({ ...doc, ...meta }, ranked));
    console.log(`\nDone → ${outDir}  (hash ${doc.rankingHash})`);
  } catch (e) {
    log.error(e.message);
    const doc = log.finish('failed', { http: http.stats });
    outDir = outDir || opts.out || path.join('engine-out', 'failed-' + Date.now());
    fs.mkdirSync(outDir, { recursive: true });
    writeJSON(outDir, 'run-log.json', doc);
    console.error(`\nFAILED: ${e.message} (log → ${outDir}/run-log.json)`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { rankingHash, summaryMarkdown, liveRun };
