#!/usr/bin/env python3
"""
Gilded Signals — Scanner + Ticker clean rebuild.
- Crypto pulls DIRECTLY from CoinGecko (one batched call, reliable)
- Per-request timeouts so nothing hangs on 'Loading...'
- Auto-refresh while the page is visible (live all day)
- Only valid, tradeable tickers (SPX/NASDAQ removed -> use SPY/QQQ)
- Failures isolated: one bad symbol never blocks the rest
"""
import re

path = '/home/gnelson021/gilded-signals/index.html'
with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

report = []

# ============================================================
# 1) NEW SCANNER SCRIPT (replaces the injected scanner IIFE)
# ============================================================
NEW_SCANNER = r'''<script>
(function(){
'use strict';
var QUOTE_API='/api/quote?symbol=';
var NEWS_API='/api/news?cat=';
var CG_URL='https://api.coingecko.com/api/v3/simple/price';
var CG_IDS={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',DOGE:'dogecoin',BNB:'binancecoin',AVAX:'avalanche-2',ADA:'cardano',LTC:'litecoin'};
var CG_NAMES={BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',XRP:'XRP',DOGE:'Dogecoin',BNB:'BNB',AVAX:'Avalanche',ADA:'Cardano',LTC:'Litecoin'};
var CRYPTO=Object.keys(CG_IDS);
var TABS={
  stocks:['SPY','VOO','QQQ','QQQM','VTI','VTV','SPMO','AAPL','MSFT','AMZN','TSLA','NFLX','GOOGL','META','MSTR','JPM','GLD'],
  tech:['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','LITE','PLTR','PANW','NOW','DELL','SMCI','NOK','SHOP','HPE','NBIS','SATS'],
  energy:['XOM','CVX','NEE','ENPH','FSLR','OXY','SLB','VLO','MPC','PSX'],
  crypto:['BTC','ETH','SOL','XRP','DOGE']
};
var QUICK=['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','PLTR','AVGO','ASML','MU','MRVL','VRT','COHR','NOW','DELL','SMCI','SHOP','NBIS','SPY','QQQ','VOO','VTI','NFLX','MSTR','BTC','ETH','SOL','XRP'];
var slots=[null,null];
var cache={};
var CACHE_TTL=45000;
var currentTab='stocks';
var refreshTimer=null;

function $(id){return document.getElementById(id);}
function toApi(s){var t=(s||'').toUpperCase().trim();if(t.indexOf('/')>=0)return t;if(CRYPTO.indexOf(t)>=0)return t+'/USD';return t;}
function disp(s){return (s||'').replace('/USD','');}
function isCrypto(s){return CRYPTO.indexOf(disp(s).toUpperCase())>=0;}
function fmt(v){if(v==null||isNaN(v))return '\u2014';var n=Number(v);if(n>=10000)return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});if(n>=1)return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return '$'+n.toFixed(4);}
function fmtPct(v){if(v==null||isNaN(v))return '\u2014';return (v>=0?'+':'')+Number(v).toFixed(2)+'%';}
function fmtVol(v){if(v==null||isNaN(v))return '\u2014';var n=Number(v);if(n>=1e9)return (n/1e9).toFixed(2)+'B';if(n>=1e6)return (n/1e6).toFixed(1)+'M';if(n>=1e3)return (n/1e3).toFixed(0)+'K';return String(Math.round(n));}
function pctCls(v){return v==null?'':(v>=0?'up':'dn');}
function signal(rsi,rvol){if(rsi==null)return 'Watch';var v=rvol||1;if(rsi>60&&v>1.2)return 'Bullish';if(rsi>60||(rsi>=45&&v>1.1))return 'Watch';if(rsi<35)return 'Bearish';return 'Neutral';}
function sigBadge(s){return '<span class="gs-sig-badge '+s.toLowerCase()+'">'+s+'</span>';}
function ft(url,ms){return new Promise(function(res,rej){var done=false;var t=setTimeout(function(){if(!done){done=true;rej(new Error('timeout'));}},ms||8000);fetch(url).then(function(r){if(!done){done=true;clearTimeout(t);res(r);}}).catch(function(e){if(!done){done=true;clearTimeout(t);rej(e);}});});}

function fetchStock(sym){
  var apiSym=toApi(sym);
  var c=cache[apiSym];
  if(c&&Date.now()-c.ts<CACHE_TTL)return Promise.resolve({ok:true,data:c.data});
  return ft(QUOTE_API+encodeURIComponent(apiSym),8000)
    .then(function(r){return r.json();})
    .then(function(d){if(d&&d.price!=null){cache[apiSym]={data:d,ts:Date.now()};return {ok:true,data:d};}return {ok:false,sym:sym};})
    .catch(function(){return {ok:false,sym:sym};});
}
function fetchCryptoBatch(bareList){
  var ids=bareList.map(function(b){return CG_IDS[b];}).filter(Boolean).join(',');
  if(!ids)return Promise.resolve({});
  var url=CG_URL+'?ids='+ids+'&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true';
  return ft(url,9000).then(function(r){return r.json();}).then(function(d){
    var out={};
    bareList.forEach(function(b){
      var o=d[CG_IDS[b]];
      if(o&&o.usd!=null){out[b]={ok:true,data:{symbol:b+'/USD',name:CG_NAMES[b]||b,price:o.usd,changePercent:o.usd_24h_change,change:null,volume:o.usd_24h_vol,rsi14:null,gildedScore:null,source:'coingecko'}};}
      else out[b]={ok:false,sym:b};
    });
    return out;
  }).catch(function(){var out={};bareList.forEach(function(b){out[b]={ok:false,sym:b};});return out;});
}
function fetchQuote(sym){
  if(isCrypto(sym)){
    var bare=disp(sym).toUpperCase();
    return Promise.all([fetchCryptoBatch([bare]),fetchStock(sym)]).then(function(arr){
      var cg=arr[0][bare],bk=arr[1];
      if(cg&&cg.ok){
        if(bk&&bk.ok){var m={};for(var k in bk.data)m[k]=bk.data[k];m.price=cg.data.price;m.changePercent=cg.data.changePercent;if(cg.data.volume!=null)m.volume=cg.data.volume;m.symbol=cg.data.symbol;m.name=cg.data.name;m.source='coingecko+';return {ok:true,data:m};}
        return cg;
      }
      if(bk&&bk.ok)return bk;
      return {ok:false,sym:sym};
    });
  }
  return fetchStock(sym);
}

/* ---------- PICKER ---------- */
function renderPills(){
  var w=$('gsPills');if(!w)return;
  w.innerHTML=QUICK.map(function(s){
    var p=slots.some(function(x){return x===s||x===toApi(s);});
    var c=CRYPTO.indexOf(s)>=0?'<span class="ctag">crypto</span>':'';
    return '<button class="gs-pill'+(p?' picked':'')+'"'+(p?' disabled':'')+' onclick="gsPick(\''+s+'\')">'+s+c+'</button>';
  }).join('');
}
function renderSlots(){
  [0,1].forEach(function(i){
    var el=$('gsSlot'+i),body=$('gsSlot'+i+'body'),v=slots[i];
    if(!el||!body)return;
    if(v){el.classList.add('filled');body.innerHTML='<span class="gs-slot-chip">'+disp(v)+'<button class="xbtn" onclick="gsRemove('+i+')">\u00d7</button></span>';}
    else{el.classList.remove('filled');body.innerHTML='<span class="gs-slot-empty">Tap a symbol above</span>';}
  });
}
function updateBtn(){
  var btn=$('gsRunBtn');if(!btn)return;
  var n=slots.filter(Boolean).length;
  if(n===0){btn.disabled=true;btn.textContent='Pick two assets';}
  else if(n===1){btn.disabled=true;btn.textContent='Pick one more';}
  else{btn.disabled=false;btn.textContent='Compare '+disp(slots[0])+' vs '+disp(slots[1])+' \u2192';}
}
function refreshPicker(){renderPills();renderSlots();updateBtn();}
window.gsPick=function(s){if(slots.some(function(x){return x===s||x===toApi(s);}))return;var i=slots.indexOf(null);if(i===-1){gsErr('Both slots full \u2014 remove one first.');return;}slots[i]=s;gsErr('');refreshPicker();};
window.gsAddTyped=function(){var inp=$('gsSearchInput');if(!inp)return;var v=inp.value.trim().toUpperCase();if(!v)return;if(slots.some(function(x){return x===v||disp(x)===v;})){gsErr(v+' already selected.');return;}var i=slots.indexOf(null);if(i===-1){gsErr('Both slots full.');return;}slots[i]=v;inp.value='';gsErr('');refreshPicker();};
window.gsRemove=function(i){slots[i]=null;gsErr('');refreshPicker();};
window.gsClearAll=function(){slots=[null,null];var inp=$('gsSearchInput');if(inp)inp.value='';var r=$('gsCmpResults');if(r)r.innerHTML='';gsErr('');refreshPicker();};
function gsErr(t){var e=$('gsErrMsg');if(e)e.textContent=t;}

/* ---------- COMPARE ---------- */
window.gsRunCompare=function(){
  if(slots.filter(Boolean).length<2)return;
  var ld=$('gsCmpLoading'),res=$('gsCmpResults');
  if(ld)ld.style.display='block';
  if(res)res.innerHTML='';
  Promise.all([fetchQuote(slots[0]),fetchQuote(slots[1])]).then(function(r){
    if(ld)ld.style.display='none';
    if(!r[0].ok||!r[1].ok){gsErr('Could not load data for '+(r[0].ok?disp(slots[1]):disp(slots[0]))+'. Try again.');return;}
    var a=r[0].data,b=r[1].data;
    if(res)res.innerHTML=buildVerdict(a,b)+buildCmpCards(a,b);
    loadNewsIntel(a,b);
  });
};
function loadNewsIntel(a,b){
  var sA=a.gildedScore,sB=b.gildedScore;
  var winner=(sA!=null&&sB!=null)?(sA>=sB?a:b):a;
  var winSym=disp(winner.symbol||slots[0]).toUpperCase();
  var cat=isCrypto(winSym)?'crypto':'market';
  ft(NEWS_API+cat,7000).then(function(r){return r.json();}).then(function(news){
    if(!Array.isArray(news)||!news.length)return;
    var rel=news.filter(function(n){return n.headline&&n.headline.toUpperCase().indexOf(winSym)>=0;}).slice(0,3);
    if(!rel.length)rel=news.slice(0,3);
    var html='<div class="gs-news-intel"><div class="gs-news-intel-hdr">\u2605 News Intelligence \u2014 Why '+winSym+' is in focus</div>'+rel.map(function(n){return '<div class="gs-news-card" onclick="window.open(\''+n.url+'\',\'_blank\')"><div class="gs-news-src">'+n.source+'</div><div class="gs-news-headline">'+n.headline+'</div><div class="gs-news-sum">'+n.summary+'</div></div>';}).join('')+'</div>';
    var res=$('gsCmpResults');if(res)res.innerHTML+=html;
  }).catch(function(){});
}
function buildVerdict(a,b){
  var sA=a.gildedScore,sB=b.gildedScore;
  var nA=disp(a.symbol||slots[0]),nB=disp(b.symbol||slots[1]);
  var main,sub;
  if(sA==null||sB==null){main='Live signals loaded';sub='Both assets pulled from live market data.';}
  else if(sA===sB){main=nA+' and '+nB+' are evenly matched';sub='Both score '+sA+'/100 on the Gilded Scale.';}
  else{var win=sA>sB?nA:nB,lose=sA>sB?nB:nA,hi=Math.max(sA,sB),lo=Math.min(sA,sB);main='<b>'+win+'</b> looks stronger right now';sub=hi+'/100 vs '+lo+'/100 \u2014 '+lose+' worth monitoring.';}
  var wd=(sA==null||sA>=sB)?a:b;
  var reasons=(wd.gildedReasons||[]).slice(0,4);
  var tags=reasons.length?'<div class="gs-reason-tags">'+reasons.map(function(x){return '<span class="gs-reason-tag">'+x+'</span>';}).join('')+'</div>':'';
  return '<div class="gs-verdict"><div class="gs-verdict-lbl">Gilded Verdict</div><div class="gs-verdict-main">'+main+'</div><div class="gs-verdict-sub">'+sub+'</div>'+tags+'</div>';
}
function buildCmpCards(a,b){
  var sA=a.gildedScore,sB=b.gildedScore;
  var aWins=sA!=null&&sB!=null&&sA>=sB;
  return '<div class="gs-cmp-cards">'+buildCard(a,aWins)+buildCard(b,!aWins&&sA!=null&&sB!=null)+'</div>';
}
function rangeBar(lo,hi,cur,lbl){
  if(lo==null||hi==null)return '<div class="gs-mrow"><span class="gs-mlbl">'+lbl+'</span><span class="gs-mval muted">\u2014</span></div>';
  var rng=hi-lo;var pct=rng>0?Math.min(Math.max((cur-lo)/rng*100,0),100):50;
  return '<div style="width:100%;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.026)"><div class="gs-range-bar-top"><span class="gs-range-bar-lbl">'+lbl+'</span><span class="gs-range-bar-cur">'+fmt(cur)+'</span></div><div class="gs-range-track"><div class="gs-range-fill" style="width:'+pct+'%"></div><div class="gs-range-cursor" style="left:calc('+pct+'% - 1px)"></div></div><div class="gs-range-ends"><span class="gs-range-end">'+fmt(lo)+'</span><span class="gs-range-end">'+fmt(hi)+'</span></div></div>';
}
function buildCard(d,isWin){
  var sym=disp(d.symbol||'');
  var p=d.changePercent;
  var chgStr=p==null?'\u2014':(p>=0?'\u25b2 ':'\u25bc ')+Math.abs(p).toFixed(2)+'%';
  var sig=signal(d.rsi14,d.rvol);
  var score=d.gildedScore;
  var scoreHtml=score!=null?'<div class="gs-score-block"><div class="gs-score-num">'+score+'</div><div style="flex:1"><div class="gs-score-bar-lbl">Gilded Score / 100</div><div class="gs-score-track"><div class="gs-score-fill" style="width:'+score+'%"></div></div></div>'+sigBadge(sig)+'</div>':'';
  var rv=d.rsi14;
  var rc=rv==null?'#9a9690':rv>=70?'#d97a7a':rv>=60?'#4ecb8d':rv>=45?'#c9a24b':'#9a9690';
  var rsiHtml=rv!=null?'<div class="gs-rsi-wrap"><div class="gs-rsi-val" style="color:'+rc+'">'+rv+'</div><div class="gs-rsi-track"><div class="gs-rsi-fill" style="width:'+Math.min(rv,100)+'%;background:'+rc+'"></div></div></div>':'<span class="gs-mval muted">\u2014</span>';
  var ema=d.emaStatus?d.emaStatus.charAt(0).toUpperCase()+d.emaStatus.slice(1):'\u2014';
  var emaCls=d.emaStatus&&d.emaStatus.toLowerCase().indexOf('above')>=0?'up':d.emaStatus?'dn':'muted';
  var macd=d.macdHist==null?'\u2014':d.macdHist>0?'\u25b2 Bullish':'\u25bc Bearish';
  var macdCls=d.macdHist==null?'muted':d.macdHist>0?'up':'dn';
  var retRows=[['1 Week','weekChange'],['1 Month','monthChange'],['YTD','ytdChange']].map(function(x){var v=d[x[1]];return v!=null?'<div class="gs-mrow"><span class="gs-mlbl">'+x[0]+'</span><span class="gs-mval '+pctCls(v)+'">'+fmtPct(v)+'</span></div>':'';}).join('');
  return '<div class="gs-cmp-card'+(isWin?' winner':'')+'">'+
    '<div class="gs-card-head"><div><div class="gs-card-sym">'+sym+(isWin?' <span style="font-size:.65rem;color:var(--gold)">\u2605</span>':'')+'</div><div class="gs-card-name">'+(d.name||sym)+'</div></div><div><div class="gs-card-price">'+fmt(d.price)+'</div><div class="gs-card-chg '+pctCls(p)+'">'+chgStr+'</div></div></div>'+
    scoreHtml+'<div class="gs-metrics">'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Price &amp; Range</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Open</span><span class="gs-mval">'+fmt(d.open)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Prev Close</span><span class="gs-mval">'+fmt(d.previousClose)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Today High</span><span class="gs-mval up">'+fmt(d.high)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Today Low</span><span class="gs-mval dn">'+fmt(d.low)+'</span></div>'+
    rangeBar(d.low,d.high,d.price,'Day Range')+
    '<div class="gs-mrow"><span class="gs-mlbl">52-Wk High</span><span class="gs-mval gold">'+fmt(d.week52High)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">52-Wk Low</span><span class="gs-mval dn">'+fmt(d.week52Low)+'</span></div>'+
    rangeBar(d.week52Low,d.week52High,d.price,'52-Week Range')+'</div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Momentum &amp; Technicals</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">RSI (14)</span>'+rsiHtml+'</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA Trend</span><span class="gs-mval '+emaCls+'">'+ema+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 20</span><span class="gs-mval muted">'+fmt(d.ema20)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 50</span><span class="gs-mval muted">'+fmt(d.ema50)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 200</span><span class="gs-mval muted">'+fmt(d.ema200)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">MACD</span><span class="gs-mval '+macdCls+'">'+macd+'</span></div></div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Volume</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Volume</span><span class="gs-mval">'+fmtVol(d.volume)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Avg Volume</span><span class="gs-mval muted">'+fmtVol(d.avgVolume)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Rel. Volume</span><span class="gs-mval '+(d.rvol!=null&&d.rvol>1.3?'up':d.rvol!=null&&d.rvol<0.7?'dn':'')+'">'+(d.rvol!=null?Number(d.rvol).toFixed(2)+'x':'\u2014')+'</span></div></div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Support &amp; Resistance</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Support</span><span class="gs-mval dn">'+fmt(d.support)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Resistance</span><span class="gs-mval up">'+fmt(d.resistance)+'</span></div></div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Performance</div>'+retRows+
    (d.analystRating?'<div class="gs-mrow"><span class="gs-mlbl">Analyst</span><span class="gs-mval gold">'+d.analystRating+'</span></div>':'')+
    (d.peRatio!=null?'<div class="gs-mrow"><span class="gs-mlbl">P/E Ratio</span><span class="gs-mval">'+Number(d.peRatio).toFixed(1)+'</span></div>':'')+
    '</div></div></div>';
}

/* ---------- GRID ---------- */
window.gsSetTab=function(tab,btn){
  currentTab=tab;
  var tabs=document.querySelectorAll('.gs-tab');
  for(var i=0;i<tabs.length;i++)tabs[i].classList.remove('active');
  if(btn)btn.classList.add('active');
  gsLoadGrid(tab);
};
function gsLoadGrid(tab){
  var grid=$('gsGrid');if(!grid)return;
  currentTab=tab;
  var syms=TABS[tab];
  grid.innerHTML='<div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;animation:gsPulse 1.4s infinite;">Pulling live data\u2026</div>';
  if(tab==='crypto'){
    var bare=syms.map(function(s){return disp(s).toUpperCase();});
    fetchCryptoBatch(bare).then(function(cg){
      if(currentTab!=='crypto')return;
      var results=bare.map(function(b){return cg[b]||{ok:false,sym:b};});
      grid.innerHTML=results.map(function(r,i){return buildGridCard(r,syms[i]);}).join('');
      bare.forEach(function(b,i){
        var base=results[i];
        fetchStock(b+'/USD').then(function(full){
          if(full.ok&&currentTab==='crypto'&&base&&base.ok){
            var m={};for(var k in full.data)m[k]=full.data[k];
            m.price=base.data.price;m.changePercent=base.data.changePercent;
            if(base.data.volume!=null)m.volume=base.data.volume;
            m.symbol=base.data.symbol;m.name=base.data.name;
            results[i]={ok:true,data:m};cache[b+'/USD']={data:m,ts:Date.now()};
            grid.innerHTML=results.map(function(r,j){return buildGridCard(r,syms[j]);}).join('');
          }
        }).catch(function(){});
      });
    });
    return;
  }
  var all=[];var bs=5;var idx=0;
  function nextBatch(){
    if(currentTab!==tab)return;
    var batch=syms.slice(idx,idx+bs);
    if(!batch.length)return;
    Promise.all(batch.map(function(s){return fetchStock(s);})).then(function(br){
      if(currentTab!==tab)return;
      all=all.concat(br);
      grid.innerHTML=all.map(function(r,j){return buildGridCard(r,syms[j]);}).join('');
      idx+=bs;
      if(idx<syms.length)setTimeout(nextBatch,250);
    });
  }
  nextBatch();
}
function buildGridCard(r,rawSym){
  if(!r||!r.ok)return '<div class="gs-gc" style="opacity:.35"><div class="gs-gc-head"><div><div class="gs-gc-sym">'+disp(rawSym)+'</div><div class="gs-gc-name">Unavailable</div></div></div></div>';
  var d=r.data;
  var sym=disp(d.symbol||rawSym);
  var chg=d.changePercent||0;
  var chgStr=(chg>=0?'\u25b2 ':'\u25bc ')+Math.abs(chg).toFixed(2)+'%';
  var sig=signal(d.rsi14,d.rvol);
  var rv=d.rsi14;
  var rc=rv==null?'#9a9690':rv>=70?'#d97a7a':rv>=60?'#4ecb8d':rv>=45?'#c9a24b':'#9a9690';
  var pct=0;if(d.low!=null&&d.high!=null){var rng=d.high-d.low;pct=rng>0?Math.min(Math.max((d.price-d.low)/rng*100,0),100):50;}
  var rangeHtml=(d.low!=null&&d.high!=null)?'<div class="gs-gc-range"><div class="gs-gc-range-lbl"><span>Day Range</span><span class="gs-gc-range-cur">'+fmt(d.price)+'</span></div><div class="gs-gc-track"><div class="gs-gc-fill" style="width:'+pct+'%"></div><div class="gs-gc-cursor" style="left:calc('+pct+'% - 1px)"></div></div><div class="gs-gc-ends"><span class="gs-gc-end">'+fmt(d.low)+'</span><span class="gs-gc-end">'+fmt(d.high)+'</span></div></div>':'';
  return '<div class="gs-gc '+(sig==='Bullish'?'bullish':'')+'" onclick="gsPick(\''+disp(rawSym)+'\');window.scrollTo({top:0,behavior:\'smooth\'});">'+
    '<div class="gs-gc-head"><div><div class="gs-gc-sym">'+sym+'</div><div class="gs-gc-name">'+(d.name||sym)+'</div></div><div><div class="gs-gc-price">'+fmt(d.price)+'</div><div class="gs-gc-chg '+pctCls(chg)+'">'+chgStr+'</div></div></div>'+
    '<div class="gs-gc-metrics">'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">RSI (14)</div><div class="gs-gc-mv" style="color:'+rc+'">'+(rv!=null?rv:'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Rel. Vol</div><div class="gs-gc-mv '+(d.rvol!=null&&d.rvol>1.3?'up':d.rvol!=null&&d.rvol<0.7?'dn':'')+'">'+(d.rvol!=null?Number(d.rvol).toFixed(2)+'x':'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Volume</div><div class="gs-gc-mv">'+fmtVol(d.volume)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">EMA</div><div class="gs-gc-mv '+(d.emaStatus&&d.emaStatus.toLowerCase().indexOf('above')>=0?'up':d.emaStatus?'dn':'muted')+'">'+(d.emaStatus?d.emaStatus.charAt(0).toUpperCase()+d.emaStatus.slice(1):'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Today High</div><div class="gs-gc-mv up">'+fmt(d.high)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Today Low</div><div class="gs-gc-mv dn">'+fmt(d.low)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">52W High</div><div class="gs-gc-mv gold">'+fmt(d.week52High)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">52W Low</div><div class="gs-gc-mv dn">'+fmt(d.week52Low)+'</div></div></div>'+
    rangeHtml+
    '<div class="gs-gc-footer">'+sigBadge(sig)+'<span class="gs-gc-hint">+ Add to compare</span></div></div>';
}

/* ---------- AUTO-REFRESH (live all day) ---------- */
function isScannerVisible(){var p=$('page-scanner');return p&&p.offsetParent!==null;}
function startRefresh(){
  if(refreshTimer)clearInterval(refreshTimer);
  refreshTimer=setInterval(function(){
    if(isScannerVisible()){cache={};gsLoadGrid(currentTab);}
  },60000);
}

/* ---------- INIT ---------- */
refreshPicker();
gsLoadGrid('stocks');
startRefresh();
var _osp=window.showPage;
window.showPage=function(id){
  if(_osp)_osp(id);
  if(id==='scanner')setTimeout(function(){if($('gsGrid'))gsLoadGrid(currentTab);},200);
};
})();
</script>'''

# Match the injected scanner script (unique: starts with (function(){ var API='/api/quote)
pat_scanner = re.compile(r"<script>\s*\(function\(\)\{\s*var API=.*?\}\)\(\);\s*</script>", re.DOTALL)
m = pat_scanner.search(html)
if m:
    html = html[:m.start()] + NEW_SCANNER + html[m.end():]
    report.append('OK  scanner script replaced')
else:
    report.append('MISS scanner script (var API anchor not found)')

# ============================================================
# 2) NEW TICKER SCRIPT (CoinGecko crypto, timeouts)
# ============================================================
NEW_TICKER = r'''<script>
/* LIVE TICKER + HERO PREVIEW (robust, CoinGecko crypto) */
(function(){
'use strict';
var QUOTE_API='/api/quote?symbol=';
var CG_URL='https://api.coingecko.com/api/v3/simple/price';
var CG_IDS={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',DOGE:'dogecoin'};
var STOCK_SYMS=['NVDA','AVGO','ASML','MU','MRVL','VRT','COHR','PLTR','AMD','TSLA','AAPL','MSFT','SPY','QQQ'];
var CRYPTO_SYMS=['BTC','ETH','SOL','XRP'];
function fmt(v){if(v==null||isNaN(v))return '\u2014';var n=Number(v);if(n>=10000)return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});if(n>=1)return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return '$'+n.toFixed(4);}
function ft(url,ms){return new Promise(function(res,rej){var done=false;var t=setTimeout(function(){if(!done){done=true;rej();}},ms||8000);fetch(url).then(function(r){if(!done){done=true;clearTimeout(t);res(r);}}).catch(function(){if(!done){done=true;clearTimeout(t);rej();}});});}
function getStock(s){return ft(QUOTE_API+encodeURIComponent(s),8000).then(function(r){return r.json();}).then(function(d){return (d&&d.price!=null)?d:null;}).catch(function(){return null;});}
function getCrypto(){var ids=CRYPTO_SYMS.map(function(b){return CG_IDS[b];}).join(',');return ft(CG_URL+'?ids='+ids+'&vs_currencies=usd&include_24hr_change=true',9000).then(function(r){return r.json();}).then(function(d){var out={};CRYPTO_SYMS.forEach(function(b){var o=d[CG_IDS[b]];if(o&&o.usd!=null)out[b]={price:o.usd,changePercent:o.usd_24h_change};});return out;}).catch(function(){return {};});}
function build(){
  Promise.all([Promise.all(STOCK_SYMS.map(getStock)),getCrypto()]).then(function(arr){
    var stocks=arr[0],crypto=arr[1];
    var items=[];
    STOCK_SYMS.forEach(function(s,i){var d=stocks[i];items.push(d?{sym:s,price:d.price,pct:d.changePercent}:{sym:s,price:null,pct:null});});
    CRYPTO_SYMS.forEach(function(s){var o=crypto[s];items.push(o?{sym:s,price:o.price,pct:o.changePercent}:{sym:s,price:null,pct:null});});
    var track=document.getElementById('liveTicker');
    if(track){
      var html=items.map(function(t){
        if(t.price==null)return '<div class="ticker-item"><span class="sym">'+t.sym+'</span>\u2014</div>';
        var cls=t.pct==null?'':(t.pct>=0?'up':'dn');
        var ar=t.pct==null?'':(t.pct>=0?'\u25b2':'\u25bc');
        var chg=t.pct!=null?'<span class="'+cls+'">'+ar+Math.abs(t.pct).toFixed(2)+'%</span>':'';
        return '<div class="ticker-item"><span class="sym">'+t.sym+'</span>'+fmt(t.price)+chg+'</div>';
      });
      track.innerHTML=html.concat(html).join('');
    }
    var btc=crypto.BTC;
    var bp=document.getElementById('dp-btc-price'),bc=document.getElementById('dp-btc-chg');
    if(btc&&bp)bp.textContent=fmt(btc.price);
    if(btc&&bc){var p=btc.changePercent;bc.textContent=p!=null?(p>=0?'+':'')+p.toFixed(2)+'%':'\u2014';bc.className='dp-stat-chg '+(p>=0?'up':'dn');}
    var nv=stocks[STOCK_SYMS.indexOf('NVDA')];
    var np=document.getElementById('dp-nvda-price'),nc=document.getElementById('dp-nvda-chg');
    if(nv&&np)np.textContent=fmt(nv.price);
    if(nv&&nc){var p2=nv.changePercent;nc.textContent=p2!=null?(p2>=0?'+':'')+p2.toFixed(2)+'%':'\u2014';nc.className='dp-stat-chg '+(p2>=0?'up':'dn');}
    var tbody=document.getElementById('dp-table-body');
    if(tbody){
      var tr=[['NVDA',stocks[STOCK_SYMS.indexOf('NVDA')]],['AVGO',stocks[STOCK_SYMS.indexOf('AVGO')]],['MU',stocks[STOCK_SYMS.indexOf('MU')]],['BTC',crypto.BTC?{price:crypto.BTC.price,rsi14:null,gildedBadge:'Watch'}:null],['ASML',stocks[STOCK_SYMS.indexOf('ASML')]]];
      tbody.innerHTML=tr.map(function(row){
        var sym=row[0],d=row[1];
        if(!d)return '<tr><td>'+sym+'</td><td>\u2014</td><td>\u2014</td><td>\u2014</td></tr>';
        var rsi=d.rsi14!=null?d.rsi14:'\u2014';
        var badge=d.gildedBadge||'Watch';
        var bc2=badge.toLowerCase().indexOf('bull')>=0?'badge-bullish':badge.toLowerCase().indexOf('watch')>=0?'badge-watch':'badge-neutral';
        return '<tr><td>'+sym+'</td><td>'+fmt(d.price)+'</td><td>'+rsi+'</td><td><span class="badge '+bc2+'">'+badge+'</span></td></tr>';
      }).join('');
    }
  });
}
build();
setInterval(build,45000);
})();
</script>'''

pat_ticker = re.compile(r"<script>\s*/\* LIVE TICKER \+ HERO PREVIEW.*?\}\)\(\);\s*</script>", re.DOTALL)
m2 = pat_ticker.search(html)
if m2:
    html = html[:m2.start()] + NEW_TICKER + html[m2.end():]
    report.append('OK  ticker script replaced')
else:
    report.append('MISS ticker script (LIVE TICKER anchor not found)')

# Ensure Energy tab button exists
if "gsSetTab('energy'" not in html and 'gsSetTab(&#39;energy&#39;' not in html:
    html = html.replace(
        '''<button class="gs-tab" onclick="gsSetTab('tech',this)">Tech &amp; AI</button>''',
        '''<button class="gs-tab" onclick="gsSetTab('tech',this)">Tech &amp; AI</button>
      <button class="gs-tab" onclick="gsSetTab('energy',this)">Energy</button>''', 1)
    report.append('OK  energy tab ensured')

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print('\n'.join(report))
print('\nDONE.')
