'use strict';
/**
 * Gilded Signals — /api/quotes?symbols=NVDA,MU,BTC/USD,ETH/USD
 * Stocks: Finnhub | Crypto: CoinGecko (no key needed)
 * Cache: 30 seconds
 */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const cache = new Map();
const TTL = 30000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

const NAMES = {
  NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',AMZN:'Amazon.com',
  GOOGL:'Alphabet Inc',META:'Meta Platforms',TSLA:'Tesla Inc',AMD:'AMD Inc',
  AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',
  MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',
  PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',
  QQQ:'Invesco QQQ Trust',SPY:'S&P 500 ETF',XOM:'ExxonMobil',
  'BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana',
  'XRP/USD':'XRP','DOGE/USD':'Dogecoin','BNB/USD':'BNB',
  'ADA/USD':'Cardano','AVAX/USD':'Avalanche','LTC/USD':'Litecoin',
};

const CG_IDS = {
  'BTC/USD':'bitcoin','ETH/USD':'ethereum','SOL/USD':'solana',
  'XRP/USD':'ripple','DOGE/USD':'dogecoin','BNB/USD':'binancecoin',
  'ADA/USD':'cardano','AVAX/USD':'avalanche-2','LTC/USD':'litecoin',
};

// Reverse map: CoinGecko id → our symbol
const CG_REVERSE = Object.fromEntries(Object.entries(CG_IDS).map(([k,v])=>[v,k]));

function isCrypto(s) { return s.includes('/'); }
function r2(v) { return v != null ? Math.round(v * 100) / 100 : null; }

function getMarketStatus() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(), t = et.getHours()*60 + et.getMinutes();
  if (day === 0 || day === 6) return 'closed';
  if (t >= 570 && t < 960)  return 'open';
  if (t >= 240 && t < 570)  return 'pre-market';
  if (t >= 960 && t < 1200) return 'after-hours';
  return 'closed';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const raw = (event.queryStringParameters?.symbols || '').toUpperCase();
  if (!raw) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'symbols required' }) };

  const syms = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  const cacheKey = syms.slice().sort().join(',');
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < TTL) return { statusCode: 200, headers: CORS, body: JSON.stringify(cached.data) };

  const stockSyms = syms.filter(s => !isCrypto(s));
  const cryptoSyms = syms.filter(s => isCrypto(s));
  const quotes = {};
  const errors = [];

  // ── CRYPTO via CoinGecko (batch) ──────────────────────────────────
  if (cryptoSyms.length > 0) {
    const validCrypto = cryptoSyms.filter(s => CG_IDS[s]);
    if (validCrypto.length > 0) {
      const ids = validCrypto.map(s => CG_IDS[s]).join(',');
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true`
        );
        const data = await res.json();
        for (const [cgId, p] of Object.entries(data)) {
          const sym = CG_REVERSE[cgId];
          if (!sym || !p.usd) continue;
          const price = p.usd;
          const chgPct = p.usd_24h_change || 0;
          const change = price - (price / (1 + chgPct/100));
          quotes[sym] = {
            symbol: sym, name: NAMES[sym] || sym, type: 'crypto',
            price: r2(price), change: r2(change), changePercent: r2(chgPct),
            volume: p.usd_24h_vol ? Math.round(p.usd_24h_vol) : null,
            high: p.usd_24h_high ? r2(p.usd_24h_high) : null,
            low: p.usd_24h_low ? r2(p.usd_24h_low) : null,
            previousClose: r2(price - change),
            updatedAt: new Date().toISOString(), source: 'coingecko',
          };
        }
      } catch (e) {
        errors.push('crypto: ' + e.message);
      }
    }
  }

  // ── STOCKS via Finnhub (parallel) ────────────────────────────────
  if (stockSyms.length > 0) {
    if (!FINNHUB_KEY) {
      errors.push('stocks: FINNHUB_API_KEY not configured');
    } else {
      const tasks = stockSyms.map(sym =>
        fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`)
          .then(r => r.json())
          .then(q => {
            if (q.c && q.c !== 0) {
              quotes[sym] = {
                symbol: sym, name: NAMES[sym] || sym, type: 'stock',
                price: r2(q.c), change: r2(q.d), changePercent: r2(q.dp),
                high: r2(q.h), low: r2(q.l), previousClose: r2(q.pc),
                volume: null, updatedAt: new Date().toISOString(), source: 'finnhub',
              };
            }
          })
          .catch(e => errors.push(`${sym}: ${e.message}`))
      );
      await Promise.all(tasks);
    }
  }

  const response = {
    quotes,
    marketStatus: getMarketStatus(),
    updatedAt: new Date().toISOString(),
    ...(errors.length ? { warnings: errors } : {}),
  };

  if (Object.keys(quotes).length > 0) cache.set(cacheKey, { data: response, ts: now });
  return { statusCode: 200, headers: CORS, body: JSON.stringify(response) };
};
