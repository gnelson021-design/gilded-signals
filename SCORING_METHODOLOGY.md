# SCORING_METHODOLOGY.md — Daily Top 20 (methodology `m2-shadow`)

Every number is produced by versioned, deterministic code in `engine/` from verified market data. Explanations
are generated from those same numbers. No AI writes or alters any figure. A change to any rule or weight bumps
`METHODOLOGY_VERSION` in `engine/config.js`, and every published list records the version it used.

The weekly picks methodology (buy zones, targets, Conviction/Entry scores, `s1`–`s3`) was **retired in November
2026**. Archived weekly records keep the methodology they were published under.

## Timing and data cutoff
- One list per U.S. trading day, for that day. It is built from the **previous session's completed daily bars**
  (official Alpaca calendar: holidays and early closes) plus news published up to the run time.
- Bars after the cutoff session are removed before any calculation, so there is no intraday data and no
  intraday re-ranking. The list is published once (write-once) and stays fixed for the day.
- Every list shows its trading date, the prices-through session and close time, and the news-through timestamp.

## Universe
NYSE, NASDAQ and AMEX common stocks priced at $10 or more, with at least $25M in 20-day average dollar volume
(top 1,500 by dollar volume). Excluded: ETFs/ETNs, funds, leveraged products, warrants, rights, units, preferreds,
SPACs, stocks with under 200 daily bars, and stocks that did not trade on the cutoff session.

## Bullish-momentum eligibility (all required)
Close above the 20-day EMA · 20-day EMA above the 50-day EMA · positive 5-day return · RSI(14) between 50 and 85.

**Confirmed, pending buyouts are not eligible (m2).** If a dated headline in the 21-day news window states a signed
deal in which the company is the *target* ("X to acquire Y", "Y agrees to be acquired", "definitive agreement to
acquire Y", "X completes acquisition of Y"), the stock is excluded — its price tracks the deal terms, not momentum —
and the next eligible stock fills the spot. Rumours and early reports ("in talks", "exploring a sale", "reportedly",
"weighs an offer", "proposed") never exclude; acquirers are never excluded; a later "terminated / called off /
blocked" headline restores eligibility. Each published list names any company excluded this way, with the headline,
date and source. Limitation: a deal announced more than 21 days earlier is outside the news window.

## News hygiene (m2)
Shareholder-solicitation press releases from plaintiff law firms ("… LLP Investigates …", "Shareholder Alert",
class-action deadline reminders) are dropped before news is counted, tagged or shown. Substantive legal and
regulatory news without a law-firm sponsor (SEC charges, court rulings, FTC/DOJ actions) is kept.
Display names drop only a trailing "Common Stock" label; tickers and share classes are unchanged.

## Ranking (0–100), weights
| Component | Weight | Measure |
|---|---|---|
| Price momentum | 25 | average of 5- and 21-session returns, percentile among eligible stocks |
| Relative volume | 15 | last session volume ÷ 20-day average, percentile |
| News attention | 15 | articles in the last 3 days (multi-ticker articles down-weighted) × pace vs the prior 18 days, plus a bump for Alpaca most-active lists, percentile |
| Strength vs S&P 500 | 10 | 63-session return minus SPY's, percentile |
| RSI regime | 10 | 55–70 = 100 · 70–75 = 70 · 50–55 = 65 · above 75 = 40 |
| Trend structure | 10 | EMA 20/50/200 stack, ±10 for weekly confirmation |
| Catalysts | 10 | 50 + 10 per catalyst-type headline (max +30) + 10 for upcoming earnings − 12 per negative headline (max −40) |
| Options activity | 5 | prior-session call ÷ put volume (log scale) plus call volume ÷ open interest; **dropped and re-weighted when verified data is unavailable** |

Each stock lists **every component's contribution in points** ("what drove the rank"). The score is their sum.
Ties are broken alphabetically. The top 20 are published.

## Catalysts and headlines
- **Confirmed:** an earnings date on or after the trading date, within 14 days (Finnhub earnings calendar).
- **Reported in a headline:** catalyst-type headlines (upgrade or target raise, guidance raise, results above estimates,
  contract or partnership, buyback, regulatory approval, M&A) from the last 3 days, shown with date, source and link.
  These are labelled as headline reports, not independently confirmed.
- **Cautions:** negative headlines (downgrade, guidance cut, miss, offering, legal) from the same window.
- **None:** if there is no confirmed event and no catalyst-type headline, the page says so explicitly.
- Headlines are untrusted third-party text. They are shown as dated, attributed quotes and never rewritten into claims.

## Options activity
Alpaca option snapshots for the 40 highest-ranked candidates, using only bars dated to the cutoff session; open
interest comes from Alpaca's contracts list. "Unusual call activity" means call volume is at least 2× put volume and call
volume is at least 0.1× call open interest; puts use the mirror rule. Anything below 2,000 contracts, missing, or dated to
another session is shown as **not available**, never estimated. Availability depends on the account's options data
permissions; the first live run confirms it.

## Access
Ranks #11–20 are free, with full data and explanations. Ranks #1–10 are returned by the server only with a valid
subscription cookie. Locked readers receive the rank number and nothing else.

## Validation
`node --test engine/test/daily.test.js test/site/daily-page.test.js`: eligibility, ranking reproducibility (replay hash),
catalysts, options handling, one fixed list per day (write-once; second runs refused), trading calendar, access rules,
page rendering, and a configuration check that no weekly job or schedule remains. Every dry run also replays its saved
inputs and must reproduce the same list hash.
