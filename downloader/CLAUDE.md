# downloader/, download_scheduler/

(Python 3.10) — a download is queued in `cde.download_jobs` by web-api, drained by `download_scheduler` (plain polling worker, deliberately off the Prefect harvest pool), extracted/zipped by `downloader`, then emailed to the user.
