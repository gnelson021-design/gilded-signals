// netlify/functions/picks-display.js
// Gilded Signals -- public proxy for the week's picks display data
// (zones, notes, myAvgEntry) used by the Brief page's client-side
// accumulation-zone charts. The raw data/picks-{week}.json file itself
// is blocked from direct public access by the Edge Function at
// netlify/edge-functions/protect-picks-data.js -- this function is the
// one sanctioned path back to that data for the browser, using the
// same internal auth header scorecard.js and scorecard-v3.js use.
'use strict';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const FETCH_TIMEOUT_MS = 12000;

exports.handler = async (event) => {
  const week = event.queryStringParameters && event.queryStringParameters.week;
  if (!week) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'week required' }) };
  }

  const site = process.env.URL || 'https://gildedsignals.com';
  const url = `${site}/data/picks-${week}.json`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'x-gs-internal': process.env.GS_INTERNAL_SECRET || '' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ picks: [] }) };
    }
    const data = await res.json();
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ picks: [] }) };
  } finally {
    clearTimeout(t);
  }
};
