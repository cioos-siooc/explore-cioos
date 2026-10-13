---
name: CIOOS Data Explorer
description: Canada's ocean data on one map; calm instruments laid over a chart.
colors:
  coastal-teal: "#52a79b"
  coastal-teal-deep: "#2f6f65"
  coastal-teal-deeper: "#295f57"
  shallows: "#c6e3df"
  deep-water-navy: "#152f37"
  beach-sand: "#f3f0ec"
  white: "#fff"
  ink-80: "rgb(21 47 55 / 82%)"
  ink-60: "rgb(21 47 55 / 62%)"
  ink-40: "rgb(21 47 55 / 40%)"
  hairline: "#dce8e5"
  surface-wash: "#eef6f4"
  coral-error: "#e25563"
  coral-error-bg: "#fbe3e6"
  coral-error-deep: "#b3263a"
  ochre-warn: "#b07a00"
  ochre-warn-bg: "#fdf3da"
  info-blue: "#0f6d8e"
  realtime-orange: "#c2410c"
  track-violet: "#6749ac"
  grid-amber: "#fbb03b"
  click-goldenrod: "#daa520"
  globe-space: "#050f14"
typography:
  display:
    fontFamily: "Sora, Montserrat, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Sora, Montserrat, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Montserrat, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Montserrat, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Montserrat, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.06em"
  brand:
    fontFamily: "Quicksand, Montserrat, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "8px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.coastal-teal}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.coastal-teal-deep}"
    textColor: "{colors.white}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-wash}"
    textColor: "{colors.ink-60}"
  tab-segment:
    backgroundColor: "rgb(82 167 155 / 14%)"
    textColor: "{colors.coastal-teal-deep}"
    height: "40px"
    padding: "4px 10px"
  tab-segment-applied:
    backgroundColor: "{colors.shallows}"
    textColor: "{colors.coastal-teal-deeper}"
  tab-segment-active:
    backgroundColor: "{colors.coastal-teal}"
    textColor: "{colors.white}"
  chip-filter:
    backgroundColor: "{colors.shallows}"
    textColor: "{colors.deep-water-navy}"
    rounded: "{rounded.lg}"
    padding: "2px 2px 2px 9px"
  chip-filter-excluded:
    backgroundColor: "{colors.coral-error-bg}"
    textColor: "{colors.deep-water-navy}"
  quick-filter:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-water-navy}"
    size: "40px"
  card-dataset:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-water-navy}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  card-dataset-hover:
    backgroundColor: "{colors.surface-wash}"
  input-text:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-water-navy}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  panel-floating:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.lg}"
  modal:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: CIOOS Data Explorer

## Overview

**Creative North Star: "The Chart Table"**

The map is the document; everything else is an instrument resting on it. Like a navigator's chart table, the ocean fills the whole surface and the tools sit on top of it: the brand bar with its tab strip, the datasets sidebar, the legend, the "what's here" card. They are white, raised and few. They sit on the map without covering it, so the eye returns to the water.

Colour works the same way. The chrome is almost entirely navy ink on white and beach sand, with coastal teal as the one voice for "this is interactive, selected or open". Every other hue belongs to the data and means one thing wherever it appears: violet is a trajectory track, amber is gridded coverage, goldenrod is what the last map click found. The hex coverage ramp runs from the shallows to deep water navy, so a cell's darkness reads as depth of data.

The feel is calm and precise. Controls rest quietly in hairlines and translucent teal washes, and turn solid teal only when open or primary. The density suits a working tool without becoming a GIS console. It is plain and friendly like the product's voice, and bilingual widths are respected. It must never drift back toward the generic Bootstrap admin look it replaced (grey cards, blue buttons, stock form chrome).

**Key Characteristics:**
- Full-bleed map with floating white instruments over it; no page chrome around the map.
- Coastal teal is the only interactive accent; data hues are reserved and consistent across map, legend and panels.
- Raised 3D only on surfaces that touch the map; flat hairline surfaces inside them.
- Sora headings, Montserrat body, Quicksand for the wordmark alone.
- Navy-tinted neutrals everywhere; no pure grey or black.
- One mobile rung (700px) where every surface goes full-screen and type steps up.

## Colors

A coastal palette with navy ink, a single teal accent, and a small set of data hues that each keep one meaning.

### Primary
- **Coastal Teal** (`coastal-teal`): the one interactive accent. Primary buttons, the open tab segment, focus rings (at 55% alpha), toggle tracks, icons in the tab strip, the selected card border. As a fill it carries white text (`--cioos-on-primary`). White on it is 2.85:1, below AA; that is a deliberate brand choice, navy (4.9:1) was tried and rejected. It is too light to be text itself.
- **Coastal Teal Deep** (`coastal-teal-deep`, `--cioos-primary-700`): hover and pressed for teal fills (white text at 5.9:1); link text and teal text on white, sand, surface wash and the translucent teal washes (all ≥4.5:1). Text hovers deepen to deeper rather than lightening to the base teal.
- **Coastal Teal Deeper** (`coastal-teal-deeper`, `--cioos-primary-800`): teal text on the shallows wash (applied tab, active pager page, success pills), where deep is 4.3:1; the hover of teal text; the open row in the Filters list.
- **Shallows** (`shallows`): the "has a value" wash. Applied tab segments, active filter chips, the success background, and the pale head of the hex ramp.

### Neutral
- **Deep Water Navy** (`deep-water-navy`): all body and heading text, the dark end of the hex ramp and the depth gradient.
- **Ink 80 / 60 / 40**: navy at reduced alpha for secondary text (80 for small 12-14px text, 60 for larger or bolder secondary text, 40 for muted icons and disabled glyphs).
- **Beach Sand** (`beach-sand`): the warm ground under footers and quiet bands (e.g. the sidebar's Download footer).
- **White** (`white`): every floating instrument's face, cards, modals, inputs.
- **Hairline** (`hairline`): the 1px border between everything; sits between sand and shallows in tone.
- **Surface Wash** (`surface-wash`): hover wash on white, row stripes, disabled primary fill; at 82% alpha it is the scrim over replaced content, and at 55% it is the softer scrim over the loading splash.
- **Globe Space** (`globe-space`): the navy-black the globe projection hangs in.

### Status
- **Coral Error** (`coral-error`, `-bg`, `-deep`): errors and excluded filter values; `-deep` is the label text on the pink ground.
- **Ochre Warn** (`ochre-warn`, `-bg`), **Info Blue** (`info-blue`): warnings and informational notes.
- **Realtime Orange** (`realtime-orange`): reserved for the "Realtime" badge; dark enough for white text.

### Data keys
- **Track Violet** (`track-violet`): trajectory track lines, their scrub control and legend swatch. The map paints it from `trackLineColor` in `components/config.js`; keep the two in step.
- **Grid Amber** (`grid-amber`): gridded (griddap) coverage highlight and its markers on the time and depth bars.
- **Click Goldenrod** (`click-goldenrod`): the ring on whatever the last map click found, and the matching accents on the "what's here" card, pinned list rows and inspector rows. It pairs with `clickHighlightColor` in `components/config.js`.
- **Hex ramp**: twelve opaque stops from Shallows through Coastal Teal to Deep Water Navy, at even L* steps (`colorScale` in `components/config.js`). It is the only ramp for coverage density.
- **Platform palette**: twelve hues for point markers (`platformColors.js`), kept apart by lightness for red-green colour blindness.

### Named Rules
**The One Voice Rule.** Coastal teal is the only colour the chrome uses to say "interactive, selected or open". A second accent in the chrome is a bug.

**The One Meaning Rule.** A data hue means exactly one thing, and it means the same thing on the map, in the legend and in the panel that controls it. Never borrow violet, amber or goldenrod for decoration, and never add a second hue for coverage density: darkness is the count.

**The White-On-Teal Rule.** Text on a teal fill is white, never navy, including the base brand teal. This knowingly trades AA contrast on the base fill for the brand look; do not flag or "fix" it.

**The Navy-Tinted Rule.** Neutrals are navy at reduced alpha or navy-tinted tints. Pure grey (`#888`) and pure black never appear.

## Typography

**Display Font:** Sora (with Montserrat, system-ui)
**Body Font:** Montserrat (with system-ui, -apple-system)
**Brand Font:** Quicksand, for the CIOOS/SIOOC wordmark only

**Character:** Sora's squared geometry gives headings a quiet, engineered edge. Montserrat keeps body text open and friendly at small sizes. Quicksand stands in for the licensed Volte Rounded wordmark and does nothing else. All three are self-hosted.

### Hierarchy
- **Display** (Sora 600, 18px, 1.2): modal titles, panel headings ("Datasets", "Filters").
- **Title** (Sora 600, 16px, 1.2): section headings inside panels and the intro window.
- **Body** (Montserrat 400, 14px, 1.5): dataset titles, filter rows, prose.
- **Body small** (Montserrat 400, 12px, 1.4): card metadata, counts, footer hints.
- **Label** (Montserrat 700, 11px, 0.06em, uppercase): section labels such as LEGEND, SORT, MAIN FILTERS.
- **Brand** (Quicksand, 26px): the lockup; the largest thing in the chrome.

The scale is a token ladder (`--cioos-font-size-3xs` 10px through `-xl` 26px). At 700px and below every rung steps up (base 16px) because surfaces go full-screen and are read at arm's length.

### Named Rules
**The Ladder Rule.** No font-size in px outside the token ladder in `theme.css`; reach for the nearest rung. The mobile step-up can only reach sizes on the scale.

**The Wordmark Rule.** Quicksand appears only in the CIOOS logo lockup and the loading splash.

## Layout

The map fills the viewport edge to edge; every other surface floats over it. The brand card (490px, capped to the viewport) is centred at the top with the Datasets / Time coverage / Filters tab strip welded to its base. Quick filters and active-filter chips flow under it. The datasets sidebar owns the left column (`--cioos-sidebar-width` 420px). It overlays the map below 1400px and sits beside it at 1400px and above, where it opens by default. The legend sits in the bottom-right corner, and the time bar along the bottom edge.

Surfaces publish their live footprint as custom properties (`--cioos-top-bar-space`, `--cioos-time-bar-space`, `--cioos-depth-bar-space`, `--cioos-api-error-space`) so neighbours hold clearance without hard-coded heights.

Spacing is a 4px-based ladder (4 / 8 / 12 / 16 / 24 / 32). At 700px and below it tightens (12 → 10, 16 → 12, 24 → 16, 32 → 20) while type grows.

Breakpoints are a fixed convention: 600 (narrow phone), **700 (the mobile rung**: brand bar goes edge-to-edge, sidebar and modals go full-screen, legend collapses, filter chips collapse; mirrored as `MOBILE_QUERY` in JS), 900 (legend relocates), 992 (modal/intro only), 1200 (compact WMS legend, tip card moves), 1400 (sidebar beside the map). Prefer an existing rung over a new one.

The brand card has a fixed width so switching language never resizes it, and it is sized for the longer French labels.

## Elevation & Depth

Depth separates what touches the map from what lives inside a panel. Surfaces that sit directly on the map are physically raised. A bright inset top highlight and a darker inset base give them an edge thickness, and a graduated four-layer navy shadow lifts them off the water (`--cioos-shadow-3d`, with `-3d-sm` for pills and the active tab, plus `--cioos-perspective`). Everything inside those surfaces is flat: white on white, separated by 1px hairlines, with at most a faint ambient card shadow.

### Shadow Vocabulary
- **Raised 3D** (`--cioos-shadow-3d`): the brand card, the datasets sidebar, the legend; surfaces resting on the map.
- **Raised 3D small** (`--cioos-shadow-3d-sm`): the active tab segment and pills over the map.
- **Card** (`--cioos-shadow-card`, `0 2px 8px` navy 8%): dataset cards inside the sidebar.
- **Float** (`--cioos-shadow-float`, `0 4px 16px` navy 16%): modals.
- **Menu** (`--cioos-shadow-md`): dropdowns and small menus.
- **Focus** (`--cioos-focus`, 3px teal at 55%): the keyboard focus ring, drawn as a shadow.
- **Click glow** (2px + 10px goldenrod at 35%): the card or row the last map click found; a shadow rather than a border so rows never shift.

### Named Rules
**The Raised-Over-Map Rule.** Only surfaces that rest directly on the map get the 3D lift. Anything nested inside them is flat with hairlines. A 3D shadow inside a panel is a bug.

**The Shadow-Not-Border Rule.** State emphasis (focus, map-click, selection glow) is drawn with box-shadow rings, never a thicker border, so a state change never reflows a list.

## Shapes

Softly rounded, never sharp and never bubbly. Floating panels, modals and the brand card use large 16px corners. Cards, surfaces and buttons use 8px. Inputs and small controls use 6px. Toggles and captions are full pills, and quick-filter buttons are 40px circles. The tab strip is square inside and takes its curve only from the card's outer bottom corners. Every border is a 1px hairline.

## Components

### Buttons
Calm at rest, solid only when it matters.
- **Shape:** gently rounded (8px).
- **Primary:** coastal teal fill, white 700-weight text, 1px coastal-teal-deep border. The sidebar's Download stacks its label over the selection count, which pulses when it changes.
- **Hover / Focus:** fill deepens to coastal teal deep (0.15s ease-out); focus is the teal shadow ring, never the browser outline.
- **Disabled:** surface-wash fill, hairline border, ink-60 text, instead of fading the teal (faded teal left white text unreadable).
- **Secondary:** white pill with hairline border and teal-deep text (e.g. "Clear all").

### Tab strip (signature)
The Datasets / Time coverage / Filters segments welded to the brand card's base.
- **Rest:** a translucent teal wash (14%) with coastal-teal-deep 600-weight text and teal icons; hairline welds between segments.
- **Hover:** wash deepens to 24%.
- **Applied** (a value set, UI closed): shallows fill, coastal-teal-deeper text.
- **Active** (its panel open): solid coastal teal, white text and icon, a white inner ring and the small 3D lift, so two adjacent active segments still read as separate buttons.
- Labels wrap, never truncate; French uses a non-breaking space so "Jeux / de données" breaks cleanly.

### Chips
- **Active filter chip:** shallows fill, 1px coastal teal border, 12px 600 navy text, a round remove button that turns teal on hover. Chips group under a labelled bubble per filter type.
- **Excluded value:** coral-error-bg fill with a coral border and an uppercase "NOT" tag in coral-error-deep, so it cannot be read as an include.
- **Quick filters:** 40px white circles with hairline borders and a pill caption beneath; Reset turns coral on hover.

### Cards / Containers
- **Dataset card:** white, 8px corners, hairline border, card shadow, 10px 12px padding. A platform colour dot leads the title; the metadata row (source, type, count) sits in body-small with small icons.
- **Hover:** border turns teal and the face takes the surface wash.
- **Selected:** teal border. **From map click:** goldenrod glow plus goldenrod border when not selected.
- **Focus:** the title button takes focus; the ring draws on the whole card.

### Inputs / Fields
- **Style:** white, 1px hairline, 6px corners, 8px 12px padding, inherited type; placeholder in ink-60.
- **Focus:** border turns coastal teal plus the teal focus ring.

### Modals
- White, 16px corners, float shadow, over a navy backdrop at 45%. The header is a Sora title with a subtitle and a hairline beneath it. Footers sit on a light wash. At 700px and below they go full-screen.

### Legend
- A raised white panel in the bottom-right with uppercase letter-spaced section labels, teal toggles per layer, and the hex ramp drawn as a continuous bar with count ticks.

## Do's and Don'ts

### Do:
- **Do** reference `var(--cioos-*)` tokens from `frontend/src/components/theme.css` for every colour, radius, shadow and size; no hardcoded hex in component stylesheets.
- **Do** keep coastal teal the only interactive accent, and deepen it to coastal teal deep for hover and for teal text on light grounds.
- **Do** give a new map layer one hue and use that exact hue in its legend swatch and its control, defined as a paired token in `theme.css` plus its `config.js` counterpart.
- **Do** use the raised 3D shadow only on surfaces resting on the map, and hairlines inside them.
- **Do** draw focus and state emphasis as box-shadow rings (`--cioos-focus`) so nothing reflows.
- **Do** size every surface for the French strings first; fixed widths must hold "Jeux de données" and "EXPLORATEUR".
- **Do** use an existing breakpoint rung (600 / 700 / 900 / 992 / 1200 / 1400).

### Don't:
- **Don't** drift toward a generic Bootstrap admin look: grey cards, blue buttons, stock form chrome, default outlines.
- **Don't** introduce a second accent colour in the chrome, or reuse a data hue (violet, amber, goldenrod, platform colours) decoratively.
- **Don't** add a second colour ramp for coverage; density is darkness on the one teal-to-navy ramp.
- **Don't** use pure grey or pure black; neutrals are navy-tinted.
- **Don't** set a font-size in px outside the token ladder, or use Quicksand outside the logo.
- **Don't** fade a primary button to show it is disabled; switch it to the surface wash with ink-60 text.
- **Don't** carry meaning by colour alone; pair a data hue with a label, icon or tooltip.
