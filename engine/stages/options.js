// engine/stages/options.js
// Prior-session options activity for a stock: call vs put volume and volume
// relative to open interest. Only bars dated to the last completed session are
// used; anything else is reported as unavailable — never estimated.
'use strict';

const OCC = /([CP])(\d{8})$/;

function sessionBar(snap, sessionDate) {
  for (const k of ['dailyBar', 'prevDailyBar']) {
    const b = snap && snap[k];
    if (b && typeof b.t === 'string' && b.t.slice(0, 10) === sessionDate) return b;
  }
  return null;
}

// Pure: summarise snapshots + contracts into verified activity numbers.
function summarize(snapshots, contracts, sessionDate, cfg) {
  let callVol = 0, putVol = 0, matched = 0;
  for (const [sym, snap] of Object.entries(snapshots || {})) {
    const m = OCC.exec(sym);
    if (!m) continue;
    const b = sessionBar(snap, sessionDate);
    if (!b || !(b.v >= 0)) continue;
    matched++;
    if (m[1] === 'C') callVol += b.v; else putVol += b.v;
  }
  let callOI = 0, putOI = 0;
  for (const c of contracts || []) {
    const oi = Number(c.open_interest);
    if (!(oi >= 0)) continue;
    if (c.type === 'call') callOI += oi; else if (c.type === 'put') putOI += oi;
  }
  const total = callVol + putVol;
  if (!matched || total < cfg.minTotalVolume) {
    return { available: false, reason: matched ? `prior-session option volume below ${cfg.minTotalVolume} contracts` : 'no option bars dated to the last session', sessionDate };
  }
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);
  const callPutRatio = putVol ? callVol / putVol : null;
  const callVolToOI = callOI ? callVol / callOI : null;
  const putVolToOI = putOI ? putVol / putOI : null;
  let unusual = null;
  if (callPutRatio != null && callPutRatio >= cfg.unusualRatio && (callVolToOI == null || callVolToOI >= 0.1)) unusual = 'calls';
  else if (callPutRatio != null && callPutRatio <= 1 / cfg.unusualRatio && (putVolToOI == null || putVolToOI >= 0.1)) unusual = 'puts';
  return {
    available: true, sessionDate, callVolume: callVol, putVolume: putVol, callPutRatio: r2(callPutRatio),
    callVolToOI: r2(callVolToOI), putVolToOI: r2(putVolToOI), openInterestAvailable: callOI + putOI > 0, unusual,
  };
}

// 0–100 bullish options component (null when unavailable).
function score(o) {
  if (!o || !o.available || o.callPutRatio == null) return null;
  let s = 50 + 20 * Math.max(-2, Math.min(2, Math.log2(o.callPutRatio)));
  if (o.callVolToOI != null) s += Math.min(10, o.callVolToOI * 20);
  return Math.max(0, Math.min(100, s));
}

module.exports = { summarize, score, sessionBar };
