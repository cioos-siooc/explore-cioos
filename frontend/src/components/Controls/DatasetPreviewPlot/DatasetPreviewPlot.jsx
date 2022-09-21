import React from 'react'
import Plot from 'react-plotly.js'
import './styles.css'

export default function DatasetPreviewPlot({
  datasetPreview,
  plotXAxis,
  plotYAxis
}) {
  return (
    <div className='datasetPreviewPlot'>
      <>
        {plotXAxis !== undefined && plotYAxis !== undefined && datasetPreview && (
          <Plot
            data={[
              {
                x:
                  [
                    ...datasetPreview?.table?.rows.map((row) => {
                      return row[plotXAxis.index]
                    })
                  ] || [],
                y:
                  [
                    ...datasetPreview?.table?.rows.map((row) => {
                      return row[plotYAxis.index]
                    })
                  ] || [],
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
              // title: title
            }}
            config={{
              responsive: true
            }}
          />
        )}
      </>
    </div>
  )
}
