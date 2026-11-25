# DEPLOYMENT.md — Gilded Signals (Daily Top 20)

## Branches
- `main` → production (gildedsignals.com). **Unchanged by the automation work so far.**
- `automation/dev` → all automation work. Netlify builds a branch preview
  (`https://automation-dev--<netlify-site-name>.netlify.app`), never the live domain.
- Rollback tag for the pre-automation site: `backup-pre-automation-20261124` (= `6940463`).

## Workflows (all on automation/dev)
| Workflow | Trigger | Writes |
|---|---|---|
| `gs-daily-dryrun.yml` "GS Daily Top 20 (dry run)" | push to automation/dev, manual | artifact only, never publishes |
| `gs-daily.yml` "GS Daily Top 20 (publish)" | manual; weekdays 7:30 a.m. CT **only if `GS_DAILY_SCHEDULE` = on** and the file is on main | `data/daily/{date}.json` + `data/daily/index.json` on `GS_PUBLISH_BRANCH`, write-once |

**Retired, do not restore:** `gs-schedule.yml` (weekly Saturday/Sunday/Friday cycle), `gs-discovery.yml`, the Netlify
`trigger-capture` schedule, `engine/run.js`, `engine/schedule.js` and `engine/backtest.js`. A test fails if any weekly job or
cron schedule reappears.

GitHub shows the "Run workflow" button only for workflow files on the default branch. To run the publish workflow by
hand, `gs-daily.yml` must be copied to `main` **by itself** (with `[skip netlify]` so production does not rebuild). That
file has no schedule, so copying it does not start anything automatically.

## Configuration (GitHub → Settings → Secrets and variables → Actions)
Secrets: `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `FINNHUB_API_KEY` (already added). Optional: `RESEND_API_KEY` + `ALERT_TO_EMAIL`
for failure emails. **Not needed any more:** `ANTHROPIC_API_KEY` (the daily list uses no AI writing) and `GS_SCORECARD_BASE`
(there is no weekly grading).
Variables: `GS_PUBLISH_BRANCH` (default `automation/dev`), `GS_PRODUCTION_APPROVED` (`yes` only after sign-off).

## Morning publication time — 7:30 a.m. CT (schedule OFF until you switch it on)
`gs-daily.yml` runs at 12:30 and 13:30 UTC, Monday–Friday (7:30 a.m. CT in summer and in winter). The gate lets
only the slot at or after 7:30 a.m. America/Chicago publish; the other slot does nothing. Holidays are skipped by
the official trading calendar, a scheduled run never publishes after the 8:30 a.m. CT open, and a second publish
on the same day is refused.

Three things must all be true before a scheduled list is published:
1. `gs-daily.yml` is on the default branch (`main`) — GitHub ignores schedules on any other branch.
2. The repository variable **`GS_DAILY_SCHEDULE` = `on`**. Without it every scheduled run is skipped, so copying the
   file to main only adds the manual "Run workflow" button. To pause publishing, delete the variable or set it to `off`.
3. It publishes to `GS_PUBLISH_BRANCH` (default `automation/dev`, the preview). The live site additionally needs
   `GS_PUBLISH_BRANCH = main` and `GS_PRODUCTION_APPROVED = yes`.

## Access rules (enforced server-side where content is premium)
- Daily Top 20: ranks #11–20 free with full data; #1–10 only with a valid subscription cookie (`/api/daily-top20`).
- Scanner: 5 free comparisons, unlimited for subscribers (existing `gs-access.js` gate, unchanged).
- News: world news free; market-news headlines and summaries free for everyone; direct links to outside reporting
  free. Full market-news articles written and published by Gilded Signals require a subscription (none exist yet —
  any future article page must check the subscription cookie on the server before returning the body).

## Going live (only after review on the preview and compliance/licensing sign-off)
1. Review several dry-run and preview-published lists (desktop and mobile, free and subscriber views).
2. Merge `automation/dev` → `main` through a pull request (no force-push).
3. Set `GS_PUBLISH_BRANCH = main` and `GS_PRODUCTION_APPROVED = yes`.
4. Set `GS_DAILY_SCHEDULE = on` (see above).
