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


CONFIG_ENV_HINT = (
    "prefer HARVEST_CONFIG_B64 — regenerate with: "
    "base64 < harvest_config.yaml | tr -d '\\n'"
)


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


def decode_harvest_config_b64(value: str) -> str:
    """Decode HARVEST_CONFIG_B64 into YAML text, or raise ValueError."""
    try:
        # Base64 ignores whitespace, so dropping it survives a UI that soft-wraps
        # or pads the value. b64decode/decode raise ValueError subclasses.
        return base64.b64decode("".join(value.split()), validate=True).decode("utf-8")
    except ValueError as e:
        raise ValueError(
            f"HARVEST_CONFIG_B64 is not valid base64-encoded UTF-8 ({e}); {CONFIG_ENV_HINT}"
        ) from e


def validate_harvest_config(yaml_text: str, source: str) -> str:
    """Reject a config that is not a YAML mapping, before it reaches a flow run.

    A bad env value must NOT fall through to a mounted file: silently harvesting
    a stale config is worse than refusing to start, so both env channels funnel
    through here and every failure is fatal.
    """
    try:
        parsed = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        raise ValueError(f"{source} is not valid YAML ({e}); {CONFIG_ENV_HINT}") from e
    if not isinstance(parsed, dict):
        raise ValueError(
            f"{source} holds {type(parsed).__name__}, expected a YAML mapping — it "
            f"looks truncated or mangled in transit; {CONFIG_ENV_HINT}"
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
    2. HARVEST_CONFIG_YAML — the raw YAML text. Deprecated and kept only for
       deployments already using it: multi-line values do not survive the same
       chain intact, which is why (1) exists.
    3. HARVEST_CONFIG_FILE — path to a config file mounted into the container
       (a compose mount, or a Coolify Persistent Storage *file* mount).
    4. `config_file` argument — the mounted/default path.

    The image no longer bakes a config, so the resolved file MUST exist —
    fail here with an actionable error rather than deep inside the harvest.
    Also writes OBIS_DATASETS_JSON to /tmp/Obis_Datasets.json when set.
    """
    env_config_b64 = os.getenv("HARVEST_CONFIG_B64", "").strip()
    env_config_yaml = os.getenv("HARVEST_CONFIG_YAML", "").strip()
    env_config_file = os.getenv("HARVEST_CONFIG_FILE", "").strip()
    if env_config_b64:
        source, env_config = "HARVEST_CONFIG_B64", decode_harvest_config_b64(env_config_b64)
    elif env_config_yaml:
        logger.warning(f"HARVEST_CONFIG_YAML is deprecated and corrupts easily in transit; {CONFIG_ENV_HINT}")
        # Coolify indents multi-line env var continuations; strip it so the YAML parses.
        source, env_config = "HARVEST_CONFIG_YAML", normalize_coolify_multiline(env_config_yaml)
    else:
        source = env_config = None

    if env_config is not None:
        env_config_path = Path("/tmp/harvest_config_from_env.yaml")
        env_config_path.write_text(validate_harvest_config(env_config, source))
        config_file = str(env_config_path)
        logger.info(f"Using {source} env var ({len(env_config)} bytes -> {env_config_path})")
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
            "Persistent Storage file mount), (3) HARVEST_CONFIG_FILE env var "
            "pointing at a mounted file, or (4) HARVEST_CONFIG_YAML env var holding "
            "the raw YAML text (deprecated — prone to corruption in transit)."
        )

    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        Path("/tmp/Obis_Datasets.json").write_text(env_obis)
        logger.info(f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)")
    return config_file
