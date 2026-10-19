// Plotly's source build (unlike its dist bundles) pulls in has-hover, which
// reads Node's `global`; this must be imported before plotly.js/lib/core.
globalThis.global ??= globalThis;
