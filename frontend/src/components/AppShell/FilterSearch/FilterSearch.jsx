import * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BoxArrowUpRight, BroadcastPin, Search } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { server } from "../../../config.js";
import { useDebounce } from "../../../utilities.jsx";
import fetchJson from "../../../state/fetchJson.js";
import reportError from "../../../state/reportError.js";
import {
  matchFilterOptions,
  parseFilterQuery,
  parsePartialRangeQuery,
} from "../../../state/filterSearch.js";
import {
  filterNameForKey,
  iconForKey,
} from "../../../state/useActiveFilters.js";
import useFilterSearchOptions from "../../../state/useFilterSearchOptions.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import Modal from "../../ui/Modal.jsx";
import { TOO_BROAD_RANKS } from "../../Controls/Filter/ScientificNameFilter/ScientificNameFilter.jsx";
import {
  ExcludedLabel,
  OptionStateIcon,
} from "../../Controls/Filter/MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

const SCIENTIFIC_NAME_MIN_LENGTH = 3;
const MATCHES_PER_GROUP = 8;

// WoRMS hits for the term, which unlike every other facet live behind the API
// rather than in memory. Kept with the term they answer so a stale reply is
// simply not shown, rather than cleared by an effect.
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
            (i) => i?.scientificName && !TOO_BROAD_RANKS.has(i.rank),
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

const GROUP_ICONS = { text: Search, quick: BroadcastPin };

function GroupIcon({ groupKey, size = 14 }) {
  const Icon = GROUP_ICONS[groupKey];
  return Icon ? <Icon size={size} aria-hidden="true" /> : iconForKey(groupKey);
}

// The Filters modal row an option is set from, for the detail pane's link.
function panelFilterName(groupKey, option, t) {
  if (groupKey === "text") return "textSearchFilterName";
  if (option.id === "realtime") return t("realtimeFilterName");
  if (option.id === "inView") return t("datasetsCardOnlyInViewText");
  return filterNameForKey(groupKey, t);
}

const isTypingTarget = (el) =>
  el instanceof Element &&
  (el.isContentEditable ||
    el.closest("input, textarea, select, [contenteditable]") !== null);

// Opened from anywhere with Ctrl/⌘+K, by the search button on the brand card,
// or by just starting to type on the page: a letter or digit typed while no
// field has focus and no dialog is up opens it holding that character. Not
// symbols, which the map takes for zoom (+, -, =).
function useFilterSearchShortcut(open) {
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
        isTypingTarget(e.target) ||
        document.body.classList.contains("cioos-modal-open")
      )
        return;
      e.preventDefault();
      open(e.key);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

// A command palette over every filter: typing offers matching values from
// every facet, selecting one applies it (a leading "-" excludes instead) and
// selecting it again removes it, and the empty box lists what is applied. It
// writes the same state the Filters modal and quick filters do, so it sits
// beside them rather than replacing them.
export default function FilterSearch() {
  const { showFilterSearch, setShowFilterSearch } = useUI();
  const titleId = useId();
  const [initialText, setInitialText] = useState("");
  const inputRef = useRef(null);
  const open = useCallback(
    (text) => {
      setInitialText(text);
      setShowFilterSearch(true);
    },
    [setShowFilterSearch],
  );
  useFilterSearchShortcut(open);

  return (
    <Modal
      show={showFilterSearch}
      onHide={() => setShowFilterSearch(false)}
      className="filterSearchModal"
      dialogClassName="filterSearchDialog"
      aria-labelledby={titleId}
      data-testid="filter-search"
      initialFocusRef={inputRef}
    >
      <FilterSearchPalette
        titleId={titleId}
        initialText={initialText}
        inputRef={inputRef}
      />
    </Modal>
  );
}

// Mounted per opening, so each one starts from an empty box.
function FilterSearchPalette({ titleId, initialText, inputRef }) {
  const { t } = useTranslation();
  const { obisDataAvailable } = useFilters();
  const { datasetTitleSearchText, setDatasetTitleSearchText } = useSelection();
  const { setShowFilterSearch, setOpenFilter, setShowFiltersModal } = useUI();
  const listId = useId();
  const [text, setText] = useState(initialText);
  const [activeIndex, setActiveIndex] = useState(0);
  // What was selected since the box last changed. Selecting leaves the list as
  // it is, so several values can be picked in a row: the empty box would
  // otherwise drop a value the moment it was removed.
  const [touched, setTouched] = useState(() => new Set());

  const { term, exclude } = parseFilterQuery(text);
  const groups = useFilterSearchOptions(
    useScientificNameMatches(term, obisDataAvailable),
    exclude ? undefined : parsePartialRangeQuery(term),
  );
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
    const searching = datasetTitleSearchText === term;
    shown = [
      {
        key: "text",
        label: t("textSearchFilterName"),
        options: [
          {
            id: "text-new",
            label: t("filterSearchTitleOption", { term }),
            state: searching ? "include" : undefined,
            includeOnly: true,
            toggle: () => setDatasetTitleSearchText(searching ? "" : term),
          },
        ],
      },
      ...shown.filter((g) => g.key !== "text"),
    ];
  }
  shown = [...pinned, ...shown];
  const flat = shown.flatMap((group) =>
    group.options.map((option) => ({ group, option })),
  );
  const active = Math.min(activeIndex, flat.length - 1);
  const current = flat[active];

  useEffect(() => {
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [listId, active]);

  // With a term, selecting includes (or excludes, with "-"), and selecting the
  // state the option is already in clears it; with none, every option listed
  // is an applied one, and selecting it removes it.
  const targetFor = (option) =>
    exclude ? "exclude" : term ? "include" : option.state;
  const removes = (option) =>
    option.includeOnly
      ? Boolean(option.state)
      : targetFor(option) === option.state;
  const actionLabel = (option) =>
    removes(option)
      ? t("filterSearchActionRemove")
      : exclude
        ? t("filterOptionExcludeAction")
        : t("filterSearchActionAdd");

  function choose({ group, option }) {
    if (!term) {
      // Removed, it is kept listed so it can be put straight back.
      setTouched((prev) => new Set(prev).add(`${group.key}:${option.id}`));
      option.toggle(option.state ?? "include");
    } else option.toggle(targetFor(option));
  }

  function openInPanel(name) {
    setShowFilterSearch(false);
    setOpenFilter(name);
    setShowFiltersModal(true);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((active + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) choose(current);
    } else if (e.key === "Escape" && text) {
      // A first Escape empties the box; the next one is Modal's, and closes.
      e.stopPropagation();
      setText("");
      setTouched(new Set());
      setActiveIndex(0);
    }
  }

  const panelName =
    current && panelFilterName(current.group.key, current.option, t);
  return (
    <div className={classNames("filterSearch", { excluding: exclude })}>
      <h2 id={titleId} className="sr-only">
        {t("filterSearchLabel")}
      </h2>
      <div className="filterSearchField">
        <Search size={20} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          className="filterSearchInput"
          data-testid="filter-search-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTouched(new Set());
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("filterSearchPlaceholder")}
          aria-label={t("filterSearchLabel")}
          aria-autocomplete="list"
          aria-expanded={flat.length > 0}
          aria-controls={flat.length > 0 ? listId : undefined}
          aria-activedescendant={current ? `${listId}-${active}` : undefined}
        />
        <kbd className="filterSearchKey">Esc</kbd>
      </div>
      <div className="filterSearchResults">
        {flat.length > 0 ? (
          <div
            id={listId}
            role="listbox"
            className="filterSearchList"
            aria-label={t("filterSearchLabel")}
          >
            {shown.map((group) => (
              <div
                key={group.key}
                role="group"
                aria-labelledby={`${listId}-${group.key}`}
              >
                <div
                  id={`${listId}-${group.key}`}
                  role="presentation"
                  className="filterSearchGroupLabel"
                >
                  <GroupIcon groupKey={group.key} />
                  {group.label}
                </div>
                {group.options.map((option) => {
                  const i = flat.findIndex((f) => f.option === option);
                  return (
                    <div
                      key={option.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={classNames("filterSearchOption", {
                        active: i === active,
                      })}
                      data-testid="filter-search-option"
                      data-state={option.state ?? "none"}
                      // Keeps focus in the box, so a pick can be followed
                      // by the next without clicking back into it.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActiveIndex(i)}
                      onClick={() => choose({ group, option })}
                    >
                      <span
                        className="filterSearchOptionState"
                        aria-hidden="true"
                      >
                        <OptionStateIcon
                          isSelected={option.state === "include"}
                          isExcluded={option.state === "exclude"}
                        />
                      </span>
                      <span className="filterSearchOptionText">
                        <span className="filterSearchOptionLabel">
                          {option.state === "exclude" && (
                            <span
                              className="filterSearchOptionNot"
                              aria-hidden="true"
                            >
                              {t("filterNotTag")}
                            </span>
                          )}
                          {option.label}
                          {option.hint && (
                            <span className="filterSearchOptionHint">
                              {option.hint}
                            </span>
                          )}
                          <ExcludedLabel
                            isExcluded={option.state === "exclude"}
                          />
                        </span>
                        {option.description && (
                          <span className="filterSearchOptionDescription">
                            {option.description}
                          </span>
                        )}
                      </span>
                      <span className="filterSearchOptionAction">
                        {actionLabel(option)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="filterSearchEmpty" role="status">
            {term
              ? t("filterSearchNoResults", { term })
              : t("filterSearchIntro")}
          </p>
        )}
      </div>
      <footer className="filterSearchFooter">
        {panelName ? (
          <button
            type="button"
            className="filterSearchPanelLink"
            data-testid="filter-search-open-panel"
            onClick={() => openInPanel(panelName)}
          >
            {t("filterSearchOpenInPanel")}: {current.group.label}
            <BoxArrowUpRight size={12} aria-hidden="true" />
          </button>
        ) : (
          <span>{t("filterSearchHint")}</span>
        )}
        <span className="filterSearchKeys" aria-hidden="true">
          <kbd className="filterSearchKey">↑↓</kbd>
          {t("filterSearchKeysNavigate")}
          <kbd className="filterSearchKey">↵</kbd>
          {current ? actionLabel(current.option) : t("filterSearchKeysSelect")}
          <kbd className="filterSearchKey">Esc</kbd>
          {t("filterSearchKeysClose")}
        </span>
      </footer>
    </div>
  );
}
