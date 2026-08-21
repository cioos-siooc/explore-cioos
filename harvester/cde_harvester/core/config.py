"""Harvest-config parsing and resolution helpers."""

import base64
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


B64_REGEN_HINT = "regenerate with: base64 < harvest_config.yaml | tr -d '\\n'"


def decode_harvest_config_b64(value: str) -> str:
    """Decode HARVEST_CONFIG_B64 into YAML text, or raise ValueError.

    A bad value must NOT fall through to a mounted file: silently harvesting a
    stale config is worse than refusing to start, so every failure is fatal and
    names the fix.
    """
    try:
        # Base64 ignores whitespace, so dropping it survives a UI that soft-wraps
        # or pads the value. b64decode/decode raise ValueError subclasses.
        yaml_text = base64.b64decode("".join(value.split()), validate=True).decode("utf-8")
        parsed = yaml.safe_load(yaml_text)
    except (ValueError, yaml.YAMLError) as e:
        raise ValueError(
            f"HARVEST_CONFIG_B64 is not valid base64-encoded YAML ({e}); {B64_REGEN_HINT}"
        ) from e
    # Catches a truncated or half-pasted value here rather than at flow time.
    if not isinstance(parsed, dict):
        raise ValueError(
            f"HARVEST_CONFIG_B64 decoded to {type(parsed).__name__}, expected a YAML "
            f"mapping — the value looks truncated; {B64_REGEN_HINT}"
        )
    return yaml_text


def resolve_harvest_config_file(config_file):
    """Resolve the effective harvest config, in priority order:

    1. HARVEST_CONFIG_B64 — the whole YAML file, base64-encoded onto a single
       line. This is the channel to use under Coolify: the value is
       [A-Za-z0-9+/=] with no newlines, so nothing in the env-var editor ->
       generated .env -> compose dotenv chain can reindent it, eat a `#`
       comment, or split it. Regenerate after editing the file with:
           base64 < harvest_config.yaml | tr -d '\n'
    2. HARVEST_CONFIG_FILE — path to a config file mounted into the container
       (a compose mount, or a Coolify Persistent Storage *file* mount).
    3. `config_file` argument — the mounted/default path.

    The image no longer bakes a config, so the resolved file MUST exist —
    fail here with an actionable error rather than deep inside the harvest.
    Also writes OBIS_DATASETS_JSON to /tmp/Obis_Datasets.json when set.
    """
    env_config_b64 = os.getenv("HARVEST_CONFIG_B64", "").strip()
    env_config_file = os.getenv("HARVEST_CONFIG_FILE", "").strip()
    if env_config_b64:
        env_config = decode_harvest_config_b64(env_config_b64)
        env_config_path = Path("/tmp/harvest_config_from_env.yaml")
        env_config_path.write_text(env_config)
        config_file = str(env_config_path)
        logger.info(f"Using HARVEST_CONFIG_B64 env var ({len(env_config)} bytes -> {env_config_path})")
    elif env_config_file:
        config_file = env_config_file
        logger.info(f"Using HARVEST_CONFIG_FILE env var: {config_file}")
    else:
        logger.info(f"Using harvest config file: {config_file}")

    if not config_file or not Path(config_file).is_file():
        raise FileNotFoundError(
            f"Harvest config not found: {config_file!r}. The image does not bake a "
            "config; provide one via (1) HARVEST_CONFIG_B64 env var holding the whole "
            "YAML file base64-encoded on one line "
            "(base64 < harvest_config.yaml | tr -d '\\n'), (2) a file mounted at "
            "/app/harvester/harvest_config.yaml (docker-compose volume, or a Coolify "
            "Persistent Storage file mount), or (3) HARVEST_CONFIG_FILE env var "
            "pointing at a mounted file."
        )

    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        Path("/tmp/Obis_Datasets.json").write_text(env_obis)
        logger.info(f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)")
    return config_file
