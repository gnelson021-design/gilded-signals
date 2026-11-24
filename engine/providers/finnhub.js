// engine/providers/finnhub.js
// Finnhub free-tier endpoints used by the engine: analyst recommendation
// trends, company profile (industry for sector mapping), earnings calendar.

'use strict';

const { getJSON } = require('../lib/http');

const BASE = 'https://finnhub.io/api/v1';

function url(path) {
  const t = process.env.FINNHUB_API_KEY;
  if (!t) throw new Error('FINNHUB_API_KEY not set');
  return `${BASE}/${path}${path.includes('?') ? '&' : '?'}token=${t}`;
}

// Monthly snapshots, newest first: [{period, strongBuy, buy, hold, sell, strongSell}]
async function recommendations(symbol, opts) {
  const r = await getJSON(url(`stock/recommendation?symbol=${encodeURIComponent(symbol)}`), opts);
  return Array.isArray(r) ? r : [];
}

async function profile(symbol, opts) {
  const r = await getJSON(url(`stock/profile2?symbol=${encodeURIComponent(symbol)}`), opts);
  return r && typeof r === 'object' ? r : {};
}

// [{symbol, date, hour, epsEstimate, revenueEstimate, ...}]
async function earningsCalendar(from, to, opts) {
  const r = await getJSON(url(`calendar/earnings?from=${from}&to=${to}`), opts);
  return (r && Array.isArray(r.earningsCalendar)) ? r.earningsCalendar : [];
}

module.exports = { recommendations, profile, earningsCalendar };
