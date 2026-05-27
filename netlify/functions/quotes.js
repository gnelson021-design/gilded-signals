/**
 * GET /api/quotes?symbols=NVDA,AAPL,BTC,ETH,SOL
 *
 * Batch quote endpoint. Uses Promise.allSettled so one failed symbol
 * never breaks the others. Max 20 symbols per request.
 */

const https = require("https");

const CRYPTO_MAP = {
  BTC:"BTC/USD", ETH:"ETH/USD", SOL:"SOL/USD", BNB:"BNB/USD",
  XRP:"XRP/USD", ADA:"ADA/USD", DOGE:"DOGE/USD", AVAX:"AVAX/USD",
  MATIC:"MATIC/USD", LTC:"LTC/USD", DOT:"DOT/USD", LINK:"LINK/USD",
};

const CRYPTO_NAMES = {
  BTC:"Bitcoin", ETH:"Ethereum", SOL:"Solana", BNB:"BNB",
  XRP:"XRP", ADA:"Cardano", DOGE:"Dogecoin", AVAX:"Avalanche",
  MATIC:"Polygon", LTC:"Litecoin", DOT:"Polkadot", LINK:"Chainlink",
};

const PRICE_FLOORS = {
  "BTC/USD":5000, "ETH/USD":100, "SOL/USD":1, "BNB/USD":10,
  "XRP/USD":0.001, "ADA/USD":0.001, "DOGE/USD":0.0001,
  "AVAX/USD":1, "MATIC/USD":0.001, "LTC/USD":5,
};

const ALLOWED_ORIGINS = [
  "https://tradingbotguru.com","https://www.tradingbotguru.com",
  "https://scanner.tradingbotguru.com","https://gildedsignals.com",
  "https://www.gildedsignals.com","https://gupdates.info",
  "https://www.gupdates.info","https://gupdates.live",
  "https://scanner.gupdates.com","https://scanner.gildedsignals.com",
  "http://localhost:8888","http://localhost:3000","http://127.0.0.1:5500",
];

const CACHE = new Map();
const CACHE_TTL = 20_000;
const TIMEOUT = 8_000;
const MAX_SYMBOLS = 20;

function isCrypto(s) { return s in CRYPTO_MAP || s.includes("/"); }
function normCrypto(s) { return CRYPTO_MAP[s] || (s.includes("/") ? s : s + "/USD"); }
function round(n, d) { const f = 10**d; return Math.round(n*f)/f; }
function cacheGet(k) { const e=CACHE.get(k); if(!e) return null; if(Date.now()-e.ts>CACHE_TTL){CACHE.delete(k);return null;} return e.v; }
function cacheSet(k,v) { CACHE.set(k,{v,ts:Date.now()}); }

function marketStatus() {
  const now=new Date(), day=now.getUTCDay();
  if(day===0||day===6) return "closed";
  const m=now.getUTCMonth()+1, d=now.getUTCDate();
  const dst=m>3&&m<11||(m===3&&d>=8)||(m===11&&d<7);
  const et=(now.getUTCHours()-(dst?4:5)+24)%24;
  const min=et*60+now.getUTCMinutes();
  if(min>=570&&min<960) return "open";
  if(min>=240&&min<570) return "pre-market";
  if(min>=960&&min<1200) return "after-hours";
  return "closed";
}

function alpacaGet(path) {
  const key = process.env.ALPACA_API_KEY    || process.env.APCA_API_KEY_ID;
  const sec = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY;
  if(!key||!sec) return Promise.reject(new Error("MISSING_CREDENTIALS"));

  return new Promise((resolve,reject)=>{
    const req = https.request({
      hostname:"data.alpaca.markets", port:443, path, method:"GET",
      headers:{"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":sec,Accept:"application/json"},
    }, res=>{
      let raw="";
      res.on("data",c=>raw+=c);
      res.on("end",()=>{
        if(res.statusCode===404) return reject(new Error("INVALID_SYMBOL"));
        if(res.statusCode===401||res.statusCode===403) return reject(new Error("AUTH_ERROR"));
        if(res.statusCode!==200) return reject(new Error("ALPACA_"+res.statusCode));
        try{resolve(JSON.parse(raw));}catch{reject(new Error("PARSE_ERROR"));}
      });
    });
    req.setTimeout(TIMEOUT,()=>{req.destroy();reject(new Error("TIMEOUT"));});
    req.on("error",reject);
    req.end();
  });
}

async function batchStocks(syms) {
  const q = syms.map(s=>encodeURIComponent(s)).join(",");
  const data = await alpacaGet(`/v2/stocks/snapshots?symbols=${q}`);
  const results = {};
  for(const [sym, snap] of Object.entries(data)) {
    try {
      const price = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? snap.dailyBar?.c;
      if(!price) { results[sym]={symbol:sym,error:"No price data"}; continue; }
      const prev = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const chg  = price - prev;
      const pct  = prev!==0?(chg/prev)*100:0;
      results[sym] = {
        symbol:sym, name:sym, assetType:"stock", provider:"Alpaca",
        price:round(price,2), change:round(chg,2),
        changePercent:round(pct,4), percentChange:round(pct,4),
        previousClose:round(prev,2),
        dayHigh:snap.dailyBar?.h?round(snap.dailyBar.h,2):null,
        dayLow:snap.dailyBar?.l?round(snap.dailyBar.l,2):null,
        volume:snap.dailyBar?.v??null,
        marketStatus:marketStatus(),
        timestamp:new Date().toISOString(), lastUpdated:new Date().toISOString(),
      };
    } catch(e) { results[sym]={symbol:sym,error:"Parse error"}; }
  }
  return results;
}

async function batchCrypto(syms) {
  const pairs = syms.map(normCrypto);
  const q = pairs.map(encodeURIComponent).join(",");
  const data = await alpacaGet(`/v1beta3/crypto/us/snapshots?symbols=${q}`);
  const results = {};
  for(const [sym, base] of syms.map((s,i)=>[s,s])) {
    const pair = normCrypto(sym);
    const snap = data.snapshots?.[pair];
    if(!snap) { results[sym]={symbol:sym,error:"Symbol not found"}; continue; }
    try {
      const price = snap.latestTrade?.p ?? snap.latestQuote?.ap ?? snap.dailyBar?.c;
      if(!price) { results[sym]={symbol:sym,error:"No price data"}; continue; }
      const floor = PRICE_FLOORS[pair];
      if(floor && price<floor) { results[sym]={symbol:sym,error:"Price failed sanity check"}; continue; }
      const prev = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const chg  = price - prev;
      const pct  = prev!==0?(chg/prev)*100:0;
      results[sym] = {
        symbol:sym, name:CRYPTO_NAMES[sym]||sym, assetType:"crypto", provider:"Alpaca",
        price:round(price,2), change:round(chg,2),
        changePercent:round(pct,4), percentChange:round(pct,4),
        previousClose:round(prev,2),
        dayHigh:snap.dailyBar?.h?round(snap.dailyBar.h,2):null,
        dayLow:snap.dailyBar?.l?round(snap.dailyBar.l,2):null,
        volume:snap.dailyBar?.v??null,
        marketStatus:"open",
        timestamp:new Date().toISOString(), lastUpdated:new Date().toISOString(),
      };
    } catch(e) { results[sym]={symbol:sym,error:"Parse error"}; }
  }
  return results;
}

exports.handler = async (event) => {
  const origin = event.headers?.origin||"";
  const cors   = ALLOWED_ORIGINS.includes(origin)?origin:ALLOWED_ORIGINS[0];
  const hdrs   = {
    "Access-Control-Allow-Origin":cors,
    "Access-Control-Allow-Methods":"GET, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Content-Type":"application/json",
  };

  if(event.httpMethod==="OPTIONS") return {statusCode:204,headers:hdrs,body:""};
  if(event.httpMethod!=="GET") return {statusCode:405,headers:hdrs,body:JSON.stringify({error:"Method not allowed"})};

  const rawList = (event.queryStringParameters?.symbols||"").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean).slice(0,MAX_SYMBOLS);
  if(!rawList.length) return {statusCode:400,headers:hdrs,body:JSON.stringify({error:"Missing symbols parameter"})};

  // Split into stocks and crypto
  const stockSyms  = rawList.filter(s=>!isCrypto(s));
  const cryptoSyms = rawList.filter(s=>isCrypto(s));

  // Check cache first
  const quotes = {};
  const uncachedStocks  = [];
  const uncachedCrypto  = [];

  for(const s of stockSyms)  { const c=cacheGet(s); if(c) quotes[s]=c; else uncachedStocks.push(s); }
  for(const s of cryptoSyms) { const c=cacheGet(s); if(c) quotes[s]=c; else uncachedCrypto.push(s); }

  // Fetch uncached in parallel batches
  const fetches = [];
  if(uncachedStocks.length)  fetches.push(batchStocks(uncachedStocks).then(r=>{Object.assign(quotes,r);for(const[k,v]of Object.entries(r)){if(!v.error)cacheSet(k,v);}}).catch(()=>{}));
  if(uncachedCrypto.length)  fetches.push(batchCrypto(uncachedCrypto).then(r=>{Object.assign(quotes,r);for(const[k,v]of Object.entries(r)){if(!v.error)cacheSet(k,v);}}).catch(()=>{}));

  await Promise.allSettled(fetches);

  // Any symbols that failed entirely
  for(const s of rawList) { if(!quotes[s]) quotes[s]={symbol:s,error:"Unavailable"}; }

  return {
    statusCode:200,
    headers:{...hdrs,"Cache-Control":"public, max-age=20"},
    body:JSON.stringify({quotes,marketStatus:marketStatus(),count:Object.keys(quotes).length}),
  };
};
