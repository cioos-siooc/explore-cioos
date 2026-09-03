// Stand-in for maplibre-gl in jsdom (aliased in vite.config.mjs's test block).
//
// The library needs a WebGL canvas at import time, which jsdom has no
// implementation for. Only three modules reach for it — Map.jsx,
// DatasetPreviewPlot.jsx and LegendFooter.jsx — and the first two are e2e
// territory. LegendFooter only ever constructs these two controls to read the
// attribution/scale markup out of them, so inert classes are enough for the
// Legend to render in a component test.

class NoopControl {
  constructor (options = {}) {
    this.options = options
  }

  onAdd () {
    return document.createElement('div')
  }

  onRemove () {}
}

export class AttributionControl extends NoopControl {}
export class ScaleControl extends NoopControl {}
export class NavigationControl extends NoopControl {}
export class Marker extends NoopControl {
  setLngLat () {
    return this
  }

  addTo () {
    return this
  }

  remove () {
    return this
  }
}

export class LngLatBounds {
  constructor (sw, ne) {
    this._sw = sw
    this._ne = ne
  }

  extend () {
    return this
  }

  getSouthWest () {
    return this._sw
  }

  getNorthEast () {
    return this._ne
  }
}

// A map instance that accepts every call the app makes and reports nothing as
// loaded. A component test that needs real map behaviour is in the wrong suite.
export class Map {
  constructor (options = {}) {
    this.options = options
  }

  on () {
    return this
  }

  off () {
    return this
  }

  once () {
    return this
  }

  addControl () {
    return this
  }

  removeControl () {
    return this
  }

  getSource () {}
  getLayer () {}
  setPaintProperty () {}
  setLayoutProperty () {}
  setFilter () {}
  queryRenderedFeatures () {
    return []
  }

  getZoom () {
    return 0
  }

  getBounds () {
    return new LngLatBounds([0, 0], [0, 0])
  }

  loaded () {
    return false
  }

  remove () {}
}

export default { Map, Marker, LngLatBounds, AttributionControl, ScaleControl, NavigationControl }
