import {Map, NavigationControl} from 'maplibre-gl'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'

export default function createMap() {
  const mapTilerKey = "8qh5kEULltP5TFa7eZYO"// created at https://cloud.maptiler.com/account/keys/
  const map = new Map({
    container: "map",
    style: `https://api.maptiler.com/maps/hybrid/style.json?key=${mapTilerKey}`,
    center: [-100, 49],
    zoom: 3
  })
  const drawPolygon = new MapboxDraw()
  map.addControl(drawPolygon, 'top-left')
  map.addControl(new NavigationControl(), 'bottom-left');
}