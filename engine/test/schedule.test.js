// engine/test/schedule.test.js — Build 4 scheduler: windows, DST, holidays,
// write-once publishing and freezing, approval gate, health checks.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./mock');
const http = require('../lib/http'); for (const k of Object.keys(http.HOST_SPACING)) http.HOST_SPACING[k] = 0;
const S = require('../schedule');

const T = (iso) => Date.parse(iso);
function tmpRoot() { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sched-')); fs.mkdirSync(path.join(r, 'data')); return r; }
function runDir(status = 'ready', barsThrough = '2026-11-27T05:00:00Z', week = '2026-11-30') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-run-'));
  const w = (f, o) => fs.writeFileSync(path.join(d, f), JSON.stringify(o));
  w('gates.json', { briefStatus: status, checks: status === 'ready' ? [{ name: 'x', pass: true }] : [{ name: 'narrative_key_present', pass: false, detail: 'no key' }] });
  w('run-log.json', { barsThrough });
  w(`picks-preview-${week}.json`, { weekOf: week, scoringVersion: 's3-shadow', methodologyVersion: 'v3-target-invalidation', picks: [{ rank: 1, ticker: 'AAA', zones: [{ price: 98, weight: 0.6 }, { price: 95, weight: 0.4 }], firstTarget: 103, invalidationLevel: 92 }, { rank: 2, ticker: 'BBB', zones: [{ price: 48, weight: 0.6 }, { price: 46, weight: 0.4 }], firstTarget: 52, invalidationLevel: 44 }] });
  w(`brief-preview-${week}.json`, { weekOf: week, lead: 'x', picks: {} });
  return d;
}

test('gate: Central Time windows across CST and CDT, other DST slot skipped', () => {
  const opts = { root: tmpRoot() };
  assert.strictEqual(S.gate('sunday-publish', T('2026-11-30T00:00:00Z'), opts).run, true, 'Sun 18:00 CST');
  assert.strictEqual(S.gate('sunday-publish', T('2026-11-29T23:00:00Z'), opts).run, false, 'Sun 17:00 CST is the CDT slot');
  assert.strictEqual(S.gate('sunday-publish', T('2026-06-28T23:00:00Z'), opts).run, true, 'Sun 18:00 CDT');
  assert.strictEqual(S.gate('sunday-publish', T('2026-11-30T13:00:00Z'), opts).run, true, 'Mon 07:00 CST catch-up');
  assert.strictEqual(S.gate('saturday', T('2026-11-28T15:00:00Z'), opts).run, true, 'Sat 09:00 CST');
  assert.strictEqual(S.gate('saturday', T('2026-11-28T14:00:00Z'), opts).run, false, 'Sat 08:00 CST');
  assert.strictEqual(S.gate('sunday-validate', T('2026-11-29T21:00:00Z'), opts).run, true, 'Sun 15:00 CST');
  assert.strictEqual(S.gate('saturday', T('2026-11-25T10:00:00Z'), { ...opts, force: true }).run, true, 'manual force');
});

test('gate: friday-close needs a published, unfrozen week; publish skips an already-published week', () => {
  const root = tmpRoot();
  const fri = T('2026-11-27T22:00:00Z');
  assert.strictEqual(S.gate('friday-close', fri, { root }).run, false, 'nothing published');
  fs.writeFileSync(path.join(root, 'data/weeks.json'), JSON.stringify({ weeks: [{ weekOf: '2026-11-23', briefPublishedAt: 'x', resultsFrozenAt: null }, { weekOf: '2026-11-30', briefPublishedAt: 'y' }] }));
  assert.strictEqual(S.gate('friday-close', fri, { root }).run, true);
  assert.strictEqual(S.gate('sunday-publish', T('2026-11-30T00:00:00Z'), { root }).run, false, 'already published');
});

test('publish: READY brief is written once, manifest updated, holiday week graded on its last session', async () => {
  const root = tmpRoot();
  const now = T('2026-11-30T00:05:00Z');
  const r = await S.publish(runDir(), now, { root, branch: 'automation/dev' });
  assert.strictEqual(r.published, true);
  assert.deepStrictEqual(r.files, ['data/picks-2026-11-30.json', 'data/brief-2026-11-30.json', 'data/weeks.json']);
  const picks = JSON.parse(fs.readFileSync(path.join(root, 'data/picks-2026-11-30.json')));
  assert.strictEqual(picks.status, 'published');
  assert.strictEqual(picks.resultsGradeDate, '2026-12-04');
  const before = fs.readFileSync(path.join(root, 'data/picks-2026-11-30.json'), 'utf8');
  const again = await S.publish(runDir(), now, { root, branch: 'automation/dev' });
  assert.strictEqual(again.published, false);
  assert.strictEqual(fs.readFileSync(path.join(root, 'data/picks-2026-11-30.json'), 'utf8'), before, 'never overwritten');
});

test('publish: held brief, stale data, and unapproved production are all refused', async () => {
  const root = tmpRoot();
  const now = T('2026-11-30T00:05:00Z');
  const held = await S.publish(runDir('held'), now, { root, branch: 'automation/dev' });
  assert.strictEqual(held.published, false);
  assert.ok(held.failed.some((f) => f.includes('narrative_key_present')));
  assert.ok(!fs.existsSync(path.join(root, 'data/picks-2026-11-30.json')), 'nothing written when held');
  await assert.rejects(S.publish(runDir('ready', '2026-11-25T05:00:00Z'), now, { root, branch: 'automation/dev' }), /stale data/);
  delete process.env.GS_PRODUCTION_APPROVED;
  await assert.rejects(S.publish(runDir(), now, { root, branch: 'main' }), /GS_PRODUCTION_APPROVED/);
});

test('freeze: waits for the early close + dataEndClamp, matches tickers, writes once', async () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'data/weeks.json'), JSON.stringify({ weeks: [{ weekOf: '2026-11-23', briefPublishedAt: 'x', resultsFrozenAt: null, lastSession: '2026-11-27' }] }));
  fs.writeFileSync(path.join(root, 'data/picks-2026-11-23.json'), JSON.stringify({ picks: [{ ticker: 'AAA' }, { ticker: 'BBB' }] }));
  const sc = (over = {}) => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ gradingComplete: true, dataEndClamp: '2026-11-27T18:05:00Z', summary: { totalPublished: 2 }, picks: [{ ticker: 'AAA' }, { ticker: 'BBB' }], ...over }) });
  const o = (f) => ({ root, branch: 'automation/dev', scorecardBase: 'https://preview.example', fetchImpl: f });
  const early = await S.freeze(T('2026-11-27T17:30:00Z'), o(sc()));
  assert.strictEqual(early.frozen, false); assert.ok(/not settled/.test(early.reason), '1 PM ET early close respected');
  const clamp = await S.freeze(T('2026-11-27T22:00:00Z'), o(sc({ dataEndClamp: '2026-11-27T17:00:00Z' })));
  assert.strictEqual(clamp.frozen, false); assert.ok(/dataEndClamp/.test(clamp.reason));
  const mismatch = await S.freeze(T('2026-11-27T22:00:00Z'), o(sc({ picks: [{ ticker: 'AAA' }] })));
  assert.strictEqual(mismatch.frozen, false);
  const good = await S.freeze(T('2026-11-27T22:00:00Z'), o(sc()));
  assert.strictEqual(good.frozen, true);
  assert.ok(fs.existsSync(path.join(root, 'data/results-2026-11-23.json')));
  const m = JSON.parse(fs.readFileSync(path.join(root, 'data/weeks.json')));
  assert.ok(m.weeks[0].resultsFrozenAt);
  const again = await S.freeze(T('2026-11-28T15:00:00Z'), o(sc()));
  assert.strictEqual(again.frozen, false); assert.strictEqual(again.reason, 'already frozen');
});

test('health: flags a missed weekly brief and an unfrozen week past its deadline', async () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'data/weeks.json'), JSON.stringify({ weeks: [{ weekOf: '2026-11-23', briefPublishedAt: 'x', resultsFrozenAt: null, lastSession: '2026-11-27' }] }));
  const cwd = process.cwd(); process.chdir(root);
  try {
    const r = await S.health(T('2026-12-01T13:15:00Z'));
    assert.ok(r.issues.some((i) => /no automated brief was published for the week of 2026-11-30/.test(i)));
    assert.ok(r.issues.some((i) => /2026-11-23 was published but its results are not frozen/.test(i)));
    assert.ok(r.ok.includes('trading calendar reachable'));
  } finally { process.chdir(cwd); }
});
