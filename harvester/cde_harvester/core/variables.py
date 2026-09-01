"""Per-variable metadata, shaped for the database's jsonb columns.

The harvester already pulls every attribute the dataset preview needs out of
``/info/{id}/index.csv`` (see ``CONSIDERED_VARIABLE_ATTRIBUTES`` in
``sources/erddap/dataset.py``) and pivots it onto ``dataset.df_variables``.
Until this module existed only the griddap handler persisted any of it, as
``datasets.grid_variables``; for tabledap the whole frame was built on every
harvest and discarded, which left the browser with nothing but ERDDAP's
``columnNames``/``columnTypes``/``columnUnits`` and so no way to title a plot
panel with anything better than a BODC code like ``TE90_01``.

The output is a plain list of dicts so it round-trips through the harvester's
CSV contract (Python repr on the way out, ``ast.literal_eval`` in the loader)
and lands in a ``jsonb`` column.
"""

# Persisted per variable. Deliberately NOT the whole of
# CONSIDERED_VARIABLE_ATTRIBUTES: flag_values/flag_meanings are long strings
# that no consumer reads yet, and colorBarContinuous/colorBarNSections describe
# a discretisation nothing implements.
#
# actual_range IS carried, but read the warning in the frontend before using it
# for an axis range: publishers leave fill sentinels inside it. On
# mpoPmzaVikingCtdInsitu, TE90_01 (degree_C) declares
# actual_range = -1.4899, 191277.0.
PERSISTED_VARIABLE_ATTRIBUTES = [
    "long_name",
    "standard_name",
    "units",
    "cf_role",
    "axis",
    "positive",
    "actual_range",
    "ioos_category",
    "colorBarPalette",
    "colorBarMinimum",
    "colorBarMaximum",
    "colorBarScale",
    "ancillary_variables",
]


def _clean(value):
    """ERDDAP's absent attributes arrive as "" (get_metadata fillna's the pivot).
    Store None instead so a jsonb consumer can tell "not declared" from "declared
    empty", and so the column stays small."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def extract_variables(df_variables, names=None):
    """``[{name, type, long_name, ...}]`` for each variable, in frame order.

    ``names`` restricts and orders the output — the griddap handler passes the
    ``Row Type == "variable"`` names so dimensions stay out of
    ``grid_variables``. Tabledap callers pass nothing and get every column,
    coordinates and cf_role variables included: the preview needs those to pick
    a shared axis and to keep them out of the panel set.
    """
    if df_variables is None or len(df_variables) == 0:
        return []

    if names is None:
        names = df_variables["name"].tolist()

    variables = []
    for name in names:
        if name in df_variables.index:
            row = df_variables.loc[name]
        else:
            row = {}
        variable = {"name": name, "type": _clean(row.get("type"))}
        for attribute in PERSISTED_VARIABLE_ATTRIBUTES:
            variable[attribute] = _clean(row.get(attribute))
        variables.append(variable)
    return variables
