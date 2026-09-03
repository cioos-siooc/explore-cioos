import { describe, it, expect, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import * as React from 'react'

import { renderWithProviders } from '../../test/renderWithProviders.jsx'
import { installMockFetch } from '../../test/mockFetch.js'
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  TABLET_WIDTH,
  setViewportWidth
} from '../../test/viewport.js'
import { useUI } from './UIProvider.jsx'

// Reports the sidebar's state and offers the two ways it changes, so the rules
// below are asserted through the same interface the chrome uses.
function SidebarProbe () {
  const { sidebarOpen, setSidebarOpen } = useUI()
  return (
    <div>
      <span data-testid='state'>{sidebarOpen ? 'open' : 'closed'}</span>
      <button type='button' onClick={() => setSidebarOpen(!sidebarOpen)}>
        toggle
      </button>
    </div>
  )
}

const state = () => screen.getByTestId('state').textContent

describe('the datasets sidebar default', () => {
  beforeEach(() => {
    installMockFetch()
  })

  it('starts open on a wide screen', async () => {
    setViewportWidth(DESKTOP_WIDTH)
    renderWithProviders(<SidebarProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('open'))
  })

  it('starts closed on anything narrower, where it would take too much map', async () => {
    setViewportWidth(TABLET_WIDTH)
    renderWithProviders(<SidebarProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('closed'))
  })

  it('starts closed on a phone', async () => {
    setViewportWidth(MOBILE_WIDTH)
    renderWithProviders(<SidebarProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('closed'))
  })

  it('follows the breakpoint until the user makes their own call', async () => {
    // A window resized, or a tablet rotated, into a wide screen should get the
    // default for the size it is now rather than the one it booted at.
    setViewportWidth(TABLET_WIDTH)
    renderWithProviders(<SidebarProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('closed'))

    act(() => setViewportWidth(DESKTOP_WIDTH))
    await waitFor(() => expect(state()).toBe('open'))
  })

  it('stops following it once the user has chosen', async () => {
    // The subtle rule, and the one a layout change is most likely to break:
    // after an explicit toggle the screen-size default no longer applies, so a
    // resize must not reopen a list the user put away.
    setViewportWidth(DESKTOP_WIDTH)
    const { user } = renderWithProviders(<SidebarProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('open'))

    await user.click(screen.getByRole('button', { name: 'toggle' }))
    expect(state()).toBe('closed')

    act(() => setViewportWidth(TABLET_WIDTH))
    act(() => setViewportWidth(DESKTOP_WIDTH))
    expect(state()).toBe('closed')
  })
})

describe('the intro modal', () => {
  beforeEach(() => {
    installMockFetch()
  })

  function IntroProbe () {
    const { showIntroModal } = useUI()
    return <span data-testid='state'>{showIntroModal ? 'shown' : 'hidden'}</span>
  }

  it('opens on a first visit', async () => {
    renderWithProviders(<IntroProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('shown'))
  })

  it('stays away once the cookie says it has been seen', async () => {
    document.cookie = 'introModalOpen=false; path=/'
    renderWithProviders(<IntroProbe />, { providers: 'app' })
    await waitFor(() => expect(state()).toBe('hidden'))
  })
})
