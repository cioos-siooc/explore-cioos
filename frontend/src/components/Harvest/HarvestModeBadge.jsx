import React from 'react'
import { useTranslation } from 'react-i18next'
import { harvestMode } from './harvestMode.js'

// Single-word cue for whether a dataset is file-based ('file' — ERDDAP need not
// be re-queried when the file list is unchanged) or database-backed ('source' —
// always re-queried). Plain coloured text, not a badge; the explanation lives in
// the tooltip. When file detection didn't resolve, the cell is left empty.
export default function HarvestModeBadge({ dataset }) {
  const { t } = useTranslation()
  const mode = harvestMode(dataset)
  if (mode === 'unknown') return null

  const tip = t(`harvest.mode.${mode}.tip`)
  return (
    <span title={tip} style={{ fontSize: '0.82rem' }}>
      {t(`harvest.mode.${mode}.label`)}
    </span>
  )
}
