'use strict';
const FINNHUB_KEY=process.env.FINNHUB_API_KEY;
const cache=new Map(),TTL=60000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP','DOGE/USD':'Dogecoin','BNB/USD':'BNB','ADA/USD':'Cardano','AVAX/USD':'Avalanche','LTC/USD':'Litecoin'};
const CG={'BTC/USD':'bitcoin','ETH/USD':'ethereum','SOL/USD':'solana','XRP/USD':'ripple','DOGE/USD':'dogecoin','BNB/USD':'binancecoin','ADA/USD':'cardano','AVAX/USD':'avalanche-2','LTC/USD':'litecoin'};
const RCG=Object.fromEntries(Object.entries(CG).map(([k,v])=>[v,k]));
function isCrypto(s){return s.includes('/');}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
function mktStatus(){const et=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));const d=et.getDay(),t=et.getHours()*60+et.getMinutes();if(d===0||d===6)return'closed';if(t>=570&&t<960)return'open';if(t>=240&&t<570)return'pre-market';if(t>=960&&t<1200)return'after-hours';return'closed';}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  const raw=(event.queryStringParameters?.symbols||'').toUpperCase();
  if(!raw)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbols required'})};
  const syms=[...new Set(raw.split(',').map(s=>s.trim()).filter(Boolean))];
  const key=syms.slice().sort().join(','),now=Date.now(),hit=cache.get(key);
  if(hit&&now-hit.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(hit.data)};
  const stocks=syms.filter(s=>!isCrypto(s)),cryptos=syms.filter(s=>isCrypto(s));
  const quotes={},errors=[];
  if(cryptos.length){
    const valid=cryptos.filter(s=>CG[s]);
    if(valid.length){
      try{
        const ids=valid.map(s=>CG[s]).join(',');
        const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids='+ids+'&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true');
        const d=await r.json();
        for(const[id,p]of Object.entries(d)){const sym=RCG[id];if(!sym||!p.usd)continue;const price=p.usd,chg=p.usd_24h_change||0,change=price-(price/(1+chg/100));quotes[sym]={symbol:sym,name:NAMES[sym]||sym,type:'crypto',price:r2(price),change:r2(change),changePercent:r2(chg),volume:p.usd_24h_vol?Math.round(p.usd_24h_vol):null,high:p.usd_24h_high||null,low:p.usd_24h_low||null,previousClose:r2(price-change),updatedAt:new Date().toISOString(),source:'coingecko'};}
      }catch(e){errors.push('crypto: '+e.message);}
    }
  }
  if(stocks.length){
    if(!FINNHUB_KEY){errors.push('FINNHUB_API_KEY not set');}
    else{
      await Promise.all(stocks.map(sym=>fetch('https://finnhub.io/api/v1/quote?symbol='+sym+'&token='+FINNHUB_KEY).then(r=>r.json()).then(q=>{if(q.c&&q.c!==0)quotes[sym]={symbol:sym,name:NAMES[sym]||sym,type:'stock',price:r2(q.c),change:r2(q.d),changePercent:r2(q.dp),high:r2(q.h),low:r2(q.l),previousClose:r2(q.pc),volume:null,updatedAt:new Date().toISOString(),source:'finnhub'};}).catch(e=>errors.push(sym+': '+e.message))));
    }
  }
  const resp={quotes,marketStatus:mktStatus(),updatedAt:new Date().toISOString(),...(errors.length?{warnings:errors}:{})};
  if(Object.keys(quotes).length)cache.set(key,{data:resp,ts:now});
  return{statusCode:200,headers:CORS,body:JSON.stringify(resp)};
};
