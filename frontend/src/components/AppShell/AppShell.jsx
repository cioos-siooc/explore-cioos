import * as React from 'react'
import { useTranslation } from 'react-i18next'

import MapContainer from '../Map/MapContainer.jsx'
import ApiErrorBanner from './ApiErrorBanner.jsx'
import MapBusy from './MapBusy.jsx'
import Sidebar from './Sidebar/Sidebar.jsx'
import TopControls from './TopControls/TopControls.jsx'
import FiltersModal from './Modals/FiltersModal.jsx'
import DownloadModal from './Modals/DownloadModal.jsx'
import PreviewHost from './Panels/PreviewHost.jsx'
import MapCornerControls from './MapCorner/MapCornerControls.jsx'
import ZoomToDataset from './ZoomToDataset/ZoomToDataset.jsx'
import Loading from '../Controls/Loading/Loading.jsx'
import Legend from '../Controls/Legend/Legend.jsx'
import TimeBar from '../Controls/TimeBar/TimeBar.jsx'
import WmsLegend from '../Controls/WmsLegend/WmsLegend.jsx'
import IntroModal from '../Controls/IntroModal/IntroModal.jsx'
import { anyTrajectoryLayerOn } from '../../state/dataLayers.js'
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
    mapLoaded,
    zoom,
    currentRangeLevel,
    currentCoverageRangeLevel,
    metric,
    metricPinned,
    setMetric,
    legendLoading,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    projection,
    setProjection,
    activeWmsOverlay,
    setActiveWmsOverlay,
    tracksMode,
    trajectoryHexes,
    scrubTime,
    setScrubTime,
    trailingDays,
    setTrailingDays,
    dataLayers
  } = useMapState()
  const { showIntroModal, setShowIntroModal, sidebarOpen } = useUI()
  const { inspectDataset, platformsAvailable } = useSelection()

  // The WMS legend lives inside the dataset page while that page is open (see
  // GriddapDetails); it only floats over the map — bottom-left — once the
  // datasets sidebar is collapsed, so it's never shown twice.
  const wmsLegendIsInline =
    sidebarOpen && activeWmsOverlay?.pk === inspectDataset?.pk

  // The hex/point layer's own visibility, which rides on the legend's ramp
  // title rather than sitting with the switches below: the ramp describes that
  // layer and nothing else, so the control that hides it belongs on the thing
  // it hides.
  const observationsControl = {
    key: 'observations',
    label: t('layersObservations'),
    checked: dataLayersVisible,
    onChange: () => setDataLayersVisible(!dataLayersVisible)
  }

  // Map-layer switches, rendered inside the legend card.
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
      <ApiErrorBanner />
      {loading && mapLoaded && <MapBusy />}
      <Sidebar />
      <TopControls />
      <FiltersModal />
      <DownloadModal />
      <Legend
        currentRangeLevel={currentRangeLevel}
        currentCoverageRangeLevel={currentCoverageRangeLevel}
        metric={metric}
        // Withheld at the marker tier, where the metric is pinned to days of
        // data: no handler means the Legend titles the ramp with a plain
        // caption instead of a picker that couldn't change anything.
        onMetricChange={metricPinned ? undefined : setMetric}
        loading={legendLoading}
        zoom={zoom}
        platformsAvailable={platformsAvailable}
        observationsControl={observationsControl}
        layerControls={layerControls}
        tracksMode={tracksMode}
        trajectoryHexes={trajectoryHexes}
        trailingDays={trailingDays}
        dataLayers={dataLayers}
      />
      <MapCornerControls />
      {/* TimeBar renders before the zoom pill: they share the bottom-center
          spot, and a CSS sibling rule lifts the pill while the bar is shown. */}
      {tracksMode && anyTrajectoryLayerOn(dataLayers) && (
        <TimeBar
          scrubTime={scrubTime}
          setScrubTime={setScrubTime}
          trailingDays={trailingDays}
          setTrailingDays={setTrailingDays}
          zoom={zoom}
        />
      )}
      <ZoomToDataset variant='floating' />
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
