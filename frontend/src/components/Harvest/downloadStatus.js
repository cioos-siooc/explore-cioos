// Maps the downloader's vocabulary onto the existing harvest badge styles.
const BADGE_CLASS = {
  COMPLETED: "success",
  PARTIAL: "skipped",
  FAILED: "error",
  EMPTY: "unchanged",
  IGNORED: "skipped",
};

// Job-level status from cde.download_jobs.status.
const JOB_BADGE_CLASS = {
  completed: "success",
  failed: "error",
  "no-data": "unchanged",
  "over-limit": "skipped",
  downloading: "running",
  open: "running",
};

export function datasetBadgeClass(status) {
  return BADGE_CLASS[status] || "skipped";
}

export function jobBadgeClass(status) {
  return JOB_BADGE_CLASS[status] || "skipped";
}

// Mirrors the completion email (download_scheduler.email_user).
export function datasetReason(t, dataset) {
  if (dataset.erddap_error) return dataset.erddap_error;
  switch (dataset.last_status || dataset.status) {
    case "FAILED":
      return t("harvest.downloads.reason.failed");
    case "EMPTY":
      return t("harvest.downloads.reason.empty");
    case "IGNORED":
      return t("harvest.downloads.reason.ignored");
    case "PARTIAL":
      return t("harvest.downloads.reason.partial");
    default:
      return null;
  }
}
