// The CIOOS metadata catalogue. One instance describes every source CDE
// harvests, and the harvester reads the same CKAN_URL variable (see
// harvester/cde_harvester/core/config.py) — so repointing CDE at a different
// catalogue is one setting rather than a hunt through hardcoded literals.
//
// Only the public record URL is needed here; the API lives behind /api/3 and
// is the harvester's concern.
const CKAN_URL = (process.env.CKAN_URL || "https://catalogue.cioos.ca")
  .trim()
  .replace(/\/+$/, "");

// Built into SQL as a literal prefix concatenated onto ckan_id. A NULL ckan_id
// makes the whole concatenation NULL, which is what hides the link for a
// dataset CKAN has no record of — CDE serves those, notably OBIS datasets the
// catalogue does not describe.
const CKAN_DATASET_URL_PREFIX = `${CKAN_URL}/dataset/`;

module.exports = { CKAN_URL, CKAN_DATASET_URL_PREFIX };
