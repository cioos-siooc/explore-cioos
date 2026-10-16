"""Per-variable metadata, shaped for the database's jsonb columns.

A plain list of dicts, so it round-trips through the CSV contract (repr out,
``ast.literal_eval`` in the loader).
"""

# Not all of CONSIDERED_VARIABLE_ATTRIBUTES: flag_* and colorBar* have no
# consumer. actual_range can contain fill sentinels (mpoPmzaVikingCtdInsitu
# TE90_01 declares -1.4899, 191277.0); don't trust it as an axis range.
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
    """Absent attributes arrive as "" (get_metadata fillna's the pivot)."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def extract_variables(df_variables, names=None):
    """``[{name, type, long_name, ...}]`` for each variable, in frame order.

    ``names`` restricts and orders the output (griddap excludes dimensions);
    tabledap keeps coordinates, which the preview needs for its shared axis.
    """
    if df_variables is None or len(df_variables) == 0:
        return []

    if names is None:
        names = df_variables["name"].tolist()

    variables = []
    for name in names:
        row = df_variables.loc[name] if name in df_variables.index else {}
        variable = {"name": name, "type": _clean(row.get("type"))}
        for attribute in PERSISTED_VARIABLE_ATTRIBUTES:
            variable[attribute] = _clean(row.get(attribute))
        variables.append(variable)
    return variables
