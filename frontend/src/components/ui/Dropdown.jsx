import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import "./dropdownStyles.css";

const DropdownContext = createContext({ close: () => {} });

// Replacement for react-bootstrap's DropdownButton + Dropdown.Item pair,
// emitting Bootstrap-compatible class names (.dropdown, .dropdown-toggle,
// .dropdown-menu, .dropdown-item) so existing overrides keep applying. The
// menu portals into document.body rather than sitting inside .dropdown: a
// couple of call sites (e.g. the Legend layers card) live inside a scrolling,
// transformed ancestor, which clips an in-place absolutely-positioned menu
// no matter its own position value. Positioning is computed from the
// toggle's bounding rect instead of relying on CSS containment.
// `title` is the toggle's *content*; `tooltip` is the HTML title attribute.
export function DropdownButton({
  title,
  tooltip,
  className = "",
  toggleClassName = "",
  // Extra class(es) for the menu itself. The menu portals into document.body
  // rather than nesting under `className` (see below), so a caller after
  // more than the default white/rounded-sm/shadow-md chrome — a bigger radius,
  // different padding — can't reach it with a descendant selector off its own
  // wrapper and needs this instead.
  menuClassName = "",
  size,
  variant,
  // 'start' (default) lines the menu's left edge up with the toggle's, which
  // reads fine once the menu is about as wide as its toggle (the two
  // existing callers, both text buttons). 'center' anchors the menu under
  // the toggle's midpoint instead via transform: translateX(-50%) — needed
  // once the toggle is much narrower than its menu (an icon-only button, say),
  // where left-alignment leaves the menu looking like it belongs to whatever
  // sits to the toggle's right instead. 'viewport-center' anchors it to the
  // viewport's own midline rather than the toggle's — for a toggle that sits
  // off-centre inside a row that is itself centred (the top bar's search
  // button, one segment among several in a centred pill), where centring on
  // the toggle would leave the menu visibly off-centre under the row/card it
  // reads as belonging to.
  align = "start",
  // Fires whenever the menu opens/closes. The toggle's own open/closed state
  // otherwise stays private to this component — callers that need to style
  // the toggle differently while its menu is up (see topBarSpatialFilterToggle)
  // use this to mirror it into their own state.
  onOpenChange,
  children,
  "data-testid": testId,
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback(
    (value) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  const [menuStyle, setMenuStyle] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Recomputed on resize, not just when the menu opens — the toggle is
  // typically inside a centered, width-dependent layout (the top bar's
  // brand card, say), so a viewport resize while the menu is open moves the
  // toggle out from under a position that was only ever measured once.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    function updateMenuStyle() {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuStyle(
        align === "center" || align === "viewport-center"
          ? {
              position: "fixed",
              top: rect.bottom + 2,
              left: align === "viewport-center" ? "50%" : rect.left + rect.width / 2,
              minWidth: rect.width,
              transform: "translateX(-50%)",
            }
          : {
              position: "fixed",
              top: rect.bottom + 2,
              left: rect.left,
              minWidth: rect.width,
            },
      );
    }
    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    return () => window.removeEventListener("resize", updateMenuStyle);
  }, [open, align]);

  useLayoutEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (
        !buttonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);

  const buttonClasses = [
    "btn",
    "dropdown-toggle",
    size && `btn-${size}`,
    variant && `btn-${variant}`,
    toggleClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`dropdown ${className}`} data-testid={testId}>
      <button
        type="button"
        ref={buttonRef}
        data-testid={testId && `${testId}-toggle`}
        className={buttonClasses}
        title={tooltip}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open &&
        createPortal(
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            <div
              className={`dropdown-menu show ${menuClassName}`}
              ref={menuRef}
              style={menuStyle}
            >
              {children}
            </div>
          </DropdownContext.Provider>,
          document.body,
        )}
    </div>
  );
}

function DropdownItem({ onClick = () => {}, active, children, ...rest }) {
  const { close } = useContext(DropdownContext);
  return (
    <button
      type="button"
      className={`dropdown-item ${active ? "active" : ""}`}
      onClick={(event) => {
        onClick(event);
        close();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// Namespace object so `<Dropdown.Item>` call sites only need their import
// changed.
export const Dropdown = { Item: DropdownItem };
