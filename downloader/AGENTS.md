# downloader/, download_scheduler/

(Python 3.14) — a download is queued in `cde.download_jobs` by web-api, drained by `download_scheduler` (plain polling worker, deliberately off the Prefect harvest pool), extracted/zipped by `downloader`, then emailed to the user.

## Keep in sync when the download pipeline changes

The package's behaviour is described for humans in several places; a change
to formats, limits, statuses, constraints, metadata records or package files
must update each one it affects, in the same change:

- `docs/harvesting/downloads.md`: the step-by-step doc, rendered in the app at
  `/harvest/docs/downloads` (limits, status table, file layout, citation form).
- `downloader/cioos_downloader/package.py`: the README text (`_TEXT`, both
  languages), `REASONS`, and `_FILE_KINDS` (one entry per file a package can
  hold).
- `download_scheduler/download_scheduler/templates/*.j2`: the email wording.
- Formats are listed in three places: `FORMATS` in
  `downloader/cioos_downloader/download_erddap.py`, `FORMATS` in
  `web-api/routes/download.js`, `PACKAGE_FORMATS` in
  `frontend/src/state/download/DownloadProvider.jsx` (plus its
  `downloadPackageFormat_*` translations).

## The download script installs `downloader` from GitHub

The Data Explorer's download script (`GET /download/script`) installs this
package from the public repo at the deployed commit and calls
`cioos_downloader.script.run()`. Keep `cioos-data-explorer-downloader` installable on its own:
never depend on `harvester` or other server-only code (a git/archive install
ignores `tool.uv.sources`, so such a dependency would resolve to an unrelated
PyPI package of the same name).
