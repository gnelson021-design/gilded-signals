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
const fs = require('fs');
const path = require('path');
const { verify, sign, serializeCookie, parseCookies, COOKIE_NAME } = require('./_lib/access-token');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

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
    const filePath = path.join(__dirname, '..', '..', 'data', 'brief-' + week + '.json');
    brief = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
