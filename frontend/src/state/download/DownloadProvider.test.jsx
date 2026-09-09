import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useDownload } from "./DownloadProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";
import { useFilters } from "../filters/FilterProvider.jsx";

let download;
let selection;
let filters;

function Probe() {
  download = useDownload();
  selection = useSelection();
  filters = useFilters();
  // Wait for SelectionProvider's own initial /pointQuery load too, not just
  // the catalog: that load settling recomputes pointsToReview and, seeing it
  // empty (nothing pre-selected), resets pointsToDownload — a race that would
  // otherwise clobber a value a test sets right after "ready".
  const ready = filters.catalogLoaded && selection.initialPointsQueryComplete;
  return <span data-testid="state">{ready ? "ready" : "loading"}</span>;
}

async function renderReady() {
  const result = renderWithProviders(<Probe />, { providers: "app" });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

describe("DownloadProvider", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("seeds email from the remembered cookie, or nothing", async () => {
    document.cookie = "email=diver@example.com; path=/";
    await renderReady();
    expect(download.email).toBe("diver@example.com");
  });

  it("validates the email as it's edited", async () => {
    await renderReady();
    act(() => download.setEmail("not-an-email"));
    expect(download.emailValid).toBe(false);
    act(() => download.setEmail("diver@example.com"));
    expect(download.emailValid).toBe(true);
  });

  it("submits to /download and reports success", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/download?")) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return realFetch(input, init);
    };

    const { i18n } = await renderReady();
    act(() => {
      selection.setPointsToDownload([{ pk: 1 }, { pk: 2 }]);
      download.setEmail("diver@example.com");
    });
    act(() => download.handleSubmission());
    expect(download.submissionFeedback?.text).toBe(
      i18n.t("submissionStateTextSubmitting"),
    );
    await waitFor(() =>
      expect(download.submissionFeedback?.text).toBe(
        i18n.t("submissionStateTextSuccess"),
      ),
    );
  });

  it("reports failure when the API responds with an error status", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/download?")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return realFetch(input, init);
    };

    const { i18n } = await renderReady();
    act(() => {
      selection.setPointsToDownload([{ pk: 1 }]);
      download.setEmail("diver@example.com");
    });
    act(() => download.handleSubmission());
    await waitFor(() =>
      expect(download.submissionFeedback?.text).toBe(
        i18n.t("submissionStateTextFailed"),
      ),
    );
  });

  it("clears the submission verdict once the download selection empties out", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/download?")) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return realFetch(input, init);
    };

    await renderReady();
    act(() => {
      selection.setPointsToDownload([{ pk: 1 }]);
      download.setEmail("diver@example.com");
    });
    act(() => download.handleSubmission());
    await waitFor(() => expect(download.submissionFeedback).toBeTruthy());

    act(() => selection.setPointsToDownload());
    await waitFor(() => expect(download.submissionFeedback).toBeFalsy());
  });

  it("editing the email retracts the previous submission's verdict", async () => {
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/download?")) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return realFetch(input, init);
    };

    await renderReady();
    act(() => {
      selection.setPointsToDownload([{ pk: 1 }]);
      download.setEmail("diver@example.com");
    });
    act(() => download.handleSubmission());
    await waitFor(() => expect(download.submissionFeedback).toBeTruthy());

    act(() => download.handleEmailChange("someone-else@example.com"));
    expect(download.submissionFeedback).toBeFalsy();
  });

  it("tracks whether a drawn polygon makes the polygon download filter active", async () => {
    await renderReady();
    expect(download.polygonFilterActive).toBe(false);
    const rect = [
      [-130, 45],
      [-120, 45],
      [-120, 55],
      [-130, 55],
      [-130, 45],
    ];
    act(() => selection.setPolygon(rect));
    await waitFor(() => expect(download.polygonFilterActive).toBe(true));
    expect(download.filterDownloadByPolygon).toBe(true);
  });

  it("defaults filterDownloadByTime/Depth to whatever the active filters are doing", async () => {
    await renderReady();
    expect(download.filterDownloadByTime).toBe(false);
    act(() => filters.setStartDate("2015-01-01"));
    await waitFor(() => expect(download.filterDownloadByTime).toBe(true), {
      timeout: 2000,
    });
  });
});
