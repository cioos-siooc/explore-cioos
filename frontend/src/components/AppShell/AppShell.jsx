import * as React from 'react'

import MapContainer from '../Map/MapContainer.jsx'
import ApiErrorBanner from './ApiErrorBanner.jsx'
import Sidebar from './Sidebar/Sidebar.jsx'
import TopControls from './TopControls/TopControls.jsx'
import FiltersModal from './Modals/FiltersModal.jsx'
import DownloadModal from './Modals/DownloadModal.jsx'
import PreviewHost from './Panels/PreviewHost.jsx'
import MapCornerControls from './MapCorner/MapCornerControls.jsx'
import Loading from '../Controls/Loading/Loading.jsx'
import Legend from '../Controls/Legend/Legend.jsx'
import WmsLegend from '../Controls/WmsLegend/WmsLegend.jsx'
import IntroModal from '../Controls/IntroModal/IntroModal.jsx'
import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'
import { useUI } from '../../state/ui/UIProvider.jsx'
import './styles.css'

// The map-first shell: full-bleed map with the dataset sidebar on the left
// (brand + search on top, counts + Download below), the Filters button and
// active-filter chips beside it, and the map interaction controls
// lower-right. Filters and Download open as modals.
export default function AppShell () {
  const { platformsSelected } = useFilters()
  const {
    loading,
    zoom,
    currentRangeLevel,
    currentTrajectoryRangeLevel,
    legendVisible,
    activeWmsOverlay,
    setActiveWmsOverlay
  } = useMapState()
  const { showIntroModal, setShowIntroModal } = useUI()

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
      <Sidebar />
      <TopControls />
      <FiltersModal />
      <DownloadModal />
      {currentRangeLevel && legendVisible && (
        <Legend
          currentRangeLevel={currentRangeLevel}
          currentTrajectoryRangeLevel={currentTrajectoryRangeLevel}
          zoom={zoom}
          platformsInView={platformsSelected.map((e) => e.title)}
        />
      )}
      <MapCornerControls />
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
