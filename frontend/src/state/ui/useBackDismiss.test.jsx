import * as React from "react";
import { useState } from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";

import useBackDismiss from "./useBackDismiss.js";

let navigate;
let setOpen;
let location;

function Surface({ initiallyOpen = false }) {
  const [open, setOpenState] = useState(initiallyOpen);
  setOpen = setOpenState;
  navigate = useNavigate();
  location = useLocation();
  useBackDismiss(open, () => setOpenState(false));
  return <span data-testid="surface">{open ? "open" : "closed"}</span>;
}

function renderSurface(props) {
  return render(
    <MemoryRouter initialEntries={["/?lang=en"]}>
      <Surface {...props} />
    </MemoryRouter>,
  );
}

const state = () => screen.getByTestId("surface").textContent;
const go = (to, options) => act(() => navigate(to, options));

describe("useBackDismiss", () => {
  it("closes the surface on Back instead of leaving its address", () => {
    renderSurface();
    act(() => setOpen(true));
    const openKey = location.key;
    go(-1);
    expect(state()).toBe("closed");
    expect(location.key).not.toBe(openKey);
    expect(location.search).toBe("?lang=en");
  });

  it("takes its entry back off when closed another way", () => {
    renderSurface();
    const startKey = location.key;
    act(() => setOpen(true));
    act(() => setOpen(false));
    expect(location.key).toBe(startKey);
  });

  it("follows its entry through the address being replaced", () => {
    renderSurface();
    act(() => setOpen(true));
    go("/?lang=en&eovs=oxygen", { replace: true });
    go(-1);
    expect(state()).toBe("closed");
  });

  it("leaves Back from an entry pushed above it to that entry", () => {
    renderSurface();
    act(() => setOpen(true));
    go("/?lang=en&dataset=a");
    go(-1);
    expect(state()).toBe("open");
    go(-1);
    expect(state()).toBe("closed");
  });

  it("does not pop someone else's entry when closed from above it", () => {
    renderSurface();
    act(() => setOpen(true));
    go("/?lang=en&dataset=a");
    const pageKey = location.key;
    act(() => setOpen(false));
    expect(location.key).toBe(pageKey);
  });
});
