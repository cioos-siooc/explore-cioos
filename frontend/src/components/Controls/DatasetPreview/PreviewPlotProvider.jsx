import * as React from "react";
import { createContext, useContext } from "react";

// Everything the plot is: the record's drawable columns, the settings that ride
// the query string (usePreviewPlotParams), and the two preferences that do not.
//
// A context rather than props because the provider outliving its consumer is the
// point: DatasetPreviewPlot is unmounted on every flip to the Table and back, so
// anything it owned would be discarded. Held here, the axes, the plot type, a
// renamed column and a dragged pane divider are all still there on the way back.
const PreviewPlotContext = createContext();

export function usePreviewPlot() {
  return useContext(PreviewPlotContext);
}

export default function PreviewPlotProvider({ value, children }) {
  return (
    <PreviewPlotContext.Provider value={value}>
      {children}
    </PreviewPlotContext.Provider>
  );
}
