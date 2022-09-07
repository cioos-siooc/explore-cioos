import React from 'react'
import Plot from 'react-plotly.js'
import { Dropdown, DropdownButton } from 'react-bootstrap'
import './styles.css'

export default function DatasetPreviewPlot({ datasetPreview, plotXAxis, setPlotXAxis, plotYAxis, setPlotYAxis }) {
  return (
    <div className='datasetPreviewPlot'>
      {datasetPreview
        ?
        <>
          {/* <DropdownButton title={(plotXAxis && `X axis: ` + plotXAxis.columnName) || 'Select X axis variable'}>
            {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
              return <Dropdown.Item key={index} onClick={() => setPlotXAxis({ index, columnName })}>{columnName}</Dropdown.Item>
            })}
          </DropdownButton>
          <DropdownButton title={(plotYAxis && `Y Axis: ` + plotYAxis.columnName) || 'Select Y axis variable'}>
            {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
              return <Dropdown.Item key={index} onClick={() => setPlotYAxis({ index, columnName })}>{columnName}</Dropdown.Item>
            })}
          </DropdownButton> */}
          {/* <DropdownButton title={(plotType && `PlotType: ` + plotYAxis.columnName) || 'Select plot type'}>
      Add plot types that will work with the kind of data we are working with
          {plotlyPlotTypes.map((plotType, index) => {
            return <Dropdown.Item key={index} onClick={() => setPlotType({ index, plotType })}>{plotType}</Dropdown.Item>
          })}
      </DropdownButton> */}
          {plotXAxis !== undefined && plotYAxis !== undefined && datasetPreview &&
            < Plot
              data={[
                {
                  x: [...datasetPreview?.table?.rows.map((row) => {
                    return row[plotXAxis.index]
                  })] || [],
                  y: [...datasetPreview?.table?.rows.map((row) => {
                    return row[plotYAxis.index]
                  })] || [],
                  type: 'scatter',
                  mode: 'markers'
                }
              ]}
              layout={{
                autosize: false,
                margin: { l: 0, t: 50, r: 0, b: 50 },
                yaxis: {
                  automargin: true
                },
                xaxis: {
                  automargin: true
                }
              }}
              config={{
                responsive: true
              }}
            />
          }
        </>
        :
        <div>Please select a record to view data</div>
      }
    </div>
  )
}
