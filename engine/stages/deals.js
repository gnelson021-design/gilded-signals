// engine/stages/deals.js
// Confirmed, pending buyouts — companies being acquired under a signed deal.
//
// A company is excluded from the Daily Top 20 only when a dated headline in
// the news window states a definitive deal in which IT is the target
// ("Sanofi to acquire Insmed", "Insmed agrees to be acquired by Sanofi",
// "definitive agreement to acquire Insmed"). Its price then tracks the deal
// terms, not momentum. Rumours and early-stage reports ("in talks",
// "exploring a sale", "reportedly", "weighs an offer") never exclude.
// A later headline that the deal was terminated or blocked cancels the
// exclusion. Acquirers are never excluded.
//
// Headlines are untrusted third-party text: matched as data only.
'use strict';

const DEAL_VERB = '(?:acquire|buy|purchase|take\\s+private)';
const DEFINITIVE_LEAD = '(?:to|will|agrees?\\s+to|agreed\\s+to|signs?\\s+(?:a\\s+)?(?:definitive\\s+)?(?:merger\\s+)?agreement\\s+to|enters?\\s+(?:into\\s+)?(?:a\\s+)?definitive\\s+(?:merger\\s+)?agreement\\s+to|completes?|completed)';
const RUMOR = /\b(intent|intends?|plans?\s+to|non-binding|letter\s+of\s+intent|reportedly|reports?|reported|rumou?rs?|rumou?red|talks?|nears?|exploring|explores?|considers?|considering|weighs?|weighing|mulls?|mulling|approach(?:ed|es)?|sources|could|may|might|possible|potential|said\s+to|seeks?|seeking|eyes?|eyeing|interest\s+in|unsolicited|propos(?:al|es|ed)|bid\s+for|makes?\s+(?:an?\s+)?offer|investigat\w*|\?)/i;
const TERMINATED = /\b(terminat\w*|call(?:s|ed)?\s+off|abandon\w*|walks?\s+away|walked\s+away|scrap(?:s|ped)?|collaps\w*|block(?:s|ed)?|ends?\s+(?:merger|deal|agreement)|no\s+longer)\b/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// After the target's name, a whole-company deal reads "…acquire Insmed for $41B",
// "…acquire Zscaler in a $43.9B deal", "…acquire Insmed Incorporated", or ends.
// "…acquire MetLife's UK business", "…acquire Lantheus' CDMO unit" (a division)
// and "…acquire six Boeing CH-47 helicopters" (products) do not.
const NOT_POSSESSIVE = "(?![’'])";
const CORP_SUFFIX = '(?:,?\\s+(?:Inc\\.?|Incorporated|Corp\\.?|Corporation|Holdings|Ltd\\.?|Limited|plc|Co\\.|N\\.V\\.|S\\.A\\.))?';
const OBJECT_END = `${NOT_POSSESSIVE}${CORP_SUFFIX}(?=\\s*$|\\s*[,.;:!?(—–]|\\s+-\\s|\\s+(?:for|in|at|from|with|and|to|via|after|amid|as|by|on|under|valued|worth|including)\\b)`;

// "Insmed Incorporated Common Stock" → "Insmed"; keeps multi-word names ("Dollar Tree").
function shortName(name) {
  let s = String(name || '').replace(/\s+Common Stock\s*$/i, '').trim();
  const SUFFIX = /[,\s]+(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|Holdings?|Group|Ltd\.?|Limited|plc|N\.V\.|S\.A\.|L\.P\.|LLC|Class\s+[A-Z]|Ordinary\s+Shares|American\s+Depositary\s+Shares.*)\s*$/i;
  for (let i = 0; i < 4 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, '').trim();
  return s.length >= 3 ? s : null;
}

function aliasPattern(symbol, name) {
  const parts = [`\\(?(?:NASDAQ|NYSE|AMEX|NYSE\\s*American)?:?\\s*${esc(symbol)}\\)?`];
  const sn = shortName(name);
  if (sn) parts.push(esc(sn)); // case-sensitive: company names are capitalised
  return `(?:${parts.join('|')})`;
}

// Is this headline a confirmed deal in which `symbol` is the target?
function confirmsTarget(headline, symbol, name) {
  const h = String(headline || '');
  if (!h || RUMOR.test(h) || TERMINATED.test(h)) return false;
  const X = aliasPattern(symbol, name);
  const tests = [
    // "<Acquirer> to acquire / agrees to buy / completes acquisition of <Target>"
    new RegExp(`\\b${DEFINITIVE_LEAD}\\s+(?:its\\s+)?(?:${DEAL_VERB}|acquisition\\s+of)\\s+(?:\\S+\\s+){0,2}?${X}(?![\\w-])${OBJECT_END}`, 'i'),
    // "definitive agreement to acquire <Target>" / "merger agreement with <Target>"
    new RegExp(`\\bdefinitive\\s+(?:merger\\s+)?agreement\\s+(?:to\\s+${DEAL_VERB}|with)\\s+(?:\\S+\\s+){0,2}?${X}(?![\\w-])${OBJECT_END}`, 'i'),
    // "<Target> to be acquired by / agrees to be acquired / agrees to sale to"
    new RegExp(`(?<![\\w-])${X}${NOT_POSSESSIVE}\\b[^.;:]{0,60}?\\b(?:to\\s+be\\s+(?:acquired|bought|taken\\s+private)|agrees?\\s+to\\s+be\\s+(?:acquired|bought|taken\\s+private)|agreed\\s+to\\s+be\\s+(?:acquired|bought)|(?:agrees?|agreed)\\s+to\\s+(?:an?\\s+)?(?:\\$[\\d.,]+\\s*(?:billion|bln|bn|million|mln|m)?\\s+)?(?:sale|buyout|takeover)(?!\\s+of\\b))\\b`, 'i'),
  ];
  if (!tests.some((re) => re.test(h))) return false;
  // Matching is case-insensitive for the deal wording; the company itself must
  // appear exactly as named (capitalised) or by its uppercase ticker, so a
  // name that is also a common word ("Target") cannot match in lower case.
  const sn = shortName(name);
  return new RegExp(`(?<![\\w-])${esc(symbol)}(?![\\w-])`).test(h) || (sn != null && h.includes(sn));
}

function terminates(headline, symbol, name) {
  const h = String(headline || '');
  if (!TERMINATED.test(h)) return false;
  return new RegExp(`(?<![\\w-])${aliasPattern(symbol, name)}(?![\\w-])`).test(h) && /\b(merger|deal|acquisition|agreement|takeover|buyout)\b/i.test(h);
}

// articles: [{headline, createdAt, symbols[], source, url}] (law-firm releases already removed)
// rows: [{symbol, name}]
// Returns { SYM: { headline, date, source, url } } for confirmed pending buyouts.
function pendingBuyouts(articles, rows) {
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const hits = {};
  const sorted = articles.filter((a) => a && a.headline && a.createdAt).slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const a of sorted) {
    for (const s of a.symbols || []) {
      const r = bySym.get(s);
      if (!r) continue;
      if (confirmsTarget(a.headline, r.symbol, r.name)) {
        hits[s] = { headline: a.headline, date: String(a.createdAt).slice(0, 10), publishedAt: a.createdAt, source: a.source || null, url: a.url || null };
      } else if (hits[s] && terminates(a.headline, r.symbol, r.name)) {
        delete hits[s];
      }
    }
  }
  return hits;
}

module.exports = { pendingBuyouts, confirmsTarget, terminates, shortName };
