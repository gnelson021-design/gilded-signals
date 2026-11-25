# SCORING_METHODOLOGY.md — GS Research Engine

Every number here is calculated by versioned, deterministic code in `engine/`. AI never sets a score,
price level or result. Any change to a rule or value bumps the version shown below, and published
weeks keep the version they were published under.

| Layer | Version | Code |
|---|---|---|
| Discovery rank | `d1-shadow` | `engine/stages/discovery.js`, `engine/config.js` |
| Scores and levels | `s3-shadow` (s1, s2 retired after failing validation) | `engine/stages/levels.js`, `scoring.js`, `select.js` |
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

## 4. Entry Score (s3): estimated % chance buy zone 1 is reached this week
s1 (distance + RSI + R:R mix) and s2 (pullback-depth weighting) both **failed** the backtest: expected return
per setup did not rise with the score. What the data does support is trigger likelihood. In the s1 backtest
(20,263 setups), zone 1 was reached 75% of the time when it sat 0–0.5 ATR below the last close, 59% at
0.5–1 ATR, and 46% at 1–1.5 ATR.
- **Formula:** Entry = 82.6 − 29.6 × (distance from last close to zone 1 in ATR), clamped to 5–95.
- **Earnings inside the publish week −10, applied to every such name** (earned-entry rule).
- **Validation:** in the backtest, the actual trigger rate must rise with the score (no inversions in buckets
  with at least 200 setups), and each bucket's actual rate must be within 15 points of its predicted mean.
- Entry is a floor for Primary picks (≥ 40), not a ranking driver. Conviction and Entry stay independent.

## 5. Risk class
High: ATR above 4% of price, or a bearish stack. Elevated: ATR above 2.75%, or lean-bear. Moderate:
ATR above 1.75%, or not bullish. Low: everything else. Earnings in the publish week raises the class one step.

## 6. Weekly selection (preview until approved)
- **Ordering:** Conviction, plus 5 points when R:R is inside 1.0–1.6 (the band the backtest favored:
  48% target-hit rate and the best expected return).
- **Primary Picks (up to 5; up to 3 when SPY's EMA stack is bearish):** each needs Conviction ≥ 70, Entry ≥ 40,
  R:R between 1.0 and 2.0, and a risk class other than High. At most 2 per sector.
- **Secondary Watchlist (up to 10):** up to 3 slots go first to In Focus names with Conviction ≥ 55 and
  R:R ≥ 1.0. The rest need Conviction ≥ 60 and R:R ≥ 1.0. At most 3 per sector in total.
- Any name whose 63-day daily-return correlation with an already-selected name is above 0.85 is skipped.
- Slots are never filled with names that miss the bar.
- Output uses the existing picks schema; `actionStatus` is always `monitoring`.

### Target 1 (s3 change)
Target 1 now defaults to P + 1.25A (was 1.5A) and is capped at P + 1.75A (was 2.5A). On run #4 data, the
median R:R moved from 1.79 to 1.59, and the share of setups inside 1.0–1.6 rose from 33% to 52%.

## 7. Validation
- `node --test engine/test/engine.test.js`: offline tests of the end-to-end run, level ordering and
  rounding, the R:R formula, the simulator rules, the earnings discount, and selection limits.
- Every live run replays its saved inputs and must reproduce the ranking hash and the picks hash exactly.
- `engine/backtest.js`, run every time: 400 liquid stocks × 52 weeks, point-in-time technicals, live
  trigger rules on daily bars, results grouped by Entry Score, technical Conviction, R:R and trend posture,
  with an SPY benchmark. Limits: survivorship bias, no point-in-time news or analyst data, and daily-bar ordering is approximated conservatively.
- Before any version loses its "shadow" label: a backtest review plus at least 2 unpublished shadow weekends.
