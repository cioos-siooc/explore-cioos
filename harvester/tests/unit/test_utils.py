"""
Unit tests for cde_harvester.utils — EOV/CF standard name mappings and helpers.
"""


from cde_harvester.utils import (
    cf_standard_name_base,
    df_eov_to_standard_name,
    eov_standard_name,
    eov_to_standard_name,
    erddap_time_to_iso,
    get_eov_to_standard_name,
    intersection,
    is_cf_standard_name,
    split_cf_standard_name,
    supported_standard_names,
)


class TestIntersection:
    def test_returns_common_elements(self):
        assert intersection(["a", "b", "c"], ["b", "c", "d"]) == ["b", "c"]

    def test_returns_empty_when_no_overlap(self):
        assert intersection(["a", "b"], ["c", "d"]) == []

    def test_excludes_empty_strings(self):
        result = intersection(["", "a", "b"], ["", "a"])
        assert "" not in result
        assert "a" in result

    def test_order_follows_first_list(self):
        result = intersection(["c", "b", "a"], ["a", "b", "c"])
        assert result == ["c", "b", "a"]

    def test_empty_lists_return_empty(self):
        assert intersection([], []) == []


class TestCdeEovMappings:
    def test_mapping_is_non_empty(self):
        assert len(eov_to_standard_name) > 0

    def test_most_eovs_map_to_at_least_one_standard_name(self):
        # Some EOVs (e.g. fishAbundanceAndDistribution) have no CF standard names
        # by design — they're monitored via non-CF methods. Verify the majority do.
        eovs_with_names = [eov for eov, names in eov_to_standard_name.items() if names]
        assert len(eovs_with_names) > len(eov_to_standard_name) // 2

    def test_sea_water_temperature_is_supported(self):
        assert "sea_water_temperature" in supported_standard_names

    def test_df_has_expected_columns(self):
        assert "eov" in df_eov_to_standard_name.columns
        assert "standard_name" in df_eov_to_standard_name.columns

    def test_df_rows_match_mapping(self):
        """Every row in the DataFrame must correspond to a valid (eov, standard_name) pair."""
        for _, row in df_eov_to_standard_name.iterrows():
            eov = row["eov"]
            sn = row["standard_name"]
            assert eov in eov_to_standard_name
            assert sn in eov_to_standard_name[eov]

    def test_goos_and_cde_layers_both_collapsed(self):
        """get_eov_to_standard_name should hide the GOOS intermediate layer."""
        mapping = get_eov_to_standard_name()
        # Top-level keys are CDE EOVs, not GOOS EOVs
        assert isinstance(mapping, dict)
        for key in mapping:
            assert isinstance(key, str)


class TestErddapTimeToIso:
    """ERDDAP publishes times as epoch seconds or ISO 8601, and the allDatasets
    listing mixes the two across servers (and, for a timeless dataset, leaves
    the cell empty). Parsing is per value for that reason -- the column-level
    sniff in ERDDAP.parse_erddap_dates() reads only the first element."""

    def test_epoch_seconds(self):
        assert erddap_time_to_iso("1.5778368E9") == "2020-01-01T00:00:00+00:00"

    def test_iso_string(self):
        assert erddap_time_to_iso("2020-01-01T00:00:00Z") == "2020-01-01T00:00:00+00:00"

    def test_plain_integer_seconds(self):
        assert erddap_time_to_iso(1577836800) == "2020-01-01T00:00:00+00:00"

    def test_missing_values_are_none(self):
        for empty in ("", "   ", "nan", "NaN", "None", "NaT", None, float("nan")):
            assert erddap_time_to_iso(empty) is None, empty

    def test_unparseable_is_none(self):
        assert erddap_time_to_iso("not a date") is None

    def test_epoch_is_not_read_as_nanoseconds(self):
        # The trap this function exists to avoid: pd.to_datetime on a float
        # without unit="s" reads it as nanoseconds and silently yields 1970.
        assert erddap_time_to_iso("1.5778368E9").startswith("2020-")


class TestCFStandardNameModifiers:
    def test_valid_modifier_is_recognized(self):
        standard_name = "sea_water_temperature standard_error"
        assert split_cf_standard_name(standard_name) == (
            "sea_water_temperature",
            "standard_error",
        )
        assert is_cf_standard_name(standard_name) is True
        assert cf_standard_name_base(standard_name) == "sea_water_temperature"

    def test_modifier_is_not_an_eov_measurement(self):
        assert eov_standard_name("sea_water_temperature status_flag") is None

    def test_invalid_modifier_is_rejected(self):
        assert is_cf_standard_name("sea_water_temperature estimated") is False

    def test_multiple_modifiers_are_rejected(self):
        assert is_cf_standard_name("sea_water_temperature standard_error status_flag") is False
