import { useFilters } from "./filters/FilterProvider.jsx";
import useOptionCategories from "./useOptionCategories.js";

// Matching *every* EOV of a category is almost never meant, so including one
// switches match-all off.
export default function useEovCategories() {
  const { eovsSelected, setEovsSelected, setEovsMatchAll } = useFilters();
  return useOptionCategories(eovsSelected, setEovsSelected, () =>
    setEovsMatchAll(false),
  );
}
