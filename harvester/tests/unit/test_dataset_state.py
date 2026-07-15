"""
Unit tests for cde_harvester.dataset_state.load_previous_hashes.

load_previous_hashes is fail-open: any database error returns {} so the
harvester simply re-harvests all datasets rather than crashing.
"""

from unittest.mock import MagicMock, patch

from cde_harvester.dataset_state import load_previous_hashes

from conftest import ERDDAP_URL, DATASET_ID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_engine(rows):
    """Return a mock engine whose conn.execute().all() yields `rows`."""
    engine = MagicMock()
    conn = MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    engine.connect.return_value.__exit__.return_value = False
    conn.execute.return_value.all.return_value = rows
    return engine


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestLoadPreviousHashes:
    def test_returns_dict_on_success(self):
        rows = [(DATASET_ID, "abc123")]
        engine = _make_engine(rows)
        with (
            patch("cde_harvester.dataset_state.create_engine", return_value=engine),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            result = load_previous_hashes(ERDDAP_URL)
        assert isinstance(result, dict)
        assert result[DATASET_ID] == "abc123"

    def test_maps_dataset_id_to_hash(self):
        rows = [
            ("ds_a", "hash_a"),
            ("ds_b", "hash_b"),
        ]
        engine = _make_engine(rows)
        with (
            patch("cde_harvester.dataset_state.create_engine", return_value=engine),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            result = load_previous_hashes(ERDDAP_URL)
        assert result == {"ds_a": "hash_a", "ds_b": "hash_b"}

    def test_empty_db_returns_empty_dict(self):
        engine = _make_engine([])
        with (
            patch("cde_harvester.dataset_state.create_engine", return_value=engine),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            result = load_previous_hashes(ERDDAP_URL)
        assert result == {}

    def test_db_error_returns_empty_dict(self):
        """Any database error must be swallowed and {} returned (fail-open)."""
        with (
            patch(
                "cde_harvester.dataset_state.create_engine",
                side_effect=Exception("connection refused"),
            ),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            result = load_previous_hashes(ERDDAP_URL)
        assert result == {}

    def test_query_error_returns_empty_dict(self):
        engine = MagicMock()
        conn = MagicMock()
        engine.connect.return_value.__enter__.return_value = conn
        engine.connect.return_value.__exit__.return_value = False
        conn.execute.side_effect = Exception("syntax error")
        with (
            patch("cde_harvester.dataset_state.create_engine", return_value=engine),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            result = load_previous_hashes(ERDDAP_URL)
        assert result == {}

    def test_url_trailing_slash_stripped_in_query(self):
        """The query uses erddap_url.rstrip('/') — verify the stripped form is passed."""
        rows = []
        engine = _make_engine(rows)
        captured = {}

        def _capture_execute(sql, params):
            captured["params"] = params
            result = MagicMock()
            result.all.return_value = []
            return result

        conn = MagicMock()
        conn.execute.side_effect = _capture_execute
        engine.connect.return_value.__enter__.return_value = conn
        engine.connect.return_value.__exit__.return_value = False

        with (
            patch("cde_harvester.dataset_state.create_engine", return_value=engine),
            patch("cde_harvester.dataset_state.load_dotenv"),
            patch.dict("os.environ", {
                "DB_USER": "u", "DB_PASSWORD": "p",
                "DB_HOST_EXTERNAL": "localhost", "DB_PORT": "5432", "DB_NAME": "db",
            }),
        ):
            load_previous_hashes(ERDDAP_URL + "/")  # trailing slash

        assert captured["params"]["url"] == ERDDAP_URL  # no trailing slash
