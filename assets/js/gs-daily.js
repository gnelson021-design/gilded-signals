/* =====================================================================
   GILDED SIGNALS — DAILY TOP 20 (page + home card)
   ---------------------------------------------------------------------
   Renders the published Daily Top 20 from /api/daily-top20. Access is
   decided by the server: ranks #11–20 arrive in full for everyone; ranks
   #1–10 arrive only for subscribers (otherwise as locked placeholders
   with no data). Factual research wording only — no buy/sell language.
   Every failure path leaves a clear, dated message; nothing is guessed.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSDaily = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var FACTOR_LABEL = { priceMomentum: 'Price momentum', relVolume: 'Relative volume', attention: 'News attention', relStrength: 'Strength vs S&P 500',
    rsi: 'RSI regime', trend: 'Trend structure', catalysts: 'Catalysts', options: 'Options activity' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? esc(u) : ''; }
  function longDate(ymd) { var p = ymd.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function shortDate(ymd) { if (!ymd) return ''; var p = ymd.split('-'); return MONTHS[+p[1] - 1].slice(0, 3) + ' ' + (+p[2]); }
  function etTime(iso) {
    try { return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (e) { return ''; }
  }
  function etDateOf(iso) { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } catch (e) { return ''; } }
  function pct(v) { if (v == null || isNaN(v)) return '&mdash;'; return (v > 0 ? '+' : v < 0 ? '&minus;' : '') + Math.abs(v).toFixed(1) + '%'; }
  function num(v, dp) { return v == null || isNaN(v) ? '&mdash;' : Number(v).toFixed(dp == null ? 1 : dp); }
  function money(v) { return v == null || isNaN(v) ? '&mdash;' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cls(v) { return v == null ? '' : v >= 0 ? 'up' : 'dn'; }

  var STYLE = '<style id="gs-daily-style">'
    + '.gd-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px;}'
    + '.gd-chip{font-family:monospace;font-size:.66rem;letter-spacing:.04em;padding:4px 9px;border-radius:999px;border:1px solid var(--border);color:var(--text-secondary);background:rgba(255,255,255,.02);}'
    + '.gd-chip b{color:var(--text-primary);font-weight:600;}.gd-chip b.up{color:#3ECA7A;}.gd-chip b.dn{color:#E85555;}'
    + '.gd-h{font-family:\'DM Sans\',sans-serif;font-size:.56rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);opacity:.85;margin:14px 0 6px;}'
    + '.gd-drv{display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:.8rem;line-height:1.45;color:var(--text-secondary);}'
    + '.gd-drv .pts{font-family:monospace;font-size:.68rem;color:var(--gold-light);white-space:nowrap;}'
    + '.gd-drv .lbl{color:var(--text-primary);font-weight:600;}'
    + '.gd-list{margin:0;padding:0;list-style:none;font-size:.8rem;line-height:1.5;color:var(--text-secondary);}'
    + '.gd-list li{margin:0 0 5px;}.gd-list a{color:var(--gold-light);text-decoration:none;}.gd-list a:hover{text-decoration:underline;}'
    + '.gd-meta{font-family:monospace;font-size:.62rem;letter-spacing:.06em;color:var(--text-muted);}'
    + '.gd-none{font-size:.8rem;color:var(--text-muted);font-style:italic;}'
    + '.gd-how{font-size:.8rem;line-height:1.6;color:var(--text-secondary);padding:16px 18px;border:1px solid var(--border);border-radius:8px;background:rgba(212,175,55,.03);margin:18px 0;}'
    + '.gd-select{background:var(--charcoal-2);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-family:monospace;font-size:.72rem;}'
    + '</style>';

  function weightsLine() {
    return 'Price momentum 25 &middot; Relative volume 15 &middot; News attention 15 &middot; Strength vs S&amp;P 500 10 &middot; RSI regime 10 &middot; Trend structure 10 &middot; Catalysts 10 &middot; Options activity 5';
  }

  function header(d) {
    var c = d.dataCutoff || {};
    var opts = (d.days || []).slice().reverse().map(function (x) { return '<option value="' + esc(x) + '"' + (x === d.tradingDate ? ' selected' : '') + '>' + esc(longDate(x)) + '</option>'; }).join('');
    return '<div class="gb-eyebrow">Daily Top 20 &middot; Bullish Momentum Research</div>'
      + '<h1 class="gb-title">Today&rsquo;s <em>Momentum</em></h1>'
      + '<div class="gb-dateline">Trading day <b>' + esc(longDate(d.tradingDate)) + '</b></div>'
      + '<div class="gd-meta" style="margin-top:6px;">Prices through the ' + esc(shortDate(c.pricesThroughSession)) + ' close (' + esc(c.pricesThroughCloseEt || '') + ' ET) &middot; News through ' + esc(shortDate(etDateOf(c.newsThrough))) + ', ' + esc(etTime(c.newsThrough)) + ' &middot; Ranking fixed for the day</div>'
      + (opts ? '<div style="margin-top:12px;"><label class="gd-meta" for="gd-date">Archive&nbsp;</label><select id="gd-date" class="gd-select" onchange="GSDaily.load(this.value)">' + opts + '</select></div>' : '')
      + '<div class="gb-rule"></div>'
      + '<div class="gd-how"><b>How the list is built.</b> Each U.S. trading morning, ' + esc(d.universeSize) + ' liquid U.S. stocks are screened for bullish momentum (price above its rising 20-day average, a positive 5-day return and RSI between 50 and 85). '
      + esc(d.eligibleCount) + ' qualified today, and the strongest 20 are ranked on: ' + weightsLine() + '. Every stock shows what drove its rank, its dated headlines, and any confirmed catalyst &mdash; or says plainly that none was found. '
      + 'Ranks #11&ndash;20 are free. Subscribers see the full list. Methodology ' + esc(d.methodologyVersion) + '.</div>';
  }

  function drivers(e) {
    return '<div class="gd-h">What drove the rank</div><div class="gd-drv">' + (e.drivers || []).map(function (x) {
      return '<div><span class="lbl">' + esc(FACTOR_LABEL[x.factor] || x.factor) + ':</span> ' + esc(x.text) + '</div><div class="pts">' + num(x.points) + ' pts</div>';
    }).join('') + '</div>';
  }

  function catalysts(e) {
    var c = e.catalysts || {};
    var items = [];
    (c.confirmed || []).forEach(function (x) {
      items.push('<li><b>Earnings scheduled ' + esc(longDate(x.date)) + '</b>' + (x.timing ? ' (' + esc(x.timing === 'amc' ? 'after the close' : x.timing === 'bmo' ? 'before the open' : x.timing) + ')' : '') + ' <span class="gd-meta">&middot; ' + esc(x.source) + '</span></li>');
    });
    (c.reported || []).forEach(function (x) {
      var u = safeUrl(x.url);
      items.push('<li>Reported in a headline: <b>' + esc(x.label) + '</b> &mdash; ' + (u ? '<a href="' + u + '" target="_blank" rel="noopener nofollow">' : '') + '&ldquo;' + esc(x.headline) + '&rdquo;' + (u ? '</a>' : '') + ' <span class="gd-meta">&middot; ' + esc(x.source || '') + ', ' + esc(shortDate(x.date)) + '</span></li>');
    });
    (c.cautions || []).forEach(function (x) {
      var u = safeUrl(x.url);
      items.push('<li>Caution &mdash; <b>' + esc(x.label) + '</b>: ' + (u ? '<a href="' + u + '" target="_blank" rel="noopener nofollow">' : '') + '&ldquo;' + esc(x.headline) + '&rdquo;' + (u ? '</a>' : '') + ' <span class="gd-meta">&middot; ' + esc(x.source || '') + ', ' + esc(shortDate(x.date)) + '</span></li>');
    });
    return '<div class="gd-h">Catalysts &amp; events</div>' + (items.length ? '<ul class="gd-list">' + items.join('') + '</ul>' : '<div class="gd-none">' + esc(c.noneText || 'No verified catalyst.') + '</div>');
  }

  function headlines(e) {
    var n = e.news || {};
    var list = (e.headlines || []).map(function (h) {
      var u = safeUrl(h.url);
      return '<li><span class="gd-meta">' + esc(shortDate(h.date)) + ' &middot; ' + esc(h.source || '') + '</span><br>' + (u ? '<a href="' + u + '" target="_blank" rel="noopener nofollow">' : '') + esc(h.headline) + (u ? '</a>' : '') + '</li>';
    }).join('');
    return '<div class="gd-h">Why it&rsquo;s getting attention &middot; last ' + esc(n.windowDays) + ' days</div>'
      + (list ? '<ul class="gd-list">' + list + '</ul>' : '<div class="gd-none">No news articles in the last ' + esc(n.windowDays) + ' days.</div>');
  }

  function optionsLine(e) {
    var o = e.options || {};
    if (!o.available) return '<div class="gd-h">Options activity</div><div class="gd-none">Not available: ' + esc(o.reason || 'no verified data') + '.</div>';
    return '<div class="gd-h">Options activity &middot; ' + esc(shortDate(o.sessionDate)) + ' session</div><div class="gd-meta" style="font-size:.7rem;">Calls ' + Number(o.callVolume).toLocaleString('en-US') + ' &middot; Puts ' + Number(o.putVolume).toLocaleString('en-US')
      + ' &middot; Call/put ' + num(o.callPutRatio, 2) + (o.callVolToOI != null ? ' &middot; Call volume ' + num(o.callVolToOI, 2) + '&times; open interest' : '')
      + (o.unusual === 'calls' ? ' &middot; <b style="color:#3ECA7A;">Unusual call activity</b>' : o.unusual === 'puts' ? ' &middot; <b style="color:#E85555;">Unusual put activity</b>' : '') + '</div>';
  }

  function card(e) {
    var s = e.stats || {};
    var rank = (e.rank < 10 ? '0' : '') + e.rank;
    return '<div class="gb-pick" data-rank="' + e.rank + '"><div class="gb-pick-row"><div class="gb-rank">' + rank + '</div><div>'
      + '<div class="gb-scoretop"><div class="gb-pick-head"><span class="gb-ticker">' + esc(e.ticker) + '</span><span class="gb-company">' + esc(e.company) + (e.sector ? ' &middot; ' + esc(e.sector) : '') + '</span></div>'
      + '<span class="gb-score-chip">Momentum score <b>' + num(e.score) + '</b>/100</span></div>'
      + '<div class="gd-chips"><span class="gd-chip">Last close <b>' + money(e.lastClose) + '</b></span><span class="gd-chip">1-day <b class="' + cls(s.ret1) + '">' + pct(s.ret1) + '</b></span>'
      + '<span class="gd-chip">5-day <b class="' + cls(s.ret5) + '">' + pct(s.ret5) + '</b></span><span class="gd-chip">21-day <b class="' + cls(s.ret21) + '">' + pct(s.ret21) + '</b></span>'
      + '<span class="gd-chip">RSI(14) <b>' + num(s.rsi14) + '</b></span><span class="gd-chip">Rel. volume <b>' + num(s.rvol, 2) + '&times;</b></span>'
      + '<span class="gd-chip">Volatility (ATR) <b>' + num(s.atrPct) + '%</b></span><span class="gd-chip">vs S&amp;P 500, 63d <b class="' + cls(s.relStrength63) + '">' + pct(s.relStrength63) + '</b></span></div>'
      + drivers(e) + catalysts(e) + headlines(e) + optionsLine(e)
      + '</div></div></div>';
  }

  function lockedCard(rankNo) {
    var rank = (rankNo < 10 ? '0' : '') + rankNo;
    return '<div class="gb-pick" data-rank="' + rankNo + '"><div class="gb-pick-row"><div class="gb-rank">' + rank + '</div><div><div class="gb-scoretop"><div class="gb-pick-head"><span class="gb-ticker">&#9679;&#9679;&#9679;</span><span class="gb-company">Subscriber rank</span></div></div>'
      + '<div class="gd-none">Ticker, data and explanations are available to subscribers.</div></div></div></div>';
  }

  function render(d) {
    if (!d || !d.available) {
      return STYLE + '<div class="gb-eyebrow">Daily Top 20 &middot; Bullish Momentum Research</div><h1 class="gb-title">Today&rsquo;s <em>Momentum</em></h1>'
        + '<div class="gb-rule"></div><p class="gb-lead">The Daily Top 20 publishes each U.S. trading morning. ' + (d && d.error ? esc(d.error) + '.' : 'No list has been published yet.') + '</p>';
    }
    var entries = d.entries || [];
    var locked = entries.filter(function (e) { return e.locked; });
    var top10 = entries.filter(function (e) { return e.rank <= 10; });
    var rest = entries.filter(function (e) { return e.rank > 10; });
    var top10Html = top10.map(function (e) { return e.locked ? lockedCard(e.rank) : card(e); }).join('');
    var lockedWrap = top10.length ? '<div class="gb-tier-head"><div class="gb-tier-eyebrow">Ranks 1&ndash;10</div><h2 class="gb-tier-title">The Strongest Ten</h2><p class="gb-tier-sub">The highest momentum scores of the day.' + (locked.length ? ' Available to subscribers.' : '') + '</p></div>'
      + '<div class="gb-locked-wrap' + (locked.length ? '' : ' unlocked') + '"><div class="gb-locked-inner">' + top10Html + '</div>'
      + (locked.length ? '<div class="gb-lock-overlay"><div class="gb-lock-card"><div class="gb-lock-icon">&#128274;</div><div class="gb-lock-title">Subscribers Only</div><div class="gb-lock-sub">Unlock ranks #1&ndash;10 with full data, rank drivers, headlines and catalysts &mdash; plus the market scanner, stock comparisons and market news.</div>'
        + '<button class="gb-lock-cta" onclick="if(typeof gsBriefUnlock===\'function\'){gsBriefUnlock();}else{showPage(\'pricing\');}">Unlock</button></div></div>' : '')
      + '</div>' : '';
    var restHtml = rest.length ? '<div class="gb-tier-head"><div class="gb-tier-eyebrow">Ranks 11&ndash;20 &middot; Free</div><h2 class="gb-tier-title">Also Showing Momentum</h2><p class="gb-tier-sub">Full data and explanations, open to everyone.</p></div>' + rest.map(card).join('') : '';
    return STYLE + header(d) + lockedWrap + restHtml
      + '<p class="gb-scorefoot" style="font-size:.72rem;color:#7a7770;margin-top:22px;">' + esc(d.disclosure || '') + ' Published ' + esc(d.publishedAt ? shortDate(etDateOf(d.publishedAt)) + ', ' + etTime(d.publishedAt) : '') + '. Sources: ' + esc((d.sources || []).join('; ')) + '.</p>';
  }

  function homeCard(d) {
    if (!d || !d.available) return null;
    var show = d.unlocked ? d.entries.filter(function (e) { return e.rank <= 5; }) : d.entries.filter(function (e) { return !e.locked; }).slice(0, 5);
    return {
      date: 'Trading day <b>' + esc(longDate(d.tradingDate)) + '</b>',
      label: d.unlocked ? 'Ranks 1&ndash;5 of 20' : 'Free today &middot; ranks ' + (show[0] ? show[0].rank : 11) + '&ndash;' + (show.length ? show[show.length - 1].rank : 15) + ' of 20',
      list: show.map(function (e) {
        return '<div class="wbh-pick" onclick="showPage(\'daily\')"><div class="wbh-rank">' + (e.rank < 10 ? '0' : '') + e.rank + '</div><div class="wbh-name"><span class="wbh-ticker">' + esc(e.ticker) + '</span><span class="wbh-company">' + esc(e.company) + '</span></div><span class="wbh-tag">' + pct(e.stats && e.stats.ret5) + ' 5d</span></div>';
      }).join(''),
    };
  }

  var lastDate = null;
  function load(date) {
    var rootEl = document.getElementById('gs-daily-root');
    var url = '/api/daily-top20' + (date ? '?date=' + encodeURIComponent(date) : '');
    return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return { available: false, error: 'The Daily Top 20 is temporarily unavailable' }; }).then(function (d) {
      lastDate = d && d.tradingDate;
      if (rootEl) rootEl.innerHTML = render(d);
      if (!date) {
        var h = homeCard(d);
        if (h) {
          var a = document.getElementById('gs-home-daily-date'), b = document.getElementById('gs-home-daily-label'), c = document.getElementById('gs-home-daily-list');
          if (a) a.innerHTML = h.date; if (b) b.innerHTML = h.label; if (c) c.innerHTML = h.list;
        }
      }
      return d;
    });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function') {
    // After a reader unlocks, re-request so ranks #1–10 arrive from the server.
    document.addEventListener('gs:unlocked', function () {
      var sel = document.getElementById('gd-date');
      var viewingLatest = !sel || sel.selectedIndex <= 0;
      load(viewingLatest ? undefined : sel.value);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { load(); }); else load();
  }

  return { render: render, homeCard: homeCard, load: load, esc: esc };
});
