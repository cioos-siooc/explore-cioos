import React, { useState, useEffect } from 'react'
import { Modal, Dropdown, DropdownButton, Table } from 'react-bootstrap'
import './styles.css'
import Plot from 'react-plotly.js'

export default function DatasetPreviewPlot({
  inspectDataset,
  plotAxes,
  datasetPreview,
  setAxes,
  inspectRecordID,
  data
}) {
  const { title } = inspectDataset
  const isProfile = inspectDataset.cdm_data_type
    .toLowerCase()
    .includes('profile')

  useEffect(() => {
    switch (inspectDataset.cdm_data_type) {
    case 'Profile':
    case 'TimeSeriesProfile':
      setAxes({ x: inspectDataset.first_eov_column, y: 'depth' })
      break
    case 'TimeSeries':
      setAxes({ x: 'time', y: inspectDataset.first_eov_column })
      break

    default:
      break
    }
  }, [inspectRecordID])

  return (
    <>
      <DropdownButton
        title={plotAxes.x ? 'X axis: ' + plotAxes.x : 'Select X axis variable'}
      >
        {datasetPreview &&
          datasetPreview?.table?.columnNames.map((columnName) => {
            return (
              <Dropdown.Item
                key={columnName}
                onClick={() => setAxes({ x: columnName, y: plotAxes.y })}
              >
                {columnName}
              </Dropdown.Item>
            )
          })}
      </DropdownButton>
      <DropdownButton
        title={plotAxes.y ? 'Y Axis: ' + plotAxes.y : 'Select Y axis variable'}
      >
        {datasetPreview &&
          datasetPreview?.table?.columnNames.map((columnName) => {
            return (
              <Dropdown.Item
                key={columnName}
                onClick={() => setAxes({ x: plotAxes.x, y: columnName })}
              >
                {columnName}
              </Dropdown.Item>
            )
          })}
      </DropdownButton>

      <div className='datasetPreviewPlot'>
        <>
          {plotAxes.x !== undefined && plotAxes.y !== undefined && data && (
            <Plot
              data={[
                {
                  x: data.map((row) => row[plotAxes.x]) || [],
                  y: data.map((row) => row[plotAxes.y]) || [],
                  type: 'scatter',
                  mode: 'markers'
                }
              ]}
              layout={{
                autosize: false,
                margin: { l: 0, t: 50, r: 0, b: 50 },
                yaxis: {
                  automargin: true,

                  side: isProfile ? 'top' : undefined,
                  autorange: isProfile ? 'reversed' : undefined
                },
                xaxis: {
                  automargin: true
                }
                // title: title
              }}
              config={{
                responsive: true
              }}
            />
          )}
        </>
      </div>
    </>
  )
}
