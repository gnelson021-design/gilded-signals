#!/usr/bin/env node
// engine/backtest.js — point-in-time backtest of the s1 level + Entry Score rules.
//
//   node engine/backtest.js --inputs DIR/inputs.json --out DIR [--symbols 400] [--weeks 52]
//
// For every stock and every past week: compute levels and scores using ONLY
// bars up to that Friday's close, then simulate the following sessions with
// the live methodology's rules on DAILY bars (conservative where daily bars
// can't tell the order of events). Measures whether the levels and the Entry
// Score actually behave as intended.
//
// Honest limits (also written into the report):
//  - Universe is today's liquid list → survivorship bias.
//  - News, analysts and earnings are not point-in-time, so Conviction is
//    tested on its technical parts only ("technical conviction").
//  - Daily bars, not 5-minute: a bar that touches both target and
//    invalidation is counted as a loss; a target on the entry bar never counts.

'use strict';

const fs = require('fs');
const path = require('path');
const alpaca = require('./providers/alpaca');
const features = require('./stages/features');
const levels = require('./stages/levels');
const scoring = require('./stages/scoring');
const discovery = require('./stages/discovery');
const ind = require('./lib/indicators');

const DAY = 86400000;
const TRIGGER_SESSIONS = 5;   // entries only inside the briefing week
const HOLD_SESSIONS = 15;     // carry-forward horizon after publish

function args() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { inputs: get('--inputs'), out: get('--out', 'engine-out/backtest'), symbols: Number(get('--symbols', 400)), weeks: Number(get('--weeks', 52)) };
}

// Simulate one setup on the bars that follow publish. Pure function.
function simulate(lv, fwd) {
  const [z1, z2] = lv.zones;
  const inv = lv.invalidationLevel;
  const tgt = lv.firstTarget;
  let filled = [];
  let exit = null;
  for (let k = 0; k < fwd.length && k < HOLD_SESSIONS; k++) {
    const b = fwd[k];
    const inTriggerWindow = k < TRIGGER_SESSIONS;
    const before = filled.length;
    if (inTriggerWindow) {
      for (const z of [z1, z2]) {
        if (!filled.some((f) => f.z === z) && b.l <= z.price) filled.push({ z, px: Math.min(b.o, z.price), w: z.weight });
      }
    }
    if (!filled.length) continue;
    const newFillThisBar = filled.length > before;
    // Invalidation first (conservative), including on the fill bar.
    if (b.o <= inv && !newFillThisBar) { exit = { kind: 'invalidated', px: b.o, k }; break; }
    if (b.l <= inv) { exit = { kind: 'invalidated', px: newFillThisBar ? Math.min(inv, b.c) : Math.min(inv, b.o), k }; break; }
    if (newFillThisBar && before === 0) continue; // target on the entry bar never counts
    if (b.o >= tgt) { exit = { kind: 'target', px: b.o, k }; break; }
    if (b.h >= tgt) { exit = { kind: 'target', px: tgt, k }; break; }
  }
  if (!filled.length) return { kind: 'no_trigger' };
  const w = filled.reduce((s, f) => s + f.w, 0);
  const entry = filled.reduce((s, f) => s + f.px * f.w, 0) / w;
  if (!exit) {
    const last = fwd[Math.min(fwd.length, HOLD_SESSIONS) - 1];
    exit = { kind: 'open', px: last.c };
  }
  return { kind: exit.kind, entry, exitPx: exit.px, ret: (exit.px - entry) / entry * 100, zonesFilled: filled.length };
}

function techConviction(f) {
  const st = discovery.trendScore(f);
  const mo = discovery.momentumScore(f);
  const rs = f.relStrength63 == null ? null : Math.max(0, Math.min(100, 50 + f.relStrength63 * 2));
  const parts = [[st, 25], [rs, 20], [mo, 15]].filter(([v]) => v != null);
  const den = parts.reduce((s, [, w]) => s + w, 0);
  return den ? parts.reduce((s, [v, w]) => s + v * w, 0) / den : null;
}

function stats(rows) {
  const trig = rows.filter((r) => r.kind !== 'no_trigger');
  const n = (k) => trig.filter((r) => r.kind === k).length;
  const rets = trig.map((r) => r.ret).sort((a, b) => a - b);
  const avg = rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : null;
  const pct = (x) => (rows.length ? Math.round((x / rows.length) * 1000) / 10 : null);
  const pctT = (x) => (trig.length ? Math.round((x / trig.length) * 1000) / 10 : null);
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    setups: rows.length,
    triggered: trig.length,
    triggerRatePct: pct(trig.length),
    targetHitPct: pctT(n('target')),
    invalidatedPct: pctT(n('invalidated')),
    stillOpenPct: pctT(n('open')),
    winRatePct: pctT(trig.filter((r) => r.ret > 0).length),
    // Expected return per PUBLISHED setup (untriggered setups count as 0%) —
    // the number that matters to a subscriber reading the whole list.
    evPerSetupPct: rows.length ? r2(trig.reduce((s, r) => s + r.ret, 0) / rows.length) : null,
    avgReturnPct: r2(avg),
    medianReturnPct: r2(rets.length ? rets[Math.floor(rets.length / 2)] : null),
  };
}

function bucket(rows, key, edges) {
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    out.push({ range: `${lo}–${hi}`, ...stats(rows.filter((r) => r[key] != null && r[key] >= lo && r[key] < hi)) });
  }
  return out;
}

// Does a score rank outcomes? Looks at buckets with ≥200 setups and checks
// that EV per setup rises with the score (no inversions) and that the top
// bucket beats the bottom bucket.
function validate(buckets) {
  const b = buckets.filter((x) => x.setups >= 200 && x.evPerSetupPct != null);
  if (b.length < 2) return { verdict: 'insufficient_data', buckets: b.length };
  let inversions = 0;
  for (let i = 1; i < b.length; i++) if (b[i].evPerSetupPct < b[i - 1].evPerSetupPct) inversions++;
  const spread = Math.round((b[b.length - 1].evPerSetupPct - b[0].evPerSetupPct) * 100) / 100;
  return { verdict: inversions === 0 && spread > 0 ? 'PASS' : 'FAIL', inversions, topMinusBottomEvPct: spread, buckets: b.length };
}

// s3 Entry Score is a trigger likelihood: actual trigger rate must rise with
// the score, and each bucket's actual rate should sit near its predicted mean.
function validateTrigger(rows, edges) {
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const b = rows.filter((r) => r.entryScore >= edges[i] && r.entryScore < edges[i + 1]);
    if (b.length < 200) continue;
    const predicted = b.reduce((s, r) => s + r.entryScore, 0) / b.length;
    const actual = (b.filter((r) => r.kind !== 'no_trigger').length / b.length) * 100;
    out.push({ range: `${edges[i]}–${edges[i + 1]}`, setups: b.length, predictedPct: Math.round(predicted * 10) / 10, actualTriggerPct: Math.round(actual * 10) / 10 });
  }
  if (out.length < 2) return { verdict: 'insufficient_data', buckets: out };
  let inversions = 0;
  for (let i = 1; i < out.length; i++) if (out[i].actualTriggerPct < out[i - 1].actualTriggerPct) inversions++;
  const maxGap = Math.max(...out.map((b) => Math.abs(b.predictedPct - b.actualTriggerPct)));
  return { verdict: inversions === 0 && maxGap <= 15 ? 'PASS' : 'FAIL', inversions, maxCalibrationGapPts: Math.round(maxGap * 10) / 10, buckets: out };
}

function lastBarOfWeekIdx(bars) {
  const out = [];
  for (let i = 0; i < bars.length - 1; i++) {
    if (ind.isoWeekKey(new Date(bars[i].t)) !== ind.isoWeekKey(new Date(bars[i + 1].t))) out.push(i);
  }
  return out;
}

async function main() {
  const o = args();
  const saved = JSON.parse(fs.readFileSync(o.inputs, 'utf8'));
  const syms = saved.rows.slice().sort((a, b) => b.avgDollarVolume - a.avgDollarVolume).slice(0, o.symbols).map((r) => r.symbol);
  const now = Date.now();
  const end = new Date(now - 16 * 60 * 1000).toISOString();
  const start = new Date(now - (o.weeks * 7 + 420) * DAY).toISOString().slice(0, 10);
  const hist = await alpaca.dailyBars([...syms, 'SPY'], { start, end, batch: 100 });
  const spyBars = hist.SPY || [];
  const spyIdx = new Map(spyBars.map((b, i) => [b.t.slice(0, 10), i]));
  const cutoff = now - o.weeks * 7 * DAY;

  const rows = [];
  for (const s of syms) {
    const bars = hist[s];
    if (!bars || bars.length < 300) continue;
    for (const i of lastBarOfWeekIdx(bars)) {
      const t = Date.parse(bars[i].t);
      if (t < cutoff || i < 252) continue;
      const fwd = bars.slice(i + 1, i + 1 + HOLD_SESSIONS);
      if (fwd.length < TRIGGER_SESSIONS) continue;
      const si = spyIdx.get(bars[i].t.slice(0, 10));
      const spyC = si != null ? spyBars.slice(0, si + 1).map((b) => b.c) : null;
      const f = features.computeOne(bars.slice(0, i + 1), spyC, t + DAY);
      if (f.reject) continue;
      const lv = levels.compute(f);
      if (lv.reject) continue;
      const e = scoring.entry({ features: f }, lv, false);
      const sim = simulate(lv, fwd);
      rows.push({
        symbol: s, week: bars[i].t.slice(0, 10), entryScore: e.score,
        techConviction: techConviction(f), rr: lv.riskReward, posture: f.posture,
        distAtr: lv.zone1DistanceAtr, rsi: f.rsi14, atrPct: f.atrPct, ret21: f.ret21, fromHigh52: f.pctFromHigh52,
        ...sim,
      });
    }
  }

  // Benchmark: SPY return over the same publish → +15 session windows.
  const spyRets = [];
  for (const i of lastBarOfWeekIdx(spyBars)) {
    if (Date.parse(spyBars[i].t) < cutoff || i + HOLD_SESSIONS >= spyBars.length) continue;
    spyRets.push((spyBars[i + HOLD_SESSIONS].c - spyBars[i].c) / spyBars[i].c * 100);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: { symbols: syms.length, weeks: o.weeks, triggerSessions: TRIGGER_SESSIONS, holdSessions: HOLD_SESSIONS },
    overall: stats(rows),
    byEntryScore: bucket(rows, 'entryScore', [0, 45, 55, 65, 75, 101]),
    entryScoreValidation: null,
    calibration: {
      zoneDistanceAtr: bucket(rows, 'distAtr', [0, 0.5, 1, 1.5, 2, 2.5, 99]),
      rsi: bucket(rows, 'rsi', [0, 30, 40, 50, 60, 70, 101]),
      atrPct: bucket(rows, 'atrPct', [0, 1.5, 2.5, 3.5, 5, 99]),
      ret21: bucket(rows, 'ret21', [-99, -10, -3, 0, 3, 10, 999]),
      fromHigh52: bucket(rows, 'fromHigh52', [-99, -30, -15, -7, -3, 0.01]),
    },
    byTechConviction: bucket(rows, 'techConviction', [0, 40, 60, 80, 101]),
    byRiskReward: bucket(rows, 'rr', [0, 1, 1.5, 2, 99]),
    byPosture: ['bull', 'lean-bull', 'mixed', 'lean-bear', 'bear'].map((p) => ({ posture: p, ...stats(rows.filter((r) => r.posture === p)) })),
    benchmark: { spyAvg15SessionReturnPct: spyRets.length ? Math.round(spyRets.reduce((s, v) => s + v, 0) / spyRets.length * 100) / 100 : null, windows: spyRets.length },
    limits: [
      "Universe is today's liquid list (survivorship bias).",
      'News, analyst and earnings inputs are not point-in-time; Conviction is tested on technical parts only.',
      'Daily bars: same-bar target+invalidation counts as invalidation; a target on the entry bar never counts.',
      'Hypothetical model results, not brokerage returns.',
    ],
  };
  report.entryScoreValidation = { s3TriggerLikelihood: validateTrigger(rows, [0, 45, 55, 65, 75, 101]), evByEntry: validate(report.byEntryScore) };
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, 'backtest.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(o.out, 'backtest.md'), markdown(report));
  console.log(JSON.stringify(report.overall));
}

function markdown(r) {
  const L = [`# Backtest — scoring s3 levels (${r.scope.symbols} stocks × ${r.scope.weeks} weeks)`, ''];
  const row = (label, s) => `| ${label} | ${s.setups} | ${s.triggerRatePct ?? '—'}% | ${s.targetHitPct ?? '—'}% | ${s.invalidatedPct ?? '—'}% | ${s.stillOpenPct ?? '—'}% | ${s.winRatePct ?? '—'}% | ${s.avgReturnPct ?? '—'}% | ${s.evPerSetupPct ?? '—'}% |`;
  const head = '| Group | Setups | Triggered | Target hit | Invalidated | Open at +15d | Win rate | Avg return (triggered) | EV per setup |\n|---|---|---|---|---|---|---|---|---|';
  L.push(head, row('All', r.overall), '');
  const v = r.entryScoreValidation;
  if (v) {
    const t = v.s3TriggerLikelihood;
    L.push(`**Entry Score s3 validation** (actual trigger rate must rise with the score and sit within 15 pts of the prediction): **${t.verdict}** (inversions ${t.inversions ?? '—'}, max gap ${t.maxCalibrationGapPts ?? '—'} pts)`, '');
    L.push('| Entry Score | Setups | Predicted chance zone reached | Actual |', '|---|---|---|---|', ...(t.buckets || []).map((b) => `| ${b.range} | ${b.setups} | ${b.predictedPct}% | ${b.actualTriggerPct}% |`), '');
    L.push(`For reference, EV per setup by Entry Score (not the s3 pass criterion): ${v.evByEntry.verdict}.`, '');
  }
  L.push('### By Entry Score', head, ...r.byEntryScore.map((b) => row(b.range, b)), '');
  for (const [k, v] of Object.entries(r.calibration)) L.push(`### Calibration — ${k}`, head, ...v.map((b) => row(b.range, b)), '');
  L.push('### By technical Conviction', head, ...r.byTechConviction.map((b) => row(b.range, b)), '');
  L.push('### By risk-to-reward', head, ...r.byRiskReward.map((b) => row(b.range, b)), '');
  L.push('### By trend posture at publish', head, ...r.byPosture.map((b) => row(b.posture, b)), '');
  L.push(`Benchmark: SPY average return over the same publish → +15 session windows: ${r.benchmark.spyAvg15SessionReturnPct}% (${r.benchmark.windows} windows).`, '');
  L.push('Percent rates after "Triggered" are of triggered setups. Limits:', ...r.limits.map((x) => `- ${x}`));
  return L.join('\n') + '\n';
}

if (require.main === module) main().catch((e) => { console.error('BACKTEST FAILED:', e.message); process.exit(1); });

module.exports = { simulate, stats, techConviction, validate, validateTrigger };
