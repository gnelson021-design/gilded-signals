/* =====================================================================
   GILDED SIGNALS — WEEKLY BRIEF LIVE PRICE OVERLAY
   ------------------------------------------------------------------------
   Each analyst target-ladder block in the Weekly Brief (.tl[data-symbol])
   is written with a dated snapshot price and Min/Max upside percentages
   as of the brief's publish date. This script fetches a live quote for
   each ticker via the same /api/quote endpoint the scanner uses, and —
   only on a successful fetch — replaces the snapshot with the live
   number in four places: the big "Current" price, the small price label
   above the TODAY marker, the marker's position on the bar, and the
   Min/Max upside percentages (recomputed against the live price).

   Honesty rule: if the fetch fails, nothing is touched. The block keeps
   its dated snapshot and its "Jun 28" label — it never claims LIVE
   unless the number actually is.
   ===================================================================== */
(function () {
  'use strict';
  var API = '/api/quote?symbol=';

  function fmt(v) {
    if (v == null || isNaN(v)) return '—';
    var n = Number(v);
    if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 1000)  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n < 1)      return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }
  function pct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2) + '%';
  }

  function updateBlock(el, price) {
    var min = parseFloat(el.getAttribute('data-min'));
    var max = parseFloat(el.getAttribute('data-max'));
    if (price == null || isNaN(price) || isNaN(min) || isNaN(max) || max <= min) return;

    var cur = el.querySelector('.tl-cur');
    if (cur) cur.textContent = fmt(price);

    var badge = el.querySelector('.tl-live-badge');
    if (badge) { badge.textContent = 'LIVE'; badge.classList.add('is-live'); }

    var markerLive = el.querySelector('.tl-cur-marker-live');
    if (markerLive) markerLive.textContent = fmt(price);

    var marker = el.querySelector('.tl-cur-marker');
    var clamped = Math.min(Math.max(((price - min) / (max - min)) * 100, 0), 100);
    if (marker) marker.style.left = clamped.toFixed(1) + '%';

    var ends = el.querySelectorAll('.tl-ends .v');
    if (ends.length === 2) {
      var minPct = ((min - price) / price) * 100;
      var maxPct = ((max - price) / price) * 100;
      ends[0].textContent = fmt(min) + ' \u00b7 ' + pct(minPct);
      ends[0].className = 'v ' + (minPct >= 0 ? 'up' : 'dn');
      ends[1].textContent = fmt(max) + ' \u00b7 ' + pct(maxPct);
      ends[1].className = 'v ' + (maxPct >= 0 ? 'up' : 'dn');
    }
  }

  function loadAll() {
    var blocks = document.querySelectorAll('.tl[data-symbol]');
    blocks.forEach(function (el) {
      var sym = el.getAttribute('data-symbol');
      if (!sym) return;
      fetch(API + encodeURIComponent(sym))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.price != null) updateBlock(el, d.price);
        })
        .catch(function () { /* leave the dated snapshot in place, no LIVE badge */ });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAll);
  else loadAll();
})();
