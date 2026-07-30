import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import isEmpty from 'lodash/isEmpty'

import { getCookieValue } from '../../utilities.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

const UIContext = createContext()

export function useUI () {
  return useContext(UIContext)
}

export default function UIProvider ({ children }) {
  const { polygon } = useSelection()

  // The datasets sidebar: open by default on desktop, closed on phones where
  // it would cover the whole map.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 701px)').matches
  )
  // The modal surfaces: filter management, the download order, and the
  // dataset-coverage figure.
  const [showFiltersModal, setShowFiltersModal] = useState(false)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [showCoverageModal, setShowCoverageModal] = useState(false)
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

  // A map selection (click or draw) surfaces the matching datasets.
  useEffect(() => {
    if (!isEmpty(polygon)) setSidebarOpen(true)
  }, [polygon])

  const value = {
    sidebarOpen,
    setSidebarOpen,
    showFiltersModal,
    setShowFiltersModal,
    showDownloadModal,
    setShowDownloadModal,
    showCoverageModal,
    setShowCoverageModal,
    openFilter,
    setOpenFilter,
    showIntroModal,
    setShowIntroModal
  }

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}
