// engine/config.js
// All thresholds and weights in one versioned place. Any change to a value
// here that affects ranking MUST bump DISCOVERY_VERSION.

'use strict';

module.exports = {
  DISCOVERY_VERSION: 'd1-shadow',
  SCORING_VERSION: 's3-shadow',

  conviction: {
    // 0–100 each; missing parts dropped and weights re-normalised.
    weights: { structure: 25, relStrength: 20, analysts: 20, news: 20, momentum: 15 },
    minCoverage: 60, // need at least 60% of the weight to have real data
  },

  gates: {
    maxDataAgeDays: 4,   // newest completed bar must be this recent at publish
    maxPriceDiffPct: 2.5, // Alpaca close vs Finnhub second source
  },

  narrative: {
    maxCharsPerField: 320,
    strongConviction: 85, // 'Strong Buy' label threshold (existing brief vocabulary)
  },

  selection: {
    maxPrimary: 5,
    maxPrimaryInWeakMarket: 3, // SPY in a bearish EMA stack → fewer primary picks
    maxWatchlist: 10,
    // s3: ordering = Conviction, plus a bonus for R:R inside the band the
    // backtest favoured. Entry (trigger likelihood) is a floor, not a driver.
    rrBand: [1.0, 1.6],
    rrBandBonus: 5,
    primaryMinConviction: 70,
    primaryMinEntry: 40,       // ≥ ~40% estimated chance the zone is reached
    primaryMinRR: 1.0,
    primaryMaxRR: 2.0,
    primaryExcludeRisk: ['High'],
    // Up to 3 watchlist slots go first to the most talked-about (In Focus)
    // names that still clear a lower conviction bar.
    inFocusWatchSlots: 3,
    inFocusMinConviction: 55,
    watchMinConviction: 60,
    watchMinRR: 1.0,
    primarySectorCap: 2,
    totalSectorCap: 3,
    maxCorrelation: 0.85,      // 63-day daily-return correlation
  },

  universe: {
    exchanges: ['NYSE', 'NASDAQ', 'AMEX'],
    minPrice: 10,
    minAvgDollarVolume: 25e6, // 20-day average close × volume
    maxSymbols: 1500,         // top N by dollar volume after filters
    minHistoryBars: 200,
    maxStaleDays: 6,          // last bar older than this (calendar days) → reject
    // Non-common-stock instruments excluded by name.
    excludeName: /\b(ETF|ETN|ETNs|Fund|iShares|SPDR|ProShares|Direxion|Leveraged|Ultra(Pro|Short)?|Daily [23]X|Warrants?|Rights?|Units?|Preferred|Notes? due|Acquisition Corp)\b/i,
    symbolPattern: /^[A-Z]{1,5}(\.[A-Z])?$/,
  },

  news: {
    windowDays: 21,   // recent 7 days vs prior 14-day baseline
    recentDays: 7,
    maxPages: 1200,   // 50 articles/page
    keepHeadlines: 8, // per candidate, for the Phase 3 AI read
  },

  // Finnhub calls: strongest pre-ranked names PLUS the most-covered names,
  // so heavily discussed stocks in a pullback still get analyst data.
  analysts: { topK: 150, topAttention: 100 },
  earnings: { lookaheadDays: 21 },

  // Two lanes: 'leaders' = best overall d1 score; 'inFocus' = the most
  // talked-about names not already listed, whatever their trend. Pullbacks in
  // heavily covered names are prime buy-zone candidates for Phase 2 scoring.
  board: { leaders: 25, inFocus: 15 },

  // Component weights for the d0 discovery rank (sum = 100). Missing
  // components are dropped and the rest re-normalised; coverage is reported.
  weights: {
    attention: 30,   // news volume + news surge + most-active presence
    catalysts: 15,   // headline catalyst tags + upcoming earnings
    trend: 15,       // EMA stack posture + weekly confirmation
    momentum: 10,    // RSI regime + MACD histogram
    relStrength: 15, // 63-day return vs SPY (percentile)
    analysts: 15,    // consensus level + 3-month drift
  },

  // Headline catalyst tags. Matched case-insensitively on headline text.
  catalystTags: {
    positive: {
      upgrade: /\bupgrade[sd]?\b|raises? (price )?target|initiates? .*\b(buy|outperform|overweight)\b/i,
      guidanceRaise: /raises? (its )?(guidance|outlook|forecast)|boosts? (guidance|outlook)/i,
      beat: /\bbeats?\b.*\b(estimates|expectations)\b|tops (estimates|expectations)/i,
      contract: /\b(wins?|awarded|secures?|lands?)\b.*\b(contract|deal|order)\b|partnership with/i,
      buyback: /\b(buyback|repurchase)\b/i,
      approval: /\bFDA (approv|clear)|\bapproval\b/i,
      ma: /\b(to acquire|acquisition of|merger|takeover|buyout)\b/i,
    },
    negative: {
      downgrade: /\bdowngrade[sd]?\b|cuts? (price )?target|lowers? (price )?target/i,
      guidanceCut: /(cuts?|lowers?|slashes?) (its )?(guidance|outlook|forecast)|warns?/i,
      miss: /\bmiss(es|ed)?\b.*\b(estimates|expectations)\b/i,
      offering: /\b(stock|share|secondary|equity) offering\b|\bdilut/i,
      legal: /\b(lawsuit|probe|investigation|subpoena|SEC charges|class action)\b/i,
    },
  },
};
