import * as React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import isEmpty from 'lodash/isEmpty'

import { getCookieValue } from '../../utilities.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

const UIContext = createContext()

// Above this width the datasets list is shown by default — there is enough map
// left over for it to sit beside rather than on top of. Below it the map leads
// and the list is opened from the top bar (or dragged up, on phones, where the
// card is a bottom sheet).
const WIDE_SCREEN_QUERY = '(min-width: 1400px)'

export function useUI () {
  return useContext(UIContext)
}

export default function UIProvider ({ children }) {
  const { polygon, selectedTrajectory } = useSelection()

  // The datasets sidebar: open by default on wide screens, closed on anything
  // narrower, where it would take too much of the map.
  const [sidebarOpen, setSidebarOpenState] = useState(
    () => window.matchMedia(WIDE_SCREEN_QUERY).matches
  )
  // Set once the user opens or closes the list themselves; from then on their
  // choice sticks and the screen-size default no longer applies.
  const sidebarChosenRef = useRef(false)
  const setSidebarOpen = useCallback((next) => {
    sidebarChosenRef.current = true
    setSidebarOpenState(next)
  }, [])

  // Follow the breakpoint until the user makes their own call, so a window
  // resized (or a tablet rotated) into a wide screen gets the default for the
  // size it is now rather than keeping the one it booted at.
  useEffect(() => {
    const mql = window.matchMedia(WIDE_SCREEN_QUERY)
    const onChange = (e) => {
      if (!sidebarChosenRef.current) setSidebarOpenState(e.matches)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  // The two modal surfaces: filter management and the download order.
  const [showFiltersModal, setShowFiltersModal] = useState(false)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  // Which filter flyout is open inside the filters modal (one at a time).
  const [openFilter, setOpenFilter] = useState()
  const introOpenCookie = !getCookieValue('introModalOpen')
  const [showIntroModal, setShowIntroModal] = useState(
    introOpenCookie !== undefined ? introOpenCookie : true
  )

  useEffect(() => {
    document.cookie = `introModalOpen=${showIntroModal}; Secure; max-age=${
      60 * 60 * 24 * 31
    }`
  }, [showIntroModal])

  // A map selection (click or draw) surfaces the matching datasets. These reveal
  // the list without counting as the user's choice about it, so the screen-size
  // default still applies afterwards.
  useEffect(() => {
    if (!isEmpty(polygon)) setSidebarOpenState(true)
  }, [polygon])

  // Clicking a track on the map opens that dataset's page — surface the panel
  // holding it, which a phone (or a collapsed sidebar) would otherwise hide.
  useEffect(() => {
    if (selectedTrajectory) setSidebarOpenState(true)
  }, [selectedTrajectory])

  const value = {
    sidebarOpen,
    setSidebarOpen,
    showFiltersModal,
    setShowFiltersModal,
    showDownloadModal,
    setShowDownloadModal,
    openFilter,
    setOpenFilter,
    showIntroModal,
    setShowIntroModal
  }

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}
