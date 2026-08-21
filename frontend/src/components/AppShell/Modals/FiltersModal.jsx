import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Modal from '../../ui/Modal.jsx'
import FiltersPanel from '../Panels/FiltersPanel.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The filter-management modal, launched from the Filters button beside the
// sidebar. Hosts the master/detail FiltersPanel; filters apply to the map
// live, so closing is just dismissal — there is no confirm step.
export default function FiltersModal () {
  const { t } = useTranslation()
  const { showFiltersModal, setShowFiltersModal, openFilter } = useUI()

  // openFilter is a translation key for most filters but an already-translated
  // label for the two range ones (see FiltersPanel), and i18next returns an
  // unknown key unchanged — so t() is the right call for both shapes.
  const openFilterName = openFilter ? t(openFilter) : ''

  return (
    <Modal
      show={showFiltersModal}
      onHide={() => setShowFiltersModal(false)}
      className='filtersModal'
      dialogClassName='filtersModalDialog'
      aria-labelledby='filtersModalTitle'
    >
      <Modal.Header closeButton>
        <Modal.Title id='filtersModalTitle'>
          {t('filtersMenuButton')}
          {openFilterName && (
            <span className='filtersModalTitleCurrent'>{openFilterName}</span>
          )}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <FiltersPanel />
      </Modal.Body>
    </Modal>
  )
}
