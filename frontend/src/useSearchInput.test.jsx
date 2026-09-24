import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useSearchInput } from "./utilities.jsx";

// A search box wired exactly as the real ones are: the text comes from the
// caller's state, the setter is what the box publishes into, and the field
// sits in a form so Enter and the button are the one submit.
function SearchBox({ value, onChange, trigger, delay }) {
  const [text, setText, submit] = useSearchInput(value, onChange, {
    trigger,
    delay,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        aria-label="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit">Search</button>
    </form>
  );
}

// One change event per character, as the input sees them. Typed through
// fireEvent rather than userEvent because userEvent runs its own clock, and the
// clock here is the thing under test.
function type(text) {
  const input = screen.getByLabelText("search");
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: input.value + text[i - 1] } });
  }
}

const search = () => fireEvent.click(screen.getByText("Search"));

describe("useSearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The default: for a box whose search is an array filter over options
  // already in memory, a pause is cheap enough and needs no button.
  describe('trigger "pause"', () => {
    it("shows every keystroke at once, and publishes none of them while typing", () => {
      const onChange = vi.fn();
      render(<SearchBox value="" onChange={onChange} delay={300} />);

      type("temp");

      expect(screen.getByLabelText("search")).toHaveValue("temp");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("publishes once, with the whole word, after typing pauses", () => {
      const onChange = vi.fn();
      render(<SearchBox value="" onChange={onChange} delay={300} />);

      type("temp");
      act(() => vi.advanceTimersByTime(299));
      expect(onChange).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("temp");
    });

    it("publishes a pause mid-word, and keeps taking keystrokes after it", () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <SearchBox value="" onChange={onChange} delay={300} />,
      );
      type("te");
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenLastCalledWith("te");

      // The caller's state now follows what was published. The box must not be
      // reset to it — the user is still typing into it.
      rerender(<SearchBox value="te" onChange={onChange} delay={300} />);
      type("mp");
      expect(screen.getByLabelText("search")).toHaveValue("temp");

      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith("temp");
    });

    // Enter in one of these boxes means "now", not "wait out the rest of the
    // delay" — and it must not then publish a second time when the delay ends.
    it("publishes on submit without waiting for the pause, and only once", () => {
      const onChange = vi.fn();
      render(<SearchBox value="" onChange={onChange} delay={300} />);

      type("temp");
      search();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("temp");

      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  // The free-text dataset search: every distinct value is a round of map
  // requests, so nothing goes until it is asked for.
  describe('trigger "submit"', () => {
    it("publishes nothing while typing, however long the typing stops for", () => {
      const onChange = vi.fn();
      render(<SearchBox value="" onChange={onChange} trigger="submit" />);

      type("temp");
      act(() => vi.advanceTimersByTime(5000));

      expect(screen.getByLabelText("search")).toHaveValue("temp");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("publishes the typed text on submit", () => {
      const onChange = vi.fn();
      render(<SearchBox value="" onChange={onChange} trigger="submit" />);

      type("temp");
      search();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("temp");
    });

    it("ignores a submit that would re-publish what is already searched for", () => {
      const onChange = vi.fn();
      render(<SearchBox value="temp" onChange={onChange} trigger="submit" />);

      search();

      expect(onChange).not.toHaveBeenCalled();
    });

    // Not having pressed Enter is a weaker signal than having typed the word:
    // closing the pane searches for it rather than dropping it.
    it("publishes what was typed but not submitted when the box goes away", () => {
      const onChange = vi.fn();
      const { unmount } = render(
        <SearchBox value="" onChange={onChange} trigger="submit" />,
      );

      type("temp");
      unmount();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("temp");
    });
  });

  // The rules about never losing what was asked for hold whatever publishes
  // the box, so they are asserted against both triggers.
  describe.each(["pause", "submit"])('trigger "%s", either way', (trigger) => {
    it("publishes an emptied box at once", () => {
      const onChange = vi.fn();
      render(<SearchBox value="temp" onChange={onChange} trigger={trigger} />);

      fireEvent.change(screen.getByLabelText("search"), {
        target: { value: "" },
      });

      expect(onChange).toHaveBeenCalledWith("");
    });

    it("takes an outside change — Reset, a chip removed — into the box, dropping the draft", () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <SearchBox value="temp" onChange={onChange} trigger={trigger} />,
      );

      type("era");
      rerender(<SearchBox value="" onChange={onChange} trigger={trigger} />);
      expect(screen.getByLabelText("search")).toHaveValue("");

      // Neither a pause nor a submit brings the dropped draft back.
      act(() => vi.advanceTimersByTime(300));
      search();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("publishes what is still unpublished when the box goes away, once", () => {
      const onChange = vi.fn();
      const { unmount } = render(
        <SearchBox value="" onChange={onChange} trigger={trigger} />,
      );

      type("temp");
      unmount();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("temp");
      // …and the dropped timer doesn't publish it a second time.
      act(() => vi.advanceTimersByTime(300));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
