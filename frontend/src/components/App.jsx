import React, { useState } from 'react'
import ReactDOM from 'react-dom'

export default function ReactD3Viz () {
  return (
    // Where we bring together imported components such as a the <ReactD3Chart/>, <Legend/>, <Controls/>
    <div>
      React Content Here
      <div>tests</div>
    </div>
  )
}

// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#reactchart')
ReactDOM.render(<ReactD3Viz />, domContainer)
