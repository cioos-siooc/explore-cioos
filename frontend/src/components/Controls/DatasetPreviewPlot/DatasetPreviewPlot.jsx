import React, { useEffect } from 'react'
import { Dropdown, DropdownButton } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import './styles.css'
import Plot from 'react-plotly.js'

export default function DatasetPreviewPlot({
  inspectDataset,
  plotAxes,
  datasetPreview,
  setPlotAxes,
  inspectRecordID,
  data
}) {
  const { t, i18n } = useTranslation()

  const isProfile = inspectDataset.cdm_data_type
    .toLowerCase()
    .includes('profile')

  useEffect(() => {
    switch (inspectDataset.cdm_data_type) {
      case 'Profile':
      case 'TimeSeriesProfile':
        setPlotAxes({
          x: {
            columnName: inspectDataset.first_eov_column,
            unit: datasetPreview?.table?.columnUnits[datasetPreview?.table?.columnNames.indexOf(inspectDataset.first_eov_column)]
          },
          y: {
            columnName: 'depth',
            unit: 'm'
          }
        })
        break
      case 'TimeSeries':
        setPlotAxes({
          x: {
            columnName: 'time',
            unit: 'UTC'
          },
          y: {
            columnName: inspectDataset.first_eov_column,
            unit: datasetPreview?.table?.columnUnits[datasetPreview?.table?.columnNames.indexOf(inspectDataset.first_eov_column)]
          }
        })
        break

      default:
        break
    }
  }, [inspectRecordID])

  return (
    <>
      <DropdownButton
        title={t('datasetPreviewPlotXAxisSelect') + ': ' + plotAxes.x.columnName}
      >
        {datasetPreview &&
          datasetPreview?.table?.columnNames.map((columnName, index) => {
            console.log(datasetPreview.table)
            return (
              <Dropdown.Item
                key={columnName}
                onClick={() => setPlotAxes({ x: { columnName, unit: datasetPreview.table.columnUnits[index] }, y: plotAxes.y })}
              >
                {columnName}
              </Dropdown.Item>
            )
          })}
      </DropdownButton>
      <DropdownButton
        title={t('datasetPreviewPlotYAxisSelect') + ': ' + plotAxes.y.columnName}
      >
        {datasetPreview &&
          datasetPreview?.table?.columnNames.map((columnName, index) => {
            return (
              <Dropdown.Item
                key={columnName}
                onClick={() => setPlotAxes({ x: plotAxes.x, y: { columnName, unit: datasetPreview.table.columnUnits[index] } })}
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
                  x: data.map((row) => row[plotAxes.x.columnName]) || [],
                  y: data.map((row) => row[plotAxes.y.columnName]) || [],
                  type: 'scatter',
                  mode: 'markers'
                }
              ]}
              layout={{
                uirevision: true,
                autosize: true,
                // dragmode: false,
                yaxis: {
                  automargin: true,
                  side: isProfile ? 'top' : undefined,
                  autorange: isProfile ? 'reversed' : undefined,
                  title: `( ${plotAxes.y.unit} )`,
                  uirevision: true
                },
                xaxis: {
                  automargin: true,
                  title: `( ${plotAxes.x.unit} )`,
                  uirevision: true
                },
                dragmode: 'zoom',
                modebar: {
                  uirevision: true
                }
              }}
              config={{
                displaylogo: false,
                modeBarButtonsToRemove: ['select2d', 'lasso2d', 'resetScale', 'pan2d'],
                responsive: true,
                scrollZoom: true,
                locale: i18n.language === 'fr' ? 'fr' : 'en',
              }}
            />
          )}
        </>
      </div>
    </>
  )
}
