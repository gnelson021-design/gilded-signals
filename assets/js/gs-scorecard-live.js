/* =====================================================================
   GILDED SIGNALS — LIVE SCORECARD STATUS STRIP
   ------------------------------------------------------------------------
   Renders each of this week's picks' live status by calling the
   scorecard engine (netlify/functions/scorecard.js) directly. Purely
   additive: this never touches the pick cards, their copy, or any
   existing element on the page.

   Status labels (v2 — renamed 2026-07-13 for precision):
     Triggered           — a published dip-entry zone has been reached.
                            Describes an EVENT (entry happened), not a
                            current recommendation to buy.
     Waiting for Entry    — no published zone reached yet.
     No Setup This Week   — no entry was planned this week at all.
     Breakout Pending /
     Breakout Triggered   — MSTR-only. Kept visually and verbally
                            distinct from the dip-zone language above,
                            since it's a different mechanic (confirmed
                            close above a level, not a pullback zone).

   The week it asks for comes from data-week on the wrapping element,
   not hardcoded here, so this file doesn't need to change week to week.

   Honesty rule, same as gs-brief-live.js: if the fetch fails or the API
   returns an error, the strip says so plainly. It never fabricates a
   status or leaves stale data displayed as if it were current.
   ===================================================================== */
(function () {
  'use strict';
  var API = '/api/scorecard?week=';

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '\u2014';
    return (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2) + '%';
  }

  // Label + badge class depend on BOTH status and entryType, since MSTR's
  // breakout mechanic gets its own language rather than being lumped in
  // with the dip-zone picks.
  function statusInfo(p) {
    var isBreakout = p.entryType === 'breakout';

    if (isBreakout) {
      if (p.status === 'waiting_for_entry') return { label: 'Breakout Pending', cls: 'breakout-pending' };
      if (p.status === 'active') return { label: 'Breakout Triggered', cls: 'breakout-triggered' };
      if (p.status === 'closed_win') return { label: 'Closed \u2014 Win', cls: 'breakout-triggered' };
      if (p.status === 'closed_loss') return { label: 'Closed \u2014 Loss', cls: 'breakout-triggered' };
    }

    switch (p.status) {
      case 'waiting_for_entry':
        return { label: 'Waiting for Entry', cls: 'waiting' };
      case 'active':
        return { label: 'Triggered', cls: 'triggered' };
      case 'closed_win':
        return { label: 'Closed \u2014 Win', cls: 'triggered' };
      case 'closed_loss':
        return { label: 'Closed \u2014 Loss', cls: 'triggered' };
      case 'no_entry_this_week':
        return { label: 'No Setup This Week', cls: 'no-entry' };
      case 'data_unavailable':
        return { label: 'Data Unavailable', cls: 'no-entry' };
      default:
        return { label: p.status, cls: 'waiting' };
    }
  }

  function renderItem(p) {
    var info = statusInfo(p);
    var detail = '';
    if (
      (p.status === 'active' || p.status === 'closed_win' || p.status === 'closed_loss') &&
      p.returnPct != null
    ) {
      var cls = p.returnPct >= 0 ? 'up' : 'dn';
      detail =
        '<span class="gs-live-status-ret ' + cls + '">' + fmtPct(p.returnPct) + '</span>';
    }
    return (
      '<div class="gs-live-status-item">' +
      '<span class="gs-live-status-sym">' + p.ticker + '</span>' +
      '<span class="gs-live-status-badge ' + info.cls + '">' + info.label + '</span>' +
      detail +
      '</div>'
    );
  }

  function load() {
    var grid = document.getElementById('gs-live-status-grid');
    if (!grid) return;
    var wrap = grid.closest('[data-live="true"]');
    var week = wrap ? wrap.getAttribute('data-week') : null;
    if (!week) return;

    fetch(API + encodeURIComponent(week))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.error || !Array.isArray(d.picks) || !d.picks.length) {
          grid.innerHTML =
            '<div class="gs-live-status-loading">Live status unavailable right now.</div>';
          return;
        }
        grid.innerHTML = d.picks.map(renderItem).join('');
      })
      .catch(function () {
        grid.innerHTML =
          '<div class="gs-live-status-loading">Live status unavailable right now.</div>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
