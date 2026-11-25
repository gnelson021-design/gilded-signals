// netlify/functions/daily-top20.js
// Gilded Signals — Daily Top 20.
//
//   GET /api/daily-top20             latest published trading day
//   GET /api/daily-top20?date=YYYY-MM-DD   a specific published day (archive)
//
// Access is enforced HERE, server-side, through the existing subscription
// cookie (same signed token as picks-protected.js):
//   - ranks #11–20: returned in full to everyone (data + explanations)
//   - ranks #1–10:  returned in full only with a valid access cookie;
//                   everyone else receives { rank, locked: true } with no
//                   ticker, numbers, drivers or headlines.
// Lists are read from data/daily/*.json, which the publish job writes once
// per trading day and never rewrites. Until the first list exists this
// returns { available: false } and the page says so.
'use strict';

const { verify, parseCookies, COOKIE_NAME } = require('./_lib/access-token');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FETCH_TIMEOUT_MS = 12000;

async function loadData(file, fetchImpl) {
  const site = process.env.URL || 'https://gildedsignals.com';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(`${site}/data/daily/${file}`, { headers: { 'x-gs-internal': process.env.GS_INTERNAL_SECRET || '' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Pure: apply the access rule to a published list.
function shape(doc, unlocked) {
  const [freeLo, freeHi] = Array.isArray(doc.freeRanks) ? doc.freeRanks : [11, 20];
  const entries = (doc.entries || []).slice().sort((a, b) => a.rank - b.rank).map((e) => {
    const free = e.rank >= freeLo && e.rank <= freeHi;
    return free || unlocked ? { ...e, locked: false } : { rank: e.rank, locked: true };
  });
  return {
    available: true,
    product: doc.product,
    tradingDate: doc.tradingDate,
    methodologyVersion: doc.methodologyVersion,
    dataCutoff: doc.dataCutoff,
    publishedAt: doc.publishedAt || null,
    visibleFrom: doc.visibleFrom || null,
    universeSize: doc.universeSize,
    eligibleCount: doc.eligibleCount,
    freeRanks: [freeLo, freeHi],
    sources: doc.sources || [],
    disclosure: doc.disclosure || null,
    unlocked: Boolean(unlocked),
    entries,
  };
}

// A day's list is published (built and deployed) shortly before its release
// time and is invisible to everyone — free or subscriber — until visibleFrom
// (7:30 a.m. America/Chicago on its trading day). Until then the previous
// trading day's list stays up.
function released(d, now) {
  if (!d || !DATE_RE.test(d.tradingDate)) return false;
  const v = d.visibleFrom ? Date.parse(d.visibleFrom) : NaN;
  return !isFinite(v) || v <= now;
}

async function handle(event, fetchImpl, now = Date.now()) {
  const q = event.queryStringParameters || {};
  if (q.date && !DATE_RE.test(q.date)) return { available: false, error: 'invalid date' };
  const index = await loadData('index.json', fetchImpl);
  const days = index && Array.isArray(index.days) ? index.days.filter((d) => released(d, now)).map((d) => d.tradingDate).sort() : [];
  if (!days.length) return { available: false, days: [] };
  const date = q.date || days[days.length - 1];
  if (!days.includes(date)) return { available: false, days, error: 'no list published for that date' };
  const doc = await loadData(`${date}.json`, fetchImpl);
  if (!doc) return { available: false, days, error: 'list file missing' };
  if (!released(doc, now)) return { available: false, days, error: 'no list published for that date' };
  const cookieHeader = event.headers && (event.headers.cookie || event.headers.Cookie);
  let unlocked = false;
  try { unlocked = Boolean(verify(parseCookies(cookieHeader)[COOKIE_NAME])); } catch (e) { unlocked = false; }
  return { ...shape(doc, unlocked), days };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  try {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(await handle(event)) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ available: false, error: 'unavailable' }) };
  }
};

exports._test = { shape, handle, released };
