'use strict';
const FINNHUB_KEY=process.env.FINNHUB_API_KEY;
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',AMZN:'Amazon.com',GOOGL:'Alphabet Inc',META:'Meta Platforms',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ Trust',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP','DOGE/USD':'Dogecoin'};
const cache=new Map(),TTL=30000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
function isCrypto(s){return s.includes('/');}
function cryptoSym(s){return'BINANCE:'+s.replace('/USD','')+'USDT';}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
function getMarketStatus(){const et=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));const day=et.getDay(),t=et.getHours()*60+et.getMinutes();if(day===0||day===6)return'closed';if(t>=570&&t<960)return'open';if(t>=240&&t<570)return'pre-market';if(t>=960&&t<1200)return'after-hours';return'closed';}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  if(!FINNHUB_KEY)return{statusCode:503,headers:CORS,body:JSON.stringify({error:'FINNHUB_API_KEY not configured.',quotes:{}})};
  const raw=(event.queryStringParameters?.symbols||'').toUpperCase();
  if(!raw)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbols required'})};
  const syms=[...new Set(raw.split(',').map(s=>s.trim()).filter(Boolean))];
  const cacheKey=syms.slice().sort().join(',');
  const now=Date.now(),cached=cache.get(cacheKey);
  if(cached&&now-cached.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(cached.data)};
  const quotes={},errors=[];
  const stockSyms=syms.filter(s=>!isCrypto(s));
  const cryptoSyms=syms.filter(s=>isCrypto(s));
  const tasks=[
    ...stockSyms.map(sym=>fetch('https://finnhub.io/api/v1/quote?symbol='+sym+'&token='+FINNHUB_KEY).then(r=>r.json()).then(q=>{if(q.c&&q.c!==0)quotes[sym]={symbol:sym,name:NAMES[sym]||sym,type:'stock',price:r2(q.c),change:r2(q.d),changePercent:r2(q.dp),high:r2(q.h),low:r2(q.l),previousClose:r2(q.pc),volume:null,updatedAt:new Date().toISOString(),source:'finnhub'};}).catch(e=>errors.push(sym+': '+e.message))),
    ...cryptoSyms.map(sym=>fetch('https://finnhub.io/api/v1/crypto/candle?symbol='+cryptoSym(sym)+'&resolution=60&count=2&token='+FINNHUB_KEY).then(r=>r.json()).then(c=>{if(c.c?.length){const p=c.c[c.c.length-1],pv=c.c[c.c.length-2]||p,ch=p-pv,chp=(ch/pv)*100;quotes[sym]={symbol:sym,name:NAMES[sym]||sym,type:'crypto',price:r2(p),change:r2(ch),changePercent:r2(chp),high:c.h?.[c.h.length-1]||null,low:c.l?.[c.l.length-1]||null,previousClose:r2(pv),volume:c.v?.[c.v.length-1]||null,updatedAt:new Date().toISOString(),source:'finnhub'};}}).catch(e=>errors.push(sym+': '+e.message))),
  ];
  await Promise.all(tasks);
  const response={quotes,marketStatus:getMarketStatus(),updatedAt:new Date().toISOString(),...(errors.length?{warnings:errors}:{})};
  if(Object.keys(quotes).length>0)cache.set(cacheKey,{data:response,ts:now});
  return{statusCode:200,headers:CORS,body:JSON.stringify(response)};
};
