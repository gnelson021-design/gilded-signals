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
| `gs-daily.yml` "GS Daily Top 20 (publish)" | **manual only — no schedule** | `data/daily/{date}.json` + `data/daily/index.json` on `GS_PUBLISH_BRANCH`, write-once |

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

## Morning publication time — NOT SET
The time is a separate decision. When it is chosen, add a `schedule:` block to `gs-daily.yml` with two UTC cron slots
(EST and EDT), and update the configuration test that currently requires no schedule. The gate already refuses
non-trading days, runs after the 09:30 ET open (unless the recovery flag is used), and any second publish on the same day.

## Going live (only after review on the preview and compliance/licensing sign-off)
1. Review several dry-run and preview-published lists (desktop and mobile, free and subscriber views).
2. Merge `automation/dev` → `main` through a pull request (no force-push).
3. Set `GS_PUBLISH_BRANCH = main` and `GS_PRODUCTION_APPROVED = yes`.
4. Decide and add the morning schedule (see above).
