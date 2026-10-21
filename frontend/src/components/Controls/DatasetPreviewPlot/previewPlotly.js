import "../TaxonomyChart/plotlyGlobal.js";
import Plotly from "plotly.js/lib/core";
import heatmap from "plotly.js/lib/heatmap";
import frLocale from "plotly.js-locales/fr";

// Core (scatter) plus the heatmap the colour plot fills its panels with, which
// the basic dist bundle lacks. One module so the plot and the bundle test load
// the same build.
Plotly.register([heatmap, frLocale]);

export default Plotly;
