const isSet = (o) => o.isSelected || o.isExcluded;

const portalState = (leaves) =>
  leaves.length > 0 && leaves.every((l) => l.option.isSelected)
    ? "include"
    : leaves.length > 0 && leaves.every((l) => l.option.isExcluded)
      ? "exclude"
      : undefined;

// Sets every leaf to `next` ("include", "exclude" or undefined), one update per
// list since a portal's leaves span several.
export function setLeaves(leaves, next) {
  const bySetter = new Map();
  for (const leaf of leaves) {
    if (!bySetter.has(leaf.setList)) bySetter.set(leaf.setList, new Set());
    bySetter.get(leaf.setList).add(leaf.option.pk);
  }
  for (const [setList, pks] of bySetter) {
    setList((prev) =>
      prev.map((o) =>
        pks.has(o.pk)
          ? {
              ...o,
              isSelected: next === "include",
              isExcluded: next === "exclude",
            }
          : o,
      ),
    );
  }
}

// The Data Portal filter as a tree: each portal (a CKAN owner such as SLGO,
// OBIS, or an ERDDAP server no owner claims) over its ERDDAP / OBIS leaves.
// A leaf `id` is its option's id in useFilterModel. Sorted by label.
export function buildPortals(
  {
    erddapServersSelected = [],
    setErddapServersSelected,
    obisNodesSelected = [],
    setObisNodesSelected,
    portalOwners = [],
    obisCataloguesSelected = [],
    setObisCataloguesSelected,
  },
  locale,
) {
  const serverLeaf = (server, label) => ({
    id: `erddap-${server.pk}`,
    kind: "erddap",
    label,
    option: server,
    setList: setErddapServersSelected,
  });
  const claimed = new Set(portalOwners.flatMap((c) => c.erddapServers));

  const portals = [
    ...portalOwners.map((owner) => {
      const servers = erddapServersSelected.filter((s) =>
        owner.erddapServers?.includes(s.url),
      );
      const obis = obisCataloguesSelected.find((o) => o.pk === owner.pk);
      return {
        key: `ckan-${owner.pk}`,
        label: owner.title,
        leaves: [
          ...servers.map((s) =>
            serverLeaf(s, servers.length > 1 ? `ERDDAP: ${s.title}` : "ERDDAP"),
          ),
          ...(obis
            ? [
                {
                  id: `obiscat-${owner.pk}`,
                  kind: "obis",
                  label: "OBIS",
                  option: obis,
                  setList: setObisCataloguesSelected,
                },
              ]
            : []),
        ],
      };
    }),
    ...erddapServersSelected
      .filter((s) => !claimed.has(s.url))
      .map((s) => ({
        key: `erddap-${s.pk}`,
        label: s.title,
        leaves: [serverLeaf(s, "ERDDAP")],
      })),
    ...(obisNodesSelected.length > 0
      ? [
          {
            key: "obis",
            label: "OBIS",
            isObis: true,
            leaves: obisNodesSelected.map((n) => ({
              id: `obis-${n.pk}`,
              kind: "obisNode",
              label: n.title,
              option: n,
              setList: setObisNodesSelected,
            })),
          },
        ]
      : []),
  ];

  return portals
    .filter((portal) => portal.leaves.length > 0)
    .map((portal) => {
      const state = portalState(portal.leaves);
      return {
        ...portal,
        state,
        someSet: portal.leaves.some((l) => isSet(l.option)),
        toggle: (target) =>
          setLeaves(portal.leaves, state === target ? undefined : target),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
