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

// Shareholder-solicitation press releases from plaintiff law firms
// ("Ademi LLP Investigates Proposed Acquisition of Insmed", "SHAREHOLDER
// ALERT: Rosen Law Firm reminds investors of class action deadline"). They are
// advertising, not news, so they are dropped before counting, tagging and
// display. Substantive legal and regulatory news (an SEC charge, a court
// ruling, an FTC suit, a DOJ probe) has no law-firm sponsor and is kept.
const LAW_FIRM = /\b(LLP|L\.L\.P\.|P\.C\.|PLLC|Law Firm|Law Offices?|Law Group|Attorneys? at Law|Rosen Law|Pomerantz|Levi & Korsinsky|Bragar Eagel|Kahn Swick|Halper Sadeh|Ademi|Bronstein, Gewirtz|Faruqi|Glancy Prongay|Robbins Geller|Schall Law|Gross Law|Kirby McInerney|Johnson Fistel|Monteverde|Rigrodsky|Wohl & Fruchter|Block & Leviton|Bernstein Liebhard|Kessler Topaz|Portnoy Law|Howard G\. Smith|Frank R\. Cruz|Holzer & Holzer|Hagens Berman|Brodsky & Smith|Rowley Law|Lowey Dannenberg|Edelson Lechtzin|Scott\+Scott|Bernstein Litowitz|Labaton|Saxena White|Weiss Law|Zhang Investor Law|DJS Law|Lieff Cabraser|Pomerantz Law)\b/i;
const SOLICIT = /\b(investigat\w*|class action|lead plaintiff|deadline|reminds?|encourag\w*|urg\w*|alert|on behalf of|have you (lost|suffered)|losses|shareholders? (rights|of)|investors? (who|in|of))\b/i;
// Rewritten summaries of the same solicitations, without the firm's name:
// "Law Firms Investigate Fairness of Zscaler Acquisition by CrowdStrike",
// "Advantage Energy Ltd. Subject of Investigation Regarding Acquisition by …".
const REWRITTEN = /\blaw\s+firms?\b[^.]*\binvestigat\w*|\bsubject\s+of\s+(?:an?\s+)?investigation\s+regarding\s+(?:the\s+)?(?:proposed\s+)?(?:acquisition|merger|sale|buyout|takeover)|\binvestigat\w*\s+(?:the\s+)?fairness\s+of\b/i;
const ALWAYS = /\b(shareholder|investor|stockholder)s?\s+alert\b|\blead[- ]plaintiff deadline\b|\bclass action (lawsuit )?(filed|reminder)\b.*\b(investors|shareholders)\b/i;
function isLawFirmSolicitation(headline) {
  const h = String(headline || '');
  return ALWAYS.test(h) || REWRITTEN.test(h) || (LAW_FIRM.test(h) && SOLICIT.test(h));
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
    if (isLawFirmSolicitation(a.headline)) continue;
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

module.exports = { attention, tagHeadline, isLawFirmSolicitation };
