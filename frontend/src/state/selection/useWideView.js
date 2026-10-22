import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router";

import { WIDE_PARAM } from "./previewParams.js";
import useMediaQuery, { MOBILE_QUERY } from "../ui/useMediaQuery.js";

// Replace, not push: widening the card is not a place to go Back to. A phone's
// card is already a full-screen sheet, so a wide link opens it as one there.
export default function useWideView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const wide = searchParams.get(WIDE_PARAM) === "1" && !isMobile;
  const setWide = useCallback(
    (value) => {
      if (value === wide) return;
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value) next.set(WIDE_PARAM, "1");
          else next.delete(WIDE_PARAM);
          return next;
        },
        { replace: true, state: location.state },
      );
    },
    [wide, setSearchParams, location.state],
  );
  return [wide, setWide];
}
