export default {
  extends: "stylelint-config-standard",
  rules: {
    // Class names are camelCase to match the JSX that references them.
    "selector-class-pattern": null,
    "keyframes-name-pattern": null,
    // -webkit-/-moz- appearance, user-select and text-size-adjust are still
    // load-bearing on Safari and iOS.
    "property-no-vendor-prefix": null,
    // `(width >= 700px)` needs Safari 16.4; the min-width form works everywhere.
    "media-feature-range-notation": null,
    // Both flag deliberate structure here, and acting on either reorders rules
    // past intervening `margin`/`border` shorthands — a cascade change this
    // repo has no visual test to catch.
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
  },
};
