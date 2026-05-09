// Drop this at your project root as `.designdoctor.json` (use the JSON form for v0.1).
// A future version will accept `designdoctor.config.ts` as well so you can `import` types.

export default {
  preset: "default",            // default | strict | minimal
  allow: [
    // "dark-mode",              // suppress dark-mode-pairing if you don't ship dark mode
    // "single-locale",          // suppress i18n-leak if app is intentionally single-locale
  ],
  disable: [
    // "copy/i18n-leak",
    // "design/mixed-units",
  ],
  severity: {
    // "a11y/icon-only-button-no-label": "error",
    // "design/color-cluster": "warning",
  },
  thresholds: {
    colorClusterMinSize: 3,
    fontWeightMaxCardinality: 4,
    fontFamilyMaxCardinality: 2,
    zIndexMaxCardinality: 6,
    shadowMaxCardinality: 5,
  },
  routes: [
    // For the v0.2 vision pass — explicit list of routes to screenshot.
    // "/", "/pricing", "/dashboard"
  ],
  url: "http://localhost:3000",
};
