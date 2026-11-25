// netlify/functions/auto-week.js
// Gilded Signals — automated-week data for the Briefings and Results pages.
//
//   GET /api/auto-week?kind=brief     latest automatically published briefing
//   GET /api/auto-week?kind=results   latest frozen weekly results
//
// DORMANT BY DESIGN: everything keys off data/weeks.json, which only the
// automated publish job (Build 4) writes. With no manifest this returns
// {available:false} and the site renders exactly as it does today.
//
// Premium protection is server-side: picks ranked 6–15 are returned in full
// only with a valid signed access cookie (same token as picks-protected.js).
// Everyone else receives locked placeholders with no ticker, levels or text.
'use strict';

const { verify, parseCookies, COOKIE_NAME } = require('./_lib/access-token');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const FREE_RANKS = 5;
const FETCH_TIMEOUT_MS = 12000;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

async function loadData(file, fetchImpl) {
  const site = process.env.URL || 'https://gildedsignals.com';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(`${site}/data/${file}`, { headers: { 'x-gs-internal': process.env.GS_INTERNAL_SECRET || '' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Pure: latest week matching a predicate from the manifest.
function latest(manifest, pred) {
  const weeks = (manifest && Array.isArray(manifest.weeks) ? manifest.weeks : []).filter((w) => w && WEEK_RE.test(w.weekOf) && pred(w));
  weeks.sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1));
  return weeks[0] || null;
}

// Pure: merge picks (locked schema) + brief (editorial) into the page shape,
// withholding premium ranks unless unlocked.
function shapeBrief(picksDoc, briefDoc, unlocked) {
  const bp = (briefDoc && briefDoc.picks) || {};
  const picks = (picksDoc.picks || []).slice().sort((a, b) => a.rank - b.rank).map((p) => {
    if (p.rank > FREE_RANKS && !unlocked) return { rank: p.rank, tier: p.tier, tierName: p.tierName, locked: true };
    const e = bp[p.ticker] || {};
    return {
      rank: p.rank, tier: p.tier, tierName: p.tierName, ticker: p.ticker, company: p.company,
      priceAtPublish: p.priceAtPublish, zones: p.zones, firstTarget: p.firstTarget, secondTarget: p.secondTarget,
      invalidationLevel: p.invalidationLevel, convictionScore: p.convictionScore, entryScore: p.entryScore,
      riskReward: p.riskReward, eventGated: p.eventGated, earningsDate: p.earningsDate,
      convictionLabel: e.convictionLabel || null, convictionClass: e.convictionClass || null,
      riskLabel: e.riskLabel || null, riskClass: e.riskClass || null,
      why: e.whyILikeIt || null, risk: e.biggestRisk || null, catalystHtml: e.catalystHtml || null,
      asOfDate: e.chart ? e.chart.asOfDate : null,
    };
  });
  return {
    available: true,
    kind: 'brief',
    weekOf: picksDoc.weekOf,
    dateline: briefDoc.dateline || null,
    lead: briefDoc.lead || null,
    marketCatalyst: briefDoc.weekAtGlance ? briefDoc.weekAtGlance.marketCatalyst || null : null,
    disclosure: briefDoc.disclosure || null,
    scoringVersion: picksDoc.scoringVersion || null,
    methodologyVersion: picksDoc.methodologyVersion || null,
    unlocked: Boolean(unlocked),
    picks,
  };
}

async function handle(event, fetchImpl) {
  const q = event.queryStringParameters || {};
  const kind = q.kind === 'results' ? 'results' : 'brief';
  const manifest = await loadData('weeks.json', fetchImpl);
  if (!manifest) return { available: false, kind };

  if (kind === 'brief') {
    const w = latest(manifest, (x) => x.briefPublishedAt);
    if (!w) return { available: false, kind };
    const [picksDoc, briefDoc] = await Promise.all([loadData(`picks-${w.weekOf}.json`, fetchImpl), loadData(`brief-${w.weekOf}.json`, fetchImpl)]);
    if (!picksDoc || !briefDoc) return { available: false, kind, note: 'files missing' };
    const cookieHeader = event.headers && (event.headers.cookie || event.headers.Cookie);
    let unlocked = false;
    try { unlocked = Boolean(verify(parseCookies(cookieHeader)[COOKIE_NAME])); } catch (e) { unlocked = false; }
    return shapeBrief(picksDoc, briefDoc, unlocked);
  }

  const w = latest(manifest, (x) => x.resultsFrozenAt);
  if (!w) return { available: false, kind };
  const scorecard = await loadData(`results-${w.weekOf}.json`, fetchImpl);
  if (!scorecard) return { available: false, kind, note: 'results file missing' };
  return { available: true, kind, weekOf: w.weekOf, frozenAt: w.resultsFrozenAt, scorecard };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  try {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(await handle(event)) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ available: false, error: 'unavailable' }) };
  }
};

exports._test = { latest, shapeBrief, handle };
