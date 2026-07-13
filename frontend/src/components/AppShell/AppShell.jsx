import * as React from 'react'

import MapContainer from '../Map/MapContainer.jsx'
import ApiErrorBanner from './ApiErrorBanner.jsx'
import BrandSearch from './TopLeft/BrandSearch.jsx'
import BottomDock from './Dock/BottomDock.jsx'
import ActiveFilterChips from './Dock/ActiveFilterChips.jsx'
import PanelHost from './Panels/PanelHost.jsx'
import PreviewHost from './Panels/PreviewHost.jsx'
import MapCornerControls from './MapCorner/MapCornerControls.jsx'
import Loading from '../Controls/Loading/Loading.jsx'
import Legend from '../Controls/Legend/Legend.jsx'
import TimeBar from '../Controls/TimeBar/TimeBar.jsx'
import WmsLegend from '../Controls/WmsLegend/WmsLegend.jsx'
import IntroModal from '../Controls/IntroModal/IntroModal.jsx'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useUI } from '../../state/ui/UIProvider.jsx'
import './styles.css'

// The map-first shell: full-bleed map with a top-left brand + search cluster,
// a bottom-center dock (primary navigation) with its sheet, and the map
// interaction controls lower-right.
export default function AppShell () {
  const { platformsSelected } = useFilters()
  const {
    loading,
    zoom,
    currentRangeLevel,
    currentTrajectoryRangeLevel,
    legendVisible,
    activeWmsOverlay,
    setActiveWmsOverlay,
    tracksMode,
    scrubTime,
    setScrubTime,
    trailingDays,
    setTrailingDays,
    smoothTracks,
    setSmoothTracks,
    dataLayers
  } = useMapState()
  const { activePanel, showIntroModal, setShowIntroModal } = useUI()

  return (
    <>
      {loading && <Loading />}
      {/* Mount the map immediately rather than waiting for /legend (the app's
          heaviest query) to resolve — first paint of the basemap and tile
          layers no longer blocks on it. The color ramp is applied once
          rangeLevels/trajectoryRangeLevels arrive via Map's setColorStops
          effect, which guards against their being undefined until then. */}
      <MapContainer />
      <ApiErrorBanner />
      <BrandSearch />
      <PanelHost />
      <div className='dockCluster'>
        {/* chips hide while a sheet is open — the sheet sits where they live */}
        {!activePanel && <ActiveFilterChips />}
        <BottomDock />
      </div>
      {currentRangeLevel && legendVisible && (
        <Legend
          currentRangeLevel={currentRangeLevel}
          currentTrajectoryRangeLevel={currentTrajectoryRangeLevel}
          zoom={zoom}
          platformsInView={platformsSelected.map((e) => e.title)}
          tracksMode={tracksMode}
          trailingDays={trailingDays}
          dataLayers={dataLayers}
        />
      )}
      <MapCornerControls />
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
      {activeWmsOverlay && (
        <WmsLegend
          overlay={activeWmsOverlay}
          onClose={() => setActiveWmsOverlay()}
          setActiveWmsOverlay={setActiveWmsOverlay}
        />
      )}
      <IntroModal showModal={showIntroModal} setShowModal={setShowIntroModal} />
      <PreviewHost />
    </>
  )
}
