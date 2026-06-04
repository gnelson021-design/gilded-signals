path = '/home/gnelson021/gilded-signals/index.html'

with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

OLD = '''<div id="page-scanner" class="page">
  <div class="section-inner scanner-page">
    <div class="section-label">Scanner Preview</div>
    <h2 class="section-title">Market Scanner</h2>
    <p class="section-desc" style="margin-bottom:0.5rem;">Search any ticker for live price, change, day range, and volume.</p><p style="font-size:0.68rem;color:var(--text-muted);margin-bottom:2rem;line-height:1.6;max-width:680px;">Scanner labels are generated from live market data. They are for <strong style="color:var(--text-secondary);">educational research only</strong> and are not buy/sell recommendations.</p>
    <div class="scanner-search-box">
      <h3>Search a Ticker</h3>
      <p>Enter a symbol to pull signal data, momentum score, and risk level.</p>
      <div class="search-row">
        <div class="ticker-input-wrap">
          <label>Primary Symbol</label>
          <input class="ticker-input" id="ticker1" type="text" placeholder="e.g. NVDA, BTC, AAPL" maxlength="6"/>
        </div>
        <div class="ticker-input-wrap" id="compareWrap" style="display:block;">
          <label>Compare Symbol</label>
          <input class="ticker-input" id="ticker2" type="text" placeholder="e.g. AMD" maxlength="6"/>
        </div>
        <button class="btn-compare" id="compareBtn" onclick="toggleCompare()">+ Compare</button>
        <button class="btn-scan" onclick="runScan()">Scan ▶</button>
      </div>
      <div class="scan-counter">Free scans remaining: <span id="scanCount">5</span> of 5 &nbsp;·&nbsp; <a onclick="showPage(\'pricing\')" style="color:var(--gold);text-decoration:none;font-size:0.62rem;cursor:pointer;">Unlock unlimited →</a></div>
    </div>
    <div class="scan-results" id="scanResults">
      <div class="result-header">
        <div><div class="result-sym" id="resSym">—</div><div class="result-name" id="resName">—</div></div>
        <div><div class="result-price" id="resPrice">—</div><div class="result-chg" id="resChg">—</div></div>
      </div>
      <div class="result-grid" id="resMetrics"></div>
      <div class="signal-box">
        <div class="signal-score">
          <div class="signal-score-num" id="resSignalNum">—</div>
          <div class="signal-score-label">Signal Strength</div>
          <div style="margin-top:1rem;"><span id="resSignalBadge" class="badge">—</span></div>
          <div style="margin-top:0.5rem;font-size:0.65rem;color:var(--text-muted);">Risk Level: <span id="resRisk" style="color:var(--text-secondary);">—</span></div>
        </div>
        <div class="signal-bars" id="resSignalBars"></div>
      </div>
    </div>
    <div class="paywall-overlay" id="paywallBox" style="display:none;">
      <div style="font-size:2rem;margin-bottom:1rem;">🔒</div>
      <h3>You\'ve Used Your 5 Free Scans</h3>
      <p>Unlock unlimited scanner searches, stock comparisons, and watchlist signals with Gilded Scanner Access.</p>
      <button class="btn-primary" onclick="showPage(\'pricing\')">Unlock Unlimited Access</button>
      <div class="plan-note" style="font-size:0.63rem;color:var(--text-muted);text-align:center;margin-top:1rem;">$24.99/month · Cancel anytime</div>
    </div>
    <div style="margin-top:3rem;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1rem;margin-bottom:1rem;">
        <div><div class="section-label">All Assets</div><p style="font-size:0.8rem;color:var(--text-secondary);">Tracked signals across AI infrastructure and crypto.</p></div>
        <div style="display:flex;gap:8px;" id="assetFilters">
          <button class="filter-btn active" onclick="filterAssets(\'all\',this)">All</button>
          <button class="filter-btn" onclick="filterAssets(\'stock\',this)">Stocks</button>
          <button class="filter-btn" onclick="filterAssets(\'crypto\',this)">Crypto</button>
          <button class="filter-btn" onclick="filterAssets(\'buy\',this)">Bullish Signals</button>
        </div>
      </div>
      <div class="scanner-all-grid" id="allAssetsGrid"></div>
    </div>
  </div>
</div>'''

NEW = '''<div id="page-scanner" class="page">
<style>
/* ── GILDED SCANNER STYLES ── */
.gs-scanner-wrap{max-width:960px;margin:0 auto;padding:40px 20px 80px;}
.gs-eyebrow{font-family:'DM Sans',sans-serif;font-size:.58rem;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);opacity:.85;margin-bottom:10px;}
.gs-title{font-family:'Cormorant Garamond',serif;font-size:2.4rem;font-weight:600;background:linear-gradient(180deg,#fff,#e8ca7a);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 6px;line-height:1.1;}
.gs-sub{color:#9a9690;font-size:.92rem;font-weight:300;line-height:1.6;margin-bottom:28px;}
/* Picker */
.gs-picker{background:linear-gradient(180deg,#111115,#0c0c11);border:1px solid rgba(201,162,75,.15);border-radius:16px;padding:26px 24px 22px;box-shadow:0 28px 64px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.03);margin-bottom:24px;}
.gs-step{display:flex;align-items:center;gap:8px;margin-bottom:14px;}
.gs-step-num{width:20px;height:20px;border-radius:50%;background:rgba(201,162,75,.15);border:1px solid rgba(201,162,75,.2);display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:.6rem;color:var(--gold);flex-shrink:0;}
.gs-step-txt{font-family:monospace;font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:#7a7770;}
.gs-step-txt b{color:var(--gold);}
.gs-pills{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:20px;}
.gs-pill{font-family:monospace;font-size:.74rem;font-weight:500;padding:7px 13px;border-radius:999px;cursor:pointer;background:#16161c;border:1px solid rgba(255,255,255,.055);color:#f0ece2;transition:.15s;letter-spacing:.04em;}
.gs-pill:hover{border-color:var(--gold);color:#e8ca7a;transform:translateY(-1px);}
.gs-pill.picked{background:rgba(201,162,75,.12);border-color:var(--gold);color:#e8ca7a;cursor:default;opacity:.5;}
.gs-pill .ctag{opacity:.5;font-size:.58rem;margin-left:4px;}
.gs-slots{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
.gs-slot{background:#16161c;border:1px dashed rgba(201,162,75,.15);border-radius:13px;padding:15px;min-height:88px;display:flex;flex-direction:column;justify-content:center;transition:.18s;}
.gs-slot.filled{border-style:solid;border-color:var(--gold);background:linear-gradient(180deg,rgba(201,162,75,.07),transparent);}
.gs-slot-lbl{font-family:monospace;font-size:.55rem;letter-spacing:.22em;text-transform:uppercase;color:#7a7770;margin-bottom:9px;}
.gs-slot-empty{color:#7a7770;font-size:.82rem;font-weight:300;}
.gs-slot-chip{display:inline-flex;align-items:center;gap:9px;font-family:monospace;font-size:1.1rem;font-weight:700;color:#e8ca7a;}
.gs-slot-chip .xbtn{width:21px;height:21px;border-radius:50%;border:1px solid rgba(201,162,75,.2);background:transparent;color:#7a7770;cursor:pointer;font-size:.85rem;display:flex;align-items:center;justify-content:center;transition:.14s;}
.gs-slot-chip .xbtn:hover{color:#fff;border-color:#d97a7a;background:rgba(217,122,122,.12);}
.gs-search-row{display:flex;gap:8px;margin:14px 0 4px;}
.gs-input{flex:1;background:#0a0a0e;border:1px solid rgba(255,255,255,.055);border-radius:10px;padding:10px 13px;color:#f0ece2;font-family:monospace;font-size:.9rem;letter-spacing:.06em;text-transform:uppercase;outline:none;transition:.15s;}
.gs-input::placeholder{color:#4a4840;text-transform:none;letter-spacing:0;}
.gs-input:focus{border-color:var(--gold);}
.gs-add-btn{background:transparent;border:1px solid rgba(201,162,75,.2);color:var(--gold);border-radius:10px;padding:0 16px;font-family:monospace;font-size:.68rem;letter-spacing:.12em;cursor:pointer;transition:.15s;}
.gs-add-btn:hover{border-color:var(--gold);background:rgba(201,162,75,.1);}
.gs-actions{display:flex;gap:10px;margin-top:20px;}
.gs-clear-btn{background:transparent;border:1px solid rgba(255,255,255,.055);color:#9a9690;border-radius:11px;padding:12px 20px;font-size:.8rem;font-weight:500;cursor:pointer;transition:.15s;}
.gs-clear-btn:hover{color:#f0ece2;border-color:rgba(201,162,75,.2);}
.gs-run-btn{flex:1;border:none;border-radius:11px;padding:14px 24px;cursor:pointer;font-family:monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;transition:.2s;background:linear-gradient(135deg,#c9a24b,#e8ca7a);color:#1a1407;box-shadow:0 8px 24px rgba(201,162,75,.28);}
.gs-run-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 14px 32px rgba(201,162,75,.4);}
.gs-run-btn:disabled{background:#1a1a20;color:#4a4740;cursor:not-allowed;box-shadow:none;border:1px solid rgba(255,255,255,.055);}
.gs-errmsg{text-align:center;font-size:.8rem;color:#d97a7a;min-height:1em;margin-top:10px;}
/* Loading */
.gs-loading{display:none;text-align:center;color:var(--gold);font-family:monospace;font-size:.75rem;letter-spacing:.2em;text-transform:uppercase;padding:32px 0;animation:gsPulse 1.4s ease infinite;}
@keyframes gsPulse{0%,100%{opacity:.3}50%{opacity:1}}
/* Verdict */
.gs-verdict{text-align:center;padding:28px 22px;border-radius:15px;background:linear-gradient(180deg,rgba(201,162,75,.09),transparent);border:1px solid rgba(201,162,75,.15);margin-bottom:20px;animation:gsRise .5s ease forwards;}
@keyframes gsRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.gs-verdict-lbl{font-family:monospace;font-size:.56rem;letter-spacing:.28em;text-transform:uppercase;color:#7a7770;margin-bottom:10px;}
.gs-verdict-main{font-family:'Cormorant Garamond',serif;font-size:1.85rem;font-weight:600;color:#f0ece2;}
.gs-verdict-main b{color:#e8ca7a;}
.gs-verdict-sub{color:#9a9690;font-size:.88rem;margin-top:8px;font-weight:300;}
.gs-reason-tags{margin-top:14px;display:flex;flex-wrap:wrap;gap:7px;justify-content:center;}
.gs-reason-tag{font-family:monospace;font-size:.62rem;padding:5px 11px;border-radius:999px;background:rgba(201,162,75,.1);border:1px solid rgba(201,162,75,.2);color:#e8ca7a;}
/* Compare cards */
.gs-cmp-cards{display:grid;grid-template-columns:1fr 1fr;gap:14px;animation:gsRise .5s .1s ease both;}
.gs-cmp-card{background:#111115;border:1px solid rgba(255,255,255,.055);border-radius:16px;overflow:hidden;}
.gs-cmp-card.winner{border-color:var(--gold);box-shadow:0 0 28px rgba(201,162,75,.12);}
.gs-card-head{padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.055);display:flex;justify-content:space-between;align-items:flex-start;background:linear-gradient(180deg,#16161c,transparent);}
.gs-card-sym{font-family:monospace;font-size:1.2rem;font-weight:700;color:#e8ca7a;}
.gs-card-name{font-size:.72rem;color:#7a7770;margin-top:3px;font-weight:300;}
.gs-card-price{font-family:monospace;font-size:1.05rem;font-weight:700;text-align:right;}
.gs-card-chg{font-family:monospace;font-size:.78rem;font-weight:600;text-align:right;margin-top:3px;}
.gs-card-chg.up{color:#4ecb8d;} .gs-card-chg.dn{color:#d97a7a;}
/* Score bar */
.gs-score-block{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.055);display:flex;align-items:center;gap:14px;}
.gs-score-num{font-family:monospace;font-size:1.5rem;font-weight:700;color:#e8ca7a;line-height:1;flex-shrink:0;}
.gs-score-bar-lbl{font-family:monospace;font-size:.52rem;letter-spacing:.16em;text-transform:uppercase;color:#7a7770;margin-bottom:5px;}
.gs-score-track{height:5px;background:#1c1c23;border-radius:3px;overflow:hidden;}
.gs-score-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#c9a24b,#e8ca7a);transition:width .6s cubic-bezier(.4,0,.2,1);}
.gs-sig-badge{font-family:monospace;font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:999px;flex-shrink:0;}
.gs-sig-badge.bullish{background:rgba(78,203,141,.12);border:1px solid rgba(78,203,141,.3);color:#4ecb8d;}
.gs-sig-badge.watch{background:rgba(201,162,75,.12);border:1px solid rgba(201,162,75,.2);color:#e8ca7a;}
.gs-sig-badge.neutral{background:rgba(122,119,112,.1);border:1px solid rgba(255,255,255,.055);color:#9a9690;}
.gs-sig-badge.bearish{background:rgba(217,122,122,.1);border:1px solid rgba(217,122,122,.28);color:#d97a7a;}
/* Metric sections */
.gs-metrics{padding:4px 0 8px;}
.gs-metric-sec{padding:10px 18px 4px;}
.gs-metric-sec-lbl{font-family:monospace;font-size:.5rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);opacity:.65;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,.04);}
.gs-mrow{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.026);}
.gs-mrow:last-child{border-bottom:none;}
.gs-mlbl{font-size:.75rem;color:#9a9690;}
.gs-mval{font-family:monospace;font-size:.8rem;color:#f0ece2;font-weight:500;}
.gs-mval.up{color:#4ecb8d;} .gs-mval.dn{color:#d97a7a;} .gs-mval.gold{color:#e8ca7a;} .gs-mval.muted{color:#7a7770;}
/* Range bar */
.gs-range-bar{width:100%;}
.gs-range-bar-top{display:flex;justify-content:space-between;margin-bottom:4px;}
.gs-range-bar-lbl{font-size:.7rem;color:#7a7770;}
.gs-range-bar-cur{font-family:monospace;font-size:.62rem;color:#f0ece2;}
.gs-range-track{position:relative;height:4px;background:#1c1c23;border-radius:2px;}
.gs-range-fill{position:absolute;height:100%;background:linear-gradient(90deg,#c9a24b,#e8ca7a);border-radius:2px;}
.gs-range-cursor{position:absolute;top:-4px;width:2px;height:12px;background:#fff;border-radius:1px;}
.gs-range-ends{display:flex;justify-content:space-between;margin-top:4px;}
.gs-range-end{font-family:monospace;font-size:.56rem;color:#7a7770;}
/* RSI gauge */
.gs-rsi-wrap{display:flex;align-items:center;gap:10px;width:100%;}
.gs-rsi-val{font-family:monospace;font-size:.8rem;font-weight:600;min-width:34px;text-align:right;}
.gs-rsi-track{flex:1;height:6px;background:#1c1c23;border-radius:3px;overflow:hidden;}
.gs-rsi-fill{height:100%;border-radius:3px;}
/* News intelligence */
.gs-news-intel{margin-top:20px;padding:20px 22px;background:linear-gradient(180deg,rgba(201,162,75,.06),transparent);border:1px solid rgba(201,162,75,.12);border-radius:14px;animation:gsRise .5s .2s ease both;}
.gs-news-intel-hdr{font-family:monospace;font-size:.58rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:14px;}
.gs-news-card{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;}
.gs-news-card:last-child{border-bottom:none;}
.gs-news-card:hover .gs-news-headline{color:#e8ca7a;}
.gs-news-src{font-family:monospace;font-size:.58rem;color:#7a7770;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;}
.gs-news-headline{font-size:.88rem;color:#f0ece2;line-height:1.45;margin-bottom:4px;transition:.15s;}
.gs-news-sum{font-size:.76rem;color:#9a9690;line-height:1.5;}
/* Scanner grid */
.gs-grid-section{margin-top:52px;}
.gs-tabs{display:flex;gap:6px;margin:18px 0 22px;}
.gs-tab{font-family:monospace;font-size:.66rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;padding:8px 18px;border-radius:999px;cursor:pointer;background:#16161c;border:1px solid rgba(255,255,255,.055);color:#9a9690;transition:.15s;}
.gs-tab:hover{color:#f0ece2;border-color:rgba(201,162,75,.2);}
.gs-tab.active{background:rgba(201,162,75,.12);border-color:var(--gold);color:#e8ca7a;}
.gs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
.gs-gc{background:#111115;border:1px solid rgba(255,255,255,.055);border-radius:16px;overflow:hidden;cursor:pointer;transition:border-color .18s,box-shadow .18s,transform .18s;animation:gsRise .4s ease both;}
.gs-gc:hover{border-color:rgba(201,162,75,.35);box-shadow:0 8px 28px rgba(0,0,0,.5);transform:translateY(-2px);}
.gs-gc.bullish{border-color:rgba(78,203,141,.22);}
.gs-gc-head{padding:14px 16px 11px;display:flex;justify-content:space-between;align-items:flex-start;background:linear-gradient(180deg,#16161c,transparent);border-bottom:1px solid rgba(255,255,255,.04);}
.gs-gc-sym{font-family:monospace;font-size:1rem;font-weight:700;color:#e8ca7a;}
.gs-gc-name{font-size:.68rem;color:#7a7770;margin-top:2px;font-weight:300;}
.gs-gc-price{font-family:monospace;font-size:.95rem;font-weight:700;text-align:right;}
.gs-gc-chg{font-family:monospace;font-size:.72rem;font-weight:600;text-align:right;margin-top:2px;}
.gs-gc-chg.up{color:#4ecb8d;} .gs-gc-chg.dn{color:#d97a7a;}
.gs-gc-metrics{padding:11px 16px 9px;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);}
.gs-gc-m{display:flex;flex-direction:column;gap:2px;}
.gs-gc-ml{font-size:.6rem;color:#7a7770;text-transform:uppercase;letter-spacing:.08em;}
.gs-gc-mv{font-family:monospace;font-size:.8rem;color:#f0ece2;font-weight:500;}
.gs-gc-mv.up{color:#4ecb8d;} .gs-gc-mv.dn{color:#d97a7a;} .gs-gc-mv.gold{color:#e8ca7a;} .gs-gc-mv.muted{color:#7a7770;}
.gs-gc-range{padding:9px 16px 13px;}
.gs-gc-range-lbl{display:flex;justify-content:space-between;font-size:.58rem;color:#7a7770;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px;}
.gs-gc-range-cur{font-family:monospace;font-size:.6rem;color:#f0ece2;}
.gs-gc-track{width:100%;height:4px;background:#1c1c23;border-radius:2px;position:relative;}
.gs-gc-fill{position:absolute;height:100%;background:linear-gradient(90deg,#c9a24b,#e8ca7a);border-radius:2px;}
.gs-gc-cursor{position:absolute;top:-4px;width:2px;height:12px;background:#fff;border-radius:1px;}
.gs-gc-ends{display:flex;justify-content:space-between;margin-top:4px;}
.gs-gc-end{font-family:monospace;font-size:.58rem;color:#7a7770;}
.gs-gc-footer{padding:9px 16px;display:flex;align-items:center;justify-content:space-between;}
.gs-gc-hint{font-size:.58rem;color:#7a7770;font-style:italic;}
@media(max-width:640px){.gs-slots,.gs-cmp-cards{grid-template-columns:1fr;}.gs-actions{flex-direction:column-reverse;}.gs-clear-btn{width:100%;}.gs-grid{grid-template-columns:1fr;}}
</style>
<div class="gs-scanner-wrap">
  <div class="gs-eyebrow">Gilded Signals · Live Market Intelligence</div>
  <h2 class="gs-title">Compare Two Assets</h2>
  <p class="gs-sub">Pick any two stocks or crypto — see every metric side by side. Price, range, RSI, EMA, MACD, volume, support/resistance, Gilded Score, and live news context.</p>
  <div class="gs-picker">
    <div class="gs-step"><div class="gs-step-num">1</div><div class="gs-step-txt">Tap two to compare <b>or search below</b></div></div>
    <div class="gs-pills" id="gsPills"></div>
    <div class="gs-slots">
      <div class="gs-slot" id="gsSlot0"><div class="gs-slot-lbl">Asset A</div><div id="gsSlot0body"><span class="gs-slot-empty">Tap a symbol above</span></div></div>
      <div class="gs-slot" id="gsSlot1"><div class="gs-slot-lbl">Asset B</div><div id="gsSlot1body"><span class="gs-slot-empty">Tap a symbol above</span></div></div>
    </div>
    <div class="gs-search-row">
      <input class="gs-input" id="gsSearchInput" type="text" placeholder="Or type any ticker, e.g. NFLX" maxlength="8" onkeydown="if(event.key===\'Enter\')gsAddTyped()">
      <button class="gs-add-btn" onclick="gsAddTyped()">ADD</button>
    </div>
    <div class="gs-actions">
      <button class="gs-clear-btn" onclick="gsClearAll()">Clear</button>
      <button class="gs-run-btn" id="gsRunBtn" onclick="gsRunCompare()" disabled>Pick two assets</button>
    </div>
    <div class="gs-errmsg" id="gsErrMsg"></div>
  </div>
  <div class="gs-loading" id="gsCmpLoading">Pulling live data…</div>
  <div id="gsCmpResults"></div>
  <div class="gs-grid-section">
    <div class="gs-eyebrow">Market Scanner</div>
    <h2 class="gs-title" style="font-size:1.9rem;">Live Signal Grid</h2>
    <p class="gs-sub" style="margin-bottom:0;">Click any card to load it into the compare tool.</p>
    <div class="gs-tabs">
      <button class="gs-tab active" onclick="gsSetTab(\'stocks\',this)">Stocks</button>
      <button class="gs-tab" onclick="gsSetTab(\'tech\',this)">Tech &amp; AI</button>
      <button class="gs-tab" onclick="gsSetTab(\'crypto\',this)">Crypto</button>
    </div>
    <div class="gs-grid" id="gsGrid"><div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;">Loading live data…</div></div>
  </div>
  <div style="text-align:center;padding:40px 20px 0;max-width:600px;margin:0 auto;">
    <p style="font-size:.68rem;color:#7a7770;line-height:1.7;">All data sourced from Gilded Signals live API (Alpaca, Finnhub, CoinGecko). <strong style="color:#9a9690;">Educational research only — not financial advice.</strong></p>
  </div>
</div>
<script>
(function(){
var API='/api/quote?symbol=';
var NEWS_API='/api/news?cat=';
var QUICK=['NVDA','TSLA','AAPL','MSFT','AMZN','GOOGL','META','AMD','PLTR','AVGO','ASML','MU','MRVL','VRT','COHR','PANW','SPY','QQQ','JPM','GLD','BTC','ETH','SOL','XRP'];
var CRYPTO=['BTC','ETH','SOL','XRP','DOGE'];
var TABS={stocks:['SPY','QQQ','TSLA','AMZN','MSFT','JPM','GLD','BAC'],tech:['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','PLTR','PANW'],crypto:['BTC/USD','ETH/USD','SOL/USD','XRP/USD']};
var slots=[null,null];
function toApi(s){var t=s.toUpperCase().trim();if(t.includes('/'))return t;if(CRYPTO.includes(t))return t+'/USD';return t;}
function disp(s){return s.replace('/USD','');}
function fmt(v){if(v==null)return '\u2014';var n=Number(v);if(n>=10000)return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});if(n>=1000)return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return '$'+n.toFixed(2);}
function fmtPct(v){if(v==null)return '\u2014';return (v>=0?'+':'')+Number(v).toFixed(2)+'%';}
function fmtVol(v){if(v==null)return '\u2014';var n=Number(v);if(n>=1e9)return (n/1e9).toFixed(2)+'B';if(n>=1e6)return (n/1e6).toFixed(1)+'M';if(n>=1e3)return (n/1e3).toFixed(0)+'K';return String(n);}
function pctCls(v){return v==null?'':(v>=0?'up':'dn');}
function signal(rsi,rvol){if(rsi==null)return 'Watch';var v=rvol||1;if(rsi>60&&v>1.2)return 'Bullish';if(rsi>60||(rsi>=45&&v>1.1))return 'Watch';if(rsi<35)return 'Bearish';return 'Neutral';}
function sigBadge(s){var c=s.toLowerCase();return '<span class="gs-sig-badge '+c+'">'+s+'</span>';}
async function fetchQ(sym){try{var r=await fetch(API+encodeURIComponent(toApi(sym)));var d=await r.json();return(d&&d.price!=null)?{ok:true,data:d}:{ok:false};}catch(e){return{ok:false};}}

/* ── PICKER ── */
function renderPills(){
  document.getElementById('gsPills').innerHTML=QUICK.map(function(s){
    var p=slots.some(function(x){return x===s||x===toApi(s);});
    var c=CRYPTO.includes(s)?'<span class="ctag">crypto</span>':'';
    return'<button class="gs-pill'+(p?' picked':'')+'"'+(p?' disabled':'')+' onclick="gsPick(\''+s+'\')">'+s+c+'</button>';
  }).join('');
}
function renderSlots(){
  [0,1].forEach(function(i){
    var el=document.getElementById('gsSlot'+i);
    var body=document.getElementById('gsSlot'+i+'body');
    var v=slots[i];
    if(v){el.classList.add('filled');body.innerHTML='<span class="gs-slot-chip">'+disp(v)+'<button class="xbtn" onclick="gsRemove('+i+')">×</button></span>';}
    else{el.classList.remove('filled');body.innerHTML='<span class="gs-slot-empty">Tap a symbol above</span>';}
  });
}
function updateBtn(){
  var btn=document.getElementById('gsRunBtn');
  var n=slots.filter(Boolean).length;
  if(n===0){btn.disabled=true;btn.textContent='Pick two assets';}
  else if(n===1){btn.disabled=true;btn.textContent='Pick one more';}
  else{btn.disabled=false;btn.textContent='Compare '+disp(slots[0])+' vs '+disp(slots[1])+' \u2192';}
}
function refreshPicker(){renderPills();renderSlots();updateBtn();}
window.gsPick=function(s){if(slots.some(function(x){return x===s||x===toApi(s);}))return;var i=slots.indexOf(null);if(i===-1){gsErr('Both slots full \u2014 remove one first.');return;}slots[i]=s;gsErr('');refreshPicker();};
window.gsAddTyped=function(){var inp=document.getElementById('gsSearchInput');var v=inp.value.trim().toUpperCase();if(!v)return;if(slots.some(function(x){return x===v||disp(x)===v;})){gsErr(v+' already selected.');return;}var i=slots.indexOf(null);if(i===-1){gsErr('Both slots full.');return;}slots[i]=v;inp.value='';gsErr('');refreshPicker();};
window.gsRemove=function(i){slots[i]=null;gsErr('');refreshPicker();};
window.gsClearAll=function(){slots=[null,null];document.getElementById('gsSearchInput').value='';document.getElementById('gsCmpResults').innerHTML='';gsErr('');refreshPicker();};
function gsErr(t){document.getElementById('gsErrMsg').textContent=t;}

/* ── COMPARE RUN ── */
window.gsRunCompare=async function(){
  if(slots.filter(Boolean).length<2)return;
  document.getElementById('gsCmpLoading').style.display='block';
  document.getElementById('gsCmpResults').innerHTML='';
  var results=await Promise.all([fetchQ(slots[0]),fetchQ(slots[1])]);
  document.getElementById('gsCmpLoading').style.display='none';
  if(!results[0].ok||!results[1].ok){gsErr('Could not load data for '+(results[0].ok?disp(slots[1]):disp(slots[0]))+'. Try again.');return;}
  var a=results[0].data,b=results[1].data;
  var html=buildVerdict(a,b)+buildCmpCards(a,b);
  /* fetch news for winner */
  var sA=a.gildedScore,sB=b.gildedScore;
  var winner=sA!=null&&sB!=null?(sA>=sB?a:b):a;
  var winSym=(winner.symbol||slots[0]).replace('/USD','');
  var isCrypto=CRYPTO.includes(winSym);
  var newsCat=isCrypto?'crypto':'market';
  document.getElementById('gsCmpResults').innerHTML=html;
  /* load news async */
  try{
    var nr=await fetch(NEWS_API+newsCat);
    var news=await nr.json();
    if(Array.isArray(news)&&news.length){
      var relevant=news.filter(function(n){return n.headline&&n.headline.toUpperCase().includes(winSym);}).slice(0,3);
      if(!relevant.length)relevant=news.slice(0,3);
      var newsHtml='<div class="gs-news-intel"><div class="gs-news-intel-hdr">\u2605 News Intelligence \u2014 Why '+winSym+' is in focus</div>'+relevant.map(function(n){return'<div class="gs-news-card" onclick="window.open(\''+n.url+'\',\'_blank\')"><div class="gs-news-src">'+n.source+'</div><div class="gs-news-headline">'+n.headline+'</div><div class="gs-news-sum">'+n.summary+'</div></div>';}).join('')+'</div>';
      document.getElementById('gsCmpResults').innerHTML+=newsHtml;
    }
  }catch(e){}
};

function buildVerdict(a,b){
  var sA=a.gildedScore,sB=b.gildedScore;
  var nA=disp(a.symbol||slots[0]),nB=disp(b.symbol||slots[1]);
  var main,sub;
  if(sA==null||sB==null){main='Live signals loaded';sub='Both assets pulled from your live API.';}
  else if(sA===sB){main=nA+' and '+nB+' are evenly matched';sub='Both score '+sA+'/100 on the Gilded Scale.';}
  else{var win=sA>sB?nA:nB,lose=sA>sB?nB:nA,hi=Math.max(sA,sB),lo=Math.min(sA,sB);main='<b>'+win+'</b> looks stronger right now';sub=hi+'/100 vs '+lo+'/100 \u2014 '+lose+' worth monitoring.';}
  var winData=sA==null||sA>=sB?a:b;
  var reasons=(winData.gildedReasons||[]).slice(0,4);
  var tags=reasons.length?'<div class="gs-reason-tags">'+reasons.map(function(r){return'<span class="gs-reason-tag">'+r+'</span>';}).join('')+'</div>':'';
  return'<div class="gs-verdict"><div class="gs-verdict-lbl">Gilded Verdict</div><div class="gs-verdict-main">'+main+'</div><div class="gs-verdict-sub">'+sub+'</div>'+tags+'</div>';
}

function buildCmpCards(a,b){
  var sA=a.gildedScore,sB=b.gildedScore;
  var aWins=sA!=null&&sB!=null&&sA>=sB;
  return'<div class="gs-cmp-cards">'+buildCard(a,aWins)+buildCard(b,!aWins&&sA!=null&&sB!=null)+'</div>';
}

function buildCard(d,isWin){
  var sym=disp(d.symbol||'');
  var chgPct=d.changePercent;
  var chgCls=pctCls(chgPct);
  var chgStr=chgPct==null?'\u2014':(chgPct>=0?'\u25b2 ':'\u25bc ')+Math.abs(chgPct).toFixed(2)+'%';
  var sig=signal(d.rsi14,d.rvol);
  var sigLC=sig.toLowerCase();
  var score=d.gildedScore;
  var scoreHtml=score!=null?'<div class="gs-score-block"><div class="gs-score-num">'+score+'</div><div style="flex:1"><div class="gs-score-bar-lbl">Gilded Score / 100</div><div class="gs-score-track"><div class="gs-score-fill" style="width:'+score+'%"></div></div></div>'+sigBadge(sig)+'</div>':'';
  var rsiVal=d.rsi14;
  var rsiColor=rsiVal==null?'#9a9690':rsiVal>=70?'#d97a7a':rsiVal>=60?'#4ecb8d':rsiVal>=45?'#c9a24b':'#9a9690';
  var rsiHtml=rsiVal!=null?'<div class="gs-rsi-wrap"><div class="gs-rsi-val" style="color:'+rsiColor+'">'+rsiVal+'</div><div class="gs-rsi-track"><div class="gs-rsi-fill" style="width:'+Math.min(rsiVal,100)+'%;background:'+rsiColor+'"></div></div></div>':'<span class="gs-mval muted">\u2014</span>';
  var emaStatus=d.emaStatus?d.emaStatus.charAt(0).toUpperCase()+d.emaStatus.slice(1):'\u2014';
  var emaCls=d.emaStatus&&d.emaStatus.toLowerCase().includes('above')?'up':d.emaStatus?'dn':'muted';
  var macdTxt=d.macdHist==null?'\u2014':d.macdHist>0?'\u25b2 Bullish':'\u25bc Bearish';
  var macdCls=d.macdHist==null?'muted':d.macdHist>0?'up':'dn';
  function rangeBar(lo,hi,cur,lbl){
    if(lo==null||hi==null)return'<div class="gs-mrow"><span class="gs-mlbl">'+lbl+'</span><span class="gs-mval muted">\u2014</span></div>';
    var rng=hi-lo;var pct=rng>0?Math.min(Math.max((cur-lo)/rng*100,0),100):50;
    return'<div style="width:100%;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.026)"><div class="gs-range-bar-top"><span class="gs-range-bar-lbl">'+lbl+'</span><span class="gs-range-bar-cur">'+fmt(cur)+'</span></div><div class="gs-range-track"><div class="gs-range-fill" style="width:'+pct+'%"></div><div class="gs-range-cursor" style="left:calc('+pct+'% - 1px)"></div></div><div class="gs-range-ends"><span class="gs-range-end">'+fmt(lo)+'</span><span class="gs-range-end">'+fmt(hi)+'</span></div></div>';
  }
  var retRows=['1 Week,weekChange','1 Month,monthChange','YTD,ytdChange'].map(function(s){var p=s.split(',');var v=d[p[1]];return v!=null?'<div class="gs-mrow"><span class="gs-mlbl">'+p[0]+'</span><span class="gs-mval '+pctCls(v)+'">'+fmtPct(v)+'</span></div>':'';}).join('');
  return'<div class="gs-cmp-card'+(isWin?' winner':'')+'">'+
    '<div class="gs-card-head"><div><div class="gs-card-sym">'+sym+(isWin?' <span style="font-size:.65rem;color:var(--gold)">&#9733;</span>':'')+'</div><div class="gs-card-name">'+(d.name||sym)+'</div></div><div><div class="gs-card-price">'+fmt(d.price)+'</div><div class="gs-card-chg '+chgCls+'">'+chgStr+'</div></div></div>'+
    scoreHtml+
    '<div class="gs-metrics">'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Price &amp; Range</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Open</span><span class="gs-mval">'+fmt(d.open)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Prev Close</span><span class="gs-mval">'+fmt(d.previousClose)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Today High</span><span class="gs-mval up">'+fmt(d.high)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Today Low</span><span class="gs-mval dn">'+fmt(d.low)+'</span></div>'+
    rangeBar(d.low,d.high,d.price,'Day Range')+
    '<div class="gs-mrow"><span class="gs-mlbl">52-Wk High</span><span class="gs-mval gold">'+fmt(d.week52High)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">52-Wk Low</span><span class="gs-mval dn">'+fmt(d.week52Low)+'</span></div>'+
    rangeBar(d.week52Low,d.week52High,d.price,'52-Week Range')+
    '</div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Momentum &amp; Technicals</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">RSI (14)</span>'+rsiHtml+'</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA Trend</span><span class="gs-mval '+emaCls+'">'+emaStatus+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 20</span><span class="gs-mval muted">'+fmt(d.ema20)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 50</span><span class="gs-mval muted">'+fmt(d.ema50)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">EMA 200</span><span class="gs-mval muted">'+fmt(d.ema200)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">MACD</span><span class="gs-mval '+macdCls+'">'+macdTxt+'</span></div>'+
    '</div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Volume</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Volume</span><span class="gs-mval">'+fmtVol(d.volume)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Avg Volume</span><span class="gs-mval muted">'+fmtVol(d.avgVolume)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Rel. Volume</span><span class="gs-mval '+(d.rvol!=null&&d.rvol>1.3?'up':d.rvol!=null&&d.rvol<0.7?'dn':'')+'">'+( d.rvol!=null?Number(d.rvol).toFixed(2)+'x':'\u2014')+'</span></div>'+
    '</div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Support &amp; Resistance</div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Support</span><span class="gs-mval dn">'+fmt(d.support)+'</span></div>'+
    '<div class="gs-mrow"><span class="gs-mlbl">Resistance</span><span class="gs-mval up">'+fmt(d.resistance)+'</span></div>'+
    '</div>'+
    '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Performance</div>'+retRows+
    (d.analystRating?'<div class="gs-mrow"><span class="gs-mlbl">Analyst</span><span class="gs-mval gold">'+d.analystRating+'</span></div>':'')+
    (d.peRatio!=null?'<div class="gs-mrow"><span class="gs-mlbl">P/E Ratio</span><span class="gs-mval">'+Number(d.peRatio).toFixed(1)+'</span></div>':'')+
    '</div>'+
    '</div></div>';
}

/* ── SCANNER GRID ── */
var currentTab='stocks';
window.gsSetTab=function(tab,btn){
  currentTab=tab;
  document.querySelectorAll('.gs-tab').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  gsLoadGrid(tab);
};
async function gsLoadGrid(tab){
  var grid=document.getElementById('gsGrid');
  grid.innerHTML='<div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;animation:gsPulse 1.4s infinite;">Pulling live data\u2026</div>';
  var syms=TABS[tab];
  var results=await Promise.all(syms.map(function(s){return fetchQ(s);}));
  grid.innerHTML=results.map(function(r,i){return buildGridCard(r,syms[i]);}).join('');
}
function buildGridCard(r,rawSym){
  if(!r.ok)return'<div class="gs-gc" style="opacity:.4"><div class="gs-gc-head"><div><div class="gs-gc-sym">'+disp(rawSym)+'</div><div class="gs-gc-name">Unavailable</div></div></div></div>';
  var d=r.data;
  var sym=disp(d.symbol||rawSym);
  var chg=d.changePercent||0;
  var chgCls=pctCls(chg);
  var chgStr=(chg>=0?'\u25b2 ':'\u25bc ')+Math.abs(chg).toFixed(2)+'%';
  var sig=signal(d.rsi14,d.rvol);
  var rsiColor=d.rsi14==null?'#9a9690':d.rsi14>=70?'#d97a7a':d.rsi14>=60?'#4ecb8d':d.rsi14>=45?'#c9a24b':'#9a9690';
  var pct=0;if(d.low!=null&&d.high!=null){var rng=d.high-d.low;pct=rng>0?Math.min(Math.max((d.price-d.low)/rng*100,0),100):50;}
  var rangeHtml=d.low!=null&&d.high!=null?'<div class="gs-gc-range"><div class="gs-gc-range-lbl"><span>Day Range</span><span class="gs-gc-range-cur">'+fmt(d.price)+'</span></div><div class="gs-gc-track"><div class="gs-gc-fill" style="width:'+pct+'%"></div><div class="gs-gc-cursor" style="left:calc('+pct+'% - 1px)"></div></div><div class="gs-gc-ends"><span class="gs-gc-end">'+fmt(d.low)+'</span><span class="gs-gc-end">'+fmt(d.high)+'</span></div></div>':'';
  return'<div class="gs-gc '+(sig==='Bullish'?'bullish':'')+'" onclick="gsPick(\''+rawSym.replace('/USD','')+'\');window.scrollTo({top:0,behavior:\'smooth\'});">'+
    '<div class="gs-gc-head"><div><div class="gs-gc-sym">'+sym+'</div><div class="gs-gc-name">'+(d.name||sym)+'</div></div><div><div class="gs-gc-price">'+fmt(d.price)+'</div><div class="gs-gc-chg '+chgCls+'">'+chgStr+'</div></div></div>'+
    '<div class="gs-gc-metrics">'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">RSI (14)</div><div class="gs-gc-mv" style="color:'+rsiColor+'">'+(d.rsi14!=null?d.rsi14:'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Rel. Vol</div><div class="gs-gc-mv '+(d.rvol!=null&&d.rvol>1.3?'up':d.rvol!=null&&d.rvol<0.7?'dn':'')+'">'+(d.rvol!=null?Number(d.rvol).toFixed(2)+'x':'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Volume</div><div class="gs-gc-mv">'+fmtVol(d.volume)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">EMA</div><div class="gs-gc-mv '+(d.emaStatus&&d.emaStatus.toLowerCase().includes('above')?'up':d.emaStatus?'dn':'muted')+'">'+(d.emaStatus?d.emaStatus.charAt(0).toUpperCase()+d.emaStatus.slice(1):'\u2014')+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Today High</div><div class="gs-gc-mv up">'+fmt(d.high)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">Today Low</div><div class="gs-gc-mv dn">'+fmt(d.low)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">52W High</div><div class="gs-gc-mv gold">'+fmt(d.week52High)+'</div></div>'+
    '<div class="gs-gc-m"><div class="gs-gc-ml">52W Low</div><div class="gs-gc-mv dn">'+fmt(d.week52Low)+'</div></div>'+
    '</div>'+rangeHtml+
    '<div class="gs-gc-footer">'+sigBadge(sig)+'<span class="gs-gc-hint">+ Add to compare</span></div>'+
    '</div>';
}

/* ── INIT ── */
refreshPicker();
gsLoadGrid('stocks');
/* Also hook into showPage so grid reloads when scanner tab is clicked */
var _origShowPage=window.showPage;
window.showPage=function(id){if(_origShowPage)_origShowPage(id);if(id===\'scanner\'){setTimeout(function(){gsLoadGrid(currentTab);},100);}};
})();
</script>
</div>'''

count = html.count(OLD)
print(f'Scanner section matches: {count}')
if count == 1:
    html = html.replace(OLD, NEW, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('✓ Scanner upgraded successfully.')
else:
    print('✗ No match — check for whitespace differences.')
