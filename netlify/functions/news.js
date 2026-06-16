'use strict';

// Gilded Signals — live news function (Finnhub-backed).
// Categories derived from documented Finnhub feeds only (general/crypto/forex)
// with keyword relevance + fallbacks so a page is never blank. 10-min cache.

const FH = process.env.FINNHUB_API_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const TTL = 600000; // 10 minutes

const rawCache = new Map(); // finnhub base category -> { ts, data }
const outCache = new Map(); // our cat -> { ts, data }

async function getBase(fhCat) {
  const now = Date.now();
  const hit = rawCache.get(fhCat);
  if (hit && now - hit.ts < TTL) return hit.data;
  const url = `https://finnhub.io/api/v1/news?category=${fhCat}&token=${FH}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('Bad response from Finnhub');
  rawCache.set(fhCat, { ts: now, data });
  return data;
}

function shape(arr, cat, label) {
  return arr.map((n) => ({
    source: n.source || 'Finnhub',
    headline: n.headline || '',
    summary: (n.summary || '').replace(/<[^>]*>/g, '').trim(),
    url: n.url || '#',
    time: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
    cat: cat,
    catLabel: label,
    image: n.image || null,
  }));
}

const AI_RE = [
  /\bnvidia\b/, /\bnvda\b/, /semiconductor/, /\bchip(s|maker|makers)?\b/, /\bgpu\b/,
  /artificial intelligence/, /\ba\.?i\.?\b/, /data ?cent(er|re)/, /openai/, /\btsmc\b/,
  /\basml\b/, /broadcom/, /\bamd\b/, /micron/, /foundry/, /\bllm\b/, /machine learning/,
  /supermicro/, /generative/, /\bavgo\b/, /\bmrvl\b/, /chatgpt/,
];
const WORLD_RE = [
  /\bfed\b/, /federal reserve/, /interest rate/, /rate (cut|hike)/, /inflation/, /tariff/,
  /\bchina\b/, /\bopec\b/, /crude/, /oil price/, /geopolit/, /sanction/, /election/,
  /\bgdp\b/, /central bank/, /\becb\b/, /\bwar\b/, /trade deal/, /recession/, /treasury yield/,
  /jobs report/, /unemployment/, /middle east/, /ukraine/, /tax/,
];
const EARN_RE = [
  /earnings/, /revenue/, /\bprofit\b/, /quarterly/, /\beps\b/, /guidance/, /beat(s)? estimates/,
  /miss(ed|es)? estimates/, /\bforecast\b/, /\boutlook\b/, /reported (a )?loss/, /quarter results/,
  /full-year/, /\bq[1-4]\b/,
];

function kwFilter(arr, res) {
  return arr.filter((n) => {
    const s = ((n.headline || '') + ' ' + (n.summary || '')).toLowerCase();
    return res.some((re) => re.test(s));
  });
}

async function build(cat) {
  switch (cat) {
    case 'crypto':
      return shape((await getBase('crypto')).slice(0, 20), 'crypto', 'Crypto');
    case 'econ':
      return shape((await getBase('forex')).slice(0, 20), 'econ', 'Economy');
    case 'market':
      return shape((await getBase('general')).slice(0, 24), 'market', 'Market');
    case 'all': {
      const [gen, cry, fx] = await Promise.all([getBase('general'), getBase('crypto'), getBase('forex')]);
      const ai    = shape(kwFilter(gen, AI_RE).slice(0, 6), 'ai', 'AI & Infra');
      const world = shape(kwFilter(gen, WORLD_RE).slice(0, 6), 'world', 'World');
      const earn  = shape(kwFilter(gen, EARN_RE).slice(0, 6), 'earnings', 'Earnings');
      const market= shape(gen.slice(0, 10), 'market', 'Market');
      const crypto= shape(cry.slice(0, 6), 'crypto', 'Crypto');
      const econ  = shape(fx.slice(0, 6), 'econ', 'Economy');
      const merged = [...market, ...ai, ...world, ...earn, ...crypto, ...econ];
      merged.sort((a, b) => new Date(b.time) - new Date(a.time));
      const seen = new Set();
      return merged.filter(n => { if (seen.has(n.headline)) return false; seen.add(n.headline); return true; });
    }
    case 'ai': {
      const gen = await getBase('general');
      let f = kwFilter(gen, AI_RE);
      if (f.length < 6) f = gen;
      return shape(f.slice(0, 20), 'ai', 'AI & Infra');
    }
    case 'world': {
      const gen = await getBase('general');
      let f = kwFilter(gen, WORLD_RE);
      if (f.length < 6) f = gen;
      return shape(f.slice(0, 20), 'world', 'World');
    }
    case 'earnings': {
      const gen = await getBase('general');
      let f = kwFilter(gen, EARN_RE);
      if (f.length < 6) f = gen;
      return shape(f.slice(0, 20), 'earnings', 'Earnings');
    }
    default:
      return shape((await getBase('general')).slice(0, 20), 'market', 'Market');
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const cat = ((event.queryStringParameters && event.queryStringParameters.cat) || 'market').toLowerCase();
  const now = Date.now();
  const hit = outCache.get(cat);
  if (hit && now - hit.ts < TTL) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(hit.data) };
  }
  try {
    if (!FH) throw new Error('FINNHUB_API_KEY not set');
    const articles = await build(cat);
    outCache.set(cat, { ts: now, data: articles });
    return { statusCode: 200, headers: CORS, body: JSON.stringify(articles) };
  } catch (err) {
    if (hit) return { statusCode: 200, headers: CORS, body: JSON.stringify(hit.data) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
