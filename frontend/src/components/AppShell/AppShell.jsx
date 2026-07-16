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
import LayerSelector from '../Controls/LayerSelector/LayerSelector.jsx'
import TimeBar from '../Controls/TimeBar/TimeBar.jsx'
import WmsLegend from '../Controls/WmsLegend/WmsLegend.jsx'
import IntroModal from '../Controls/IntroModal/IntroModal.jsx'
import { BASEMAP_OPTIONS } from '../Map/basemapStyle.js'
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
    currentTrajectoryRangeLevel,
    currentObisRangeLevel,
    legendLoading,
    griddapCoverageVisible,
    setGriddapCoverageVisible,
    dataLayersVisible,
    setDataLayersVisible,
    projection,
    setProjection,
    basemap,
    setBasemap,
    activeWmsOverlay,
    setActiveWmsOverlay,
    tracksMode,
    setTracksMode,
    scrubTime,
    setScrubTime,
    trailingDays,
    setTrailingDays,
    smoothTracks,
    setSmoothTracks,
    dataLayers,
    setDataLayers
  } = useMapState()
  const { showIntroModal, setShowIntroModal, sidebarOpen } = useUI()
  const { inspectDataset, platformsAvailable } = useSelection()

  // The WMS legend lives inside the dataset page while that page is open (see
  // GriddapDetails); it only floats over the map — bottom-left — once the
  // datasets sidebar is collapsed, so it's never shown twice.
  const wmsLegendIsInline =
    sidebarOpen && activeWmsOverlay?.pk === inspectDataset?.pk

  // Map-layer switches, rendered inside the legend card.
  const layerControls = [
    {
      key: 'griddap',
      label: t('layersGriddedCoverage'),
      checked: griddapCoverageVisible,
      onChange: () => setGriddapCoverageVisible(!griddapCoverageVisible)
    },
    {
      key: 'observations',
      label: t('layersObservations'),
      checked: dataLayersVisible,
      onChange: () => setDataLayersVisible(!dataLayersVisible)
    },
    {
      key: 'globe',
      label: t('layersGlobeView'),
      checked: projection === 'globe',
      onChange: () =>
        setProjection(projection === 'globe' ? 'mercator' : 'globe')
    }
  ]

  const basemapOptions = BASEMAP_OPTIONS.map((option) => ({
    key: option.key,
    label: t(option.translationKey)
  }))

  return (
    <>
      {/* The splash covers the first map load only; a redraw after that (new
          filters, a new polygon) happens over a map the user can already see
          and read, so it gets the MapBusy pill instead of a full-screen dim. */}
      {loading && !mapLoaded && <Loading />}
      {/* Mount the map immediately rather than waiting for /legend (the app's
          heaviest query) to resolve — first paint of the basemap and tile
          layers no longer blocks on it. The color ramp is applied once
          rangeLevels/trajectoryRangeLevels arrive via Map's setColorStops
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
        currentTrajectoryRangeLevel={currentTrajectoryRangeLevel}
        currentObisRangeLevel={currentObisRangeLevel}
        loading={legendLoading}
        zoom={zoom}
        platformsAvailable={platformsAvailable}
        layerControls={layerControls}
        basemapOptions={basemapOptions}
        basemap={basemap}
        onBasemapChange={setBasemap}
        tracksMode={tracksMode}
        trailingDays={trailingDays}
        dataLayers={dataLayers}
      />
      <MapCornerControls />
      <LayerSelector
        dataLayers={dataLayers}
        setDataLayers={setDataLayers}
        tracksMode={tracksMode}
        setTracksMode={setTracksMode}
        loading={loading}
      />
      <ZoomToDataset variant='floating' />
      {tracksMode && dataLayers.trajectories && (
        <TimeBar
          scrubTime={scrubTime}
          setScrubTime={setScrubTime}
          trailingDays={trailingDays}
          setTrailingDays={setTrailingDays}
          smoothTracks={smoothTracks}
          setSmoothTracks={setSmoothTracks}
        />
      )}
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
