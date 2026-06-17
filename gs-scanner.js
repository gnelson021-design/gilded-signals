/* =====================================================================
   GILDED SIGNALS — SCANNER ENGINE (clean external module)
   Powers: compare picker (slots), live signal grid, homepage grid.
   Live data only via /api/quote. No demo data. No inline onclick.
   ===================================================================== */
(function () {
  'use strict';

  var API = '/api/quote?symbol=';

  /* Symbol universes per tab. Stocks = your tracked names. */
  var TABS = {
    stocks: ['NVDA','MU','MRVL','AVGO','COHR','LITE','TSM','AMD','ASML','VRT','SMCI','NOW','DELL','SHOP','PLTR','QQQ'],
    tech:   ['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','LITE','PLTR','PANW','NOW','DELL','SMCI','SHOP','TSM','ARM','CRM','ORCL'],
    energy: ['XOM','CVX','NEE','ENPH','FSLR','OXY','SLB','ET','KMI','EPD','LNG','VLO','MPC','PSX','HAL'],
    crypto: ['BTC/USD','ETH/USD','SOL/USD','XRP/USD','DOGE/USD','AVAX/USD','BNB/USD']
  };
  /* Homepage box default universe (mix of movers + crypto). */
  var HOME = ['NVDA','MU','MRVL','AVGO','COHR','BTC/USD','ETH/USD','SOL/USD'];

  var CRYPTO = ['BTC','ETH','SOL','XRP','DOGE','BNB','AVAX','LINK','MATIC','DOT','LTC','ADA'];

  var slots = [null, null];
  var currentTab = 'stocks';
  var cache = {};            // sym -> { t, data }
  var CACHE_MS = 20000;

  /* ---------- helpers ---------- */
  function toApi(s) {
    var t = String(s).toUpperCase().trim();
    if (t.indexOf('/') !== -1) return t;
    if (CRYPTO.indexOf(t) !== -1) return t + '/USD';
    return t;
  }
  function disp(s) { return String(s).replace('/USD', ''); }
  function $(id) { return document.getElementById(id); }

  function fmt(v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 1000)  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n < 1)      return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }
  function fmtVol(v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(n);
  }
  function pctCls(v) { return v == null ? '' : (v >= 0 ? 'up' : 'dn'); }

  function signal(rsi, rvol) {
    if (rsi == null) return 'Watch';
    var v = rvol || 1;
    if (rsi > 60 && v > 1.2) return 'Bullish';
    if (rsi > 60 || (rsi >= 45 && v > 1.1)) return 'Watch';
    if (rsi < 35) return 'Bearish';
    return 'Neutral';
  }
  function sigBadge(s) {
    return '<span class="gs-sig-badge ' + s.toLowerCase() + '">' + s + '</span>';
  }

  function fetchQ(sym) {
    var s = toApi(sym);
    var c = cache[s];
    if (c && (Date.now() - c.t) < CACHE_MS) return Promise.resolve(c.data);
    return fetch(API + encodeURIComponent(s))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var out = (d && d.price != null) ? { ok: true, data: d } : { ok: false };
        cache[s] = { t: Date.now(), data: out };
        return out;
      })
      .catch(function () { return { ok: false }; });
  }

  /* ---------- PICKER (slots) ---------- */
  function renderPills() {
    var box = $('gsPills');
    if (!box) return;
    box.innerHTML = TABS.stocks.concat(['BTC', 'ETH', 'SOL']).map(function (s) {
      var picked = slots.some(function (x) { return x === s || x === toApi(s); });
      var ctag = CRYPTO.indexOf(s) !== -1 ? '<span class="ctag">crypto</span>' : '';
      return '<button class="gs-pill' + (picked ? ' picked' : '') + '"' +
             (picked ? ' disabled' : '') + ' data-sym="' + s + '">' + s + ctag + '</button>';
    }).join('');
  }
  function renderSlots() {
    [0, 1].forEach(function (i) {
      var el = $('gsSlot' + i), body = $('gsSlot' + i + 'body');
      if (!el || !body) return;
      var v = slots[i];
      if (v) {
        el.classList.add('filled');
        body.innerHTML = '<span class="gs-slot-chip">' + disp(v) +
          '<button class="xbtn" data-remove="' + i + '">&times;</button></span>';
      } else {
        el.classList.remove('filled');
        body.innerHTML = '<span class="gs-slot-empty">Tap a symbol above</span>';
      }
    });
  }
  function updateBtn() {
    var btn = $('gsRunBtn');
    if (!btn) return;
    var n = slots.filter(Boolean).length;
    if (n === 0) { btn.disabled = true; btn.textContent = 'Pick two assets'; }
    else if (n === 1) { btn.disabled = true; btn.textContent = 'Pick one more'; }
    else { btn.disabled = false; btn.textContent = 'Compare ' + disp(slots[0]) + ' vs ' + disp(slots[1]) + ' \u2192'; }
  }
  function refreshPicker() { renderPills(); renderSlots(); updateBtn(); }
  function gsErr(t) { var e = $('gsErrMsg'); if (e) e.textContent = t || ''; }

  function pick(s) {
    if (slots.some(function (x) { return x === s || x === toApi(s); })) return;
    var i = slots.indexOf(null);
    if (i === -1) { gsErr('Both slots full — remove one first.'); return; }
    slots[i] = s; gsErr(''); refreshPicker();
  }
  function addTyped() {
    var inp = $('gsSearchInput'); if (!inp) return;
    var v = inp.value.trim().toUpperCase(); if (!v) return;
    if (slots.some(function (x) { return x === v || disp(x) === v; })) { gsErr(v + ' already selected.'); return; }
    var i = slots.indexOf(null);
    if (i === -1) { gsErr('Both slots full.'); return; }
    slots[i] = v; inp.value = ''; gsErr(''); refreshPicker();
  }
  function removeSlot(i) { slots[i] = null; gsErr(''); refreshPicker(); }
  function clearAll() {
    slots = [null, null];
    var inp = $('gsSearchInput'); if (inp) inp.value = '';
    var res = $('gsCmpResults'); if (res) res.innerHTML = '';
    gsErr(''); refreshPicker();
  }

  /* ---------- COMPARE ---------- */
  function runCompare() {
    if (slots.filter(Boolean).length < 2) return;
    var load = $('gsCmpLoading'); if (load) load.style.display = 'block';
    var res = $('gsCmpResults'); if (res) res.innerHTML = '';
    Promise.all([fetchQ(slots[0]), fetchQ(slots[1])]).then(function (r) {
      if (load) load.style.display = 'none';
      if (!r[0].ok || !r[1].ok) {
        gsErr('Could not load data for ' + (r[0].ok ? disp(slots[1]) : disp(slots[0])) + '. Try again.');
        return;
      }
      if (res) res.innerHTML = buildVerdict(r[0].data, r[1].data) + buildCmpCards(r[0].data, r[1].data);
    });
  }
  function buildVerdict(a, b) {
    var sA = a.gildedScore, sB = b.gildedScore;
    var nA = disp(a.symbol || slots[0]), nB = disp(b.symbol || slots[1]);
    var main, sub;
    if (sA == null || sB == null) { main = 'Live signals loaded'; sub = 'Both assets pulled from your live API.'; }
    else if (sA === sB) { main = nA + ' and ' + nB + ' are evenly matched'; sub = 'Both score ' + sA + '/100 on the Gilded Scale.'; }
    else {
      var win = sA > sB ? nA : nB, lose = sA > sB ? nB : nA, hi = Math.max(sA, sB), lo = Math.min(sA, sB);
      main = '<b>' + win + '</b> looks stronger right now';
      sub = hi + '/100 vs ' + lo + '/100 — ' + lose + ' worth monitoring.';
    }
    var winData = (sA == null || sA >= sB) ? a : b;
    var reasons = (winData.gildedReasons || []).slice(0, 4);
    var tags = reasons.length
      ? '<div class="gs-reason-tags">' + reasons.map(function (r) { return '<span class="gs-reason-tag">' + r + '</span>'; }).join('') + '</div>'
      : '';
    return '<div class="gs-verdict"><div class="gs-verdict-lbl">Gilded Verdict</div><div class="gs-verdict-main">' +
      main + '</div><div class="gs-verdict-sub">' + sub + '</div>' + tags + '</div>';
  }
  function buildCmpCards(a, b) {
    var sA = a.gildedScore, sB = b.gildedScore;
    var aWins = sA != null && sB != null && sA >= sB;
    return '<div class="gs-cmp-cards">' + buildCard(a, aWins) + buildCard(b, !aWins && sA != null && sB != null) + '</div>';
  }
  function rsiColor(v) {
    return v == null ? '#9a9690' : v >= 70 ? '#d97a7a' : v >= 60 ? '#4ecb8d' : v >= 45 ? '#c9a24b' : '#9a9690';
  }
  function buildCard(d, isWin) {
    var sym = disp(d.symbol || '');
    var chg = d.changePercent;
    var chgStr = chg == null ? '—' : (chg >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(chg).toFixed(2) + '%';
    var sig = signal(d.rsi14, d.rvol);
    var score = d.gildedScore;
    var scoreHtml = score != null
      ? '<div class="gs-score-block"><div class="gs-score-num">' + score +
        '</div><div style="flex:1"><div class="gs-score-bar-lbl">Gilded Score / 100</div>' +
        '<div class="gs-score-track"><div class="gs-score-fill" style="width:' + score + '%"></div></div></div>' +
        sigBadge(sig) + '</div>'
      : '';
    var rc = rsiColor(d.rsi14);
    var rsiHtml = d.rsi14 != null
      ? '<div class="gs-rsi-wrap"><div class="gs-rsi-val" style="color:' + rc + '">' + d.rsi14 +
        '</div><div class="gs-rsi-track"><div class="gs-rsi-fill" style="width:' + Math.min(d.rsi14, 100) +
        '%;background:' + rc + '"></div></div></div>'
      : '<span class="gs-mval muted">—</span>';
    var emaStatus = d.emaStatus ? d.emaStatus.charAt(0).toUpperCase() + d.emaStatus.slice(1) : '—';
    var emaCls = d.emaStatus && d.emaStatus.toLowerCase().indexOf('above') !== -1 ? 'up' : (d.emaStatus ? 'dn' : 'muted');
    var macdTxt = d.macdHist == null ? '—' : d.macdHist > 0 ? '\u25B2 Bullish' : '\u25BC Bearish';
    var macdCls = d.macdHist == null ? 'muted' : d.macdHist > 0 ? 'up' : 'dn';

    function rangeBar(lo, hi, cur, lbl) {
      if (lo == null || hi == null) return '<div class="gs-mrow"><span class="gs-mlbl">' + lbl + '</span><span class="gs-mval muted">—</span></div>';
      var rng = hi - lo, pct = rng > 0 ? Math.min(Math.max((cur - lo) / rng * 100, 0), 100) : 50;
      return '<div style="width:100%;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.026)">' +
        '<div class="gs-range-bar-top"><span class="gs-range-bar-lbl">' + lbl + '</span><span class="gs-range-bar-cur">' + fmt(cur) + '</span></div>' +
        '<div class="gs-range-track"><div class="gs-range-fill" style="width:' + pct + '%"></div>' +
        '<div class="gs-range-cursor" style="left:calc(' + pct + '% - 1px)"></div></div>' +
        '<div class="gs-range-ends"><span class="gs-range-end">' + fmt(lo) + '</span><span class="gs-range-end">' + fmt(hi) + '</span></div></div>';
    }
    var retRows = ['1 Week,weekChange', '1 Month,monthChange', 'YTD,ytdChange'].map(function (s) {
      var p = s.split(','), v = d[p[1]];
      return v != null ? '<div class="gs-mrow"><span class="gs-mlbl">' + p[0] + '</span><span class="gs-mval ' + pctCls(v) + '">' + fmtPct(v) + '</span></div>' : '';
    }).join('');

    return '<div class="gs-cmp-card' + (isWin ? ' winner' : '') + '">' +
      '<div class="gs-card-head"><div><div class="gs-card-sym">' + sym + (isWin ? ' <span style="font-size:.65rem;color:var(--gold)">&#9733;</span>' : '') +
      '</div><div class="gs-card-name">' + (d.name || sym) + '</div></div><div><div class="gs-card-price">' + fmt(d.price) +
      '</div><div class="gs-card-chg ' + pctCls(chg) + '">' + chgStr + '</div></div></div>' +
      scoreHtml +
      '<div class="gs-metrics">' +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Price &amp; Range</div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Open</span><span class="gs-mval">' + fmt(d.open) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Prev Close</span><span class="gs-mval">' + fmt(d.previousClose) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Today High</span><span class="gs-mval up">' + fmt(d.high) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Today Low</span><span class="gs-mval dn">' + fmt(d.low) + '</span></div>' +
      rangeBar(d.low, d.high, d.price, 'Day Range') +
      '<div class="gs-mrow"><span class="gs-mlbl">52-Wk High</span><span class="gs-mval gold">' + fmt(d.week52High) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">52-Wk Low</span><span class="gs-mval dn">' + fmt(d.week52Low) + '</span></div>' +
      rangeBar(d.week52Low, d.week52High, d.price, '52-Week Range') +
      '</div>' +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Momentum &amp; Technicals</div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">RSI (14)</span>' + rsiHtml + '</div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">EMA Trend</span><span class="gs-mval ' + emaCls + '">' + emaStatus + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">EMA 20</span><span class="gs-mval muted">' + fmt(d.ema20) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">EMA 50</span><span class="gs-mval muted">' + fmt(d.ema50) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">EMA 200</span><span class="gs-mval muted">' + fmt(d.ema200) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">MACD</span><span class="gs-mval ' + macdCls + '">' + macdTxt + '</span></div>' +
      '</div>' +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Volume</div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Volume</span><span class="gs-mval">' + fmtVol(d.volume) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Avg Volume</span><span class="gs-mval muted">' + fmtVol(d.avgVolume) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Rel. Volume</span><span class="gs-mval ' +
      (d.rvol != null && d.rvol > 1.3 ? 'up' : d.rvol != null && d.rvol < 0.7 ? 'dn' : '') + '">' +
      (d.rvol != null ? Number(d.rvol).toFixed(2) + 'x' : '—') + '</span></div>' +
      '</div>' +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Support &amp; Resistance</div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Support</span><span class="gs-mval dn">' + fmt(d.support) + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Resistance</span><span class="gs-mval up">' + fmt(d.resistance) + '</span></div>' +
      '</div>' +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Performance</div>' + retRows +
      (d.analystRating ? '<div class="gs-mrow"><span class="gs-mlbl">Analyst</span><span class="gs-mval gold">' + d.analystRating + '</span></div>' : '') +
      (d.peRatio != null ? '<div class="gs-mrow"><span class="gs-mlbl">P/E Ratio</span><span class="gs-mval">' + Number(d.peRatio).toFixed(1) + '</span></div>' : '') +
      '</div>' +
      '</div></div>';
  }

  /* ---------- GRID (bullish-first, clickable) ---------- */
  function gridCard(r, rawSym) {
    if (!r.ok) {
      return '<div class="gs-gc" style="opacity:.4"><div class="gs-gc-head"><div>' +
        '<div class="gs-gc-sym">' + disp(rawSym) + '</div><div class="gs-gc-name">Unavailable</div></div></div></div>';
    }
    var d = r.data, sym = disp(d.symbol || rawSym);
    var chg = d.changePercent || 0;
    var chgStr = (chg >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(chg).toFixed(2) + '%';
    var sig = signal(d.rsi14, d.rvol);
    var rc = rsiColor(d.rsi14);
    var pct = 0;
    if (d.low != null && d.high != null) { var rng = d.high - d.low; pct = rng > 0 ? Math.min(Math.max((d.price - d.low) / rng * 100, 0), 100) : 50; }
    var rangeHtml = (d.low != null && d.high != null)
      ? '<div class="gs-gc-range"><div class="gs-gc-range-lbl"><span>Day Range</span><span class="gs-gc-range-cur">' + fmt(d.price) +
        '</span></div><div class="gs-gc-track"><div class="gs-gc-fill" style="width:' + pct + '%"></div>' +
        '<div class="gs-gc-cursor" style="left:calc(' + pct + '% - 1px)"></div></div>' +
        '<div class="gs-gc-ends"><span class="gs-gc-end">' + fmt(d.low) + '</span><span class="gs-gc-end">' + fmt(d.high) + '</span></div></div>'
      : '';
    return '<div class="gs-gc ' + (sig === 'Bullish' ? 'bullish' : '') + '" data-sym="' + disp(rawSym) + '" data-scroll="1">' +
      '<div class="gs-gc-head"><div><div class="gs-gc-sym">' + sym + '</div><div class="gs-gc-name">' + (d.name || sym) +
      '</div></div><div><div class="gs-gc-price">' + fmt(d.price) + '</div><div class="gs-gc-chg ' + pctCls(chg) + '">' + chgStr + '</div></div></div>' +
      '<div class="gs-gc-metrics">' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">RSI (14)</div><div class="gs-gc-mv" style="color:' + rc + '">' + (d.rsi14 != null ? d.rsi14 : '—') + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">Rel. Vol</div><div class="gs-gc-mv ' + (d.rvol != null && d.rvol > 1.3 ? 'up' : d.rvol != null && d.rvol < 0.7 ? 'dn' : '') + '">' + (d.rvol != null ? Number(d.rvol).toFixed(2) + 'x' : '—') + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">Volume</div><div class="gs-gc-mv">' + fmtVol(d.volume) + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">EMA</div><div class="gs-gc-mv ' + (d.emaStatus && d.emaStatus.toLowerCase().indexOf('above') !== -1 ? 'up' : d.emaStatus ? 'dn' : 'muted') + '">' + (d.emaStatus ? d.emaStatus.charAt(0).toUpperCase() + d.emaStatus.slice(1) : '—') + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">Today High</div><div class="gs-gc-mv up">' + fmt(d.high) + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">Today Low</div><div class="gs-gc-mv dn">' + fmt(d.low) + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">52W High</div><div class="gs-gc-mv gold">' + fmt(d.week52High) + '</div></div>' +
      '<div class="gs-gc-m"><div class="gs-gc-ml">52W Low</div><div class="gs-gc-mv dn">' + fmt(d.week52Low) + '</div></div>' +
      '</div>' + rangeHtml +
      '<div class="gs-gc-footer">' + sigBadge(sig) + '<span class="gs-gc-hint">+ Add to compare</span></div>' +
      '</div>';
  }

  /* Fetch a universe, sort most-bullish first, render into a grid element. */
  function loadGrid(gridEl, syms) {
    if (!gridEl) return;
    gridEl.innerHTML = '<div style="color:#7a7770;font-family:monospace;font-size:.72rem;letter-spacing:.15em;padding:20px 0;animation:gsPulse 1.4s infinite;">Pulling live data\u2026</div>';
    var batchSize = 6, all = [];
    var seq = Promise.resolve();
    for (var i = 0; i < syms.length; i += batchSize) {
      (function (slice) {
        seq = seq
          .then(function () { return Promise.all(slice.map(function (s) { return fetchQ(s).then(function (r) { return { r: r, raw: s }; }); })); })
          .then(function (batch) {
            all = all.concat(batch);
            renderSorted(gridEl, all);
            return new Promise(function (res) { setTimeout(res, 250); });
          });
      })(syms.slice(i, i + batchSize));
    }
  }
  function bullScore(item) {
    if (!item.r.ok) return -Infinity;
    var d = item.r.data;
    if (d.gildedScore != null) return d.gildedScore;          // primary: Gilded Score
    return (d.changePercent != null ? d.changePercent : -999); // fallback: % change
  }
  function renderSorted(gridEl, items) {
    var sorted = items.slice().sort(function (a, b) { return bullScore(b) - bullScore(a); });
    gridEl.innerHTML = sorted.map(function (it) { return gridCard(it.r, it.raw); }).join('');
  }

  function setTab(tab, btn) {
    currentTab = tab;
    var tabs = document.querySelectorAll('.gs-tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    if (btn) btn.classList.add('active');
    loadGrid($('gsGrid'), TABS[tab] || TABS.stocks);
  }

  /* ---------- expose minimal API for any leftover inline refs ---------- */
  window.gsPick = pick;
  window.gsAddTyped = addTyped;
  window.gsRemove = removeSlot;
  window.gsClearAll = clearAll;
  window.gsRunCompare = runCompare;
  window.gsSetTab = setTab;

  /* ---------- one delegated click handler (replaces all inline onclick) ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var rem = t.closest('[data-remove]');
    if (rem) { removeSlot(parseInt(rem.getAttribute('data-remove'), 10)); return; }

    var card = t.closest('[data-sym]');
    if (card) {
      var sym = card.getAttribute('data-sym');
      if (sym) { pick(sym); if (card.closest('#homeScannerGrid')) { showPage('scanner'); } else { window.scrollTo({ top: 0, behavior: 'smooth' }); } }
      return;
    }

    var add = t.closest('.gs-add-btn'); if (add) { addTyped(); return; }
    var clr = t.closest('.gs-clear-btn'); if (clr) { clearAll(); return; }
    var run = t.closest('#gsRunBtn'); if (run && !run.disabled) { runCompare(); return; }
  });

  /* search box: Enter to add */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'gsSearchInput') { e.preventDefault(); addTyped(); }
  });

  /* ---------- init ---------- */
  function init() {
    refreshPicker();
    if ($('gsGrid')) loadGrid($('gsGrid'), TABS.stocks);
    var home = $('homeScannerGrid');
    if (home) loadGrid(home, HOME);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* reload grid when scanner tab opened via existing showPage */
  var origShow = window.showPage;
  window.showPage = function (id) {
    if (origShow) origShow(id);
    if (id === 'scanner') setTimeout(function () { if ($('gsGrid')) loadGrid($('gsGrid'), TABS[currentTab] || TABS.stocks); }, 150);
  };
})();
