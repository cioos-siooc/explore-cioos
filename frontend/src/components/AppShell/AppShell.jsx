import * as React from 'react'
import { useTranslation } from 'react-i18next'

import MapContainer from '../Map/MapContainer.jsx'
import FeatureCard from '../Map/FeatureCard/FeatureCard.jsx'
import ApiErrorBanner from './ApiErrorBanner.jsx'
import MapBusy from './MapBusy.jsx'
import Sidebar from './Sidebar/Sidebar.jsx'
import TopControls from './TopControls/TopControls.jsx'
import FiltersModal from './Modals/FiltersModal.jsx'
import DownloadModal from './Modals/DownloadModal.jsx'
import PreviewHost from './Panels/PreviewHost.jsx'
import MapCornerControls from './MapCorner/MapCornerControls.jsx'
import Loading from '../Controls/Loading/Loading.jsx'
import Legend from '../Controls/Legend/Legend.jsx'
import DepthBar from '../Controls/DepthBar/DepthBar.jsx'
import TimeBar from '../Controls/TimeBar/TimeBar.jsx'
import WmsLegend from '../Controls/WmsLegend/WmsLegend.jsx'
import IntroModal from '../Controls/IntroModal/IntroModal.jsx'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useSelection } from '../../state/selection/SelectionProvider.jsx'
import { useUI } from '../../state/ui/UIProvider.jsx'
import './styles.css'

// The map-first shell: full-bleed map with a centered top bar (brand on the
// first layer, the merged Datasets/Filters segmented control on the second,
// active-filter chips beneath), the datasets sidebar on the left (list +
// counts + Download), and the map interaction controls lower-right. Filters
// and Download open as modals.
export default function AppShell () {
  const { t } = useTranslation()
  const {
    loading,
    basemapLoading,
    mapLoaded,
    zoom,
    currentRangeLevel,
    hexRangeLevel,
    hexRangeScaledToView,
    legendLoading,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    bathymetryVisible,
    setBathymetryVisible,
    projection,
    setProjection,
    activeWmsOverlay,
    setActiveWmsOverlay,
    tracksMode,
    toggleTrackLines,
    trailingDays,
    scrubTime,
    dataLayers
  } = useMapState()
  const { startDate, endDate, timeFilterActive } = useFilters()
  const { showIntroModal, setShowIntroModal, sidebarOpen } = useUI()
  const { inspectDataset, platformsAvailable } = useSelection()

  // The griddap legend lives inside the dataset page while that page is open
  // (see GriddapDetails); otherwise it pins itself to the top-left corner of
  // the map, over the datasets column rather than inside it — see its
  // stylesheet for why it overlaps instead of stacking.
  const wmsLegendIsInline =
    sidebarOpen && activeWmsOverlay?.pk === inspectDataset?.pk

  // The switches that ride on the legend entries they key, rather than sitting
  // in the layers list below: each of these turns off exactly what one legend
  // entry describes, so the control belongs on the thing it hides.
  //
  // The track-lines switch is a display choice and nothing more — flipping it
  // never touches the geometry filter, so the datasets list and its counts are
  // unaffected (it used to live inside that filter, where turning it off could
  // narrow the selection).
  const legendControls = {
    observations: {
      key: 'observations',
      label: t('layersObservations'),
      checked: dataLayersVisible,
      onChange: () => setDataLayersVisible(!dataLayersVisible)
    },
    bathymetry: {
      key: 'bathymetry',
      label: t('layersBathymetry'),
      checked: bathymetryVisible,
      onChange: () => setBathymetryVisible(!bathymetryVisible)
    },
    tracks: {
      key: 'tracks',
      label: t('layerTracksMode'),
      checked: tracksMode,
      onChange: toggleTrackLines
    }
  }

  // The switches with no legend entry of their own — nothing on the map is
  // coloured or shaped to key them — rendered as the layers list at the foot of
  // the card.
  const layerControls = [
    {
      key: 'griddap',
      label: t('layersGriddedCoverage'),
      checked: griddapCoverageVisible,
      onChange: () => setGriddapCoverageVisible(!griddapCoverageVisible)
    },
    {
      key: 'globe',
      label: t('layersGlobeView'),
      checked: projection === 'globe',
      onChange: () =>
        setProjection(projection === 'globe' ? 'mercator' : 'globe')
    }
  ]

  // The data-type switches (which families of data draw at all) used to sit
  // below these, in the same card. They are a filter — the selection gates the
  // datasets list and the counts as well as the map — so they now live in the
  // Filters panel with the rest, and the legend keeps only the map-appearance
  // switches. The legend still reads the selection to know which colour keys it
  // is entitled to claim, which is what the props below are for.

  return (
    <>
      {/* The splash covers the first map load only; a redraw after that (new
          filters, a new polygon) happens over a map the user can already see
          and read, so it gets the MapBusy pill instead of a full-screen dim. */}
      {loading && !mapLoaded && <Loading />}
      {/* Mount the map immediately rather than waiting for /legend (the app's
          heaviest query) to resolve — first paint of the basemap and tile
          layers no longer blocks on it. The color ramp is applied once
          rangeLevels/coverageRangeLevels arrive via Map's setColorStops
          effect, which guards against their being undefined until then. */}
      <MapContainer />
      {/* The answer to the last click on the map. Sits directly after the map
          because it belongs to it — it is anchored to a point on the canvas and
          dismissed by the next click — and before the rest of the chrome, which
          all outranks it. */}
      <FeatureCard />
      <ApiErrorBanner />
      {/* One pill, two possible waits. The data redraw wins when both are in
          flight: it's the one the user's own action started, and the basemap
          catching up underneath it is the lesser news. */}
      {mapLoaded && (loading || basemapLoading) && (
        <MapBusy
          messageKey={loading ? 'mapUpdatingText' : 'mapTilesLoadingText'}
        />
      )}
      <Sidebar />
      <TopControls />
      <FiltersModal />
      <DownloadModal />
      <Legend
        currentRangeLevel={currentRangeLevel}
        hexRangeLevel={hexRangeLevel}
        hexRangeScaledToView={hexRangeScaledToView}
        loading={legendLoading}
        zoom={zoom}
        platformsAvailable={platformsAvailable}
        controls={legendControls}
        layerControls={layerControls}
        trailingDays={trailingDays}
        dataLayers={dataLayers}
        startDate={startDate}
        endDate={endDate}
        timeFilterActive={timeFilterActive}
        scrubTime={scrubTime}
      />
      <MapCornerControls />
      {/* The two range bars over the map, each carrying the filter for its
          axis and the marks that say where the drawn data sits on it: time
          along the bottom edge, depth down the right one, perpendicular the
          way the axes are. Each comes and goes with whether it has anything to
          say. Both read their own state from the filter and map providers. */}
      <TimeBar />
      <DepthBar />
      {activeWmsOverlay && !wmsLegendIsInline && (
        <WmsLegend
          overlay={activeWmsOverlay}
          variant='floating'
          onClose={() => setActiveWmsOverlay()}
          setActiveWmsOverlay={setActiveWmsOverlay}
        />
      )}
      <IntroModal showModal={showIntroModal} setShowModal={setShowIntroModal} />
      <PreviewHost />
    </>
  )
}
