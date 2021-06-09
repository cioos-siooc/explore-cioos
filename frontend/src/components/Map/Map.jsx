import {Map, GeolocateControl} from 'maplibre-gl'

export default function createMap() {
  const mapTilerKey = "8qh5kEULltP5TFa7eZYO"// created at https://cloud.maptiler.com/account/keys/
  const map = new Map({
    container: "map",
    style: `https://api.maptiler.com/maps/hybrid/style.json?key=${mapTilerKey}`,
    center: [1, 15],
    zoom: 3
  })

  map.addControl(
    new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true
      },
    })
  )
}