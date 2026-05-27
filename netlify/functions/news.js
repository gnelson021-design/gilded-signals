'use strict';
/**
 * Gilded Signals — /api/news
 * Pulls real financial news from Finnhub (primary) or NewsAPI (fallback).
 * Cache: 90 seconds.
 *
 * Env vars needed (one or both):
 *   FINNHUB_API_KEY   — finnhub.io free tier
 *   NEWS_API_KEY      — newsapi.org free tier (dev only; prod needs paid plan)
 */

const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

const cache = new Map();
const TTL = 90_000;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// ── Finnhub ──────────────────────────────────────────────────────────────────
async function fetchFinnhub() {
  const categories = [
    { id: 'general',  cat: 'market',   label: 'Market'      },
    { id: 'crypto',   cat: 'crypto',   label: 'Crypto'      },
    { id: 'merger',   cat: 'earnings', label: 'Earnings'    },
    { id: 'forex',    cat: 'econ',     label: 'Economy'     },
  ];

  const results = await Promise.all(
    categories.map(({ id, cat, label }) =>
      fetch(`https://finnhub.io/api/v1/news?category=${id}&token=${FINNHUB_KEY}`)
        .then(r => r.json())
        .then(items =>
          (Array.isArray(items) ? items : []).slice(0, 6).map(item => ({
            id:          String(item.id ?? Math.random()),
            headline:    item.headline || '',
            source:      item.source   || 'Finnhub',
            summary:     (item.summary || '').slice(0, 220),
            url:         item.url      || '#',
            publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : new Date().toISOString(),
            category:    cat,
            catLabel:    label,
            image:       item.image    || null,
          }))
        )
        .catch(() => [])
    )
  );

  return results.flat();
}

// ── NewsAPI ──────────────────────────────────────────────────────────────────
async function fetchNewsAPI() {
  const queries = [
    { q: 'stock market S&P NASDAQ earnings',     cat: 'market',   label: 'Market'       },
    { q: 'Bitcoin Ethereum cryptocurrency DeFi',  cat: 'crypto',   label: 'Crypto'       },
    { q: 'Federal Reserve inflation interest rates GDP', cat: 'econ', label: 'Economy'  },
    { q: 'NVIDIA semiconductor AI chips GPU',    cat: 'ai',       label: 'AI & Infra'   },
    { q: 'geopolitical trade war supply chain',  cat: 'world',    label: 'World News'   },
  ];

  const results = await Promise.all(
    queries.map(({ q, cat, label }) =>
      fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=4&language=en&apiKey=${NEWS_API_KEY}`
      )
        .then(r => r.json())
        .then(data =>
          (data.articles || []).map(item => ({
            id:          item.url,
            headline:    item.title   || '',
            source:      item.source?.name || 'NewsAPI',
            summary:     (item.description || '').slice(0, 220),
            url:         item.url     || '#',
            publishedAt: item.publishedAt || new Date().toISOString(),
            category:    cat,
            catLabel:    label,
            image:       item.urlToImage || null,
          }))
        )
        .catch(() => [])
    )
  );

  return results.flat();
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const now = Date.now();
  const cached = cache.get('news');
  if (cached && now - cached.ts < TTL) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(cached.data) };
  }

  let articles = [];
  let source   = 'none';

  try {
    if (FINNHUB_KEY) {
      articles = await fetchFinnhub();
      source   = 'finnhub';
    } else if (NEWS_API_KEY) {
      articles = await fetchNewsAPI();
      source   = 'newsapi';
    } else {
      return {
        statusCode: 200, headers: CORS,
        body: JSON.stringify({
          articles: [],
          error: 'No news API key configured. Set FINNHUB_API_KEY or NEWS_API_KEY in Netlify environment variables.',
          updatedAt: new Date().toISOString(),
        }),
      };
    }
  } catch (err) {
    console.error('[news]', err.message);
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ articles: [], error: err.message, updatedAt: new Date().toISOString() }),
    };
  }

  // Dedupe by URL, sort newest first, cap at 30
  const seen = new Set();
  articles = articles
    .filter(a => a.headline && a.url && a.url !== '#')
    .filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 30);

  const response = { articles, updatedAt: new Date().toISOString(), source };
  cache.set('news', { data: response, ts: now });

  return { statusCode: 200, headers: CORS, body: JSON.stringify(response) };
};
