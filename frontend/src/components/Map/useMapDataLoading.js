import { useEffect, useRef } from "react";

// Data only: the basemap's own fetches are left to the first-paint splash.
const WATCHED_SOURCE_IDS = [
  "cde-tiles",
  "cde-cells",
  "tracks",
  "selected-track",
  "griddap-coverage",
  "wms-overlay",
];
// Browser-cache hits resolve in a frame or two; announcing them would flash
// the spinner on every wheel notch.
const ANNOUNCE_AFTER_MS = 300;
// Tiles arrive in waves with empty frames between; a gap shorter than this is
// part of the same load.
const SETTLE_MS = 250;

// Reports (setDataLoading) whether data is on the wire. The returned
// setWmsPending covers the WMS GetMap, which is fetched outside MapLibre.
// Must be called after the hook that creates the map.
export default function useMapDataLoading(mapRef, setDataLoading) {
  const wmsPending = useRef(false);
  const sync = useRef(() => {});

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let busySince = null;
    let idleSince = null;
    let announced = false;
    let timer = null;

    // isSourceLoaded throws on an unknown id (absent mid style-change).
    const pending = () =>
      wmsPending.current ||
      WATCHED_SOURCE_IDS.some(
        (id) => map.getSource(id) && !map.isSourceLoaded(id),
      );
    const announce = (value) => {
      if (announced === value) return;
      announced = value;
      setDataLoading(value);
    };

    sync.current = () => {
      const now = Date.now();
      if (pending()) {
        idleSince = null;
        busySince ??= now;
      } else {
        idleSince ??= now;
      }
      clearTimeout(timer);
      if (busySince === null) return;
      if (idleSince !== null && now - idleSince >= SETTLE_MS) {
        busySince = null;
        announce(false);
        return;
      }
      if (idleSince !== null) {
        timer = setTimeout(sync.current, SETTLE_MS - (now - idleSince));
      } else if (now - busySince >= ANNOUNCE_AFTER_MS) {
        announce(true);
      } else {
        timer = setTimeout(sync.current, ANNOUNCE_AFTER_MS - (now - busySince));
      }
    };

    // 'idle' is the backstop, including sources dropped past a layer's minzoom
    // rather than loaded.
    const onSourceEvent = (e) => {
      if (e.dataType === "source" && WATCHED_SOURCE_IDS.includes(e.sourceId)) {
        sync.current();
      }
    };
    const onIdle = () => sync.current();
    map.on("dataloading", onSourceEvent);
    map.on("data", onSourceEvent);
    map.on("idle", onIdle);
    return () => {
      clearTimeout(timer);
      sync.current = () => {};
      map.off("dataloading", onSourceEvent);
      map.off("data", onSourceEvent);
      map.off("idle", onIdle);
      if (announced) setDataLoading(false);
    };
  }, [mapRef, setDataLoading]);

  return (value) => {
    wmsPending.current = value;
    sync.current();
  };
}
