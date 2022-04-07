import _, { size, toInteger } from 'lodash'
import * as React from 'react'
import { useState, useEffect } from 'react'
import { Table } from 'react-bootstrap'
import { ArrowDown, ArrowUp, CheckSquare, ChevronCompactRight, SortAlphaDown, SortAlphaUp, SortNumericDown, SortNumericUp, Square } from 'react-bootstrap-icons'
import { abbreviateString, bytesToMemorySizeString } from '../../../utilities'

import './styles.css'

export default function DatasetsTable({ handleSelectAllDatasets, handleSelectDataset, datasets, setDatasets, selectAll, setInspectDataset }) {
  const [sortedData, setSortedData] = useState(datasets)
  const [sortProp, setSortProp] = useState('title')
  const [ascending, setAscending] = useState(false)

  useEffect(() => {
    setSortedData(datasets)
  }, [datasets])

  useEffect(() => {
    handleSortByProperty(sortProp)
  }, [])

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
    <div className='datasetsTable'>
      <Table striped hover>
        <thead>
          <tr>
            <th title='Select all' onClick={(e) => {
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
            <th title='Sort by dataset title' onClick={() => handleSortByProperty('title')}>
              Title {sortProp === 'title' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th title='Sort by dataset type' onClick={() => handleSortByProperty('cdm_data_type')}>
              Type {sortProp === 'cdm_data_type' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th title='Sort by number of records in dataset' onClick={() => handleSortByProperty('profiles_count')}>
              Records {sortProp === 'profiles_count' && (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
            <th title='Sort by approximate dataset size in megabytes' onClick={() => handleSortByProperty('size')}>
              Size  {sortProp === 'size' && (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
            <th title='Open dataset details'>
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((point, index) => {
            return (
              <tr key={index}>
                <td
                  style={{ wordWrap: 'break-word' }}
                  onClick={() => handleSelectDataset(point)} title='Select dataset for download'
                >
                  {point.selected ? <CheckSquare /> : <Square />}
                </td>
                <td
                  style={{ wordWrap: 'break-word' }}
                  title={point.title}
                >
                  {abbreviateString(point.title, 40)}
                </td>
                <td
                  style={{ wordWrap: 'break-word' }}
                  title='Dataset type'
                >
                  {point.cdm_data_type}
                </td>
                <td
                  style={{ wordWrap: 'break-word' }}
                  title='Number of records in dataset'
                >
                  {toInteger(point.profiles_count)}
                </td>
                <td
                  style={{ wordWrap: 'break-word' }}
                  title='Approximate dataset size in megabytes'
                >
                  {bytesToMemorySizeString(point.size)}
                </td>
                <td
                  style={{ wordWrap: 'break-word' }}
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