'use strict';
const FINNHUB_KEY=process.env.FINNHUB_API_KEY;
const cache=new Map(),TTL=60000,CORS={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
const NAMES={NVDA:'NVIDIA Corp',AAPL:'Apple Inc',MSFT:'Microsoft Corp',TSLA:'Tesla Inc',AMD:'AMD Inc',AVGO:'Broadcom Inc',PLTR:'Palantir',ASML:'ASML Holding',MU:'Micron Technology',MRVL:'Marvell Technology',VRT:'Vertiv Holdings',COHR:'Coherent Corp',PANW:'Palo Alto Networks',JPM:'JPMorgan Chase',GLD:'SPDR Gold Trust',QQQ:'Invesco QQQ',SPY:'S&P 500 ETF','BTC/USD':'Bitcoin','ETH/USD':'Ethereum','SOL/USD':'Solana','XRP/USD':'XRP','DOGE/USD':'Dogecoin','BNB/USD':'BNB','ADA/USD':'Cardano','AVAX/USD':'Avalanche','LTC/USD':'Litecoin'};
const CG={'BTC/USD':'bitcoin','ETH/USD':'ethereum','SOL/USD':'solana','XRP/USD':'ripple','DOGE/USD':'dogecoin','BNB/USD':'binancecoin','ADA/USD':'cardano','AVAX/USD':'avalanche-2','LTC/USD':'litecoin'};
function isCrypto(s){return s.includes('/');}
function r2(v){return v!=null?Math.round(v*100)/100:null;}
function calcRSI(c,p=14){if(c.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}if(al===0)return 100;return Math.round((100-100/(1+ag/al))*10)/10;}
function calcEMA(c,p=20){if(c.length<p)return null;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return Math.round(e*100)/100;}
function sig(rsi,ema,chg){let s='Neutral',sc=50,r='Moderate';if(rsi!==null){if(rsi>70){s='Watch';sc=62;r='Elevated';}else if(rsi>=55&&ema==='above'){s='Bullish';sc=78;}else if(rsi<30){s='Watch';sc=35;r='Elevated';}else if(rsi<45||ema==='below'){s='Neutral';sc=42;}else{s='Watch';sc=54;}}else{if(chg>3){s='Bullish';sc=65;}else if(chg<-3){s='Neutral';sc=40;}}if(Math.abs(chg||0)>6)r='Elevated';return{signal:s,score:sc,risk:r};}
exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  const sym=(event.queryStringParameters?.symbol||'').toUpperCase().trim();
  if(!sym)return{statusCode:400,headers:CORS,body:JSON.stringify({error:'symbol required'})};
  const now=Date.now(),hit=cache.get(sym);
  if(hit&&now-hit.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(hit.data)};
  try{
    let price,change,changePercent,high,low,open,prevClose,volume,rsi=null,ema20=null,emaStatus=null,src;
    if(isCrypto(sym)){
      const id=CG[sym];if(!id)throw new Error('Unsupported crypto: '+sym);
      const[pr,ch]=await Promise.all([fetch('https://api.coingecko.com/api/v3/simple/price?ids='+id+'&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true'),fetch('https://api.coingecko.com/api/v3/coins/'+id+'/market_chart?vs_currency=usd&days=30&interval=daily')]);
      const[pd,cd]=await Promise.all([pr.json(),ch.json()]);
      const p=pd[id];if(!p||!p.usd)throw new Error('No CoinGecko data for '+sym);
      price=p.usd;changePercent=p.usd_24h_change||0;change=price-(price/(1+changePercent/100));prevClose=price-change;
      high=p.usd_24h_high||null;low=p.usd_24h_low||null;volume=p.usd_24h_vol?Math.round(p.usd_24h_vol):null;src='coingecko';
      if(cd.prices?.length>=15){const cl=cd.prices.map(x=>x[1]);rsi=calcRSI(cl);ema20=calcEMA(cl);if(ema20)emaStatus=price>ema20?'above':'below';}
    }else{
      if(!FINNHUB_KEY)throw new Error('FINNHUB_API_KEY not set');
      const r=await fetch('https://finnhub.io/api/v1/quote?symbol='+sym+'&token='+FINNHUB_KEY);
      const q=await r.json();
      if(!q.c||q.c===0)throw new Error('"'+sym+'" not found or rate-limited. Try again shortly.');
      price=q.c;change=q.d;changePercent=q.dp;high=q.h;low=q.l;open=q.o;prevClose=q.pc;src='finnhub';
    }
    const{signal,score,risk}=sig(rsi,emaStatus,changePercent||0);
    const data={symbol:sym,name:NAMES[sym]||sym,type:isCrypto(sym)?'crypto':'stock',price:r2(price),change:r2(change),changePercent:r2(changePercent),volume,high:r2(high),low:r2(low),open:r2(open),previousClose:r2(prevClose),rsi,ema20,emaStatus,signal,signalScore:score,risk,updatedAt:new Date().toISOString(),source:src};
    cache.set(sym,{data,ts:now});
    return{statusCode:200,headers:CORS,body:JSON.stringify(data)};
  }catch(err){return{statusCode:200,headers:CORS,body:JSON.stringify({error:err.message,symbol:sym})};}
};
