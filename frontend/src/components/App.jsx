import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import MapGL from 'react-map-gl';

export default function ReactD3Viz () {
  const [viewport, setViewport] = useState({
    latitude: 37.8,
    longitude: -122.4,
    zoom: 14,
    bearing: 0,
    pitch: 0
  });

  return (
    <MapGL
      {...viewport}
      width="100vw"
      height="100vh"
      mapStyle="mapbox://styles/mapbox/dark-v9"
      onViewportChange={setViewport}
      mapboxApiAccessToken={'pk.eyJ1Ijoiam9yaW5oYWthaSIsImEiOiJjazlhdWF1cmEwOXRzM2ZxeHN2Ymozd3NrIn0.eUILV3NQqvV8XD_EfiNpuA'}
    />
  );
}

// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#reactchart')
ReactDOM.render(<ReactD3Viz />, domContainer)
