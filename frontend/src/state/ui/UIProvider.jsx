import * as React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'
import isEmpty from 'lodash/isEmpty'

import { getCookieValue } from '../../utilities.jsx'
import { useSelection } from '../selection/SelectionProvider.jsx'

const UIContext = createContext()

export function useUI () {
  return useContext(UIContext)
}

export const PANELS = {
  filters: 'filters',
  datasets: 'datasets',
  download: 'download'
}

export default function UIProvider ({ children }) {
  const { polygon } = useSelection()

  // The one contextual surface: which bottom-sheet panel is open, if any.
  const [activePanel, setActivePanel] = useState(null)
  // Which filter flyout is open inside the Filters panel (one at a time).
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
    if (!isEmpty(polygon)) setActivePanel(PANELS.datasets)
  }, [polygon])

  function togglePanel (panel) {
    setActivePanel((current) => (current === panel ? null : panel))
  }

  const value = {
    activePanel,
    setActivePanel,
    togglePanel,
    openFilter,
    setOpenFilter,
    showIntroModal,
    setShowIntroModal
  }

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}
