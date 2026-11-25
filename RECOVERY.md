# RECOVERY.md — what happens when something fails, and what to do

## Automatic behavior
| Situation | What the system does |
|---|---|
| A provider call fails | bounded retries with backoff; analysts/earnings/most-actives degrade with a logged warning |
| Any safety gate fails on Sunday | brief is HELD, nothing publishes, the previous verified briefing stays with its real date, alert sent |
| Data is stale at publish | publish refuses (`stale data`), alert sent |
| Sunday 18:00 run missed or late | catch-up slots Mon 07:00 CT (before the open); write-once prevents a double publish |
| Friday grading not complete | freeze refuses until `gradingComplete` AND `dataEndClamp ≥ last session close`; catch-ups Sat 08:10 and 11:05 CT; alert after the last one |
| Holiday / early close | official Alpaca calendar decides the last session and its close time |
| A file already exists | publish/freeze refuse to overwrite (write-once) — history is never rewritten |
| Push race | 3 rebase-and-retry attempts, then the run fails and alerts |
| Workflow step fails | "Alert on failure" step emails (or writes the run summary) |
| Daily 07:15 CT health | checks calendar + Finnhub reachability, a missing weekly brief, unfrozen weeks past deadline |

## Manual recovery (Actions → GS Weekly Automation → Run workflow)
- Re-run a job: choose it; tick **force** to ignore the time window. Write-once guards still apply.
- Never edit or delete a published `data/picks-*.json`, `data/brief-*.json` or `data/results-*.json`. A wrong publish is
  corrected by a NEW week, with a disclosure, never by rewriting history.
- Site rollback: deploy the tag `backup-pre-automation-20261124` (Netlify → Deploys) or revert the merge commit on main.
- Local backups from 2026-11-24: `~/gs-fullfolder-20261124.tar.gz`, `~/gs-backup-20261124.bundle`.
