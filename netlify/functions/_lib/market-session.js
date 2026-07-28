// netlify/functions/_lib/market-session.js
// Shared America/New_York market-session helpers for Gilded Signals.
// No external npm packages — uses Intl.DateTimeFormat the same way
// scorecard.js's isGradingComplete() already does, so DST is handled
// correctly by the JS runtime's own IANA tz database rather than any
// hand-rolled offset math.
//
// Session windows (ET):
//   Premarket    04:00–09:30
//   Regular      09:30–16:00
//   After Hours  16:00–20:00
//   Closed       everything else, plus all day Sat/Sun

'use strict';

const PREMARKET_START = 4 * 60;      // 04:00
const REGULAR_START = 9 * 60 + 30;   // 09:30
const REGULAR_END = 16 * 60;         // 16:00
const AFTERHOURS_END = 20 * 60;      // 20:00

const SESSION_LABELS = {
  premarket: 'Premarket',
  regular: 'Market Open',
  afterhours: 'After Hours',
  closed: 'Closed',
};

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Decompose any JS Date into its America/New_York wall-clock parts.
function getETParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(date);

  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });

  let etHour = parseInt(map.hour, 10);
  if (etHour === 24) etHour = 0; // ICU midnight quirk guard (same as scorecard.js)

  return {
    etDate: `${map.year}-${map.month}-${map.day}`,
    etMinutes: etHour * 60 + parseInt(map.minute, 10),
    etSeconds: parseInt(map.second, 10),
    etWeekday: WEEKDAY_INDEX[map.weekday],
  };
}

// Returns { session, sessionLabel, etDate, etMinutes } for a given instant
// (defaults to now). session is one of premarket/regular/afterhours/closed.
function getMarketSession(date) {
  const when = date || new Date();
  const { etDate, etMinutes, etWeekday } = getETParts(when);

  let session;
  if (etWeekday === 0 || etWeekday === 6) {
    session = 'closed';
  } else if (etMinutes < PREMARKET_START) {
    session = 'closed';
  } else if (etMinutes < REGULAR_START) {
    session = 'premarket';
  } else if (etMinutes < REGULAR_END) {
    session = 'regular';
  } else if (etMinutes < AFTERHOURS_END) {
    session = 'afterhours';
  } else {
    session = 'closed';
  }

  return { session, sessionLabel: SESSION_LABELS[session], etDate, etMinutes };
}

// Classify an arbitrary historical timestamp (ISO string or Date) into a
// session label, for tagging individual minute bars/trades during trigger
// detection (e.g. "this bar's low happened during Premarket").
function classifySessionAt(tsOrDate) {
  const d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate);
  return getMarketSession(d).session;
}

// Convert an ET calendar date (YYYY-MM-DD, e.g. a picks file's weekOf
// Monday) + a wall-clock hour/minute into the correct UTC Date, honoring
// DST for that specific date rather than "today's" offset. Works by
// guessing the UTC instant, checking what ET wall-clock time it actually
// lands on, then correcting the difference (and any date rollover).
function etWallTimeToUTC(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  const check = getETParts(guess);

  const targetMinutes = hour * 60 + minute;
  const minuteDiff = targetMinutes - check.etMinutes;

  let dayDiffMs = 0;
  if (check.etDate < dateStr) dayDiffMs = 24 * 60 * 60 * 1000;
  else if (check.etDate > dateStr) dayDiffMs = -24 * 60 * 60 * 1000;

  return new Date(guess.getTime() + minuteDiff * 60000 + dayDiffMs);
}

// 4:00 AM ET on a picks file's published weekOf date (always a Monday in
// the current schema) — the start of the eligible trigger-detection window
// for that week, per the standing "monitor from 4am ET" rule.
function weekStartET(weekOfDateStr) {
  return etWallTimeToUTC(weekOfDateStr, 4, 0);
}

module.exports = {
  getETParts,
  getMarketSession,
  classifySessionAt,
  etWallTimeToUTC,
  weekStartET,
  SESSION_LABELS,
};
