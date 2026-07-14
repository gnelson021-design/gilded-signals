/* =====================================================================
   GILDED SIGNALS — LIVE SCORECARD STATUS STRIP
   ------------------------------------------------------------------------
   Renders each of this week's picks' live status — Waiting for Entry,
   Active (with entry price + live return), or No Entry This Week — by
   calling the scorecard engine (netlify/functions/scorecard.js)
   directly. Purely additive: this never touches the pick cards, their
   copy, or any existing element on the page.

   The week it asks for comes from data-week on the wrapping element,
   not hardcoded here, so this file doesn't need to change week to week
   — only the data-week attribute does, as part of the normal weekly
   brief patch.

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

  var LABELS = {
    waiting_for_entry: 'Waiting for Entry',
    active: 'Active',
    closed_win: 'Closed \u2014 Win',
    closed_loss: 'Closed \u2014 Loss',
    no_entry_this_week: 'No Entry This Week',
    data_unavailable: 'Data Unavailable',
  };
  var BADGE_CLASS = {
    waiting_for_entry: 'waiting',
    active: 'active',
    closed_win: 'active',
    closed_loss: 'active',
    no_entry_this_week: 'no-entry',
    data_unavailable: 'no-entry',
  };

  function renderItem(p) {
    var label = LABELS[p.status] || p.status;
    var badgeCls = BADGE_CLASS[p.status] || 'waiting';
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
      '<span class="gs-live-status-badge ' + badgeCls + '">' + label + '</span>' +
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
