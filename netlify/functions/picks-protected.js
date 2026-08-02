/* =====================================================================
   GILDED SIGNALS — PROTECTED PICKS (ranks 6-15)
   Returns picks 6-15 for the requested week ONLY if the request carries
   a valid, unexpired signed access cookie. Unauthenticated or invalid
   requests get an empty picks array -- never the real data, never a
   partial leak.

   Reads data/brief-{week}.json -- the canonical editorial file from
   the JSON-driven publishing pipeline (already built and validated,
   not yet live). This function is the reason to finish wiring that
   pipeline in: until brief-{week}.json exists for the current week,
   this will correctly return picks: [] for that week even to a
   verified subscriber, rather than serve nothing or guess.
   ===================================================================== */
'use strict';
const { verify, sign, serializeCookie, parseCookies, COOKIE_NAME } = require('./_lib/access-token');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const FETCH_TIMEOUT_MS = 12000;

// Same convention as scorecard.js: fetch the site's own public data file
// over HTTP rather than reading the filesystem -- the function bundle
// doesn't reliably include arbitrary data files, and this keeps exactly
// one copy of the data, independently auditable at that URL.
async function loadBrief(week) {
  const site = process.env.URL || 'https://gildedsignals.com';
  const url = `${site}/data/brief-${week}.json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'x-gs-internal': process.env.GS_INTERNAL_SECRET || '' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async (event) => {
  const week = event.queryStringParameters && event.queryStringParameters.week;
  if (!week) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'week required' }) };
  }

  const cookieHeader = event.headers && (event.headers.cookie || event.headers.Cookie);
  const cookies = parseCookies(cookieHeader);
  const payload = verify(cookies[COOKIE_NAME]);

  if (!payload) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false, picks: [] }),
    };
  }

  let brief;
  try {
    brief = await loadBrief(week);
  } catch (e) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true, picks: [], note: 'No data file for this week yet.' }),
    };
  }

  const protectedPicks = (brief.picks || []).filter((p) => p.rank >= 6 && p.rank <= 15);

  // Sliding expiration: a valid check refreshes the cookie so an active
  // subscriber never has to manually re-verify mid-session.
  const refreshed = sign(payload.email);

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': serializeCookie(refreshed) },
    body: JSON.stringify({ active: true, picks: protectedPicks }),
  };
};
