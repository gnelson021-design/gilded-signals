// netlify/functions/check-triggers.mjs
// Gilded Signals — hourly buy-zone trigger watcher
//
// Runs on a schedule (Netlify Scheduled Functions), polls this site's own
// live scorecard API for the current week, and emails Graham once when a
// pick's First Buy or Second Buy level triggers for the first time.
//
// DELIBERATE DESIGN CHOICE: this function does NOT re-derive trigger
// detection itself. It only calls the already-deployed /api/scorecard
// endpoint (the same locked grading engine, now SIP/Finnhub-aware from
// the 2026-07-28 fix) and reads its firstTrigger/lastTrigger/
// firstBuyTriggered/secondBuyTriggered fields. One source of truth for
// "did a zone actually trigger" -- this file's only job is noticing and
// notifying, never deciding.
//
// State: Netlify Blobs (zero-config, built into the platform, survives
// redeploys/cold starts) tracks which trigger events have already been
// emailed, so a rerun every hour never re-sends the same alert.
//
// Email: Resend's REST API directly (no SDK, same "plain fetch" style as
// the rest of this codebase). Free tier: 3,000 emails/month, 100/day --
// this will never come close given it only sends on an actual new event.
//
// New env vars required (Netlify dashboard only, never via terminal):
//   RESEND_API_KEY   -- from resend.com (free signup, no credit card)
//   ALERT_TO_EMAIL    -- where alerts go (e.g. Graham's own inbox)
//   ALERT_FROM_EMAIL  -- optional. Defaults to Resend's shared sender
//                        (onboarding@resend.dev) so this works with ZERO
//                        domain/DNS setup. Only needed if a branded
//                        "from" address (e.g. alerts@gildedsignals.com)
//                        is wanted later -- requires verifying the domain
//                        with Resend first.
//
// New dependency: @netlify/blobs (added to package.json). No other new
// packages -- email is plain fetch, not the Resend SDK.

'use strict';

import { getStore } from '@netlify/blobs';

const FETCH_TIMEOUT_MS = 12000;

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// This week's Monday (America/New_York), matching the
// data/picks-{weekOf}.json naming convention already used across the
// site (scorecard.js, gen_picks.py). Same DST-safe Intl approach as
// _lib/market-session.js, just returning a calendar date, not a Date.
export function currentWeekOf(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const daysSinceMonday = (WEEKDAYS[map.weekday] + 6) % 7;
  const d = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) - daysSinceMonday));
  return d.toISOString().slice(0, 10);
}

// Every notify-worthy event, uniquely keyed so a rerun can diff against
// what's already been sent. levelIndex 0 = First Buy, 1 = Second Buy.
export function collectTriggerEvents(scorecard) {
  const events = [];
  for (const p of scorecard.picks || []) {
    if (p.firstTrigger) {
      events.push({
        key: `${scorecard.week}:${p.ticker}:first`,
        ticker: p.ticker, company: p.company, level: 'First Buy',
        zonePrice: p.firstTrigger.price, filledPrice: p.firstTrigger.triggeredPrice,
        session: p.firstTrigger.triggeredSession, at: p.firstTrigger.triggeredAt,
      });
    }
    if (p.secondBuyTriggered && p.lastTrigger) {
      events.push({
        key: `${scorecard.week}:${p.ticker}:second`,
        ticker: p.ticker, company: p.company, level: 'Second Buy',
        zonePrice: p.lastTrigger.price, filledPrice: p.lastTrigger.triggeredPrice,
        session: p.lastTrigger.triggeredSession, at: p.lastTrigger.triggeredAt,
      });
    }
  }
  return events;
}

export function formatEmail(newEvents) {
  const lines = newEvents.map((e) => {
    const when = e.at
      ? new Date(e.at).toLocaleString('en-US', {
          timeZone: 'America/New_York', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        })
      : 'unknown time';
    return (
      `${e.ticker}${e.company ? ' (' + e.company + ')' : ''} -- ${e.level} triggered (zone: $${e.zonePrice})\n` +
      `  Filled at $${e.filledPrice} during ${e.session || 'an eligible session'} on ${when}`
    );
  });
  const subject =
    newEvents.length === 1
      ? `Gilded Signals: ${newEvents[0].ticker} ${newEvents[0].level} triggered`
      : `Gilded Signals: ${newEvents.length} buy zones triggered`;
  return { subject, text: lines.join('\n\n') };
}

async function sendEmail(subject, text) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_TO_EMAIL;
  if (!key || !to) {
    console.log('[check-triggers] RESEND_API_KEY or ALERT_TO_EMAIL not set -- skipping send');
    return false;
  }
  const from = process.env.ALERT_FROM_EMAIL || 'Gilded Signals <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return true;
}

export default async () => {
  const week = currentWeekOf();
  const site = process.env.URL || 'https://gildedsignals.com';

  let scorecard;
  try {
    scorecard = await getJSON(`${site}/.netlify/functions/scorecard?week=${week}`);
  } catch (e) {
    console.log(`[check-triggers] scorecard fetch failed for week ${week}: ${e.message}`);
    return new Response('scorecard fetch failed', { status: 200 });
  }
  if (scorecard.error) {
    console.log(`[check-triggers] scorecard returned an error for week ${week}: ${scorecard.error}`);
    return new Response('scorecard error', { status: 200 });
  }

  const events = collectTriggerEvents(scorecard);
  if (!events.length) {
    console.log(`[check-triggers] week ${week}: no triggers yet`);
    return new Response('no triggers', { status: 200 });
  }

  const store = getStore('trigger-notifications');
  const notified = (await store.get('notified-keys', { type: 'json' })) || {};
  const newEvents = events.filter((e) => !notified[e.key]);

  if (!newEvents.length) {
    console.log(`[check-triggers] week ${week}: ${events.length} trigger(s) known, none new`);
    return new Response('no new triggers', { status: 200 });
  }

  const { subject, text } = formatEmail(newEvents);
  try {
    await sendEmail(subject, text);
    console.log(`[check-triggers] emailed ${newEvents.length} new trigger(s): ${newEvents.map((e) => e.key).join(', ')}`);
  } catch (e) {
    // Don't mark as notified if the send failed -- retry naturally next hour.
    console.log(`[check-triggers] email send failed, will retry next run: ${e.message}`);
    return new Response('email failed', { status: 200 });
  }

  newEvents.forEach((e) => { notified[e.key] = e.at; });
  await store.setJSON('notified-keys', notified);

  return new Response(`notified: ${newEvents.length}`, { status: 200 });
};

export const config = { schedule: '@hourly' };
