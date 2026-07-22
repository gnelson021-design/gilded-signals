/* =====================================================================
   GILDED SIGNALS — LIVE SCORECARD ENGINE FRONTEND
   ------------------------------------------------------------------------
   Two renderers, both driven by the same scorecard.js API call:

   1. Briefings compact grid (#gs-live-status-grid) — one badge per pick,
      unchanged from the original build.
   2. Results full scorecard panel (#gr-live-stats / #gr-live-scorelist)
      — NEW. Renders the same live data as an actual scorecard: stat
      box, per-pick rows, methodology + timestamp, all from one fetch.

   Both a page's containers can exist in the DOM at once (single-page
   app, all .page sections are always present, just hidden), so this
   file fetches each requested week only ONCE per page load and shares
   the result between both renderers if both are present.

   The Results panel is adaptive: while a week is in progress
   (completedTriggered === 0) it shows Triggered / Waiting for Entry /
   No Entry This Week / S&P 500 Week-to-Date. The moment Friday's
   grading produces at least one closed pick, it automatically switches
   to the standard Average Return / Winners / Losers / S&P 500
   Benchmark format — no manual rebuild needed when that happens.

   Honesty rule, unchanged: if a fetch fails or the API returns an
   error, every affected element says so plainly. Nothing here ever
   fabricates a status, a price, or a return.
   ===================================================================== */
(function () {
  'use strict';
  var API = '/api/scorecard?week=';
  var pending = {}; // week -> Promise, so both renderers share one fetch

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '\u2014';
    return (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2) + '%';
  }

  function fetchScorecard(week) {
    if (!pending[week]) {
      pending[week] = fetch(API + encodeURIComponent(week)).then(function (r) {
        return r.json();
      });
    }
    return pending[week];
  }

  // Label + badge class depend on BOTH status and entryType, since MSTR's
  // breakout mechanic gets its own language rather than being lumped in
  // with the dip-zone picks. Shared by both renderers.
  // Tooltip copy, keyed by badge class. Shared by every renderer so the
  // wording never drifts between the compact grid and the full panel.
  var STATUS_TOOLTIPS = {
    waiting: "Price hasn't reached the published buy zone yet.",
    'watch-closely': "Price is approaching the published buy zone \u2014 nothing has happened yet, just worth watching closely.",
    'buy-zone': "Price is inside the published buy zone. This is where I'm personally looking to accumulate \u2014 not a signal that it's still a fresh buy.",
    'breakout-pending': "Waiting for a confirmed daily close above the published breakout level.",
    'breakout-triggered': "Price closed above the published breakout level. This does not mean the stock is still a buy today.",
    'no-entry': 'No actionable entry was published this week, or market data was unavailable for this pick.',
    completed: 'Week finished and graded. The return shown is final for this pick.',
  };

  // Personal posture labels for the compact board only ("This Week's Board,
  // Right Now"). Purely a display layer -- never used by statusInfo() or
  // the Results scorecard panel. Values come only from the weekly picks
  // JSON's explicit "actionStatus" field, never inferred from price.
  var ACTION_STATUS_LABELS = {
    accumulating: 'Accumulating',
    holding: 'Holding',
    adding_on_weakness: 'Adding on Weakness',
    waiting_further_downside: 'Waiting for Further Downside',
    holding_off: 'Holding Off',
    monitoring: 'Monitoring',
  };

  function statusInfo(p) {
    var isBreakout = p.entryType === 'breakout';

    if (isBreakout) {
      if (p.status === 'waiting_for_entry') return { label: 'Breakout Pending', cls: 'breakout-pending' };
      if (p.status === 'active') return { label: 'Breakout Triggered', cls: 'breakout-triggered' };
      if (p.status === 'closed_win') return { label: 'Completed', cls: 'completed' };
      if (p.status === 'closed_loss') return { label: 'Completed', cls: 'completed' };
    }

    switch (p.status) {
      case 'waiting_for_entry':
        return p.watchClose
          ? { label: 'Triggered (Watch Closely)', cls: 'watch-closely' }
          : { label: 'Waiting for Entry', cls: 'waiting' };
      case 'active':
        return { label: 'Buy Zone', cls: 'buy-zone' };
      case 'closed_win':
        return { label: 'Completed', cls: 'completed' };
      case 'closed_loss':
        return { label: 'Completed', cls: 'completed' };
      case 'no_entry_this_week':
        return { label: 'No Setup This Week', cls: 'no-entry' };
      case 'data_unavailable':
        return { label: 'Data Unavailable', cls: 'no-entry' };
      default:
        return { label: p.status, cls: 'waiting' };
    }
  }

  // ---------------------------------------------------------------------
  // Briefings compact grid
  // ---------------------------------------------------------------------
  // Wraps statusInfo() for the compact board only -- does not modify it,
  // so renderScoreRow() / the Results scorecard panel is untouched.
  //   - Buy Zone stays exactly as computed from the published entry zones
  //     (statusInfo/info.cls), never altered by actionStatus.
  //   - A personal-posture suffix ("action") is only ever added once the
  //     objective status is actually Buy Zone. If actionStatus is missing
  //     or doesn't match a known posture, it defaults to "Monitoring" --
  //     never guessed as Accumulating/Holding/etc.
  //   - Triggered (Watch Closely) is relabeled to match the board's other
  //     dot-separated labels. Same status, same class, cosmetic only.
  function gridStatusInfo(p) {
    var info = statusInfo(p);

    if (info.cls === 'watch-closely') {
      return { label: 'Triggered \u00b7 Watch Closely', cls: info.cls, action: null };
    }

    if (info.cls === 'buy-zone') {
      var action = ACTION_STATUS_LABELS[p.actionStatus] || ACTION_STATUS_LABELS.monitoring;
      return { label: info.label, cls: info.cls, action: action };
    }

    return { label: info.label, cls: info.cls, action: null };
  }

  function renderGridItem(p) {
    var info = gridStatusInfo(p);
    var detail = '';
    if (
      (p.status === 'active' || p.status === 'closed_win' || p.status === 'closed_loss') &&
      p.returnPct != null
    ) {
      var cls = p.returnPct >= 0 ? 'up' : 'dn';
      detail = '<span class="gs-live-status-ret ' + cls + '">' + fmtPct(p.returnPct) + '</span>';
    }
    var action = info.action
      ? '<span class="gs-live-status-action">' + info.action + '</span>'
      : '';
    return (
      '<div class="gs-live-status-item">' +
      '<span class="gs-live-status-sym">' + p.ticker + '</span>' +
      '<span class="gs-live-status-badge ' + info.cls + '">' + info.label + '</span>' +
      detail +
      action +
      '</div>'
    );
  }

  function loadBriefGrid() {
    var grid = document.getElementById('gs-live-status-grid');
    if (!grid) return;
    var wrap = grid.closest('[data-live="true"]');
    var week = wrap ? wrap.getAttribute('data-week') : null;
    if (!week) return;

    fetchScorecard(week)
      .then(function (d) {
        if (!d || d.error || !Array.isArray(d.picks) || !d.picks.length) {
          grid.innerHTML = '<div class="gs-live-status-loading">Live status unavailable right now.</div>';
          return;
        }
        grid.innerHTML = d.picks.map(renderGridItem).join('');
      })
      .catch(function () {
        grid.innerHTML = '<div class="gs-live-status-loading">Live status unavailable right now.</div>';
      });
  }

  // ---------------------------------------------------------------------
  // Results full scorecard panel
  // ---------------------------------------------------------------------
  function renderScoreRow(p) {
    var info = statusInfo(p);
    var rankStr = (p.rank < 10 ? '0' : '') + p.rank;

    var pctHtml = '<span class="gb-scorepct" style="color:var(--text-muted);">&mdash;</span>';
    if (
      (p.status === 'active' || p.status === 'closed_win' || p.status === 'closed_loss') &&
      p.returnPct != null
    ) {
      var cls = p.returnPct >= 0 ? 'up' : 'dn';
      pctHtml = '<span class="gb-scorepct ' + cls + '">' + fmtPct(p.returnPct) + '</span>';
    }

    var label = p.entryType === 'breakout' ? 'Official entry trigger' : 'Status';
    var tip = STATUS_TOOLTIPS[info.cls];
    var dot = tip ? ' <span class="gs-term-icon" data-tip="' + tip.replace(/"/g, '&quot;') + '" tabindex="0" role="button">i</span>' : '';
    var line = label + ': <b class="gr-live-badge ' + info.cls + '">' + info.label + '</b>' + dot;
    if (p.entryDate) line += ' &middot; entered ' + p.entryDate;
    if (p.note) line += ' &middot; ' + p.note;

    return (
      '<div class="gb-score">' +
      '<div class="gb-rank">' + rankStr + '</div>' +
      '<div>' +
      '<div class="gb-scoretop">' +
      '<div class="gb-pick-head"><span class="gb-ticker">' + p.ticker + '</span>' +
      '<span class="gb-company">' + p.company + '</span></div>' +
      pctHtml +
      '</div>' +
      '<div class="gb-scoreline">' + line + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function statBox(value, label, colorStyle, tooltip) {
    var lbl = tooltip
      ? label + ' <span class="gs-term-icon" data-tip="' + tooltip.replace(/"/g, '&quot;') + '" tabindex="0" role="button">i</span>'
      : label;
    return (
      '<div class="gr-stat-box"><div class="wrh-stat-num"' + (colorStyle ? ' style="' + colorStyle + '"' : '') + '>' +
      value + '</div><div class="wrh-stat-lbl">' + lbl + '</div></div>'
    );
  }

  function loadResultsPanel() {
    var statsEl = document.getElementById('gr-live-stats');
    if (!statsEl) return;
    var wrap = statsEl.closest('[data-live="true"]');
    var week = wrap ? wrap.getAttribute('data-week') : null;
    if (!week) return;

    var listEl = document.getElementById('gr-live-scorelist');
    var footEl = document.getElementById('gr-live-scorefoot');
    var metaEl = document.getElementById('gr-live-meta');
    var bannerEl = document.getElementById('gr-status-banner');
    var statusLabelEl = document.getElementById('gr-status-label');
    var statusSubEl = document.getElementById('gr-status-sub');
    var leadEl = document.getElementById('gr-status-lead');

    fetchScorecard(week)
      .then(function (d) {
        if (!d || d.error || !Array.isArray(d.picks) || !d.picks.length) {
          statsEl.innerHTML = '<div class="gr-live-loading">Live scorecard unavailable right now.</div>';
          if (listEl) listEl.innerHTML = '';
          return;
        }

        var s = d.summary;
        var spCls = d.benchmark.returnPct != null && d.benchmark.returnPct >= 0 ? 'up' : 'dn';

        // Breakout Pending is derived here, client-side, from fields the
        // API already sends per pick (entryType + status) -- no backend
        // or scoring change, just a more specific label for a subset of
        // the existing "waiting for entry" picks.
        var breakoutPending = d.picks.filter(function (p) {
          return p.entryType === 'breakout' && p.status === 'waiting_for_entry';
        }).length;
        var dipWaiting = s.waitingForEntry - breakoutPending;

        if (s.completedTriggered > 0) {
          // Grading has produced at least one final result -> standard
          // graded-week format, same as the archived weeks below it.
          var avgCls = s.modelReturnPct != null && s.modelReturnPct >= 0 ? 'up' : 'dn';
          statsEl.className = 'gr-stats-v2';
          statsEl.innerHTML =
            statBox(s.totalPublished, 'Total Published') +
            statBox('<span class="' + avgCls + '">' + fmtPct(s.modelReturnPct) + '</span>', 'Average Return') +
            statBox(s.profitable, 'Winners', 'color:#3ECA7A;') +
            statBox(s.unprofitable, 'Losers', 'color:#E85555;') +
            statBox('<span class="' + spCls + '">' + fmtPct(d.benchmark.returnPct) + '</span>', 'S&amp;P 500 Benchmark');
        } else {
          // Still in progress -> status counts, not a fabricated average.
          var buyZoneTotal = s.active + s.profitable + s.unprofitable;
          var watchCloseTotal = d.picks.filter(function (p) {
            return p.status === 'waiting_for_entry' && p.entryType !== 'breakout' && p.watchClose;
          }).length;
          var waitingOnly = dipWaiting - watchCloseTotal;
          statsEl.className = 'gr-stats-v2';
          statsEl.innerHTML =
            statBox(s.totalPublished, 'Total Published', null, "Every pick published in this week's briefing, across all three tiers.") +
            statBox(buyZoneTotal, 'Buy Zone', 'color:#3ECA7A;', STATUS_TOOLTIPS['buy-zone']) +
            statBox(watchCloseTotal, 'Triggered (Watch Closely)', 'color:#e8ca7a;', STATUS_TOOLTIPS['watch-closely']) +
            statBox(waitingOnly, 'Waiting for Entry', 'color:#9a9690;', STATUS_TOOLTIPS['waiting']) +
            statBox(breakoutPending, 'Breakout Pending', 'color:#7ba7c9;', STATUS_TOOLTIPS['breakout-pending']) +
            statBox(s.noEntryThisWeek, 'No Setup This Week', 'color:#7a7770;', 'No actionable entry was published for this pick this week.') +
            statBox('<span class="' + spCls + '">' + fmtPct(d.benchmark.returnPct) + '</span>', 'S&amp;P 500, WTD', null, 'Week-to-date S&P 500 return, same date range as the picks.');
        }

        if (listEl) listEl.innerHTML = d.picks.map(renderScoreRow).join('');

        if (bannerEl) {
          bannerEl.className = 'gr-status-banner' + (d.gradingComplete ? ' graded' : ' live');
          if (statusLabelEl) statusLabelEl.textContent = d.gradingComplete ? 'Graded \u2014 Week Closed' : 'Live';
          if (statusSubEl) {
            statusSubEl.textContent = d.gradingComplete
              ? 'Final scorecard, graded close-to-close through Friday.'
              : 'Grading completes Friday after close \u2014 nothing below is final.';
          }
        }

        if (leadEl) {
          leadEl.textContent = d.gradingComplete
            ? 'This week is complete and graded close-to-close through Friday. Every number below comes from the same engine that grades every scorecard \u2014 locked as final, no hindsight edits.'
            : 'This week is still in progress. Every number below comes from the same engine that grades the final scorecard Friday after close \u2014 nothing here is final until the week closes.';
        }

        if (footEl) {
          var ts = new Date(d.dataTimestamp);
          var tsStr = ts.toLocaleString('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
          });
          footEl.textContent = d.gradingComplete
            ? 'Graded as of ' + tsStr + ' ET.'
            : 'Live as of ' + tsStr + ' ET. Nothing here is final until grading completes Friday after close.';
        }

        if (metaEl) {
          metaEl.innerHTML =
            'Methodology <b>' + d.methodologyVersion + '</b> &middot; data via ' + d.dataSource;
        }
      })
      .catch(function () {
        statsEl.innerHTML = '<div class="gr-live-loading">Live scorecard unavailable right now.</div>';
      });
  }

  function load() {
    loadBriefGrid();
    loadResultsPanel();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
    else load();
  }

  // Test-only export — never runs in the browser (module is undefined
  // there), lets the render logic be unit-tested with synthetic data.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      statusInfo: statusInfo,
      renderScoreRow: renderScoreRow,
      statBox: statBox,
      fmtPct: fmtPct,
      gridStatusInfo: gridStatusInfo,
      renderGridItem: renderGridItem,
      ACTION_STATUS_LABELS: ACTION_STATUS_LABELS,
    };
  }
})();
