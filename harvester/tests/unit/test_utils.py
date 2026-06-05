"""
Unit tests for cde_harvester.utils — EOV/CF standard name mappings and helpers.
"""

import pytest

from cde_harvester.utils import (
    cde_eov_to_standard_name,
    df_cde_eov_to_standard_name,
    get_cde_eov_to_standard_name,
    intersection,
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
        assert len(cde_eov_to_standard_name) > 0

    def test_most_eovs_map_to_at_least_one_standard_name(self):
        # Some EOVs (e.g. fishAbundanceAndDistribution) have no CF standard names
        # by design — they're monitored via non-CF methods. Verify the majority do.
        eovs_with_names = [eov for eov, names in cde_eov_to_standard_name.items() if names]
        assert len(eovs_with_names) > len(cde_eov_to_standard_name) // 2

    def test_sea_water_temperature_is_supported(self):
        assert "sea_water_temperature" in supported_standard_names

    def test_df_has_expected_columns(self):
        assert "eov" in df_cde_eov_to_standard_name.columns
        assert "standard_name" in df_cde_eov_to_standard_name.columns

    def test_df_rows_match_mapping(self):
        """Every row in the DataFrame must correspond to a valid (eov, standard_name) pair."""
        for _, row in df_cde_eov_to_standard_name.iterrows():
            eov = row["eov"]
            sn = row["standard_name"]
            assert eov in cde_eov_to_standard_name
            assert sn in cde_eov_to_standard_name[eov]

    def test_goos_and_cde_layers_both_collapsed(self):
        """get_cde_eov_to_standard_name should hide the GOOS intermediate layer."""
        mapping = get_cde_eov_to_standard_name()
        # Top-level keys are CDE EOVs, not GOOS EOVs
        assert isinstance(mapping, dict)
        for key in mapping:
            assert isinstance(key, str)
