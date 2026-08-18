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
// and the list is opened from the top bar — on phones that raises it as a
// bottom sheet.
const WIDE_SCREEN_QUERY = '(min-width: 1400px)'

export function useUI () {
  return useContext(UIContext)
}

export default function UIProvider ({ children }) {
  const { polygon, selectedTrajectory, inspectDataset, pointsToReview } =
    useSelection()

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

  // A dataset page has to be somewhere the user can see it. Opening one used to
  // imply a track click or a filter narrowed to a single dataset, both of which
  // are covered elsewhere here; the map's "what's here" card opens pages
  // directly, with no filter change to notice, so the panel is raised for the
  // page itself rather than for whatever happened to precede it. Covers a share
  // link carrying ?dataset= too, which lands with the page already open.
  useEffect(() => {
    if (inspectDataset) setSidebarOpenState(true)
  }, [inspectDataset])

  // Clicking a track on the map draws its platform history — surface the panel
  // holding the page that shows it.
  useEffect(() => {
    if (selectedTrajectory) setSidebarOpenState(true)
  }, [selectedTrajectory])

  // Adding datasets to the download from the map's "what's here" card puts
  // something in the list's footer — show the list so the user sees the basket
  // grow and can reach Download. Without it the card's whole effect on a phone
  // was invisible: the sheet was closed and nothing else announced the change.
  // Only a growing selection counts — unticking a dataset should not reopen a
  // list the user had put away.
  const previousDownloadCount = useRef(0)
  useEffect(() => {
    const count = isEmpty(pointsToReview) ? 0 : pointsToReview.length
    if (count > previousDownloadCount.current) setSidebarOpenState(true)
    previousDownloadCount.current = count
  }, [pointsToReview])

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
