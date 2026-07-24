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
  // gb-pick card status badge (Briefings narrative cards only)
  // ---------------------------------------------------------------------
  // Five states, simpler by design than the compact grid's statusInfo():
  // Accumulating / Watching / Waiting for Entry / Completed / Thesis Changed.
  // Built on top of statusInfo() -- does not modify it, so the compact grid
  // and renderScoreRow() below are both untouched.
  //
  // thesisStatus is a NEW field, set only by a human in the picks JSON
  // ("intact" | "changed"), never inferred from price. When "changed", it
  // overrides everything else, since a broken thesis matters regardless of
  // where price sits relative to the zone.
  var PICK_BADGE = {
    accumulating: { label: 'Accumulating', cls: 'accumulating' },
    watching: { label: 'Watching', cls: 'watching' },
    waitingentry: { label: 'Waiting for Entry', cls: 'waitingentry' },
    completed: { label: 'Completed', cls: 'thesiscompleted' },
    thesischanged: { label: 'Thesis Changed', cls: 'thesischanged' },
  };

  function pickStatusBadge(p) {
    if (p.thesisStatus === 'changed') return PICK_BADGE.thesischanged;

    var info = statusInfo(p);
    switch (info.cls) {
      case 'completed':
        return PICK_BADGE.completed;
      case 'buy-zone':
      case 'breakout-triggered':
        return PICK_BADGE.accumulating;
      case 'watch-closely':
        return PICK_BADGE.watching;
      // waiting, breakout-pending, no-entry, data_unavailable, and any
      // unrecognized status all fall back to the same safe default: no
      // position, nothing triggered, nothing to overstate.
      default:
        return PICK_BADGE.waitingentry;
    }
  }

  function renderStatusBadge(p) {
    var b = pickStatusBadge(p);
    return (
      '<span class="gb-status-badge ' + b.cls + '"><span class="gb-status-dot"></span>' +
      b.label + '</span>'
    );
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

  // One stat row, used whether the week is live or fully graded -- no more
  // switching to a different Winners/Losers layout once grading finishes.
  // Average Return is computed here from each pick's own returnPct, so it's
  // real and live pre-grading, not just a post-grading final number.
  function computeAverageReturn(picks) {
    var withReturn = picks.filter(function (p) {
      return p.returnPct != null && !isNaN(p.returnPct);
    });
    if (!withReturn.length) return null;
    var sum = withReturn.reduce(function (acc, p) { return acc + p.returnPct; }, 0);
    return sum / withReturn.length;
  }

  function renderStatsRow(d) {
    var s = d.summary;
    var picks = d.picks;

    var breakoutPending = picks.filter(function (p) {
      return p.entryType === 'breakout' && p.status === 'waiting_for_entry';
    }).length;
    var buyZonesTriggered = s.active + s.profitable + s.unprofitable;
    var activeSetups = s.active;
    var waitingForEntry = s.waitingForEntry - breakoutPending;

    var avg = computeAverageReturn(picks);
    var avgCls = avg != null && avg >= 0 ? 'up' : 'dn';
    var avgHtml = avg != null ? '<span class="' + avgCls + '">' + fmtPct(avg) + '</span>' : '\u2014';
    var spCls = d.benchmark.returnPct != null && d.benchmark.returnPct >= 0 ? 'up' : 'dn';

    return (
      statBox(s.totalPublished, 'Total Published', null, "Every pick published in this week's briefing, across all three tiers.") +
      statBox(avgHtml, 'Average Return', null, 'Average return across every pick with a live or final price. Updates continuously, not just once grading completes.') +
      statBox(buyZonesTriggered, 'Buy Zones Triggered', 'color:#3ECA7A;', 'Picks where price has reached the published accumulation zone at some point this week.') +
      statBox(activeSetups, 'Active Setups', 'color:#3ECA7A;', 'Picks currently open in the zone right now, not yet closed out.') +
      statBox(waitingForEntry, 'Waiting for Entry', 'color:#7ba7c9;', STATUS_TOOLTIPS['waiting']) +
      statBox('<span class="' + spCls + '">' + fmtPct(d.benchmark.returnPct) + '</span>', 'S&amp;P 500 Benchmark', null, 'Week-to-date S&P 500 return, same date range as the picks.')
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

        statsEl.className = 'gr-stats-v2';
        statsEl.innerHTML = renderStatsRow(d);

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

  // ---------------------------------------------------------------------
  // Accumulation Zone visual (Briefings narrative cards) -- replaces the
  // old hand-typed "Where I'm buying" paragraph. Reads zones straight from
  // data, so a new week only ever needs a data change, never a markup edit.
  // ---------------------------------------------------------------------
  function renderAccumZone(p) {
    if (!p.zones || !p.zones.length) {
      return (
        '<div class="gb-accumzone"><span class="gb-accumzone-lbl">Accumulation Zone</span>' +
        '<div class="gb-accumzone-note">No entry zone published this week.</div></div>'
      );
    }

    var cur = p.currentPrice != null ? p.currentPrice : p.priceAtPublish;
    var values = p.zones.map(function (z) { return z.price; });
    if (cur != null) values.push(cur);
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = Math.max(max - min, 0.01);
    // Zones are often tight (single-digit % apart) -- wider padding than a
    // typical chart keeps closely-spaced ticks from overlapping.
    var pad = span * 0.35;
    var scaledMin = min - pad;
    var scaledSpan = (max + pad) - scaledMin;
    function pct(v) { return ((v - scaledMin) / scaledSpan) * 100; }

    var sorted = p.zones.slice().sort(function (a, b) { return b.price - a.price; });
    var ticksHtml = sorted.map(function (z, i) {
      return (
        '<div class="gb-accumzone-tick' + (i === 0 ? '' : ' minor') + '" style="left:' + pct(z.price).toFixed(1) + '%">' +
        '<span class="gb-accumzone-ticklbl">$' + z.price + '<span>' + Math.round(z.weight * 100) + '%</span></span></div>'
      );
    }).join('');
    var curMarker = cur != null
      ? '<div class="gb-accumzone-curmarker" style="left:' + pct(cur).toFixed(1) + '%"></div>'
      : '';
    var chips = sorted.map(function (z) {
      return '<span class="gb-accumzone-chip"><b>' + Math.round(z.weight * 100) + '%</b> at $' + z.price + '</span>';
    }).join('');
    var noteHtml = p.note ? '<div class="gb-accumzone-note">' + p.note + '</div>' : '';

    return (
      '<div class="gb-accumzone">' +
      '<div class="gb-accumzone-head"><span class="gb-accumzone-lbl">Accumulation Zone</span>' +
      (cur != null ? '<span class="gb-accumzone-current">Current <b>$' + cur + '</b></span>' : '') +
      '</div>' +
      '<div class="gb-accumzone-track">' + ticksHtml + curMarker + '</div>' +
      '<div class="gb-accumzone-chips">' + chips + '</div>' +
      noteHtml +
      '</div>'
    );
  }

  function renderPickLiveBlock(p) {
    return '<div style="margin-bottom:12px;">' + renderStatusBadge(p) + '</div>' + renderAccumZone(p);
  }

  // Static picks file (zones, note) is fetched separately from the live
  // scorecard API (price, status, actionStatus) and merged by ticker, so
  // this works regardless of whether the API echoes zones back or not.
  function fetchStaticPicks(week) {
    var key = 'static:' + week;
    if (!pending[key]) {
      pending[key] = fetch('/data/picks-' + week + '.json')
        .then(function (r) { return r.json(); })
        .catch(function () { return null; });
    }
    return pending[key];
  }

  function loadPickLiveBlocks() {
    var mounts = document.querySelectorAll('.gb-pick-live[data-ticker]');
    if (!mounts.length) return;
    var weekEl = document.querySelector('[data-live="true"][data-week]');
    var week = weekEl ? weekEl.getAttribute('data-week') : null;
    if (!week) return;

    Promise.all([fetchScorecard(week), fetchStaticPicks(week)])
      .then(function (results) {
        var live = results[0];
        var staticData = results[1];
        if (!live || live.error || !Array.isArray(live.picks)) return;

        var staticByTicker = {};
        if (staticData && Array.isArray(staticData.picks)) {
          staticData.picks.forEach(function (sp) { staticByTicker[sp.ticker] = sp; });
        }

        var liveByTicker = {};
        live.picks.forEach(function (lp) { liveByTicker[lp.ticker] = lp; });

        mounts.forEach(function (el) {
          var ticker = el.getAttribute('data-ticker');
          var lp = liveByTicker[ticker];
          if (!lp) return;
          var merged = Object.assign({}, staticByTicker[ticker] || {}, lp);
          el.innerHTML = renderPickLiveBlock(merged);
        });
      })
      .catch(function () { /* leave mounts as-is rather than show something wrong */ });
  }

  function load() {
    loadBriefGrid();
    loadResultsPanel();
    loadPickLiveBlocks();
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
      pickStatusBadge: pickStatusBadge,
      renderStatusBadge: renderStatusBadge,
      computeAverageReturn: computeAverageReturn,
      renderStatsRow: renderStatsRow,
      renderAccumZone: renderAccumZone,
      PICK_BADGE: PICK_BADGE,
    };
  }
})();
