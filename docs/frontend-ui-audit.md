# Frontend UI primitives audit

Written 2026-11-18 to decide whether to replace the hand-built UI primitives
with shadcn/ui or a newer alternative. Steps 1–5 of the
[suggested order](#suggested-order) are in; every remaining step is tracked by
the `eslint-disable` comments that name it (`grep -rn "frontend-ui-audit.md step" frontend/src`).

## Goal

Interactive controls should come from a framework that already handles the
small interaction details: the ones that make a control feel natural and that
hand-written components (including agent-written ones) routinely forget. The
aim is not only to fix today's gaps but to stop new custom controls being
written at all.

## Recommendation

**Adopt [React Aria Components](https://react-spectrum.adobe.com/react-aria/)
(RAC) as the default for every interactive control, and add guardrails so
controls aren't hand-built again.** Keep `theme.css`, the `--cioos-*` tokens
and the plain CSS. RAC is unstyled, so style it through its `data-*` state
attributes (`[data-pressed]`, `[data-focus-visible]`, `[data-open]`,
`[data-entering]`, …). Wrap each RAC component once in
`frontend/src/components/ui/`; feature code imports only from `ui/`.

### What RAC handles that custom controls usually miss

- **Press:** mouse, touch, pen and keyboard all go through one press model. No
  hover states stuck on after a tap, no clicks fired by scrolling a list,
  long-press support.
- **Focus:** the focus outline appears only for keyboard users
  (`data-focus-visible`). Focus returns to the trigger when an overlay closes,
  focus is contained in modals, and nested overlays close one layer at a time.
- **Keyboard:** arrow keys, Home/End and typeahead (typing a letter jumps to
  that item) in menus and lists; Page Up/Down on sliders; Escape everywhere.
- **Positioning:** overlays flip or shift near the screen edge, follow scroll
  and resize, and avoid the phone's on-screen keyboard.
- **Dismissal and scroll lock:** outside interaction and Escape close the
  topmost layer. Scroll lock doesn't make the page jump, including on iOS.
- **Language:** built-in French strings, locale-aware dates and numbers, and
  screen-reader announcements.

RAC gives behaviour, not looks. Spacing, hover and pressed styles, animation
and visual polish still come from `theme.css`, `DESIGN.md` and the impeccable
skill.

### Why not shadcn/ui

- **It needs Tailwind, and Tailwind fights the existing CSS.** The frontend has
  67 plain global stylesheets (about 13.9k lines) and no Tailwind or PostCSS.
  Tailwind's preflight reset is a global stylesheet, the same kind of leak that
  once collapsed the map to zero height (see `dropPlotlyMaplibreCss` in
  `frontend/vite.config.mjs`). It would also break the MapLibre and Plotly
  chrome.
- **It assumes a different toolchain.** shadcn expects TypeScript and an `@/`
  alias. This frontend is all JS (244 `.jsx`, 0 `.tsx`) with no alias.
- **Its look conflicts with DESIGN.md**, which forbids drifting toward "stock
  form chrome, default outlines". Every component would have to be restyled
  onto our tokens anyway.
- **It doesn't remove maintenance.** shadcn copies component source into the
  repo, so we would own it just as we own `ui/` today.

### Why RAC over Radix or Base UI

Radix and Base UI cover part of the list above. RAC is the most thorough on the
interaction details (press model, typeahead, virtual-keyboard-aware
positioning, localized strings), which is the stated goal. Its bundle cost is
larger, so measure it on the first PR (see [Bundle](#bundle)).

## Inventory

Paths are relative to `frontend/src/components/`. "Importers" counts non-test
files that import the module.

### Shared primitives in `ui/`

| Primitive                                    | LOC (jsx + css)   | Importers | Behaviour today                                                                                                                                                  | Verdict                                                                                                                                         |
| -------------------------------------------- | ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/Dropdown.jsx` (`DropdownButton`)         | 166 + 79          | 6         | `aria-expanded`, but `aria-haspopup="listbox"` with button children. No Escape, no arrow keys, no menu roles, no focus moved in or back. Positioned by hand.     | **Replace** with RAC `MenuTrigger`/`Menu` (or `Select` where it picks a value)                                                                  |
| `ui/Tooltip.jsx`                             | 110 + 23          | 7         | `role=tooltip`, hover and focus. No `aria-describedby`, no Escape, no collision flipping.                                                                        | **Replace** with RAC `TooltipTrigger`/`Tooltip`                                                                                                 |
| `ui/Modal.jsx` (+ `HelpModal`)               | 213 + 189         | 6 (+5)    | Good: focus trap, Escape for the top modal of a stack, focus restored on close, scroll lock. Becomes a mobile bottom sheet (`useSheetDrag`) that closes on Back. | **Replace the core** with RAC `ModalOverlay`/`Modal`/`Dialog`. Keep the sheet drag (`useSheetDrag`) and Back-dismiss (`useBackDismiss`) on top. |
| `ui/Switch.jsx`                              | 43 + 51           | 4         | Native checkbox with `role=switch`                                                                                                                               | **Replace** with RAC `Switch`; `IntroModal.jsx` (~L330) uses the wrapper instead of copying its markup                                          |
| `ui/SelectPill.jsx`, `ui/SortSelect.jsx`     | 73 + 82, 42 + 28  | 2, 2      | Native `<select>`                                                                                                                                                | **Keep, deliberately:** the phone's own picker beats any custom one. Sort direction button becomes a RAC `ToggleButton`.                        |
| `ui/Pager.jsx`                               | 127 + 102         | 2         | `nav`, `aria-current`                                                                                                                                            | Keep the markup; its buttons become RAC `Button`                                                                                                |
| `ui/CloseButton.jsx`                         | 26 + 52           | 6         | Labelled                                                                                                                                                         | Built on RAC `Button` (press model, focus-visible)                                                                                              |
| `ui/TableFilter.jsx`                         | 33 + 34           | 2         | `aria-label` from placeholder                                                                                                                                    | RAC `SearchField` (Escape clears, clear button, real label)                                                                                     |
| `ui/PaneDivider.jsx`                         | 80 + 33           | 1         | Full splitter pattern (arrows, Home/End)                                                                                                                         | Keep: RAC has no splitter                                                                                                                       |
| `ui/Spinner.jsx`, `ui/Skeleton.jsx`          | 83 + 111, 35 + 44 | 18, 7     | `role=status`, `aria-busy`                                                                                                                                       | Keep (branded, not interactive). RAC `ProgressBar` where progress is known.                                                                     |
| `ui/useSheetDrag.js`, `ui/useElementSize.js` | 88, 64            | —         | n/a                                                                                                                                                              | Keep                                                                                                                                            |

### Controls written inline in feature components

| Pattern                   | Where                                                                                                                                                                                              | Behaviour today                                                              | Verdict                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Filter popover            | `Controls/Filter/Filter.jsx`                                                                                                                                                                       | Click-outside only (`useOutsideAlerter`). **No Escape, no `aria-expanded`.** | **Replace** with RAC `DialogTrigger` + `Popover`                                            |
| Area menu                 | `AppShell/QuickFilters/QuickFilters.jsx` (~L54–160)                                                                                                                                                | Escape and `aria-expanded` present; separate `pointerdown` click-outside     | **Replace** with the `ui/` Menu                                                             |
| Feature card (map popup)  | `Map/FeatureCard/FeatureCard.jsx`                                                                                                                                                                  | `role=dialog`, Escape via a `window` listener, **no focus management**       | **Replace** the shell with a non-modal RAC `Popover`/`Dialog`; content stays                |
| Combobox                  | `AppShell/FilterSearch/FilterSearch.jsx` (683 LOC, ~L448–548)                                                                                                                                      | combobox/listbox roles, arrow keys, document-level keydown                   | **Replace** with RAC `ComboBox` / `Autocomplete`, the largest single win in LOC             |
| Collapsibles              | 16 files hand-roll `aria-expanded` toggles (`ListCard`, `GridGroupHeader`, `DatasetMetadata` ×3, `SourceFilter`, `Legend`, `LegendFooter`, `TaxonomyTree`, `TopControls`, `DatasetPreviewPlot`, …) | Correct but duplicated                                                       | **Replace** with RAC `Disclosure` / `DisclosureGroup`                                       |
| Tabs                      | `Controls/DatasetInspector/DatasetInspector.jsx` (~L653–775)                                                                                                                                       | Complete (roving tabIndex, arrows, Home/End)                                 | **Replace** with RAC `Tabs`                                                                 |
| Tri-state / card checkbox | `Controls/Filter/MultiCheckboxFilter/OptionState.jsx`, `Controls/DatasetsTable/DatasetCard.jsx` (~L110)                                                                                            | Custom `role=checkbox`                                                       | **Replace** with RAC `Checkbox` (`isIndeterminate`)                                         |
| Toggle buttons            | `aria-pressed` in 14 files (FilterButton, QuickFilters, Legend, TimeDistribution, …)                                                                                                               | Correct, per-component                                                       | **Replace** with RAC `ToggleButton` / `ToggleButtonGroup`                                   |
| Range slider              | `Controls/Rail/Rail.jsx` (used by TimeRail and DepthRail)                                                                                                                                          | `role=slider`, keyboard, pointer drag                                        | **Replace** the mechanics with RAC `Slider` (multiple thumbs); Rail's ticks and labels stay |
| Date input                | `Controls/TimeRail/TimeRail.jsx` (~L41), native `type="date"`                                                                                                                                      | Browser-dependent, follows browser locale not app locale                     | **Replace** with RAC `DateField` / `DatePicker` (follows the EN/FR setting)                 |
| Toast / banners           | `AppShell/NoticeToast.jsx`, `ApiErrorBanner.jsx`, `ActivityIndicator.jsx`                                                                                                                          | `role=status`                                                                | RAC `ToastRegion` for NoticeToast, if its toast API is stable by then. Banners stay.        |
| Coach-mark                | `Controls/Tips/TipCard.jsx` + `TipPointer.jsx`                                                                                                                                                     | Escape, arrows, click-outside                                                | Keep the bespoke tour logic; put it on RAC `Popover` for positioning and dismissal          |
| Chips                     | `AppShell/TopControls/ActiveFilterChips.jsx`                                                                                                                                                       | Buttons                                                                      | RAC `TagGroup` (keyboard removal, focus kept in the group when a chip is removed)           |

### Duplication RAC removes

- **Click-outside, four times:** `useOutsideAlerter` (`utilities.jsx` ~L893),
  Dropdown, QuickFilters, TipCard.
- **Document- or window-level `keydown` listeners, seven** (Modal, Sidebar,
  FeatureCard, DatasetInspector, FilterSearch, TipCard, Map).
- **Two positioning engines:** Dropdown and Tooltip.

**Out of scope (domain components):** Map, charts and plots, filter content,
Legend content, DatasetsTable/DatasetCard content, the Harvest pages,
IntroModal content, branding icons. Only the controls _inside_ them move.

## Accessibility gaps today

Real bugs now; the first PRs in the [order](#suggested-order) fix them:

1. **Dropdown:** wrong `aria-haspopup`, no Escape, no keyboard navigation,
   focus not moved into the menu or returned to the toggle.
2. **Filter popover:** no Escape, no `aria-expanded` on its toggle.
3. **Tooltip:** not linked to its trigger (`aria-describedby`), so screen
   readers never announce it.
4. **FeatureCard:** a `role=dialog` that never receives focus.
5. **Not reachable by keyboard at all** (found by `jsx-a11y` in step 1): the
   language toggle (`LanguageSelector.jsx`, a clickable `div`), the spatial
   filter's draw-mode options (`SpatialFilter.jsx`) and the harvest bar
   segments (`HarvestPie.jsx`). Step 6 makes them RAC `Button`s.

Gap 2 is narrower than first written: inside the Filters modal a `Filter` is a
row that opens its page beside the list (`aria-current`, Escape closes the
modal), not a floating popover. Step 4 still removes its `useOutsideAlerter`
and `autoFocus`.

`frontend/e2e/specs/keyboard.spec.js` walks the Filters modal, a Dropdown
and the FeatureCard by keyboard: open, navigate, Escape, and where focus
lands.

## Guardrails

Without these, the next control gets hand-built again.

1. **Rule in `frontend/AGENTS.md`:** interactive controls come from `ui/`,
   which wraps RAC. If `ui/` lacks one, add a RAC-backed wrapper there.
   Feature code does not hand-write widget `role=` attributes, arrow-key or
   Escape handlers, click-outside logic, portals, or document/window-level
   keyboard and pointer listeners.
2. **Lint rules.** The ESLint config (`eslint.config.mjs`) has no
   accessibility plugin today.
   - Add `eslint-plugin-jsx-a11y` (recommended set).
   - Add a `no-restricted-syntax` rule, disabled under `frontend/src/components/ui/`,
     that rejects `role="menu|menuitem|listbox|option|dialog|tooltip|tab|tablist|switch|slider|checkbox|combobox"`
     and `document`/`window` `addEventListener("keydown" | "mousedown" | "pointerdown")`.
     Existing violations get `eslint-disable` comments naming the migration
     step that removes them, so the list only shrinks.
   - The lint-on-edit hook then rejects a hand-built control as soon as it is
     written.
3. **Keyboard e2e test.** axe can't catch missing Escape, broken arrow keys or
   lost focus. Add a Playwright spec that keyboard-walks the Menu, Filter
   popover, FeatureCard and a Modal: open, navigate, Escape, and assert focus
   returns to the trigger.
4. **DESIGN.md.** Record the RAC styling pattern (`data-*` selectors, focus
   ring, pressed state) so design passes extend it rather than fight it.

## Migration cost and risk

- **Tests.** Vitest queries use test IDs 466 times, text 404, roles 401,
  `querySelector` 189, and classes about 102. Keep `data-testid` and the
  existing class names on wrapper roots so most of these survive. Role-based
  queries change where roles were wrong (Dropdown items become `menuitem`).
  Tests that assert the old roles need rewriting, not weakening.
- **e2e.** About 20 Playwright locators use CSS classes (`.modal-content`,
  `.quickFilterButton`, …).
- **Visual baselines.** The 12 baselines under
  `frontend/e2e/__screenshots__/visual/` are re-recorded with
  `npm run test:visual:update`, in the container, only if pixels move.
- **Accessibility ratchet.** `frontend/e2e/a11y-baseline.json` fails on any new
  axe rule. RAC should only lower the counts, but run `test:a11y` on every PR.
- **URL-driven UI.** Every window and filter must stay controllable from the
  URL (`useUrlSync.js`, `UIProvider.jsx`). Use RAC's controlled `isOpen` /
  `onOpenChange`, never its uncontrolled state.
- **Bilingual widths.** French labels are longer. RAC adds no fixed widths, so
  this only matters if new CSS sets them.
- **Modal is the riskiest swap.** Stacked modals, the mobile sheet and
  Back-dismiss are tested product behaviour; do it after the team knows RAC.

## Suggested order

One PR each. Each `ui/` wrapper keeps its API where it can, so call sites
barely change.

1. **Foundation and guardrails:** add `react-aria-components`, the `AGENTS.md`
   rule, the lint rules (with tracked disables), the keyboard e2e spec, and
   the DESIGN.md pattern. Measure the bundle here.
2. Dropdown → RAC `Menu`/`Select`, plus the QuickFilters area menu (gap 1).
   **Done:** `ui/Dropdown.jsx` is RAC `MenuTrigger`/`Menu` (pick lists are
   `menuitemradio`s via `selectedKey`) plus a `PopoverButton` (`Dialog` in a
   `Popover`) for the colour picker, whose custom-colour field a menu can't
   hold. The area menu is a non-modal popover so the click that closes it
   still lands on the map as the box's first corner; `MenuTrigger` reports
   that close as `"outside"` so it doesn't disarm. `ui/LocaleProvider.jsx`
   ties RAC's locale to the EN/FR switch. Initial JS: 744.9 kB gz (+45.4 kB).
3. Tooltip → RAC `Tooltip` (gap 3).
   **Done:** `ui/Tooltip.jsx` is RAC `TooltipTrigger` + `Focusable`, so the
   bubble is the trigger's `aria-describedby`, opens on keyboard focus, closes
   on Escape, flips at the edges, and no longer opens from a touch. Its child
   must be a focusable element; text that only explains itself (the dataset
   count, EOV chips with a definition, the download card's status) goes in
   a `TooltipTarget`, an unstyled button. The help icon is a labelled,
   focusable `img`. Found on the way: `FilterOption` spread its props after
   its own `onKeyDown`, so a handler from a wrapper replaced Enter/Space.
   Initial JS: 745.8 kB gz (+0.9 kB over step 2).
4. Filter popover → `Popover` (gap 2, deletes `useOutsideAlerter`).
   **Done, without a Popover:** every `Filter` is a row of the Filters modal
   whose page opens beside the list, so the uncontrolled popover mode,
   `useOutsideAlerter` (and TipCard's guard against it) and the `autoFocus`
   are gone; the page follows the panel's `openFilter` alone. That fixed a
   click on blank space hiding the open page while its row and the URL still
   named it. Picking a searchable row still moves the cursor into its search;
   a page restored from a link leaves focus where the modal put it.
5. FeatureCard shell (gap 4).
   **Done, as a non-modal dialog:** the card hangs in a corner rather than off
   a trigger, so not a `Popover`. `ui/PanelDialog.jsx` (react-aria
   `useDialog`, `FocusScope restoreFocus` and `useKeyboard`) takes focus when
   the card opens, closes on Escape from inside it, and gives focus back to
   the map; closed but still sliding out, it is a plain `div`. The window
   `keydown` listener is gone, so Escape no longer closes the card once focus
   has left it. A later map click updates the open card without taking focus
   again.
6. `Button`, `ToggleButton`, `Switch`, `Checkbox`, `SearchField`
7. Collapsibles → `Disclosure`; Tabs
8. FilterSearch → `ComboBox`/`Autocomplete`; chips → `TagGroup`
9. Rail → `Slider`; TimeRail date → `DateField`
10. Modal core → RAC `Modal` (sheet and Back-dismiss on top); NoticeToast; TipCard positioning

Steps 1–5 fix every current accessibility gap. Each later step deletes a
lint disable.

## Bundle

Measured in step 1 (`react-aria-components` 1.22.1, gzipped JS loaded on first
paint; everything RAC lands in the entry chunk):

| Imported                                                     | Initial JS gz | Added           |
| ------------------------------------------------------------ | ------------- | --------------- |
| Nothing (today)                                              | 699.5 kB      | —               |
| Steps 2–5 (Button, Menu, Popover, Tooltip, Dialog)           | 748.1 kB      | +48.6 kB        |
| Every component in this plan                                 | 818.3 kB      | +118.8 kB       |
| Every component, `@react-aria/optimize-locales-plugin` en/fr | 791.9 kB      | +92.4 kB (+13%) |

The locale plugin is in `vite.config.mjs` (it is a no-op until RAC is
imported). Its locale match is region-strict, so it is configured with bare
`en`/`fr`: RAC ships `fr-FR`, which `fr-CA` would have dropped. If the added
size is unacceptable, Base UI is the fallback with the same wrapper approach,
at the cost of some of the interaction details above.

## Related findings

Outside the primitives question, but they affect maintenance as much or more. (The keyboard e2e test,
native date input and DESIGN.md sync moved into the sections above.)

1. **`Map/Map.jsx` is 3,824 lines.** It is a bigger maintenance burden than all
   of `ui/` combined. Splitting it (layers, hover/click hit-testing, camera,
   drawing) pays off more than any component library.
2. **All CSS shares one global namespace.** The 67 stylesheets use no CSS
   modules and no `@layer`, so any class can override any other and renames
   need an app-wide search. Wrap the CSS in cascade layers
   (`@layer theme, ui, features`) or move component stylesheets to
   `*.module.css` one at a time. Vite supports both natively.
3. **Leftover Bootstrap class names.** Modal, Dropdown and Switch still output
   `btn`, `modal-dialog`, `dropdown-menu`, `form-switch` and `tooltip-inner` so
   old CSS keeps applying, though Bootstrap is gone. Rename them to our own
   classes: cheap, and no collisions if a dependency ships those names.
4. **Tests lean on test IDs and classes.** About 470 test-ID and 290 class or
   `querySelector` lookups, against about 400 role-based ones, which is why
   refactors look expensive. Write new tests with
   `getByRole`/`getByLabelText`: future swaps get cheap and accessibility is
   tested along the way.
5. **No type checking.** The frontend is all plain JS. See
   [TypeScript](#typescript) for the recommended incremental path.

## TypeScript

Worth it, done incrementally rather than as a big-bang conversion.

**Where it pays off here**

- **API response shapes.** Tiles, `/datasets/metadata`, `pointQuery` and the
  harvest coverage endpoints feed shapes through many components. Past bugs
  were exactly this kind of mismatch: the `pointPKs` filter that was never
  `.split(",")`, and MapLibre 6 returning GeoJSON properties as objects
  instead of strings.
- **State providers and URL sync.** `src/state/ui/UIProvider.jsx`, the filter
  providers and `src/state/useUrlSync.js` are read almost everywhere. A
  renamed field there currently fails silently.
- **Refactors.** Splitting `Map.jsx` or swapping the `ui/` behaviour is much
  safer when the compiler lists every caller that broke.
- **Agent-written code.** Types give the agent, and the reviewer, a check that
  runs before any test.

**Cost**

- **Size.** 373 `.js`/`.jsx` source files plus about 168 test files. Renaming is
  cheap; meaningful types instead of `any` everywhere are the real work.
- **Library types are mixed.** MapLibre and React are well typed. Plotly,
  `react-plotly.js` and `@mapbox/mapbox-gl-draw` are weaker and will need some
  local declarations.
- **Build changes are minimal.** Vite compiles `.ts`/`.tsx` natively, but it
  doesn't type-check, so add a `tsc --noEmit` step to CI and pre-commit.
- **No central API layer.** 20 non-test modules call `fetch()` directly; only 7
  go through `src/state/fetchJson.js`. Typing the API means routing those
  calls through typed helpers first.

**Path**

1. Add a `tsconfig.json` with `allowJs: true`, `checkJs: false` and `noEmit`,
   plus `tsc --noEmit` in CI and pre-commit. New files are `.ts`/`.tsx` from
   then on.
2. Type the API layer first. Define response types and route the direct
   `fetch()` calls through typed `fetchJson` helpers.
3. Convert the state providers and `useUrlSync`, then `ui/`. Doing this at the
   same time as the React Aria work in the
   [suggested order](#suggested-order) means
   each wrapper's interface is written once, in TypeScript.
4. Convert feature components as they are touched. Split `Map.jsx` into typed
   modules rather than converting it whole.
5. Turn on `strict` once the core is converted. Convert tests last.

**Cheaper alternative.** `// @ts-check` with JSDoc gives maybe 60–70% of the
safety with no file renames, but JSDoc types are clunkier to write and
maintain. If TypeScript is the likely destination, skip this middle step. If
the frontend's other contributors aren't comfortable with TypeScript, JSDoc
gets most of the benefit with less friction.
