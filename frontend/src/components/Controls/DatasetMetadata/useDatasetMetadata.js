import { useEffect, useState } from "react";

import { server } from "../../../config";
import reportError from "../../../state/reportError.js";

// The harvested descriptive metadata of one dataset (abstract, citation,
// contacts, ...), from /datasets/metadata. Tagged with the request it answers,
// so a dataset switch or a retry reads as loading until its own response lands.
export default function useDatasetMetadata(datasetPk) {
  const [attempt, setAttempt] = useState(0);
  const request = `${datasetPk}#${attempt}`;
  const [state, setState] = useState({ request: undefined });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${server}/datasets/metadata?datasetPKs=${datasetPk}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`datasets/metadata failed: ${response.status}`);
        }
        return response.json();
      })
      .then((metadata) => setState({ request, metadata }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("datasets/metadata fetch failed", error);
        setState({ request, error });
      });
    return () => controller.abort();
  }, [datasetPk, request]);

  const loading = state.request !== request;
  return {
    metadata: loading ? undefined : state.metadata,
    loading,
    error: !loading && Boolean(state.error),
    retry: () => setAttempt((n) => n + 1),
  };
}
