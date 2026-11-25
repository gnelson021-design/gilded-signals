// engine/stages/research.js
// Phase 2: turn the discovery board into scored research candidates and a
// weekly selection in the EXISTING data/picks-YYYY-MM-DD.json schema (plus
// additive fields), so scorecard-v3 can grade it unchanged. Shadow only.

'use strict';

const cfg = require('../config');
const discovery = require('./discovery');
const levels = require('./levels');
const scoring = require('./scoring');
const { select } = require('./select');

const DAY = 86400000;
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const ET_DOW = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });

// Monday of the week being researched (ET). Sat → +2, Sun → +1, Tue–Fri → next
// Mon. Monday BEFORE the 09:30 ET open counts as that same Monday, so a
// catch-up publish early Monday still targets the week about to open.
function nextWeekOf(now) {
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[ET_DOW.format(new Date(now))];
  const et = require('../lib/clock').parts(now, 'America/New_York');
  let add = dow === 0 ? 1 : 8 - dow;
  if (dow === 1 && et.minutes < 9 * 60 + 30) add = 0;
  const base = Date.parse(ET_DATE.format(new Date(now)) + 'T12:00:00Z');
  return new Date(base + add * DAY).toISOString().slice(0, 10);
}
const plusDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

function research(ranked, meta, now) {
  const weekOf = meta.weekOf || nextWeekOf(now);
  const friday = plusDays(weekOf, 4);
  const board = discovery.board(ranked);
  const rejected = [];
  const cands = [];
  for (const row of board) {
    const lv = levels.compute(row.features);
    if (lv.reject) { rejected.push({ symbol: row.symbol, reason: lv.reject }); continue; }
    const e = row.earnings;
    const eventInWeek = Boolean(e && e.date >= weekOf && e.date <= friday);
    const conv = scoring.conviction(row);
    if (conv.score == null) { rejected.push({ symbol: row.symbol, reason: conv.reason }); continue; }
    const ent = scoring.entry(row, lv, eventInWeek);
    cands.push({
      symbol: row.symbol,
      company: row.name,
      industry: row.industry || null,
      lane: row.lane,
      price: row.features.price,
      conviction: conv.score,
      convictionParts: conv.parts,
      entry: ent.score,
      entryAdjustments: ent.adjustments,
      riskClass: scoring.riskClass(row, eventInWeek),
      eventInWeek,
      earnings: e || null,
      levels: lv,
      features: row.features,
      attention: row.attention ? { news7: row.attention.news7, surge: row.attention.surge, tagsPos: row.attention.tagsPos, tagsNeg: row.attention.tagsNeg, headlines: row.attention.headlines } : null,
      analysts: row.analystSummary || null,
      closes63: row.closes63 || null,
    });
  }
  const sel = select(cands, meta.marketPosture);
  const tierName = { 1: 'Primary Picks', 2: 'Secondary Watchlist' };
  const picks = sel.picks.map((c, i) => ({
    rank: i + 1,
    ticker: c.symbol,
    company: c.company,
    tier: c.tier,
    tierName: tierName[c.tier],
    assetClass: 'stock',
    priceAtPublish: c.price,
    entryType: 'dip_zone',
    zones: c.levels.zones,
    firstTarget: c.levels.firstTarget,
    invalidationLevel: c.levels.invalidationLevel,
    actionStatus: 'monitoring', // never a personal-trade posture — model research only
    // Additive fields (ignored by scorecard-v3):
    convictionScore: c.conviction,
    entryScore: c.entry,
    riskClass: c.riskClass,
    riskReward: c.levels.riskReward,
    secondTarget: c.levels.secondTarget,
    eventGated: c.eventInWeek,
    earningsDate: c.earnings ? c.earnings.date : null,
    sector: c.industry,
    scoringVersion: cfg.SCORING_VERSION,
    dataAsOf: meta.barsThrough,
  }));
  return {
    preview: {
      weekOf,
      briefPublishedAt: null,
      resultsGradeDate: friday,
      methodologyVersion: 'v3-target-invalidation',
      scoringVersion: cfg.SCORING_VERSION,
      discoveryVersion: cfg.DISCOVERY_VERSION,
      benchmarkIndex: 'SPY',
      status: 'shadow-preview',
      marketPosture: meta.marketPosture || null,
      picks,
    },
    candidates: cands.map(({ closes63, ...rest }) => rest),
    rejected,
    skipped: sel.skipped,
  };
}

module.exports = { research, nextWeekOf };
