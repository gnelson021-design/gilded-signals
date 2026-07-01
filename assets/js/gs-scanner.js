/* =====================================================================
   GILDED SIGNALS — SCANNER ENGINE (v2 picker)
   Powers: compare picker (search/quick-pick/watchlist), live signal grid,
   homepage grid. Live data only via /api/quote. No demo data.
   No inline onclick — everything routes through the delegated handlers
   at the bottom of this file.

   v2 changes vs the previous picker:
     - Search input now has a live typeahead dropdown instead of a
       separate ADD button.
     - Quick picks are grouped into categories (Top Stocks, Top AI
       Stocks, Top Energy Stocks, Top Index Funds, Recent IPOs, Crypto)
       instead of one flat row.
     - Picking a ticker while both slots are full now repopulates Asset A
       and clears Asset B, instead of showing an error.
     - New: a Watchlist section remembers every ticker you've searched or
       tapped (localStorage), with a live price/24h change per row and a
       hover "x" to remove just one entry.
     - New: a gold beam sweeps the screen while Compare loads, and the
       reveal is tied to real data completion (not a guessed delay).
     - Results now lead with a clean, simple comparison table (Price,
       Today's Move, Today's Range, Volume, Momentum/RSI, 52-Week Range,
       Gilded Score) instead of jumping straight to the full technical
       cards. The full technical breakdown (score bar, EMA/MACD,
       support/resistance, risk/reward, performance, analyst/valuation)
       is still there for every asset — now behind a "Full Technical
       Breakdown" expander per asset, so casual visitors get something
       readable and serious traders can still go deep.
   Everything below the picker — the Live Signal Grid, its tabs, and the
   homepage grid — is unchanged.
   ===================================================================== */
(function () {
  'use strict';

  var API = '/api/quote?symbol=';

  /* Symbol universes per tab. Stocks = your tracked names. */
  var TABS = {
    stocks: ['NVDA','MU','MRVL','NBIS','AVGO','COHR','LITE','TSM','AMD','ASML','VRT','SMCI','NOW','DELL','SHOP','PLTR','QQQ'],
    tech:   ['NVDA','AMD','AVGO','ASML','MU','MRVL','VRT','COHR','LITE','PLTR','PANW','NOW','DELL','SMCI','SHOP','TSM','ARM','CRM','ORCL'],
    energy: ['XOM','CVX','NEE','ENPH','FSLR','OXY','SLB','ET','KMI','EPD','LNG','VLO','MPC','PSX','HAL'],
    crypto: ['BTC/USD','ETH/USD','SOL/USD','XRP/USD','DOGE/USD','AVAX/USD','BNB/USD']
  };
  /* Homepage box default universe (mix of movers + crypto). */
  var HOME = ['NVDA','MU','MRVL','AVGO','COHR','BTC/USD','ETH/USD','SOL/USD'];

  var CRYPTO = ['BTC','ETH','SOL','XRP','DOGE','BNB','AVAX','LINK','MATIC','DOT','LTC','ADA'];

  /* Quick-pick groups for the picker (separate from the grid tabs above —
     this is what people see as tappable chips before they compare). */
  var QUICK_GROUPS = [
    { label: 'Top Stocks',        syms: ['AAPL','MSFT','AMZN','GOOGL','META','TSLA','NFLX','BRK.B'] },
    { label: 'Top AI Stocks',     syms: TABS.stocks },
    { label: 'Top Energy Stocks', syms: TABS.energy },
    { label: 'Top Index Funds',   syms: ['QQQ','SPY','VOO','DIA','IWM','SMH'] },
    { label: 'Recent IPOs',       syms: ['CRCL','CRWV','RDDT','ARM','CART','KVYO'] },
    { label: 'Crypto',            syms: ['BTC','ETH','SOL'] }
  ];

  var slots = [null, null];
  var currentTab = 'stocks';
  var cache = {};            // sym -> { t, data }
  var CACHE_MS = 20000;
  var BEAM_MS = 1100;        // must match .gs-beam animation-duration in CSS

  var WL_KEY = 'gs_watchlist';
  var WL_CAP = 12;
  var watchlist = loadWatchlist();

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
  function fmtRange(lo, hi) { return (lo == null || hi == null) ? '—' : fmt(lo) + ' – ' + fmt(hi); }
  function pctCls(v) { return v == null ? '' : (v >= 0 ? 'up' : 'dn'); }

  /* Signal now comes from the server (single source of truth). Fallback only
     if an older cached payload lacks it. */
  function signal(d) {
    if (d && d.signal) return d.signal;
    // Legacy fallback (older payloads): derive a coarse label.
    var rsi = d ? d.rsi14 : null, rvol = d ? d.rvol : 1;
    if (rsi == null) return 'Watch';
    var v = rvol || 1;
    if (rsi > 60 && v > 1.2) return 'Bullish';
    if (rsi > 60 || (rsi >= 45 && v > 1.1)) return 'Watch';
    if (rsi < 35) return 'Bearish';
    return 'Neutral';
  }
  /* Map any of the 7 labels to a CSS class slug. */
  function sigSlug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  }
  function sigBadge(s) {
    return '<span class="gs-sig-badge ' + sigSlug(s) + '">' + s + '</span>';
  }
  /* RSI condition label (from server). */
  function rsiCond(d) { return d && d.rsiCondition ? d.rsiCondition : null; }

  /* "Last updated" relative time from updatedAt ISO. */
  function lastUpdated(d) {
    if (!d || !d.updatedAt) return '';
    var then = new Date(d.updatedAt).getTime();
    if (isNaN(then)) return '';
    var secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 60) return 'Updated just now';
    var m = Math.floor(secs / 60);
    if (m < 60) return 'Updated ' + m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return 'Updated ' + h + 'h ago';
    return 'Updated ' + new Date(then).toLocaleDateString();
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

  /* ---------- WATCHLIST ---------- */
  function loadWatchlist() {
    try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveWatchlist() {
    try { localStorage.setItem(WL_KEY, JSON.stringify(watchlist)); } catch (e) {}
  }
  function watchKind(sym) { return CRYPTO.indexOf(disp(sym).toUpperCase()) !== -1 ? 'crypto' : 'stock'; }
  function addToWatchlist(sym) {
    var t = disp(sym).toUpperCase();
    watchlist = watchlist.filter(function (w) { return w.t !== t; });
    watchlist.unshift({ t: t, k: watchKind(t) });
    watchlist = watchlist.slice(0, WL_CAP);
    saveWatchlist();
  }
  function removeFromWatchlist(t) {
    watchlist = watchlist.filter(function (w) { return w.t !== t; });
    saveWatchlist();
    renderWatchlist();
  }
  function clearWatchlist() {
    watchlist = [];
    try { localStorage.removeItem(WL_KEY); } catch (e) {}
    renderWatchlist();
  }
  function renderWatchlist() {
    var box = $('gsWlBody');
    if (!box) return;
    if (!watchlist.length) {
      box.innerHTML = '<div class="gs-wl-empty">Nothing here yet — search or tap a ticker above and it will show up here with a live price.</div>';
      return;
    }
    box.innerHTML = '<table class="gs-wl-table"><thead><tr><th>Ticker</th><th>Type</th><th>Live Price</th><th>24H</th></tr></thead><tbody>' +
      watchlist.map(function (w) {
        return '<tr class="gs-wl-row" data-sym="' + w.t + '">' +
          '<td><div class="gs-wl-tk-cell"><button class="gs-wl-x" data-remove-watch="' + w.t + '" title="Remove from watchlist">&times;</button>' +
          '<span class="gs-wl-tk">' + w.t + '</span></div></td>' +
          '<td class="gs-wl-type">' + w.k + '</td>' +
          '<td id="gsWlPrice-' + w.t + '">…</td>' +
          '<td id="gsWlChg-' + w.t + '">…</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div style="text-align:right;margin-top:10px"><button class="gs-wl-clear" id="gsWlClearBtn">Clear watchlist</button></div>';

    watchlist.forEach(function (w) {
      fetchQ(w.t).then(function (r) {
        var pEl = document.getElementById('gsWlPrice-' + w.t);
        var cEl = document.getElementById('gsWlChg-' + w.t);
        if (!pEl || !cEl) return;
        if (r.ok) {
          pEl.textContent = fmt(r.data.price);
          cEl.innerHTML = '<span class="' + pctCls(r.data.changePercent) + '">' + fmtPct(r.data.changePercent) + '</span>';
        } else {
          pEl.textContent = '—'; cEl.textContent = '—';
        }
      });
    });
  }

  /* ---------- PICKER (search, quick picks, slots) ---------- */
  function renderQuick() {
    var box = $('gsQuick');
    if (!box) return;
    box.innerHTML = QUICK_GROUPS.map(function (g) {
      var chips = g.syms.map(function (s) {
        var picked = slots.some(function (x) { return x === s || x === toApi(s); });
        var ctag = CRYPTO.indexOf(s) !== -1 ? '<span class="ctag">crypto</span>' : '';
        return '<button class="gs-pill' + (picked ? ' picked' : '') + '" data-sym="' + s + '">' + s + ctag + '</button>';
      }).join('');
      return '<div class="gs-qp-group"><div class="gs-qp-group-lbl">' + g.label + '</div><div class="gs-qp-group-row">' + chips + '</div></div>';
    }).join('');
  }

  function renderSuggestions() {
    var inp = $('gsSearchInput'), box = $('gsSuggest');
    if (!inp || !box) return;
    var q = inp.value.trim().toUpperCase();
    if (!q) { box.classList.remove('show'); box.innerHTML = ''; return; }
    var universe = [];
    QUICK_GROUPS.forEach(function (g) { universe = universe.concat(g.syms); });
    universe = universe.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var matches = universe.filter(function (u) { return u.indexOf(q) === 0; }).slice(0, 8);
    if (!matches.length) {
      box.innerHTML = '<div class="gs-suggest-row" data-sym="' + q + '"><span class="gs-suggest-t">' + q + '</span><span class="gs-suggest-k">search this ticker</span></div>';
    } else {
      box.innerHTML = matches.map(function (m) {
        var k = CRYPTO.indexOf(m) !== -1 ? 'crypto' : 'stock';
        return '<div class="gs-suggest-row" data-sym="' + m + '"><span class="gs-suggest-t">' + m + '</span><span class="gs-suggest-k">' + k + '</span></div>';
      }).join('');
    }
    box.classList.add('show');
  }

  function renderSlots() {
    [0, 1].forEach(function (i) {
      var el = $('gsSlot' + i), body = $('gsSlot' + i + 'body');
      if (!el || !body) return;
      el.tabIndex = 0;
      var v = slots[i];
      if (v) {
        el.classList.add('filled');
        body.innerHTML = '<span class="gs-slot-chip">' + disp(v) +
          '<button class="xbtn" tabindex="-1" data-remove="' + i + '">&times;</button></span>';
      } else {
        el.classList.remove('filled');
        body.innerHTML = '<span class="gs-slot-empty">Search or tap a symbol above</span>';
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
  function refreshPicker() { renderQuick(); renderSlots(); updateBtn(); }
  function gsErr(t) { var e = $('gsErrMsg'); if (e) e.textContent = t || ''; }

  /* Picking a ticker: if a slot is open, fill it. If both are full, the new
     pick repopulates Asset A and clears Asset B — no dead-end error. */
  function pick(s) {
    var t = String(s).trim().toUpperCase();
    if (!t) return;
    if (slots.some(function (x) { return x === t || disp(x) === t || x === toApi(t); })) {
      gsErr(t + ' is already in the comparison.');
    } else {
      var i = slots.indexOf(null);
      if (i !== -1) slots[i] = t;
      else slots = [t, null];
      gsErr('');
    }
    addToWatchlist(t);
    var inp = $('gsSearchInput'); if (inp) inp.value = '';
    var sug = $('gsSuggest'); if (sug) sug.classList.remove('show');
    refreshPicker();
    renderWatchlist();
  }
  function addTyped() {
    var inp = $('gsSearchInput'); if (!inp) return;
    var v = inp.value.trim().toUpperCase(); if (!v) return;
    pick(v);
  }
  function removeSlot(i) { slots[i] = null; gsErr(''); refreshPicker(); }
  function clearAll() {
    slots = [null, null];
    var inp = $('gsSearchInput'); if (inp) inp.value = '';
    var res = $('gsCmpResults'); if (res) res.innerHTML = '';
    gsErr(''); refreshPicker();
  }

  /* ---------- COMPARE — simple table + expandable full breakdown ---------- */
  function winCls(x, y, higherIsBetter) {
    if (higherIsBetter === undefined) higherIsBetter = true;
    if (x == null || y == null || x === y) return ['', ''];
    var aWins = higherIsBetter ? x > y : x < y;
    return aWins ? ['win', ''] : ['', 'win'];
  }
  function miniRsi(v, cond) {
    if (v == null) return '—';
    var color = rsiColor(v), pct = Math.min(Math.max(v, 0), 100);
    var out = '<span class="gs-rsi-mini-wrap"><span class="gs-rsi-mini-num" style="color:' + color + '">' + v + '</span>' +
      '<span class="gs-rsi-mini-bar"><span class="gs-rsi-mini-dot" style="left:' + pct + '%;background:' + color + '"></span></span></span>';
    if (cond) out += '<div class="gs-rsi-mini-lbl">' + cond + '</div>';
    return out;
  }
  function buildSimpleTable(a, b) {
    var symA = disp(a.symbol || ''), symB = disp(b.symbol || '');
    var mv = winCls(a.changePercent, b.changePercent);
    var sc = winCls(a.gildedScore, b.gildedScore);
    var rows = [
      ['Price', 'The current live price.', fmt(a.price), fmt(b.price), '', ''],
      ["Today's move", "How much it's up or down today.",
        '<span class="' + pctCls(a.changePercent) + '">' + fmtPct(a.changePercent) + '</span>',
        '<span class="' + pctCls(b.changePercent) + '">' + fmtPct(b.changePercent) + '</span>', mv[0], mv[1]],
      ["Today's range", 'The low-to-high price traded today.', fmtRange(a.low, a.high), fmtRange(b.low, b.high), '', ''],
      ['Volume', 'Total traded volume today — higher means more active interest.', fmtVol(a.volume), fmtVol(b.volume), '', ''],
      ['Momentum (RSI)', 'Above 70 = hot/overbought, below 30 = cold/oversold.', miniRsi(a.rsi14, rsiCond(a)), miniRsi(b.rsi14, rsiCond(b)), '', ''],
      ['52-week range', 'The low-to-high price over the last year.', fmtRange(a.week52Low, a.week52High), fmtRange(b.week52Low, b.week52High), '', ''],
      ['Gilded Score', 'Our overall strength read — higher is stronger.', a.gildedScore != null ? a.gildedScore : '—', b.gildedScore != null ? b.gildedScore : '—', sc[0], sc[1]]
    ];
    return '<table class="gs-simple-table"><thead><tr><th></th><th>' + symA + '</th><th>' + symB + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="metric">' + r[0] + '<span class="gs-hint" title="' + r[1] + '">?</span></td>' +
          '<td class="' + r[4] + '">' + r[2] + '</td><td class="' + r[5] + '">' + r[3] + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function buildBreakdowns(a, b) {
    return '<div class="gs-expand-row">' +
      '<details class="gs-expand"><summary>Full Technical Breakdown — ' + disp(a.symbol || '') + '</summary>' + buildCard(a, false) + '</details>' +
      '<details class="gs-expand"><summary>Full Technical Breakdown — ' + disp(b.symbol || '') + '</summary>' + buildCard(b, false) + '</details>' +
      '</div>';
  }

  function runCompare() {
    if (slots.filter(Boolean).length < 2) return;
    var overlay = $('gsBeamOverlay'), beam = $('gsBeam');
    var load = $('gsCmpLoading'); if (load) load.style.display = 'block';
    var res = $('gsCmpResults'); if (res) res.innerHTML = '';

    if (overlay) {
      overlay.classList.add('active');
      if (beam) { beam.style.animation = 'none'; void beam.offsetWidth; beam.style.animation = ''; }
    }

    // Reveal only once BOTH the beam has visually finished AND the data has
    // actually loaded — whichever takes longer. Keeps the reveal honest
    // (never shows a verdict before data is really back) while still
    // guaranteeing the beam plays out fully.
    var minBeamTime = new Promise(function (resolve) { setTimeout(resolve, BEAM_MS); });
    var dataLoad = Promise.all([fetchQ(slots[0]), fetchQ(slots[1])]);

    Promise.all([minBeamTime, dataLoad]).then(function (results) {
      var r = results[1];
      if (overlay) overlay.classList.remove('active');
      if (load) load.style.display = 'none';
      if (!r[0].ok || !r[1].ok) {
        gsErr('Could not load data for ' + (r[0].ok ? disp(slots[1]) : disp(slots[0])) + '. Try again.');
        return;
      }
      if (res) {
        res.innerHTML = buildVerdict(r[0].data, r[1].data) + buildSimpleTable(r[0].data, r[1].data) + buildBreakdowns(r[0].data, r[1].data);
        setTimeout(function () {
          try { res.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { res.scrollIntoView(); }
        }, 60);
      }
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
  /* RSI color: extended (70+) is GOLD when trend supports it (not alarm-red).
     We treat a high RSI as gold/strength rather than red/danger. */
  function rsiColor(v) {
    return v == null ? '#9a9690'
      : v >= 70 ? '#d4af37'   // extended — gold (strength/extended, not danger)
      : v >= 60 ? '#4ecb8d'   // bullish momentum — green
      : v >= 45 ? '#c9a24b'   // neutral — muted gold
      : v >= 30 ? '#9a9690'   // weak — gray
      : '#7da7ff';            // oversold — cool blue (reversal watch)
  }
  function buildLevels(d) {
    var p = d.price, sup = d.support, res = d.resistance;
    if (p == null || sup == null || res == null) return '';
    function note(t){ return ' <span style="font-size:.62rem;color:#7a7770;letter-spacing:.04em;">' + t + '</span>'; }
    var rows =
      '<div class="gs-mrow"><span class="gs-mlbl">Entry zone</span><span class="gs-mval dn">' + fmt(sup) + note('20-day low') + '</span></div>' +
      '<div class="gs-mrow"><span class="gs-mlbl">Upside level</span><span class="gs-mval up">' + fmt(res) + note('20-day high') + '</span></div>';
    if (p <= sup) {
      rows += '<div class="gs-mrow"><span class="gs-mlbl">Status</span><span class="gs-mval dn">Below 20-day support \u00b7 breakdown</span></div>';
    } else if (p >= res) {
      rows += '<div class="gs-mrow"><span class="gs-mlbl">Status</span><span class="gs-mval gold">At 20-day high \u00b7 breakout</span></div>';
    } else {
      var risk = p - sup, reward = res - p, rr = risk > 0 ? reward / risk : null;
      var rrTxt = rr == null ? '\u2014' : '1 : ' + rr.toFixed(1);
      var rrCls = rr == null ? 'muted' : rr >= 2 ? 'gold' : rr >= 1 ? '' : 'dn';
      var toSup = (p - sup) / p * 100, toRes = (res - p) / p * 100;
      rows += '<div class="gs-mrow"><span class="gs-mlbl">Risk / Reward</span><span class="gs-mval ' + rrCls + '">' + rrTxt + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:.66rem;padding:5px 0 1px;">' +
        '<span style="color:#d97a7a;">\u2193 ' + toSup.toFixed(1) + '% to support</span>' +
        '<span style="color:#4ecb8d;">\u2191 ' + toRes.toFixed(1) + '% to resistance</span></div>';
    }
    return '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Technical Levels</div>' + rows + '</div>';
  }

  function buildCard(d, isWin) {
    var sym = disp(d.symbol || '');
    var chg = d.changePercent;
    var chgStr = chg == null ? '—' : (chg >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(chg).toFixed(2) + '%';
    var sig = signal(d);
    var score = d.gildedScore;
    var scoreHtml = score != null
      ? '<div class="gs-score-block"><div class="gs-score-num">' + score +
        '</div><div style="flex:1"><div class="gs-score-bar-lbl">Gilded Score / 100' +
        '<span class="gs-score-info">i<span class="gs-tip">Score uses trend, momentum, RSI, MACD, volume, range position, recent performance, and analyst sentiment when available.</span></span>' +
        '</div>' +
        '<div class="gs-score-track"><div class="gs-score-fill" style="width:' + score + '%"></div></div></div>' +
        sigBadge(sig) + '</div>'
      : '';
    var rc = rsiColor(d.rsi14);
    var rcondTxt = rsiCond(d);
    var rsiHtml = d.rsi14 != null
      ? '<div class="gs-rsi-wrap"><div class="gs-rsi-val" style="color:' + rc + '">' + d.rsi14 +
        (rcondTxt ? ' <span class="gs-rsi-cond" style="color:' + rc + '">' + rcondTxt + '</span>' : '') +
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

    var updatedTxt = lastUpdated(d);
    var updatedHtml = updatedTxt ? '<div class="gs-card-updated">' + updatedTxt + '</div>' : '';

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
      buildLevels(d) +
      '<div class="gs-metric-sec"><div class="gs-metric-sec-lbl">Performance</div>' + retRows +
      (d.analystRating ? '<div class="gs-mrow"><span class="gs-mlbl">Analyst</span><span class="gs-mval gold">' + d.analystRating + '</span></div>' : '') +
      (d.peRatio != null ? '<div class="gs-mrow"><span class="gs-mlbl">P/E Ratio</span><span class="gs-mval">' + Number(d.peRatio).toFixed(1) + '</span></div>' : '') +
      '</div>' +
      '</div>' + updatedHtml + '</div>';
  }

  /* ---------- GRID (bullish-first, clickable) — unchanged ---------- */
  function gridCard(r, rawSym) {
    if (!r.ok) {
      return '<div class="gs-gc" style="opacity:.4"><div class="gs-gc-head"><div>' +
        '<div class="gs-gc-sym">' + disp(rawSym) + '</div><div class="gs-gc-name">Data unavailable</div></div></div></div>';
    }
    var d = r.data, sym = disp(d.symbol || rawSym);
    var chg = d.changePercent || 0;
    var chgStr = (chg >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(chg).toFixed(2) + '%';
    var sig = signal(d);
    var rc = rsiColor(d.rsi14);
    var pct = 0;
    if (d.low != null && d.high != null) { var rng = d.high - d.low; pct = rng > 0 ? Math.min(Math.max((d.price - d.low) / rng * 100, 0), 100) : 50; }
    var rangeHtml = (d.low != null && d.high != null)
      ? '<div class="gs-gc-range"><div class="gs-gc-range-lbl"><span>Day Range</span><span class="gs-gc-range-cur">' + fmt(d.price) +
        '</span></div><div class="gs-gc-track"><div class="gs-gc-fill" style="width:' + pct + '%"></div>' +
        '<div class="gs-gc-cursor" style="left:calc(' + pct + '% - 1px)"></div></div>' +
        '<div class="gs-gc-ends"><span class="gs-gc-end">' + fmt(d.low) + '</span><span class="gs-gc-end">' + fmt(d.high) + '</span></div></div>'
      : '';
    var isBullFamily = sig === 'Bullish' || sig === 'Strong Bullish' || sig === 'Bullish but Extended';
    var updatedTxt = lastUpdated(d);
    var updatedHtml = updatedTxt ? '<div class="gs-gc-updated">' + updatedTxt + '</div>' : '';
    return '<div class="gs-gc ' + (isBullFamily ? 'bullish' : '') + '" data-sym="' + disp(rawSym) + '" data-scroll="1">' +
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
      updatedHtml +
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

    var wlx = t.closest('[data-remove-watch]');
    if (wlx) { removeFromWatchlist(wlx.getAttribute('data-remove-watch')); return; }

    var rem = t.closest('[data-remove]');
    if (rem) { removeSlot(parseInt(rem.getAttribute('data-remove'), 10)); return; }

    var card = t.closest('[data-sym]');
    if (card) {
      var sym = card.getAttribute('data-sym');
      if (sym) {
        pick(sym);
        var sug = $('gsSuggest'); if (sug) sug.classList.remove('show');
        if (card.closest('#homeScannerGrid')) { showPage('scanner'); } else { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      }
      return;
    }

    var clr = t.closest('.gs-clear-btn'); if (clr) { clearAll(); return; }
    var run = t.closest('#gsRunBtn'); if (run && !run.disabled) { runCompare(); return; }
    var wlClear = t.closest('#gsWlClearBtn'); if (wlClear) { clearWatchlist(); return; }

    if (!t.closest('.gs-search-shell')) { var sb = $('gsSuggest'); if (sb) sb.classList.remove('show'); }
  });

  /* search box: live suggestions as you type, Enter to load (and auto-compare
     when both boxes are then full), Escape to close the dropdown */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'gsSearchInput') renderSuggestions();
  });
  document.addEventListener('focus', function (e) {
    if (e.target && e.target.id === 'gsSearchInput') renderSuggestions();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== 'gsSearchInput') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      addTyped();
      if (slots.filter(Boolean).length === 2) runCompare(); /* gs-uxfix: Enter auto-compares when both boxes full */
    } else if (e.key === 'Escape') {
      var box = $('gsSuggest'); if (box) box.classList.remove('show');
    }
  });

  /* gs-kbnav: keyboard navigation for the scanner picker (spatial arrows + step-back Backspace). */
  function gsPickerEls() {
    var picker = document.querySelector('.gs-picker');
    if (!picker) return [];
    var sel = '.gs-pill, #gsSlot0, #gsSlot1, #gsSearchInput, .gs-clear-btn, #gsRunBtn:not([disabled])';
    return Array.prototype.slice.call(picker.querySelectorAll(sel)).filter(function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function gsGap(a1, a2, b1, b2) { if (a1 < b2 && b1 < a2) return 0; return Math.max(b1 - a2, a1 - b2); }
  function gsNearest(cur, key) {
    var cr = cur.getBoundingClientRect();
    var ccx = cr.left + cr.width / 2, ccy = cr.top + cr.height / 2;
    var els = gsPickerEls();
    var aligned = null, alignedP = Infinity, any = null, anyScore = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (el === cur) continue;
      var r = el.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - ccx, dy = (r.top + r.height / 2) - ccy;
      var inDir, primary, crossGap;
      if (key === 'ArrowUp')        { inDir = dy < -1; primary = -dy; crossGap = gsGap(cr.left, cr.right, r.left, r.right); }
      else if (key === 'ArrowDown') { inDir = dy > 1;  primary = dy;  crossGap = gsGap(cr.left, cr.right, r.left, r.right); }
      else if (key === 'ArrowLeft') { inDir = dx < -1; primary = -dx; crossGap = gsGap(cr.top, cr.bottom, r.top, r.bottom); }
      else                          { inDir = dx > 1;  primary = dx;  crossGap = gsGap(cr.top, cr.bottom, r.top, r.bottom); }
      if (!inDir) continue;
      if (crossGap === 0) { if (primary < alignedP) { alignedP = primary; aligned = el; } }
      var score = primary + crossGap * 3;
      if (score < anyScore) { anyScore = score; any = el; }
    }
    return aligned || any;
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var k = e.key;
    var isArrow = (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight');
    if (k !== 'Backspace' && !isArrow) return;
    if (!t.closest('.gs-picker')) return;
    if (k === 'Backspace') {
      var chain = [
        document.getElementById('gsSlot0'),
        document.getElementById('gsSlot1'),
        document.getElementById('gsSearchInput'),
        document.querySelector('.gs-clear-btn'),
        document.getElementById('gsRunBtn')
      ];
      var ci = chain.indexOf(t);
      if (ci === -1) return;
      if (t.id === 'gsSearchInput' && t.value) return;
      if ((t.id === 'gsSlot0' || t.id === 'gsSlot1') && slots[ci]) { e.preventDefault(); removeSlot(ci); return; }
      if (ci > 0) { var pv = chain[ci - 1]; if (pv) { e.preventDefault(); pv.focus(); } }
      return;
    }
    if (t.id === 'gsSearchInput') {
      if (k === 'ArrowLeft' || k === 'ArrowRight') return; /* keep the text cursor */
      if (k === 'ArrowUp') { var b = document.getElementById('gsSlot1'); if (b) { e.preventDefault(); b.focus(); } return; }
    }
    var dest = gsNearest(t, k);
    if (dest) { e.preventDefault(); dest.focus(); }
  });

  /* gs-entercmp: both boxes filled -> Enter anywhere on the scanner runs the comparison */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (t && (t.id === 'gsRunBtn' || t.id === 'gsSearchInput')) return; /* handled by their own logic */
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var sp = document.getElementById('page-scanner');
    if (!sp || !sp.classList.contains('active')) return;
    if (slots.filter(Boolean).length === 2) { e.preventDefault(); runCompare(); }
  });

  /* ---------- init ---------- */
  function init() {
    refreshPicker();
    renderWatchlist();
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

  window.gsPickAndScan = function (sym) {
    if (window.showPage) window.showPage('scanner');
    var mobile = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    function go(el, off) {
      if (!el) return;
      var y = el.getBoundingClientRect().top + window.pageYOffset - off;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
    setTimeout(function () {
      var grid = document.querySelector('#page-scanner .gs-grid-section');
      if (!mobile || !sym) { go(grid, 90); return; }
      var tries = 0;
      (function find() {
        var card = document.querySelector('#page-scanner .gs-grid [data-sym="' + sym + '"]');
        if (card) { go(card, 70); return; }
        if (tries === 0) go(grid, 70);
        if (tries++ < 12) setTimeout(find, 250); else go(grid, 70);
      })();
    }, 280);
  };
})();
