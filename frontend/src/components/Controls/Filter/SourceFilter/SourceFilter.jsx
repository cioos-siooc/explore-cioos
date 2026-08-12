/* eslint-disable react/prop-types */

import * as React from 'react'
import { useState } from 'react'
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  DashSquare,
  Square
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { capitalizeFirstLetter } from '../../../../utilities'
import './styles.css'

// Combined data-source filter: ERDDAP servers as a flat list, plus a single
// expandable OBIS group whose parent checkbox selects/deselects every OBIS
// node. Nodes remain individually selectable inside the group.
export default function SourceFilter({
  erddapServersSelected,
  setErddapServersSelected,
  obisNodesSelected,
  setObisNodesSelected,
  searchTerms
}) {
  const { t, i18n } = useTranslation()
  const [obisExpanded, setObisExpanded] = useState(false)

  const search = (searchTerms || '').toString().toLowerCase()
  const obisGroupMatchesSearch = 'obis'.includes(search)

  const serversShown = erddapServersSelected
    .filter((server) => !search || server.title.toLowerCase().includes(search))
    .sort((a, b) => a.title.localeCompare(b.title, i18n.language))

  // When the search matches the group label itself, show every node
  const nodesShown = obisNodesSelected
    .filter(
      (node) =>
        !search ||
        obisGroupMatchesSearch ||
        node.title.toLowerCase().includes(search)
    )
    .sort((a, b) => a.title.localeCompare(b.title, i18n.language))

  const showObisGroup =
    obisNodesSelected.length > 0 && (!search || nodesShown.length > 0)

  // Nothing ticked anywhere constrains nothing, so an empty selection already
  // means every source — see MultiCheckboxFilter. Shown as it is stored: no
  // ticks until the user picks something.
  const isChecked = (option) => option.isSelected

  const allNodesSelected =
    obisNodesSelected.length > 0 && obisNodesSelected.every(isChecked)
  const someNodesSelected = obisNodesSelected.some(isChecked)

  function toggleServer(pk) {
    setErddapServersSelected(
      erddapServersSelected.map((server) =>
        server.pk === pk ? { ...server, isSelected: !server.isSelected } : server
      )
    )
  }

  function toggleNode(pk) {
    setObisNodesSelected(
      obisNodesSelected.map((node) =>
        node.pk === pk ? { ...node, isSelected: !node.isSelected } : node
      )
    )
  }

  function toggleAllNodes() {
    setObisNodesSelected(
      obisNodesSelected.map((node) => ({
        ...node,
        isSelected: !allNodesSelected
      }))
    )
  }

  const obisChildrenVisible = obisExpanded || (search && nodesShown.length > 0)

  if (serversShown.length === 0 && !showObisGroup) {
    return (
      <div className='multiCheckboxFilter sourceFilter'>
        <div>{t('multiCheckboxFilterNoFilterWarning')}</div>
      </div>
    )
  }

  return (
    <div className='multiCheckboxFilter sourceFilter'>
      {serversShown.map((server) => (
        <div
          key={server.pk}
          className={`optionButton ${isChecked(server) && 'selected'}`}
          title={server.title}
          onClick={() => toggleServer(server.pk)}
        >
          {isChecked(server) ? <CheckSquare /> : <Square />}
          <span className='optionName'>
            {capitalizeFirstLetter(server.title)}
          </span>
        </div>
      ))}
      {showObisGroup && (
        <>
          <div
            className={`optionButton obisGroupButton ${allNodesSelected && 'selected'}`}
            title={t('sourceFilterObisGroupTooltip')}
            onClick={() => toggleAllNodes()}
          >
            {allNodesSelected ? (
              <CheckSquare />
            ) : someNodesSelected ? (
              <DashSquare />
            ) : (
              <Square />
            )}
            <span className='optionName'>OBIS</span>
            <span
              className='obisGroupChevron'
              onClick={(e) => {
                e.stopPropagation()
                setObisExpanded(!obisExpanded)
              }}
            >
              {obisChildrenVisible ? <ChevronDown /> : <ChevronRight />}
            </span>
          </div>
          {obisChildrenVisible && (
            <div className='obisGroupChildren'>
              {nodesShown.map((node) => (
                <div
                  key={node.pk}
                  className={`optionButton ${isChecked(node) && 'selected'}`}
                  title={node.title}
                  onClick={() => toggleNode(node.pk)}
                >
                  {isChecked(node) ? <CheckSquare /> : <Square />}
                  <span className='optionName'>{node.title}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
