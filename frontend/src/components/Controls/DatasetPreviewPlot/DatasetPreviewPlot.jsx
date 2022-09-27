import React from 'react'
import Plot from 'react-plotly.js'
import './styles.css'

export default function DatasetPreviewPlot({ data, plotAxes, isProfile }) {
  return (
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
  )
}
