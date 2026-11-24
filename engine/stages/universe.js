// engine/stages/universe.js
// Stock discovery, step 1: build the liquid U.S. common-stock universe.
// No tickers are supplied by hand — the universe comes from Alpaca's
// active-asset list, filtered by instrument type, price and dollar volume.

'use strict';

const cfg = require('../config').universe;

function filterAssets(assets) {
  const kept = [];
  const rejected = {};
  const bump = (r) => { rejected[r] = (rejected[r] || 0) + 1; };
  for (const a of assets || []) {
    if (!a || !a.symbol) continue;
    if (a.status && a.status !== 'active') { bump('inactive'); continue; }
    if (a.tradable === false) { bump('not_tradable'); continue; }
    if (!cfg.exchanges.includes(a.exchange)) { bump('exchange'); continue; }
    if (!cfg.symbolPattern.test(a.symbol)) { bump('symbol_format'); continue; }
    if (cfg.excludeName.test(a.name || '')) { bump('non_common_instrument'); continue; }
    kept.push({ symbol: a.symbol, name: a.name || null, exchange: a.exchange });
  }
  return { kept, rejected };
}

// bars: { SYM: [{c, v, t}, ...asc] } over roughly the last 30 days.
function liquidity(assets, bars) {
  const rows = [];
  const rejected = {};
  const bump = (r) => { rejected[r] = (rejected[r] || 0) + 1; };
  for (const a of assets) {
    const b = bars[a.symbol];
    if (!b || b.length < 10) { bump('no_recent_bars'); continue; }
    const last20 = b.slice(-20);
    const adv = last20.reduce((s, x) => s + x.c * x.v, 0) / last20.length;
    const price = b[b.length - 1].c;
    if (!(price >= cfg.minPrice)) { bump('price_below_min'); continue; }
    if (!(adv >= cfg.minAvgDollarVolume)) { bump('dollar_volume_below_min'); continue; }
    rows.push({ ...a, price, avgDollarVolume: adv });
  }
  rows.sort((x, y) => y.avgDollarVolume - x.avgDollarVolume);
  const capped = rows.length - Math.min(rows.length, cfg.maxSymbols);
  if (capped > 0) rejected.beyond_max_symbols = capped;
  return { kept: rows.slice(0, cfg.maxSymbols), rejected };
}

module.exports = { filterAssets, liquidity };
