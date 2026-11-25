# RECOVERY.md — Daily Top 20

| Situation | What happens |
|---|---|
| Provider call fails | bounded retries with backoff; most-actives, earnings and options degrade with a logged warning |
| Options data unavailable | options component dropped, other weights re-normalised, each stock shows "Options activity: not available" |
| Prices not through the prior session | build fails (`stale data`); nothing publishes; alert |
| Not a trading day | gate skips; nothing publishes |
| Run after the 09:30 ET open | refused, unless the **allow_late** recovery option is chosen (same prior-close data, still one list for the day) |
| List already published today | refused — the morning list stays fixed; files are write-once |
| No stock meets the momentum criteria | nothing publishes; the page keeps the most recent list with its own date |
| Push race | 3 rebase-and-retry attempts, then the run fails and alerts |
| Any step fails | "Alert on failure" emails (or writes to the run summary) |

Manual recovery: Actions → **GS Daily Top 20 (publish)** → Run workflow → job **publish** (tick **allow_late** only to
recover a missed morning). Never edit or delete a published `data/daily/*.json`; corrections happen in the next day's list.
Weekly archive records (`data/picks-*`, `data/brief-*`, static panels) are preserved and must not be modified.
Site rollback: tag `backup-pre-automation-20261124`. Local backups: `~/gs-fullfolder-20261124.tar.gz`, `~/gs-backup-20261124.bundle`.
