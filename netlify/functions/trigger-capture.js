// netlify/functions/trigger-capture.js
// Gilded Signals — scheduled trigger capture (weekly briefing system only).
//
// Runs every 15 minutes around US market hours (schedule set in
// netlify.toml). Calls the site's own scorecard-v3 endpoint for the
// current briefing week AND the previous week (carry-forward positions),
// which computes triggers from historical SIP bars and persists any new
// events to the Netlify Blobs trigger ledger.
//
// This makes official trigger capture independent of any browser being
// open or any user visiting the page. It holds no logic of its own —
// scorecard-v3 remains the single source of truth.

'use strict';

const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
});

// Monday (ET) of the week containing `offsetDays` from now, as YYYY-MM-DD.
function mondayET(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = ET_FMT.formatToParts(d);
  const m = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  const dowMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const back = dowMap[m.weekday] != null ? dowMap[m.weekday] : 0;
  const monday = new Date(Date.UTC(+m.year, +m.month - 1, +m.day) - back * 86400000);
  return monday.toISOString().slice(0, 10);
}

exports.handler = async () => {
  const site = process.env.URL || 'https://gildedsignals.com';
  const weeks = Array.from(new Set([mondayET(0), mondayET(-7)]));
  const results = [];

  for (const week of weeks) {
    try {
      const res = await fetch(site + '/.netlify/functions/scorecard-v3?week=' + week);
      const body = await res.json().catch(() => null);
      results.push({
        week,
        httpStatus: res.status,
        ledger: body && body.ledger != null ? body.ledger : null,
        triggered: body && body.summary ? body.summary.tradesEntered : null,
        error: body && body.error ? body.error : null,
      });
    } catch (e) {
      results.push({ week, error: String((e && e.message) || e) });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ranAt: new Date().toISOString(), results }),
  };
};
