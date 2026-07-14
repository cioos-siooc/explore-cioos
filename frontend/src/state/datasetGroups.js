// Grouping of the datasets list (DatasetsTable) by one dimension at a time.
//
// A group is identified by a stable key, never by its label: the keys are
// persisted (URL: ?groupBy=&hiddenGroups=) and matched against the hidden set,
// both of which have to survive a language switch. Labels are derived from the
// key at render time.

export const GROUP_NONE = 'none'

// Keys with no natural value behind them. Prefixed so they can't collide with
// a real organization / EOV / platform name.
export const GRID_KEY = '__grid__'
export const OTHER_KEY = '__other__'
export const UNCATEGORIZED_KEY = '__uncategorized__'
export const IN_VIEW_KEY = 'in'
export const OUT_OF_VIEW_KEY = 'out'

// Groups that sort last regardless of their label.
const LAST_KEYS = new Set([OTHER_KEY, UNCATEGORIZED_KEY])

// 'inView' groups by the current map viewport rather than by a property of the
// dataset, so its membership changes on every pan — hiding it from the map is
// not offered (see DatasetsTable), which would otherwise reload the tiles on
// each pan for no visible gain.
export const HIDEABLE_DIMENSIONS = new Set([
  'type',
  'platform',
  'organization',
  'eov',
  'source'
])

export function groupOptions (t) {
  return [
    { id: GROUP_NONE, label: t('datasetsCardGroupNoneText') },
    { id: 'type', label: t('datasetsTableHeaderTypeText') },
    { id: 'platform', label: t('datasetsCardSortPlatformText') },
    { id: 'organization', label: t('datasetsCardGroupOrganizationText') },
    { id: 'eov', label: t('datasetsCardGroupEovText') },
    { id: 'source', label: t('datasetsCardGroupSourceText') },
    { id: 'inView', label: t('datasetsCardOnlyInViewText') }
  ]
}

export function isGroupDimension (groupBy) {
  return Boolean(groupBy) && groupBy !== GROUP_NONE
}

// The group key(s) a dataset belongs to under the active dimension. The
// array-valued dimensions (organization, eov) return several, so a dataset
// shows under each of its values.
export function groupKeysFor (row, groupBy, datasetsInViewPks) {
  const isGrid = row.cdm_data_type === 'Grid'
  switch (groupBy) {
  case 'type':
    return [isGrid ? GRID_KEY : row.cdm_data_type || OTHER_KEY]
  case 'platform':
    return [isGrid ? GRID_KEY : row.platform || OTHER_KEY]
  case 'source':
    return [row.source_type === 'obis' ? 'obis' : 'erddap']
  case 'organization':
    return row.organizations?.length ? row.organizations : [UNCATEGORIZED_KEY]
  case 'eov':
    return row.eovs?.length ? row.eovs : [UNCATEGORIZED_KEY]
  case 'inView':
    return [
      datasetsInViewPks?.has(row.pk) ? IN_VIEW_KEY : OUT_OF_VIEW_KEY
    ]
  default:
    return []
  }
}

export function groupLabel (key, groupBy, t) {
  if (key === GRID_KEY) return t('griddapTypeLabel')
  if (key === OTHER_KEY) return t('datasetsCardGroupOtherText')
  if (key === UNCATEGORIZED_KEY) return t('datasetsCardGroupUncategorizedText')
  switch (groupBy) {
  case 'type':
    return key
      .replace('TimeSeriesProfile', 'Time series / Profile')
      .replace('TimeSeries', 'Time series')
  case 'source':
    return key === 'obis' ? 'OBIS' : 'ERDDAP'
  case 'inView':
    return key === IN_VIEW_KEY
      ? t('datasetsCardOnlyInViewText')
      : t('datasetsCardGroupOutOfViewText')
  default:
    return key
  }
}

// Alphabetical by label, with Other/Uncategorized pinned to the bottom.
export function sortGroupKeys (keys, groupBy, t, language) {
  return [...keys].sort((a, b) => {
    const aLast = LAST_KEYS.has(a)
    const bLast = LAST_KEYS.has(b)
    if (aLast !== bLast) return aLast ? 1 : -1
    return groupLabel(a, groupBy, t).localeCompare(
      groupLabel(b, groupBy, t),
      language
    )
  })
}

// The datasets the map must not draw: those whose every group is hidden. A
// dataset in several groups (an organization pair, say) stays on the map as
// long as one of them is still shown.
export function hiddenDatasetPksFor (
  datasets,
  groupBy,
  hiddenGroups,
  datasetsInViewPks
) {
  const hidden = new Set()
  if (!isGroupDimension(groupBy) || hiddenGroups.size === 0) return hidden
  for (const row of datasets) {
    const keys = groupKeysFor(row, groupBy, datasetsInViewPks)
    if (keys.length > 0 && keys.every((key) => hiddenGroups.has(key))) {
      hidden.add(row.pk)
    }
  }
  return hidden
}
