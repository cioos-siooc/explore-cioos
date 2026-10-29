import * as React from "react";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import MatchHighlight from "../../../ui/MatchHighlight.jsx";
import Spinner from "../../../ui/Spinner.jsx";
import { server } from "../../../../config.js";
import reportError from "../../../../state/reportError.js";

import { FilterOption } from "../MultiCheckboxFilter/OptionState.jsx";
import "../styles.css";
import "../MultiCheckboxFilter/styles.css";
import "./styles.css";

// Options come from a server typeahead, so picked names are pinned on top:
// otherwise they'd vanish once the search moved on and couldn't be cleared.
export default function ScientificNameFilter({
  scientificNamesSelected,
  setScientificNamesSelected,
  scientificNamesExcluded,
  setScientificNamesExcluded,
  searchTerms,
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language && i18n.language.startsWith("fr") ? "fr" : "en";
  // Already debounced by the pane's search box.
  const searchQuery = searchTerms || "";
  const [suggestions, setSuggestions] = useState([]);
  // Kept so a pinned name keeps its rank/common-name line after the search
  // that offered it has moved on.
  const [detailsByName, setDetailsByName] = useState({});
  const [loading, setLoading] = useState(false);

  const mergeDetails = (items) => {
    setDetailsByName((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (item && item.scientificName && (item.vernacular || item.rank)) {
          next[item.scientificName] = {
            vernacular: item.vernacular,
            rank: item.rank,
          };
        }
      }
      return next;
    });
  };

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const q = encodeURIComponent(searchQuery);
    fetch(`${server}/scientificNames?q=${q}&lang=${lang}&limit=200`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        const normalized = Array.isArray(items)
          ? items.filter((i) => i && i.scientificName)
          : [];
        setSuggestions(normalized);
        mergeDetails(normalized);
      })
      .catch((err) => {
        reportError("scientificNames search failed", err);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [searchQuery, lang]);

  // Hydrates names restored from the URL; re-runs on locale change.
  useEffect(() => {
    const unknown = [
      ...scientificNamesSelected,
      ...scientificNamesExcluded,
    ].filter((n) => !detailsByName[n]);
    if (unknown.length === 0) return;
    const controller = new AbortController();
    const names = encodeURIComponent(unknown.join(","));
    fetch(`${server}/scientificNames?names=${names}&lang=${lang}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((items) => {
        if (Array.isArray(items)) mergeDetails(items);
      })
      .catch((err) => {
        reportError("scientificNames search failed", err);
      });
    return () => controller.abort();
    // detailsByName is this effect's own output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scientificNamesSelected, scientificNamesExcluded, lang]);

  const toggleIn = (name, list, setList, otherList, setOtherList) => {
    if (list.includes(name)) {
      setList(list.filter((n) => n !== name));
    } else {
      setList([...list, name]);
      if (otherList.includes(name)) {
        setOtherList(otherList.filter((n) => n !== name));
      }
    }
  };
  const includeName = (name) =>
    toggleIn(
      name,
      scientificNamesSelected,
      setScientificNamesSelected,
      scientificNamesExcluded,
      setScientificNamesExcluded,
    );
  const excludeName = (name) =>
    toggleIn(
      name,
      scientificNamesExcluded,
      setScientificNamesExcluded,
      scientificNamesSelected,
      setScientificNamesSelected,
    );

  const picked = [...scientificNamesSelected, ...scientificNamesExcluded];
  const options = [
    ...picked.map((scientificName) => ({
      scientificName,
      ...detailsByName[scientificName],
      isSelected: scientificNamesSelected.includes(scientificName),
      isExcluded: scientificNamesExcluded.includes(scientificName),
    })),
    ...suggestions
      .filter((s) => !picked.includes(s.scientificName) && !s.tooBroad)
      .map((s) => ({ ...s, isSelected: false, isExcluded: false })),
  ];

  return (
    <div className="multiCheckboxFilter scientificNameFilter">
      {options.map(
        ({ scientificName, vernacular, rank, isSelected, isExcluded }) => (
          <FilterOption
            key={scientificName}
            label={scientificName}
            isSelected={isSelected}
            isExcluded={isExcluded}
            onInclude={() => includeName(scientificName)}
            onExclude={() => excludeName(scientificName)}
            title={vernacular || scientificName}
          >
            <span className="optionName">
              <span className="scientificNameOptionName">
                <MatchHighlight text={scientificName} query={searchQuery} />
              </span>
              {(rank || vernacular) && (
                <span className="scientificNameOptionDetail">
                  {rank && (
                    <span className="scientificNameOptionRank">{rank}</span>
                  )}
                  {rank && vernacular && " · "}
                  <MatchHighlight text={vernacular} query={searchQuery} />
                </span>
              )}
            </span>
          </FilterOption>
        ),
      )}
      {loading && (
        <div className="scientificNameLoading">
          <Spinner size="sm" />
          {t("scientificNameFilterLoading")}
        </div>
      )}
      {!loading && options.length === 0 && (
        <div className="scientificNameEmpty">
          {t("scientificNameFilterNoResults")}
        </div>
      )}
    </div>
  );
}
