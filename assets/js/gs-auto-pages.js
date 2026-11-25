/* =====================================================================
   GILDED SIGNALS — AUTOMATED WEEK PANELS (Briefings + Results)
   ---------------------------------------------------------------------
   Renders the newest automatically published week using the SAME
   classes and layout as the hand-built panels, makes it the visible
   default (replacing the two manual "flip" steps), and adds it to the
   week dropdown. Older hand-built panels are never touched or removed.

   Dormant by design: /api/auto-week returns {available:false} until the
   automated publish job writes data/weeks.json, so nothing changes on
   the page until a verified automated week exists.

   Wording is neutral ("Model Buy Plan", "Why it qualifies") because
   automated research must never read as anyone's personal trades.
   Every failure path leaves the page exactly as it was.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSAutoPages = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // catalystHtml arrives already escaped by the engine; re-escape defensively
  // without double-encoding existing entities.
  function safeText(s) {
    return String(s == null ? '' : s).replace(/&(?!(?:amp|lt|gt|quot|#\d+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function money(v) {
    if (v == null || isNaN(v)) return '&mdash;';
    var n = Number(v);
    var dp = n % 1 === 0 ? 0 : 2;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: 2 });
  }
  function pct(v) {
    if (v == null || isNaN(v)) return '&mdash;';
    return (v >= 0 ? '+' : '&minus;') + Math.abs(v).toFixed(2) + '%';
  }
  function d(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function addDays(iso, n) { return new Date(d(iso).getTime() + n * 864e5).toISOString().slice(0, 10); }
  function rangeLabel(mondayIso) {
    var a = d(mondayIso), b = d(addDays(mondayIso, 4));
    var left = MONTHS[a.getUTCMonth()] + ' ' + a.getUTCDate();
    var right = (a.getUTCMonth() === b.getUTCMonth() ? '' : MONTHS[b.getUTCMonth()] + ' ') + b.getUTCDate();
    return left + '&ndash;' + right + ', ' + b.getUTCFullYear();
  }
  function shortDate(iso) { if (!iso) return ''; var x = d(iso); return (x.getUTCMonth() + 1) + '/' + x.getUTCDate(); }

  var TIERS = {
    1: { eyebrow: 'Tier 1 &middot; Ranked by Conviction', title: 'Primary Picks',
      sub: 'The highest-conviction setups this week that also carry a workable entry and a risk-to-reward between 1.0 and 2.0. The first five are open to everyone. <b>Risk level</b> is a plain read on volatility, not quality &mdash; Low moves slowly, High can swing hard in a single session. <b>Strong Buy</b> marks a Conviction Score of 85 or higher; <b>Buy</b> is a qualifying setup below that.' },
    2: { eyebrow: 'Tier 2 &middot; Strong Setups &amp; Most-Covered Names', title: 'Secondary Watchlist',
      sub: 'Qualifying setups that missed one Primary requirement this week, plus up to three of the most-discussed names in the market when their setup still clears the bar.' },
  };

  function chart(p) {
    var z1 = p.zones[0].price, z2 = p.zones[1].price;
    var lo = p.invalidationLevel * 0.98, hi = (p.secondTarget || p.firstTarget) * 1.01;
    var pos = function (x) { return Math.max(0, Math.min(100, Math.round(((x - lo) / (hi - lo)) * 1000) / 10)); };
    var t = 'T1 ' + money(p.firstTarget) + (p.secondTarget ? ' &middot; T2 ' + money(p.secondTarget) : '') + ' &middot; Invalidation below ' + money(p.invalidationLevel);
    return '<div class="tl" id="tl-auto-' + esc(p.ticker) + '" data-symbol="' + esc(p.ticker) + '" data-min="' + lo.toFixed(2) + '" data-max="' + hi.toFixed(2) + '">'
      + '<div class="tl-lbl">&#128202; Chart &mdash; model buy zones</div>'
      + '<div class="tl-head"><div><div class="tl-curlabel">Last close <span class="tl-live-badge">' + esc(p.asOfDate || '') + '</span></div><div class="tl-cur">' + money(p.priceAtPublish) + '</div></div></div>'
      + '<div class="tl-buyzone-track">'
      + '<div class="tl-buy-dot" style="left:' + pos(z1) + '%"><div class="tl-buy-lbl"><div class="t">Buy 1</div><div class="p">' + money(z1) + '</div></div></div>'
      + '<div class="tl-buy-dot" style="left:' + pos(z2) + '%"><div class="tl-buy-lbl"><div class="t">Buy 2</div><div class="p">' + money(z2) + '</div></div></div>'
      + '<div class="tl-cur-marker" style="left:' + pos(p.priceAtPublish) + '%"><span class="tl-cur-marker-live">' + money(p.priceAtPublish) + '</span></div>'
      + '</div>'
      + '<div class="tl-avgline"><div class="tl-avgline-lbl">Model targets (locked at publish)</div><div class="tl-avgline-val">' + t + '</div></div>'
      + '<div class="tl-foot">Buy zones locked at publish &middot; never adjusted afterward</div>'
      + '</div>';
  }

  function pickCard(p) {
    var rank = (p.rank < 10 ? '0' : '') + p.rank;
    var lines = '';
    if (p.why) lines += '<div class="gb-why">&#128200; <span class="lbl">Why it qualifies:</span> ' + safeText(p.why) + '</div>';
    if (p.risk) lines += '<div class="gb-riskline">&#9888;&#65039; <span class="lbl">Biggest risk:</span> ' + safeText(p.risk) + '</div>';
    if (p.catalystHtml) lines += '<div class="gb-catalyst"><b>Catalyst:</b> ' + safeText(p.catalystHtml) + '</div>';
    var conv = p.convictionLabel ? '<span class="gb-conviction ' + esc(p.convictionClass) + '">' + esc(p.convictionLabel) + '</span>' : '';
    var risk = p.riskLabel ? '<span class="gb-risk ' + esc(p.riskClass) + '">' + esc(p.riskLabel) + '</span>' : '';
    return '<!-- ' + esc(p.ticker) + ' -->'
      + '<div class="gb-pick"><div class="gb-pick-row"><div class="gb-rank">' + rank + '</div><div>'
      + '<div class="gb-scoretop"><div class="gb-pick-head"><span class="gb-ticker">' + esc(p.ticker) + '</span><span class="gb-company">' + esc(p.company) + '</span></div>' + conv + risk + '</div>'
      + '<div class="gb-scores"><span class="gb-score-chip">Conviction <b>' + Math.round(p.convictionScore) + '</b>/100</span><span class="gb-score-chip">Entry <b>' + Math.round(p.entryScore) + '</b>/100</span></div>'
      + '<div class="gb-buyplan"><div class="gb-buyplan-lbl">&#128205; Model Buy Plan</div>'
      + '<div class="gb-buyplan-row">&#128994; <b>First Buy zone:</b> near <b>' + money(p.zones[0].price) + '</b></div>'
      + '<div class="gb-buyplan-row">&#128994; <b>Second Buy zone:</b> near <b>' + money(p.zones[1].price) + '</b> if it pulls back further</div>'
      + '<div class="gb-buyplan-row">&#128993; <b>If it runs:</b> no chase &mdash; the zones stay as published</div>'
      + '</div>' + lines + chart(p)
      + '</div></div></div>';
  }

  function lockedCard(p) {
    var rank = (p.rank < 10 ? '0' : '') + p.rank;
    return '<div class="gb-pick"><div class="gb-pick-row"><div class="gb-rank">' + rank + '</div><div>'
      + '<div class="gb-scoretop"><div class="gb-pick-head"><span class="gb-ticker">&#9679;&#9679;&#9679;</span><span class="gb-company">Subscriber pick</span></div></div>'
      + '<div class="gb-why">&#128200; <span class="lbl">Why it qualifies:</span> Available to subscribers.</div>'
      + '</div></div></div>';
  }

  function tierBlock(n, picks) {
    if (!picks.length) return '';
    var h = TIERS[n];
    return '<div class="gb-tier-head"><div class="gb-tier-eyebrow">' + h.eyebrow + '</div><h2 class="gb-tier-title">' + h.title + '</h2><p class="gb-tier-sub">' + h.sub + '</p></div>'
      + picks.map(function (p) { return p.locked ? lockedCard(p) : pickCard(p); }).join('');
  }

  function renderBriefPanel(data) {
    var free = data.picks.filter(function (p) { return p.rank <= 5; });
    var premium = data.picks.filter(function (p) { return p.rank > 5; });
    var t1free = free.filter(function (p) { return p.tier === 1; }), t2free = free.filter(function (p) { return p.tier !== 1; });
    var t1prem = premium.filter(function (p) { return p.tier === 1; }), t2prem = premium.filter(function (p) { return p.tier !== 1; });
    var anyLocked = premium.some(function (p) { return p.locked; });
    var premiumHtml = tierBlock(1, t1prem) + tierBlock(2, t2prem);
    if (premium.length) {
      premiumHtml = '<div class="gb-locked-wrap' + (anyLocked ? '' : ' unlocked') + '"><div class="gb-locked-inner">' + premiumHtml + '</div>'
        + (anyLocked ? '<div class="gb-lock-overlay"><div class="gb-lock-card"><div class="gb-lock-icon">&#128274;</div><div class="gb-lock-title">Subscribers Only</div>'
          + '<div class="gb-lock-sub">Unlock the remaining ' + premium.length + ' names &mdash; full write-ups, buy zones, targets and risk levels.</div>'
          + '<button class="gb-lock-cta" onclick="gsBriefUnlock()">Unlock</button></div></div>' : '')
        + '</div>';
    }
    var label = rangeLabel(data.weekOf);
    return '<div class="gb-week-panel" id="gb-week-' + esc(data.weekOf) + '" data-live="true" data-week="' + esc(data.weekOf) + '" data-auto="true">'
      + '<div class="gb-dateline">For the week of <b>' + label + '</b> &middot; Updated Sundays</div>'
      + '<div class="gb-rule"></div>'
      + (data.marketCatalyst ? '<div class="gs-glance" data-week="' + esc(data.weekOf) + '"><div class="gs-glance-eyebrow">This Week at a Glance</div>'
        + '<div class="gs-glance-row"><span class="gs-glance-lbl">Market Catalyst of the Week</span><span class="gs-glance-val" style="font-family:\'DM Sans\',sans-serif;">' + safeText(data.marketCatalyst) + '</span></div></div>' : '')
      + '<div class="gb-topnote">This briefing is produced automatically by the Gilded Signals Research Engine from verified market data. Scores, buy zones, targets and invalidation levels are calculated by versioned code and locked at publish. Hypothetical model research &mdash; not personal trades and not individual financial advice.</div>'
      + (data.lead ? '<p class="gb-lead">' + safeText(data.lead) + '</p>' : '')
      + '<div class="gb-scores-note"><b>Two scores on every pick.</b> <b>Conviction /100</b> is the model&rsquo;s read on the strength of the opportunity. <b>Entry /100</b> is the estimated chance the first buy zone is reached this week (earnings inside the week lower it by 10). High conviction never means buy now &mdash; the zones decide.</div>'
      + '<div class="gs-live-status" data-week="' + esc(data.weekOf) + '"><span class="gs-live-status-lbl">Live &middot; Updated Continuously</span>'
      + '<h3 class="gs-live-status-title">This Week&rsquo;s Board, Right Now</h3>'
      + '<p class="gs-live-status-sub">Where each pick stands &mdash; entry zones triggered, still waiting, or resolved. Same engine that grades the Friday scorecard; nothing here is estimated.</p>'
      + '<div class="gs-live-status-grid" data-auto-board="' + esc(data.weekOf) + '"><div class="gs-live-status-loading">Loading live status&hellip;</div></div></div>'
      + tierBlock(1, t1free) + tierBlock(2, t2free) + premiumHtml
      + '<p class="gb-scorefoot" style="font-size:.72rem;color:#7a7770;">' + esc(data.disclosure || '') + ' Scoring ' + esc(data.scoringVersion || '') + ' &middot; Grading ' + esc(data.methodologyVersion || '') + '.</p>'
      + '</div>';
  }

  var STATUS = {
    watching_no_trade: ['Waiting for Entry', 'waiting'], buy_zone_triggered: ['Triggered', 'buy-zone-triggered'],
    active_position: ['Active Position', 'active-position'], target_reached: ['Target Reached', 'target-reached'],
    stopped_out: ['Invalidation Hit', 'stopped-out'], no_entry_this_week: ['No Setup This Week', 'no-entry'],
    data_unavailable: ['Data Unavailable', 'no-entry'],
  };
  function statusOf(s) { return STATUS[s] || [esc(String(s || '').replace(/_/g, ' ')), 'waiting']; }

  function boardTiles(scorecard) {
    return (scorecard.picks || []).map(function (p) {
      var b = statusOf(p.status);
      var col = p.returnPct == null ? 'var(--text-muted)' : (p.returnPct >= 0 ? '#3ECA7A' : '#E85555');
      return '<div class="gs-live-status-item"><span class="gs-live-status-sym">' + esc(p.ticker) + '</span><span class="gs-live-status-badge ' + b[1] + '">' + b[0] + '</span>'
        + '<span class="gs-live-status-ret" style="color:' + col + ';">' + pct(p.returnPct) + '</span></div>';
    }).join('');
  }

  function scoreLine(p) {
    if (p.status === 'target_reached') return 'Triggered ' + money(p.entryPrice) + ' (' + shortDate(p.entryDate) + ') &rarr; first target ' + money(p.outcomePrice) + ' reached ' + shortDate(p.outcomeDate) + ' &middot; measured at the published exit level';
    if (p.status === 'stopped_out') return 'Triggered ' + money(p.entryPrice) + ' (' + shortDate(p.entryDate) + ') &rarr; invalidation ' + money(p.outcomePrice) + ' hit ' + shortDate(p.outcomeDate) + ' &middot; measured at the published exit level';
    if (p.status === 'active_position' || p.status === 'buy_zone_triggered') return 'Triggered ' + money(p.entryPrice) + ' (' + shortDate(p.entryDate) + ') &middot; open at Friday&rsquo;s close ' + money(p.markPrice) + ' &middot; carried forward under the original levels';
    if (p.status === 'watching_no_trade') return 'Published buy zones were never reached &mdash; no trade, not counted as a win or a loss';
    return 'No setup graded this week';
  }

  function renderResultsPanel(res) {
    var sc = res.scorecard, s = sc.summary || {};
    var friday = addDays(res.weekOf, 4);
    var bench = sc.benchmark ? sc.benchmark.returnPct : null;
    var resolved = (sc.picks || []).filter(function (p) { return p.status === 'target_reached' || p.status === 'stopped_out'; });
    var avg = resolved.length ? resolved.reduce(function (a, p) { return a + p.returnPct; }, 0) / resolved.length : null;
    var box = function (num, lbl, cls) { return '<div class="gr-stat-box"><div class="wrh-stat-num' + (cls ? ' ' + cls : '') + '">' + num + '</div><div class="wrh-stat-lbl">' + lbl + '</div></div>'; };
    var cls = function (v) { return v == null ? '' : v >= 0 ? 'up' : 'dn'; };
    var rows = (sc.picks || []).slice().sort(function (a, b) { return a.rank - b.rank; }).map(function (p) {
      var b = statusOf(p.status);
      var r = p.returnPct;
      return '<div class="gb-score"><div class="gb-rank">' + (p.rank < 10 ? '0' : '') + p.rank + '</div><div><div class="gb-scoretop"><div class="gb-pick-head"><span class="gb-ticker">' + esc(p.ticker) + '</span><span class="gb-company">' + esc(p.company || '') + '</span><span class="gs-live-status-badge ' + b[1] + '">' + b[0] + '</span></div>'
        + '<span class="gb-scorepct ' + cls(r) + '">' + pct(r) + '</span></div><div class="gb-scoreline">' + scoreLine(p) + '</div></div></div>';
    }).join('');
    var lead = (s.tradesEntered || 0) + ' of ' + (s.totalPublished || 0) + ' published buy zones triggered. '
      + (s.targetsReached || 0) + ' reached the first target, ' + (s.stoppedOut || 0) + ' hit invalidation, and ' + (s.stillActive || 0) + ' remain open under their original levels. '
      + 'Every published pick is graded here, winners and losers alike.';
    return '<div class="gr-week-panel" id="gr-week-' + esc(friday) + '" data-week="' + esc(friday) + '" data-auto="true">'
      + '<div class="gb-dateline">Week of <b>' + rangeLabel(res.weekOf) + '</b></div><div class="gb-rule"></div>'
      + '<p class="gb-lead">' + lead + '</p>'
      + '<div class="gr-stats-v2">' + box(s.totalPublished || 0, 'Total Published') + box(s.tradesEntered || 0, 'Trades Entered')
      + box(pct(avg), 'Average Return (Model, Resolved Trades)', cls(avg)) + box(s.neverTriggered || 0, 'Never Triggered') + box(pct(bench), 'S&amp;P 500 Benchmark', cls(bench)) + '</div>'
      + '<div class="gb-section-lbl">Position Status at Friday&rsquo;s Close</div><div class="gr-stats-v2">'
      + box(s.targetsReached || 0, 'Winners (Target Reached)') + box(s.stoppedOut || 0, 'Losers (Invalidation Hit)') + box(s.stillActive || 0, 'Still Active') + '</div>'
      + '<div class="gb-section-lbl">Full Scorecard</div><h2 class="gb-section-title">' + (sc.picks || []).length + ' Picks, Graded</h2>' + rows
      + '<p class="gb-scorefoot" style="font-size:.72rem;color:#7a7770;">Graded at Friday&rsquo;s close &middot; Methodology ' + esc(sc.methodologyVersion || '') + ' &middot; ' + esc(sc.dataSource || '') + ' &middot; Hypothetical model results, not brokerage returns.</p>'
      + '<div class="gb-crosslink"><span class="gb-crosslink-lbl">This Week&rsquo;s Picks</span><a onclick="gsGoToBriefing(\'' + esc(res.weekOf) + '\')">Week of ' + rangeLabel(res.weekOf) + ' &middot; Original Briefing &rarr;</a></div>'
      + '</div>';
  }

  // ---------------- browser bootstrap ----------------
  function newestStatic(selector, prefix) {
    var best = '';
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      var id = (nodes[i].id || '').replace(prefix, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(id) && id > best) best = id;
    }
    return best;
  }

  function installBrief(data) {
    var existing = document.getElementById('gb-week-' + data.weekOf);
    if (existing || data.weekOf <= newestStatic('.gb-week-panel', 'gb-week-')) return false;
    var first = document.querySelector('.gb-week-panel');
    if (!first) return false;
    first.insertAdjacentHTML('beforebegin', renderBriefPanel(data));
    document.querySelectorAll('.gb-week-panel').forEach(function (p) {
      if (p.id !== 'gb-week-' + data.weekOf) { p.setAttribute('data-live', 'false'); p.style.display = 'none'; }
    });
    var sel = document.querySelector('#page-brief .gb-archive-select');
    if (sel) {
      var top = sel.options[0];
      if (top) top.innerHTML = top.innerHTML.replace(/^This Week\s*(&mdash;|—)\s*/, 'Week of ');
      var opt = document.createElement('option');
      opt.value = data.weekOf;
      opt.innerHTML = 'This Week &mdash; ' + rangeLabel(data.weekOf);
      sel.insertBefore(opt, sel.firstChild);
      sel.value = data.weekOf;
    }
    loadBoard(data.weekOf);
    return true;
  }

  function loadBoard(weekOf) {
    fetch('/api/scorecard-v3?week=' + encodeURIComponent(weekOf)).then(function (r) { return r.json(); }).then(function (sc) {
      var grid = document.querySelector('[data-auto-board="' + weekOf + '"]');
      if (grid && sc && sc.picks) grid.innerHTML = boardTiles(sc) || '<div class="gs-live-status-loading">No picks graded yet.</div>';
    }).catch(function () {
      var grid = document.querySelector('[data-auto-board="' + weekOf + '"]');
      if (grid) grid.innerHTML = '<div class="gs-live-status-loading">Live status temporarily unavailable &mdash; published levels are unchanged.</div>';
    });
  }

  // After a reader unlocks, re-request the briefing so ranks 6–15 arrive
  // from the server (they are never present in the page while locked).
  function refreshUnlocked() {
    var panel = document.querySelector('.gb-week-panel[data-auto="true"]');
    if (!panel) return;
    fetch('/api/auto-week?kind=brief', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.available || !data.unlocked || data.weekOf !== panel.getAttribute('data-week')) return;
      var shown = panel.style.display;
      panel.outerHTML = renderBriefPanel(data);
      var fresh = document.getElementById('gb-week-' + data.weekOf);
      if (fresh && shown === 'none') { fresh.style.display = 'none'; fresh.setAttribute('data-live', 'false'); }
      loadBoard(data.weekOf);
    }).catch(function () { /* keep locked view */ });
  }

  function installResults(res) {
    var friday = addDays(res.weekOf, 4);
    if (document.getElementById('gr-week-' + friday) || friday <= newestStatic('.gr-week-panel', 'gr-week-')) return false;
    var first = document.querySelector('.gr-week-panel');
    if (!first) return false;
    first.insertAdjacentHTML('beforebegin', renderResultsPanel(res));
    document.querySelectorAll('.gr-week-panel').forEach(function (p) { if (p.id !== 'gr-week-' + friday) p.style.display = 'none'; });
    var sel = document.querySelector('#page-results .gb-archive-select');
    if (sel) {
      var top = sel.options[0];
      if (top) top.innerHTML = top.innerHTML.replace(/^Most Recent\s*(&mdash;|—)\s*/, '');
      var opt = document.createElement('option');
      opt.value = friday;
      opt.innerHTML = 'Most Recent &mdash; ' + rangeLabel(res.weekOf);
      sel.insertBefore(opt, sel.firstChild);
      sel.value = friday;
    }
    return true;
  }

  function boot() {
    var get = function (kind) { return fetch('/api/auto-week?kind=' + kind, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return null; }); };
    Promise.all([get('brief'), get('results')]).then(function (out) {
      var changed = false;
      try { if (out[0] && out[0].available) changed = installBrief(out[0]) || changed; } catch (e) { /* leave page as-is */ }
      try { if (out[1] && out[1].available) changed = installResults(out[1]) || changed; } catch (e) { /* leave page as-is */ }
      if (changed && typeof window.gsSyncHomeCards === 'function') { try { window.gsSyncHomeCards(); } catch (e) { /* ignore */ } }
    });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function') {
    document.addEventListener('gs:unlocked', refreshUnlocked);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  return { renderBriefPanel: renderBriefPanel, renderResultsPanel: renderResultsPanel, boardTiles: boardTiles, rangeLabel: rangeLabel, esc: esc, safeText: safeText };
});
