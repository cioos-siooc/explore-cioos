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

// Emits Bootstrap-compatible class names so existing overrides keep applying.
// The menu portals into document.body because some call sites live inside a
// scrolling, transformed ancestor that clips an in-place absolute menu.
// `title` is the toggle's *content*; `tooltip` is the HTML title attribute.
export function DropdownButton({
  title,
  tooltip,
  className = "",
  toggleClassName = "",
  // The menu portals out of `className`, so descendant selectors can't reach it.
  menuClassName = "",
  size,
  variant,
  // 'start' aligns left edges, 'center' centres under a toggle much narrower
  // than its menu (icon buttons), 'end' aligns right edges for a toggle at the
  // right edge of its row.
  align = "start",
  // For callers that style the toggle while its menu is up.
  onOpenChange,
  disabled,
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

  // Recomputed on resize: the toggle usually sits in a width-dependent layout.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    function updateMenuStyle() {
      const rect = buttonRef.current.getBoundingClientRect();
      const base = {
        position: "fixed",
        top: rect.bottom + 2,
        // Floor at the toggle's width, except with menuClassName: an inline
        // style would beat the width that class sets.
        ...(menuClassName ? {} : { minWidth: rect.width }),
      };
      if (align === "center")
        setMenuStyle({
          ...base,
          left: rect.left + rect.width / 2,
          transform: "translateX(-50%)",
        });
      else if (align === "end")
        setMenuStyle({
          ...base,
          left: rect.right,
          transform: "translateX(-100%)",
        });
      else setMenuStyle({ ...base, left: rect.left });
    }
    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    return () => window.removeEventListener("resize", updateMenuStyle);
  }, [open, align, menuClassName]);

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
        disabled={disabled}
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

// So `<Dropdown.Item>` call sites only need their import changed.
export const Dropdown = { Item: DropdownItem };
