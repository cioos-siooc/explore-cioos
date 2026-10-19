import * as React from "react";

import ActivityProvider from "./activity/ActivityProvider.jsx";
import ActivityTasks from "./activity/ActivityTasks.jsx";
import FilterProvider from "./filters/FilterProvider.jsx";
import MapStateProvider from "./map/MapStateProvider.jsx";
import SelectionProvider from "./selection/SelectionProvider.jsx";
import DownloadProvider from "./download/DownloadProvider.jsx";
import UIProvider from "./ui/UIProvider.jsx";
import TipsProvider from "./tips/TipsProvider.jsx";
import UrlSync from "./useUrlSync.js";

// Provider order matters: MapState reads Filter; Selection reads Filter +
// MapState; Download reads Filter + Selection; UI reads Selection; Tips reads
// UI. Activity is outermost because anything may declare a wait.
export default function AppProviders({ children }) {
  return (
    <ActivityProvider>
      <FilterProvider>
        <MapStateProvider>
          <SelectionProvider>
            <DownloadProvider>
              <UIProvider>
                <TipsProvider>
                  <UrlSync />
                  <ActivityTasks />
                  {children}
                </TipsProvider>
              </UIProvider>
            </DownloadProvider>
          </SelectionProvider>
        </MapStateProvider>
      </FilterProvider>
    </ActivityProvider>
  );
}
