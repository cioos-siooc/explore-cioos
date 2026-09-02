import * as React from 'react'

import ActivityProvider from './activity/ActivityProvider.jsx'
import ActivityTasks from './activity/ActivityTasks.jsx'
import FilterProvider from './filters/FilterProvider.jsx'
import MapStateProvider from './map/MapStateProvider.jsx'
import SelectionProvider from './selection/SelectionProvider.jsx'
import DownloadProvider from './download/DownloadProvider.jsx'
import UIProvider from './ui/UIProvider.jsx'
import UrlSync from './useUrlSync.js'

// Provider order matters: MapState reads Filter (query); Selection reads
// Filter + MapState; Download reads Filter + Selection; UI reads Selection.
// Activity is outermost because anything, at any depth, may declare that it is
// waiting on something.
export default function AppProviders ({ children }) {
  return (
    <ActivityProvider>
      <FilterProvider>
        <MapStateProvider>
          <SelectionProvider>
            <DownloadProvider>
              <UIProvider>
                <UrlSync />
                <ActivityTasks />
                {children}
              </UIProvider>
            </DownloadProvider>
          </SelectionProvider>
        </MapStateProvider>
      </FilterProvider>
    </ActivityProvider>
  )
}
