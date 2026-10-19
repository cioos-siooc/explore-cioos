// From the Croissant file-list hash on cde.datasets:
//  - 'incremental': content_hash exists; ERDDAP re-query skipped when unchanged.
//  - 'full': HASH_NO_FILE_LIST, re-queried on every harvest.
//  - 'unknown': hashing failed or never attempted.
export function harvestMode(dataset = {}) {
  if (dataset.content_hash) return "incremental";
  if (dataset.content_hash_reason === "HASH_NO_FILE_LIST") return "full";
  return "unknown";
}
