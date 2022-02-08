import _, { size, toInteger } from 'lodash'
import * as React from 'react'
import { useState, useEffect } from 'react'
import { Table } from 'react-bootstrap'
import { ArrowDown, ArrowUp, CheckSquare, ChevronCompactRight, SortAlphaDown, SortAlphaUp, SortNumericDown, SortNumericUp, Square } from 'react-bootstrap-icons'
import { abbreviateString, bytesToMemorySizeString } from '../../../utilities'

import './styles.css'

export default function DatasetsTable({ handleSelectAllDatasets, handleSelectDataset, datasets, setDatasets, selectAll, setInspectDataset, width }) {
  const [sortedData, setSortedData] = useState(datasets)
  const [sortProp, setSortProp] = useState('title')
  const [ascending, setAscending] = useState(false)

  useEffect(() => {
    setSortedData(datasets)
  }, [datasets])

  useEffect(() => {
    handleSortByProperty(sortProp)
  }, [])

  const totalWidth = 560

  const checkColWidth = 0.080 * width        // 40      // 0.072
  const titleColWidth = 0.210 * width       // 145     // 0.263
  const typeColWidth = 0.200 * width        // 115      // 0.205
  const recordsColWidth = 0.190 * width     // 80    // 0.209
  const sizeColWidth = 0.181 * width        // 100      // 0.181
  const openButtonColWidth = 0.127 * width  // 70 // 0.127

  function sortByProperty(prop) {
    let data = datasets
    if (prop === sortProp) {
      ascending ? data.sort((a, b) => _.get(a, prop) > _.get(b, prop) ? -1 : _.get(a, prop) < _.get(b, prop) ? 1 : 0) : data.sort((a, b) => _.get(a, prop) > _.get(b, prop) ? 1 : _.get(a, prop) < _.get(b, prop) ? -1 : 0)

    } else {
      data.sort((a, b) => _.get(a, prop) > _.get(b, prop) ? 1 : _.get(a, prop) < _.get(b, prop) ? -1 : 0)
    }
    return data
  }

  function handleSortByProperty(prop) {
    if (datasets) {
      setDatasets(sortByProperty(prop))
      if (prop === sortProp) {
        setAscending(!ascending)
      } else {
        setAscending(true)
      }
      setSortProp(prop)
    }
  }

  return (
    <div className='datasetsTable' style={{ width: `${width + 10}px` }}>
      <Table striped hover>
        <thead>
          <tr>
            <th style={{ width: `${checkColWidth}px`, maxWidth: `${checkColWidth}px`, minWidth: `${checkColWidth}px` }} title='Select all' onClick={(e) => {
              handleSortByProperty('selected')
              e.stopPropagation()
            }}
            >
              <div className='selectAllHeader'>
                {selectAll ?
                  <CheckSquare onClick={(e) => {
                    e.stopPropagation()
                    handleSelectAllDatasets()
                  }}
                  />
                  :
                  <Square onClick={(e) => {
                    e.stopPropagation()
                    handleSelectAllDatasets()
                  }}
                  />
                }
                {sortProp === 'selected' && (ascending ? <ArrowDown /> : <ArrowUp />)}
              </div>
            </th>
            <th style={{ width: `${titleColWidth}px`, maxWidth: `${titleColWidth}px`, minWidth: `${titleColWidth}px` }} title='Sort by dataset title' onClick={() => handleSortByProperty('title')}>
              Title {sortProp === 'title' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th style={{ width: `${typeColWidth}px`, maxWidth: `${typeColWidth}px`, minWidth: `${typeColWidth}px` }} title='Sort by dataset type' onClick={() => handleSortByProperty('cdm_data_type')}>
              Type {sortProp === 'cdm_data_type' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th style={{ width: `${recordsColWidth}px`, maxWidth: `${recordsColWidth}px`, minWidth: `${recordsColWidth}px` }} title='Sort by number of records in dataset' onClick={() => handleSortByProperty('profiles.length')}>
              Records {sortProp === 'profiles.length' && (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
            <th style={{ width: `${sizeColWidth}px`, maxWidth: `${sizeColWidth}px`, minWidth: `${sizeColWidth}px` }} title='Sort by approximate dataset size in megabytes' onClick={() => handleSortByProperty('size')}>
              Size  {sortProp === 'size' && (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
            <th style={{ width: `${openButtonColWidth}px`, maxWidth: `${openButtonColWidth}px`, minWidth: `${openButtonColWidth}px` }} title='Open dataset details'>
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((point, index) => {
            return (
              <tr key={index}>
                <td
                  style={{ width: `${checkColWidth}px`, maxWidth: `${checkColWidth}px`, minWidth: `${checkColWidth}px`, wordWrap: 'break-word' }}
                  onClick={() => handleSelectDataset(point)} title='Select dataset for download'
                >
                  {point.selected ? <CheckSquare /> : <Square />}
                </td>
                <td
                  style={{ width: `${titleColWidth}px`, maxWidth: `${titleColWidth}px`, minWidth: `${titleColWidth}px`, wordWrap: 'break-word' }}
                  title={point.title}
                >
                  {abbreviateString(point.title, 40)}
                </td>
                <td
                  style={{ width: `${typeColWidth}px`, maxWidth: `${typeColWidth}px`, minWidth: `${typeColWidth}px`, wordWrap: 'break-word' }}
                  title='Dataset type'
                >
                  {point.cdm_data_type}
                </td>
                <td
                  style={{ width: `${recordsColWidth}px`, maxWidth: `${recordsColWidth}px`, minWidth: `${recordsColWidth}px`, wordWrap: 'break-word' }}
                  title='Number of records in dataset'
                >
                  {toInteger(point.profiles.length)}
                </td>
                <td
                  style={{ width: `${sizeColWidth}px`, maxWidth: `${sizeColWidth}px`, minWidth: `${sizeColWidth}px`, wordWrap: 'break-word' }}
                  title='Approximate dataset size in megabytes'
                >
                  {bytesToMemorySizeString(point.size)}
                </td>
                <td
                  style={{ width: `${openButtonColWidth}px`, maxWidth: `${openButtonColWidth}px`, minWidth: `${openButtonColWidth}px`, wordWrap: 'break-word' }}
                  onClick={() => setInspectDataset(point)}
                  title='Open dataset details'
                >
                  <div className='inspectButton'><ChevronCompactRight /></div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div >
  )
}