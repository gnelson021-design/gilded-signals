'use strict';
const FINNHUB_KEY=process.env.FINNHUB_API_KEY;
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',AMZN:'Amazon.com',GOOGL:'Alphabet Inc',META:'Meta Platforms',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ Trust',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP','DOGE/USD':'Dogecoin','BNB/USD':'BNB'};
const cache=new Map(),TTL=30000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
function isCrypto(s){return s.includes('/');}
function cryptoSym(s){return'BINANCE:'+s.replace('/USD','')+'USDT';}
function calcRSI(c,p=14){if(c.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}if(al===0)return 100;return Math.round((100-100/(1+ag/al))*10)/10;}
function calcEMA(c,p=20){if(c.length<p)return null;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return Math.round(e*100)/100;}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  if(!FINNHUB_KEY)return{statusCode:503,headers:CORS,body:JSON.stringify({error:'FINNHUB_API_KEY not set in Netlify environment variables.'})};
  const sym=(event.queryStringParameters?.symbol||'').toUpperCase().trim();
  if(!sym)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbol required'})};
  const now=Date.now(),cached=cache.get(sym);
  if(cached&&now-cached.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(cached.data)};
  const crypto=isCrypto(sym);
  try{
    let price,change,changePercent,high,low,open,previousClose,volume,rsi=null,ema20=null,emaStatus=null;
    if(crypto){
      const res=await fetch('https://finnhub.io/api/v1/crypto/candle?symbol='+cryptoSym(sym)+'&resolution=D&count=30&token='+FINNHUB_KEY);
      const c=await res.json();
      if(!c.c?.length)throw new Error('No data for '+sym+'. Use format: BTC/USD');
      const closes=c.c;
      price=closes[closes.length-1];previousClose=closes[closes.length-2]||price;
      change=price-previousClose;changePercent=(change/previousClose)*100;
      high=c.h?.[c.h.length-1]||null;low=c.l?.[c.l.length-1]||null;open=c.o?.[c.o.length-1]||null;volume=c.v?.[c.v.length-1]||null;
      if(closes.length>=15){rsi=calcRSI(closes);ema20=calcEMA(closes);if(ema20)emaStatus=price>ema20?'above':'below';}
    }else{
      const[qRes,cRes]=await Promise.all([fetch('https://finnhub.io/api/v1/quote?symbol='+sym+'&token='+FINNHUB_KEY),fetch('https://finnhub.io/api/v1/stock/candle?symbol='+sym+'&resolution=D&count=30&token='+FINNHUB_KEY)]);
      const[q,c]=await Promise.all([qRes.json(),cRes.json()]);
      if(!q.c||q.c===0)throw new Error('"'+sym+'" not found. Check the ticker.');
      price=q.c;previousClose=q.pc;change=q.d;changePercent=q.dp;high=q.h;low=q.l;open=q.o;
      if(c.s!=='no_data'&&c.c?.length>=15){rsi=calcRSI(c.c);ema20=calcEMA(c.c);if(ema20)emaStatus=price>ema20?'above':'below';volume=c.v?.[c.v.length-1]||null;}
    }
    let signal='Neutral',score=50,risk='Moderate';
    if(rsi!==null){if(rsi>70){signal='Watch';score=62;risk='Elevated';}else if(rsi>=55&&emaStatus==='above'){signal='Bullish';score=78;}else if(rsi<30){signal='Watch';score=35;risk='Elevated';}else if(rsi<45||emaStatus==='below'){signal='Neutral';score=42;}else{signal='Watch';score=54;}}
    else{if(changePercent>3){signal='Bullish';score=65;}else if(changePercent<-3){signal='Neutral';score=40;}}
    if(Math.abs(changePercent||0)>6)risk='Elevated';
    const result={symbol:sym,name:NAMES[sym]||sym,type:crypto?'crypto':'stock',price:r2(price),change:r2(change),changePercent:r2(changePercent),volume:volume?Math.round(volume):null,high:r2(high),low:r2(low),open:r2(open),previousClose:r2(previousClose),rsi,ema20,emaStatus,signal,signalScore:score,risk,updatedAt:new Date().toISOString(),source:'finnhub'};
    cache.set(sym,{data:result,ts:now});
    return{statusCode:200,headers:CORS,body:JSON.stringify(result)};
  }catch(err){return{statusCode:200,headers:CORS,body:JSON.stringify({error:err.message,symbol:sym})};}
};
