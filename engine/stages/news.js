// engine/stages/news.js
// News attention and headline catalyst tagging. Deterministic counting only.
// Headlines are untrusted third-party text: they are counted, tagged and
// stored as data — never executed, never treated as instructions.

'use strict';

const cfg = require('../config');

const DAY = 86400000;

function tagHeadline(text) {
  const pos = [];
  const neg = [];
  for (const [k, re] of Object.entries(cfg.catalystTags.positive)) if (re.test(text)) pos.push(k);
  for (const [k, re] of Object.entries(cfg.catalystTags.negative)) if (re.test(text)) neg.push(k);
  return { pos, neg };
}

// articles: [{headline, createdAt, symbols[], source, url}]
// Returns (recent = last cfg.news.recentDays days) { SYM: { recentCount, newsPrior, surge, tagsPos, tagsNeg, headlines[] } }
function attention(articles, universeSymbols, now = Date.now()) {
  const uni = new Set(universeSymbols);
  const recentCut = now - cfg.news.recentDays * DAY;
  const priorDays = cfg.news.windowDays - cfg.news.recentDays;
  const out = {};
  const seen = new Set();
  for (const a of articles) {
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    const at = new Date(a.createdAt).getTime();
    if (!isFinite(at)) continue;
    // Articles tagging many tickers (market wraps) carry less signal per name.
    const syms = (a.symbols || []).filter((s) => uni.has(s));
    if (!syms.length) continue;
    const w = 1 / Math.sqrt(Math.max(1, (a.symbols || []).length));
    const tags = at >= recentCut ? tagHeadline(a.headline || '') : null;
    for (const s of syms) {
      const row = out[s] || (out[s] = { recentCount: 0, newsPrior: 0, recentWeighted: 0, tagsPos: {}, tagsNeg: {}, headlines: [] });
      if (at >= recentCut) {
        row.recentCount++;
        row.recentWeighted += w;
        for (const t of tags.pos) row.tagsPos[t] = (row.tagsPos[t] || 0) + 1;
        for (const t of tags.neg) row.tagsNeg[t] = (row.tagsNeg[t] || 0) + 1;
        if (row.headlines.length < cfg.news.keepHeadlines) {
          row.headlines.push({ headline: a.headline, source: a.source, url: a.url, createdAt: a.createdAt, tagsPos: tags.pos, tagsNeg: tags.neg });
        }
      } else {
        row.newsPrior++;
      }
    }
  }
  for (const row of Object.values(out)) {
    const baselinePerWindow = (row.newsPrior / priorDays) * cfg.news.recentDays; // baseline scaled to the recent window
    // Surge: recent window vs the prior baseline pace, smoothed so 1 → 3 articles
    // doesn't read like a 300% event.
    row.surge = Math.round(((row.recentCount + 2) / (baselinePerWindow + 2)) * 100) / 100;
    row.recentWeighted = Math.round(row.recentWeighted * 100) / 100;
  }
  return out;
}

module.exports = { attention, tagHeadline };
