import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import MapGL from 'react-map-gl';
import createMap from './Map/Map.jsx'
import './styles.css'

export default function ReactD3Viz () {
  createMap() // creates map and uses the id='map' div to render the map
  return (
    <div></div>
  );
}

// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#reactchart')
ReactDOM.render(<ReactD3Viz />, domContainer)
