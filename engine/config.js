// engine/config.js
// Daily Top 20 configuration. Every threshold and weight lives here; any change
// that affects ranking MUST bump METHODOLOGY_VERSION (published with each list).

'use strict';

module.exports = {
  METHODOLOGY_VERSION: 'm2-shadow', // m2: confirmed pending buyouts excluded; law-firm solicitations dropped from news
  LIST_SIZE: 20,
  FREE_RANKS: [11, 20],          // shown in full to everyone; #1–10 need a subscription

  // Publication time (not a ranking input — changing it does not change the methodology).
  // Readers see the list at RELEASE time (07:30 America/Chicago): the list is built
  // and deployed ahead of it (from BUILD time, 06:45 CT) and /api/daily-top20 keeps it
  // hidden until 07:30 CT. GitHub cron is UTC-only, so gs-daily.yml has three weekday
  // slots (11:45, 12:45, 13:15 UTC); the gate lets a slot run only from 06:45 CT until
  // the open, and write-once makes every later slot a no-op. The schedule only runs
  // when the repository variable GS_DAILY_SCHEDULE = on.
  PUBLISH: { timeZone: 'America/Chicago', buildTime: '06:45', time: '07:30', label: '7:30 a.m. CT' },

  universe: {
    exchanges: ['NYSE', 'NASDAQ', 'AMEX'],
    minPrice: 10,
    minAvgDollarVolume: 25e6, // 20-day average close × volume
    maxSymbols: 1500,         // top N by dollar volume after filters
    minHistoryBars: 200,
    maxStaleDays: 6,
    excludeName: /\b(ETF|ETN|ETNs|Fund|iShares|SPDR|ProShares|Direxion|Leveraged|Ultra(Pro|Short)?|Daily [23]X|Warrants?|Rights?|Units?|Preferred|Notes? due|Acquisition Corp)\b/i,
    symbolPattern: /^[A-Z]{1,5}(\.[A-Z])?$/,
  },

  // Bullish-momentum eligibility (all must hold at the last completed close).
  eligibility: {
    aboveEma20: true,
    ema20AboveEma50: true,
    minRet5: 0,       // 5-day return must be positive
    minRsi: 50,
    maxRsi: 85,
  },

  news: {
    windowDays: 21,   // baseline window
    recentDays: 3,    // "why it is getting attention" window
    maxPages: 1200,   // 50 articles/page
    keepHeadlines: 8,
    showHeadlines: 3, // dated headlines shown per stock
  },

  earnings: { lookaheadDays: 14 },
  analysts: { topK: 60 },   // Finnhub calls for the strongest ranked names
  options: { topK: 40, minTotalVolume: 2000, unusualRatio: 2.0 },

  // Component weights (sum = 100). Missing components (e.g. options data not
  // available) are dropped and the remaining weights re-normalised.
  weights: {
    priceMomentum: 25, // 5- and 21-day return (percentile among eligible)
    relVolume: 15,     // last session volume ÷ 20-day average (percentile)
    attention: 15,     // recent news volume vs baseline + most-active lists
    relStrength: 10,   // 63-day return vs SPY (percentile)
    rsi: 10,           // RSI regime (healthy momentum best, extended penalised)
    trend: 10,         // EMA 20/50/200 stack + weekly confirmation
    catalysts: 10,     // catalyst-type headlines + upcoming earnings, minus negative headlines
    options: 5,        // prior-session call vs put volume, if verified data is available
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
