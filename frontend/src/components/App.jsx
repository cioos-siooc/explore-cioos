import React, { useState, useRef } from 'react'
import ReactDOM from 'react-dom'
import Controls from './Controls/Controls.jsx'
import CIOOSMap from './Map/Map.js'
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css'

export default function App () {
  const map = new CIOOSMap()
  return (
    <div style={{maxHeight: '800px'}}>
      <Controls
        map={map}
      />
    </div>
  );
}

// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(<App />, domContainer)
