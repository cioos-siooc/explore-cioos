// Classify how the harvester treats a dataset, derived from the Croissant
// file-list hash stored on cde.datasets (content_hash / content_hash_reason).
//
//  - 'incremental': a content_hash exists → file-based dataset. The harvester
//    hashes the file list and SKIPS re-querying ERDDAP when nothing changed.
//  - 'full': database-backed (HASH_NO_FILE_LIST) → no file list to hash, so
//    ERDDAP is fully re-queried on every harvest.
//  - 'unknown': hashing was attempted but unavailable (Croissant error,
//    federated source unresolved, …) or the dataset has never been hashed yet.
export function harvestMode(dataset = {}) {
  if (dataset.content_hash) return 'incremental'
  if (dataset.content_hash_reason === 'HASH_NO_FILE_LIST') return 'full'
  return 'unknown'
}
