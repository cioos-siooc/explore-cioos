/* eslint-disable react/prop-types */
import * as React from 'react'
import { useRef, useState, useEffect } from 'react'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  X
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { Badge } from 'react-bootstrap'

import QuestionIconTooltip from '../../QuestionIconTooltip/QuestionIconTooltip.jsx'
import { abbreviateString, useOutsideAlerter, useDebounce } from '../../../../utilities'
import { server } from '../../../../config.js'

import '../styles.css'
import './styles.css'

export default function ScientificNameFilter({
  scientificNamesSelected,
  setScientificNamesSelected,
  disabled,
  disabledTooltip,
  tooltip,
  icon,
  controlled,
  openFilter,
  setOpenFilter,
  filterName,
  searchPlaceholder,
  badgeTitle
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en'
  const [filterOpen, setFilterOpen] = useState(false)
  const [input, setInput] = useState('')
  const debouncedInput = useDebounce(input, 250)
  const [suggestions, setSuggestions] = useState([])
  const [vernacularByName, setVernacularByName] = useState({})
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef(null)
  useOutsideAlerter(wrapperRef, setFilterOpen, false)

  const open = controlled ? filterOpen && openFilter : filterOpen

  useEffect(() => {
    if (controlled) setFilterOpen(openFilter)
  }, [openFilter])

  const mergeVernaculars = (items) => {
    setVernacularByName((prev) => {
      const next = { ...prev }
      for (const item of items) {
        if (item && item.scientificName && item.vernacular) {
          next[item.scientificName] = item.vernacular
        }
      }
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const q = encodeURIComponent(debouncedInput || '')
    fetch(`${server}/scientificNames?q=${q}&lang=${lang}&limit=200`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        const normalized = Array.isArray(items) ? items.filter((i) => i && i.scientificName) : []
        setSuggestions(normalized)
        mergeVernaculars(normalized)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [debouncedInput, open, lang])

  // Hydrate vernaculars for selections we don't yet know about (e.g. on page load
  // when chips were restored from the URL). Re-runs when the locale changes so a
  // user toggling the site language gets locale-appropriate subtitles.
  useEffect(() => {
    const unknown = scientificNamesSelected.filter((n) => !vernacularByName[n])
    if (unknown.length === 0) return
    const controller = new AbortController()
    const names = encodeURIComponent(unknown.join(','))
    fetch(`${server}/scientificNames?names=${names}&lang=${lang}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        if (Array.isArray(items)) mergeVernaculars(items)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err)
      })
    return () => controller.abort()
  }, [scientificNamesSelected, lang])

  const active = scientificNamesSelected && scientificNamesSelected.length > 0
  const displayName = badgeTitle || filterName
  const label = active
    ? `${displayName}: ${abbreviateString(scientificNamesSelected.join(', '), 30)}`
    : displayName

  const filteredSuggestions = suggestions.filter(
    (s) => !scientificNamesSelected.includes(s.scientificName)
  )

  const handleAdd = (name, vernacular) => {
    if (!scientificNamesSelected.includes(name)) {
      setScientificNamesSelected([...scientificNamesSelected, name])
    }
    if (vernacular) {
      setVernacularByName((prev) => ({ ...prev, [name]: vernacular }))
    }
    setInput('')
  }

  const handleRemove = (name) => {
    setScientificNamesSelected(
      scientificNamesSelected.filter((n) => n !== name)
    )
  }

  const handleClick = () => {
    if (disabled) return
    setFilterOpen(!filterOpen)
    if (controlled) setOpenFilter(filterName)
  }

  return (
    <div className='filter scientificNameFilter' ref={wrapperRef}>
      <button
        className={`filterHeader ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={handleClick}
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
      >
        {tooltip && !disabled && (
          <QuestionIconTooltip
            tooltipText={tooltip}
            tooltipPlacement='bottom'
            size={20}
          />
        )}
        {icon}
        <div className='badgeTitle' title={badgeTitle || label}>
          {abbreviateString(badgeTitle || label, 35)}
        </div>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
      </button>
      {open && !disabled && (
        <div className='filterOptions'>
          {scientificNamesSelected.length > 0 && (
            <div className='scientificNameChips'>
              {scientificNamesSelected.map((name) => {
                const vern = vernacularByName[name]
                return (
                  <Badge
                    key={name}
                    bg='light'
                    text='dark'
                    className='scientificNameChip'
                    onClick={() => handleRemove(name)}
                    title={t('scientificNameFilterRemoveTitle')}
                  >
                    <span className='scientificNameChipName'>{name}</span>
                    {vern && (
                      <span className='scientificNameChipVernacular'> ({vern})</span>
                    )}
                    <X size={16} />
                  </Badge>
                )
              })}
            </div>
          )}
          <input
            autoFocus
            className='filterSearch'
            type='text'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={searchPlaceholder}
          />
          <div className='scientificNameSuggestions'>
            {loading && <div className='scientificNameLoading'>…</div>}
            {!loading && filteredSuggestions.length === 0 && (
              <div className='scientificNameEmpty'>
                {t('scientificNameFilterNoResults')}
              </div>
            )}
            {filteredSuggestions.map(({ scientificName, vernacular, rank }) => (
              <div
                key={scientificName}
                className='scientificNameSuggestion'
                onClick={() => handleAdd(scientificName, vernacular)}
              >
                <div className='scientificNameSuggestionPrimary'>{scientificName}</div>
                {(rank || vernacular) && (
                  <div className='scientificNameSuggestionVernacular'>
                    {rank && (
                      <span className='scientificNameSuggestionRank'>{rank}</span>
                    )}
                    {rank && vernacular && ' · '}
                    {vernacular}
                  </div>
                )}
              </div>
            ))}
          </div>
          {scientificNamesSelected.length > 0 && (
            <button onClick={() => setScientificNamesSelected([])}>
              {t('resetButtonText')}
            </button>
          )}
          <button onClick={() => setFilterOpen(false)}>
            {t('closeButtonText')}
          </button>
        </div>
      )}
    </div>
  )
}
