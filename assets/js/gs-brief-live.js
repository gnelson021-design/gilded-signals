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

  // Marker position is derived from the two Buy-zone dots' own price/left%
  // rather than data-min/data-max, so it always lines up with them exactly
  // -- the dots are ground truth for this bar; data-min/max is only used
  // below for the separate Min/Max upside percentages.
  function dotScale(el) {
    var dots = el.querySelectorAll('.tl-buy-dot');
    var pts = [];
    dots.forEach(function (d) {
      var leftPct = parseFloat(d.style.left);
      var priceEl = d.querySelector('.tl-buy-lbl .p');
      var priceVal = priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) : NaN;
      if (!isNaN(leftPct) && !isNaN(priceVal)) pts.push({ price: priceVal, pct: leftPct });
    });
    if (pts.length < 2) return null;
    pts.sort(function (a, b) { return a.price - b.price; });
    var lo = pts[0], hi = pts[pts.length - 1];
    if (hi.price === lo.price) return null;
    return { lo: lo, hi: hi };
  }

  function updateBlock(el, price) {
    var min = parseFloat(el.getAttribute('data-min'));
    var max = parseFloat(el.getAttribute('data-max'));
    if (price == null || isNaN(price)) return;

    var cur = el.querySelector('.tl-cur');
    if (cur) cur.textContent = fmt(price);

    var badge = el.querySelector('.tl-live-badge');
    if (badge) { badge.textContent = 'LIVE'; badge.classList.add('is-live'); }

    var markerLive = el.querySelector('.tl-cur-marker-live');
    if (markerLive) markerLive.textContent = fmt(price);

    var marker = el.querySelector('.tl-cur-marker');
    var scale = dotScale(el);
    if (marker && scale) {
      var pctPos = scale.lo.pct + ((price - scale.lo.price) * (scale.hi.pct - scale.lo.pct)) / (scale.hi.price - scale.lo.price);
      marker.style.left = Math.min(Math.max(pctPos, 0), 100).toFixed(1) + '%';
    }

    var ends = el.querySelectorAll('.tl-ends .v');
    if (ends.length === 2 && !isNaN(min) && !isNaN(max) && max > min) {
      var minPct = ((min - price) / price) * 100;
      var maxPct = ((max - price) / price) * 100;
      ends[0].textContent = fmt(min) + ' \u00b7 ' + pct(minPct);
      ends[0].className = 'v ' + (minPct >= 0 ? 'up' : 'dn');
      ends[1].textContent = fmt(max) + ' \u00b7 ' + pct(maxPct);
      ends[1].className = 'v ' + (maxPct >= 0 ? 'up' : 'dn');
    }
  }

  function loadAll() {
    var blocks = document.querySelectorAll('[data-live="true"] .tl[data-symbol]');
    blocks.forEach(function (el) {
      var sym = el.getAttribute('data-symbol');
      if (!sym) return;
      fetch(API + encodeURIComponent(sym))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.price != null && !d.isStale) updateBlock(el, d.price);
        })
        .catch(function () { /* leave the dated snapshot in place, no LIVE badge */ });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAll);
  else loadAll();
})();
