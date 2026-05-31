'use strict';
const ALPACA_KEY=process.env.ALPACA_API_KEY;
const ALPACA_SECRET=process.env.ALPACA_SECRET_KEY;
const cache=new Map(),TTL=60000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP'};
const CG={'BTC/USD':'bitcoin','ETH/USD':'ethereum','SOL/USD':'solana','XRP/USD':'ripple'};
function isCrypto(s){return s.includes('/');}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
function calcRSI(c,p=14){if(c.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}if(al===0)return 100;return Math.round((100-100/(1+ag/al))*10)/10;}
function calcEMA(c,p=20){if(c.length<p)return null;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return Math.round(e*100)/100;}
function sig(rsi,emaStatus,chg){let s='Neutral',sc=50;if(rsi!=null){if(rsi>70){s='Watch';sc=62;}else if(rsi>=55&&emaStatus==='above'){s='Bullish';sc=78;}else if(rsi<30){s='Watch';sc=35;}else if(rsi<45||emaStatus==='below'){s='Neutral';sc=42;}else{s='Watch';sc=54;}}if(chg>3){s='Bullish';sc=65;}else if(chg<-3){s='Neutral';sc=40;}return{signal:s,score:sc,risk:sc};}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  const sym=(event.queryStringParameters?.symbol||'').toUpperCase().trim();
  if(!sym)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbol required'})};
  const now=Date.now(),hit=cache.get(sym);
  if(hit&&now-hit.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(hit.data)};
  try{
    let price,change,changePercent,high,low,open,prevClose,volume,rsi=null,ema20=null,emaStatus=null,src;
    if(isCrypto(sym)){
      const id=CG[sym];
      if(!id)throw new Error('Unsupported crypto: '+sym);
      const[priceRes,chartRes]=await Promise.all([
        fetch('https://api.coingecko.com/api/v3/simple/price?ids='+id+'&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_24hr_high=true&include_24hr_low=true'),
        fetch('https://api.coingecko.com/api/v3/coins/'+id+'/market_chart?vs_currency=usd&days=30&interval=daily')
      ]);
      const pd=await priceRes.json();
      const cd=await chartRes.json();
      const p=pd[id];
      if(!p||!p.usd)throw new Error('No CoinGecko data for '+sym);
      price=p.usd;
      changePercent=r2(p.usd_24h_change);
      change=r2(price*(changePercent/100));
      volume=p.usd_24h_vol?Math.round(p.usd_24h_vol):null;
      high=p.usd_24h_high||null;
      low=p.usd_24h_low||null;
      if(cd.prices&&cd.prices.length>=15){
        const closes=cd.prices.map(x=>x[1]);
        rsi=calcRSI(closes);
        ema20=calcEMA(closes);
        if(ema20)emaStatus=price>ema20?'above':'below';
      }
      src='coingecko';
    }else{
      if(!ALPACA_KEY||!ALPACA_SECRET)throw new Error('Alpaca keys not set');
      const headers={'APCA-API-KEY-ID':ALPACA_KEY,'APCA-API-SECRET-KEY':ALPACA_SECRET};
      const end=new Date().toISOString().split('T')[0];
      const start=new Date(Date.now()-30*24*60*60*1000).toISOString().split('T')[0];
      const[snapRes,barsRes]=await Promise.all([
        fetch('https://data.alpaca.markets/v2/stocks/'+sym+'/snapshot',{headers}),
        fetch('https://data.alpaca.markets/v2/stocks/'+sym+'/bars?timeframe=1Day&start='+start+'&end='+end+'&limit=30',{headers})
      ]);
      const snap=await snapRes.json();
      const bars=await barsRes.json();
      if(snap.message||!snap.latestTrade)throw new Error(snap.message||'No data for '+sym);
      price=r2(snap.latestTrade.p);
      prevClose=r2(snap.prevDailyBar?.c);
      open=r2(snap.dailyBar?.o);
      high=r2(snap.dailyBar?.h);
      low=r2(snap.dailyBar?.l);
      volume=snap.dailyBar?.v||null;
      change=prevClose?r2(price-prevClose):null;
      changePercent=prevClose?r2((price-prevClose)/prevClose*100):null;
      if(bars.bars&&bars.bars.length>=15){
        const closes=bars.bars.map(b=>b.c);
        rsi=calcRSI(closes);
        ema20=calcEMA(closes);
        if(ema20)emaStatus=price>ema20?'above':'below';
      }
      src='alpaca';
    }
    const{signal,score,risk}=sig(rsi,emaStatus,changePercent||0);
    const data={symbol:sym,name:NAMES[sym]||sym,type:isCrypto(sym)?'crypto':'stock',price,change,changePercent,volume,high,low,open,previousClose:prevClose,rsi,ema20,emaStatus,signal,signalScore:score,risk,updatedAt:new Date().toISOString(),source:src};
    cache.set(sym,{data,ts:now});
    return{statusCode:200,headers:CORS,body:JSON.stringify(data)};
  }catch(err){return{statusCode:200,headers:CORS,body:JSON.stringify({error:err.message,symbol:sym})};}
};
