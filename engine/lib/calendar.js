// engine/lib/calendar.js — official U.S. equity trading calendar (Alpaca
// /v2/calendar: holidays and early closes). Falls back to weekdays only,
// flagged as such, if the calendar cannot be reached.
'use strict';

const alpaca = require('../providers/alpaca');
const clock = require('./clock');

async function sessions(start, end) {
  try {
    const rows = await alpaca.calendar(start, end);
    return { official: true, sessions: (rows || []).map((r) => ({ date: r.date, open: r.open, close: r.close, closeUtc: clock.zonedToUtc(r.date, r.close) })) };
  } catch (e) {
    const out = [];
    for (let d = start; d <= end; d = clock.addDays(d, 1)) {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      if (dow >= 1 && dow <= 5) out.push({ date: d, open: '09:30', close: '16:00', closeUtc: clock.zonedToUtc(d, '16:00') });
    }
    return { official: false, error: e.message, sessions: out };
  }
}

// Sessions inside the Mon–Fri week starting at monday.
async function week(monday) {
  const cal = await sessions(monday, clock.addDays(monday, 4));
  return { ...cal, last: cal.sessions[cal.sessions.length - 1] || null };
}

// Last session strictly before a date (e.g. the Friday close before a Monday).
async function lastSessionBefore(ymd) {
  const cal = await sessions(clock.addDays(ymd, -10), clock.addDays(ymd, -1));
  return { ...cal, last: cal.sessions[cal.sessions.length - 1] || null };
}

module.exports = { sessions, week, lastSessionBefore };
