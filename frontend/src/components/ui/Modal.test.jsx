import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "./Modal.jsx";
import { MOBILE_WIDTH, setViewportWidth } from "../../test/viewport.js";

// jsdom has no PointerEvent; a MouseEvent carries the coordinates, and the
// fields the drag reads are added to it.
function pointer(target, type, clientY) {
  const event = new MouseEvent(type, { bubbles: true, clientY, button: 0 });
  Object.defineProperty(event, "isPrimary", { value: true });
  fireEvent(target, event);
}

describe("Modal", () => {
  it("renders nothing when show is false", () => {
    render(
      <Modal show={false}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content into a portal when show is true", () => {
    render(
      <Modal show>
        <Modal.Body>hello</Modal.Body>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("calls onHide on Escape", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("closes only the top dialog on Escape, keeping the body locked under it", async () => {
    const user = userEvent.setup();
    const hideOuter = vi.fn();
    const hideInner = vi.fn();
    const { rerender } = render(
      <>
        <Modal show onHide={hideOuter}>
          <Modal.Body>outer</Modal.Body>
        </Modal>
        <Modal show={false} onHide={hideInner}>
          <Modal.Body>inner</Modal.Body>
        </Modal>
      </>,
    );
    rerender(
      <>
        <Modal show onHide={hideOuter}>
          <Modal.Body>outer</Modal.Body>
        </Modal>
        <Modal show onHide={hideInner}>
          <Modal.Body>inner</Modal.Body>
        </Modal>
      </>,
    );
    await user.keyboard("{Escape}");
    expect(hideInner).toHaveBeenCalledTimes(1);
    expect(hideOuter).not.toHaveBeenCalled();

    rerender(
      <>
        <Modal show onHide={hideOuter}>
          <Modal.Body>outer</Modal.Body>
        </Modal>
        <Modal show={false} onHide={hideInner}>
          <Modal.Body>inner</Modal.Body>
        </Modal>
      </>,
    );
    expect(document.body).toHaveClass("cioos-modal-open");
    await user.keyboard("{Escape}");
    expect(hideOuter).toHaveBeenCalledTimes(1);
  });

  it("calls onHide on a backdrop click, but not on a click inside the dialog", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    await user.click(screen.getByText("content"));
    expect(onHide).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("Modal.Header's close button calls onHide", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Header closeButton>
          <Modal.Title>Title</Modal.Title>
        </Modal.Header>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", async () => {
    function Harness() {
      const [show, setShow] = React.useState(false);
      return (
        <>
          <button onClick={() => setShow(true)}>open</button>
          <Modal show={show} onHide={() => setShow(false)}>
            <Modal.Body>content</Modal.Body>
          </Modal>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  // `onHide` is a new inline arrow each render; a re-render is not an opening
  // and must not take the caret off an input mid-word.
  it("leaves focus where it is when the app re-renders underneath it", async () => {
    function Harness() {
      const [, setTick] = React.useState(0);
      return (
        <Modal show onHide={() => {}}>
          <Modal.Body>
            <input aria-label="search" onChange={() => setTick((n) => n + 1)} />
          </Modal.Body>
        </Modal>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText("search");
    await user.click(box);
    await user.type(box, "temp");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("temp");
  });

  it("applies a data-testid when given one", () => {
    render(
      <Modal show data-testid="filters-modal">
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    expect(screen.getByTestId("filters-modal")).toBeInTheDocument();
  });

  it("names the dialog from an aria-label when its visible title is not the whole name", () => {
    render(
      <Modal show aria-label="CIOOS Data Explorer">
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    expect(
      screen.getByRole("dialog", { name: "CIOOS Data Explorer" }),
    ).toBeInTheDocument();
  });

  describe("as a sheet on a phone", () => {
    function Sheet({ show = true, onHide = () => {} }) {
      return (
        <Modal show={show} onHide={onHide} sheet>
          <Modal.Header closeButton>
            <Modal.Title>Filters</Modal.Title>
          </Modal.Header>
          <Modal.Body>content</Modal.Body>
        </Modal>
      );
    }

    it("is a centred dialog with no handle above the phone rung", () => {
      render(<Sheet />);
      expect(screen.getByRole("dialog")).not.toHaveClass("sheet");
      expect(document.querySelector(".sheetHandle")).toBeNull();
    });

    it("stays mounted after closing until its slide out ends", () => {
      setViewportWidth(MOBILE_WIDTH);
      const { rerender } = render(<Sheet />);
      expect(screen.getByRole("dialog")).toHaveClass("sheet");
      rerender(<Sheet show={false} />);
      const sheet = document.querySelector(".modal.sheetClosing");
      expect(sheet).toBeInTheDocument();
      const content = sheet.querySelector(".modal-content");
      act(() => {
        fireEvent.transitionEnd(content, { propertyName: "transform" });
      });
      expect(document.querySelector(".modal")).toBeNull();
    });

    it("is dismissed by a drag down from its header", () => {
      setViewportWidth(MOBILE_WIDTH);
      const onHide = vi.fn();
      render(<Sheet onHide={onHide} />);
      const title = screen.getByText("Filters");
      pointer(title, "pointerdown", 100);
      pointer(window, "pointermove", 160);
      pointer(window, "pointermove", 400);
      pointer(window, "pointerup", 400);
      expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("is not dragged from its body, or by a tap on its header", () => {
      setViewportWidth(MOBILE_WIDTH);
      const onHide = vi.fn();
      render(<Sheet onHide={onHide} />);
      pointer(screen.getByText("content"), "pointerdown", 100);
      pointer(window, "pointermove", 400);
      pointer(window, "pointerup", 400);
      pointer(screen.getByText("Filters"), "pointerdown", 100);
      pointer(window, "pointerup", 102);
      expect(onHide).not.toHaveBeenCalled();
    });
  });
});
