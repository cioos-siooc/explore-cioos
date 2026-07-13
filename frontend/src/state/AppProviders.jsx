import * as React from 'react'

import FilterProvider from './filters/FilterProvider.jsx'
import MapStateProvider from './map/MapStateProvider.jsx'
import SelectionProvider from './selection/SelectionProvider.jsx'
import DownloadProvider from './download/DownloadProvider.jsx'
import UIProvider from './ui/UIProvider.jsx'
import UrlSync from './useUrlSync.js'

// Provider order matters: MapState reads Filter (query); Selection reads
// Filter + MapState; Download reads Filter + Selection; UI reads Selection.
export default function AppProviders ({ children }) {
  return (
    <FilterProvider>
      <MapStateProvider>
        <SelectionProvider>
          <DownloadProvider>
            <UIProvider>
              <UrlSync />
              {children}
            </UIProvider>
          </DownloadProvider>
        </SelectionProvider>
      </MapStateProvider>
    </FilterProvider>
  )
}
