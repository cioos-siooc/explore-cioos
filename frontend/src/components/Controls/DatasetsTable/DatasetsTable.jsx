import _, { toInteger } from 'lodash'
import * as React from 'react'
import { useState, useEffect } from 'react'
import { Table } from 'react-bootstrap'
import { ArrowDown, ArrowUp, CheckSquare, ChevronCompactRight, CircleFill, SortAlphaDown, SortAlphaUp, SortNumericDown, SortNumericUp, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import { abbreviateString, bytesToMemorySizeString } from '../../../utilities'
import platformColors from '../../platformColors'
import './styles.css'

export default function DatasetsTable({ handleSelectAllDatasets, handleSelectDataset, datasets, setDatasets, selectAll, setInspectDataset, setHoveredDataset = () => { } }) {
  const { t } = useTranslation()
  const [sortedData, setSortedData] = useState(datasets)
  const [sortProp, setSortProp] = useState('title')
  const [ascending, setAscending] = useState(false)
  const [hoveredTableRow, setHoveredTableRow] = useState()

  useEffect(() => {
    setSortedData(datasets)
  }, [datasets])

  useEffect(() => {
    handleSortByProperty(sortProp)
  }, [])

  function sortByProperty(prop) {
    const data = datasets
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
      <Table>
        <thead>
          <tr>
            <th title={t('datasetsTableHeaderSelectAllTitle')}
              // Select all
              className='selectDatasetColumn'
              onClick={(e) => {
                handleSortByProperty('selected')
                e.stopPropagation()
              }}
            >
              <div className='selectAllHeader'>
                {selectAll
                  ? <CheckSquare onClick={(e) => {
                    e.stopPropagation()
                    handleSelectAllDatasets()
                  }}
                  />
                  : <Square onClick={(e) => {
                    e.stopPropagation()
                    handleSelectAllDatasets()
                  }}
                  />
                }
                {sortProp === 'selected' && (ascending ? <ArrowDown /> : <ArrowUp />)}
              </div>
            </th>
            <th
              title={t('datasetsTableHeaderTitleTitle')}
              // 'Sort by dataset title'
              onClick={() => handleSortByProperty('title')}
            >
              {t('datasetsTableHeaderTitleText')} {sortProp === 'title' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th
              title={t('datasetsTableHeaderTypeTitle')}
              // 'Sort by dataset type'
              onClick={() => handleSortByProperty('cdm_data_type')}
            >
              {t('datasetsTableHeaderTypeText')} {sortProp === 'cdm_data_type' && (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th
              className='locationColumn'
              title={t('datasetsTableHeaderLocationsTitle')}
              // 'Sort by number of locations in dataset'
              onClick={() => handleSortByProperty('profiles_count')}
            >
              {t('datasetsTableHeaderLocationsText')} {sortProp === 'profiles_count' && (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((point, index) => {
            const platformColor = platformColors.filter(pc => pc.platform === point.platform)
            return (
              <tr key={index}
                onMouseEnter={() => {
                  setHoveredDataset(point)
                  setHoveredTableRow(index)
                }}
                onMouseLeave={() => {
                  setHoveredDataset()
                  setHoveredTableRow()
                }}
              >
                <td
                  onClick={() => {
                    handleSelectDataset(point)
                  }}
                  title={t('datasetsTableSelectTitle')}
                // 'Select dataset for download'
                >
                  {point.selected ? <CheckSquare /> : <Square />}
                </td>
                <td
                  className='datasetsTableTitleCell'
                  title={point.title}
                  onClick={() => setInspectDataset(point)}
                >
                  {<CircleFill className='optionColorCircle' fill={!_.isEmpty(platformColor) ? platformColor[0].color : '#000000'} size='15' />}
                  {point.title}
                </td>
                <td
                  style={{ wordBreak: point.cdm_data_type === 'TimeSeriesProfile' && 'break-word' }}
                  title={t('datasetsTableTypeTitle')}
                  // 'Dataset type'
                  onClick={() => setInspectDataset(point)}
                >
                  {point.cdm_data_type}
                </td>
                <td
                  className='datasetTableLocationsCell'
                  title={t('datasetsTableLocationsTitle')}
                  // 'Number of locations in dataset'
                  onClick={() => setInspectDataset(point)}
                >
                  {`${toInteger(point.profiles_count)} / ${toInteger(point.n_profiles)}`} {hoveredTableRow === index && <ChevronCompactRight size={25} title='view dataset details' />}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div >
  )
}
