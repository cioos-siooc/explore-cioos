import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import MapGL from 'react-map-gl';
import createMap from './Map/Map.js'
import Controls from './Controls/Controls.jsx'
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css'

export default function App () {
  createMap() // creates map and uses the id='map' div to render the map
  return (
    <Controls/>
  );
}

// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(<App />, domContainer)
