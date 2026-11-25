// engine/lib/clock.js — America/Chicago and America/New_York time helpers.
// GitHub cron runs in UTC with no time-zone support, so every scheduled job
// has two UTC slots (CST and CDT) and checks the real Central Time here.
'use strict';

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const FMT = {};
function fmt(tz) {
  if (!FMT[tz]) FMT[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  return FMT[tz];
}

function parts(now, tz = 'America/Chicago') {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, dow: DOW[p.weekday], hour, minute: Number(p.minute), minutes: hour * 60 + Number(p.minute) };
}

// Convert a wall-clock time in a zone (e.g. "2026-11-27", "13:00", ET) to a UTC ISO string.
function zonedToUtc(date, hhmm, tz = 'America/New_York') {
  const [h, m] = hhmm.split(':').map(Number);
  let guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, tz);
    const shownUtc = Date.parse(`${p.date}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:00Z`);
    guess += Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - shownUtc;
  }
  return new Date(guess).toISOString();
}

const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Monday (YYYY-MM-DD) of the week containing ymd.
function mondayOf(ymd) {
  const dow = new Date(ymd + 'T12:00:00Z').getUTCDay();
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

module.exports = { parts, zonedToUtc, addDays, mondayOf };
