import bytes from "bytes";
import isEmpty from "lodash-es/isEmpty";
import { scaleLinear, scaleLog } from "d3-scale";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { defaultQuery } from "./components/config.js";

export function setAllOptionsIsSelectedTo(isSelected, options, setOptions) {
  setOptions(
    options.map((option) => {
      return {
        ...option,
        isSelected,
        isExcluded: false,
      };
    }),
  );
}

// A whole EOV category at once, like SourceFilter's OBIS group: a mixed
// category goes to all-included (or all-excluded) first.
export const withCategoryState = (options, category, state) =>
  options.map((opt) =>
    opt.category === category ? { ...opt, ...state } : opt,
  );

// Include and exclude are mutually exclusive; `isSelected` means "included".
export const toggleOptionIncluded = (option) => ({
  ...option,
  isSelected: !option.isSelected,
  isExcluded: false,
});

export const toggleOptionExcluded = (option) => ({
  ...option,
  isSelected: false,
  isExcluded: !option.isExcluded,
});

// Sizes come from /downloadEstimate, never a measured file, so every figure
// carries its own tilde. A null size (no estimate, e.g. OBIS) is a dash, not 0.
export function formatSizeEstimate(size) {
  return Number.isFinite(size) ? `~${bytes(size)}` : "—";
}

// Sums sizes, leaving out the ones with no estimate and flagging that it did,
// so a total never passes an undercount off as the whole selection.
export function sumSizeEstimates(sizes) {
  const known = sizes.filter(Number.isFinite);
  return {
    size: known.length ? known.reduce((total, size) => total + size, 0) : null,
    partial: known.length > 0 && known.length < sizes.length,
  };
}

export function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Takes the caller's `t`: it looks up several keys and can't call
// useTranslation outside a component.
export function generateMultipleSelectBadgeTitle(
  t,
  badgeTitle,
  optionsSelected,
) {
  if (optionsSelected) {
    const optionsSelectedFiltered = optionsSelected.filter(
      (option) => option.isSelected || option.isExcluded,
    );
    if (optionsSelectedFiltered.length === 0) {
      return t(badgeTitle);
    } else if (optionsSelectedFiltered.length === 1) {
      const [option] = optionsSelectedFiltered;
      const title = capitalizeFirstLetter(t(option.title));
      return option.isExcluded ? t("filterExcludedOption", { title }) : title;
    } else {
      const mapping = {
        oceanVariablesFiltername: "oceanVariablesMulti",
        platformsFilterName: "platformsMulti",
        organizationFilterName: "organizationMulti",
        datasetTitleFilterName: "datasetsMulti",
      };
      return optionsSelectedFiltered.length + t(mapping[badgeTitle]);
    }
  }
}

export function generateRangeSelectBadgeTitle(
  badgeTitle,
  optionsSelected,
  defaults,
  units,
) {
  return optionsSelected[0] === defaults[0] &&
    optionsSelected[1] === defaults[1]
    ? badgeTitle
    : `${optionsSelected[0]} – ${optionsSelected[1]}` +
        (!isEmpty(units) ? " " + units : "");
}

export function abbreviateString(text, maxLength) {
  if (text) {
    if (text.length > maxLength) {
      return `${text.slice(0, maxLength)}...`;
    } else {
      return text;
    }
  }
}

// For strings interpolated into popup.setHTML() markup: dataset titles and
// trajectory ids come from harvested (third-party) metadata, so anything
// markup-significant must be neutralized before it reaches the DOM.
export function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function validateEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

function objectToURL(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => k && v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export function createDataFilterQueryString(query) {
  const {
    orgsSelected,
    eovsSelected,
    platformsSelected,
    datasetsSelected,
    scientificNamesSelected,
    scientificNamesExcluded,
    obisNodesSelected,
    erddapServersSelected,
    realtimeOnly,
    searchText,
    searchIn,
    eovsMatchAll,
    orgsMatchAll,
    scientificNamesMatchAll,
  } = query;

  const queryWithoutDefaults = Object.keys(defaultQuery).reduce(
    (accumulatorObject, field) => {
      if (query[field] !== defaultQuery[field]) {
        accumulatorObject[field] = query[field];
      }
      return accumulatorObject;
    },
    {},
  );
  let platforms, datasetPKs, orgPKs;

  const eovs = eovsSelected
    .filter((eov) => eov.isSelected)
    .map((eov) => eov.title)
    .join();
  // With a single include "all" and "any" are the same selection, so the param
  // is left off rather than giving one selection two URLs and two cache keys.
  const matchParam = (matchAll, includedCount) =>
    matchAll && includedCount > 1 ? "all" : "";
  const eovsMatch = matchParam(
    eovsMatchAll,
    eovsSelected.filter((eov) => eov.isSelected).length,
  );
  const organizationsMatch = matchParam(
    orgsMatchAll,
    orgsSelected.filter((org) => org.isSelected).length,
  );
  const scientificNamesMatch = matchParam(
    scientificNamesMatchAll,
    scientificNamesSelected?.length ?? 0,
  );

  const excludedList = (options, value) =>
    (options || [])
      .filter((option) => option.isExcluded)
      .map(value)
      .join(",");

  if (platformsSelected.every((e) => e.isSelected)) {
    platforms = "";
  } else {
    platforms = platformsSelected
      .filter((platform) => platform.isSelected)
      .map((platform) => platform.title)
      .join();
  }

  if (datasetsSelected.every((e) => e.isSelected)) {
    datasetPKs = "";
  } else {
    datasetPKs = datasetsSelected
      .filter((dataset) => dataset.isSelected)
      .map((dataset) => dataset.pk)
      .join();
  }

  // Every org ticked only means "no filter" when any one of them will do.
  if (!organizationsMatch && orgsSelected.every((e) => e.isSelected)) {
    orgPKs = "";
  } else {
    orgPKs = orgsSelected
      .filter((org) => org.isSelected)
      .map((org) => org.pk)
      .join();
  }
  const { startDepth, endDepth, startDate, endDate } = queryWithoutDefaults;

  const namesList = (names) => (names || []).map(encodeURIComponent).join(",");
  const scientificNames = namesList(scientificNamesSelected);

  // Node names are sent whenever any node is picked (even all of them): their
  // presence tells the API to keep OBIS rows while servers are also filtered,
  // and to hide ERDDAP profiles when no servers are selected.
  const selectedServers = (erddapServersSelected || []).filter(
    (s) => s.isSelected,
  );
  const selectedNodes = (obisNodesSelected || []).filter((n) => n.isSelected);
  const allServersSelected =
    erddapServersSelected?.length > 0 &&
    selectedServers.length === erddapServersSelected.length;
  const allNodesSelected =
    obisNodesSelected?.length > 0 &&
    selectedNodes.length === obisNodesSelected.length;

  let erddapServers = "";
  let obisNodes = "";
  let includeObis = "";
  const sourceFilterActive =
    (selectedServers.length > 0 || selectedNodes.length > 0) &&
    !(allServersSelected && allNodesSelected);
  if (sourceFilterActive) {
    if (selectedNodes.length > 0) {
      obisNodes = selectedNodes
        .map((n) => encodeURIComponent(n.title))
        .join(",");
      if (selectedServers.length > 0) {
        erddapServers = selectedServers.map((s) => s.url).join();
      }
    } else {
      includeObis = "false";
      if (!allServersSelected) {
        erddapServers = selectedServers.map((s) => s.url).join();
      }
    }
  }

  const apiMappedQuery = {
    eovs,
    eovsMatch,
    excludeEovs: excludedList(eovsSelected, (e) => e.title),
    platforms,
    excludePlatforms: excludedList(platformsSelected, (p) => p.title),
    datasetPKs,
    excludeDatasetPKs: excludedList(datasetsSelected, (d) => d.pk),
    organizations: orgPKs,
    organizationsMatch,
    excludeOrganizations: excludedList(orgsSelected, (o) => o.pk),
    erddapServers,
    excludeErddapServers: excludedList(erddapServersSelected, (s) => s.url),
    excludeObisNodes: excludedList(obisNodesSelected, (n) =>
      encodeURIComponent(n.title),
    ),
    timeMin: startDate,
    timeMax: endDate,
    depthMin: startDepth,
    depthMax: endDepth,
    includeObis,
    scientificNames,
    scientificNamesMatch,
    excludeScientificNames: namesList(scientificNamesExcluded),
    obisNodes,
    // objectToURL drops "", so the default leaves the URL and cache key untouched.
    realtimeOnly: realtimeOnly ? "true" : "",
    search: searchText ? encodeURIComponent(searchText) : "",
    // "titles" is the API's default, so only the wider scope is written.
    searchIn: searchText && searchIn === "all" ? "all" : "",
  };

  return objectToURL(apiMappedQuery);
}

// How many times bigger the max has to be than the min before the ramp goes
// log instead of linear.
const LOG_SCALE_MIN_RATIO = 100;

export function generateColorStops(colorScale, range) {
  // Absent while /legend is in flight, [null, null] when filters match nothing.
  if (!range || !Number.isFinite(range[1]) || range[1] <= 0) return [];
  let colors;
  let scale;
  // scaleLog can't take 0; safe because a surviving hex counts at least 1.
  const lo = Math.max(Number.isFinite(range[0]) ? range[0] : 1, 1);
  const hi = range[1];
  if (hi / lo >= LOG_SCALE_MIN_RATIO) {
    // Counts span 5-8 orders of magnitude; linear spacing would paint nearly
    // every hex the lightest shade. Built value -> index and inverted because a
    // log domain of [0, n-1] is illegal.
    colors = colorScale;
    const logScale = scaleLog()
      .domain([lo, hi])
      .range([0, colors.length - 1]);
    scale = (index) => logScale.invert(index);
  } else {
    // Fewer values than colors: sample across the whole ramp, not a prefix,
    // or a 1..3 range would sit entirely in the pale end and read as nothing.
    // A one-value range takes the middle of the ramp.
    const span = Math.floor(hi) - Math.floor(lo) + 1;
    colors =
      span < colorScale.length
        ? Array.from(
            { length: span },
            (_, i) =>
              colorScale[
                Math.round(
                  (span === 1 ? 0.5 : i / (span - 1)) * (colorScale.length - 1),
                )
              ],
          )
        : colorScale;
    scale = scaleLinear()
      .domain([0, colors.length - 1])
      .range([lo, hi]);
  }
  const colorStops = colors.map((color, index) => {
    return {
      // Not floored: log invert() lands a hair under the max (499.999... for 500).
      stop: index === colors.length - 1 ? hi : Math.floor(scale(index)),
      color,
    };
  });
  const result = [];
  const map = new Map();
  colorStops.forEach((colorStop) => {
    if (!map.has(colorStop.stop)) {
      map.set(colorStop.stop, true);
      result.push(colorStop);
    }
  });
  return result;
}

export function formatDatasetCount(filtered, total, locale) {
  const format = (n) => n.toLocaleString(locale);
  if (!total || filtered === total) return format(total || filtered);
  return `${format(filtered)} / ${format(total)}`;
}

// Both APIs send UTC, and a record's time is when it was taken at sea, not the
// reader's wall clock, so there is deliberately no local-time conversion.
export function formatInstantRange(min, max) {
  const from = splitInstant(min);
  const to = splitInstant(max);
  if (!from) return formatInstant(max);
  if (!to || (from.day === to.day && from.time === to.time)) {
    return formatInstant(min);
  }
  if (from.day === to.day) return `${from.day} ${from.time} → ${to.time}Z`;
  return `${from.day} ${from.time}Z → ${to.day} ${to.time}Z`;
}

export function formatInstant(value) {
  const at = splitInstant(value);
  return at ? `${at.day} ${at.time}Z` : undefined;
}

// ISO string from JSON, or epoch ms from a vector tile (MVT has no timestamp type).
function splitInstant(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const iso =
    typeof value === "number" ? new Date(value).toISOString() : String(value);
  const [day, rest] = iso.split("T");
  return { day, time: (rest || "00:00").slice(0, 5) };
}

export function formatRange(min, max, unit = "") {
  const suffix = unit ? ` ${unit}` : "";
  if (min === null || min === undefined) {
    return max === null || max === undefined ? undefined : `${max}${suffix}`;
  }
  if (max === null || max === undefined || String(min) === String(max)) {
    return `${min}${suffix}`;
  }
  return `${min} – ${max}${suffix}`;
}

export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

// Typed text stays local and is published to app state on `trigger`:
// "pause" after `delay` (cheap in-memory option lists, typeaheads), or "submit"
// on submit() only — for the dataset search, where each published value costs a
// round of tile/legend/coverage requests and a pause would spend one on
// "temperat". Either way, emptying publishes at once and unpublished text is
// published on unmount, so nothing typed is lost.
export function useSearchInput(
  value,
  onChange,
  { trigger = "pause", delay = 300 } = {},
) {
  const [text, setText] = useState(value);
  // State, not a ref: read during render to tell our own value coming back
  // from an outside change.
  const [published, setPublished] = useState(value);
  const timer = useRef(undefined);
  // Layout effect: refs must not be written during render, and a passive
  // effect can still be pending when a timer armed before it fires.
  const latest = useRef({ text, published, onChange });
  useLayoutEffect(() => {
    latest.current = { text, published, onChange };
  });

  // Outside changes (Reset, chip removed, share link) replace the box, mirrored
  // during render so it never paints a frame of the dropped text.
  if (useChanged(value) && value !== published) {
    setPublished(value);
    setText(value);
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const { text: typed, published: sent, onChange: send } = latest.current;
      if (typed !== sent) send(typed);
    },
    [],
  );

  function publish(next) {
    setPublished(next);
    latest.current.onChange(next);
  }

  function change(next) {
    setText(next);
    clearTimeout(timer.current);
    if (next === "") {
      publish(next);
      return;
    }
    if (trigger !== "pause") return;
    timer.current = setTimeout(() => {
      // An outside value adopted since then must not be undone.
      if (latest.current.text === next) publish(next);
    }, delay);
  }

  function submit() {
    clearTimeout(timer.current);
    if (text !== published) publish(text);
  }

  return [text, change, submit];
}

// An unknown zoom (camera not reported yet) takes the widest tier: undefined
// would read as "no data". The 4 must match FINE_TIER_MIN_ZOOM in
// web-api/utils/hexTiers.js.
export function getCurrentRangeLevel(rangeLevels, zoom) {
  if (!rangeLevels) return undefined;
  const level = Number(zoom);
  if (!Number.isFinite(level) || level < 4) return rangeLevels.zoom0;
  if (level < 7) return rangeLevels.zoom1;
  return rangeLevels.zoom2;
}

// Coarse enough that an ordinary pan stays on the same rung; an unquantized
// viewport domain would repaint the ramp and legend on every drag.
const NICE_MANTISSAS = [1, 1.5, 2, 3, 5, 7, 10];

// Snaps outward only, so quantizing never clips a hex out of the ramp.
function snapCount(value, direction) {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const base = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / base;
  // Float slack: the log10/pow round trip turns 100 into 99.999... (-> 150).
  const rung =
    direction === "up"
      ? NICE_MANTISSAS.find((m) => m >= mantissa - 1e-9)
      : [...NICE_MANTISSAS].reverse().find((m) => m <= mantissa + 1e-9);
  return Math.max(1, Math.round(rung * base));
}

// undefined means "use the global domain instead".
export function quantizeCountRange(range) {
  if (!Array.isArray(range)) return undefined;
  const hi = snapCount(range[1], "up");
  if (!hi) return undefined;
  const lo = snapCount(Math.max(Number(range[0]) || 1, 1), "down") || 1;
  return [Math.min(lo, hi), hi];
}

export function rangesEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a[0] === b[0] && a[1] === b[1];
}

// The API answers a query that matched nothing with [null, null].
export function rangeLevelHasData(rangeLevel) {
  return Array.isArray(rangeLevel) && Number.isFinite(rangeLevel[1]);
}

export function boundsFromGeoJson(geometry) {
  const positions = [];
  const collect = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") {
      positions.push(coordinates);
      return;
    }
    coordinates.forEach(collect);
  };
  collect(geometry?.coordinates);
  if (!positions.length) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of positions) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}

// Antimeridian-crossing extents aren't special-cased (nor is the rest of the
// bbox code).
export function boundsIntersect(a, b) {
  if (!a || !b) return false;
  const [[aw, as], [ae, an]] = a;
  const [[bw, bs], [be, bn]] = b;
  return aw <= be && ae >= bw && as <= bn && an >= bs;
}

// Shared with ZoomToDataset's already-framed check, which only agrees if the
// padding matches.
const ZOOM_TO_DATASET_BASE_PADDING = 60;

export function zoomToDatasetCamera(map) {
  const cover = mapCoverPadding(map);
  return {
    padding: {
      top: cover.top + ZOOM_TO_DATASET_BASE_PADDING,
      right: cover.right + ZOOM_TO_DATASET_BASE_PADDING,
      bottom: cover.bottom + ZOOM_TO_DATASET_BASE_PADDING,
      left: cover.left + ZOOM_TO_DATASET_BASE_PADDING,
    },
    maxZoom: 9,
  };
}

// Region outlines can be a few hundred metres across, far past the
// dataset framing's zoom cap.
export const AREA_CAMERA = { maxZoom: 14 };

export function boundsAreFramed(map, bounds) {
  if (!map || !bounds) return false;
  const camera = map.cameraForBounds(bounds, zoomToDatasetCamera(map));
  if (!camera) return false;
  if (Math.abs(map.getZoom() - camera.zoom) > 0.2) return false;
  const offset = map.project(camera.center).dist(map.project(map.getCenter()));
  return offset < 40;
}

// Ignores transforms, so a panel still sliding in reads where it will rest.
export function layoutRect(element) {
  let left = 0;
  let top = 0;
  for (let el = element; el; el = el.offsetParent) {
    left += el.offsetLeft;
    top += el.offsetTop;
  }
  return {
    left,
    top,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
  };
}

// Each panel claims whichever canvas edge costs the least free area.
export function coverPadding(canvas, covers) {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  const padding = { top: 0, right: 0, bottom: 0, left: 0 };
  covers.forEach((rect) => {
    const left = Math.max(0, rect.left - canvas.left);
    const top = Math.max(0, rect.top - canvas.top);
    const right = Math.min(width, rect.right - canvas.left);
    const bottom = Math.min(height, rect.bottom - canvas.top);
    if (right <= left || bottom <= top) return;
    const [side, inset] = [
      ["left", right, right * height],
      ["right", width - left, (width - left) * height],
      ["top", bottom, bottom * width],
      ["bottom", height - top, (height - top) * width],
    ].sort((a, b) => a[2] - b[2])[0];
    padding[side] = Math.max(padding[side], inset);
  });
  return padding;
}

const MIN_FREE_MAP_SIZE = 120;

// None when too little map is left to frame anything (phone full-screen sidebar).
export function mapCoverPadding(map) {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!map) return none;
  const canvas = map.getCanvas().getBoundingClientRect();
  const padding = coverPadding(
    canvas,
    [...document.querySelectorAll("[data-map-cover]")].map(layoutRect),
  );
  const freeWidth = canvas.width - padding.left - padding.right;
  const freeHeight = canvas.height - padding.top - padding.bottom;
  return freeWidth < MIN_FREE_MAP_SIZE || freeHeight < MIN_FREE_MAP_SIZE
    ? none
    : padding;
}

export function revealOffset(box, free, margin) {
  const shift = (lo, hi, freeLo, freeHi) => {
    if (hi - lo > freeHi - freeLo - 2 * margin) return null;
    if (lo < freeLo + margin) return lo - freeLo - margin;
    if (hi > freeHi - margin) return hi - freeHi + margin;
    return 0;
  };
  const dx = shift(box.left, box.right, free.left, free.right);
  const dy = shift(box.top, box.bottom, free.top, free.bottom);
  return dx === null || dy === null ? null : [dx, dy];
}

const unique = (arr) => [...new Set(arr)];

export function polygonIsRectangle(polygon) {
  if (polygon.length !== 5) return false;
  const p = polygon.slice(0, 4);

  const lons = unique(p.map((e) => e[0]));
  const lats = unique(p.map((e) => e[1]));

  return lons.length === 2 && lats.length === 2;
}

export function polygonBounds(polygon) {
  const lons = polygon.map((e) => e[0]);
  const lats = polygon.map((e) => e[1]);

  return {
    west: Math.min(...lons),
    south: Math.min(...lats),
    east: Math.max(...lons),
    north: Math.max(...lats),
  };
}

function polygonToMaxMins(polygon) {
  const { west, south, east, north } = polygonBounds(polygon);

  return {
    latMin: south.toFixed(4),
    lonMin: west.toFixed(4),
    latMax: north.toFixed(4),
    lonMax: east.toFixed(4),
  };
}

// The ring is already closed everywhere it's produced (turf, mapbox-gl-draw,
// selectionFromSearchParams).
export function polygonToWkt(polygon) {
  const ring = polygon.map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  return `POLYGON((${ring}))`;
}

export function boundsToPolygon({ west, south, east, north }) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

const onGlobe = ([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

// undefined for a box off the globe, with no area, or across the antimeridian
// (west > east), which the area filter has no way to hold.
export function areaFromBounds(bounds) {
  const { west, south, east, north } = bounds;
  const valid =
    [west, south, east, north].every(Number.isFinite) &&
    west < east &&
    south < north &&
    onGlobe([west, south]) &&
    onGlobe([east, north]);
  return valid ? boundsToPolygon(bounds) : undefined;
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

// Typed or pasted as "west, south, east, north" (the OGC and GeoJSON bbox
// order, with commas or spaces), or as a WKT POLYGON, of which only the outer
// ring is kept. undefined for anything else, or for a shape with no area.
export function parseArea(text) {
  const trimmed = text.trim();
  const parts = trimmed.split(/[\s,;]+/);
  if (parts.length === 4 && parts.every((part) => NUMBER.test(part))) {
    const [west, south, east, north] = parts.map(Number);
    return areaFromBounds({ west, south, east, north });
  }
  const wkt = trimmed.match(/^polygon\s*\(\s*\(([^()]*)\)/i);
  if (!wkt) return undefined;
  const points = wkt[1].split(",").map((point) => point.trim().split(/\s+/));
  if (points.some((p) => p.length < 2 || !p.every((n) => NUMBER.test(n))))
    return undefined;
  const ring = points.map(([lon, lat]) => [Number(lon), Number(lat)]);
  if (String(ring[0]) !== String(ring.at(-1))) ring.push([...ring[0]]);
  const corners = new Set(ring.map(String)).size;
  return corners >= 3 && ring.every(onGlobe) ? ring : undefined;
}

export function createSelectionQueryString(polygon) {
  if (polygonIsRectangle(polygon)) {
    const res = polygonToMaxMins(polygon);

    return objectToURL(res);
  }
  return "polygon=" + JSON.stringify(polygon);
}

export function selectionFromSearchParams(searchParams) {
  const polygon = searchParams.get("polygon");
  if (polygon) {
    try {
      const ring = JSON.parse(polygon);
      if (Array.isArray(ring) && ring.length >= 4) return ring;
    } catch (error) {
      console.warn("ignoring unparseable polygon in url:", error);
    }
    return undefined;
  }

  const bounds = ["latMin", "lonMin", "latMax", "lonMax"].map((key) =>
    Number.parseFloat(searchParams.get(key)),
  );
  if (bounds.some((value) => Number.isNaN(value))) return undefined;
  const [latMin, lonMin, latMax, lonMax] = bounds;
  return boundsToPolygon({
    west: lonMin,
    south: latMin,
    east: lonMax,
    north: latMax,
  });
}

// No dataset has pk 0; an empty datasetPKs would mean "no filter" instead.
const NO_DATASETS_PK = "0";

// `allDatasetPKs` (the set narrowed FROM) keeps the URL under the request-line
// limit: naming over ~2000 pks is a 431, so a narrowing that drops few is sent
// as excludeDatasetPKs instead.
export function applyDatasetPKs(queryString, datasetPKs, allDatasetPKs) {
  if (!datasetPKs) return queryString;
  const params = new URLSearchParams(queryString);
  const kept = new Set(datasetPKs);
  const dropped = (allDatasetPKs || []).filter((pk) => !kept.has(pk));
  if (allDatasetPKs && dropped.length < datasetPKs.length) {
    // Merge with the Datasets filter's own exclusions; nothing dropped sends no
    // param at all.
    const alreadyExcluded = params.get("excludeDatasetPKs")?.split(",") ?? [];
    const excluded = [...new Set([...alreadyExcluded, ...dropped.map(String)])];
    if (excluded.length > 0)
      params.set("excludeDatasetPKs", excluded.join(","));
  } else {
    params.set(
      "datasetPKs",
      datasetPKs.length > 0 ? datasetPKs.join(",") : NO_DATASETS_PK,
    );
  }
  return params.toString();
}

export function filterObjectPropertyByPropertyList(
  objectToFilter,
  allowedProperties,
) {
  const result = Object.keys(objectToFilter)
    .filter((key) => allowedProperties.includes(key))
    .reduce((obj, key) => {
      obj[key] = objectToFilter[key];
      return obj;
    }, {});
  return result;
}

// React's "adjusting state when an input changes" pattern: true on the render
// where any value changed (by identity). Mirroring during render rather than in
// an effect avoids painting one frame of the stale copy.
export function useChanged(...values) {
  const [previous, setPrevious] = useState(values);
  if (
    previous.length === values.length &&
    values.every((value, i) => value === previous[i])
  ) {
    return false;
  }
  setPrevious(values);
  return true;
}

// https://stackoverflow.com/questions/32553158/detect-click-outside-react-component
export function useOutsideAlerter(ref, callback, value) {
  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback(value);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, callback, value]);
}

export function getCookieValue(cookieName) {
  if (document.cookie.includes(cookieName)) {
    return document.cookie
      .split("; ")
      .find((row) => row.startsWith(cookieName + "="))
      .split("=")[1];
  }
}

export function formatErddapServerName(url, lang = "en", serversData = null) {
  if (!url) return "";

  if (serversData && Array.isArray(serversData)) {
    const server = serversData.find((s) => s.url === url);
    if (server) {
      return lang === "fr" ? server.label_fr : server.label_en;
    }
  }

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    const match = url.match(/:\/\/([^/]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return url;
  }
}
// A dataset link is `?dataset=<dataset_id>&server=<server-slug>`, both from the
// source rather than our pk, so it survives a re-harvest; dataset_id is only
// unique within one server.

// Matches slugify() in web-api/routes/harvest.js. OBIS's sentinel erddap_url
// https://obis.org slugs to 'obis-org'.
export function erddapServerSlug(url) {
  if (!url) return "";
  return url
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/[./]/g, "-");
}

export function datasetUrlKey(row) {
  if (!row?.dataset_id) return undefined;
  return {
    dataset: row.dataset_id,
    server: erddapServerSlug(row.erddap_server_url || row.erddap_url),
  };
}

// Links shared before the server slug existed carry `dataset` alone.
export function datasetMatchesUrlKey(row, searchParams) {
  const dataset = searchParams.get("dataset");
  if (!dataset || row?.dataset_id !== dataset) return false;
  const server = searchParams.get("server");
  if (!server) return true;
  return datasetUrlKey(row)?.server === server;
}

export function splitLines(s) {
  const split = s.split(" ");
  return (
    <span>
      {split[0]}
      <br />
      {split.slice(1).join(" ")}
    </span>
  );
}

export function splitAtAntimeridian(coords) {
  if (!coords || coords.length === 0) return [];
  const runs = [[coords[0]]];
  for (let i = 1; i < coords.length; i++) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      runs.push([coords[i]]);
    } else {
      runs[runs.length - 1].push(coords[i]);
    }
  }
  return runs;
}

// Mirrors the segs CTE in web-api /tiles/tracks; keep the two in sync. Breaks at:
//   1. antimeridian crossings;
//   2. gaps over 4x the MEDIAN inter-fix gap (a mean lets idle periods draw
//      between-cruise chords), floored at 48h so Argo cycles never split;
//   3. >50km chords under 96h: the harvester densifies real chords to <=25km,
//      so these are reporting outages; the 96h guard spares slow Argo drifts.
export function splitTrackRuns(coords, times) {
  if (!coords || coords.length === 0) return [];
  if (!times || times.length !== coords.length || coords.length < 2) {
    return splitAtAntimeridian(coords);
  }
  const ms = times.map((t) => new Date(t).getTime());
  const sortedGaps = ms
    .slice(1)
    .map((t, i) => t - ms[i])
    .sort((a, b) => a - b);
  const medianGapMs = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const gapMs = Math.max(medianGapMs * 4, 48 * 3600 * 1000);

  const chordKm = (a, b) => {
    const rad = Math.PI / 180;
    const p1 = a[1] * rad;
    const p2 = b[1] * rad;
    const h =
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  const runs = [[coords[0]]];
  for (let i = 1; i < coords.length; i++) {
    const dtMs = ms[i] - ms[i - 1];
    if (
      Math.abs(coords[i][0] - coords[i - 1][0]) > 180 ||
      dtMs > gapMs ||
      (chordKm(coords[i - 1], coords[i]) > 50 && dtMs < 96 * 3600 * 1000)
    ) {
      runs.push([coords[i]]);
    } else {
      runs[runs.length - 1].push(coords[i]);
    }
  }
  return runs;
}

// Degrees clockwise from north, [0, 360); twin of the ST_Azimuth cog in
// /tiles/tracks.
export function initialBearing(a, b) {
  if (a[0] === b[0] && a[1] === b[1]) return null;
  const rad = Math.PI / 180;
  const p1 = a[1] * rad;
  const p2 = b[1] * rad;
  const dl = (b[0] - a[0]) * rad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

// Non-hex colours pass through untouched: an unparseable colour throws out of
// setPaintProperty and aborts the rest of the paint pass.
export function withAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const int = parseInt(match[1], 16);
  const a = Math.round(alpha * 1000) / 1000;
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${a})`;
}
