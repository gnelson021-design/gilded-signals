#!/usr/bin/env node
// engine/schedule.js — Build 4: the weekly automation cycle.
//
//   node engine/schedule.js gate <job> [--force]      should this cron firing run? (writes run=true|false)
//   node engine/schedule.js publish --run DIR          Sunday: publish a READY brief (write-once)
//   node engine/schedule.js freeze                     Friday: freeze the graded week (write-once)
//   node engine/schedule.js health                     daily: data sources + missed-publish checks
//   node engine/schedule.js alert "<subject>" "<text>" send a critical alert
//
// Jobs (America/Chicago): saturday 09:00 discovery · sunday-validate 15:00 ·
// sunday-publish 18:00 (catch-up until Mon 08:00) · friday-close 16:00
// (catch-up until Sat 12:00) · health daily 07:15.
//
// Safety: publish only when every safety gate passed; never overwrite a
// published week or a frozen result; publish to production (main) only when
// the repository variable GS_PRODUCTION_APPROVED is exactly "yes".
'use strict';

const fs = require('fs');
const path = require('path');
const clock = require('./lib/clock');
const calendar = require('./lib/calendar');
const alert = require('./lib/alert');
const { getJSON } = require('./lib/http');
const { nextWeekOf } = require('./stages/research');

// Windows are [start, end) in minutes from Sunday 00:00 Central Time.
const W = (dow, hh, mm = 0) => dow * 1440 + hh * 60 + mm;
const JOBS = {
  // One-hour windows for non-idempotent jobs so only one DST slot runs.
  'saturday':        { windows: [[W(6, 9), W(6, 10)]], idempotent: false },
  'sunday-validate': { windows: [[W(0, 15), W(0, 16)]], idempotent: false },
  'sunday-publish':  { windows: [[W(0, 18), W(0, 24)], [W(1, 0), W(1, 8)]], idempotent: true },
  'friday-close':    { windows: [[W(5, 16), W(5, 24)], [W(6, 0), W(6, 12)]], idempotent: true },
  'health':          { windows: [0, 1, 2, 3, 4, 5, 6].map((d) => [W(d, 7, 15), W(d, 8, 15)]), idempotent: false },
};

function inWindow(job, now) {
  const p = clock.parts(now);
  const t = p.dow * 1440 + p.minutes;
  return JOBS[job].windows.some(([a, b]) => t >= a && t < b);
}

function root(opts) { return opts.root || process.cwd(); }
function dataPath(opts, f) { return path.join(root(opts), 'data', f); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function loadManifest(opts) { return readJSON(dataPath(opts, 'weeks.json')) || { weeks: [] }; }
function writeOnce(p, obj) {
  if (fs.existsSync(p)) throw new Error(`refusing to overwrite ${path.basename(p)} (write-once)`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n', { flag: 'wx' });
}
function writeManifest(opts, m) {
  m.weeks.sort((a, b) => (a.weekOf < b.weekOf ? -1 : 1));
  m.updatedAt = new Date().toISOString();
  fs.writeFileSync(dataPath(opts, 'weeks.json'), JSON.stringify(m, null, 1) + '\n');
}
function output(k, v) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(`${k}=${v}`);
}

// Production publishing needs explicit approval. Shadow branch is always allowed.
function targetAllowed(branch) {
  if (!branch || branch === 'main' || branch === 'master') return process.env.GS_PRODUCTION_APPROVED === 'yes';
  return true;
}

// ---------------- gate ----------------
function gate(job, now, opts = {}) {
  if (!JOBS[job]) return { run: false, reason: `unknown job ${job}` };
  if (!opts.force && !inWindow(job, now)) return { run: false, reason: 'outside Central Time window (other DST slot or late firing)' };
  if (JOBS[job].idempotent) {
    const m = loadManifest(opts);
    if (job === 'sunday-publish') {
      const wk = nextWeekOf(now);
      if (m.weeks.some((w) => w.weekOf === wk && w.briefPublishedAt)) return { run: false, reason: `week ${wk} already published` };
    }
    if (job === 'friday-close') {
      const wk = clock.mondayOf(clock.parts(now, 'America/New_York').date);
      const e = m.weeks.find((w) => w.weekOf === wk);
      if (!e || !e.briefPublishedAt) return { run: false, reason: `no published brief for week ${wk} — nothing to grade` };
      if (e.resultsFrozenAt) return { run: false, reason: `week ${wk} already frozen` };
    }
  }
  return { run: true, reason: opts.force ? 'forced (manual run)' : 'in window' };
}

// ---------------- publish ----------------
async function publish(runDir, now, opts = {}) {
  if (!targetAllowed(opts.branch)) throw new Error(`publishing to ${opts.branch} requires GS_PRODUCTION_APPROVED=yes`);
  const gates = readJSON(path.join(runDir, 'gates.json'));
  const log = readJSON(path.join(runDir, 'run-log.json'));
  if (!gates || !log) throw new Error('run output missing (gates.json / run-log.json)');
  const weekOf = nextWeekOf(now);
  if (gates.briefStatus !== 'ready') {
    const failed = (gates.checks || []).filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    return { published: false, weekOf, reason: `brief ${gates.briefStatus}`, failed };
  }
  const picks = readJSON(path.join(runDir, `picks-preview-${weekOf}.json`));
  const brief = readJSON(path.join(runDir, `brief-preview-${weekOf}.json`));
  if (!picks || !brief) throw new Error(`preview files for week ${weekOf} not found — refusing to publish a different week`);
  if (!picks.picks || !picks.picks.length) return { published: false, weekOf, reason: 'no picks met the bar' };

  // Fresh data: the newest completed bar must be the last session before the publish week.
  const prior = await calendar.lastSessionBefore(weekOf);
  const barsDate = String(log.barsThrough || '').slice(0, 10);
  const etBarsDate = barsDate ? clock.parts(Date.parse(log.barsThrough) + 12 * 3600e3, 'America/New_York').date : '';
  if (prior.last && ![barsDate, etBarsDate].includes(prior.last.date)) {
    throw new Error(`stale data: bars through ${log.barsThrough}, expected last session ${prior.last.date}`);
  }
  const wk = await calendar.week(weekOf);
  if (!wk.sessions.length) return { published: false, weekOf, reason: 'no trading sessions in that week' };

  const m = loadManifest(opts);
  if (m.weeks.some((w) => w.weekOf === weekOf && w.briefPublishedAt)) return { published: false, weekOf, reason: 'already published' };

  const stamp = new Date(now).toISOString();
  const picksOut = { ...picks, status: 'published', briefPublishedAt: stamp, resultsGradeDate: wk.last.date, calendarOfficial: wk.official };
  const briefOut = { ...brief, status: 'published', publishedAt: stamp };
  const files = [`data/picks-${weekOf}.json`, `data/brief-${weekOf}.json`, 'data/weeks.json'];
  writeOnce(dataPath(opts, `picks-${weekOf}.json`), picksOut);
  writeOnce(dataPath(opts, `brief-${weekOf}.json`), briefOut);
  m.weeks = m.weeks.filter((w) => w.weekOf !== weekOf);
  m.weeks.push({ weekOf, briefPublishedAt: stamp, resultsFrozenAt: null, picks: picksOut.picks.length, scoringVersion: picks.scoringVersion, lastSession: wk.last.date });
  writeManifest(opts, m);
  return { published: true, weekOf, files, picks: picksOut.picks.length };
}

// ---------------- freeze ----------------
async function freeze(now, opts = {}) {
  if (!targetAllowed(opts.branch)) throw new Error(`freezing on ${opts.branch} requires GS_PRODUCTION_APPROVED=yes`);
  const weekOf = clock.mondayOf(clock.parts(now, 'America/New_York').date);
  const m = loadManifest(opts);
  const entry = m.weeks.find((w) => w.weekOf === weekOf);
  if (!entry || !entry.briefPublishedAt) return { frozen: false, weekOf, reason: 'no published brief for this week' };
  if (entry.resultsFrozenAt) return { frozen: false, weekOf, reason: 'already frozen' };
  const wk = await calendar.week(weekOf);
  if (!wk.last) return { frozen: false, weekOf, reason: 'no sessions this week' };
  if (now < Date.parse(wk.last.closeUtc) + 20 * 60e3) return { frozen: false, weekOf, reason: `last session (${wk.last.date} ${wk.last.close} ET) not settled yet`, retry: true };

  const base = (opts.scorecardBase || process.env.GS_SCORECARD_BASE || '').replace(/\/$/, '');
  if (!base) throw new Error('GS_SCORECARD_BASE not set (site or branch-preview URL that serves /api/scorecard-v3)');
  const sc = await getJSON(`${base}/api/scorecard-v3?week=${weekOf}`, { timeoutMs: 60000, retries: 2, fetchImpl: opts.fetchImpl });
  const published = readJSON(dataPath(opts, `picks-${weekOf}.json`));
  const problems = [];
  if (!sc || !Array.isArray(sc.picks)) problems.push('scorecard has no picks');
  if (sc && sc.gradingComplete !== true) problems.push('gradingComplete is not true');
  // Known engine flaw: gradingComplete can fire before the SIP clamp covers the
  // close — gate on dataEndClamp reaching the official close of the last session.
  if (sc && !(Date.parse(sc.dataEndClamp) >= Date.parse(wk.last.closeUtc))) problems.push(`dataEndClamp ${sc && sc.dataEndClamp} is before the ${wk.last.date} close`);
  if (published && sc && Array.isArray(sc.picks)) {
    const a = published.picks.map((p) => p.ticker).sort().join(',');
    const b = sc.picks.map((p) => p.ticker).sort().join(',');
    if (a !== b) problems.push('graded tickers do not match the published list');
  }
  if (problems.length) return { frozen: false, weekOf, reason: problems.join('; '), retry: true };

  const stamp = new Date(now).toISOString();
  writeOnce(dataPath(opts, `results-${weekOf}.json`), { ...sc, frozenAt: stamp, lastSession: wk.last.date });
  entry.resultsFrozenAt = stamp;
  writeManifest(opts, m);
  return { frozen: true, weekOf, files: [`data/results-${weekOf}.json`, 'data/weeks.json'], summary: sc.summary || null };
}

// ---------------- health ----------------
async function health(now, opts = {}) {
  const issues = [];
  const ok = [];
  const p = clock.parts(now);
  const cal = await calendar.sessions(clock.addDays(p.date, -7), clock.addDays(p.date, 7));
  if (cal.official) ok.push('trading calendar reachable'); else issues.push(`trading calendar unreachable (${cal.error}) — using weekday fallback`);
  try {
    const q = await require('./providers/finnhub').quote('SPY');
    if (q && q.c > 0) ok.push('Finnhub quote reachable'); else issues.push('Finnhub returned no SPY quote');
  } catch (e) { issues.push(`Finnhub unreachable: ${e.message}`); }

  const m = loadManifest(opts);
  const thisMonday = clock.mondayOf(p.date);
  const thisWeek = await calendar.week(thisMonday);
  const midWeek = p.dow >= 1 && p.dow <= 5 && thisWeek.sessions.length > 0;
  if (midWeek && !m.weeks.some((w) => w.weekOf === thisMonday && w.briefPublishedAt)) {
    const last = m.weeks.filter((w) => w.briefPublishedAt).slice(-1)[0];
    issues.push(`no automated brief was published for the week of ${thisMonday}; the previous verified brief (${last ? last.weekOf : 'none'}) remains on the site`);
  }
  // Results should be frozen by the Saturday-noon catch-up deadline after each week's last session.
  for (const w of m.weeks) {
    if (!w.briefPublishedAt || w.resultsFrozenAt || !w.lastSession) continue;
    const deadline = Date.parse(clock.zonedToUtc(clock.addDays(w.lastSession, 1), '13:00')); // ≈ Sat 12:00 CT
    if (now > deadline) issues.push(`week of ${w.weekOf} was published but its results are not frozen (deadline passed)`);
  }
  return { ok, issues };
}

// ---------------- CLI ----------------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  const runIdx = rest.indexOf('--run');
  const now = process.env.GS_NOW ? Date.parse(process.env.GS_NOW) : Date.now();
  const branch = process.env.GS_PUBLISH_BRANCH || 'automation/dev';
  const runUrl = process.env.GITHUB_RUN_URL || '';
  try {
    if (cmd === 'gate') {
      const g = gate(rest[0], now, { force });
      output('run', g.run ? 'true' : 'false');
      console.log(`gate ${rest[0]}: ${g.reason}`);
    } else if (cmd === 'publish') {
      const r = await publish(rest[runIdx + 1], now, { branch });
      console.log(JSON.stringify(r));
      output('files', r.published ? r.files.join(' ') : '');
      output('weekOf', r.weekOf);
      if (!r.published && r.reason !== 'already published') {
        await alert.send(`Brief NOT published — week of ${r.weekOf}`, `Reason: ${r.reason}\n${(r.failed || []).slice(0, 15).map((x) => `- ${x}`).join('\n')}\n\nThe previous verified briefing stays on the site with its original date. Nothing unverified was published.\n${runUrl}`);
      }
    } else if (cmd === 'freeze') {
      const r = await freeze(now, { branch });
      console.log(JSON.stringify(r));
      output('files', r.frozen ? r.files.join(' ') : '');
      output('weekOf', r.weekOf);
      const p = clock.parts(now);
      const pastDeadline = p.dow === 6 && p.hour >= 11; // last catch-up slot
      if (!r.frozen && r.retry && pastDeadline) {
        await alert.send(`Friday results NOT frozen — week of ${r.weekOf}`, `Reason: ${r.reason}\nNo results were written; nothing was overwritten.\n${runUrl}`);
      }
    } else if (cmd === 'health') {
      const r = await health(now);
      console.log(JSON.stringify(r, null, 1));
      if (r.issues.length) await alert.send(`Health check: ${r.issues.length} issue(s)`, r.issues.map((x) => `- ${x}`).join('\n') + `\n\nOK: ${r.ok.join(', ')}\n${runUrl}`);
    } else if (cmd === 'alert') {
      await alert.send(rest[0] || 'Automation alert', rest[1] || runUrl);
    } else {
      console.error('usage: schedule.js gate|publish|freeze|health|alert');
      process.exit(2);
    }
  } catch (e) {
    console.error(`[schedule] ${cmd} failed: ${e.message}`);
    await alert.send(`Automation step failed: ${cmd}`, `${e.message}\nNo published or frozen file was overwritten.\n${runUrl}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { gate, publish, freeze, health, inWindow, JOBS, targetAllowed };
