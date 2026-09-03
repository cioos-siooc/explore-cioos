import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'

import { renderWithProviders } from '../../../test/renderWithProviders.jsx'
import { installMockFetch } from '../../../test/mockFetch.js'
import ActiveFilterChips from './ActiveFilterChips.jsx'

// Seeded entirely through the address, the way a share link arrives: every
// provider reads its slice out of window.location, so one URL sets up the
// filters, the map camera and the list's own narrowing at once.
function open (search) {
  return renderWithProviders(<ActiveFilterChips />, {
    url: `/?${search}`,
    providers: 'app'
  })
}

const groups = () => screen.queryAllByTestId('filter-chip-group')
// Chips are addressed by which filter they belong to, never by position: the
// groups render in a fixed order today, but that is a layout decision and not
// something these assertions should depend on.
const group = (key) => document.querySelector(`[data-filter-key="${key}"]`)

describe('ActiveFilterChips', () => {
  beforeEach(() => {
    installMockFetch()
  })

  it('renders nothing at all when no filter is narrowing anything', async () => {
    open('lat=63.3&lon=-95.9&zoom=2.75')
    // Give the catalogue fetches a chance to land and still show no chips.
    await waitFor(() => expect(screen.queryByTestId('active-filter-chips')).toBeNull())
  })

  it('announces a filter carried in the link', async () => {
    open('eovs=oxygen')
    await waitFor(() => expect(groups()).toHaveLength(1))

    const eovs = group('eovs')
    expect(eovs).toBeInTheDocument()
    // The chip carries the translated display name, not the raw ?eovs= key.
    expect(within(eovs).getByTestId('filter-chip-item')).toHaveTextContent('Oxygen')
  })

  it('gives one group per filter and one item per chosen value', async () => {
    open('eovs=oxygen,subSurfaceTemperature&platforms=mooring')
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2))

    expect(within(group('eovs')).getAllByTestId('filter-chip-item')).toHaveLength(2)
    expect(within(group('platforms')).getAllByTestId('filter-chip-item')).toHaveLength(1)
  })

  it('drops one value without touching the rest of its group', async () => {
    const { user } = open('eovs=oxygen,subSurfaceTemperature')
    await waitFor(() => expect(groups()).toHaveLength(1))

    const items = within(group('eovs')).getAllByTestId('filter-chip-item')
    await user.click(within(items[0]).getByTestId('filter-chip-item-remove'))

    await waitFor(() =>
      expect(within(group('eovs')).getAllByTestId('filter-chip-item')).toHaveLength(1)
    )
  })

  it('clears a whole group from its trailing x', async () => {
    const { user } = open('eovs=oxygen&platforms=mooring')
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2))

    await user.click(
      within(group('eovs')).getByTestId('filter-chip-group-remove')
    )

    await waitFor(() => expect(group('eovs')).toBeNull())
    // The other group is untouched — clearing one filter is not a reset.
    expect(group('platforms')).toBeInTheDocument()
  })

  it('gives each remove button a name that says what it removes', async () => {
    // They all read "Remove filter" before, which matched every chip at once —
    // ambiguous for a test and useless to a screen reader.
    open('eovs=oxygen&platforms=mooring')
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2))

    const names = screen
      .getAllByTestId('filter-chip-item-remove')
      .map((button) => button.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
    expect(names.some((name) => name.includes('Oxygen'))).toBe(true)
  })

  it('hides and shows the chips without clearing them', async () => {
    const { user } = open('eovs=oxygen')
    await waitFor(() => expect(groups()).toHaveLength(1))

    const toggle = screen.getByTestId('filter-chips-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(groups()).toHaveLength(0)

    await user.click(toggle)
    expect(groups()).toHaveLength(1)
  })

  it('announces the drawn selection as its own chip', async () => {
    open('latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000')
    await waitFor(() =>
      expect(screen.getByTestId('active-filter-chips')).toBeInTheDocument()
    )
    expect(screen.getAllByTestId('filter-chip-item-remove').length).toBeGreaterThan(0)
  })
})
