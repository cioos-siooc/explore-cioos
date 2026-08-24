"""Harvest-config parsing and resolution helpers."""

import json
import logging
import os
from pathlib import Path
from typing import NamedTuple

import yaml

logger = logging.getLogger(__name__)


def load_config(config_file):
    # get config settings from file, eg harvest_config.yaml
    with open(config_file, "r") as stream:
        try:
            config = yaml.safe_load(stream)
            return config

        except yaml.YAMLError:
            logger.error("Failed to load config yaml", exc_info=True)


def load_obis_dataset_ids(dataset_ids=None, datasets_file=None):
    """Resolve OBIS dataset IDs, loading from JSON file if needed."""
    if dataset_ids:
        return dataset_ids
    if datasets_file:
        with open(datasets_file, "r") as f:
            return json.load(f).get("datasets", [])
    return []


class ObisSelection(NamedTuple):
    """How OBIS datasets are selected for one harvest.

    Exactly one of `dataset_ids` / `discovery` drives the harvest, per `mode`:

    * ``"ids"``       — explicit UUIDs (test mode); discovery is bypassed.
    * ``"discovery"`` — resolved at harvest time from `discovery`.
    * ``"file"``      — legacy static list, already loaded into `dataset_ids`.
    * ``"off"``       — OBIS is not harvested.
    """

    dataset_ids: list
    discovery: dict          # raw obis_discovery block, or None
    geo_filter: dict         # raw obis_geo_filter block (always a dict)
    mode: str


def resolve_obis_config(config, dataset_ids=None, datasets_file=None, discover=None):
    """Resolve the OBIS selection from a config dict (and optional CLI overrides).

    Precedence, highest first:

      1. explicit dataset ids            -> mode "ids" (discovery bypassed)
      2. obis_discovery.enabled          -> mode "discovery"
      3. obis_datasets_file              -> mode "file"
      4. nothing                         -> mode "off"

    This lives in one place because the three config readers (the CLI, the
    Prefect pipeline's init_config, and the fan-out flow) previously each parsed
    the OBIS keys themselves and drifted — which is how `obis_geo_filter` ended
    up being silently ignored on the Prefect path.
    """
    config = config or {}
    geo_filter_cfg = config.get("obis_geo_filter") or {}

    discovery_cfg = config.get("obis_discovery")
    if discover is not None:
        # CLI --obis-discover overlays the config block (or creates one).
        discovery_cfg = {**(discovery_cfg or {}), **discover}
    discovery_enabled = bool((discovery_cfg or {}).get("enabled", bool(discovery_cfg)))

    explicit_ids = list(dataset_ids or config.get("obis_dataset_ids") or [])
    file_path = datasets_file or config.get("obis_datasets_file")

    if explicit_ids:
        if discovery_enabled:
            logger.warning(
                "obis_dataset_ids is set (%d ids) — OBIS discovery is bypassed (test mode)",
                len(explicit_ids),
            )
        return ObisSelection(explicit_ids, None, geo_filter_cfg, "ids")

    if discovery_enabled:
        if file_path:
            # Unioning the legacy list back in would resurrect the datasets
            # discovery deliberately drops (they produce no occurrences here).
            logger.warning(
                "obis_datasets_file (%s) is ignored because obis_discovery is enabled",
                file_path,
            )
        return ObisSelection([], discovery_cfg, geo_filter_cfg, "discovery")

    if file_path:
        return ObisSelection(
            load_obis_dataset_ids(datasets_file=file_path), None, geo_filter_cfg, "file"
        )

    return ObisSelection([], None, geo_filter_cfg, "off")


def normalize_coolify_multiline(value: str) -> str:
    """Strip the uniform leading indent Coolify prepends to multi-line env var continuations."""
    lines = value.split("\n")
    if len(lines) <= 1:
        return value
    continuation = [ln for ln in lines[1:] if ln.strip()]
    if not continuation:
        return value
    min_indent = min(len(ln) - len(ln.lstrip(" ")) for ln in continuation)
    first_indent = len(lines[0]) - len(lines[0].lstrip(" "))
    # Only strip when the first line is less-indented than the block (Coolify's signature).
    if first_indent >= min_indent or min_indent == 0:
        return value
    return "\n".join(
        [lines[0]] + [ln[min_indent:] if ln.strip() else ln for ln in lines[1:]]
    )


def resolve_harvest_config_file(config_file):
    """Resolve the effective harvest config, in priority order:

    1. HARVEST_CONFIG_YAML — full YAML content in an env var (Coolify-friendly:
       editable in the UI, applied on container recreate).
    2. HARVEST_CONFIG_FILE — path to a config file mounted into the container.
    3. `config_file` argument — the mounted/default path.

    The image no longer bakes a config, so the resolved file MUST exist —
    fail here with an actionable error rather than deep inside the harvest.
    Also writes OBIS_DATASETS_JSON to /tmp/Obis_Datasets.json when set.
    """
    env_config = os.getenv("HARVEST_CONFIG_YAML", "").strip()
    env_config_file = os.getenv("HARVEST_CONFIG_FILE", "").strip()
    if env_config:
        # Coolify indents multi-line env var continuations; strip it so the YAML parses.
        env_config = normalize_coolify_multiline(env_config)
        env_config_path = Path("/tmp/harvest_config_from_env.yaml")
        env_config_path.write_text(env_config)
        config_file = str(env_config_path)
        logger.info(f"Using HARVEST_CONFIG_YAML env var ({len(env_config)} bytes -> {env_config_path})")
    elif env_config_file:
        config_file = env_config_file
        logger.info(f"Using HARVEST_CONFIG_FILE env var: {config_file}")
    else:
        logger.info(f"Using harvest config file: {config_file}")

    if not config_file or not Path(config_file).is_file():
        raise FileNotFoundError(
            f"Harvest config not found: {config_file!r}. The image does not bake a "
            "config; provide one via (1) HARVEST_CONFIG_YAML env var with the full "
            "YAML content, (2) a file mounted at /app/harvester/harvest_config.yaml "
            "(docker-compose volume, or a Coolify Persistent Storage file mount), or "
            "(3) HARVEST_CONFIG_FILE env var pointing at a mounted file."
        )

    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        Path("/tmp/Obis_Datasets.json").write_text(env_obis)
        logger.info(f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)")
    return config_file
