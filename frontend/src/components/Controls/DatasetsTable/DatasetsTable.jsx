import _, { toInteger } from 'lodash'
import * as React from 'react'
import { useState, useEffect } from 'react'
import { Table } from 'react-bootstrap'
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronCompactRight,
  CircleFill,
  SortAlphaDown,
  SortAlphaUp,
  SortNumericDown,
  SortNumericUp,
  Square
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
// import { abbreviateString, bytesToMemorySizeString } from '../../../utilities'
import platformColors from '../../platformColors'
import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import { ribbonArrow } from 'd3'

export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  setInspectDataset,
  setHoveredDataset = () => {}
}) {
  const { t } = useTranslation()

  const checkBoxOnclick = (point) => () => handleSelectDataset(point)
  const selectAllOnclick = (e) => {
    e.stopPropagation()
    handleSelectAllDatasets()
  }

  const columns = [
    {
      name: selectAll ? (
        <CheckSquare onClick={selectAllOnclick} />
      ) : (
        <Square onClick={selectAllOnclick} />
      ),

      selector: (row) => row.selected,
      cell: (row) =>
        row.selected || selectAll ? (
          <CheckSquare onClick={checkBoxOnclick(row)} />
        ) : (
          <Square onClick={checkBoxOnclick(row)} />
        ),
      wrap: true,
      width: '60px',
      sortable: false
    },
    {
      name: 'Platform',
      selector: (row) => row.platform,

      // selector: (row) => row.selected,
      cell: (point) => {
        const platformColor = platformColors.find(
          (pc) => pc.platform === point.platform
        )

        return (
          <CircleFill
            title={point.platform}
            className='optionColorCircle'
            fill={platformColor?.color || '#000000'}
            size={15}
          />
        )
      },
      width: '50px',
      sortable: true
    },
    {
      name: 'Title',
      selector: (row) => row.title,
      wrap: true,
      width: '300px',
      sortable: true
    },
    {
      name: 'Type',
      selector: (row) => row.cdm_data_type,
      wrap: true,
      sortable: true
    },
    {
      name: 'Locations',
      selector: (row) => row.profiles_count,
      wrap: true,
      sortable: true,
      width: '75px'
    }
  ]

  const data = datasets
  const tableData = {
    columns,
    data
  }

  return (
    <div className='datasetsTable'>
      <DataTableExtensions
        {...tableData}
        print={false}
        exportHeaders
        filterPlaceholder={t('datasetInspectorFilterText')}
      >
        <DataTable
          striped
          columns={columns}
          data={data}
          onRowClicked={setInspectDataset}
          onRowMouseEnter={setHoveredDataset}
          highlightOnHover
          pointerOnHover
        />
      </DataTableExtensions>

      {/* <Table>
        <thead>
          <tr>
            <th
              title={t('datasetsTableHeaderSelectAllTitle')}
              // Select all
              className='selectDatasetColumn'
              onClick={(e) => {
                handleSortByProperty('selected')
                e.stopPropagation()
              }}
            >
              <div className='selectAllHeader'>
                {selectAll ? (
                  <CheckSquare
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectAllDatasets()
                    }}
                  />
                ) : (
                  <Square
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectAllDatasets()
                    }}
                  />
                )}
                {sortProp === 'selected' &&
                  (ascending ? <ArrowDown /> : <ArrowUp />)}
              </div>
            </th>
            <th
              title={t('datasetsTableHeaderTitleTitle')}
              // 'Sort by dataset title'
              onClick={() => handleSortByProperty('title')}
            >
              {t('datasetsTableHeaderTitleText')}{' '}
              {sortProp === 'title' &&
                (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th
              title={t('datasetsTableHeaderTypeTitle')}
              // 'Sort by dataset type'
              onClick={() => handleSortByProperty('cdm_data_type')}
            >
              {t('datasetsTableHeaderTypeText')}{' '}
              {sortProp === 'cdm_data_type' &&
                (ascending ? <SortAlphaDown /> : <SortAlphaUp />)}
            </th>
            <th
              className='locationColumn'
              title={t('datasetsTableHeaderLocationsTitle')}
              // 'Sort by number of locations in dataset'
              onClick={() => handleSortByProperty('profiles_count')}
            >
              {t('datasetsTableHeaderLocationsText')}{' '}
              {sortProp === 'profiles_count' &&
                (ascending ? <SortNumericDown /> : <SortNumericUp />)}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((point, index) => {
            const platformColor = platformColors.filter(
              (pc) => pc.platform === point.platform
            )
            return (
              <tr
                key={index}
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
                  {
                    <CircleFill
                      className='optionColorCircle'
                      fill={
                        !_.isEmpty(platformColor)
                          ? platformColor[0].color
                          : '#000000'
                      }
                      size='15'
                    />
                  }
                  {point.title}
                </td>
                <td
                  style={{
                    wordBreak:
                      point.cdm_data_type === 'TimeSeriesProfile' &&
                      'break-word'
                  }}
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
                  {toInteger(point.profiles_count) !==
                  toInteger(point.n_profiles)
                    ? `${toInteger(point.profiles_count)} / ${toInteger(
                      point.n_profiles
                    )}`
                    : toInteger(point.n_profiles)}{' '}
                  {hoveredTableRow === index && (
                    <ChevronCompactRight
                      size={25}
                      title='view dataset details'
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table> */}
    </div>
  )
}
