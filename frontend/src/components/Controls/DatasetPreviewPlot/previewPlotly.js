import "../TaxonomyChart/plotlyGlobal.js";
import Plotly from "plotly.js/lib/core";
import contour from "plotly.js/lib/contour";
import scattergl from "plotly.js/lib/scattergl";
import frLocale from "plotly.js-locales/fr";

// Core (scatter) plus the contour the contour plot type fills its panels with,
// and the WebGL scatter large records switch to, which the basic dist bundle
// lacks. One module so the plot and the bundle test load the same build.
Plotly.register([contour, scattergl, frLocale]);

export default Plotly;
