import { describe, it, expect, vi, afterEach } from "vitest";

import fetchJson from "./fetchJson.js";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("resolves with the parsed JSON body on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ a: 1 }), { status: 200 }),
        ),
    );
    await expect(fetchJson("/x")).resolves.toEqual({ a: 1 });
  });

  it("rejects with a real Error, carrying the status, on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("gateway timeout", {
          status: 504,
          statusText: "Gateway Timeout",
        }),
      ),
    );
    await expect(fetchJson("/x")).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining("504"),
    });
  });

  it("uses the API's {error} message and keeps it as the detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "relation missing" }), {
          status: 500,
        }),
      ),
    );
    await expect(fetchJson("/x")).rejects.toMatchObject({
      status: 500,
      message: "relation missing",
      detail: "relation missing",
    });
  });

  it("leaves the detail empty when the error body isn't API JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );
    await expect(fetchJson("/x")).rejects.toMatchObject({
      status: 502,
      detail: undefined,
    });
  });

  it("never calls response.json() on a non-2xx body (avoids the HTML-error-page parse crash)", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json,
      }),
    );
    await expect(fetchJson("/x")).rejects.toThrow();
    expect(json).not.toHaveBeenCalled();
  });

  it("passes options through to fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("/x", { signal: "abort-signal-stand-in" });
    expect(fetchMock).toHaveBeenCalledWith("/x", {
      signal: "abort-signal-stand-in",
    });
  });
});
