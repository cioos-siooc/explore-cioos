import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import isEmpty from "lodash-es/isEmpty";

import { useChanged } from "../../utilities.jsx";
import { usePersistentState } from "../usePersistentState.js";
import { useSelection } from "../selection/SelectionProvider.jsx";
import useMediaQuery from "./useMediaQuery.js";

const UIContext = createContext();

// Above this the list sits beside the map by default; below it the map leads.
const WIDE_SCREEN_QUERY = "(min-width: 1400px)";

export function useUI() {
  return useContext(UIContext);
}

// Adjust-during-render rather than an effect so the sidebar and what it is
// raised for land in the same paint; an effect showed a frame of the closed
// sidebar, which on a phone read as a dropped tap.
function useRevealSidebar(value, isPresent, setSidebarOpenState) {
  if (useChanged(value) && isPresent(value)) setSidebarOpenState(true);
}

export default function UIProvider({ children }) {
  const { polygon, selectedTrajectory, inspectDataset, pointsToReview } =
    useSelection();

  const wideScreen = useMediaQuery(WIDE_SCREEN_QUERY);
  const [sidebarOpen, setSidebarOpenState] = useState(wideScreen);
  // Once the user opens or closes the list, the screen-size default stops.
  const sidebarChosenRef = useRef(false);
  const setSidebarOpen = useCallback((next) => {
    sidebarChosenRef.current = true;
    setSidebarOpenState(next);
  }, []);

  // Follow the breakpoint until the user chooses, so a resize or rotation gets
  // the default for its current size.
  useEffect(() => {
    if (!sidebarChosenRef.current) setSidebarOpenState(wideScreen);
  }, [wideScreen]);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showCoverageModal, setShowCoverageModal] = useState(false);
  // Seeded from ?coverageAxis= so a link keeps it.
  const [coverageAxis, setCoverageAxis] = useState(() =>
    new URL(window.location.href).searchParams.get("coverageAxis") ===
    "seasonal"
      ? "seasonal"
      : "timeline",
  );
  const [taxonomyView, setTaxonomyView] = useState(() =>
    new URL(window.location.href).searchParams.get("taxonomy") === "tree"
      ? "tree"
      : "sunburst",
  );
  const [showSelectionHelpModal, setShowSelectionHelpModal] = useState(false);
  const [openFilter, setOpenFilter] = useState();
  const [quickFiltersCollapsed, setQuickFiltersCollapsed] = useState(false);
  // Persisted only on close, so a reload before dismissing still shows it.
  const [introSeen, setIntroSeen] = usePersistentState("introSeen", false);
  const [showIntroModal, setShowIntroModal] = useState(!introSeen);
  useEffect(() => {
    if (!showIntroModal) setIntroSeen(true);
  }, [showIntroModal, setIntroSeen]);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  // Opens on the search page rather than whichever filter was open last.
  const openFilters = useCallback(() => {
    setOpenFilter(undefined);
    setShowFiltersModal(true);
  }, []);
  // Set when opened by typing (useFilterSearchShortcut); null otherwise.
  const [filterSearchText, setFilterSearchText] = useState(null);
  const openFilterSearch = useCallback(
    (text = "") => {
      setFilterSearchText(text);
      openFilters();
    },
    [openFilters],
  );
  if (!showFiltersModal && filterSearchText !== null) setFilterSearchText(null);

  // Wide screens only: narrower, the list would cover the shape just drawn.
  // These reveals don't count as the user's choice about the list.
  useRevealSidebar(
    polygon,
    (value) => wideScreen && !isEmpty(value),
    setSidebarOpenState,
  );

  // Keyed on the pk: a results refresh hands the open dataset back as a new
  // object, which must not reopen a sidebar the user collapsed over it.
  useRevealSidebar(inspectDataset?.pk, Boolean, setSidebarOpenState);

  useRevealSidebar(selectedTrajectory, Boolean, setSidebarOpenState);

  // Only a growing selection reveals the list (so the basket visibly grows on
  // a phone); unticking must not reopen a list the user put away.
  const previousDownloadCount = useRef(0);
  useEffect(() => {
    const count = isEmpty(pointsToReview) ? 0 : pointsToReview.length;
    if (count > previousDownloadCount.current) setSidebarOpenState(true);
    previousDownloadCount.current = count;
  }, [pointsToReview]);

  const value = {
    sidebarOpen,
    setSidebarOpen,
    showFiltersModal,
    setShowFiltersModal,
    showDownloadModal,
    setShowDownloadModal,
    showCoverageModal,
    setShowCoverageModal,
    coverageAxis,
    setCoverageAxis,
    taxonomyView,
    setTaxonomyView,
    showSelectionHelpModal,
    setShowSelectionHelpModal,
    openFilter,
    setOpenFilter,
    quickFiltersCollapsed,
    setQuickFiltersCollapsed,
    showIntroModal,
    setShowIntroModal,
    showPrivacyModal,
    setShowPrivacyModal,
    filterSearchText,
    openFilters,
    openFilterSearch,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
