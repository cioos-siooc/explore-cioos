import * as React from 'react'
import { useState, useRef, useEffect, useContext } from 'react'
import PropTypes from 'prop-types'
import { Container, Row, Col, Accordion, Card, Button, InputGroup, OverlayTrigger, Tooltip, useAccordionToggle, Table, Modal, Badge } from 'react-bootstrap'
import classnames from 'classnames'
import { ChevronCompactLeft, ChevronCompactRight, QuestionCircle, ChevronCompactDown, ChevronCompactUp, ArrowRight } from 'react-bootstrap-icons'

import TimeSelector from './TimeSelector/TimeSelector.jsx'
import DepthSelector from './DepthSelector/DepthSelector.jsx'
import SubmitRequest from './SubmitRequest/SubmitRequest.jsx'
import PageControls from './PageControls/PageControls.jsx'
import { server } from '../../config'

import './styles.css'

export default function Controls(props) {

  // Making changes to context within context consumers
  //https://stackoverflow.com/questions/41030361/how-to-update-react-context-from-inside-a-child-component
  const eovsToggleStart = {
    carbon: false,
    currents: false,
    nutrients: false,
    salinity: false,
    temperature: false,
  }
  const [eovsSelected, setEovsSelected] = useState(eovsToggleStart)
  const eovsSelectedValue = { eovsSelected, setEovsSelected }
  const AppContext = React.createContext({
    eovsSelected: eovsToggleStart,
    setEovsSelected: () => { }
  })
  const EovFilter = () => {
    const [filterOpen, setFilterOpen] = useState(false)
    const { eovsSelected, setEovsSelected } = useContext(AppContext)
    const badgeTitle = 'Ocean Variables'
    return (
      <Badge className='filterChip' badge-color='white'>
        {badgeTitle}:{Object.keys(eovsSelected).map((key, index) => {
          if (eovsSelected[key]) {
            return capitalizeFirstLetter(key)
          }
        })}
        <button onClick={() => setFilterOpen(!filterOpen)}>
          {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
        </button>
        {filterOpen &&
          <div className='filterOptions'>
            {Object.keys(eovsSelected).map(eov => (
              <InputGroup key={eov} className="mb-3">
                <InputGroup.Checkbox
                  checked={eovsSelected[eov]}
                  onChange={(e) => {
                    setEovsSelected({
                      ...eovsSelected,
                      [eov]: !eovsSelected[eov]
                    })
                  }}
                  aria-label="Checkbox for following text input"
                />
                <label className='ml-2'>{capitalizeFirstLetter(eov)}</label>
              </InputGroup>))
            }
          </div>
        }
      </Badge>
    )
  }

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  return (
    <div className='controls'>
      <AppContext.Provider value={eovsSelectedValue}>
        <EovFilter />
      </AppContext.Provider>
    </div>
  )
}

Controls.propTypes = {
  map: PropTypes.object.isRequired
}
