// maplibre-gl needs WebGL at import time, which jsdom lacks. LegendFooter only
// reads markup out of these controls, so inert classes suffice.

class NoopControl {
  constructor(options = {}) {
    this.options = options;
  }

  onAdd() {
    return document.createElement("div");
  }

  onRemove() {}
}

export class AttributionControl extends NoopControl {}
export class ScaleControl extends NoopControl {}
export class NavigationControl extends NoopControl {}
export class Marker extends NoopControl {
  setLngLat() {
    return this;
  }

  addTo() {
    return this;
  }

  remove() {
    return this;
  }
}

export class LngLatBounds {
  constructor(sw, ne) {
    this._sw = sw;
    this._ne = ne;
  }

  extend() {
    return this;
  }

  getSouthWest() {
    return this._sw;
  }

  getNorthEast() {
    return this._ne;
  }
}

// Tests needing real map behaviour belong in e2e.
export class Map {
  constructor(options = {}) {
    this.options = options;
  }

  on() {
    return this;
  }

  off() {
    return this;
  }

  once() {
    return this;
  }

  addControl() {
    return this;
  }

  removeControl() {
    return this;
  }

  getSource() {}
  getLayer() {}
  setPaintProperty() {}
  setLayoutProperty() {}
  setFilter() {}
  queryRenderedFeatures() {
    return [];
  }

  getZoom() {
    return 0;
  }

  getBounds() {
    return new LngLatBounds([0, 0], [0, 0]);
  }

  loaded() {
    return false;
  }

  remove() {}
}

export default {
  Map,
  Marker,
  LngLatBounds,
  AttributionControl,
  ScaleControl,
  NavigationControl,
};
