# DEPLOYMENT.md — Gilded Signals

## Branches
- `main` → production (gildedsignals.com, Netlify site auto-deploys from main).
- `automation/dev` → all automation work + shadow publishing. Netlify builds a branch preview
  (`https://automation-dev--<netlify-site-name>.netlify.app`) — never the live domain.
- Rollback tag for the pre-automation site: `backup-pre-automation-20261124` (= `6940463`).

## Workflows
| Workflow | Trigger | Writes |
|---|---|---|
| `gs-discovery.yml` "GS Discovery (shadow)" | push to automation/dev, manual | artifact only |
| `gs-schedule.yml` "GS Weekly Automation" | 16 cron slots (CT via gate) + manual | `data/` on `GS_PUBLISH_BRANCH` only |

GitHub runs cron schedules only from the default branch, so `gs-schedule.yml` must also exist on `main`.
It is added there alone with a `[skip netlify]` commit so production does not rebuild. It checks out and
writes to `GS_PUBLISH_BRANCH`, never main, unless `GS_PRODUCTION_APPROVED = yes`.

## Configuration (GitHub → Settings → Secrets and variables → Actions)
Secrets: `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY` (write-ups; without it every
brief is HELD), `RESEND_API_KEY` + `ALERT_TO_EMAIL` (alerts; optional — without them alerts appear in the run summary).
Variables: `GS_SCORECARD_BASE` (URL serving `/api/scorecard-v3` for the publish branch — the branch-preview URL in
shadow mode, `https://gildedsignals.com` in production), `GS_PUBLISH_BRANCH` (default `automation/dev`),
`GS_PRODUCTION_APPROVED` (`yes` only after sign-off).

## Going live (only after 2 clean shadow weekends + compliance/licensing sign-off)
1. Review shadow weeks on the branch preview (Briefings, Results, home cards, mobile).
2. Merge `automation/dev` → `main` through a pull request (no force-push).
3. Set `GS_PUBLISH_BRANCH = main`, `GS_SCORECARD_BASE = https://gildedsignals.com`, `GS_PRODUCTION_APPROVED = yes`.
4. Watch the next Sunday publish and Friday freeze end to end.
