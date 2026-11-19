import * as React from "react";
import { useEffect, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  BroadcastPin,
  ChevronDown,
  ChevronRight,
  GeoAlt,
  Pentagon,
  Search,
  SlashCircle,
  X,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { server } from "../../../config.js";
import { parseArea, useDebounce } from "../../../utilities.jsx";
import {
  Autocomplete,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  SearchField,
} from "../../ui/Autocomplete.jsx";
import Button, { ToggleButton } from "../../ui/Button.jsx";
import MatchHighlight from "../../ui/MatchHighlight.jsx";
import Spinner from "../../ui/Spinner.jsx";
import fetchJson from "../../../state/fetchJson.js";
import reportError from "../../../state/reportError.js";
import {
  closestOption,
  exactNameFirst,
  matchFilterOptions,
  parseFilterQuery,
  parsePartialRangeQuery,
} from "../../../state/filterSearch.js";
import { iconForKey } from "../../../state/useActiveFilters.js";
import { regionDescription } from "../../../state/regionSearch.js";
import {
  useGoToRegion,
  useRegionMatches,
} from "../../../state/useRegionSearch.js";
import useFilterModel from "../../../state/useFilterModel.js";
import useResetAllFilters from "../../../state/useResetAllFilters.js";
import {
  SEARCH_ALL,
  SEARCH_TITLES,
  useFilters,
} from "../../../state/filters/FilterProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import {
  ExcludedLabel,
  OptionStateIcon,
} from "../../Controls/Filter/MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

const SCIENTIFIC_NAME_MIN_LENGTH = 3;
const MATCHES_PER_GROUP = 8;
const SHOWN_PER_GROUP = 4;

// Kept with the term they answer so a stale reply is simply not shown, rather
// than cleared by an effect.
function useScientificNameMatches(term, enabled) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const query = useDebounce(term, 300);
  const [result, setResult] = useState({ query: "", items: [] });
  const wanted = enabled && query.length >= SCIENTIFIC_NAME_MIN_LENGTH;

  useEffect(() => {
    if (!wanted) return undefined;
    const controller = new AbortController();
    fetchJson(
      `${server}/scientificNames?q=${encodeURIComponent(query)}&lang=${lang}&limit=10`,
      { signal: controller.signal },
    )
      .then((items) =>
        setResult({
          query,
          items: (Array.isArray(items) ? items : []).filter(
            (i) => i?.scientificName && !i.tooBroad,
          ),
        }),
      )
      .catch((error) => {
        if (error.name !== "AbortError")
          reportError("scientificNames search failed", error);
      });
    return () => controller.abort();
  }, [wanted, query, lang]);

  return wanted && result.query === term ? result.items : [];
}

// A picked area becomes the area filter, as its outline or as the box around
// it, and the map frames it; its `secondary` action only goes to it. A point
// place has no outline, so picking it only goes to it.
function useRegionGroup(regions) {
  const { t } = useTranslation();
  const goTo = useGoToRegion();
  const [shape, setShape] = useState("polygon");
  if (regions.length === 0) return null;

  const shapeLabel =
    shape === "box" ? t("drawBoundingBoxOption") : t("drawPolygonOption");
  const ShapeIcon = shape === "box" ? BoundingBox : Pentagon;
  return {
    key: "region",
    label: t("regionSearchGroup"),
    searched: true,
    shapes: [
      { id: "polygon", label: t("drawPolygonOption") },
      { id: "box", label: t("drawBoundingBoxOption") },
    ].map((s) => ({
      ...s,
      pressed: shape === s.id,
      choose: () => setShape(s.id),
    })),
    options: regions.map((region) => ({
      id: region.id,
      label: region.name,
      // What picking it does: the shape it filters by, or a pin to go to.
      icon: region.area ? ShapeIcon : GeoAlt,
      hint: region.otherNames.join(" · ") || undefined,
      description: regionDescription(region, t),
      command: true,
      includeOnly: true,
      closes: true,
      action: region.area
        ? t("regionSearchAction", { shape: shapeLabel })
        : t("regionSearchGoTo"),
      toggle: () => goTo(region, shape),
      secondary: region.area && {
        label: t("regionSearchGoTo"),
        run: () => goTo(region),
      },
    })),
  };
}

const GROUP_ICONS = {
  quick: BroadcastPin,
  reset: ArrowCounterclockwise,
  exclude: SlashCircle,
  region: GeoAlt,
};

function GroupIcon({ groupKey, size = 14 }) {
  const Icon = GROUP_ICONS[groupKey];
  return Icon ? <Icon size={size} aria-hidden="true" /> : iconForKey(groupKey);
}

// Lists, menus, their triggers and popup dialogs (the date picker) take
// typed letters and digits as typeahead.
const isTypingTarget = (el) =>
  el instanceof Element &&
  (el.isContentEditable ||
    el.closest(
      "input, textarea, select, [contenteditable], [role=listbox], [role=menu], [role=dialog], [aria-haspopup]",
    ) !== null);

// Also opens on typing a letter or digit while no field has focus and no
// dialog is up. Not symbols, which the map takes for zoom (+, -, =). The
// composed path sees through shadow roots (Sentry's feedback form), which
// retarget e.target to their host.
export function useFilterSearchShortcut(open) {
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open("");
        return;
      }
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        !/^[\p{L}\p{N}]$/u.test(e.key) ||
        isTypingTarget(e.composedPath()[0]) ||
        document.body.classList.contains("cioos-modal-open")
      )
        return;
      e.preventDefault();
      open(e.key);
    }
    document.addEventListener("keydown", onKeyDown); // eslint-disable-line no-restricted-syntax -- a page-wide shortcut, not part of any control
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

const HELP_ROWS = [
  { group: "text", help: "Filters" },
  { group: "text", help: "Titles" },
  { group: "time", help: "Time" },
  { group: "depth", help: "Depth" },
  { group: "quick", help: "Toggles" },
  { group: "area", help: "Area" },
  { group: "region", help: "Places" },
  { group: "exclude", help: "Exclude" },
];

function FilterSearchHelp({ showSpecies, onExample }) {
  const { t } = useTranslation();
  const examples = (help) => {
    const list = t(`filterSearchHelp${help}Examples`, { returnObjects: true });
    return help === "Filters" && showSpecies
      ? [...list, t("filterSearchHelpSpeciesExample")]
      : list;
  };
  return (
    <div className="filterSearchHelp" data-testid="filter-search-help">
      <p className="filterSearchHelpCaption">{t("filterSearchCaption")}</p>
      <dl className="filterSearchHelpRows">
        {HELP_ROWS.map((row) => (
          <div key={row.help} className="filterSearchHelpRow">
            <dt>
              <span className="filterSearchHelpName">
                <GroupIcon groupKey={row.group} />
                {t(`filterSearchHelp${row.help}`)}
              </span>
            </dt>
            <dd>
              {examples(row.help).map((example) => (
                <Button
                  key={example}
                  className="filterSearchHelpExample"
                  onPress={() => onExample(example)}
                  title={t("filterSearchHelpExampleTitle", { example })}
                >
                  {example}
                </Button>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// The text and the picked rows are the panel's, so they survive a visit to a
// filter's own page and its Clear all can drop the rows.
export default function FilterSearch({
  text,
  setText,
  touched,
  setTouched,
  inputRef,
}) {
  const { t } = useTranslation();
  const { obisDataAvailable, searchText, searchIn, setSearch } = useFilters();
  const { setOpenFilter, setShowFiltersModal } = useUI();
  const [canReset, resetAll] = useResetAllFilters();
  // The option in virtual focus, for the footer's key hints.
  const [currentKey, setCurrentKey] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const { term, exclude } = parseFilterQuery(text);
  const places = useRegionMatches(exclude ? "" : term);
  const regionGroup = useRegionGroup(places.places);
  const groups = [
    ...useFilterModel(
      useScientificNameMatches(term, obisDataAvailable),
      exclude ? undefined : parsePartialRangeQuery(term),
      exclude ? undefined : parseArea(term),
    ),
    regionGroup,
    canReset && {
      key: "reset",
      label: t("quickFilterCaptionReset"),
      options: [
        {
          id: "reset",
          label: t("filterSearchClearAll"),
          matchText: `${t("filterSearchClearAll")} ${t("quickFilterCaptionReset")}`,
          includeOnly: true,
          command: true,
          action: t("quickFilterCaptionReset"),
          toggle: () => {
            resetAll();
            setTouched(new Set());
          },
        },
      ],
    },
  ].filter(Boolean);
  const pinned = groups.filter((g) => g.pinned);

  let shown = matchFilterOptions(
    groups.filter((g) => !g.pinned),
    term,
    MATCHES_PER_GROUP,
    (groupKey, option) => touched.has(`${groupKey}:${option.id}`),
  );
  if (exclude) {
    shown = shown
      .map((g) => ({ ...g, options: g.options.filter((o) => !o.includeOnly) }))
      .filter((g) => g.options.length > 0);
  } else if (term) {
    const scopeOption = (id, scope, labelKey) => {
      const searching = searchText === term && searchIn === scope;
      return {
        id,
        label: t(labelKey, { term }),
        state: searching ? "include" : undefined,
        includeOnly: true,
        toggle: () => setSearch(searching ? "" : term, scope),
      };
    };
    shown = [
      {
        key: "text",
        label: t("textSearchFilterName"),
        options: [
          scopeOption("text-new", SEARCH_TITLES, "filterSearchTitleOption"),
          scopeOption("text-all", SEARCH_ALL, "filterSearchAllOption"),
        ],
      },
      ...shown.filter((g) => g.key !== "text"),
    ];
  }
  // A term only the text search answers ("dissolved oxygen levels") still
  // offers the variable it most resembles, so it does not read as no data.
  const eovGroup = groups.find((g) => g.key === "eovs");
  const closest =
    term &&
    eovGroup &&
    shown.every((g) => g.key === "text" || g.key === "region") &&
    closestOption(
      eovGroup.options.filter((o) => !o.shortcut),
      term,
    );
  if (closest) {
    shown = [
      {
        ...eovGroup,
        options: [
          {
            ...closest,
            label: t("filterSearchClosestOption", { label: closest.label }),
          },
        ],
      },
      ...shown,
    ];
  }
  // Places come after the filter values, where their slower answer lands
  // without shifting the suggestions already being read; the text search
  // closes the list.
  const tail = ["region", "text"];
  shown = [
    ...pinned,
    ...exactNameFirst(
      [
        ...shown.filter((g) => !tail.includes(g.key)),
        ...tail.flatMap((key) => shown.filter((g) => g.key === key)),
      ],
      term,
      "region",
    ),
  ];
  // The rest of a group is an option too, so the arrow keys reach it; with an
  // empty box a group lists what's applied, which is never cut.
  if (term) {
    shown = shown.map((group) => {
      const hidden = group.options.length - SHOWN_PER_GROUP;
      if (hidden <= 1 || expanded.has(group.key)) return group;
      return {
        ...group,
        options: [
          ...group.options.slice(0, SHOWN_PER_GROUP),
          {
            id: "more",
            label: t("filterSearchShowMore", { count: hidden }),
            icon: ChevronDown,
            command: true,
            includeOnly: true,
            action: t("filterSearchShowMoreAction"),
            toggle: () => setExpanded((prev) => new Set(prev).add(group.key)),
          },
        ],
      };
    });
  }
  const flat = shown.flatMap((group) =>
    group.options.map((option) => ({ group, option })),
  );
  const optionKey = (group, option) => `${group.key}:${option.id}`;
  const current = flat.find(
    ({ group, option }) => optionKey(group, option) === currentKey,
  );

  const targetFor = (option) =>
    exclude ? "exclude" : term ? "include" : option.state;
  const removes = (option) =>
    option.includeOnly
      ? Boolean(option.state)
      : targetFor(option) === option.state;
  const actionLabel = (option) =>
    option.action ??
    (removes(option)
      ? t("filterSearchActionRemove")
      : exclude
        ? t("filterOptionExcludeAction")
        : t("filterSearchActionAdd"));

  function chooseSecondary(option) {
    option.secondary.run();
    setShowFiltersModal(false);
  }

  function choose({ group, option }) {
    if (!term) {
      setTouched((prev) => new Set(prev).add(`${group.key}:${option.id}`));
      option.toggle(option.state ?? "include");
    } else option.toggle(targetFor(option));
    if (option.closes) setShowFiltersModal(false);
  }

  // With no option in focus (nothing typed yet, or a paste, after which
  // react-aria leaves focus unset), Enter takes the first.
  function onKeyDown(e) {
    if (e.key !== "Enter" || !flat.length) return;
    if (e.currentTarget.getAttribute("aria-activedescendant")) return;
    e.preventDefault();
    const first = flat[0];
    if (e.shiftKey && first.option.secondary) chooseSecondary(first.option);
    else choose(first);
  }

  function changeText(value) {
    setText(value);
    setTouched(new Set());
    setExpanded(new Set());
  }

  return (
    <div
      className={classNames("filterSearchPage", { excluding: exclude })}
      data-testid="filter-search"
    >
      <h3 className="filterOptionsTitle">{t("filterSearchLabel")}</h3>
      <Autocomplete inputValue={text} onInputChange={changeText}>
        {/* A first Escape empties the box; the next one is Modal's, and
            closes. */}
        <SearchField
          className={classNames("filterSearchField", {
            busy: places.loading,
          })}
          aria-label={t("filterSearchLabel")}
        >
          <Search size={16} aria-hidden="true" />
          <Input
            ref={inputRef}
            className="filterSearchInput"
            data-testid="filter-search-input"
            placeholder={t("filterSearchPlaceholder")}
            aria-busy={places.loading}
            onKeyDown={onKeyDown}
          />
          {text && (
            <Button
              className="filterSearchClear"
              data-testid="filter-search-clear"
              title={t("filterClearSearchTitle")}
              aria-label={t("filterClearSearchTitle")}
            >
              <X size={18} aria-hidden="true" />
            </Button>
          )}
          <kbd className="filterSearchKey">Esc</kbd>
        </SearchField>
        <div className="filterSearchResults">
          {flat.length > 0 ? (
            <ListBox
              className="filterSearchList"
              aria-label={t("filterSearchLabel")}
            >
              {shown.map((group) => (
                <ListBoxSection key={group.key} id={group.key}>
                  <Header className="filterSearchGroupLabel">
                    <GroupIcon groupKey={group.key} />
                    {group.label}
                    {group.shapes && (
                      <span
                        role="group"
                        className="filterSearchGroupShapes"
                        aria-label={t("regionSearchShape")}
                      >
                        {group.shapes.map((s) => (
                          // Pressing one leaves focus in the box.
                          <ToggleButton
                            key={s.id}
                            className="filterSearchGroupOpen"
                            data-testid={`filter-search-region-${s.id}`}
                            isSelected={s.pressed}
                            onChange={s.choose}
                            preventFocusOnPress
                          >
                            {s.label}
                          </ToggleButton>
                        ))}
                      </span>
                    )}
                    {group.panelName && (
                      <Button
                        className="filterSearchGroupOpen"
                        data-testid="filter-search-open-panel"
                        onPress={() => setOpenFilter(group.panelName)}
                        preventFocusOnPress
                        aria-label={t("filterSearchOpenInPanel", {
                          filter: group.label,
                        })}
                      >
                        {t("filterSearchAllOptions")}
                        <ChevronRight size={12} aria-hidden="true" />
                      </Button>
                    )}
                  </Header>
                  {group.options.map((option) => (
                    <ListBoxItem
                      key={option.id}
                      id={optionKey(group, option)}
                      textValue={option.label}
                      className={classNames("filterSearchOption", {
                        shortcut: option.shortcut,
                      })}
                      data-testid="filter-search-option"
                      data-state={option.state ?? "none"}
                      onFocus={() => setCurrentKey(optionKey(group, option))}
                      onPress={(e) =>
                        e.shiftKey && option.secondary
                          ? chooseSecondary(option)
                          : choose({ group, option })
                      }
                    >
                      <FilterSearchOption
                        group={group}
                        option={option}
                        term={term}
                        actionLabel={actionLabel(option)}
                        onSecondary={() => chooseSecondary(option)}
                      />
                    </ListBoxItem>
                  ))}
                </ListBoxSection>
              ))}
            </ListBox>
          ) : term ? (
            <p className="filterSearchEmpty" role="status">
              {t("filterSearchNoResults", { term })}
            </p>
          ) : (
            <FilterSearchHelp
              showSpecies={obisDataAvailable}
              onExample={(example) => {
                changeText(example);
                inputRef.current?.focus();
              }}
            />
          )}
          {places.loading && (
            <div role="status" className="filterSearchPending">
              <span className="filterSearchGroupLabel">
                <GroupIcon groupKey="region" />
                {t("regionSearchGroup")}
              </span>
              <span className="filterSearchPendingText">
                <Spinner size="sm" role={null} />
                {t("regionSearchLoading")}
              </span>
            </div>
          )}
        </div>
      </Autocomplete>
      <footer className="filterSearchKeys" aria-hidden="true">
        <kbd className="filterSearchKey">↑↓</kbd>
        {t("filterSearchKeysNavigate")}
        <kbd className="filterSearchKey">↵</kbd>
        {current ? actionLabel(current.option) : t("filterSearchKeysSelect")}
        {current?.option.secondary && (
          <>
            <kbd className="filterSearchKey">⇧↵</kbd>
            {current.option.secondary.label}
          </>
        )}
        <kbd className="filterSearchKey">Esc</kbd>
        {t("filterSearchKeysClose")}
      </footer>
    </div>
  );
}

function FilterSearchOption({ group, option, term, actionLabel, onSecondary }) {
  const { t } = useTranslation();
  const highlight = (text) =>
    group.key === "scientificName" ? (
      <MatchHighlight text={text} query={term} />
    ) : (
      text
    );
  return (
    <>
      <span className="filterSearchOptionState" aria-hidden="true">
        {option.icon && <option.icon size={14} />}
        {!option.command && (
          <OptionStateIcon
            isSelected={option.state === "include"}
            isExcluded={option.state === "exclude"}
          />
        )}
      </span>
      <span className="filterSearchOptionText">
        <span className="filterSearchOptionLabel">
          {option.state === "exclude" && (
            <span className="filterSearchOptionNot" aria-hidden="true">
              {t("filterNotTag")}
            </span>
          )}
          {option.shortcut && (
            <span className="filterSearchOptionTag">
              {t("filterSearchCategoryTag")}
            </span>
          )}
          {highlight(option.label)}
          {option.hint && (
            <span className="filterSearchOptionHint">
              {highlight(option.hint)}
            </span>
          )}
          <ExcludedLabel isExcluded={option.state === "exclude"} />
        </span>
        {option.description && (
          <span className="filterSearchOptionDescription">
            {option.description}
          </span>
        )}
      </span>
      <span className="filterSearchOptionAction">{actionLabel}</span>
      {option.secondary && (
        <Button
          className="filterSearchOptionSecondary"
          data-testid="filter-search-option-secondary"
          onPress={onSecondary}
          preventFocusOnPress
          aria-label={`${option.secondary.label}: ${option.label}`}
        >
          <GeoAlt size={12} aria-hidden="true" />
          {option.secondary.label}
        </Button>
      )}
    </>
  );
}
