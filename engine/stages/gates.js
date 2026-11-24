// engine/stages/gates.js
// Safety gates. Nothing publishes unless every gate passes. Pure functions
// except priceCrossCheck (one Finnhub quote per pick).

'use strict';

const cfg = require('../config');

const DAY = 86400000;

// ---------- data gates ----------
function dataGates(preview, meta, now) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail || null });

  const asOf = Date.parse(meta.barsThrough);
  add('data_fresh', isFinite(asOf) && now - asOf <= cfg.gates.maxDataAgeDays * DAY, `bars through ${meta.barsThrough}`);

  const p1 = preview.picks.filter((p) => p.tier === 1).length;
  const p2 = preview.picks.filter((p) => p.tier === 2).length;
  add('pick_limits', p1 <= cfg.selection.maxPrimary && p2 <= cfg.selection.maxWatchlist, `${p1} primary, ${p2} watchlist`);
  add('unique_tickers', new Set(preview.picks.map((p) => p.ticker)).size === preview.picks.length);

  for (const p of preview.picks) {
    const need = ['ticker', 'priceAtPublish', 'zones', 'firstTarget', 'invalidationLevel', 'convictionScore', 'entryScore', 'riskClass', 'riskReward'];
    const missing = need.filter((k) => p[k] == null);
    const z = p.zones || [];
    const ordered = z.length === 2 && p.invalidationLevel < z[1].price && z[1].price < z[0].price && z[0].price < p.priceAtPublish && p.priceAtPublish < p.firstTarget;
    add(`pick_complete:${p.ticker}`, !missing.length, missing.length ? `missing ${missing.join(',')}` : null);
    add(`pick_levels_ordered:${p.ticker}`, ordered);
    add(`pick_scores_in_range:${p.ticker}`, [p.convictionScore, p.entryScore].every((x) => x >= 0 && x <= 100));
  }
  return checks;
}

// Second-source price check: each pick's publish price must agree with
// Finnhub's last or previous close within tolerance.
async function priceCrossCheck(preview, finnhub) {
  const checks = [];
  for (const p of preview.picks) {
    try {
      const q = await finnhub.quote(p.ticker);
      const refs = [q.c, q.pc].filter((x) => x > 0);
      const diff = refs.length ? Math.min(...refs.map((r) => Math.abs(r - p.priceAtPublish) / r * 100)) : null;
      checks.push({ name: `price_cross_check:${p.ticker}`, pass: diff != null && diff <= cfg.gates.maxPriceDiffPct, detail: diff == null ? 'no second-source quote' : `diff ${diff.toFixed(2)}% vs Finnhub` });
    } catch (e) {
      checks.push({ name: `price_cross_check:${p.ticker}`, pass: false, detail: `second source unavailable: ${e.message}` });
    }
  }
  return checks;
}

// ---------- narrative gates ----------
// Every number written by the model must exist in the verified fact sheet.
function collectNumbers(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'number' && isFinite(obj)) out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => collectNumbers(v, out));
  else if (typeof obj === 'object') Object.entries(obj).forEach(([k, v]) => { if (k !== 'untrustedHeadlines') collectNumbers(v, out); });
  else if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj)) {
    const [y, m, d] = obj.split('-').map(Number);
    out.push(y, m, d);
  }
  return out;
}

function numbersInText(text) {
  const found = [];
  const re = /(\$?)(\d[\d,]*(?:\.\d+)?)(\s?%)?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    found.push({ raw: m[0].trim(), value: Number(m[2].replace(/,/g, '')), dollar: Boolean(m[1]), pct: Boolean(m[3]), decimal: m[2].includes('.') });
  }
  return found;
}

function unverifiedNumbers(text, facts) {
  const known = collectNumbers(facts);
  const bad = [];
  for (const n of numbersInText(text)) {
    const plainSmall = !n.dollar && !n.pct && !n.decimal && n.value <= 31; // dates, counts, Q1–Q4
    const year = !n.dollar && !n.pct && !n.decimal && n.value >= 2020 && n.value <= 2035;
    if (plainSmall || year) continue;
    // Compare magnitudes: the text writes "down 4.3%" for a fact of -4.3.
    const ok = known.some((k) => Math.abs(Math.abs(k) - n.value) <= Math.max(0.006, Math.abs(k) * 0.001));
    if (!ok) bad.push(n.raw);
  }
  return bad;
}

const BANNED = [
  [/\bguarantee(d|s)?\b|\brisk[- ]free\b|can'?t lose|sure thing|will (definitely|certainly) (rise|rally|go up)/i, 'promissory_language'],
  [/\b(I|we) (bought|own|hold|added|sold|am buying|are buying)\b|\bmy (position|portfolio|shares)\b|\bour (position|portfolio)\b/i, 'personal_trade_language'],
  [/\byou should (buy|sell)\b|\bbuy (it )?now\b/i, 'directive_advice'],
  [/<\s*script|javascript:|on\w+\s*=/i, 'markup_injection'],
];

function narrativeGates(label, text, facts) {
  const checks = [];
  const bad = unverifiedNumbers(text, facts);
  checks.push({ name: `narrative_numbers_verified:${label}`, pass: bad.length === 0, detail: bad.length ? `unverified: ${bad.slice(0, 6).join(', ')}` : null });
  for (const [re, why] of BANNED) {
    if (re.test(text)) checks.push({ name: `narrative_${why}:${label}`, pass: false, detail: (String(text).match(re) || [])[0] });
  }
  checks.push({ name: `narrative_length:${label}`, pass: String(text).length >= 40 && String(text).length <= cfg.narrative.maxCharsPerField * 4 });
  return checks;
}

module.exports = { dataGates, priceCrossCheck, narrativeGates, unverifiedNumbers, numbersInText };
