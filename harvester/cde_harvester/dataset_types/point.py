"""Handler for cdm_data_type=Point — independent discrete samples.

Point datasets reach this handler only after point_quality.check_point_dataset
has confirmed the data really is a scatter of independent samples; the
mislabelled moorings, casts and gliders are skipped before extraction.

Representation is chosen per dataset, because "a set of independent samples"
covers both a few hundred water-quality grabs and millions of underway
readings:

* small enough -> one exact row per sample in cde.profiles, so each sample
  keeps its true position and can be clicked individually.
* larger -> the same 1/12-degree coverage cells the trajectory and OBIS
  pipelines already use, which bounds both the response and the table.

The cutoff is applied to the whole-dataset record count QC already measured,
so choosing costs no extra query.
"""

from hashlib import blake2b

import pandas as pd

from cde_harvester.dataset_types import point_quality, trajectory_features
from cde_harvester.dataset_types.base import DatasetTypeHandler
from cde_harvester.sources.erddap.client import ERDDAP

# Above this many records a Point dataset is stored as coverage cells instead
# of exact samples. Sized so the exact path stays a small share of
# cde.profiles: at the cutoff one dataset contributes 10k rows, and the
# datasets that would blow past it are underway/high-frequency series whose
# individual positions are not separately meaningful anyway.
POINT_EXACT_MAX_SAMPLES = 10_000

# Length of the synthetic profile_id hash. cde.profiles is
# UNIQUE(erddap_url, dataset_id, timeseries_id, profile_id) and a Point
# dataset has no cf_role variable to fill either id with, so without a
# synthetic one every sample in a dataset would collide into a single row.
# 16 hex chars = 64 bits: at the 10k-row cutoff, collision odds are ~3e-12.
PROFILE_ID_DIGEST_BYTES = 8


def _sample_key(row, has_depth):
    """Deterministic per-sample identity.

    Deterministic matters: the incremental loader upserts on this key, so an
    id derived from row order would rewrite every row of the dataset whenever
    ERDDAP returned the samples in a different order.
    """
    parts = [str(row["time"]), f"{row['latitude']:.6f}", f"{row['longitude']:.6f}"]
    if has_depth:
        parts.append(f"{row['depth']:.4f}" if pd.notna(row["depth"]) else "")
    return blake2b(
        "|".join(parts).encode("utf-8"), digest_size=PROFILE_ID_DIGEST_BYTES
    ).hexdigest()


def extract_exact_samples(dataset):
    """One ProfileSchema row per distinct sample.

    A single distinct() query. Each sample is its own feature: a zero-size
    bounding box (so show_as_point is true and it draws as a dot), one record,
    and the sample's own instant and depth as its extent.
    """
    has_depth = "depth" in dataset.variables_list
    request_vars = ["time", "latitude", "longitude"] + (["depth"] if has_depth else [])
    samples = dataset.dataset_tabledap_query(f"{','.join(request_vars)}&distinct()")
    if samples.empty:
        return samples

    samples["time"] = ERDDAP.parse_erddap_dates(samples["time"])
    for column in ["latitude", "longitude"] + (["depth"] if has_depth else []):
        samples[column] = pd.to_numeric(samples[column], errors="coerce")
    samples = samples.dropna(subset=["time", "latitude", "longitude"])
    if samples.empty:
        return samples

    # Drop positions the DB's bbox geometry could not hold, matching the
    # guard tabledap_features applies to its own output.
    samples = samples.query(
        "latitude >= -90 and latitude <= 90 "
        "and longitude >= -180 and longitude <= 180"
    ).copy()
    if samples.empty:
        return samples

    depth = samples["depth"].fillna(0) if has_depth else 0.0

    profiles = pd.DataFrame(
        {
            "erddap_url": dataset.erddap_url,
            "dataset_id": dataset.id,
            "timeseries_id": "",
            "profile_id": samples.apply(_sample_key, axis="columns", has_depth=has_depth),
            "latitude": samples["latitude"],
            "longitude": samples["longitude"],
            # A single sample has no extent: the box collapses onto the point,
            # which is what makes show_as_point true.
            "latitude_min": samples["latitude"],
            "latitude_max": samples["latitude"],
            "longitude_min": samples["longitude"],
            "longitude_max": samples["longitude"],
            "show_as_point": True,
            "depth_min": depth,
            "depth_max": depth,
            "time_min": samples["time"],
            "time_max": samples["time"],
            "n_records": 1.0,
            "n_profiles": 1.0,
            # One record on one day. The download estimator divides by this,
            # so it has to be a real rate rather than 0.
            "records_per_day": 1.0,
        }
    ).reset_index(drop=True)

    # get_df() reads len(dataset.profile_ids) for the dataset-level n_profiles;
    # nothing has set it on this path (get_profile_ids is never called, since a
    # Point dataset has no cf_role variables to enumerate).
    dataset.profile_ids = profiles
    return profiles


class PointHandler(DatasetTypeHandler):
    """cdm_data_type=Point. Validated before extraction, then stored either as
    exact samples or as coverage cells depending on size."""

    cdm_data_type = "Point"
    data_structure = "table"
    # Default for the exact path; the cells path overrides it per dataset via
    # dataset.feature_kind (see extract_features).
    feature_kind = "profiles"

    def validate(self, dataset):
        return point_quality.check_point_dataset(dataset)

    def extract_features(self, dataset):
        total_records = getattr(dataset, "point_total_records", None)

        if total_records is not None and total_records > POINT_EXACT_MAX_SAMPLES:
            dataset.logger.info(
                "Point dataset has %s records (> %s): storing coverage cells "
                "instead of exact samples",
                f"{total_records:,}", f"{POINT_EXACT_MAX_SAMPLES:,}",
            )
            dataset.feature_kind = "trajectory_cells"
            # No cf_role=trajectory_id, so extract_cells treats the dataset as
            # one unnamed trajectory (trajectory_id=''), which is exactly the
            # shape a Point dataset needs.
            return trajectory_features.extract_cells(dataset, count_profiles=False)

        dataset.feature_kind = "profiles"
        return extract_exact_samples(dataset)

    # extract_track_points stays the inherited None: points are unordered, so
    # there is no track to draw between them.
