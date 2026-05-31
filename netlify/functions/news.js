'use strict';
const FH = process.env.FINNHUB_API_KEY;
const cache = new Map(), TTL = 600000;
const CORS = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};

const CAT_MAP = {
  market: 'general',
  ai: 'technology',
  crypto: 'crypto',
  earnings: 'company news',
  econ: 'forex',
  world: 'general'
};

async function fetchNews(cat) {
  const fhCat = CAT_MAP[cat] || 'general';
  const url = `https://finnhub.io/api/v1/news?category=${fhCat}&token=${FH}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('Bad response from Finnhub');
  return data.slice(0, 20).map(n => ({
    source: n.source || 'Finnhub',
    headline: n.headline || '',
    summary: n.summary || '',
    url: n.url || '#',
    time: n.datetime ? new Date(n.datetime * 1000).toISOString() : new Date().toISOString(),
    cat: cat,
    catLabel: cat.charAt(0).toUpperCase() + cat.slice(1),
    image: n.image || null
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return {statusCode:204,headers:CORS,body:''};
  const cat = (event.queryStringParameters?.cat || 'market').toLowerCase();
  const now = Date.now(), hit = cache.get(cat);
  if (hit && now - hit.ts < TTL) return {statusCode:200,headers:CORS,body:JSON.stringify(hit.data)};
  try {
    if (!FH) throw new Error('FINNHUB_API_KEY not set');
    const articles = await fetchNews(cat);
    cache.set(cat, {data: articles, ts: now});
    return {statusCode:200,headers:CORS,body:JSON.stringify(articles)};
  } catch(err) {
    return {statusCode:200,headers:CORS,body:JSON.stringify({error:err.message})};
  }
};
