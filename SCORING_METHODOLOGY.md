# SCORING_METHODOLOGY.md — GS Research Engine

Every number here is calculated by versioned, deterministic code in `engine/`. AI never sets a score,
price level or result. Any change to a rule or value bumps the version shown below, and published
weeks keep the version they were published under.

| Layer | Version | Code |
|---|---|---|
| Discovery rank | `d1-shadow` | `engine/stages/discovery.js`, `engine/config.js` |
| Scores and levels | `s1-shadow` | `engine/stages/levels.js`, `scoring.js`, `select.js` |
| Grading (unchanged, locked) | `v3-target-invalidation` (v3.1 SIP) | `netlify/functions/scorecard-v3.js` |

"shadow" means the version is not yet approved for publishing.

## Data (all point-in-time at the run)
- Alpaca SIP daily bars (split-adjusted), completed sessions only: on a weekday before 16:20 ET, today's
  still-forming bar is dropped.
- Alpaca news (21 days, every ticker), Alpaca most-active screeners.
- Finnhub analyst recommendation trends, company profile (industry), earnings calendar.
- Stocks with under 200 daily bars, stale data, or non-positive prices are rejected and logged.

## 1. Discovery (d1): what gets researched
Components, each 0–100: attention (news volume × surge, most-active bonus; percentile) 30,
catalysts (headline tags ± and upcoming earnings) 15, trend (EMA 20/50/200 stack + weekly confirmation) 15,
momentum (RSI regime + MACD histogram) 10, relative strength vs SPY over 63 days (percentile) 15,
analysts (consensus level + 3-month drift, at least 3 analysts) 15. Missing components are dropped and the remaining weights re-normalised.

Board = **Leaders** (top 25 overall) + **In Focus** (the 15 most-covered remaining names by raw 7-day
news, any trend).

## 2. Price levels (s1): dip-zone setup
With P = last completed close and A = ATR(14):
- **Buy zone 1:** the highest of {EMA20, 10-day low, P − 1A} that lies between P − 2A and P − 0.25A. Default P − 1A. Weight 60%.
- **Buy zone 2:** the highest of {EMA50, 20-day low, Z1 − 1.5A} that lies between P − 4A and Z1 − 0.75A. Default Z1 − 1.5A. Weight 40%.
- **Invalidation:** Z2 − 1A.
- **Target 1:** the 20-day high if it's at least P + 0.5A, otherwise P + 1.5A, clamped to [P + 0.75A, P + 2.5A] and to at most +12%.
- **Target 2:** the 52-week high if it's at least T1 + 0.5A, otherwise T1 + 1.5A, clamped to [T1 + 1A, P + 5A] and to at most +25%.
- **Rounding:** levels round down to a clean increment ($0.05 under $20, $0.25 under $100, $0.50 under $500, otherwise $1).
- **Risk-to-reward:** (T1 − weighted entry) ÷ (weighted entry − invalidation).
- Rejected if the order Z2 < Z1 < P < T1 < T2 and invalidation < Z2 doesn't hold.

## 3. Conviction Score (0–100): strength of the opportunity
Weights: structure (trend) 25, relative strength 20, analysts 20, news (0.6 × attention + 0.4 × catalysts) 20,
momentum 15. Requires at least 60% of the weight to have real data. Penalty: −3 per negative
headline tag (downgrade, guidance cut, estimate miss, offering, legal), capped at −12.

## 4. Entry Score (0–100): how attractive the current price is
Base: 100 − 30 × (distance from price to buy zone 1 in ATR − 0.25). Adjustments: RSI > 75 −15,
RSI > 70 −8, RSI 40–55 +5. Bearish EMA stack −10. R:R < 1 −15, R:R ≥ 1.5 +5.
**Earnings inside the publish week −10, applied to every such name** (earned-entry discount).
Conviction and Entry are independent: high conviction never means "buy now".

### 4b. Entry Score s2 — CANDIDATE (not used for selection until it validates)
Built from the s1 backtest, which showed s1 rewarding zones that hug the price and those setups underperforming.
Base 50. Distance to zone 1: under 0.5 ATR −15, 0.5–1 ATR 0, 1–1.5 ATR +10, 1.5–2.5 ATR +15, over 2.5 ATR +5.
RSI over 70 −15, RSI 40–60 +10, RSI under 30 −10. Bullish stack +10, bearish −10. R:R under 1 −15, 1–1.6 +10, over 2 −5.
Earnings in the week −10. The backtest scores s1 and s2 on the same setups.
**Validation rule:** expected return per published setup must rise from bucket to bucket (no inversions in
buckets with at least 200 setups), and the top bucket must beat the bottom one. Only a version that passes may drive selection.

## 5. Risk class
High: ATR above 4% of price, or a bearish stack. Elevated: ATR above 2.75%, or lean-bear. Moderate:
ATR above 1.75%, or not bullish. Low: everything else. Earnings in the publish week raises the class one step.

## 6. Weekly selection (preview until approved)
- **Primary Picks (up to 5; up to 3 when SPY's EMA stack is bearish):** ordered by Conviction. Each
  needs Conviction ≥ 70, Entry ≥ 60, R:R ≥ 1.2, and a risk class other than High. At most 2 per sector.
- **Secondary Watchlist (up to 10):** up to 3 slots go first to In Focus names with Conviction ≥ 55
  and R:R ≥ 1.0. The rest are ordered by 0.65 × Conviction + 0.35 × Entry, with Conviction ≥ 60 and R:R ≥ 1.0. At most 3 per sector in total.
- Any name whose 63-day daily-return correlation with an already-selected name is above 0.85 is skipped.
- Slots are never filled with names that miss the bar.
- Output uses the existing `data/picks-YYYY-MM-DD.json` schema, so scorecard-v3 grades it unchanged.
  `actionStatus` is always `monitoring`, because this is model research, never a personal trade posture.

## 7. Validation
- `node --test engine/test/engine.test.js`: offline tests of the end-to-end run, level ordering and
  rounding, the R:R formula, the simulator rules, the earnings discount, and selection limits.
- Every live run replays its saved inputs and must reproduce the ranking hash and the picks hash exactly.
- `engine/backtest.js`, run every time: 400 liquid stocks × 52 weeks, point-in-time technicals, live
  trigger rules on daily bars, results grouped by Entry Score, technical Conviction, R:R and trend posture,
  with an SPY benchmark. Limits: survivorship bias, no point-in-time news or analyst data, and daily-bar ordering is approximated conservatively.
- Before any version loses its "shadow" label: a backtest review plus at least 2 unpublished shadow weekends.
