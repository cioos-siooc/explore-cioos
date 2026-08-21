/* eslint-disable react/prop-types */
import * as React from 'react'
import { useState, useEffect } from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Spinner from '../../../ui/Spinner.jsx'
import { useDebounce } from '../../../../utilities'
import { server } from '../../../../config.js'

import '../styles.css'
import '../MultiCheckboxFilter/styles.css'
import './styles.css'

// Show only Family and below in the typeahead — every higher rank is
// either guaranteed to blow the API's 5000-AphiaID cap (Class+ on this
// dataset) or sometimes does (most Orders, e.g. Decapoda ≈ 10k,
// Stylommatophora ≈ 11k), which would surface as a confusing 400 from
// what looked like a valid pick. Family and below is the conservative
// "always works" band. The API cap is still the safety net for direct
// callers — this list just keeps the UI clean.
const TOO_BROAD_RANKS = new Set([
  'Kingdom', 'Subkingdom', 'Superkingdom',
  'Domain', 'Superdomain',
  'Phylum', 'Subphylum', 'Superphylum',
  'Phylum (Division)', 'Subphylum (Subdivision)',
  'Class', 'Subclass', 'Superclass',
  'Infraclass', 'Parvclass',
  'Cohort', 'Subcohort',
  'Superorder', 'Magnorder', 'Grandorder', 'Mirorder',
  'Order', 'Suborder', 'Infraorder', 'Parvorder',
  'Superfamily', 'Epifamily',
])

// The body of the Scientific Name filter: the same ticked list of options every
// other filter in the panel shows.
//
// What is different about it is where the options come from — the other lists
// are the catalogue's own facets, held in state and searched in the browser,
// while this one is a typeahead against WoRMS by way of /scientificNames, so
// what is offered changes with what is typed into the panel's search box. That
// is why the picked names are pinned to the top of the list rather than left to
// the search: an option that vanished from the list the moment the search moved
// on would be one the user could no longer untick.
export default function ScientificNameFilter({
  scientificNamesSelected,
  setScientificNamesSelected,
  searchTerms
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en'
  const debouncedSearchTerms = useDebounce(searchTerms || '', 250)
  const [suggestions, setSuggestions] = useState([])
  // Rank and common name for every name we have seen, kept so a picked name
  // reads the same pinned at the top of the list as it did in the suggestions
  // it was picked from — the search that offered it has usually moved on by
  // then, and a row that loses its second line on being ticked looks like a
  // different row.
  const [detailsByName, setDetailsByName] = useState({})
  const [loading, setLoading] = useState(false)

  const mergeDetails = (items) => {
    setDetailsByName((prev) => {
      const next = { ...prev }
      for (const item of items) {
        if (item && item.scientificName && (item.vernacular || item.rank)) {
          next[item.scientificName] = {
            vernacular: item.vernacular,
            rank: item.rank
          }
        }
      }
      return next
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const q = encodeURIComponent(debouncedSearchTerms)
    fetch(`${server}/scientificNames?q=${q}&lang=${lang}&limit=200`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        const normalized = Array.isArray(items) ? items.filter((i) => i && i.scientificName) : []
        setSuggestions(normalized)
        mergeDetails(normalized)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [debouncedSearchTerms, lang])

  // Hydrate details for selections we don't yet know about (e.g. on page load
  // when the names were restored from the URL). Re-runs when the locale changes so
  // a user toggling the site language gets locale-appropriate subtitles.
  useEffect(() => {
    const unknown = scientificNamesSelected.filter((n) => !detailsByName[n])
    if (unknown.length === 0) return
    const controller = new AbortController()
    const names = encodeURIComponent(unknown.join(','))
    fetch(`${server}/scientificNames?names=${names}&lang=${lang}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        if (Array.isArray(items)) mergeDetails(items)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error(err)
      })
    return () => controller.abort()
  }, [scientificNamesSelected, lang])

  const toggleName = (name) => {
    if (scientificNamesSelected.includes(name)) {
      setScientificNamesSelected(
        scientificNamesSelected.filter((n) => n !== name)
      )
    } else {
      setScientificNamesSelected([...scientificNamesSelected, name])
    }
  }

  // The picked names first, then whatever the search is offering that isn't
  // already picked.
  const options = [
    ...scientificNamesSelected.map((scientificName) => ({
      scientificName,
      ...detailsByName[scientificName],
      isSelected: true
    })),
    ...suggestions
      .filter(
        (s) =>
          !scientificNamesSelected.includes(s.scientificName) &&
          !TOO_BROAD_RANKS.has(s.rank)
      )
      .map((s) => ({ ...s, isSelected: false }))
  ]

  return (
    <div className='multiCheckboxFilter scientificNameFilter'>
      {options.map(({ scientificName, vernacular, rank, isSelected }) => (
        <div
          key={scientificName}
          className={`optionButton ${isSelected ? 'selected' : ''}`}
          title={vernacular || scientificName}
          onClick={() => toggleName(scientificName)}
        >
          {isSelected ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            <span className='scientificNameOptionName'>{scientificName}</span>
            {(rank || vernacular) && (
              <span className='scientificNameOptionDetail'>
                {rank && <span className='scientificNameOptionRank'>{rank}</span>}
                {rank && vernacular && ' · '}
                {vernacular}
              </span>
            )}
          </span>
        </div>
      ))}
      {loading && (
        <div className='scientificNameLoading'>
          <Spinner size='sm' />
          {t('scientificNameFilterLoading')}
        </div>
      )}
      {!loading && options.length === 0 && (
        <div className='scientificNameEmpty'>
          {t('scientificNameFilterNoResults')}
        </div>
      )}
    </div>
  )
}
