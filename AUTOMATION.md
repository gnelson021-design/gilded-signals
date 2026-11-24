# AUTOMATION.md — GS Research Engine and full-automation plan

**Status: NOT OPERATIONAL.** This document is the audit and the build plan. Nothing here is live
until a phase is marked "Verified" below with a dated end-to-end test.

Directives: "GildedSignals — Full Automation Master Directive" and "Technical Implementation
Directive" (both 2026-11-24).

---

## 1. Repository audit (2026-11-24, `origin/main` @ `6940463`)

### State of production
- `main` was last committed on **2026-08-16** (the Aug 17–21 briefing). No later briefings or results
  freezes are on GitHub. The results archive ends at `gr-week-2026-08-14`.
  **To confirm locally:** does `~/gilded-signals` hold unpushed work from after Aug 16?
- Other remote branches: `feature/long-term-mode`, `scanner-data-accuracy-audit`, `stripe-paywall-wiring`.
- Tags: `scanner-live-locked`, `scanner-locked`, `pre-phase1-cleanup-20260802` and others.
- No `.github/workflows/` directory. **There is no GitHub Actions automation yet.**

### What already exists and will be reused
| Component | File | Reuse |
|---|---|---|
| Grading engine (v3.1 SIP, ledger) | `netlify/functions/scorecard-v3.js` | Unchanged. The engine writes picks in this schema so grading needs no edits. |
| Market-hours trigger capture | `netlify/functions/trigger-capture.js` + `netlify.toml` schedule `*/15 13-21 * * 1-5` | Unchanged. This already covers Step 6 (live tracking) for published picks. |
| Append-only trigger ledger | Netlify Blobs `gs-trigger-ledger` | Unchanged. |
| Technical indicators (EMA, RSI, MACD, ATR, relative strength, weekly trend) | `netlify/functions/quote.js` | Extract into shared `_lib/indicators.js` (copy, not move) for the engine. |
| Technical Strength Score (`gildedScore`) | `quote.js` | Becomes the technical component of the Entry Score. |
| ET session/DST helpers | `netlify/functions/_lib/market-session.js` | Reuse. Add the official trading calendar (holidays, early closes). |
| Brief renderer | `scripts/gen_brief_html.py` | Port to JS so new weeks render from JSON with identical `gb-*` markup. |
| Guarded Sunday/Friday patcher | `scripts/patch_weekly.py`, `freeze_results.py`, `gen_results_skeleton.py` | Fallback publishing path, and the reference for the safety contract. |
| Trigger email alerts (Resend + Blobs dedupe) | `scripts/check-triggers.mjs` | Not deployed and points at the legacy `/api/scorecard`. Repoint to v3 for entry-zone alerts. |
| Premium gate (signed cookie) | `picks-protected.js`, `verify-access.js`, `_lib/access-token.js`, `gs-access.js` | Reuse for server-side premium delivery. |
| `/data/*` edge protection | `netlify/edge-functions/protect-picks-data.js` | Reuse. See security finding S1. |

### Manual dependencies to remove
1. Graham selects tickers, tiers, zones, scores, targets and thesis (the weekly content split in memory).
2. Each briefing is a hand-built HTML panel inside `index.html` (6,508 lines, 8 brief panels and 8 results panels).
3. Two manual "flip" steps every week (Briefings `data-live` and the Results panel `display:none`).
4. The Friday freeze is run from the terminal and committed by hand.
5. Closing prices and analyst targets are checked by hand on TradingView.

### Gaps against the directive
- **Conviction and Entry scores have no formula.** They have been authored by hand. "Preserve the existing
  methodology" therefore means writing the formula for the first time, then backtesting it (Step 3).
- **Fundamentals, analyst revisions and earnings data:** Finnhub free tier returns null for market cap and
  P/E on many names (SESSION_NOTES) and has no estimate-revision history. Scoring 500–2,000 stocks on
  fundamentals needs a data provider that requires authorization (see decision D2).
- **Point-in-time backtesting:** price/technical components can be honestly backtested on Alpaca history.
  Fundamental components cannot without point-in-time fundamentals (look-ahead and survivorship bias).
  Plan: backtest the technical/entry layer, and forward-test the fundamental layer in shadow mode.

### Security and compliance findings
- **S1 — Premium content is public.** The repository is public. `data/picks-*.json` (all 15 picks with
  zones) and the full ranks 6–15 briefing HTML in `index.html` can be read by anyone on GitHub and in
  the page source. The edge function protects only the Netlify `/data/*` path. (Decision D3.)
- **S2 — Market-data redistribution.** Publishing Alpaca-derived prices to paying subscribers may need
  a redistribution agreement beyond the current data plan. Needs written confirmation from Alpaca and
  any new provider before automated paid publishing (Step 10).
- **S3 — Investment-advice compliance.** Automated, paid, ticker-specific buy zones and targets need a
  securities-law review (publisher's exclusion and newsletter rules) before production (Rule 14).
- **S4 — Public-repo cron auto-disable.** GitHub disables scheduled workflows in public repos after
  60 days without repository activity. Weekly automated commits keep it alive. Health check must alert
  if a schedule stops firing.

---

## 2. Target architecture

```
GitHub Actions (scheduled, America/Chicago gated)        Netlify (existing)
┌────────────────────────────────────────────┐          ┌──────────────────────────────┐
│ engine/ (Node, CommonJS)                    │          │ scorecard-v3.js  (locked)    │
│  1 universe   Alpaca assets + daily bars    │          │ trigger-capture.js (15 min)  │
│  2 features   _lib/indicators.js            │  picks   │ picks-protected.js (premium) │
│  3 fundamentals/earnings/estimates (D2)     │ ───────► │ brief/results JSON renderers │
│  4 score      conviction-v1, entry-v1       │  brief   │ newsletter + alerts (Resend) │
│  5 levels     zones/target/invalidation/RR  │ results  └──────────────────────────────┘
│  6 select     ≤5 primary, ≤10 watchlist,    │
│               sector caps, correlation cap  │
│  7 narrate    Claude API, JSON in → JSON out│
│  8 validate   gates (below) → publish/hold  │
└────────────────────────────────────────────┘
```

### Output contract
- `picks-{monday}.json` in the **existing locked schema** (`ticker`, `zones[{price,weight}]`, `firstTarget`,
  `invalidationLevel`, `priceAtPublish`, `actionStatus`, `methodologyVersion`, …), plus new additive fields:
  `convictionScore`, `entryScore`, `riskClass`, `riskReward`, `secondTarget`, `scoringVersion`,
  `dataAsOf`, `sources[]`.
- `brief-{monday}.json`: outlook, economy, sectors, theses, catalysts, risks, and timestamps.
- `results-{friday}.json`: frozen scorecard copied from scorecard-v3 output. Write-once.
- `run-log/{date}-{job}.json`: every run, with inputs hash, provider, retries and outcome.

### Validation gates (all must pass or nothing publishes)
1. Every price ≤ 1 trading day old, and two providers agree within tolerance (replaces the TradingView check).
2. Every pick has the complete field set. Zones are below `priceAtPublish` for dip entries, invalidation is below
   the zones, target is above the entry, and RR ≥ the methodology minimum.
3. **Narrative number check:** every number in the AI text must match a number in the input facts.
   Any unmatched number → regenerate once → otherwise hold.
4. Earnings inside the week → the earned-entry discount is applied to every such name.
5. Write-once: if `picks-{week}.json` already exists, abort (no overwrite, no duplicate publish).
6. On any failure: keep the prior verified briefing with its real date, log it and alert Graham.

### Feature flags
- `GS_ENGINE_MODE = shadow | publish` (default **shadow**: write to a private store, never public).
- `GS_AUTOPUBLISH = false` until compliance approval (D4).

---

## 3. Schedule (America/Chicago; cron is UTC, so each job has two UTC slots and checks CT time in code)

| CT time | Job | UTC slots (CST / CDT) | Notes |
|---|---|---|---|
| Mon–Fri, every 15 min in session | Trigger capture | existing Netlify schedule | Already live. |
| Mon–Fri, hourly in session | Entry-zone alerts | `0 14-21 * * 1-5` | Reads v3 ledger; Blobs dedupe. |
| Fri 4:00 PM | Results freeze + Friday newsletter | `0 22 * * 5` / `0 21 * * 5` | Gate on `dataEndClamp`. Early-close days run after the early close. |
| Sat 9:00 AM | Discover, research, rank | `0 15 * * 6` / `0 14 * * 6` | Full universe scan. |
| Sun 3:00 PM | Refresh + validate | `0 21 * * 0` / `0 20 * * 0` | Re-prices; re-runs gates. |
| Sun 6:00 PM | Publish briefing + Sunday newsletter | `0 0 * * 1` / `0 23 * * 0` | Write-once. |
| Daily 7:00 AM | Health check | `0 13 * * *` / `0 12 * * *` | Stale data, missed runs, cron alive, API quota. |

- Trading calendar: Alpaca `/v2/calendar` (official sessions, holidays, early closes). If a Friday is a
  holiday, the week closes on the last session that week.
- Each workflow: `concurrency` group (no overlap), bounded retries with backoff, `workflow_dispatch` for
  manual emergency runs, and catch-up of a missed slot on the next run.

---

## 4. Phase plan

| # | Phase | Output | Exit test |
|---|---|---|---|
| 0 | Protect + document | Backup tag, git bundle, `automation/dev` branch, CLAUDE.md, AUTOMATION.md | Tag and bundle verified |
| 1 | Engine skeleton | `engine/`, `_lib/indicators.js`, universe + technical features, run log, manual workflow | Universe ≥ 500 names, reproducible hash |
| 2 | Scoring v1 | conviction-v1, entry-v1, levels, `SCORING_METHODOLOGY.md` | Backtest report (technical layer); same inputs give the same scores |
| 3 | Selection + narrative + gates | ≤5 + ≤10 selection, Claude narrative, validators | 2+ unpublished shadow Sundays pass every gate |
| 4 | JSON-driven pages | Brief and results renderers, auto-show latest week, homepage week | Visual diff matches existing panels, mobile and desktop |
| 5 | Friday + Sunday publish | Scheduled workflows, write-once publish, freeze | 2+ shadow Fridays reconcile 15/15 with scorecard-v3 |
| 6 | Alerts, health, newsletters | Resend/Kit, health check, failure alerts | Forced-failure drills recover or alert |
| 7 | Subscriber features | Top 25, sector strength, sentiment, catalyst calendar, freshness, countdown | Premium gating verified server-side |
| 8 | Go-live | Compliance and licensing sign-off, flip `GS_AUTOPUBLISH`, 30-day watch | 4 consecutive unattended weeks |

Phase status log:
- Phase 0 — docs, backup tag, bundle, `automation/dev` branch (2026-11-24). Graham to run the commands.
- Phase 1 — discovery engine built and offline-tested (2026-11-24). **Not yet run on live data.**
  Exit test still open: first live manual run in GitHub Actions, universe ≥ 500, replay hash MATCH.

### Phase 1 — what exists now (`engine/`)
| File | Role |
|---|---|
| `engine/run.js` | Orchestrator / CLI. `--out DIR`, `--max-universe N`, `--replay DIR` |
| `engine/config.js` | Every threshold and weight; `DISCOVERY_VERSION = d0-shadow` |
| `engine/lib/indicators.js` | Verbatim copy of quote.js indicator math (quote.js untouched) |
| `engine/lib/http.js` | Timeouts, per-host rate limits, bounded retries, token-redacted errors |
| `engine/lib/runlog.js` | Structured run log (stages, rejections, warnings) |
| `engine/providers/alpaca.js` | Assets, multi-symbol daily bars (SIP), news sweep, most-actives. No order endpoints |
| `engine/providers/finnhub.js` | Recommendation trends, profile (industry), earnings calendar |
| `engine/stages/universe.js` | Common stocks on NYSE/NASDAQ/AMEX, price ≥ $10, 20-day $ volume ≥ $25M, top 1,500 |
| `engine/stages/features.js` | Trend, RSI, MACD, ATR, returns, RS vs SPY, RVOL, 52-week levels; rejects stale/short history |
| `engine/stages/news.js` | 21-day news sweep: 7-day count, surge vs prior baseline, catalyst tags, top headlines |
| `engine/stages/discovery.js` | d0 rank: attention 30, catalysts 10, trend 20, momentum/RSI 15, RS 15, analysts 10 |
| `engine/test/` | Offline end-to-end test on synthetic fixtures + mock fetch |
| `.github/workflows/gs-discovery.yml` | Manual run; uploads the board as a 7-day artifact. No schedule, no publishing |

Output per run: `inputs.json` (everything needed to re-rank), `board.json` (top 40), `run-log.json`,
`summary.md`. `--replay` re-ranks `inputs.json` and must reproduce the same ranking hash.

Phase 1 limits (by design): the d0 rank only chooses what gets researched. It is not the Conviction or
Entry Score and produces no zones. Valuation and earnings-revision data are not in d0 (free-tier limit, D2).
Headline tone is keyword-tagged for now; the AI read of the stored headlines arrives in Phase 3.

---

## 5. Open decisions (Graham)
- **D1 — resolved 2026-11-24.** No unpushed local work; the last briefing was Aug 17–21. Resume with the
  engine — no manual catch-up weeks.
- **D2** Paid fundamentals/estimates provider vs. free tier. **Interim:** v1 runs on existing Alpaca
  (bars, news, most-actives) + Finnhub free (analyst trends, earnings calendar). Valuation waits on this.
- **D3** Close the premium leak: make the repo private, and/or move picks + brief JSON out of git into
  Netlify Blobs / Supabase served only through the existing gated functions.
- **D4** Compliance and data-licensing review owner and timing (gates Phase 8).

## 6. Operating cost (estimate — verify current pricing before authorizing)
- GitHub Actions: free on a public repo; a private repo includes a monthly minutes allowance that this workload fits.
- Netlify, Alpaca, Finnhub, Stripe, Kit: existing plans, no change expected.
- Claude API for weekly narratives: low single-digit to tens of dollars per month.
- Resend: free tier until the subscriber list outgrows it.
- Fundamentals/estimates provider (D2): the main new cost, typically tens of dollars per month at a starter tier.
