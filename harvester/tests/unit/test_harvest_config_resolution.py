"""
Unit tests for cde_harvester.core.config config resolution.

This is the gate every deploy passes through: the image bakes no harvest config,
so a bad resolution either stops the worker or — worse — silently harvests the
wrong servers. HARVEST_CONFIG_B64 exists because raw multi-line YAML does not
survive Coolify's env editor intact, so the round-trip tests below are the actual
regression guard, not just parser coverage.
"""

import base64
from pathlib import Path

import pytest
import yaml

from cde_harvester.core.config import (
    decode_harvest_config_b64,
    resolve_harvest_config_file,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
PRODUCTION_CONFIG = REPO_ROOT / "harvest_config.production.yaml"

SAMPLE_YAML = """# leading comment at column 0
erddap_urls:
    - https://one.example/erddap
    - https://two.example/erddap

# blank line above, inline comment below
cache: False
incremental: True
"""


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Never inherit a real deployment's config vars."""
    for var in ("HARVEST_CONFIG_B64", "HARVEST_CONFIG_FILE", "OBIS_DATASETS_JSON"):
        monkeypatch.delenv(var, raising=False)


class TestDecodeHarvestConfigB64:
    def test_round_trips_yaml_verbatim(self):
        assert decode_harvest_config_b64(b64(SAMPLE_YAML)) == SAMPLE_YAML

    def test_preserves_comments_and_blank_lines(self):
        """The exact thing the old multi-line env var destroyed."""
        decoded = decode_harvest_config_b64(b64(SAMPLE_YAML))
        assert decoded.startswith("# leading comment at column 0")
        assert "\n\n" in decoded
        assert decoded.count("    - https://") == 2

    def test_tolerates_whitespace_in_the_value(self):
        """Base64 ignores whitespace, so a soft-wrapped or padded paste still decodes."""
        encoded = b64(SAMPLE_YAML)
        wrapped = "  " + "\n".join(
            encoded[i : i + 40] for i in range(0, len(encoded), 40)
        ) + "\n"
        assert decode_harvest_config_b64(wrapped) == SAMPLE_YAML

    def test_rejects_invalid_base64(self):
        with pytest.raises(ValueError, match="not valid base64"):
            decode_harvest_config_b64("this is not base64!!")

    def test_rejects_raw_yaml_pasted_by_mistake(self):
        """The most likely operator error: pasting the YAML instead of encoding it."""
        with pytest.raises(ValueError, match="not valid base64"):
            decode_harvest_config_b64(SAMPLE_YAML)

    def test_rejects_valid_base64_that_is_not_a_mapping(self):
        with pytest.raises(ValueError, match="expected a YAML mapping"):
            decode_harvest_config_b64(b64("just a bare string"))

    def test_rejects_non_utf8_payload(self):
        with pytest.raises(ValueError, match="not valid base64"):
            decode_harvest_config_b64(base64.b64encode(b"\xff\xfe\xfd").decode("ascii"))

    def test_production_config_survives_the_round_trip(self):
        """Encode the file we actually deploy and confirm it parses back identically."""
        original = PRODUCTION_CONFIG.read_text()
        decoded = decode_harvest_config_b64(b64(original))
        assert decoded == original
        parsed = yaml.safe_load(decoded)
        assert parsed["erddap_urls"] == yaml.safe_load(original)["erddap_urls"]
        assert parsed["incremental"] is True


class TestResolveHarvestConfigFile:
    def test_b64_wins_over_a_mounted_file(self, monkeypatch, tmp_path):
        mounted = tmp_path / "harvest_config.yaml"
        mounted.write_text("erddap_urls:\n  - https://stale.example/erddap\n")
        monkeypatch.setenv("HARVEST_CONFIG_B64", b64(SAMPLE_YAML))
        monkeypatch.setenv("HARVEST_CONFIG_FILE", str(mounted))

        resolved = resolve_harvest_config_file(str(mounted))

        assert Path(resolved).read_text() == SAMPLE_YAML
        assert Path(resolved) != mounted

    def test_falls_back_to_config_file_env_var(self, monkeypatch, tmp_path):
        mounted = tmp_path / "harvest_config.yaml"
        mounted.write_text(SAMPLE_YAML)
        monkeypatch.setenv("HARVEST_CONFIG_FILE", str(mounted))

        assert resolve_harvest_config_file("ignored.yaml") == str(mounted)

    def test_falls_back_to_the_argument(self, tmp_path):
        mounted = tmp_path / "harvest_config.yaml"
        mounted.write_text(SAMPLE_YAML)

        assert resolve_harvest_config_file(str(mounted)) == str(mounted)

    def test_bad_b64_raises_instead_of_using_the_mounted_file(self, monkeypatch, tmp_path):
        """A corrupt paste must stop the deploy, not quietly harvest a stale config."""
        mounted = tmp_path / "harvest_config.yaml"
        mounted.write_text("erddap_urls:\n  - https://stale.example/erddap\n")
        monkeypatch.setenv("HARVEST_CONFIG_B64", "not-valid-base64!!")
        monkeypatch.setenv("HARVEST_CONFIG_FILE", str(mounted))

        with pytest.raises(ValueError, match="HARVEST_CONFIG_B64"):
            resolve_harvest_config_file(str(mounted))

    def test_missing_config_raises_with_instructions(self, tmp_path):
        missing = tmp_path / "nope.yaml"

        with pytest.raises(FileNotFoundError, match="HARVEST_CONFIG_B64"):
            resolve_harvest_config_file(str(missing))

    def test_writes_obis_datasets_json_when_set(self, monkeypatch, tmp_path):
        mounted = tmp_path / "harvest_config.yaml"
        mounted.write_text(SAMPLE_YAML)
        monkeypatch.setenv("OBIS_DATASETS_JSON", '{"datasets": ["abc"]}')

        resolve_harvest_config_file(str(mounted))

        assert '"abc"' in Path("/tmp/Obis_Datasets.json").read_text()
