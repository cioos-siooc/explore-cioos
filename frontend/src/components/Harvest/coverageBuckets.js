// The gap categories the coverage report can list, in the order they are
// offered. Each entry names the API bucket (also the URL's ?bucket= value),
// the summary field holding its count, and the columns its rows render into —
// the buckets answer different questions, so they do not share a shape.
//
// `i18nKey` is the suffix under harvest.coverage.bucket.*; every bucket has a
// matching `.label` and `.help` string in both locales.
const BUCKETS = [
  {
    key: "erddap-not-in-app",
    countKey: "n_erddap_not_in_app",
    columns: ["erddap_url", "dataset_id", "reason", "attempted_at"],
  },
  {
    // The whole metadata-side gap in one list: every CKAN record with nothing
    // CDE serves behind it, whatever the reason. Replaces three narrower
    // buckets (ERDDAP-linked, OBIS-linked, and no-data-source) that split the
    // same question three ways; the reason is now a column you can search.
    key: "ckan-not-integrated",
    countKey: "n_ckan_not_integrated",
    columns: ["ckanTitle", "linkTarget", "classification", "ckanRecord"],
    exportable: true,
  },
  {
    key: "erddap-without-ckan",
    countKey: "n_erddap_without_ckan",
    columns: ["erddap_url", "dataset_id", "title"],
  },
  {
    key: "obis-without-ckan",
    countKey: "n_obis_without_ckan",
    columns: ["obis_dataset_id", "title"],
  },
];

export function bucketByKey(key) {
  return BUCKETS.find((b) => b.key === key);
}

export default BUCKETS;
