import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import xarray as xr
from cioos_downloader.formats import write_subset
from shapely.geometry import box

# Rows at lon -130 are inside, rows at lon -100 outside.
REGION = [box(-135, 45, -125, 55)]


def _csv(path, rows):
    path.write_text(
        "time,latitude,longitude,temperature\n"
        "UTC,degrees_north,degrees_east,degree_C\n"
        + "".join(f"2020-01-0{i + 1}T00:00:00Z,50.0,{lon},1.50\n" for i, lon in enumerate(rows))
    )
    return path


def test_csv_keeps_units_row_and_exact_values(tmp_path):
    [written] = write_subset("csv", [_csv(tmp_path / "a", [-130, -100, -130])], REGION, tmp_path / "out")

    lines = written["path"].read_text().splitlines()
    assert lines[1] == "UTC,degrees_north,degrees_east,degree_C"
    # "1.50" is not reformatted to "1.5": values pass through as text.
    assert lines[2:] == ["2020-01-01T00:00:00Z,50.0,-130,1.50", "2020-01-03T00:00:00Z,50.0,-130,1.50"]
    assert written["n_rows"] == 2
    assert written["columns"][3] == {"name": "temperature", "unit": "degree_C"}


def test_csv_parts_are_concatenated_and_nothing_written_when_all_outside(tmp_path):
    parts = [_csv(tmp_path / "a", [-130]), _csv(tmp_path / "b", [-130])]
    assert write_subset("csv", parts, REGION, tmp_path / "out")[0]["n_rows"] == 2
    assert write_subset("csv", [_csv(tmp_path / "c", [-100])], REGION, tmp_path / "none") == []


def test_csv_without_polygon_keeps_every_row(tmp_path):
    [written] = write_subset("csv", [_csv(tmp_path / "a", [-130, -100])], [], tmp_path / "out")
    assert written["n_rows"] == 2


def test_odv_keeps_its_header_and_filters_on_the_bracketed_columns(tmp_path):
    part = tmp_path / "a"
    part.write_text(
        "//<Creator>x</Creator>\n//<DataType>Profiles</DataType>\n"
        "Cruise\tStation\tType\tyyyy-mm-ddThh:mm:ss.sss\tLongitude [degrees_east]\tLatitude [degrees_north]\n"
        "\t\t*\t2020-01-01T00:00:00.000Z\t-130.0\t50.0\n"
        "\t\t*\t2020-01-01T00:00:00.000Z\t-100.0\t50.0\n"
    )
    [written] = write_subset("odv", [part], REGION, tmp_path / "out")

    lines = written["path"].read_text().splitlines()
    assert lines[:2] == ["//<Creator>x</Creator>", "//<DataType>Profiles</DataType>"]
    assert lines[3].split("\t")[4] == "-130.0"
    assert len(lines) == 4
    assert written["columns"][4] == {"name": "Longitude [degrees_east]", "unit": "degrees_east"}


def test_parquet_keeps_erddap_attributes(tmp_path):
    table = pa.table({"latitude": [50.0, 50.0], "longitude": [-130.0, -100.0]}).replace_schema_metadata(
        {"latitude_units": "degrees_north", "title": "x"}
    )
    pq.write_table(table, tmp_path / "a")

    [written] = write_subset("parquet", [tmp_path / "a"], REGION, tmp_path / "out")

    result = pq.read_table(written["path"])
    assert result.num_rows == 1
    assert result.schema.metadata[b"title"] == b"x"
    assert written["columns"][0] == {"name": "latitude", "unit": "degrees_north"}


def _ragged(sizes, feature_lons=None, obs_lons=None, parent_lons=None, parent_index=None):
    """An ERDDAP-style contiguous ragged array; lat/lon on whichever level is given."""
    n_obs = sum(sizes)
    ds = xr.Dataset(
        {
            "rowSize": ("profile", np.array(sizes, dtype="int32"), {"sample_dimension": "obs"}),
            "temperature": ("obs", np.arange(n_obs, dtype="float32"), {"units": "degree_C"}),
        },
        attrs={"geospatial_lon_min": -180.0, "geospatial_lon_max": 180.0, "geospatial_lat_min": -90.0,
               "geospatial_lat_max": 90.0},
    )
    if obs_lons is not None:
        ds["longitude"] = ("obs", np.array(obs_lons, dtype="float64"))
        ds["latitude"] = ("obs", np.full(n_obs, 50.0))
    elif parent_lons is not None:
        ds["longitude"] = ("station", np.array(parent_lons, dtype="float64"))
        ds["latitude"] = ("station", np.full(len(parent_lons), 50.0))
        ds["stationIndex"] = ("profile", np.array(parent_index, dtype="int32"), {"instance_dimension": "station"})
    else:
        ds["longitude"] = ("profile", np.array(feature_lons, dtype="float64"))
        ds["latitude"] = ("profile", np.full(len(sizes), 50.0))
    return ds


def _round_trip(tmp_path, ds):
    ds.to_netcdf(tmp_path / "a.nc")
    [written] = write_subset("nccf", [tmp_path / "a.nc"], REGION, tmp_path / "out")
    return written, xr.open_dataset(written["path"], decode_cf=False)


def test_nccf_profiles_outside_are_dropped_with_their_observations(tmp_path):
    written, ds = _round_trip(tmp_path, _ragged([2, 3, 1], feature_lons=[-130, -100, -128]))

    assert ds["rowSize"].values.tolist() == [2, 1]
    assert ds["temperature"].values.tolist() == [0, 1, 5]
    assert written["n_rows"] == 3
    assert ds.attrs["geospatial_lon_min"] == -130 and ds.attrs["geospatial_lon_max"] == -128


def test_nccf_trajectory_observations_are_masked_and_row_sizes_rebuilt(tmp_path):
    written, ds = _round_trip(tmp_path, _ragged([3, 2], obs_lons=[-130, -100, -130, -100, -100]))

    # The second trajectory had no observation inside: it is gone entirely.
    assert ds["rowSize"].values.tolist() == [2]
    assert ds["temperature"].values.tolist() == [0, 2]
    assert ds.sizes["profile"] == 1


def test_nccf_timeseries_profile_parents_are_reindexed(tmp_path):
    ds = _ragged([1, 2, 1], parent_lons=[-100, -130], parent_index=[0, 1, 1])
    written, ds = _round_trip(tmp_path, ds)

    assert ds.sizes["station"] == 1
    assert ds["stationIndex"].values.tolist() == [0, 0]
    assert ds["rowSize"].values.tolist() == [2, 1]
    assert ds["temperature"].values.tolist() == [1, 2, 3]
    assert written["columns"][1] == {"name": "temperature", "unit": "degree_C"}


def test_nccf_points_are_masked(tmp_path):
    ds = xr.Dataset({"longitude": ("obs", [-130.0, -100.0]), "latitude": ("obs", [50.0, 50.0])})
    written, result = _round_trip(tmp_path, ds)
    assert result["longitude"].values.tolist() == [-130.0]
    assert written["n_rows"] == 1


@pytest.mark.parametrize("fmt", ["csv", "nccf"])
def test_multiple_parts_without_polygon(tmp_path, fmt):
    if fmt == "csv":
        parts = [_csv(tmp_path / "a", [-130]), _csv(tmp_path / "b", [-100])]
    else:
        parts = []
        for name, lon in (("a.nc", -130.0), ("b.nc", -100.0)):
            xr.Dataset({"longitude": ("obs", [lon]), "latitude": ("obs", [50.0])}).to_netcdf(tmp_path / name)
            parts.append(tmp_path / name)

    written = write_subset(fmt, parts, [], tmp_path / "out")

    # CSV parts merge into one table; a CF file per request stays its own file.
    assert [w["path"].name for w in written] == (["out.csv"] if fmt == "csv" else ["out_part1.nc", "out_part2.nc"])
