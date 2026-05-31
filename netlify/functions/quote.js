'use strict';
const ALPACA_KEY=process.env.ALPACA_API_KEY;
const ALPACA_SECRET=process.env.ALPACA_SECRET_KEY;
const cache=new Map(),TTL=60000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP'};
const CG={'BTC/USD':'bitcoin','ETH/USD':'ethereum','SOL/USD':'solana','XRP/USD':'ripple'};
function isCrypto(s){return s.includes('/');}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
function sig(chg){let s='Neutral',sc=50;if(chg>3){s='Bullish';sc=65;}else if(chg>1){s='Watch';sc=55;}else if(chg<-3){s='Neutral';sc=35;}else if(chg<-1){s='Watch';sc=42;}return{signal:s,score:sc,risk:sc};}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  const sym=(event.queryStringParameters?.symbol||'').toUpperCase().trim();
  if(!sym)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbol required'})};
  const now=Date.now(),hit=cache.get(sym);
  if(hit&&now-hit.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(hit.data)};
  try{
    let price,change,changePercent,high,low,open,prevClose,volume,src;
    if(isCrypto(sym)){
      const id=CG[sym];
      if(!id)throw new Error('Unsupported crypto: '+sym);
      const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids='+id+'&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true');
      const d=await r.json();
      const p=d[id];
      if(!p||!p.usd)throw new Error('No CoinGecko data for '+sym);
      price=p.usd;changePercent=r2(p.usd_24h_change);change=r2(price*(changePercent/100));volume=p.usd_24h_vol?Math.round(p.usd_24h_vol):null;src='coingecko';
    }else{
      if(!ALPACA_KEY||!ALPACA_SECRET)throw new Error('Alpaca keys not set');
      const headers={'APCA-API-KEY-ID':ALPACA_KEY,'APCA-API-SECRET-KEY':ALPACA_SECRET};
      const[snapRes]=await Promise.all([fetch('https://data.alpaca.markets/v2/stocks/'+sym+'/snapshot',{headers})]);
      const snap=await snapRes.json();
      if(snap.message||!snap.latestTrade)throw new Error(snap.message||'No data for '+sym);
      price=r2(snap.latestTrade.p);
      prevClose=r2(snap.prevDailyBar?.c);
      open=r2(snap.dailyBar?.o);
      high=r2(snap.dailyBar?.h);
      low=r2(snap.dailyBar?.l);
      volume=snap.dailyBar?.v||null;
      change=prevClose?r2(price-prevClose):null;
      changePercent=prevClose?r2((price-prevClose)/prevClose*100):null;
      src='alpaca';
    }
    const{signal,score,risk}=sig(changePercent||0);
    const data={symbol:sym,name:NAMES[sym]||sym,type:isCrypto(sym)?'crypto':'stock',price,change,changePercent,volume,high,low,open,previousClose:prevClose,signal,signalScore:score,risk,updatedAt:new Date().toISOString(),source:src};
    cache.set(sym,{data,ts:now});
    return{statusCode:200,headers:CORS,body:JSON.stringify(data)};
  }catch(err){return{statusCode:200,headers:CORS,body:JSON.stringify({error:err.message,symbol:sym})};}
};
