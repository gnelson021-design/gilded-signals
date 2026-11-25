// engine/lib/alert.js — critical-issue email via Resend (same plain-fetch
// approach and env names as scripts/check-triggers.mjs). Without a key it
// logs to the GitHub job summary instead and never throws.
'use strict';

const fs = require('fs');

async function send(subject, text, opts = {}) {
  const line = `### ${subject}\n\n${text}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n'); } catch (e) { /* ignore */ } }
  console.log(`[alert] ${subject} — ${text.split('\n')[0]}`);
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_TO_EMAIL;
  if (!key || !to) return { sent: false, reason: 'RESEND_API_KEY or ALERT_TO_EMAIL not set' };
  try {
    const res = await (opts.fetchImpl || fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL || 'Gilded Signals <onboarding@resend.dev>', to: [to], subject: `[Gilded Signals] ${subject}`, text }),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { send };
