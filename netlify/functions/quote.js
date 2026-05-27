const cache=new Map();
const TTL=30000;
const CORS={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET, OPTIONS"};
const FINNHUB_KEY=process.env.FINNHUB_API_KEY;
const NAMES={"NVDA":"NVIDIA","AVGO":"Broadcom","ASML":"ASML Holding","MU":"Micron Technology","MRVL":"Marvell Technology","VRT":"Vertiv Holdings","COHR":"Coherent Corp","QQQ":"Invesco QQQ","SPY":"SPDR S&P 500","AAPL":"Apple","MSFT":"Microsoft","GOOGL":"Alphabet","AMZN":"Amazon","META":"Meta","TSLA":"Tesla","BTC/USD":"Bitcoin","ETH/USD":"Ethereum","SOL/USD":"Solana","XRP/USD":"Ripple","DOGE/USD":"Dogecoin","BNB/USD":"BNB","ADA/USD":"Cardano","AVAX/USD":"Avalanche","LTC/USD":"Litecoin"};
const BINANCE={"BTC/USD":"BTCUSDT","ETH/USD":"ETHUSDT","SOL/USD":"SOLUSDT","XRP/USD":"XRPUSDT","DOGE/USD":"DOGEUSDT","BNB/USD":"BNBUSDT","ADA/USD":"ADAUSDT","AVAX/USD":"AVAXUSDT","LTC/USD":"LTCUSDT"};
function isCrypto(s){return s.includes("/");}
function r2(v){return v!==null?Math.round(v*100)/100:null;}
function calcRSI(c,p=14){if(c.length<p)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;}if(al===0)return 100;return Math.round((100-100/(1+ag/al))*10)/10;}
function calcEMA(c,p=20){if(c.length<p)return null;const k=2/(p+1);let e=c.slice(0,p).reduce((a,b)=>a+b)/p;for(let i=p;i<c.length;i++)e=c[i]*k+e*(1-k);return Math.round(e*100)/100;}
function signal(rsi,ema,chg){let s="Neutral",sc=50,r="Moderate";if(rsi!==null){if(rsi>70){s="Watch";sc=62;r="Elevated";}else if(rsi>55&&ema==="above"){s="Bullish";sc=78;}else if(rsi<30){s="Watch";sc=35;r="Elevated";}else if(rsi<45||ema==="below"){s="Neutral";sc=42;}else{s="Watch";sc=54;}}else{if(chg>3){s="Bullish";sc=65;}else if(chg<-3){s="Neutral";sc=40;}}if(Math.abs(chg||0)>6)r="Elevated";return{signal:s,score:sc,risk:r};}
exports.handler=async(event)=>{
  if(event.httpMethod==="OPTIONS")return{statusCode:204,headers:CORS,body:""};
  const sym=(event.queryStringParameters?.symbol||"").toUpperCase().trim();
  if(!sym)return{statusCode:400,headers:CORS,body:JSON.stringify({error:"symbol required. Example: ?symbol=NVDA or ?symbol=BTC/USD"})};
  const now=Date.now(),cached=cache.get(sym);
  if(cached&&now-cached.ts<TTL)return{statusCode:200,headers:CORS,body:JSON.stringify(cached.data)};
  try{
    let price,change,changePercent,high,low,open,prevClose,volume,rsi=null,ema20=null,emaStatus=null,src;
    if(isCrypto(sym)){
      const bSym=BINANCE[sym];
      if(!bSym)throw new Error("Unsupported crypto: "+sym+". Supported: BTC/USD, ETH/USD, SOL/USD, XRP/USD, DOGE/USD, BNB/USD");
      const[tr,kr]=await Promise.all([fetch("https://api.binance.com/api/v3/ticker/24hr?symbol="+bSym),fetch("https://api.binance.com/api/v3/klines?symbol="+bSym+"&interval=1d&limit=30")]);
      const[t,k]=await Promise.all([tr.json(),kr.json()]);
      if(t.code)throw new Error("Binance error: "+t.msg);
      price=parseFloat(t.lastPrice);change=parseFloat(t.priceChange);changePercent=parseFloat(t.priceChangePercent);
      high=parseFloat(t.highPrice);low=parseFloat(t.lowPrice);volume=Math.round(parseFloat(t.quoteVolume));
      open=parseFloat(t.openPrice);prevClose=parseFloat(t.prevClosePrice);src="binance";
      if(k?.length>=15){const closes=k.map(x=>parseFloat(x[4]));rsi=calcRSI(closes);ema20=calcEMA(closes);if(ema20)emaStatus=price>ema20?"above":"below";}
    }else{
      if(!FINNHUB_KEY)throw new Error("FINNHUB_API_KEY not set in Netlify environment variables.");
      const[q,cr]=await Promise.all([fetch("https://finnhub.io/api/v1/quote?symbol="+sym+"&token="+FINNHUB_KEY),fetch("https://finnhub.io/api/v1/stock/candle?symbol="+sym+"&resolution=D&count=30&token="+FINNHUB_KEY)]);
      const[q2,c]=await Promise.all([q.json(),cr.json()]);
      if(!q2.c||q2.c===0)throw new Error('"'+sym+'" not found. Check the ticker symbol.');
      price=q2.c;change=q2.d;changePercent=q2.dp;high=q2.h;low=q2.l;open=q2.o;prevClose=q2.pc;src="finnhub";
      if(c.s!=="no_data"&&c.c?.length>=15){rsi=calcRSI(c.c);ema20=calcEMA(c.c);if(ema20)emaStatus=price>ema20?"above":"below";volume=c.v?.[c.length-1]||null;}
    }
    const{signal:sig,score,risk}=signal(rsi,emaStatus,changePercent||0);
    const result={symbol:sym,name:NAMES[sym]||sym,type:isCrypto(sym)?"crypto":"stock",price:r2(price),change:r2(change),changePercent:r2(changePercent),volume,high:r2(high),low:r2(low),open:r2(open),previousClose:r2(prevClose),rsi,ema20,emaStatus,signal:sig,signalScore:score,risk,updatedAt:new Date().toISOString(),source:src};
    cache.set(sym,{data:result,ts:now});
    return{statusCode:200,headers:CORS,body:JSON.stringify(result)};
  }catch(err){return{statusCode:200,headers:CORS,body:JSON.stringify({error:err.message,symbol:sym})};}
};
