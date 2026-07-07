"""Harvest-config parsing and resolution helpers."""

import json
import logging
import os
from pathlib import Path

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
    """Resolve effective config: HARVEST_CONFIG_YAML env > mounted/baked-in default.

    Also writes OBIS_DATASETS_JSON to /tmp/Obis_Datasets.json when set.
    """
    env_config = os.getenv("HARVEST_CONFIG_YAML", "").strip()
    if env_config:
        # Coolify indents multi-line env var continuations; strip it so the YAML parses.
        env_config = normalize_coolify_multiline(env_config)
        env_config_path = Path("/tmp/harvest_config_from_env.yaml")
        env_config_path.write_text(env_config)
        config_file = str(env_config_path)
        logger.info(f"Using HARVEST_CONFIG_YAML env var ({len(env_config)} bytes -> {env_config_path})")
    else:
        logger.info(f"Using harvest config file: {config_file}")

    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        Path("/tmp/Obis_Datasets.json").write_text(env_obis)
        logger.info(f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)")
    return config_file
