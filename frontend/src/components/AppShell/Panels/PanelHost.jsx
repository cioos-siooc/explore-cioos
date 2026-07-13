import * as React from 'react'
import { useEffect, useRef } from 'react'
import { XLg } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import FiltersPanel from './FiltersPanel.jsx'
import DatasetsPanel from './DatasetsPanel.jsx'
import DownloadPanel from './DownloadPanel.jsx'
import { useUI, PANELS } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

const PANEL_TITLE_KEYS = {
  [PANELS.filters]: 'filtersMenuButton',
  [PANELS.datasets]: 'datasetsFilterName',
  [PANELS.download]: 'downloadModalTitleText'
}

// The bottom sheet rising above the dock. One panel at a time; content swaps
// when another dock item is chosen. Non-modal: the map stays interactive.
export default function PanelHost () {
  const { t } = useTranslation()
  const { activePanel, setActivePanel } = useUI()
  const headingRef = useRef(null)

  useEffect(() => {
    if (!activePanel) return
    headingRef.current?.focus()

    function handleKeyDown (event) {
      if (event.key !== 'Escape') return
      // Let open sub-surfaces (modals, filter flyouts) take Escape first.
      if (document.body.classList.contains('cioos-modal-open')) return
      setActivePanel(null)
      document.getElementById(`dockItem-${activePanel}`)?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activePanel])

  if (!activePanel) return null

  return (
    <section
      className='panelHost'
      id={`panel-${activePanel}`}
      data-panel={activePanel}
      role='dialog'
      aria-modal='false'
      aria-labelledby='panelHostTitle'
    >
      <header className='panelHostHeader'>
        <h2 id='panelHostTitle' tabIndex={-1} ref={headingRef}>
          {t(PANEL_TITLE_KEYS[activePanel])}
        </h2>
        <button
          type='button'
          className='panelHostClose'
          onClick={() => {
            const panel = activePanel
            setActivePanel(null)
            document.getElementById(`dockItem-${panel}`)?.focus()
          }}
          title={t('panelCloseButtonTitle')}
          aria-label={t('panelCloseButtonTitle')}
        >
          <XLg size={16} aria-hidden='true' />
        </button>
      </header>
      <div className='panelHostBody'>
        {activePanel === PANELS.filters && <FiltersPanel />}
        {activePanel === PANELS.datasets && <DatasetsPanel />}
        {activePanel === PANELS.download && <DownloadPanel />}
      </div>
    </section>
  )
}
